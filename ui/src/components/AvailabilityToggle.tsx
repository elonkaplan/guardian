import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { JSX } from 'react';
import { useEffect, useRef } from 'react';

import { setAgentActive } from '../api/agents';
import { isConnectivityError } from '../api/errors';
import type { OwnedAgent } from '../api/types';

/**
 * One row's availability: the control that takes a seller's agent off the
 * market, or puts it back (FR-024).
 *
 * Four things here are load-bearing and none of them are visual.
 *
 * **Nothing is optimistic, and that is the central decision (research R8).**
 * The control renders `agent.active` — the server's answer, arriving through
 * the list this row belongs to — and holds no local copy of it anywhere. The
 * argument is specific to this screen rather than a general dislike of
 * optimistic updates: the seller's list polls every five seconds (R6), so a
 * poll landing between the click and the `PATCH` response would repaint the old
 * value underneath an optimistic switch and flip it back before the mutation
 * resolved. The seller would watch the switch move, revert, and move again for
 * a single click, and two of those three movements would be lies about a state
 * that never existed. FR-027 requires that a failure leave this control showing
 * the agent's *true* availability and never the attempted one; with no optimism
 * that is free, where an optimistic version would have to buy it back with a
 * rollback — the very mechanism the poll is racing. The switch simply does not
 * move until the answer arrives, which on a local API is under a second, and
 * everything it shows was true when the server said it.
 *
 * **Both agent lists are re-read, not just the seller's.** This control has an
 * off-screen effect: `['agents']` is the public marketplace, and US4's
 * acceptance is "switch it off, go to the marketplace, it is gone". Invalidating
 * only `['agents', 'mine']` would leave that promise resting on a cache entry
 * happening to expire at the right moment, which is the kind of thing that works
 * in rehearsal and fails on stage.
 *
 * **The guard is a `useRef`, written synchronously.** It cannot be `isPending`
 * or the `disabled` attribute, because both come from state and state does not
 * change until React re-renders — several activations dispatched within one
 * frame all read the same stale `false` and every one of them fires. A trackpad
 * double click or a held Enter key is exactly that. `OrderActions` measured it:
 * five synchronous activations sent five requests before its ref existed. The
 * stake here is smaller than the wallet's but real — two `PATCH`es racing to
 * opposite values land in an order nobody chose, and the on-chain
 * `setAgentActive` behind them costs gas twice for one intent (FR-026, R9).
 *
 * **A failure reports its reason and changes nothing else — no lock, no warning
 * against retrying.** This is deliberately *different* from the wallet's money
 * actions, and the difference must survive anyone later "fixing" it by copying
 * `WalletActions`. Those actions lock on silence because each commits a
 * movement — a credit, a debit, a transfer — and answers afterwards, so a second
 * attempt produces a second movement. `PATCH /agents/:id/active` sends an
 * absolute value (`SetAgentActiveRequest`), never an instruction to flip, so
 * applying it twice leaves the world exactly as applying it once did. It is
 * idempotent in the literal sense, not by good fortune — `src/api/agents.ts`
 * says so at the call site, and R9 re-derives it rather than inheriting it. So
 * pressing again is completely safe, and a silent failure resolves itself
 * within one five-second poll whether the seller touches anything or not
 * (FR-027).
 *
 * The mutation, the guard, and the failure notice are all per-row, because this
 * component is per-row. Toggling one agent leaves every other row's control
 * live and every other row's words alone, which is FR-028 obtained from the
 * component boundary rather than from a flag someone has to remember to scope.
 */

/**
 * Silence. No "do not try again", unlike every money action in this app — see
 * the fourth paragraph above, and say plainly why retrying is safe, so the
 * sentence teaches the rule rather than just softening it.
 */
const SILENCE_NOTICE =
  'We did not hear back, so we do not know whether this went through. This list re-reads every few seconds and will show the true setting on its own — and pressing again is safe, because this sends the setting you want rather than an instruction to flip it.';

/**
 * A refusal is the backend understanding us and saying no, and its own words are
 * the most useful thing we have. Silence is not a refusal and is never shown as
 * one.
 */
function failureNotice(error: Error | null): string | undefined {
  if (error === null) {
    return undefined;
  }
  return isConnectivityError(error) ? SILENCE_NOTICE : error.message;
}

