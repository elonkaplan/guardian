import type { ApiError } from '../api/errors';
import type { OrderState, Verdict } from '../api/types';
import { fetchVerdict } from '../api/verdicts';
import { usePolling } from './usePolling';

/**
 * The ruling, read on its own schedule rather than on the order's.
 *
 * A verdict does not exist for most of an order's life and never changes once the
 * transaction that settles it has landed, so it is neither a field of the 1s order
 * poll nor a one-shot read. It is a short poll with a precise stopping condition,
 * and the three rules that make it precise are all here (research R6).
 *
 * **One cache key, never keyed on state.** `['verdict', orderId]` and nothing else.
 * Adding `state` to the key would refetch cleanly on the `adjudicated → settled`
 * transition, which is why it is tempting — but it also mints a *new* cache entry,
 * so `data` is `undefined` for the frame between the two, the card unmounts, and it
 * rebuilds from nothing. That is a visible flicker on the demo's closing beat and a
 * direct violation of FR-031, which requires the card to update *in place* and not
 * visibly rebuild. One key polled to a stopping condition updates in place; the
 * `state` argument is used only in the predicates below, where it changes when the
 * poll stops rather than which entry it writes to.
 *
 * **Enabled only once a ruling can exist.** There is no verdict before adjudication,
 * so `purchased` through `disputed` must not ask: the endpoint would 404 on every
 * order that is merely running, and `isFatalError` would then stop a poll that had
 * never had anything to fetch. Gating here also means the page's faces can call this
 * hook unconditionally — the hook decides whether a request happens, not the caller.
 *
 * **Stopping is two conditions, not one.** Explained at `isTerminal` below; between
 * them they are what keeps a settled order from reading the same immutable row once
 * a second for as long as the tab is open (FR-033).
 */

export interface VerdictView {
  verdict: Verdict | undefined;
  error: ApiError | null;
  /** True while the ruling exists but the transaction has not landed. */
  settlementPending: boolean;
  refetch: () => void;
}

export function useVerdict(orderId: string, state: OrderState): VerdictView {
  const { data, error, refetch } = usePolling<Verdict>(
    // See the header: one key for both states, deliberately.
    ['verdict', orderId],
    () => fetchVerdict(orderId),
    {
      intervalMs: 1000,
      enabled: state === 'adjudicated' || state === 'settled',
      // Both halves earn their place.
      //
      // `txHash !== null` is the ordinary stop. Between `adjudicated` and `settled`
      // the ruling exists but `onchain_tx_hash` is still null, and this poll is the
      // mechanism by which the explorer link appears unattended, with nobody
      // refreshing anything (FR-031). It stops the instant the link is real, because
      // a verdict with a transaction behind it is a record that cannot change again.
      //
      // `state === 'settled'` closes the case the spec's edge-case list calls out:
      // settlement completed but no transaction reference was ever recorded. Without
      // it the first half never becomes true and this query polls a permanently-null
      // field forever — precisely the behaviour FR-033 exists to prevent. The order
      // reaching `settled` is the independent evidence that there is nothing left to
      // wait for, whatever the hash column says.
      isTerminal: (verdict) => verdict.txHash !== null || state === 'settled',
      // **Branch on the code, not the status.** This route is the one place in the
      // API where two 404s mean opposite things, and it returns a bare
      // `{ error: CODE }` body precisely so a client can tell them apart — the code
      // is the only thing that distinguishes "this is not your order" from "the audit
      // has not finished yet" (api/docs/openapi-divergences.md row 6, kept
      // `intentional` for exactly this reason).
      //
      //   404 ORDER_NOT_FOUND   — no such order, or not ours. Terminal.
      //   404 VERDICT_NOT_FOUND — our order, the audit is still running. KEEP POLLING.
      //   409 AUDIT_FAILED      — the audit gave up. Terminal; no verdict will appear.
      //
      // Reading the status alone was wrong in both directions at once: it stopped on
      // the one case that resolves by waiting, and retried the one that never does.
      // The gate above (`adjudicated`/`settled`) narrows the window but does not close
      // it — the order's state and the verdict row do not become visible in the same
      // instant, and on a 1s poll one unlucky tick permanently killed the card.
      //
      // 403 stays fatal: someone else's order does not become ours by repetition.
      // A 404 carrying no recognisable code stays fatal too, so nothing unfamiliar
      // gains an infinite-poll path — the failure this predicate exists to prevent.
      // Anything else — a 500, a dropped connection — keeps retrying, because those
      // are the failures that do resolve.
      isFatalError: (failure) => {
        if (failure.kind !== 'http') return false;
        if (failure.status === 403) return true;
        if (failure.status === 409) return failure.code === 'AUDIT_FAILED';
        if (failure.status === 404) return failure.code !== 'VERDICT_NOT_FOUND';
        return false;
      },
    },
  );

  return {
    verdict: data,
    error: error ?? null,
    // Derived here rather than in the card, so that the one place that knows both the
    // order's state and the verdict's hash is the one place that answers the question.
    // A card that re-derived it would be a second definition of "pending" free to
    // drift from this one — and the two would drift in the worst possible window, the
    // few seconds between the ruling and the transaction, where the whole point is
    // that the screen says exactly one true thing about what is still outstanding.
    settlementPending: data !== undefined && data.txHash === null && state === 'adjudicated',
    refetch,
  };
}
