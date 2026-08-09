import { useQuery } from '@tanstack/react-query';

import type { ApiError } from '../api/errors';

/**
 * The one refresh mechanism the whole app shares.
 *
 * Three features poll at two intervals: Order Detail at 1s stopping on a
 * terminal state, Wallet and My Orders at 5s forever, and the header balance
 * widget at 5s. Building it once is the point — the two failure modes here
 * (a leaked interval and overlapping requests) surface on stage rather than
 * at the desk.
 *
 * Backed by TanStack Query rather than hand-rolled timers. Query-key
 * deduplication gives "never overlap", unmount cleanup is automatic, and
 * `refetchInterval` returning false gives "stop on terminal". The signature is
 * deliberately independent of that choice: swapping the body for a setTimeout
 * loop would be invisible to every caller.
 */

export interface PollingOptions<T> {
  /** Milliseconds between refreshes. */
  intervalMs: number;
  /**
   * Decides whether the data has reached a finishing state. Evaluated against
   * every successful result — including the first, so data that is already
   * finished on load never schedules a second request.
   *
   * Omit to poll until unmount.
   */
  isTerminal?: (data: T) => boolean;
  /** Set false to hold off entirely — e.g. no signed-in user yet. */
  enabled?: boolean;
  /**
   * Decides whether a failure is permanent rather than a passing blip. Return
   * true and the schedule stops for good, exactly as a terminal result would
   * stop it.
   *
   * Only the caller can judge this, because only the caller knows which
   * statuses its resource can recover from. Omit to keep retrying every
   * failure.
   */
  isFatalError?: (error: ApiError) => boolean;
}

export interface PollingResult<T> {
  data: T | undefined;
  error: ApiError | null;
  /**
   * False once the terminal rule has matched, once a fatal error has stopped
   * the schedule, or while disabled.
   */
  isPolling: boolean;
  refetch: () => void;
}

export function usePolling<T>(
  key: readonly unknown[],
  fetcher: () => Promise<T>,
  options: PollingOptions<T>,
): PollingResult<T> {
  const { intervalMs, isTerminal, enabled = true, isFatalError } = options;

  const query = useQuery<T, ApiError>({
    queryKey: key,
    queryFn: fetcher,
    enabled,
    // Returning false stops the schedule permanently for this query. Note the
    // failure branch: when a fetch errors there is no data to test, and we
    // return the interval so the poll keeps trying rather than freezing the
    // page on a transient blip.
    //
    // Some failures are not blips, though. A 404 for an order that does not
    // exist will never turn into a 200, and asking for it once a second for as
    // long as the tab stays open is precisely what the order screen's FR-010
    // and SC-005 exist to prevent. Which statuses are permanent depends on the
    // resource, so the distinction is `isFatalError`'s to draw — the hook only
    // honours the verdict. The terminal-data check keeps priority: a query that
    // finished successfully is done regardless of any earlier error.
    refetchInterval: (query) => {
      const data = query.state.data;
      if (data !== undefined && isTerminal?.(data) === true) {
        return false;
      }
      const error = query.state.error;
      if (query.state.status === 'error' && error !== null && isFatalError?.(error) === true) {
        return false;
      }
      return intervalMs;
    },
  });

  const reachedTerminal = query.data !== undefined && isTerminal?.(query.data) === true;
  // Mirrors the two stopping conditions in `refetchInterval` above, in the same
  // order. A caller that renders a live indicator off this flag would otherwise
  // claim to be polling a schedule that has already stopped for good.
  const stoppedByFatalError =
    !reachedTerminal &&
    query.status === 'error' &&
    query.error !== null &&
    isFatalError?.(query.error) === true;

  return {
    data: query.data,
    error: query.error ?? null,
    isPolling: enabled && !reachedTerminal && !stoppedByFatalError,
    refetch: () => {
      void query.refetch();
    },
  };
}
