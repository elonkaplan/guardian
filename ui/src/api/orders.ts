import { apiPost } from './client';
import type { CreateOrderRequest, CreateOrderResponse } from './types';

/**
 * Orders. Today just the purchase; UI-04 adds accept, complain, and the reads.
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
 */
export function createOrder(request: CreateOrderRequest): Promise<CreateOrderResponse> {
  return apiPost<CreateOrderResponse>('/orders', request);
}
