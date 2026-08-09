import { Injectable, Logger } from '@nestjs/common';
import type { Address } from 'viem';

import { AccountsService } from '../accounts/accounts.service';
import type { AccountSummaryResponse } from '../accounts/dto/account-summary.dto';
import { EscrowOperatorService } from '../chain/escrow-operator.service';
import { EscrowReadService } from '../chain/escrow-read.service';
import { ChainError, ChainOutcomeUnknownError } from '../chain/errors';
import { TokenTransferService } from '../chain/token-transfer.service';
import type { TxResult } from '../chain/types';
import { Account } from '../entities/account.entity';
import { LedgerKind } from '../entities/enums';
import { LedgerRepository } from '../ledger/ledger.repository';
import type { WithdrawResponse } from './dto/withdraw.dto';
import {
  InsufficientFunderBalanceError,
  InsufficientPoolBalanceError,
  NoSettledFundsError,
} from './funding.errors';

/**
 * The three ways money crosses the platform's edge, and the only place in the
 * backend that owns a two-phase money flow end to end.
 *
 * | Flow | Postgres | Chain | Order | Failure of the second leg |
 * | --- | --- | --- | --- | --- |
 * | **top-up** | credit `onramp` | funder → pool | **chain first** | log at `error`, replay by hand |
 * | **cash-out** | debit `offramp` | pool → funder | **Postgres first** | compensating `adjustment` — *unless* the outcome is unknown |
 * | **withdraw** | *nothing* | escrow → user | single-phase | nothing to undo |
 *
 * ---
 *
 * ## ⚠️ The ordering rule, and why top-up looks like it breaks it
 *
 * The solvency relationship is `pool >= Σ ledger` (`docs/CONTEXT.md`
 * invariant #1, which tabulates all three flows) — note the `>=`. From that one
 * inequality the ordering falls out mechanically: **whichever write increases
 * what the platform owes goes second**, so that a crash between the halves
 * leaves the pool holding *more* than the ledger claims rather than less.
 *
 * A top-up increases the ledger, so the transfer leads. A cash-out decreases it,
 * so the debit leads. These are the *same* rule applied to opposite directions,
 * not a rule and an exception — and the shorthand "Postgres first, chain second"
 * is the cash-out case only. Pattern-matching that shorthand onto the top-up
 * gets it exactly backwards and produces a credit for tokens that never arrived
 * (research R7).
 *
 * ## ⚠️ `ChainOutcomeUnknownError` is not a failure, and the two flows treat it
 * in opposite ways
 *
 * It means the transaction was **broadcast** and no receipt arrived within the
 * timeout. It may confirm a second later. So:
 *
 * - **top-up**: write no credit. Crediting money that may never arrive promises
 *   what the pool does not hold.
 * - **cash-out**: leave the debit standing, write no compensation. Restoring a
 *   balance for a transfer that later confirms hands the user their money twice.
 *
 * Both readings come from the same place — do not act as though an unknown
 * outcome were a known failure — and both point the safe way: the pool ends up
 * over-collateralised, never under. `cashOut` carries the full reasoning table.
 *
 * ## What this service deliberately does not do
 *
 * It does not convert units (invariant #2 — every amount here is whole US cents
 * and the only `× 10⁴` in the codebase lives in `src/chain/units.ts`), it does
 * not construct `HttpException`s (that mapping is one reviewable block in
 * `FundingController`), and it does not retry anything. A retry across a
 * confirmed-but-unrecorded transfer is how one top-up becomes two credits.
 */
@Injectable()
export class FundingService {
  private readonly logger = new Logger(FundingService.name);

  constructor(
    private readonly tokens: TokenTransferService,
    private readonly escrow: EscrowOperatorService,
    private readonly escrowRead: EscrowReadService,
    private readonly ledger: LedgerRepository,
    /**
     * Only for `getSummary`. Both balance-changing flows answer with the
     * updated summary so the wallet widget is correct without a second round
     * trip (contracts §3, §5) — and reusing `AccountsService` rather than
     * re-assembling three figures here is what keeps `GET /me` and the
     * post-mutation body provably identical. Two assemblies of the same object
     * is two chances for them to disagree, and the visible symptom would be a
     * balance that changes when the page refreshes.
     */
    private readonly accounts: AccountsService,
  ) {}

