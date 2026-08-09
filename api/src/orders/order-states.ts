import { OrderState } from '../entities/enums';

/**
 * The order states in which a buyer's money is still sitting in the escrow
 * contract — the exact set `inEscrowMinor` sums over.
 *
 * **Six states, not eight.** The question this set answers is *"how much of
 * this buyer's money is locked in escrow right now"*, so the boundary is the
 * on-chain settlement, not the product's sense of doneness. `released` and
 * `settled` are the two exclusions: in both, the tokens have already been paid
 * out to `balances[]` on-chain, where they are counted by `settledFundsMinor`
 * instead. Counting them here would show the same cents twice.
 *
 * Two of the six look wrong at a glance and are not:
 *
 * **`failed` looks terminal and is not.** Nothing was produced, but nothing was
 * reclaimed either — the money sits in escrow until the reclaimer sweeps it.
 * Dropping it from this list makes a buyer's money vanish from *every* figure
 * at once: it has already left `availableBalanceMinor` (the `purchase` debit is
 * written), it is not on-chain under their address, and it would no longer be
 * in escrow. Three numbers, none of them containing the money.
 *
 * ⚠️ **…but `failed` now means two things, and only one of them belongs in an
 * escrow figure.** The paragraph above describes a *run* that produced nothing:
 * the deal was opened, the tokens are escrowed, `onchain_deal_id` is set. API-07
 * added a second: an `openDeal` the chain refused, which escrowed nothing, left
 * `onchain_deal_id` NULL, and has **already** put the money back through a
 * compensating `adjustment` entry.
 *
 * Counting that second one would show a buyer the same cents twice — restored to
 * `availableBalanceMinor` and still sitting in `inEscrowMinor`. So the state
 * list here is unchanged and correct, and the exclusion lives in the query as
 * `NOT (state = 'failed' AND onchain_deal_id IS NULL)`. Read
 * `escrow-exposure.repository.ts` before touching either — that predicate is
 * deliberately narrower than the `AND onchain_deal_id IS NOT NULL` its warning
 * forbids, and the difference is a mid-saga order whose money must keep
 * counting. (`specs/007-orders-purchase-saga/research.md` R14)
 *
 * **`adjudicated` is the invariant #8 window.** `docs/CONTEXT.md` invariant #8
 * persists the verdict row *before* the chain `resolve` call, precisely so the
 * demo is replayable. For the width of that window the order is `adjudicated`
 * and the tokens are still escrowed. Treating the verdict as the moment money
 * moved would be believing our own database about the chain's state.
 *
 * ⚠️ Adding a member here is a change to what `GET /me` reports as escrowed. Do
 * it by walking the state machine in `src/entities/enums.ts` against research
 * R3's table, not by intuition about which words sound final.
 *
 * (research R3)
 */
export const ESCROWED_ORDER_STATES = [
  OrderState.Purchased,
  OrderState.Running,
  OrderState.Delivered,
  OrderState.Failed,
  OrderState.Disputed,
  OrderState.Adjudicated,
] as const;
