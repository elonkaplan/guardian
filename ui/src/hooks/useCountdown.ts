import { useState } from 'react';

import { useNow } from './useNow';

/**
 * The countdown to automatic release, expressed as a remaining duration.
 *
 * **It recomputes from an absolute deadline on every tick and never decrements a
 * stored value.** A hook that kept `remaining` in state and subtracted 1000 each tick
 * drifts under timer throttling and is simply wrong after a suspended tab: it would
 * resume from wherever it stopped, which is precisely what FR-018 forbids. Reading a
 * deadline instead makes suspension a non-event — the worst case is one second of
 * staleness, and `useNow`'s `visibilitychange` listener removes even that. Close the
 * laptop with four minutes left, open it ten minutes later, and the window is over,
 * because it always was.
 *
 * **Why a timer at all, rather than letting the 1s poll re-render the clock.** Piggy-
 * backing on the poll would be less code and would couple the visible clock to network
 * health: during an outage the countdown would freeze, at the one moment it must not.
 * A stopped clock on this screen does not read as "the network is down", it reads as
 * "time is not passing", and the buyer would believe they still had a window to act in.
 * The clock keeps running whether or not the data does (research R6).
 *
 * **The clock is the server's, not the device's.** `useNow` reads `serverNow()`, so a
 * buyer whose laptop is three minutes fast does not see a window that ends early. See
 * `lib/serverClock.ts`.
 *
 * This hook creates no timer of its own — `useNow` owns the app's only `setInterval`.
 */
export interface Countdown {
  remainingMs: number;
  expired: boolean;
}

export function useCountdown(deadlineMs: number | null): Countdown {
  // Once the deadline passes there is nothing left to recompute, so the interval should
  // stop rather than tick forever on a value that is pinned to zero. But `active` has to
  // be decided *before* `useNow` is called, and the remaining time is only known *after*
  // — so the answer cannot be read out of this render's `now`.
  //
  // Latching it in state and adjusting that state during render is the way out. React
  // re-runs the component immediately on a render-phase `setState`, before committing, so
  // `active` is already `false` in the commit that first shows zero: the interval is
  // cleared on the same pass, not one tick later. An effect would be a tick late, and a
  // ref would not re-render at all, leaving the interval alive until something else
  // happened to re-render. Nothing here is captured in a closure — every value is derived
  // from this render's `now` — so there is no stale reading to go wrong.
  const [hasExpired, setHasExpired] = useState(false);

  const now = useNow(1000, deadlineMs !== null && !hasExpired);

  // `null` means "there is no window" — no delivery, so no deadline. That is a different
  // fact from "the window has closed", and the two must not collapse into one: a caller
  // handed `expired: true` for an order that never delivered would tell the buyer their
  // release is being processed. So `expired` stays `false` here, and `remainingMs` is 0
  // only because there is no duration to report.
  const remainingMs = deadlineMs === null ? 0 : Math.max(0, deadlineMs - now);
  const expired = deadlineMs !== null && remainingMs === 0;

  // Also unlatches: a `deadlineMs` that moves out into the future (or goes `null`) turns
  // the timer back on, and `useNow` re-reads the clock on re-activation, so the frozen
  // `now` this render computed from is corrected on the next pass.
  if (expired !== hasExpired) {
    setHasExpired(expired);
  }

  return { remainingMs, expired };
}