export function AvailabilityToggle({ agent }: { agent: OwnedAgent }): JSX.Element {
  const queryClient = useQueryClient();

  /*
   * See the third paragraph above: written synchronously, so the second
   * activation in the same frame sees the first. One ref per row, unlike
   * `WalletActions`' single shared ref — there the three actions move the same
   * balance, here two rows are two different agents and blocking one because
   * the other is mid-flight would be the screen disturbing itself (FR-028).
   */
  const inFlight = useRef(false);

  const mutation = useMutation({
    /*
     * The value the seller was looking at when they pressed, negated — computed
     * at the click and passed in, rather than read from `agent` inside the
     * request. By the time this runs a poll may already have replaced the row's
     * data, and re-reading `agent.active` here would send the negation of a
     * value nobody ever saw.
     */
    mutationFn: (active: boolean) => setAgentActive(agent.id, active),

    /*
     * Settled, not success, following `OrderActions` and `WalletActions`.
     * Settled is the more useful of the two precisely in the failing case: after
     * silence, re-reading is how the row finds out what actually happened, which
     * is what makes the wait-and-see sentence above true rather than a hope.
     *
     * Both keys, per R8. Note that react-query matches invalidations by prefix,
     * so `['agents']` already covers `['agents', 'mine']` — the first call is
     * kept anyway, as the statement of intent that this control writes to two
     * lists, and so that re-rooting the owner's list under a different key
     * later removes the coverage from one visible line rather than silently.
     */
    onSettled: () => {
      inFlight.current = false;
      void queryClient.invalidateQueries({ queryKey: ['agents', 'mine'] });
      void queryClient.invalidateQueries({ queryKey: ['agents'] });
    },
  });

  useEffect(() => {
    /*
     * The agent's availability changing *is* the answer to whatever we asked, so
     * a notice about a request that has since been overtaken must not outlive
     * it: resetting the mutation drops the error, and the notice is derived from
     * it. This is `OrderActions`' reset effect with `order.state` swapped for
     * the one flag this control is about.
     *
     * It matters more here than there, because of the idempotence: a call that
     * failed on the way home still landed, and the poll five seconds later
     * brings back the state the seller asked for. Leaving a refusal sitting
     * under a switch that has since moved would be the screen contradicting
     * itself.
     */
    mutation.reset();
  }, [agent.active]);

  function handleToggle(): void {
    // The ref is the guard that actually holds; `isPending` is the slower belt
    // to its braces, covering a re-render that has already landed.
    if (mutation.isPending || inFlight.current) {
      return;
    }
    inFlight.current = true;
    mutation.mutate(!agent.active);
  }

  const listed = agent.active;

  /*
   * Words, not colour (and not a bare dot). This is read off a projector at the
   * back of a room and in greyscale screenshots, so the state has to survive
   * having its palette removed entirely. The action is spelled out beside the
   * state for the same reason a switch normally has a thumb: without it, a
   * control that says "On the market" could be read as a label rather than
   * something pressable.
   */
  const stateWord = listed ? 'On the market' : 'Not listed';
  const actionWord = listed ? 'Take it off' : 'Put it back on';

  const failure = failureNotice(mutation.error);

  return (
    <div className="availability">
      {/*
        A real `<button>` with `aria-pressed`, rather than `role="switch"` with
        `aria-checked`. Both are defensible and the difference is what each
        promises about what is on screen: `switch` describes a widget that draws
        its own state — a thumb moving inside a track beside a label that does
        not change — and this control owns no CSS (a separate task does) and
        shows its state as a word that *does* change. A toggle button is what is
        actually rendered, so it is what is announced. It also inherits the
        native button's keyboard behaviour, Space and Enter both, instead of us
        reimplementing it on a div for a role that would then describe the wrong
        thing.

        The accessible name carries the agent's name because several of these
        appear in one list, and "toggle button, pressed" with no subject tells a
        screen-reader user which state they are in but not which agent they are
        about to unlist. It opens with the visible state word so that what is
        read matches what is seen, following `ExplorerTxLink`.
      */}
      <button
        type="button"
        className="availability__button"
        aria-pressed={listed}
        aria-label={`${stateWord} — ${agent.name}`}
        // FR-026's second half: in flight, it is not operable again, and it
        // says so in the word where the action verb was.
        disabled={mutation.isPending}
        onClick={handleToggle}
      >
        <span className="availability__state">{stateWord}</span>{' '}
        <span className="availability__action">
          {mutation.isPending ? 'Working…' : actionWord}
        </span>
      </button>

      {/*
        Beside this control and nowhere else (FR-027, FR-028). The row keeps
        rendering the server's availability above it, so the reason and the true
        state are read together.
      */}
      {failure !== undefined ? (
        <p className="availability__error" role="alert">
          {failure}
        </p>
      ) : null}
    </div>
  );
}
