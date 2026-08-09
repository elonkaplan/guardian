import { useQuery } from '@tanstack/react-query';

import { fetchMe } from '../api/me';
import type { ApiError } from '../api/errors';
import type { AccountSummary } from '../api/types';
import { useAuth } from '../auth/AuthContext';

/**
 * A second reader of the balance the header is already showing — not a second
 * request for it.
 *
 * `BalanceWidget` lives in the app shell, so on every screen with a signed-in
 * user there is already a live `['me']` query refreshing every five seconds.
 * TanStack Query deduplicates by query key, which means a second `useQuery`
 * against that key is a subscription to the same cache entry rather than a new
 * request. This hook therefore adds no network traffic at all, and — the part
 * that matters more — the buy form's balance and the header's balance are
 * physically the same value. They cannot disagree, because there is only one of
 * them.
 *
 * The alternative, a bare `fetchMe()` call from the form, would be a second
 * source of truth for a number already on screen. Its answer would arrive at a
 * different moment than the header's and drift from it for up to five seconds:
 * a buyer reading "$40.00" at the top of the page while the form beneath it
 * refuses the purchase on the strength of an older figure. Nobody can debug
 * that from the audience.
 *
 * `useQuery` directly rather than `usePolling`, deliberately. `usePolling`'s
 * whole contract is a schedule — its `refetchInterval` returns the interval on
 * every path except a matched terminal predicate, including the error path, and
 * `intervalMs` is required rather than optional. Query-key deduplication is
 * about the cache entry, not about timers: each observer keeps its own
 * schedule, so a second `usePolling(['me'])` would share the data and then
 * quietly double the poll rate against `/me`. Passing some absurd interval to
 * suppress that would be a lie in the source. The shell owns the cadence; this
 * hook is a passive subscriber and owns nothing.
 *
 * Gated on `isSignedIn` exactly as the widget is — a signed-out user has no
 * `/me` to read, and an enabled query would fire a request the API can only
 * reject.
 */

export interface AccountSummaryResult {
  data: AccountSummary | undefined;
  /** True when there is no usable figure — not signed in, still loading, or errored. */
  unknown: boolean;
  /**
   * The most recent failure, or `null`. Exposed alongside `data` rather than
   * folded into `unknown`, because the two callers want opposite things from
   * the same situation.
   *
   * After one good read and one failed refresh, `data` still holds perfectly
   * good figures from five seconds ago while `error` is set. `BuyPanel` wants
   * that collapsed — it only asks whether the number can be trusted for an
   * affordability check, and a stale one cannot. The wallet screen wants them
   * apart: blanking three money figures because a single refresh blipped is the
   * screen breaking itself, so it keeps the last known amounts on display and
   * marks them as not refreshed (UI-06 FR-007).
   *
   * `unknown` therefore keeps its exact previous meaning and every existing
   * caller is unaffected. This field is additive.
   */
  error: ApiError | null;
}

export function useAccountSummary(): AccountSummaryResult {
  const { isSignedIn } = useAuth();

  const query = useQuery<AccountSummary, ApiError>({
    queryKey: ['me'],
    queryFn: fetchMe,
    enabled: isSignedIn,
    // No refetchInterval. See above: the shell's BalanceWidget drives this key.
  });

  // One flag for every reason the number might be missing, because callers have
  // no use for the distinction: signed out, first load in flight, and a failed
  // GET /me all mean the same thing at the point of use — we do not know what
  // this account has. Mirrors the widget's own `unavailable` rule so the two
  // readers go blank together rather than one showing a stale figure the other
  // has already given up on.
  //
  // WARNING: `unknown === true` must NEVER be read as "cannot afford". It is
  // the absence of an answer, not a negative one. Disabling a purchase because
  // a transient GET /me failed would block a spend the backend would have
  // accepted, and there is no operator override for it — a self-inflicted
  // outage caused entirely by our own caution. Let the buyer proceed and let
  // the server be the authority on affordability; it is the only party holding
  // the ledger anyway. That is requirement FR-028.
  const unknown = !isSignedIn || query.error !== null || query.data === undefined;

  return {
    data: query.data,
    unknown,
    error: query.error ?? null,
  };
}
