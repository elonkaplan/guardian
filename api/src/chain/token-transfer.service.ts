import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  Account,
  Address,
  Chain,
  Hex,
  PublicClient,
  TransactionReceipt,
  Transport,
  WalletClient,
} from 'viem';

import type { AppConfig } from '../config/env.schema';
import { erc20Abi } from './abi/erc20.abi';
import { FUNDER_CLIENT, OPERATOR_CLIENT, PUBLIC_CLIENT } from './chain.tokens';
import { decodeRevert } from './decode-revert';
import { ChainError } from './errors';
import { executeWrite } from './execute-write';
import type { TxResult } from './types';
import { fromBaseUnits, toBaseUnits } from './units';

/**
 * The two funding legs — money entering the platform and money leaving it —
 * plus the free balance reads that decide whether either is worth attempting.
 *
 * ⚠️ **Nothing in this file touches the escrow contract.** Both legs are plain
 * `USDC.transfer` calls against the settlement token
 * (`specs/005-accounts-ledger-funding/research.md` R4). That is not an
 * implementation shortcut: the escrow has no funding function, and adding one
 * would be an `sc/` redeploy. The escrow's job is holding money *during* a
 * deal; this service's job is getting money in and out of the operator pool in
 * the first place.
 *
 * The two directions and who signs them:
 *
 * | Leg | Signer | Recipient | Meaning |
 * | --- | --- | --- | --- |
 * | **top-up** | funder | operator | money enters the system |
 * | **cash-out** | operator | funder | money leaves the system |
 *
 * The funder wallet is "the outside world" (`docs/rain-integration.md` §0.2/0.3)
 * — the only source of money in the system, standing in for the bank while
 * Rain's onramp is stubbed. Its balance should fall as users top up and rise as
 * they cash out; drift in one direction only means something is wrong.
 *
 * ⚠️ **Amounts cross this boundary in whole CENTS**, like every other public
 * method in `chain/`. `toBaseUnits`/`fromBaseUnits` from `./units` are the only
 * conversion in this file and must stay the only one — the scale appearing in a
 * second place breaks invariant #2 in `docs/CONTEXT.md`, and the failure mode
 * is a factor-of-10,000 error in real money.
 *
 * ⚠️ **What this service deliberately does NOT do: decide what a failure
 * means.** Both writes go out through `executeWrite`, which raises
 * `ChainOutcomeUnknownError` when a transaction was broadcast but no receipt
 * arrived in time. That is *not* a failure, and on the cash-out path it must
 * not be compensated — a compensating credit for a transfer that later
 * confirms hands the user their money twice and breaks `pool >= Σ ledger` in
 * the unsafe direction (R6). This service surfaces the distinct error classes
 * and leaves the branch to the funding module, which is the only layer that
 * knows what was written to Postgres.
 */
@Injectable()
export class TokenTransferService {
  private readonly logger = new Logger(TokenTransferService.name);
  private readonly usdc: Hex;
  private readonly operator: Address;

  /**
   * The funder wallet's address, exposed because callers outside this module
   * need to *name* it without being able to sign as it.
   *
   * The Rain offramp stub returns it as the deposit address — that is the shape
   * a real Rain offramp has (`docs/rain-integration.md` §0.3) — and the funding
   * module puts it in shortfall messages, so an operator reading "the funder is
   * short" knows which wallet to refill. An address is public information; the
   * client that can spend from it is not, and stays private below.
   */
  readonly funderAddress: Address;

  constructor(
    @Inject(PUBLIC_CLIENT) private readonly publicClient: PublicClient,
    @Inject(OPERATOR_CLIENT)
    private readonly operatorClient: WalletClient<Transport, Chain, Account>,
    @Inject(FUNDER_CLIENT)
    private readonly funderClient: WalletClient<Transport, Chain, Account>,
    config: ConfigService<AppConfig, true>,
  ) {
    this.usdc = config.get('USDC_ADDRESS', { infer: true }) as Hex;
    this.operator = config.get('OPERATOR_ADDRESS', { infer: true }) as Address;
    this.funderAddress = config.get('FUNDER_ADDRESS', {
      infer: true,
    }) as Address;
  }

  // -------------------------------------------------------------------
  // Money in / money out
  // -------------------------------------------------------------------

  /**
   * Top-up: move `cents` of USDC from the FUNDER to the operator pool.
   *
   * ⚠️ **This half goes FIRST in the top-up flow, before the ledger credit** —
   * the opposite order to every other flow in the system, and deliberately so.
   * The solvency invariant is `pool >= Σ ledger`, so whichever write *increases
   * what we owe* goes second (R7). A top-up increases the ledger, so the
   * transfer leads; a crash between the halves then leaves the pool holding
   * more than the ledger claims, which is the tolerable direction. Reading
   * "Postgres first, chain second" (invariant #1) onto this flow gets it
   * exactly backwards — that shorthand is about cash-out.
   *
   * Callers should check `funderUsdcCents()` first: a shortfall caught by that
   * free read is a clear refusal, while the same shortfall discovered here is
   * an `ERC20InsufficientBalance` revert decoded after a transaction was
   * attempted on a chain that charges the limit even for a revert (R15).
   */
  async transferFromFunder(cents: number): Promise<TxResult> {
    this.logger.log(
      `top-up: transferring ${cents}¢ from funder ${this.funderAddress} to operator ${this.operator}`,
    );

    return this.voidResult(
      await executeWrite({
        publicClient: this.publicClient,
        walletClient: this.funderClient,
        address: this.usdc,
        abi: erc20Abi,
        functionName: 'transfer',
        args: [this.operator, toBaseUnits(cents)],
        operation: 'transfer',
      }),
    );
  }

