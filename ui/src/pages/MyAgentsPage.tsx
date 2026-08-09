import { Link } from 'react-router-dom';

import { OwnedAgentList } from '../components/OwnedAgentList';
import { SalesList } from '../components/SalesList';
import { useOwnedAgents } from '../hooks/useOwnedAgents';
import { useSales } from '../hooks/useSales';
import { paths } from '../routes/paths';

/**
 * The seller's home: what you have listed, and what it has sold.
 *
 * Two sections, and they are not the same kind of thing. The first is an
 * inventory the seller controls; the second is a record of what happened to it,
 * and it is also — because this product has no email, no push, and no bell in
 * the header — **the only place a seller is ever told that a complaint has been
 * filed against them.** `docs/product-workflow.md` §7.5 is titled "the seller is
 * notified, but has no right of reply", and the notification half of that
 * sentence is a row in the second list changing state. That is why both hooks
 * poll rather than loading once (research R6), and it is the argument to reach
 * for if anyone proposes making this screen load-only to match
 * `docs/ui-design.md` §5.
 *
 * **Two queries, not one.** Each section owns its own read, its own empty state,
 * and its own failure. This is FR-007 and it is structural rather than
 * defensive: a seller whose sales endpoint is briefly down should still be able
 * to see and manage their listings, and a page-level error boundary over both
 * would take the working half down with the broken one. Nothing here composes a
 * combined loading state for the same reason.
 *
 * The page owns no data and no state. Both lists are handed everything they
 * render, which is what lets either of them be looked at in isolation.
 */
export function MyAgentsPage() {
  const agents = useOwnedAgents();
  const sales = useSales();

  return (
    <section className="sell">
      <header className="sell__header">
        <div className="sell__intro">
          <h1 className="sell__title">Selling</h1>
          <p className="sell__lede">
            Your listings and what they have sold. A sale that has gone to arbitration says
            so here — this page is where you find out.
          </p>
        </div>

        {/*
          Above both lists rather than beneath them (FR-008). A seller with no
          agents needs it first, and a seller with forty should not have to
          scroll a table to reach it.
        */}
        <Link className="sell__new" to={paths.createAgent()}>
          List an agent
        </Link>
      </header>

      <OwnedAgentList
        agents={agents.agents}
        error={agents.error}
        loading={agents.loading}
        onRetry={agents.refetch}
      />

      <SalesList
        sales={sales.sales}
        error={sales.error}
        loading={sales.loading}
        onRetry={sales.refetch}
      />
    </section>
  );
}