  /**
   * **Top-up** — funder wallet → operator pool, then an `onramp` credit.
   * Answers with the account's updated summary.
   *
   * ### 1. The pre-read (research R15)
   *
   * `funderUsdcCents()` is a free `eth_call`, and it exists to turn one specific
   * failure into a refusal that costs nothing. Without it, an underfunded funder
   * surfaces as `ERC20InsufficientBalance` — decoded accurately by
   * `decodeRevert`, but only *after* a transaction was attempted, on a chain
   * that charges the full gas limit for a revert. The message names **both**
   * figures because "insufficient funds" without numbers is unactionable to the
   * operator who has to refill the wallet mid-demo (FR-018).
   *
   * ### 2. ⚠️ TRANSFER FIRST, THEN CREDIT
   *
   * This is what the write-order rule *requires*, not an exception to it. The
   * solvency relationship is `pool >= Σ ledger`, so whichever write increases
   * what the platform owes goes second — and here that write is the credit.
   * Crediting before the tokens land promises money the pool does not hold, and
   * every downstream guarantee (purchases, cash-outs, the escrow's ability to
   * pay) rests on that inequality holding (research R7; `docs/CONTEXT.md`
   * invariant #1).
   *
   * ### 3. ⚠️ Unknown outcome → no credit
   *
   * `ChainOutcomeUnknownError` is checked before anything else, because it is
   * the one error class that does **not** mean the money stayed put. The credit
   * is skipped, the hash is logged at `error`, and the error is rethrown so the
   * caller gets `502 { message, txHash }` and can look the transaction up
   * themselves. If it later confirms, a human replays the credit as an
   * `adjustment`.
   *
   * ### 4. ⚠️ Transfer confirmed but the credit throws
   *
   * The pool now holds tokens nobody was credited — the **safe** direction, and
   * the reason this branch is a loud log rather than a repair. It is deliberately
   * *not* retried: a retry loop across a write whose outcome we already know
   * succeeded is how one $100 top-up becomes two $100 credits. The log carries
   * the hash and the instruction, because the fix is one hand-written
   * `adjustment` row and the only hard part is knowing it is needed.
   */
  async topUp(
    account: Account,
    amountMinor: number,
  ): Promise<AccountSummaryResponse> {
    const funderMinor = await this.tokens.funderUsdcCents();

    if (funderMinor < amountMinor) {
      // Thrown before anything is attempted: no transaction, no row, no gas.
      // That is what makes this a `409` rather than a `502` (contracts §8).
      throw new InsufficientFunderBalanceError(
        `Funder wallet holds ${funderMinor} cents, ` +
          `cannot transfer ${amountMinor} cents`,
        funderMinor,
        amountMinor,
      );
    }

    // ─── Leg 1: the chain. Nothing has been written to Postgres yet. ────────
    const transfer = await this.transferIn(amountMinor);

    // ─── Leg 2: the credit. The tokens are already in the pool. ─────────────
    try {
      await this.ledger.appendEntry({
        accountId: account.id,
        // Positive: this is a credit. `appendEntry` takes a SIGNED amount and
        // does not infer the sign from `kind`, so the `+` is the caller's
        // assertion about what happened and it is the whole difference between
        // a top-up and a debit.
        amountMinor,
        kind: LedgerKind.Onramp,
        // The confirmed hash, which is what makes this row auditable against
        // the chain. Available here — unlike on the cash-out debit — precisely
        // because the transfer went first.
        externalRef: transfer.hash,
      });
    } catch (err) {
      this.logger.error(
        `top-up transfer ${transfer.hash} CONFIRMED but the ledger credit failed ` +
          `for account ${account.id}: ${amountMinor} cents are in the pool and ` +
          `uncredited. Credit this by hand as an \`adjustment\` entry referencing ` +
          `that hash. DO NOT re-run the top-up — the tokens have already moved. ` +
          `Cause: ${err instanceof Error ? err.message : String(err)}`,
      );
      throw err;
    }

    return this.accounts.getSummary(account);
  }

