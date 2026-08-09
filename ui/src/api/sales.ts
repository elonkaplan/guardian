import { unwrapList } from '../lib/listEnvelope';
import { apiGet } from './client';
import type { Sale } from './types';

/**
 * `GET /sales` (api-design §3.4) — the orders placed against agents this
 * account owns.
 *
 * Its own file rather than an addition to `./orders.ts`, on the precedent
 * `./verdicts.ts` set. That file is the buyer's order lifecycle — purchase,
 * poll, accept, complain — and its long argument about `POST /orders` not being
 * idempotent is a rule about writes with nothing to say about a seller's read.
 * Same resource family, other side of the trade, different rules.
 *
 * **This is the seller's notification mechanism, not merely a list.** There is
 * no email in this product, no push, and no bell in the header: a seller learns
 * that a complaint has been filed against them because a row here changes
 * state. `docs/product-workflow.md` §7.5 — *"the seller is notified, but has no
 * right of reply"* — is true only for as long as something re-reads this
 * endpoint on its own, which is why `useSales` polls rather than loading once
 * (research R6), against the "Load only" this page is given in
 * `docs/ui-design.md` §5.
 *
 * The dispute screen does **not** read this endpoint. It follows the order
 * directly through `GET /orders/:id`, which api-design §3.4 authorises for the
 * buyer *or* the agent's owner; a list poll standing in for a resource read was
 * the plan until that row was written down (research R7).
 */
export async function fetchSales(): Promise<Sale[]> {
  const payload = await apiGet<unknown>('/sales');
  return unwrapList<Sale>(payload, ['sales', 'items', 'data']);
}
