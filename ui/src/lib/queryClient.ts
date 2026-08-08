import { QueryClient } from '@tanstack/react-query';

/**
 * Defaults chosen for polling, not for a typical CRUD app.
 *
 * `retry: false` — a one-second poll already retries on its own next tick.
 * Layered retries just multiply requests against an API that's already down.
 *
 * `refetchOnWindowFocus: false` — the demo laptop will switch tabs. Returning
 * to the tab must not fire a burst of catch-up requests.
 *
 * `staleTime: 0` — polled data is never fresh by definition; the interval is
 * the only thing that decides when to refetch.
 *
 * `refetchIntervalInBackground: true` — this one is a product decision, not a
 * default worth inheriting. React Query pauses intervals whenever the document
 * is hidden, and on macOS a window that is merely *occluded* counts as hidden,
 * not just a background tab. Act 1's whole claim is that the order page flips to
 * released on its own with nobody touching the keyboard; making that depend on
 * whether a terminal window happens to be covering the browser is a variable we
 * do not want in a rehearsal. Against localhost the cost of polling while hidden
 * is nil. There is no burst risk either, because nothing ever queues up.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      refetchOnWindowFocus: false,
      refetchIntervalInBackground: true,
      staleTime: 0,
    },
  },
});
