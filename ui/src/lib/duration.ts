/**
 * One duration vocabulary, for a window that is seconds on stage and a day in principle.
 *
 * The review window is thirty seconds during the demo and up to 24 hours in the
 * product as written (docs/product-workflow.md §4.5), and the same formatter has to
 * read correctly at both ends. Below a minute the seconds are the whole story, so
 * they lead. Above an hour they are noise — a clock that reshuffles its last digit
 * every second while the buyer has half a day to decide invites watching rather than
 * reading — so at that range they are dropped and the minutes are zero-padded to
 * keep the string from changing width as it counts down.
 *
 * Two exported names for what is currently one function, deliberately. The countdown
 * and the elapsed line must not each invent their own wording for four minutes; they
 * share this one. Splitting the names now means a future divergence — elapsed wanting
 * coarser units once an order has been running for a day, say — has an obvious home
 * and does not start as an `if` inside the countdown's formatter.
 *
 * Never negative and never throws: a clock that has passed its deadline reads `0s`,
 * and an unparseable timestamp arrives here as NaN and reads `—`, which is what
 * formatUsd does with a figure it cannot render.
 */

const MS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;
const SECONDS_PER_HOUR = 3600;

function format(ms: number, round: (seconds: number) => number): string {
  if (!Number.isFinite(ms)) {
    return '—';
  }

  const totalSeconds = Math.max(0, round(ms / MS_PER_SECOND));

  if (totalSeconds < SECONDS_PER_MINUTE) {
    return `${totalSeconds}s`;
  }

  if (totalSeconds < SECONDS_PER_HOUR) {
    const minutes = Math.floor(totalSeconds / SECONDS_PER_MINUTE);
    const seconds = totalSeconds % SECONDS_PER_MINUTE;
    return `${minutes}m ${seconds}s`;
  }

  const hours = Math.floor(totalSeconds / SECONDS_PER_HOUR);
  const minutes = Math.floor((totalSeconds % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE);
  return `${hours}h ${String(minutes).padStart(2, '0')}m`;
}

/**
 * Time left, rounded **up**.
 *
 * This is the one place the two directions genuinely differ. A countdown that floors
 * reaches `0s` a full second before the deadline actually passes, so the hero number
 * on the order screen would sit at zero while the window is still open and the Accept
 * button still works — a second of the page contradicting itself, on the number the
 * room is watching. Ceiling means `1s` stays on screen until the deadline is genuinely
 * behind us and `0s` appears only when it is.
 */
export function formatRemaining(ms: number): string {
  return format(ms, Math.ceil);
}

/**
 * Time since, rounded **down** — the ordinary reading of "it has been running for 4m
 * 12s". Ceiling here would claim a second that has not happened yet.
 */
export function formatElapsed(ms: number): string {
  return format(ms, Math.floor);
}
