import {
  Body,
  ConflictException,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
} from '@nestjs/common';

import type { AccountSummaryResponse } from '../accounts/dto/account-summary.dto';
import { CurrentAccount } from '../auth/current-account.decorator';
import { toHttpException } from '../common/chain-http';
import { formatCents } from '../common/format-money';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { Account } from '../entities/account.entity';
import { InsufficientBalanceError } from '../ledger/ledger.errors';
import { offrampRequestSchema, type OfframpRequest } from './dto/offramp.dto';
import { topUpRequestSchema, type TopUpRequest } from './dto/topup.dto';
import type { WithdrawResponse } from './dto/withdraw.dto';
import {
  InsufficientFunderBalanceError,
  InsufficientPoolBalanceError,
  NoSettledFundsError,
} from './funding.errors';
import { FundingService } from './funding.service';

/**
 * The three routes that move money across the platform's edge.
 *
 * `@Controller()` carries **no prefix**, deliberately: the routes are `/topup`,
 * `/withdraw` and `/offramp` at the root, exactly as
 * `specs/005-accounts-ledger-funding/contracts/internal-api.md` §3–§5 declare
 * them and exactly as `ui/specs/006-wallet-page/` already calls them. A tidy
 * `funding` prefix would 404 every request the wallet screen makes.
 *
 * **No `@Public()` anywhere in this file, and its absence is the security
 * control.** The global `JwtAuthGuard` is fail-closed, so a route is protected
 * by saying nothing — and these three spend real money. Nothing here reads the
 * `Authorization` header or decodes a token; `@CurrentAccount()` is the whole
 * contract with `auth/`.
 *
 * **No handler takes an account, an address, or a destination.** The account is
 * the session's, never the caller's to name: a body that could name either end
 * of a transfer would let anyone credit their own balance from someone else's,
 * or redirect someone else's payout.
 *
 * ⚠️ **All three carry `@HttpCode(HttpStatus.OK)`.** Nest answers `201 Created`
 * to a `POST` by default, and none of these creates an addressable resource —
 * contracts §8 says `200`, and the UI's fetch layer checks the status. This is
 * a one-line omission that produces a working demo where every action reports
 * as failed.
 *
 * The whole error contract is one private method at the bottom of this file. See
 * `refuse` for why that is not merely tidier.
 */
@Controller()
export class FundingController {
  constructor(private readonly funding: FundingService) {}

  /**
   * Funder wallet → operator pool, then an `onramp` credit. Transfer first
   * (research R7).
   *
   * Answers with the updated `AccountSummaryResponse` so the balance widget is
   * correct without a second round trip.
   */
  @Post('topup')
  @HttpCode(HttpStatus.OK)
  topUp(
    @Body(new ZodValidationPipe(topUpRequestSchema)) body: TopUpRequest,
    @CurrentAccount() account: Account,
  ): Promise<AccountSummaryResponse> {
    return this.mapFailures(() =>
      this.funding.topUp(account, body.amountMinor),
    );
  }

  /**
   * Settled escrow funds → the account's own wallet, via `withdrawFor`.
   *
   * **No body.** The contract moves the whole balance, so there is no partial
   * withdrawal to express — see `dto/withdraw.dto.ts`. The destination is
   * `account.walletAddress` from the session and is never in the request.
   *
   * Writes no ledger entry (invariant #5): the statement is identical before and
   * after, which is why this is the one route here that does not answer with a
   * summary.
   */
  @Post('withdraw')
  @HttpCode(HttpStatus.OK)
  withdraw(@CurrentAccount() account: Account): Promise<WithdrawResponse> {
    return this.mapFailures(() => this.funding.withdraw(account));
  }

  /**
   * Unspent platform balance → funder wallet. Debit first (R7), inside a
   * row-locked transaction (R8).
   *
   * Partial cash-out is supported; the ceiling is `availableBalanceMinor`, and
   * escrowed money is excluded by construction because it is not part of that
   * sum.
   */
  @Post('offramp')
  @HttpCode(HttpStatus.OK)
  offramp(
    @Body(new ZodValidationPipe(offrampRequestSchema)) body: OfframpRequest,
    @CurrentAccount() account: Account,
  ): Promise<AccountSummaryResponse> {
    return this.mapFailures(() =>
      this.funding.cashOut(account, body.amountMinor),
    );
  }