  /**
   * **Withdraw** — pay the account's settled escrow balance to the account's own
   * address, via `withdrawFor`. Single-phase; **writes nothing to Postgres**.
   *
   * ### ⚠️ The settled-funds read here is FAIL-FAST
   *
   * The identical call is best-effort on `GET /me`, where every failure becomes
   * `settledFundsMinor: null` and the UI renders a dash. That is not an
   * inconsistency to be tidied up — **best-effort is a property of the call
   * site, not of the method** (research R9).
   *
   * On `/me` the read is one of three figures on a widget polled every 5 s by
   * every open page; degrading it costs a dash and keeps the balance widget
   * alive when the RPC is flaky. Here it is a **precondition for spending
   * money**: it decides whether a paid transaction is submitted at all, and it
   * supplies the amount reported back on the receipt. Swallowing a failure here
   * means submitting a transaction on a guess. So a failed read raises its
   * `ChainError` and the request becomes a `502`.
   *
   * ### ⚠️ Zero settled → refuse, and submit NO transaction
   *
   * On Monad the gas **limit** is charged whether or not the call moves
   * anything, so a pointless `withdrawFor` burns the full 140,000-gas ceiling
   * every time (FR-023). A `409` here is not politeness, it is the operator's
   * MON.
   *
   * ### ⚠️ Writes NO ledger entry — invariant #5, FR-022
   *
   * **This is the thing most likely to be "fixed" into a bug** by someone who
   * reasons that a withdrawal obviously belongs in the statement. It does not.
   * Settled funds live on-chain under the *user's own address*; the platform
   * never held them in the pool, never counted them in
   * `SUM(ledger_entries.amount_minor)`, and cannot recapture them. There is
   * nothing to record and nothing to compensate — `LedgerKind` has no
   * `settlement` member for exactly this reason (`entities/enums.ts`). A row
   * written here would debit an account for money the ledger never credited,
   * driving a perfectly healthy balance negative.
   *
   * ### ⚠️ The destination comes from the session, never from the request
   *
   * `account.walletAddress`, loaded by the auth guard. A caller-supplied
   * address would let anyone redirect anyone else's payout — which is also why
   * the escrow's own `withdraw()` (pays `msg.sender`, i.e. the operator) is
   * absent from `escrowOperatorAbi` and unreachable from here.
   */
  async withdraw(account: Account): Promise<WithdrawResponse> {
    const address = account.walletAddress as Address;

    // FAIL-FAST. A `ChainError` from this read propagates and becomes a `502`;
    // there is no `null` branch and no default of `0`, because "cannot read the
    // balance" and "the balance is nothing" must not produce the same behaviour
    // when the next line spends money.
    const settledMinor = await this.escrowRead.balanceOfCents(address);

    if (settledMinor <= 0) {
      // `<= 0` rather than `=== 0`: the on-chain value is a `uint256` and cannot
      // be negative, so this is the zero check plus a free guard against a
      // future mapper bug ever talking us into a negative-value transfer.
      throw new NoSettledFundsError(
        `account ${account.id} (${address}) has no settled funds to withdraw`,
      );
    }

    const result = await this.escrow.withdrawFor(address);

    this.logger.log(
      `withdraw: ${settledMinor}¢ paid to ${address} for account ${account.id} in ${result.hash}`,
    );

    return {
      txHash: result.hash,
      // From the PRE-read, so a settlement landing between the read and the
      // transaction makes this figure slightly low. Harmless and deliberately
      // not re-read: `withdrawFor` moves whatever the balance is at execution
      // time, so the money is right even when the receipt's number is a moment
      // old (R9). A second read after the fact would report `0` — correct and
      // useless.
      amountMinor: settledMinor,
      explorerUrl: this.escrowRead.explorerTxUrl(result.hash),
    };
  }

