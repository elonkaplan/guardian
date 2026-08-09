import { Controller, Get } from '@nestjs/common';

import { CurrentAccount } from '../auth/current-account.decorator';
import { Account } from '../entities/account.entity';
import type { SaleResponse } from './dto/order-response.dto';
import { toHttpException } from './orders-http';
import { OrdersService } from './orders.service';

/**
 * `GET /sales` — the same trades as `/orders`, from the other side of the
 * counter.
 *
 * ## Its own controller, not a route on `/orders`
 *
 * `/sales` is a different path prefix, and `@Controller('sales')` takes one — so
 * sharing a class would mean dropping the prefix and hand-writing full paths on
 * every route in both. It is also a different side of the trade with different
 * rules: `orders.controller.ts` is the buyer's lifecycle and carries a long
 * argument about `POST /orders` not being idempotent, which has nothing to say
 * about a seller's read. `ui/src/api/sales.ts` made exactly this split, for
 * exactly this reason.
 *
 * ## ⚠️ This endpoint is the seller's ONLY notification mechanism
 *
 * There is no email in this product, no push, and no bell in the header. A
 * seller learns that a complaint has been filed against them because a row in
 * this list changes state — which is why `useSales` polls rather than loading
 * once. `docs/product-workflow.md` §7.5's *"the seller is notified, but has no
 * right of reply"* is true precisely for as long as something re-reads this
 * endpoint.
 *
 * That has a consequence worth stating before someone optimises it: **caching
 * this response, or making the client load it once, silently removes the
 * notification.** The seller would find out about a dispute by refreshing the
 * page for unrelated reasons.
 *
 * ## What a seller does not learn here
 *
 * There is no buyer address in `SaleResponse`. The seller learns what was
 * ordered, what it cost, and what was ruled — not who bought it. The dispute
 * screen reads `GET /orders/:id` directly, which authorises the buyer *or* the
 * agent's owner, so nothing in this list has to stand in for a full order.
 */
@Controller('sales')
export class SalesController {
  constructor(private readonly orders: OrdersService) {}

  /**
   * Every order placed against any agent this account owns, newest first.
   *
   * Includes sales of agents the seller has since made unavailable: taking an
   * agent down stops new purchases, it does not erase the ones already made.
   *
   * A bare JSON array. `200 []` for an account that owns nothing or has sold
   * nothing — never a `404`.
   */
  @Get()
  async list(@CurrentAccount() account: Account): Promise<SaleResponse[]> {
    try {
      return await this.orders.listSales(account.id);
    } catch (err) {
      throw toHttpException(err);
    }
  }
}
