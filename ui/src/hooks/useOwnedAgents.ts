import type { ApiError } from '../api/errors';
import { fetchOwnedAgents } from '../api/agents';
import type { OwnedAgent } from '../api/types';
import { usePolling } from './usePolling';

/**
 * The seller's own listings, re-read every five seconds for as long as the
 * screen is open.
 *
 * **Five seconds is a deliberate departure from `docs/ui-design.md` §5, and
 * this paragraph is the argument for it (research R6).** That table assigns
 * "Load only" to every screen except Order Detail, Wallet, and My Orders, which
 * would make this list a snapshot taken once when the page mounted. The reason
 * the seller's home departs from it is the list *beside* this one. There is no
 * email in this product, no push, no bell in the header — no notification model
 * of any kind. The sales list is the entire mechanism by which a seller finds
 * out that a complaint has been filed against them: a row changes state, and
 * that is the notice. `docs/product-workflow.md` §7.5 is titled *"the seller is
 * notified, but has no right of reply"*, and the no-appeal half only reads as a
 * deliberate scope decision rather than a black box because the notified half is
 * true. A load-only list means the seller is notified *if they think to
 * refresh*, which is not notification — it is the product asking the user to do
 * the polling on its behalf, and it would quietly make §7.5 false.
 *
 * This hook polls for the same reason even though it is the agents list rather
 * than the sales list. Polling one section of a screen and freezing the other
 * would be an arbitrary asymmetry the reader has to discover, and the agents
 * list has its own claim to freshness: availability is a per-agent boolean that
 * a second tab — or the seller's own `PATCH` a moment ago — can move underneath
 * this one. `AvailabilityToggle` renders nothing optimistic (research R8) and
 * leans on exactly this schedule to show the server's real answer within a
 * cycle. The cost of the pair is two requests every five seconds while one
 * supporting screen is open, and that screen is not on stage during any of the
 * three demo acts.
 *
 * **No `isTerminal`, on the same reasoning as `useLedger`.** A collection of
 * listings has no finishing state. An agent can be created, switched off,
 * switched back on, and nothing about the list ever reaches a point where asking
 * again is pointless. Omitting the predicate is how `usePolling` spells "poll
 * until unmount", so its absence here is the behaviour being chosen rather than
 * an oversight.
 *
 * **No `isFatalError`, likewise.** `GET /agents?owner=me` either belongs to the
 * signed-in account or the caller is not signed in at all, and the second case
 * cannot reach here — `/sell` renders inside `RequireAuth`, so the page never
 * mounts without a session and a sign-out navigates away rather than leaving a
 * live query behind. Every failure that can actually occur is therefore a blip
 * in front of a resource that will read cleanly again, and treating one as
 * permanent would strand the seller on a dead list whose only recovery is a page
 * reload.
 *
 * The query key is `['agents', 'mine']`, distinct from the public catalogue's
 * `['agents']` because the payloads differ: this one includes agents that are
 * switched off, and that inclusion is the endpoint's whole reason for existing
 * (see `fetchOwnedAgents`). Both keys are invalidated together after an
 * availability change, since a listing leaving the market has to disappear from
 * the buyer's marketplace too.
 */

export interface OwnedAgentsView {
  agents: OwnedAgent[] | undefined;
  error: ApiError | null;
  loading: boolean;
  refetch: () => void;
}

export function useOwnedAgents(): OwnedAgentsView {
  const { data, error, refetch } = usePolling<OwnedAgent[]>(['agents', 'mine'], fetchOwnedAgents, {
    intervalMs: 5000,
  });

  return {
    agents: data,
    error: error ?? null,
    // Only the in-flight first read, matching `useCaseFile`: an error is a
    // finished attempt rather than a pending one, and once any data has arrived
    // the poll is refreshing something already on screen. Reporting either as
    // loading would put a spinner over a list the seller can read, every five
    // seconds, forever.
    loading: data === undefined && error === null,
    refetch,
  };
}