  /**
   * Cash-out: move `cents` of USDC from the operator pool back to the FUNDER.
   *
   * Signed by the operator, because the tokens leaving are the pool's — the
   * funder key is the entrance only. No user signature is involved: this is the
   * operator-driven exit for unspent platform balance that
   * `docs/rain-integration.md` §0.3 flags as otherwise missing.
   *
   * ⚠️ **This half goes SECOND, after the ledger debit** (R7), for the same
   * reason the top-up's goes first: the debit is what reduces what we owe, so
   * a crash between the halves again leaves the pool over-collateralised rather
   * than under. See the class docblock for why the failure branch here must
   * distinguish `ChainOutcomeUnknownError` from a real failure before writing
   * any compensating entry.
   *
   * Note that the operator's escrow allowance says nothing about this call. An
   * allowance governs what the escrow may *pull*; this is the operator spending
   * its own tokens, so only its balance matters — check `operatorUsdcCents()`.
   */
  async transferToFunder(cents: number): Promise<TxResult> {
    this.logger.log(
      `cash-out: transferring ${cents}¢ from operator ${this.operator} to funder ${this.funderAddress}`,
    );

    return this.voidResult(
      await executeWrite({
        publicClient: this.publicClient,
        walletClient: this.operatorClient,
        address: this.usdc,
        abi: erc20Abi,
        functionName: 'transfer',
        args: [this.funderAddress, toBaseUnits(cents)],
        operation: 'transfer',
      }),
    );
  }

  // -------------------------------------------------------------------
  // Preconditions — free reads, no transaction (R15)
  // -------------------------------------------------------------------

  /**
   * The funder wallet's USDC holding, in cents. The top-up precondition.
   *
   * A free `eth_call`. Its whole purpose is to turn "the funder has run dry"
   * from a chain error into a refusal that costs nothing: without it, an
   * underfunded funder surfaces as `ERC20InsufficientBalance` bubbled through
   * `decodeRevert` — accurate, but arriving *after* a transaction was attempted
   * on a chain that charges the gas limit for a revert, and shaped like an
   * infrastructure fault rather than the plain "we cannot fund that right now"
   * it actually is (FR-018, R15).
   *
   * Doubles as the health reading described in `docs/rain-integration.md` §0.3.
   */
  async funderUsdcCents(): Promise<number> {
    return this.usdcBalanceCents('funderUsdcBalance', this.funderAddress);
  }

  /**
   * The operator pool's USDC holding, in cents. The cash-out precondition.
   *
   * The same read against a different address, and genuinely independent of the
   * escrow allowance `ensureAllowance` manages: that allowance governs what the
   * escrow may pull from the operator and says nothing about what the operator
   * actually holds. Either can be fine while the other is short, and they fail
   * with different ERC-20 errors.
   *
   * ⚠️ This is the pool's *raw token* balance, not the settled-plus-escrowed
   * accounting figure. It is a spendability check for one transfer, not a
   * solvency statement — `pool >= Σ ledger` is the ledger's business, and this
   * number includes nothing about what the escrow is holding on behalf of open
   * deals.
   */
  async operatorUsdcCents(): Promise<number> {
    return this.usdcBalanceCents('operatorUsdcBalance', this.operator);
  }

  // -------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------

  /**
   * `balanceOf`, in cents, with read failures routed through the same decoder
   * the write path uses.
   *
   * Mirrors `EscrowReadService.read` rather than calling `readContract`
   * directly, and for the same reason: without the wrapper an unreachable RPC
   * leaks a raw `ContractFunctionExecutionError` instead of
   * `ChainConnectivityError`, and a caller doing
   * `catch (e) { if (e instanceof ChainError) … }` misses it entirely.
   * FR-010's named-failure requirement is not limited to writes — and these two
   * reads gate whether money moves at all, so a failure here that reads as
   * "balance unknown" rather than "chain unreachable" is the difference between
   * refusing a top-up and diagnosing a node.
   *
   * `ChainError` passes through untouched so a `UnitConversionError` raised by
   * `fromBaseUnits` — which would mean the token does not have the 6 decimals
   * `units.ts` assumes — is not re-wrapped into something vaguer.
   */
  private async usdcBalanceCents(
    operation: string,
    account: Address,
  ): Promise<number> {
    try {
      const raw = await this.publicClient.readContract({
        address: this.usdc,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [account],
      });
      return fromBaseUnits(raw);
    } catch (err) {
      if (err instanceof ChainError) throw err;
      throw decodeRevert(err, operation);
    }
  }

  /**
   * Drops the receipt from the result for writes that produce no value.
   *
   * Deliberately a private twin of `EscrowOperatorService`'s helper rather than
   * a shared export: the duplication is four lines, and hoisting it would put a
   * shared mutable-shaped helper between two services that have no other
   * relationship. What matters is the shape being identical, and it is.
   */
  private voidResult(result: TxResult<TransactionReceipt>): TxResult {
    return {
      hash: result.hash,
      blockNumber: result.blockNumber,
      gasUsed: result.gasUsed,
      value: undefined,
    };
  }
}
