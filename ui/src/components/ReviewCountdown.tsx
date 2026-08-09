import type { JSX } from 'react';

import { formatRemaining } from '../lib/duration';

interface ReviewCountdownProps {
  /**
   * Milliseconds left in the review window, recomputed by `useCountdown` on every
   * tick from the server-anchored clock — never decremented from a stored value,
   * so a slept laptop or a backgrounded tab cannot hand this component a figure
   * that kept running while nothing was watching (FR-018).
   *
   * Negative values are tolerated rather than trusted: `formatRemaining` clamps at
   * zero, so a tick that lands a hair past the deadline reads `0s` and never `-1s`
   * (FR-019).
   */
  remainingMs: number;
  /**
   * Whether the window has **closed**. It is never "there is no window" — an order
   * with no delivery has nothing for a window to run from, and the page answers
   * that by not rendering this component at all (FR-005). So there are exactly two
   * wordings here, and `expired` picks between them.
   *
   * True covers both ways a buyer arrives at a closed window: the clock ran out
   * while they watched, and the page was opened after it had already elapsed
   * (FR-020). Both say the same thing, because they are the same fact.
   */
  expired: boolean;
}

/**
 * The review window's clock — the one number the room is watching.
 *
 * This component is four elements and carries more of the product's argument than
 * anything else its size. Guardian's claim is that the escrow is genuinely
 * time-locked, and the only evidence a person in the room can check is this clock:
 * it runs down, it reaches zero, and then — with nobody touching the keyboard —
 * the page says the seller has been paid (docs/ui-design.md §2.1). That unattended
 * flip is the ending of Act 1. Told instead of shown, the escrow is indistinguishable
 * from a database column somebody could edit.
 *
 * Which is why the failure modes here are not cosmetic. A number that freezes on a
 * stale value looks like the page stopped following the order. A negative number
 * says the deadline is a display artefact rather than something enforced. A number
 * that drifts from the backend's own reckoning invites the exact question the demo
 * cannot afford — "so the release is just a timer in the browser?" Each of those
 * would undercut the claim the whole product is making, on the screen that makes it.
 *
 * The defences live on either side of this component. Never-negative and
 * never-drifting are `formatRemaining`'s clamp and `useCountdown`'s recompute; what
 * is left here is never-frozen, and it is handled by having no third rendering.
 * When the window closes the clock reads `0s` and the copy changes — this component
 * cannot keep the last number on screen because it does not keep a number.
 *
 * The expired wording is what the buyer reads during the seconds between zero and
 * the sweeper's release landing. It says the window has closed and the release is
 * being processed, deliberately in the present continuous: the page is not claiming
 * a release that has not been recorded (FR-019). It is also not an error, an empty
 * state, or a spinner — the outcome is settled, only the confirmation is in flight.
 *
 * Purely presentational. No timer, no clock read, no state. Everything time-shaped
 * arrives as props, which is what keeps the single ticking interval in `useCountdown`
 * where the boundary greps expect to find it.
 */
export function ReviewCountdown({ remainingMs, expired }: ReviewCountdownProps): JSX.Element {
  // Zero comes through the same formatter as every other value rather than as a
  // literal, so the two states can never disagree about how a zero is spelled.
  const value = expired ? formatRemaining(0) : formatRemaining(remainingMs);

  return (
    <section
      className={`review-countdown${expired ? ' review-countdown--expired' : ''}`}
      aria-label="Review window"
    >
      <h2 className="review-countdown__title">
        {expired ? 'Review window closed' : 'Time left to review'}
      </h2>
      {/*
        `aria-live="off"` is a decision, not a default. A polite live region on a
        value that changes once a second turns a screen reader into a metronome and
        buries every other announcement on the page — including the one that
        matters, the flip to released. The number stays readable on demand: it is
        ordinary text inside a labelled region, reachable by browsing at whatever
        pace the reader chooses.

        What is worth announcing is the state change, and that is what the label
        below is for. Its text changes exactly twice in this component's life — once
        at expiry, once never — so a polite region there announces the fact ("the
        window has closed, the release is being processed") the moment it becomes
        true, and stays silent for every one of the ticks in between.
      */}
      <p className="review-countdown__value" aria-live="off">
        {value}
      </p>
      <p className="review-countdown__label" role="status" aria-live="polite">
        {expired
          ? 'The window has closed. The escrow release to the seller is being processed — this page updates itself when it lands.'
          : 'When this reaches zero the escrow releases to the seller automatically. Nobody has to do anything.'}
      </p>
    </section>
  );
}
