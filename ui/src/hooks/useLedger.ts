import type { LedgerEntry } from '../api/types';
import { fetchLedger } from '../api/wallet';
import { useAuth } from '../auth/AuthContext';
import { usePolling } from './usePolling';
import type { PollingResult } from './usePolling';

/**
 * The statement, polled for as long as the wallet page is open and not one
 * second longer than that.
 *
 * Every other poll in this app is built to stop. `useOrder` stops the moment
 * an order reaches `released` or `settled`, because an order is a thing with
 * an ending. `useVerdict` stops the moment a transaction hash lands, because
 * a ruling that has settled cannot change again. A ledger has no such moment.
 * It is a running account of every movement a person has ever made against
 * their balance, and a fresh movement can land at any time — a top-up from
 * another tab, a cash-out finishing late, an order paying out three minutes
 * after the buyer stopped watching it. There is no state the list can reach
 * where asking again is pointless, so unlike its two siblings this hook
 * passes no `isTerminal` to `usePolling` at all. Omitting the predicate is
 * exactly how the underlying hook spells "poll until unmount", and that is
 * the correct behaviour here rather than an oversight.
 *
 * `isFatalError` is left out for a related but distinct reason. `useOrder`
 * and `useVerdict` both treat a 404 as permanent, because a mistyped order id
 * or an order with no ruling yet will never turn into a 200 no matter how
 * many times the tab asks. `GET /me/ledger` has no such case: it either
 * belongs to the signed-in account, in which case a failure is a transient
 * blip in front of a resource that will read cleanly again, or the caller is
 * signed out, in which case this hook is disabled below and never fires at
 * all. Treating a failure here as fatal would stop the schedule for the rest
 * of the session over what is almost always a dropped connection or a slow
 * backend — and unlike an order page, there is no reload-free way back for
 * the wallet screen once the poll has given up. A page reload is the only
 * recovery, which is a worse outcome than the occasional stale read that
 * keeps retrying resolves on its own five seconds later.
 *
 * Five seconds is not a guess: `ui/docs/CONTEXT.md` §4 and `docs/ui-design.md`
 * §5 both fix the wallet screen's cadence at 5s, forever, and this is the one
 * poll the page owns for itself — the account figures beside it are read
 * through `useAccountSummary`, a passive subscriber to the shell's existing
 * `['me']` poll, so that adding this hook to the page never doubles a request
 * rate against an endpoint someone else already schedules.
 *
 * Gated on `isSignedIn`, matching `useAccountSummary`: a signed-out visitor
 * has no statement to read, and an enabled query would only give the API a
 * request it can do nothing with but reject.
 *
 * One more thing lives here in spirit rather than in code: callers render
 * these rows keyed by `entry.id`, not by array index. That is what lets a
 * newly landed entry insert itself as one row at the top of the list without
 * React remounting every row beneath it — and without remounting them, the
 * reader's scroll position survives a poll tick instead of resetting to the
 * top every five seconds.
 */

export function useLedger(): PollingResult<LedgerEntry[]> {
  const { isSignedIn } = useAuth();

  return usePolling<LedgerEntry[]>(['ledger'], fetchLedger, {
    intervalMs: 5000,
    enabled: isSignedIn,
  });
}
