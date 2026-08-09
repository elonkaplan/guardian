import { unwrapList } from '../lib/listEnvelope';
import { apiGet, apiPost } from './client';
import type {
  BuyerOrderSummary,
  ComplainRequest,
  CreateOrderRequest,
  CreateOrderResponse,
  Order,
} from './types';

/**
 * Orders: the purchase, the read the order screen follows, and the two actions
 * a buyer can take on it.
 *
 * **`POST /orders` is not idempotent, and this is the file that says so.**
 *
 * The backend commits the order row and the negative ledger entry in a single
 * Postgres transaction and only then answers (api-design §4). A client timeout
 * — ours fires at 10 seconds — therefore tells us nothing about whether that
 * transaction committed. Retrying on no-answer is how a buyer pays twice.
 *
 * So: never retry this call automatically. Not through react-query's `retry`
 * (already `false` app-wide, and it must stay that way for this call), not
 * through a helpful "try again" button on a timeout, not through a resubmit on
 * a back navigation. A refusal — a 4xx, where the backend definitively did not
 * create anything — is the opposite case and is safe to correct and retry.
 *
 * If API-07 ever accepts a client-supplied idempotency key, this comment and
 * the ambiguous branch in `BuyPanel` can both be deleted.
 *
 * ---
 *
 * **Scope of that rule: `POST /orders` only. It does not extend to accept and
 * complain below.** This is written down because someone will otherwise read
 * the paragraphs above, see two more POSTs in the same file, and copy the rule
 * onto them — which would be cargo-culting, and would cost the buyer the one
 * mechanism that actually recovers those calls.
 *
 * The difference is what is watching the result. A purchase debits a ledger
 * with no screen following the outcome, so silence is unresolvable. Accept and
 * complain are state transitions on an order whose page is re-reading that
 * order every second: a call that got no answer is resolved by the next poll,
 * not by a retry. If the complaint landed, the state becomes `disputed` within
 * a second and the page corrects itself with no user action at all. And a
 * duplicate submission is harmless here in a way a duplicate purchase is not —
 * the second call meets an order that has already moved and is refused, rather
 * than charging anyone twice.
 *
 * So the poll is the reconciliation mechanism for these two, and the right
 * behaviour on silence is to say we did not hear back and let the page update
 * itself. See research R11.
 */
export function createOrder(request: CreateOrderRequest): Promise<CreateOrderResponse> {
  return apiPost<CreateOrderResponse>('/orders', request);
}

/**
 * `GET /orders` — every order this account bought, newest first. The buyer's
 * side of `fetchSales`.
 *
 * Shape-tolerant, and note that this sits ten lines above a docblock arguing
 * that `fetchOrder` should not be. Both are the same rule applied to two
 * different failures, not an inconsistency: a list is the asymmetric case, where
 * an envelope misread as an array yields `[]` and the page faithfully reports
 * "No orders yet" — a plausible, silent, wrong success that looks exactly like a
 * new account. A resource read that misses a field renders a blank cell, which
 * is loud. Only the failure that lies convincingly earns the defensive branch,
 * which is why `fetchAgents` and `fetchSales` unwrap and `fetchOrder` does not.
 *
 * The contract says a bare array with no envelope, so on a correct backend the
 * first branch of `unwrapList` is the only one that ever runs.
 *
 * `BuyerOrderSummary`, never `Order` and never `Sale` — see the type for why
 * three views of one resource is the correct number.
 */
export async function listOrders(): Promise<BuyerOrderSummary[]> {
  const payload = await apiGet<unknown>('/orders');
  return unwrapList<BuyerOrderSummary>(payload, ['orders', 'items', 'data']);
}

/**
 * `GET /orders/:id` — the read the order screen polls.
 *
 * No shape tolerance, deliberately. The two list reads in this API layer —
 * `fetchAgents`, and `listOrders` directly above — unwrap a possible envelope,
 * and neither is a precedent to follow here, because the two failures are not
 * the same kind of failure.
 *
 * There, an envelope misread as an array yields an empty array, and the
 * marketplace faithfully reports that as "no agents are listed yet" — a
 * plausible, silent, wrong success, and an empty stage with no error for anyone
 * to point at. Here, a wrong field name renders as a missing countdown or an
 * empty output panel: loud, immediate, and fixed in this one file. Only the
 * asymmetric failure — the one that lies convincingly — earns a defensive
 * branch. A cast is the honest description of what is happening either way.
 */
export function fetchOrder(id: string): Promise<Order> {
  return apiGet<Order>(`/orders/${encodeURIComponent(id)}`);
}

/**
 * `POST /orders/:id/accept` — the buyer takes delivery and releases the money.
 * No body: the order id in the path is the whole of the request.
 *
 * Typed `apiPost<unknown>` and awaited rather than returned, so that discarding
 * the response is a thing this function does on purpose rather than something
 * the `Promise<void>` signature quietly swallowed. There is a body on the wire
 * and we are choosing not to read it — the next poll is the authority on what
 * the order now is, and it is one second away. Declaring `apiPost<void>` would
 * instead assert the endpoint returns nothing, which is a claim about an API
 * that is not built yet.
 *
 * Allowed to reject, and the caller re-reads the order either way: on a refusal
 * the new state is what explains the refusal (research R12).
 */
export async function acceptOrder(id: string): Promise<void> {
  await apiPost<unknown>(`/orders/${encodeURIComponent(id)}/accept`);
}

/**
 * `POST /orders/:id/complain` — the buyer disputes the delivery and hands the
 * order to Guardian. The reason travels as the only field in the body.
 *
 * The `reason` parameter is a plain string rather than a `ComplainRequest`,
 * because the caller is a form with one textarea and should not have to know
 * the wire shape to fill it in. The type is still applied to the body here, so
 * a renamed field is a compile error in this file rather than a request the
 * backend rejects at runtime.
 *
 * Response discarded, for the same reason as `acceptOrder` above.
 */
export async function complainAboutOrder(id: string, reason: string): Promise<void> {
  const body: ComplainRequest = { reason };
  await apiPost<unknown>(`/orders/${encodeURIComponent(id)}/complain`, body);
}
