import type { LedgerKind } from '../../entities/enums';

/**
 * One row of `GET /me/ledger` — the statement, newest first.
 *
 * ⚠️ Field names are literal, for the reason spelled out in
 * `account-summary.dto.ts`: a mismatched key renders as an absent value on the
 * wallet page rather than failing (`67dcf4d`).
 *
 * **The contract that binds this list to `GET /me`:** the sum of `amountMinor`
 * over the whole array equals `availableBalanceMinor` from the summary. Both
 * derive from the same append-only table by construction — one sums it in
 * Postgres, one lists it — so if they ever disagree, one of the two queries is
 * wrong and the ledger itself is still the truth.
 *
 * This is a projection, not the entity. `LedgerEntry` carries `account` and
 * `order` relations and a `Date`; none of that belongs on the wire, and the
 * date in particular has to be pinned to a string format rather than left to
 * whatever `JSON.stringify` decides about a `Date` today.
 */
export interface LedgerEntryResponse {
  /** uuid. */
  id: string;

  /**
   * ⚠️ **SIGNED** cents — positive is a credit, negative is a debit. There is
   * no separate direction field and no absolute value anywhere in this
   * pipeline; the sign *is* the direction, and taking `Math.abs` of it at any
   * layer turns a cash-out into a top-up.
   */
  amountMinor: number;

  /**
   * `onramp` · `purchase` · `offramp` · `adjustment`. There is deliberately no
   * `settlement` kind — settled funds land on-chain under the user's own
   * address and are unrecoverable by the platform, so a withdrawal writes no
   * row at all (invariant #5) and simply never appears in this list.
   */
  kind: LedgerKind;

  /** The order this entry paid for. Set on `purchase` only; `null` otherwise. */
  orderId: string | null;

  /**
   * The on-chain transaction hash for `onramp` / `offramp`, `null` otherwise.
   * It is the only link from a ledger row back to the money that actually
   * moved — what makes "a top-up moves real test USDC" checkable rather than
   * asserted.
   */
  externalRef: string | null;

  /**
   * ISO 8601, via `Date.prototype.toISOString()`. A string rather than a `Date`
   * because this is the wire shape: serialising the entity's `Date` directly
   * would work today and would silently change the format the day anything
   * touches the serialiser.
   */
  createdAt: string;
}
