import { Injectable, Logger } from '@nestjs/common';
import type { Address } from 'viem';

import { EscrowReadService } from '../chain/escrow-read.service';
import { Account } from '../entities/account.entity';
import { BalanceRepository } from '../ledger/balance.repository';
import { LedgerRepository } from '../ledger/ledger.repository';
import { EscrowExposureRepository } from '../orders/escrow-exposure.repository';
import { SETTLED_FUNDS_TIMEOUT_MS } from './accounts.constants';
import type { AccountSummaryResponse } from './dto/account-summary.dto';
import type { LedgerEntryResponse } from './dto/ledger-entry.dto';

/**
 * Sentinel for the losing side of the settled-funds race.
 *
 * A unique symbol rather than `null` or a sentinel number, because the value it
 * competes against is itself a number that may legitimately be `0` and a result
 * that may legitimately be null-ish. Identity comparison against a symbol
 * nothing else can produce is the only form of this check that cannot be
 * confused by a real reading.
 */
const TIMED_OUT = Symbol('settled-funds-read-timed-out');

/**
 * The money model behind `GET /me` and `GET /me/ledger`.
 *
 * Three figures from three different sources, and the split is the whole point
 * (`docs/database-schema.md` §3.3): the platform ledger says what the account
 * may spend, `orders` says what is locked in escrow, and the chain says what is
 * settled and withdrawable. No combined number is offered anywhere, because one
 * number would be wrong in three places at once.
 *
 * Only the first two are load-bearing for the request. See
 * `readSettledFundsMinor` for the rule that governs the third.
 */
@Injectable()
export class AccountsService {
  private readonly logger = new Logger(AccountsService.name);

  constructor(
    private readonly balances: BalanceRepository,
    private readonly escrowExposure: EscrowExposureRepository,
    private readonly chain: EscrowReadService,
    private readonly ledger: LedgerRepository,
  ) {}

  /**
   * The account and its three money figures.
   *
   * ⚠️ **This endpoint must not fail because of the chain.** It is polled every
   * 5 s by the balance widget on every page, so its failure mode is not "one
   * page is missing a number" — it is "the balance widget is broken
   * everywhere". A missing third figure costs a dash on the wallet screen; a
   * failing `/me` costs the product. That asymmetry is why the chain read is
   * degraded to `null` here and *not* in `POST /withdraw`, which fails fast on
   * the same read because acting on an unknown settled balance is worse than
   * refusing (research R9).
   *
   * The two Postgres reads run concurrently: they are independent, they hit
   * different tables, and serialising them would double the latency of the
   * hottest endpoint in the product for no reason. If either throws, the
   * request legitimately 500s — those two figures are not optional and a
   * silently zeroed balance is worse than an error.
   *
   * The settled read is deliberately *not* in that `Promise.all`. It has its
   * own budget and its own swallow-everything policy, and folding it into an
   * all-or-nothing combinator is precisely the thing that would let a dead RPC
   * take the balance widget down.
   */
  async getSummary(account: Account): Promise<AccountSummaryResponse> {
    const [availableBalanceMinor, inEscrowMinor] = await Promise.all([
      this.balances.getAvailableBalanceMinor(account.id),
      this.escrowExposure.sumOpenOrderValueMinor(account.id),
    ]);

    const settledFundsMinor = await this.readSettledFundsMinor(
      account.walletAddress as Address,
    );

    return {
      accountId: account.id,
      // Verbatim off the entity. `AccountRepository` guarantees this is
      // `getAddress()` output — EIP-55 checksummed — and it is the payout
      // address, so it is never lower-cased on the way out (research R13).
      address: account.walletAddress,
      availableBalanceMinor,
      inEscrowMinor,
      settledFundsMinor,
    };
  }

  /**
   * The full statement, newest first. `[]` for an account that has never moved
   * money — not a 404, not an error. Having no history is an ordinary state.
   *
   * No pagination and no filtering (`docs/CONTEXT.md` §6, research R12); at
   * demo scale an account has tens of rows. Ordering — including the `id`
   * tiebreak that keeps the list stable across the refetches the UI issues
   * after every mutation — is `LedgerRepository`'s to get right, not this
   * method's; the mapping below preserves whatever order it returns.
   *
   * Mapping to `LedgerEntryResponse` rather than returning entities is what
   * keeps the `account` and `order` relations, and the raw `Date`, off the
   * wire.
   */
  async getStatement(account: Account): Promise<LedgerEntryResponse[]> {
    const entries = await this.ledger.listByAccount(account.id);

    return entries.map((entry) => ({
      id: entry.id,
      // Signed, and passed through unchanged. Positive is a credit, negative a
      // debit — the sign is the only direction indicator in the payload.
      amountMinor: entry.amountMinor,
      kind: entry.kind,
      orderId: entry.orderId,
      externalRef: entry.externalRef,
      createdAt: entry.createdAt.toISOString(),
    }));
  }

  /**
   * The chain's settled balance for an address, in cents, or `null` if it could
   * not be read inside `SETTLED_FUNDS_TIMEOUT_MS`.
   *
   * **Every** rejection and **every** timeout becomes `null`. That is not
   * sloppy error handling, it is the contract: `null` means COULD NOT BE READ
   * and the UI renders it as `—`. There is no failure of the chain read that
   * should reach the caller of `GET /me`.
   *
   * ⚠️ Logged at `debug`, deliberately not `warn` or `error`. This runs on a
   * 5 s poll for every open page; a flaky RPC at `warn` would emit hundreds of
   * lines a minute and bury everything that matters during the demo. The
   * failure is already visible where it counts — as a dash on the screen.
   *
   * ⚠️ **What `Promise.race` does NOT do: it does not cancel the loser.** A
   * timed-out read stays pending inside viem until the transport's own timeout
   * expires, holding a socket the whole time. This is bounded and accepted — at
   * one poll per 5 s per client the worst case is a handful of abandoned
   * sockets that all expire within 10 s, and they no longer affect the response
   * either way. Fixing it properly means threading an `AbortSignal` through
   * `readContract`, which viem 2.55.11 does not expose on the contract-read
   * path. Recorded here so nobody rediscovers it as a leak and "fixes" it by
   * lengthening the budget.
   *
   * The timer is cleared in `finally` so a *fast* read does not leave a live
   * 2 s handle behind — on the happy path that is one dangling timer per poll
   * per client, which is small but entirely pointless.
   *
   * No conversion happens here. `balanceOfCents` already returns whole cents;
   * base units exist only inside `chain/` (invariant #2).
   *
   * (research R1)
   */
  private async readSettledFundsMinor(
    address: Address,
  ): Promise<number | null> {
    let timer: ReturnType<typeof setTimeout> | undefined;

    const budget = new Promise<typeof TIMED_OUT>((resolve) => {
      timer = setTimeout(() => resolve(TIMED_OUT), SETTLED_FUNDS_TIMEOUT_MS);
    });

    try {
      const settled = await Promise.race([
        this.chain.balanceOfCents(address),
        budget,
      ]);

      if (settled === TIMED_OUT) {
        this.logger.debug(
          `settled funds read exceeded ${SETTLED_FUNDS_TIMEOUT_MS}ms for ${address}; reporting null`,
        );
        return null;
      }

      return settled;
    } catch (err) {
      // Catches everything on purpose, including the named `ChainError`
      // subclasses `EscrowReadService` raises. There is no read failure worth
      // distinguishing at this call site: the response has exactly one way to
      // say "unknown".
      this.logger.debug(
        `settled funds read failed for ${address}; reporting null: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
}
