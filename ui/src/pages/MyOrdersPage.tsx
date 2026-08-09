import { Link } from 'react-router-dom';

import { OrderList } from '../components/OrderList';
import { useOrders } from '../hooks/useOrders';
import { paths } from '../routes/paths';

/**
 * The buyer's home: everything you have bought, and which of it wants you.
 *
 * **This page was a placeholder for most of the project's life, and that was a
 * deliberate scope call, not an oversight.** UI-01 stubbed it with
 * `filledBy="UI-04"` as a guess before UI-04 was written; UI-04 then scoped
 * itself to one order's state machine and never mentioned a list, and UI-08's
 * reconciliation recorded the result as R-07 — `GET /orders` defined by the
 * contract with no frontend caller, closed as out of scope because all three
 * demo acts run on the order detail screen. Building it now closes that orphan;
 * `docs/reconciliation-note.md` and `docs/manual-test-plan.md` §2.5 were both
 * updated in the same change, because a note that still calls this a placeholder
 * is worse than no note.
 *
 * **One read, so one failure**, which is the opposite of `MyAgentsPage` next
 * door. That page splits its error handling across two sections because two
 * independent endpoints back it and either must survive the other going down.
 * Here there is a single `GET /orders`, so a second layer of failure handling
 * would be ceremony around a branch that can only ever fire in one place. The
 * list owns it, for the same structural reason the seller's sections own theirs.
 *
 * The page owns no data and no state. `OrderList` is handed everything it
 * renders, which is what lets it be looked at in isolation.
 *
 * Guarded by `RequireAuth` in `AppRoutes` — the bearer token *is* the filter on
 * this endpoint, so there is no unauthenticated version of this screen to show.
 */
export function MyOrdersPage() {
  const orders = useOrders();

  return (
    <section className="my-orders">
      <header className="my-orders__header">
        <div className="my-orders__intro">
          <h1 className="my-orders__title">My Orders</h1>
          <p className="my-orders__lede">
            Everything you have bought, newest first. An order waiting on you says so —
            open it to read what came back and to accept or dispute it.
          </p>
        </div>

        {/*
          Above the list rather than beneath it, on `MyAgentsPage`'s reasoning: a
          buyer with no orders needs this first, and a buyer with forty should
          not have to scroll a list to reach it.
        */}
        <Link className="my-orders__browse" to={paths.marketplace()}>
          Browse agents
        </Link>
      </header>

      <OrderList
        orders={orders.orders}
        error={orders.error}
        loading={orders.loading}
        onRetry={orders.refetch}
      />
    </section>
  );
}