  /**
   * **Cash-out** — debit the account's platform balance, then move the same
   * amount of USDC from the operator pool back to the funder wallet. Answers
   * with the account's updated summary.
   *
   * ### 1. The pre-read
   *
   * `operatorUsdcCents()` is free, and refusing here means **no debit is
   * written** — a debit taken for a transfer that was never even attempted
   * would need a compensating row for nothing. Note this is the pool being
   * short, which is a *platform* problem, and a different sentence from the
   * *user* being short that `debitWithBalanceCheck` raises a moment later.
   *
   * ### 2. ⚠️ DEBIT FIRST, THEN TRANSFER
   *
   * Same rule as the top-up, other direction: the debit *reduces* what the
   * platform owes, so it is safe to go first. A crash between the halves leaves
   * the pool holding more than the ledger claims — the tolerable direction
   * (research R7, invariant #1). The debit also carries the balance check, under
   * a row lock on `accounts`, which is what stops two concurrent cash-outs from
   * drawing the same balance twice (R8).
   *
   * ### 3. ⚠️ No `externalRef` on the debit, and this is a real trade-off
   *
   * The transaction hash does not exist yet — that is the unavoidable
   * consequence of the debit going first — and the ledger is append-only
   * (invariant #4, FR-011), so it cannot be backfilled onto the row afterwards.
   * The row therefore has a `null` `externalRef` forever. Recording this
   * explicitly because it looks like an oversight and is not: linking the row to
   * the transfer would require either an `UPDATE` (which would put a mutation
   * path into the one table whose whole guarantee is that it has none) or the
   * transfer going first (which would break solvency ordering). The hash is
   * surfaced in the log and in the `502` body instead.
   *
   * ### 4. ⚠️⚠️ THE COMPENSATION BRANCH — the most dangerous code in this feature
   *
   * `ChainOutcomeUnknownError` is checked **first**, above the general
   * `ChainError` branch. It has to be: it *extends* `ChainError` (deliberately,
   * so no top-level handler can swallow it), so a generic check placed above it
   * would match "unknown" and compensate it as though it were a known failure.
   *
   * | | Compensate | Do not compensate |
   * | --- | --- | --- |
   * | **Transfer later confirms** | 🔴 tokens left the pool **and** the balance was restored — the user cashed out and kept the money. `pool >= Σ ledger` breaks in the unsafe direction. | ✅ correct |
   * | **Transfer never confirms** | ✅ correct | ⚠️ user is short; pool holds more than the ledger claims — the **safe** direction, visible in the statement, fixable with an `adjustment` |
   *
   * **The two wrong outcomes are not symmetric.** Compensating wrongly *creates
   * money* and breaks the invariant everything else rests on. Not compensating
   * wrongly leaves a user short in the direction the system is designed to
   * tolerate, on a statement they can read, correctable with the `adjustment`
   * kind that exists for exactly this. So the compensating row is written only
   * for errors that **prove** the transfer did not happen —
   * `ContractRevertError`, `InsufficientFundsError`,
   * `InsufficientAllowanceError`, `UnitConversionError`, `GasExhaustedError`,
   * `ChainConnectivityError`, i.e. any `ChainError` that is not
   * `ChainOutcomeUnknownError` (research R6).
   *
   * This is the same trap `src/chain/errors.ts` documents for `openDeal` — same
   * class, same trap, a different flow. Do not collapse these two branches.
   *
   * ### 5. The compensating row leaves the debit standing
   *
   * A positive `adjustment` beside the negative `offramp`, summing to zero. The
   * balance is restored *and* the statement shows what was attempted, which is
   * the entire reason the ledger is append-only rather than editable.
   */
  async cashOut(
    account: Account,
    amountMinor: number,
  ): Promise<AccountSummaryResponse> {
    const poolMinor = await this.tokens.operatorUsdcCents();

    if (poolMinor < amountMinor) {
      // Nothing written — in particular no debit. `409`, and the operator, not
      // the user, is the one who has to act on it.
      throw new InsufficientPoolBalanceError(
        `Operator pool holds ${poolMinor} cents, ` +
          `cannot cash out ${amountMinor} cents`,
        poolMinor,
        amountMinor,
      );
    }

    // ─── Leg 1: the debit, under a row lock. ────────────────────────────────
    // Throws `InsufficientBalanceError` (→ `409`) with nothing written if the
    // ledger does not sum to enough. `amountMinor` is passed POSITIVE; the
    // repository negates it and writes `kind = offramp`, so the one place a
    // sign error is possible is the one place that just compared magnitudes.
    // No `externalRef` — see §3 of the docblock.
    await this.ledger.debitWithBalanceCheck(account.id, amountMinor);

    // ─── Leg 2: the chain. The debit is already committed. ──────────────────
    try {
      const transfer = await this.tokens.transferToFunder(amountMinor);

      this.logger.log(
        `cash-out: ${amountMinor}¢ debited from account ${account.id} and ` +
          `transferred to the funder in ${transfer.hash}`,
      );
    } catch (err) {
      // ⚠️ FIRST. Not a failure — an unknown outcome. THE DEBIT STANDS.
      if (err instanceof ChainOutcomeUnknownError) {
        this.logger.error(
          `cash-out transfer ${err.hash} for account ${account.id} has an UNKNOWN ` +
            `outcome; the ${amountMinor}¢ debit STANDS and no compensating entry ` +
            `was written. Check that hash: if it never confirms, restore the ` +
            `balance by hand as an \`adjustment\`. Compensating automatically ` +
            `would double-pay the user if it does confirm (R6).`,
        );
        throw err;
      }

      // Definite failure: every remaining `ChainError` proves the tokens did
      // not move, so the debit must be reversed.
      if (err instanceof ChainError) {
        await this.compensate(account, amountMinor, err);
        throw err;
      }

      // Not a chain error at all — a bug in our code, or Postgres. Nothing here
      // proves anything about the transfer, so nothing is compensated and the
      // stack is preserved for whoever has to read it.
      throw err;
    }

    return this.accounts.getSummary(account);
  }

