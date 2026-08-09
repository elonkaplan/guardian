/**
 * `POST /withdraw` — **there is no request schema in this file, and that is the
 * contract, not an omission.**
 *
 * The escrow exposes `withdrawFor(account)`, which pays out that account's
 * *entire* settled balance (`docs/smart-contract.md` §4.5). There is no amount
 * parameter on the chain call, so there is no partial withdrawal to expose over
 * HTTP — an `amountMinor` field here would be a number the API accepts, echoes
 * back, and then ignores, which is worse than not offering it: the first person
 * to send `{ amountMinor: 500 }` against a $50 balance would receive $50 and a
 * receipt they had every reason to read as a partial payout.
 * `specs/005-accounts-ledger-funding/contracts/internal-api.md` §4 states it
 * plainly: *"no body"*.
 *
 * ⚠️ **The destination is not in the request either**, and that absence is a
 * security control rather than a simplification. The payout goes to
 * `account.walletAddress` from the session; a caller-supplied address would let
 * anyone redirect anyone else's settled funds by sending one field.
 */

/**
 * `POST /withdraw` `200` response.
 *
 * ⚠️ **`txHash` is a product requirement, not debug output.**
 * `ui/specs/006-wallet-page/contracts/internal-api.md` handoff item 6 asks for
 * it explicitly, because it is the one part of the wallet screen a sceptic can
 * verify: every other number on that page is this backend's word for it, while
 * a transaction hash can be pasted into a block explorer by someone who trusts
 * nothing we say. Dropping it to tidy the payload removes the only independently
 * checkable fact the screen has.
 *
 * The response deliberately is **not** an `AccountSummaryResponse`, unlike
 * `/topup` and `/offramp`. Those two move the platform balance, so the widget
 * needs the updated figures; a withdrawal moves settled on-chain funds and
 * changes no ledger row at all (invariant #5, FR-022) — the statement is
 * identical before and after. What the caller needs back is proof of the
 * transaction, and the UI refetches `GET /me` for the new `settledFundsMinor`.
 */
export interface WithdrawResponse {
  /** `0x`-prefixed transaction hash of the confirmed `withdrawFor` call. */
  txHash: string;

  /**
   * Cents moved, taken from the pre-read that gated the call.
   *
   * ⚠️ Read *before* the transaction, so it can be a moment stale — a
   * settlement landing in between makes the real payout larger than this
   * number. Harmless, and not worth a second read to fix: `withdrawFor` moves
   * whatever the balance is at execution time, so the money is right even when
   * the receipt's figure is a moment old (research R9).
   */
  amountMinor: number;

  /** Public explorer link for `txHash`, from `EscrowReadService.explorerTxUrl`. */
  explorerUrl: string;
}
