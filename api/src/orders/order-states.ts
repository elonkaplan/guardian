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
