import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';

import type { ApiError } from '../api/errors';
import { fetchOrder } from '../api/orders';
import type { Order } from '../api/types';
import type { OrderFace } from '../lib/orderState';
import { faceFor, isTerminalState, stateRank } from '../lib/orderState';
import { usePolling } from './usePolling';

/**
 * The order screen's whole data layer: one live order, and the four things a page
 * needs to know about the attempt to read it.
 *
 * Everything visible on that screen is derived from a single polled object, so this
 * hook is where the three rules governing that poll live — kept together, because
 * each of them is invisible until it is wrong on stage.
 *
 * **One second, and only while the order can still change.** The interval is the one
 * `docs/ui-design.md` §5 specifies. `isTerminal` stops the schedule permanently once
 * the order reaches `released` or `settled`; a demo laptop asking about an order that
 * finished ten minutes ago is a needless way to look bad. Note what is *not* terminal:
 * `failed` still polls, because a complaint can be filed from it and that transition
 * has to appear on screen, and `adjudicated` still polls, because the split has not
 * executed yet.
 *
 * **A 404 is not a blip.** `usePolling` deliberately keeps polling through errors, on
 * the grounds that a failed fetch is usually transient and freezing the page on one is
 * worse than trying again. That reasoning does not survive a mistyped order id: a 404
 * will never become a 200, and without `isFatalError` the tab would issue a request
 * every second for as long as it stays open. 403 is the same case — someone else's
 * order does not become ours by asking repeatedly.
 *
 * **The page must never move backwards.** Sequential polling makes an out-of-order
 * response unlikely rather than impossible, and the visible failure is severe out of
 * all proportion to its likelihood: a page that has shown a verdict dropping back to
 * "the agent is working" destroys the audience's belief in everything else on the
 * screen, in one frame. The guard below is ten lines and buys that off.
 */

export interface OrderView {
  /** The highest-ranked order seen so far — not necessarily the newest response. */
  order: Order | undefined;
  /** Which of the five faces to render. Undefined until the first successful read. */
  face: OrderFace | undefined;
  error: ApiError | null;
  /** The order does not exist, or is not ours. The poll has stopped. */
  notFound: boolean;
  /** Updates are failing but we still have something true to show. */
  stale: boolean;
  isPolling: boolean;
  refetch: () => void;
}

export function useOrder(id: string): OrderView {
  const { data, error, isPolling, refetch } = usePolling<Order>(
    ['order', id],
    () => fetchOrder(id),
    {
      intervalMs: 1000,
      isTerminal: (order) => isTerminalState(order.state),
      // 404: no such order. 403: not this buyer's. Neither is recoverable by asking
      // again, and both are rendered as a dead end with a way back rather than as a
      // failure worth retrying.
      isFatalError: (failure) =>
        failure.kind === 'http' && (failure.status === 404 || failure.status === 403),
    },
  );

  // The monotonic guard. Held in a ref rather than state because it is history, not
  // present truth: nothing about it should cause a render of its own, and it must be
  // consulted during the same render that received the response — an effect would
  // apply the correction one frame late, which is one frame of exactly the regression
  // this exists to prevent.
  //
  // Keyed on the order id so that navigating from a settled order to a fresh one does
  // not leave the new page pinned to the old one's rank.
  const seen = useRef<{ id: string; order: Order } | null>(null);

  if (seen.current !== null && seen.current.id !== id) {
    seen.current = null;
  }

  let visible = data;

  if (data !== undefined) {
    const previous = seen.current;
    // `>=` rather than `>`: an equal rank is the ordinary case — same state, fresher
    // timestamps and possibly a newly arrived output — and must be allowed through.
    // Only a strictly lower rank is a response that would move the page backwards.
    if (previous === null || stateRank(data.state) >= stateRank(previous.order.state)) {
      seen.current = { id, order: data };
      visible = data;
    } else {
      visible = previous.order;
    }
  }

  const notFound =
    error !== null && error.kind === 'http' && (error.status === 404 || error.status === 403);

  // The header's money figures move when an order ends — the escrow that was holding
  // this order's price is released or split, and the available balance may be
  // credited. `BalanceWidget` polls `['me']` every five seconds, and five seconds is
  // a long pause on stage between the page flipping to released and the numbers above
  // it acknowledging it. One invalidation closes that gap.
  //
  // Once, on the transition — not on every poll, which would replace the shell's
  // deliberate 5s cadence with a 1s one for every screen that shows a balance.
  const reachedTerminal = visible !== undefined && isTerminalState(visible.state);
  const nudged = useRef<string | null>(null);
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!reachedTerminal || nudged.current === id) {
      return;
    }
    nudged.current = id;
    void queryClient.invalidateQueries({ queryKey: ['me'] });
  }, [reachedTerminal, id, queryClient]);

  return {
    order: visible,
    face: visible === undefined ? undefined : faceFor(visible.state),
    error,
    notFound,
    // The distinction the page acts on: an error with data behind it is a quiet
    // "updates are not getting through" over a page that still reads correctly, while
    // an error with nothing behind it is the whole screen. Conflating them means a
    // transient blip wipes out a delivered output the buyer was reading.
    stale: error !== null && visible !== undefined,
    isPolling,
    refetch,
  };
}
