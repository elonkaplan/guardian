/**
 * Eight backend states, five things the order page can be. This module owns that
 * translation and nothing else.
 *
 * Without it the mapping gets rewritten inline at every place that needs it — the
 * header chip, the face switch, the poll's stop condition, the guard against a
 * response that moves the page backwards — and those copies drift. The drift is not
 * theoretical: `adjudicated` reads like an ending and is not one, so an inline
 * `state === 'settled' || state === 'adjudicated'` written in a hurry stops the poll
 * one transition early and freezes the page short of the payout.
 *
 * Every function here is total over `OrderState` and exhaustively switched, so the
 * ninth state the backend adds is a compile error in this file rather than a page
 * with no face (data-model §1, §2).
 *
 * Pure. No React, no fetch, no module-level mutable state.
 */

import type { OrderState } from '../api/types';

export type OrderFace = 'working' | 'review' | 'nothing-came-back' | 'arbitration' | 'concluded';

/**
 * Helper whose real purpose is the type error, not the throw. Every switch below
 * falls through to a call to it rather than carrying a `default` clause: a `default`
 * would happily swallow a new state and render something arbitrary, whereas with no
 * default an unhandled case leaves the argument something other than `never` here
 * and the build fails. The runtime throw only covers a value that got past the type
 * system entirely.
 */
function assertNever(value: never): never {
  throw new Error(`Unhandled order state: ${String(value)}`);
}

export function faceFor(state: OrderState): OrderFace {
  switch (state) {
    case 'purchased':
    case 'running':
      return 'working';
    case 'delivered':
      return 'review';
    case 'failed':
      return 'nothing-came-back';
    case 'disputed':
    // `adjudicated` is the one mapping that is not obvious from the state's name.
    // A ruling exists, but the split has not executed, so the order is still moving
    // and money has not landed. The arbitration face says settlement is finishing
    // while the poll keeps running; sending it to `concluded` would announce an
    // outcome that has not happened yet (data-model §2, FR-011).
    case 'adjudicated':
      return 'arbitration';
    case 'released':
    case 'settled':
      return 'concluded';
  }
  return assertNever(state);
}

/**
 * This governs the network; `faceFor` governs rendering. They are kept separate on
 * purpose even though `concluded` is, today, exactly these two values — the day a
 * state is added that looks finished but is still moving, collapsing the two would
 * silently stop the poll and strand the page mid-lifecycle.
 *
 * `failed` is not terminal: a complaint can still be filed from it, and that
 * transition has to appear on screen. `adjudicated` is not terminal: settlement has
 * not completed. Both keep polling (research R4, `docs/ui-design.md` §5, which stops
 * the 1s poll on `released` / `settled` and nothing else).
 */
export function isTerminalState(state: OrderState): boolean {
  switch (state) {
    case 'released':
    case 'settled':
      return true;
    case 'purchased':
    case 'running':
    case 'delivered':
    case 'failed':
    case 'disputed':
    case 'adjudicated':
      return false;
  }
  return assertNever(state);
}

/**
 * Ranks exist for exactly one job: rejecting a polled response that would move the
 * page backwards. The page keeps the highest rank it has seen and ignores anything
 * below it, because a page that has shown a verdict and then drops back to "the
 * agent is working" ends a demo's credibility in one frame (FR-015, research R10).
 *
 * They are not a total order on the lifecycle and must not be used as one. The ties
 * are deliberate: `delivered` and `failed` are alternative outcomes of `running`,
 * `released` and `adjudicated` are alternative exits from `delivered`, and neither
 * pair can transition into the other — so their relative order is unobservable and
 * inventing one would be a claim the state machine does not make.
 */
export function stateRank(state: OrderState): number {
  switch (state) {
    case 'purchased':
      return 0;
    case 'running':
      return 1;
    case 'delivered':
      return 2;
    case 'failed':
      return 2;
    case 'disputed':
      return 3;
    case 'released':
      return 4;
    case 'adjudicated':
      return 4;
    case 'settled':
      return 5;
  }
  return assertNever(state);
}

/**
 * Lives here rather than in the header component so that the chip and any future
 * orders list say the same words for the same state (contracts §2). One vocabulary,
 * one place to change it.
 */
export function stateLabel(state: OrderState): string {
  switch (state) {
    case 'purchased':
      return 'Purchased';
    case 'running':
      return 'Working';
    case 'delivered':
      return 'Delivered';
    case 'failed':
      return 'Nothing returned';
    case 'disputed':
      return 'Disputed';
    case 'adjudicated':
      return 'Ruled';
    case 'released':
      return 'Released';
    case 'settled':
      return 'Settled';
  }
  return assertNever(state);
}
