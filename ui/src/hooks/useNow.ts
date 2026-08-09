import { useEffect, useState } from 'react';

import { serverNow } from '../lib/serverClock';

/**
 * The app's only clock, and deliberately the app's only `setInterval`.
 *
 * Two things on the order screen change with time rather than with data — the elapsed
 * line while an agent works, and the countdown to automatic release — and both would
 * otherwise grow a timer of their own. Two timers is how one of them ends up leaked,
 * or throttled differently, or subtracting from a stored value instead of reading the
 * clock. One hook, consulted twice, is the whole mitigation.
 *
 * **It reports an instant, not a duration.** Callers subtract. That is what makes a
 * suspended tab a non-event: a hook that counted down would resume from wherever it
 * stopped, whereas a hook that reports "it is now 12:04:31" is simply late, and the
 * worst case is one second of staleness. The `visibilitychange` listener removes even
 * that, so returning to an occluded window shows the right value on the same frame
 * rather than on the next tick.
 *
 * The instant comes from `serverNow()`, not `Date.now()` — see `lib/serverClock.ts`
 * for why a countdown computed on the client cannot afford to trust the device clock.
 *
 * `active: false` creates no timer at all, which is how a page with nothing to count
 * (a settled order, an order that never delivered) stops ticking without its caller
 * having to conditionally call a hook.
 */
export function useNow(intervalMs: number, active = true): number {
  const [now, setNow] = useState(() => serverNow());

  useEffect(() => {
    if (!active) {
      return;
    }

    // Read once on mount and on every re-activation, so the first paint after a
    // remount is never a stale value inherited from the initial state.
    setNow(serverNow());

    const timer = window.setInterval(() => {
      setNow(serverNow());
    }, intervalMs);

    const onVisibilityChange = (): void => {
      if (document.visibilityState === 'visible') {
        setNow(serverNow());
      }
    };

    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [intervalMs, active]);

  return now;
}