  /**
   * The chain half of a top-up, with the unknown-outcome branch peeled off so
   * that `topUp` reads as its two legs rather than as a try/catch.
   *
   * ⚠️ This catch **writes nothing and repairs nothing** — it exists only to
   * make the hash loud before the error continues outward. Every branch here
   * ends in a rethrow; there is no path on which a top-up credit is written for
   * a transfer whose outcome is not known to be `success`.
   */
  private async transferIn(amountMinor: number): Promise<TxResult> {
    try {
      return await this.tokens.transferFromFunder(amountMinor);
    } catch (err) {
      if (err instanceof ChainOutcomeUnknownError) {
        this.logger.error(
          `top-up transfer ${err.hash} has an UNKNOWN outcome; NO credit was ` +
            `written for ${amountMinor}¢. If that transaction later confirms, ` +
            `credit the account by hand as an \`adjustment\` — crediting now ` +
            `would promise money the pool may never hold (R7).`,
        );
      }
      throw err;
    }
  }

  /**
   * Write the compensating `adjustment` for a cash-out whose transfer
   * **definitely** failed. Called only from the branch that has already ruled
   * out `ChainOutcomeUnknownError`.
   *
   * A positive row of kind `adjustment`, beside the negative `offramp` that
   * stays exactly where it is. Two rows summing to zero: the balance is whole
   * again and the statement still shows the attempt (`data-model.md` §2).
   *
   * ⚠️ `externalRef` is `null`, and not for want of looking. No definite-failure
   * class in `chain/errors.ts` carries a hash — a reverted or unbroadcast
   * transfer has none worth recording — and the one class that *does* carry one,
   * `ChainOutcomeUnknownError`, is precisely the branch that never reaches here.
   * A hash extractor on this path would be dead code pretending to be diligence.
   *
   * If the compensating write *itself* fails, the original chain error is still
   * what the caller is told — the transfer failing is the fact that concerns
   * them, and a `500` here would hide which leg broke — but the log gets both,
   * because the account is now short by `amountMinor` with nothing in the
   * statement explaining why.
   */
  private async compensate(
    account: Account,
    amountMinor: number,
    cause: ChainError,
  ): Promise<void> {
    try {
      await this.ledger.appendEntry({
        accountId: account.id,
        amountMinor,
        kind: LedgerKind.Adjustment,
        externalRef: null,
      });

      this.logger.error(
        `cash-out transfer FAILED for account ${account.id} (${cause.name}: ` +
          `${cause.message}); the ${amountMinor}¢ debit was compensated with an ` +
          `\`adjustment\` credit and the balance is restored.`,
      );
    } catch (compensationErr) {
      this.logger.error(
        `cash-out transfer FAILED for account ${account.id} (${cause.name}: ` +
          `${cause.message}) AND the compensating entry could not be written: ` +
          `${
            compensationErr instanceof Error
              ? compensationErr.message
              : String(compensationErr)
          }. The account is short by ${amountMinor}¢ with no matching transfer. ` +
          `Restore it by hand as an \`adjustment\`.`,
      );
    }
  }
}
