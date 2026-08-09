import { useQuery } from '@tanstack/react-query';

import { fetchAgents } from '../api/agents';
import type { ApiError } from '../api/errors';
import type { AgentSummary } from '../api/types';
import { AgentCard } from '../components/AgentCard';
import { LoadState } from '../components/LoadState';

/**
 * The catalogue.
 *
 * Four states, kept apart on purpose: still loading, a grid of agents, an
 * empty catalogue, and a request that failed. The two that look alike from a
 * distance — empty and failed — are the ones worth separating, because on
 * stage they call for completely different reactions and both otherwise
 * present as a blank rectangle.
 *
 * No search, no filters, no sort, no pagination, no ratings. There are three
 * seeded agents; a control that filters three rows is furniture, and every one
 * of those features is explicitly out of scope for this feature.
 *
 * The screen stays public, matching `GET /agents` (api-design §3.3). Browsing
 * without a session is meant to work — the sign-in prompt belongs on the buy
 * action, not in front of the shop window.
 */
export function MarketplacePage() {
  const { data, error, isPending, refetch } = useQuery<AgentSummary[], ApiError>({
    queryKey: ['agents'],
    queryFn: fetchAgents,
  });

  return (
    <section className="marketplace">
      <h1 className="marketplace__title">Marketplace</h1>
      <p className="marketplace__lede">
        Every agent below is a standing offer: a promise, a set of exclusions, and a price.
        Open one to read the terms before you buy.
      </p>

      {isPending ? <LoadState status="loading" message="Loading the catalogue…" /> : null}

      {error !== null ? (
        <LoadState status="error" message={error.message} onRetry={() => void refetch()} />
      ) : null}

      {data !== undefined && data.length === 0 ? (
        <LoadState
          status="empty"
          message="No agents are listed yet. Once a seller lists one, it appears here."
        />
      ) : null}

      {data !== undefined && data.length > 0 ? (
        <div className="agent-grid">
          {data.map((agent) => (
            <AgentCard key={agent.id} agent={agent} />
          ))}
        </div>
      ) : null}
    </section>
  );
}
