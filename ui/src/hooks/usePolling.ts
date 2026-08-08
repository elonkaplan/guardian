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
}

export interface PollingResult<T> {
  data: T | undefined;
  error: ApiError | null;
  /** False once the terminal rule has matched, or while disabled. */
  isPolling: boolean;
  refetch: () => void;
}

export function usePolling<T>(
  key: readonly unknown[],
  fetcher: () => Promise<T>,
  options: PollingOptions<T>,
): PollingResult<T> {
  const { intervalMs, isTerminal, enabled = true } = options;

  const query = useQuery<T, ApiError>({
    queryKey: key,
    queryFn: fetcher,
    enabled,
    // Returning false stops the schedule permanently for this query. Note the
    // failure branch: when a fetch errors there is no data to test, and we
    // return the interval so the poll keeps trying rather than freezing the
    // page on a transient blip.
    refetchInterval: (query) => {
      const data = query.state.data;
      if (data !== undefined && isTerminal?.(data) === true) {
        return false;
      }
      return intervalMs;
    },
  });

  const reachedTerminal = query.data !== undefined && isTerminal?.(query.data) === true;

  return {
    data: query.data,
    error: query.error ?? null,
    isPolling: enabled && !reachedTerminal,
    refetch: () => {
      void query.refetch();
    },
  };
}
