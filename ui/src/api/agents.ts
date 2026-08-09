import { apiGet } from './client';
import type { AgentListing, AgentSummary } from './types';

/**
 * The catalogue, `GET /agents` and `GET /agents/:id`.
 *
 * Both routes are public (api-design §3.3), so neither requires a session.
 * `client.ts` still attaches a credential when one happens to exist, which is
 * harmless — the backend simply learns who is browsing.
 */

/** Shape a list response might plausibly take. See `unwrapList`. */
type ListEnvelope = Record<string, unknown>;

/**
 * Accept either a bare array or a single-key envelope around one.
 *
 * This is the **only** shape tolerance in the API layer, and it is here rather
 * than in `client.ts` on purpose: it should not be reachable by accident from a
 * future endpoint.
 *
 * The reason it earns an exception is the shape of the failure. A wrong *field*
 * name renders as a blank price — visible, and someone fixes it. An envelope
 * read as an array renders as an empty array, which the marketplace faithfully
 * reports as "no agents are listed yet": a plausible, silent, wrong success, and
 * an empty stage in a demo with no error to point at. api-design §3.3 does not
 * say which shape `GET /agents` returns, and API-06 is not built yet.
 *
 * Do not generalise this. The asymmetry is the whole argument for it.
 */
function unwrapList<T>(payload: unknown): T[] {
  if (Array.isArray(payload)) {
    return payload as T[];
  }

  if (payload !== null && typeof payload === 'object') {
    const envelope = payload as ListEnvelope;
    for (const key of ['agents', 'items', 'data'] as const) {
      const inner = envelope[key];
      if (Array.isArray(inner)) {
        return inner as T[];
      }
    }
  }

  // Neither shape. Treat it as empty rather than throwing: the screen's empty
  // state is a better outcome than a white page, and the network tab still has
  // the truth for whoever is debugging it.
  return [];
}

export async function fetchAgents(): Promise<AgentSummary[]> {
  const payload = await apiGet<unknown>('/agents');
  return unwrapList<AgentSummary>(payload);
}

export function fetchAgent(id: string): Promise<AgentListing> {
  return apiGet<AgentListing>(`/agents/${encodeURIComponent(id)}`);
}
