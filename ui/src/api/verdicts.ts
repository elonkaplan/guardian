import { normaliseCaseFile, normaliseVerdict } from '../lib/verdict';
import { apiGet } from './client';
import type { CaseFile, Verdict } from './types';

/**
 * The two reads that make up a settled dispute: the ruling, and the evidence it
 * was made from.
 *
 * They live together and not in `orders.ts` because that file is the order
 * lifecycle — purchase, poll, accept, complain — and its long argument about
 * `POST /orders` not being idempotent is a rule about writes with nothing to say
 * about either of these. Both of these are reads of a record that cannot change:
 * one verdict per order, no appeals (`docs/product-workflow.md` §4.4), and a
 * case file describing an execution that finished before the dispute was filed.
 * That immutability is what lets the hooks above them fetch once and stop.
 *
 * Neither endpoint exists yet. The assumed payloads, and the thirteen things to
 * confirm when the API's Guardian module lands, are in
 * `specs/005-verdict-card/contracts/internal-api.md` §6.
 */

/**
 * `GET /orders/:id/verdict` — the ruling.
 *
 * **Normalised here rather than at the point of use**, which is the whole reason
 * this wrapper is more than a one-liner. `verdicts.citations` is an unvalidated
 * `jsonb` column, so the shape that arrives is not guaranteed by anything
 * upstream; `normaliseVerdict` turns whatever came into rows this screen can
 * render, counting what it could not read instead of dropping it silently. Doing
 * that here means no component ever handles a `RawCitation`, and there is
 * exactly one place to change when the payload's real shape is known.
 *
 * A 404 is expected and ordinary: it is what an order that has not been ruled on
 * returns. `useVerdict` only calls this once the order says a verdict exists, so
 * a 404 here means the two disagree — which stops the poll rather than retrying
 * a question the backend has already answered.
 */
export function fetchVerdict(orderId: string): Promise<Verdict> {
  return apiGet<unknown>(`/orders/${orderId}/verdict`).then(normaliseVerdict);
}

/**
 * `GET /orders/:id/case-file` — the evidence, redacted for the buyer.
 *
 * The redaction happens upstream and must not be attempted here (FR-027). This
 * app cannot tell a summarised sentence from a leaked one, so a client-side
 * filter would be theatre that also hid the serialiser's failure. What it does
 * instead is refuse to have anywhere to put a prompt: `normaliseCaseFile` copies
 * named fields onto `CaseFile` and `CaseFileStep`, neither of which has a field
 * a system prompt could land in, so a serialiser regression upstream produces a
 * missing sentence here rather than a leak.
 */
export function fetchCaseFile(orderId: string): Promise<CaseFile> {
  return apiGet<unknown>(`/orders/${orderId}/case-file`).then(normaliseCaseFile);
}
