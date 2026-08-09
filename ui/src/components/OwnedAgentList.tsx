import type { JSX } from 'react';
import { Link } from 'react-router-dom';

import type { ApiError } from '../api/errors';
import type { OwnedAgent } from '../api/types';
import { formatUsd } from '../lib/money';
import { paths } from '../routes/paths';
import { AvailabilityToggle } from './AvailabilityToggle';
import { LoadState } from './LoadState';

interface OwnedAgentListProps {
  /** `GET /agents?owner=me`, once it has answered. `undefined` while the first
   *  read is still in flight — see `LoadState`'s note on why that is not the
   *  same thing as an empty array. */
  agents: OwnedAgent[] | undefined;
  /** The last fetch failure, if the fetch failed. `null` otherwise. */
  error: ApiError | null;
  /** True only while a read is in flight with nothing to show behind it. */
  loading: boolean;
  /** Refetch this list, and only this list. Wired to the error state's retry
   *  button — a failed read of the seller's agents has no business reloading
   *  the page or disturbing the sales list beside it. */
  onRetry(): void;
}

/**
 * Everything this account has listed, whether or not buyers can see it
 * (User Story 2, FR-002, FR-003, FR-007, FR-010).
 *
 * **Inactive agents are listed alongside active ones and are never filtered
 * out.** This is FR-003 and it is the one rule in this file that cannot be
 * traded away for a tidier list. The availability control lives in this row
 * and nowhere else, so a list that hid inactive agents would make that control
 * one-way: switching an agent off would remove it from the only screen capable
 * of switching it back on, and the seller's only recovery would be to create a
 * second listing. `api-design` §3.3 puts inactive rows in this endpoint's
 * response for exactly that reason, and `OwnedAgent`'s own doc comment repeats
 * it — dropping them here would throw away a guarantee the wire format was
 * shaped to provide.
 *
 * The distinction is carried by a **word**, not by colour. This screen is
 * demonstrated on a projector and screenshotted into decks that end up
 * greyscale, and a colour-blind reader is an ordinary viewer rather than an
 * edge case; a row tinted grey and a row tinted white are the same row under
 * all three conditions. The same argument `LedgerTable` makes for its
 * credit/debit word applies here without change. The `--inactive` modifier
 * below exists so the stylesheet can reinforce that, but nothing about whether
 * an agent is on sale is allowed to depend on what the stylesheet does with it.
 *
 * The word itself comes from `AvailabilityToggle`, which already prints "On the
 * market" or "Not listed" beside its action, and this row deliberately does not
 * print a second one. Two words for one fact in one row is how a screen ends up
 * saying "Available / Not listed" and making a seller wonder which of the two
 * they are reading — the same reason `stateLabel` is the single vocabulary for
 * order states. FR-002's third column is that control, satisfied by what it
 * says rather than by a label repeating it.
 *
 * **This section owns its empty and error branches** rather than letting the
 * page own them (FR-007). Two independent reads back this screen, and the
 * seller's sales are the half that matters during a dispute — a 500 on the
 * agent list must not be able to blank the sales beside it. Handling the
 * failure here is what makes that structural instead of a promise the page
 * remembers to keep.
 *
 * Rows are keyed by `agent.id`, never by array index: this screen polls at 5s,
 * and an index key would make React treat a newly created listing at the top
 * as a mutation of every row beneath it — remounting the availability control
 * a seller may be mid-click on. The id is the one thing a poll cannot change.
 */
export function OwnedAgentList({ agents, error, loading, onRetry }: OwnedAgentListProps): JSX.Element {
  return (
    // `aria-busy` marks the first read only. Once rows exist this section is
    // never busy again as far as a reader is concerned — the 5s poll refreshes
    // underneath them and must not announce itself, which is the same reason
    // FR-006 forbids reverting the list to a placeholder between reads.
    <section className="owned-agents" aria-label="Your agents" aria-busy={loading}>
      <h2 className="owned-agents__heading">Your agents</h2>
      {renderBody(agents, error, onRetry)}
    </section>
  );
}

