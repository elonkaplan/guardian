import type { ApiError } from '../api/errors';
import type { CaseFile } from '../api/types';
import { fetchCaseFile } from '../api/verdicts';
import { usePolling } from './usePolling';

/**
 * The evidence Guardian ruled on, read exactly once.
 *
 * A case file describes an execution that had already finished when the dispute was
 * filed — the input, the pinned listing text, the output, the steps. Nothing in it
 * can change afterwards, so polling it would be asking a settled question once a
 * second, and it is the largest payload this screen touches: attaching it to a
 * repeating schedule would ship kilobytes a minute to render something the buyer
 * opens once, if at all (research R6).
 *
 * **Read-once is expressed through `usePolling`, not around it.** Both predicates
 * are constants, and that is the idiom rather than a shortcut: `isTerminal: () =>
 * true` stops the schedule on the first success, `isFatalError: () => true` stops it
 * on the first failure, so exactly one request is issued whichever way it goes. The
 * alternative — a `useEffect` and a ref beside the app's one refresh mechanism —
 * would be a second, subtly different fetch lifecycle to keep correct, with its own
 * unmount handling and its own way to double-fire under StrictMode.
 *
 * `intervalMs` is required by `PollingOptions` and never elapses here, because the
 * schedule has already stopped by the time the first interval would be scheduled.
 *
 * **Recovery is explicit.** Stopping on the first failure means a blip leaves the
 * panel showing an error rather than silently retrying behind it; the way back is
 * the panel's retry button calling `refetch`, which is what FR-035 asks for — the
 * case file's failure reported inside its own panel, with a retry, without taking
 * the verdict card down with it.
 *
 * `disputed` — the caller's `order.disputedAt !== null` — is the gate. An order that
 * was released uncontested has no case file and the endpoint would 404 (FR-025, R7);
 * passing the flag rather than a state list keeps the test a fact about the order
 * instead of a position in the lifecycle, and lets every face call this hook
 * unconditionally.
 */

export interface CaseFileView {
  caseFile: CaseFile | undefined;
  error: ApiError | null;
  loading: boolean;
  refetch: () => void;
}

export function useCaseFile(orderId: string, disputed: boolean): CaseFileView {
  const { data, error, refetch } = usePolling<CaseFile>(
    ['case-file', orderId],
    () => fetchCaseFile(orderId),
    {
      intervalMs: 1000,
      enabled: disputed,
      isTerminal: () => true,
      isFatalError: () => true,
    },
  );

  return {
    caseFile: data,
    error: error ?? null,
    // Only the in-flight first read. A panel that is disabled is not loading — it is
    // not going to load — and an error is a finished attempt, not a pending one;
    // reporting either as loading would leave a spinner on screen with nothing behind
    // it, which for a read that never retries would never resolve.
    loading: disputed && data === undefined && error === null,
    refetch,
  };
}
