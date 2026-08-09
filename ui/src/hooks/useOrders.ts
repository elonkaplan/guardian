import type { ApiError } from '../api/errors';
import { listOrders } from '../api/orders';
import type { BuyerOrderSummary } from '../api/types';
import { usePolling } from './usePolling';

/**
 * Every order this account has bought — the buyer's side of `useSales`, and the
 * one screen in this product that shows more than one trade at a time.
 *
 * **5s, which is what `docs/CONTEXT.md` §Updates reserved for it** before the
 * page existed: *"Order Detail 1s while live, stop on terminal state; Wallet and
 * My Orders 5s."* The 1s cadence belongs to a buyer watching one order resolve
 * in front of them; a list is glanced at, and polling it every second would put
 * sixty requests a minute behind a screen nobody is staring at.
 *
 * It polls rather than loading once for the reason `useSales` polls: a row here
 * changes state on its own — a purchase becomes a delivery, a delivery becomes a
 * release — and this list is where a buyer with several orders in flight finds
 * out which one now wants them. Load-only would mean they find out if they
 * happen to refresh.
 *
 * **No `isTerminal`, on `useSales`' and `useLedger`'s reasoning.** Individual
 * orders finish; the collection does not. A buyer can place another order from
 * the marketplace at any moment, so there is no state this list reaches where
 * asking again is pointless. Omitting the predicate is how `usePolling` spells
 * "poll until unmount", and note that the predicate could not be written anyway
 * without reaching inside the collection to ask whether every member had
 * finished — the shape `useSales` documents as the thing to withdraw.
 *
 * **No `isFatalError`, either.** `GET /orders` is scoped to the signed-in
 * account by the bearer token, and `/orders` renders inside `RequireAuth`, so
 * the failures that can reach this hook are transient ones in front of a
 * resource that will read cleanly again. There is no 404 to be had: an account
 * with no orders is a 200 and an empty array. Stopping the schedule on a blip
 * would freeze the list for the rest of the session, recoverable only by a
 * reload.
 *
 * **This hook is for the list page only.** A buyer opening one order goes
 * through `useOrder`, which reads `GET /orders/:id` at 1s with the monotonic
 * guard and the terminal stop. Selecting a row out of this list to stand in for
 * that read is the workaround `useSales` describes at length; it is wrong here
 * for the same reasons, plus one more — `BuyerOrderSummary` does not carry the
 * run, the criteria, or the review window, so a page built on it could not
 * render the output, the countdown, or either action.
 */

export interface OrdersView {
  /** The buyer's orders, once `GET /orders` has answered. `undefined` while the
   *  first read is in flight — which says something different from `[]`. */
  orders: BuyerOrderSummary[] | undefined;
  error: ApiError | null;
  loading: boolean;
  refetch: () => void;
}

export function useOrders(): OrdersView {
  const { data, error, refetch } = usePolling<BuyerOrderSummary[]>(['orders'], listOrders, {
    intervalMs: 5000,
  });

  return {
    orders: data,
    error: error ?? null,
    // Loading is the first read and nothing else — the rule `useSales`,
    // `useCaseFile` and `useOwnedAgents` all apply. An error is a finished
    // attempt, not an in-flight one, and the 5s refresh behind rows already on
    // screen must not put a spinner over them.
    loading: data === undefined && error === null,
    refetch,
  };
}
