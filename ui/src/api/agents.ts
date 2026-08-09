import { unwrapList } from '../lib/listEnvelope';
import { apiGet, apiPatch, apiPost } from './client';
import type {
  AgentListing,
  AgentSummary,
  CreateAgentRequest,
  OwnedAgent,
  SetAgentActiveRequest,
} from './types';

/**
 * The catalogue: what a buyer browses, and what a seller owns.
 *
 * `GET /agents` and `GET /agents/:id` are public (api-design §3.3), so neither
 * requires a session. `client.ts` still attaches a credential when one happens
 * to exist, which is harmless — the backend simply learns who is browsing. The
 * three below are the owner's, and all three need one.
 *
 * ---
 *
 * **`POST /agents` is not idempotent, and this is the paragraph that says so.**
 *
 * It inserts an agent, inserts version 1, canonicalises and hashes the
 * definition, and calls `registerAgent` on-chain **awaiting the receipt**
 * (API-06) before it answers. A client timeout — ours fires at 10 seconds, and
 * a chain write can outlast that on a bad day — therefore tells us nothing
 * about whether the listing exists. Retrying on no-answer is how a marketplace
 * of four agents acquires two identical ones and pays gas twice for a single
 * intent.
 *
 * So: never retry this call automatically. Not through react-query's `retry`
 * (already `false` app-wide, and it must stay that way for this call), not
 * through a helpful "try again" button on a timeout, not through a resubmit on
 * a back navigation. A refusal — a 4xx, where the backend understood us and
 * definitively created nothing — is the opposite case and is safe to correct
 * and submit again.
 *
 * If API-06 ever accepts a client-supplied idempotency key, this paragraph and
 * the ambiguous branch in `CreateAgentPage` can both be deleted.
 *
 * ---
 *
 * **That rule stops at `setAgentActive`, and stopping is the point.**
 *
 * `api/orders.ts` warns in writing against copying its non-idempotency rule
 * onto neighbouring calls without re-deriving it, and `api/wallet.ts`
 * re-derived it once already. Re-deriving it here:
 *
 * Those rules exist because each of those calls commits a *movement* — a new
 * row, a credit, a debit, a transfer — and answers afterwards, so a duplicate
 * request produces a duplicate movement. `PATCH /agents/:id/active` sets a
 * boolean to an absolute value supplied by the client (`SetAgentActiveRequest`).
 * Applying it twice leaves the world exactly as applying it once did. That is
 * idempotence in the literal sense, not by good fortune.
 *
 * So a silent failure here needs no locked control, no ambiguous branch, and no
 * warning against trying again: the seller's list re-reads every five seconds,
 * and whatever the server actually thinks is on screen within one cycle. The
 * in-flight guard in `AvailabilityToggle` stays for a different and smaller
 * reason — two `PATCH`es racing to opposite values would land in an order
 * nobody chose, and the on-chain `setAgentActive` behind them costs gas twice.
 */

export async function fetchAgents(): Promise<AgentSummary[]> {
  const payload = await apiGet<unknown>('/agents');
  return unwrapList<AgentSummary>(payload, ['agents', 'items', 'data']);
}

export function fetchAgent(id: string): Promise<AgentListing> {
  return apiGet<AgentListing>(`/agents/${encodeURIComponent(id)}`);
}

/**
 * `GET /agents?owner=me` (api-design §3.3) — the seller's own listings,
 * **including the ones that are not currently on the market**.
 *
 * That inclusion is the endpoint's whole reason for being a separate row in the
 * API design rather than a filter on the public list, and it is worth stating
 * at the call site too: if this ever starts returning active agents only, an
 * agent switched off vanishes from the one screen that could switch it back on.
 * Quickstart D8 is the check.
 */
export async function fetchOwnedAgents(): Promise<OwnedAgent[]> {
  const payload = await apiGet<unknown>('/agents?owner=me');
  return unwrapList<OwnedAgent>(payload, ['agents', 'items', 'data']);
}

/**
 * `POST /agents` — a seller lists an agent. See the non-idempotency paragraph
 * above; this is the call it is about.
 *
 * Typed `apiPost<unknown>` and awaited rather than returned, following
 * `acceptOrder`'s precedent: there is a body on the wire and we are choosing
 * not to read it. The seller's list is re-read on arrival and is the authority
 * on what now exists, so modelling a response here would be asserting a shape
 * for an endpoint that is not built yet — and the created agent's execution
 * spec would then have somewhere to live in this app's memory, which is exactly
 * what `CreateAgentRequest`'s one-way trip is designed to prevent.
 */
export async function createAgent(request: CreateAgentRequest): Promise<void> {
  await apiPost<unknown>('/agents', request);
}

/**
 * `PATCH /agents/:id/active` — the seller takes a listing off the market, or
 * puts it back.
 *
 * The `active` parameter is a plain boolean rather than a `SetAgentActiveRequest`,
 * because the caller is a switch and should not have to know the wire shape to
 * flip it. The type is still applied to the body here, so a renamed field is a
 * compile error in this file rather than a request the backend rejects at
 * runtime.
 *
 * Response discarded: the list refetch that follows is the authority on the new
 * state, which is also why the control renders no optimistic value (research
 * R8).
 */
export async function setAgentActive(id: string, active: boolean): Promise<void> {
  const body: SetAgentActiveRequest = { active };
  await apiPatch<unknown>(`/agents/${encodeURIComponent(id)}/active`, body);
}