  /**
   * Runs one funding flow and translates anything it throws into the HTTP
   * response contracts §8 specifies.
   *
   * **One helper rather than three try/catch bodies**, for the same reason
   * `common/chain-http.ts` is one function rather than a branch at every throw
   * site: the mapping *is* the contract, and a contract spread across three
   * handlers is one nobody can check by reading. Three copies also drift — the
   * fourth funding route added next month gets two of the four branches and
   * leaks a `500` for the third.
   *
   * Takes a **thunk**, not a promise. A promise argument would be created before
   * this method is entered, so anything the service threw synchronously (a
   * programming error before its first `await`) would escape the `try`
   * altogether. The thunk puts the whole call inside it.
   *
   * ---
   *
   * ## The mapping
   *
   * | Thrown | Status | Message |
   * | --- | --- | --- |
   * | `InsufficientBalanceError` | `409` | `Available balance is $X, cannot cash out $Y` |
   * | `InsufficientFunderBalanceError` | `409` | `Funder wallet holds $X, cannot transfer $Y` |
   * | `InsufficientPoolBalanceError` | `409` | `Operator pool holds $X, cannot cash out $Y` |
   * | `NoSettledFundsError` | `409` | `No settled funds to withdraw` |
   * | any `ChainError` | `502` | `toHttpException` — plus `txHash` when the outcome is unknown |
   * | anything else | `500` | Nest's default filter, stack intact |
   *
   * **`409`, never `400` or `422`.** Every case above is a *state* conflict —
   * not enough funds, nothing settled — reached by a request that was perfectly
   * well-formed and passed `amountMinorSchema`. The distinction is load-bearing
   * for the UI: a `409` is worth retrying once something changes, a `400` never
   * is.
   *
   * ⚠️ **Amounts are dollars, never raw cents.** These strings are shown
   * verbatim to a person mid-demo (`ui/specs/006-wallet-page/` handoff item 8,
   * contracts §7). "Available balance is 10000, cannot cash out 12345" invites
   * exactly the wrong reading, out loud, on stage. The domain errors carry cents
   * because they are also log text; `formatCents` is applied here, at the one
   * boundary that knows a human is on the other end.
   *
   * ⚠️ **`ChainError` is delegated, not handled.** `toHttpException` checks
   * `ChainOutcomeUnknownError` first — an unknown outcome carries its `txHash`
   * into the body, because that hash is the caller's only route to finding out
   * what actually happened. It also *throws* rather than returns for anything
   * that is not a `ChainError`, which is why the call below is written
   * `throw toHttpException(err)`: both paths end in a throw and the rethrow of a
   * genuine bug stays invisible at the call site.
   */
  private async mapFailures<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (err) {
      // The user is short. Nothing was written — the debit's transaction rolled
      // back under its own lock (R8).
      if (err instanceof InsufficientBalanceError) {
        throw new ConflictException(
          `Available balance is ${formatCents(err.availableMinor)}, ` +
            `cannot cash out ${formatCents(err.requestedMinor)}`,
        );
      }

      // *We* are short, in the funder wallet. Not the caller's fault and the
      // wording says so — they can only wait for an operator to refill it.
      if (err instanceof InsufficientFunderBalanceError) {
        throw new ConflictException(
          `Funder wallet holds ${formatCents(err.availableMinor)}, ` +
            `cannot transfer ${formatCents(err.requestedMinor)}`,
        );
      }

      // *We* are short, in the operator pool — and if this fires while the
      // user's ledger balance is good, `pool >= Σ ledger` is already broken and
      // someone needs to know tonight.
      if (err instanceof InsufficientPoolBalanceError) {
        throw new ConflictException(
          `Operator pool holds ${formatCents(err.availableMinor)}, ` +
            `cannot cash out ${formatCents(err.requestedMinor)}`,
        );
      }

      // A fixed sentence: there is one figure and it is zero, so there is
      // nothing to format. No transaction was submitted, which on Monad is the
      // point — the gas limit is charged even for a no-op.
      if (err instanceof NoSettledFundsError) {
        throw new ConflictException('No settled funds to withdraw');
      }

      // `502` for every chain failure, `txHash` on the unknown-outcome branch,
      // and a rethrow for anything that is not a `ChainError` at all.
      throw toHttpException(err);
    }
  }
}
