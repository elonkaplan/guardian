import type { ApiError } from '../api/errors';
import { fetchSales } from '../api/sales';
import type { Sale } from '../api/types';
import { usePolling } from './usePolling';

/**
 * The orders placed against this account's agents — and the only thing in this
 * product that tells a seller a complaint has been filed.
 *
 * **This is why it polls (research R6).** `docs/ui-design.md` §5 gives the
 * seller's home "Load only", and this feature departs from that table knowingly.
 * There is no email here, no push, no bell in the header, no notification model
 * at all; a seller learns that a buyer has disputed a delivery because a row in
 * this list changes state. `docs/product-workflow.md` §7.5 — *"the seller is
 * notified, but has no right of reply"* — is a statement this hook is
 * responsible for making true, and it is only true while something re-reads the
 * endpoint on its own. Load-only would mean the seller is notified if they
 * happen to refresh, which is not notification; it would leave §7.5's no-appeal
 * half looking like a black box rather than the scope decision it is. Five
 * seconds matches the My Orders cadence, which is the buyer's side of the same
 * question.
 *
 * **No `isTerminal`, on `useLedger`'s reasoning.** Individual sales finish; the
 * list does not. A new order can land against any owned agent at any moment, so
 * there is no state this collection reaches where asking again is pointless.
 * Omitting the predicate is exactly how `usePolling` spells "poll until
 * unmount".
 *
 * **No `isFatalError`, either.** `GET /sales` is scoped to the signed-in
 * account, and `/sell` renders inside `RequireAuth`, so the only failures that
 * can reach this hook are transient ones in front of a resource that will read
 * cleanly again. Stopping the schedule on one would silently end the seller's
 * only notification channel for the rest of the session, recoverable only by a
 * page reload — a far worse outcome than a stale read that resolves itself five
 * seconds later.
 *
 * ---
 *
 * **There is deliberately no `useSale(id)` here, and adding one would be a
 * regression (research R7).**
 *
 * An earlier version of this plan had exactly that: the seller's dispute screen
 * polling this whole list every five seconds and selecting the one matching row
 * out of it, because `GET /orders/:id` was assumed to be the buyer's read alone
 * and the list looked like the seller's only route to an order. api-design §3.4
 * now authorises that endpoint for the buyer *or* the agent's owner, which makes
 * the order the seller's own resource rather than something to be reconstructed
 * from a collection. `SellerSalePage` therefore calls the existing `useOrder`,
 * and inherits four behaviours a list poll could not have had:
 *
 * - 1s while the order is live, stopping the moment it is terminal, instead of
 *   5s inherited from a list that never stops;
 * - 404 and 403 as a fatal dead end, instead of "the list came back and this id
 *   was not in it" — a mistyped or someone else's id becomes an answer rather
 *   than a request every interval for as long as the tab is open;
 * - the monotonic guard, which matters most on precisely this screen, the one
 *   where a ruling appears while somebody is watching;
 * - `stale` versus a hard failure, so a blip leaves the verdict on screen with a
 *   quiet notice instead of blanking it.
 *
 * A terminal predicate that has to reach *inside* a collection to ask whether
 * one member has finished is the shape of the thing that was withdrawn. If a
 * singular hook ever reappears in this file, it is not a new idea — it is a
 * revival of the workaround that api-design §3.4 made unnecessary, and the
 * dispute screen should be pointed back at `useOrder` instead.
 *
 * This hook is for the **list page only**.
 */

export interface SalesView {
  sales: Sale[] | undefined;
  error: ApiError | null;
  loading: boolean;
  refetch: () => void;
}

export function useSales(): SalesView {
  const { data, error, refetch } = usePolling<Sale[]>(['sales'], fetchSales, {
    intervalMs: 5000,
  });

  return {
    sales: data,
    error: error ?? null,
    // The same rule `useCaseFile` applies, and the same rule `useOwnedAgents`
    // applies beside it: loading is the first read and nothing else. An error is
    // a finished attempt, and a refresh behind existing rows is not something to
    // put a spinner over — these two sections sit on one screen and must not
    // flicker out of step with each other.
    loading: data === undefined && error === null,
    refetch,
  };
}