function renderBody(
  agents: OwnedAgent[] | undefined,
  error: ApiError | null,
  onRetry: () => void,
): JSX.Element {
  // No result yet at all. Which placeholder this is comes down to `error` and
  // not to whether a request happens to be in flight: the poll behind a failed
  // first read fires again every five seconds, and letting that flip the panel
  // back to "Loading…" would take the retry button away twice a minute from
  // the one person trying to press it. Once `agents` exists, even as an empty
  // array, a later error is a failed refresh rather than grounds for blanking
  // a list the seller can already read.
  if (agents === undefined) {
    if (error !== null) {
      return (
        <LoadState
          status="error"
          message="Your agents could not be loaded."
          onRetry={onRetry}
        />
      );
    }
    return <LoadState status="loading" message="Loading your agents…" />;
  }

  if (agents.length === 0) {
    return (
      // No retry button: an account that has never listed anything is the
      // system working, not a request that failed. But an empty state that
      // only reports emptiness leaves the reader nowhere to go, so the one
      // action that resolves it sits inside the state itself. The page carries
      // the same link for FR-008; this one does not replace it, it just means
      // the sentence naming the problem and the way out of it are the same
      // piece of screen.
      <div className="owned-agents__empty">
        <LoadState status="empty" message="You have not listed an agent yet." />
        <Link className="owned-agents__empty-link" to={paths.createAgent()}>
          List an agent
        </Link>
      </div>
    );
  }

  return (
    // The scroll region, and nothing above it. A seller with twenty listings
    // must not push the sales section off the screen (FR-010) — the stylesheet
    // makes this box scroll, this element is just where the scrolling is
    // allowed to happen.
    <div className="owned-agents__scroll">
      <ul className="owned-agents__list">
        {agents.map((agent) => (
          <OwnedAgentRow key={agent.id} agent={agent} />
        ))}
      </ul>
    </div>
  );
}

function OwnedAgentRow({ agent }: { agent: OwnedAgent }): JSX.Element {
  return (
    <li
      className={`owned-agents__row${agent.active ? '' : ' owned-agents__row--inactive'}${
        agent.listed ? '' : ' owned-agents__row--unregistered'
      }`}
    >
      <span className="owned-agents__name">{agent.name}</span>
      {/* The second fact this row has to carry, and the one nothing else on the
          screen would say. `listed: false` means the on-chain registration never
          landed, so no buyer can see or purchase this agent — while the
          availability control beside it may cheerfully read "On the market".
          That pair is the whole hazard: a seller advertising something nobody
          can buy, with no way to find out (UI-08 R-03).

          A word, for the same reason the availability state is a word: this
          screen is demonstrated on a projector and screenshotted into decks that
          end up greyscale, so a row tinted differently is not a row that says
          anything. The `--unregistered` modifier exists so the stylesheet can
          reinforce it and is never the thing carrying the meaning.

          Rendered only when false. An agent that registered correctly is the
          ordinary case and does not need a badge announcing that nothing is
          wrong — a marker on every row is a marker nobody reads. */}
      {agent.listed ? null : (
        <span className="owned-agents__unregistered" title="On-chain registration did not complete, so this agent is not visible to buyers.">
          Not registered — buyers cannot see this
        </span>
      )}
      {/* Through `formatUsd` like every other amount in the app: `priceMinor`
          is integer cents, and cents printed raw read as a hundredfold
          overcharge. */}
      <span className="owned-agents__price">{formatUsd(agent.priceMinor)}</span>
      {/* Availability, as a control rather than a label — and given the whole
          agent rather than an id and a flag, because it owns the request and
          the in-flight state for its own row. A change that fails fails beside
          the agent it was about and leaves every other row undisturbed
          (FR-027, FR-028). */}
      <span className="owned-agents__availability">
        <AvailabilityToggle agent={agent} />
      </span>
    </li>
  );
}
