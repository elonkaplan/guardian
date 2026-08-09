import { Injectable } from '@nestjs/common';

import type {
  BuyerOrderSummary,
  OrderResponse,
  SaleResponse,
} from './dto/order-response.dto';
import { OrderRepository, type VisibleOrderRow } from './order.repository';
import {
  toBuyerOrderSummary,
  toOrderResponse,
  toSaleResponse,
} from './order-serialiser';
import { OrderNotVisibleError } from './orders.errors';

/**
 * The reads: one order, the buyer's orders, the seller's sales.
 *
 * **No transactions and no chain calls anywhere in this file**, which is why it
 * is separate from `purchase.service.ts` and `settlement.service.ts`. Those two
 * hold row locks across writes; this one is polled every second by the order
 * screen. Keeping them apart means a `FOR UPDATE` is never one careless edit
 * away from the hottest query in the module — the same split `catalog/` made
 * between `agents.service.ts` and `agent-writes.service.ts`.
 */
@Injectable()
export class OrdersService {
  constructor(private readonly orders: OrderRepository) {}

  /**
   * One order, for the buyer **or** the owner of the agent it was placed
   * against.
   *
   * ## ⚠️ The seller half of this is the thing most likely to be dropped
   *
   * Authorising on `buyer_account_id` alone is the natural check to write, it
   * passes every test a buyer would run, and it silently removes half the
   * product: a seller who is told a dispute has been filed and then cannot open
   * the order has been notified of an accusation they are not allowed to see.
   * The repository's join carries `owner_account_id` for exactly this, so the
   * check costs nothing beyond remembering to make it.
   *
   * ⚠️ **`OrderNotVisibleError` renders as `404`, never `403`.** A `403` would
   * confirm to a stranger that an order id is real. "No such order" and "not
   * yours" are one answer here, and the repository returns one `null` for both
   * so that no code in this file *can* tell them apart.
   */
  async getOrder(accountId: string, orderId: string): Promise<OrderResponse> {
    const row = await this.requireVisible(accountId, orderId);

    return toOrderResponse(row);
  }

  /**
   * Whether this account is the agent's owner rather than the buyer — the fact
   * the case-file route branches on.
   *
   * It is resolved here rather than in the controller because it needs the same
   * join `getOrder` already does, and because the two questions must be answered
   * from one row: a caller who is visible but whose role was computed from a
   * second, later read could be handed the wrong copy if ownership changed
   * between them.
   */
  async resolveViewerRole(
    accountId: string,
    orderId: string,
  ): Promise<'buyer' | 'seller'> {
    const row = await this.requireVisible(accountId, orderId);

    // ⚠️ Buyer wins when one account is both. Ordering an agent you own is
    // allowed, and in that case the account is party to both sides — so the
    // question "which copy do they get" has two right answers and this picks the
    // narrower one. Nothing is lost: the seller's copy adds only their own
    // prompt, which they can read from their own catalogue.
    return row.buyerAccountId === accountId ? 'buyer' : 'seller';
  }

  /** Every order this account placed, newest first, in any state. */
  async listMine(accountId: string): Promise<BuyerOrderSummary[]> {
    const rows = await this.orders.findByBuyer(accountId);

    return rows.map(toBuyerOrderSummary);
  }

  /**
   * Every order placed against an agent this account owns.
   *
   * ⚠️ **This is the seller's only notification mechanism.** There is no email,
   * no push and no bell in the header, so `docs/product-workflow.md` §7.5's *"the
   * seller is notified"* is true precisely for as long as something re-reads this
   * list — which is why `ui/src/api/sales.ts` polls it rather than loading once.
   * A change that made this list cheaper by caching it would quietly disable the
   * notification.
   */
  async listSales(accountId: string): Promise<SaleResponse[]> {
    const rows = await this.orders.findBySeller(accountId);

    return rows.map(toSaleResponse);
  }

  /** The visibility gate both single-order reads pass through. */
  private async requireVisible(
    accountId: string,
    orderId: string,
  ): Promise<VisibleOrderRow> {
    const row = await this.orders.findVisibleToAccount(orderId, accountId);

    if (row === null) {
      throw new OrderNotVisibleError(
        `order ${orderId} is not visible to this account`,
        orderId,
      );
    }

    return row;
  }
}
