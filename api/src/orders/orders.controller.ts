import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';

import { CurrentAccount } from '../auth/current-account.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { Account } from '../entities/account.entity';
import { CaseFileService } from './case-file.service';
import { complainSchema, type ComplainDto } from './dto/complain.dto';
import { createOrderSchema, type CreateOrderDto } from './dto/create-order.dto';
import type {
  BuyerCaseFileResponse,
  SellerCaseFileResponse,
} from './dto/case-file.dto';
import type {
  BuyerOrderSummary,
  CreateOrderResponse,
  OrderResponse,
} from './dto/order-response.dto';
import { toHttpException } from './orders-http';
import { OrdersService } from './orders.service';
import { PurchaseService } from './purchase.service';
import { SettlementService } from './settlement.service';

/**
 * The buyer's side of an order: buying it, following it, and ending it.
 *
 * ## ⚠️ There is no `@Public()` and no `@OptionalAuth()` in this file
 *
 * The global `JwtAuthGuard` is fail-closed, so every route here is protected by
 * saying nothing — and every route here *must* be. An order is one buyer's
 * purchase and one seller's sale; there is no anonymous view of one, and adding
 * either decorator to a handler in this file would be a disclosure, not a
 * convenience. `@CurrentAccount()` is the whole contract with `auth/`.
 *
 * ## ⚠️ The reads and the writes have different authorisation, on purpose
 *
 * `GET /orders/:id` and `GET /orders/:id/case-file` admit the buyer **or** the
 * owner of the agent the order was placed against. `POST /:id/accept` and
 * `POST /:id/complain` admit the buyer alone, and a seller reaching them gets
 * `404` — the same answer a stranger gets.
 *
 * That asymmetry is the product decision, not an oversight: the seller is
 * notified of a dispute and has **no right of reply**
 * (`docs/product-workflow.md` §7.5). The narrow version — authorising the two
 * reads on `buyer_account_id` alone, which is the natural thing to write —
 * silently deletes half the seller experience: a seller told a dispute has been
 * filed, who then cannot open the case file, has been notified of an accusation
 * they are not allowed to see.
 *
 * ## Errors
 *
 * Handlers catch and delegate to `orders-http.ts`. The services throw plain
 * errors so the whole cause-to-status mapping is readable in one file — the same
 * argument `catalog-http.ts` makes, and it matters as much here, because
 * `OrderNotVisibleError` must render as `404` at every single call site and a
 * throw-site decision would only ever see one of them.
 */
@Controller('orders')
export class OrdersController {
  constructor(
    private readonly purchase: PurchaseService,
    private readonly settlement: SettlementService,
    private readonly orders: OrdersService,
    private readonly caseFiles: CaseFileService,
  ) {}

  /**
   * `GET /orders` — every order this account placed, newest first.
   *
   * A bare JSON array, no envelope, matching the rest of this API.
   */
  @Get()
  async list(@CurrentAccount() account: Account): Promise<BuyerOrderSummary[]> {
    try {
      return await this.orders.listMine(account.id);
    } catch (err) {
      throw toHttpException(err);
    }
  }

  /**
   * `GET /orders/:id` — the read the order screen polls once a second.
   *
   * ⚠️ **Buyer or the agent's owner.** See the class docblock: this is the pair
   * of routes where the narrow check silently deletes the seller experience.
   */
  @Get(':id')
  async getOne(
    @CurrentAccount() account: Account,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<OrderResponse> {
    try {
      return await this.orders.getOrder(account.id, id);
    } catch (err) {
      throw toHttpException(err);
    }
  }

  /**
   * `GET /orders/:id/case-file` — the evidence, redacted for the buyer and
   * complete for the seller.
   *
   * ## ⚠️ This route branches on the caller. The serialiser does not.
   *
   * 006 forbade one route returning different shapes to different callers, and
   * this feature's FR-035 requires exactly that — the client reads one path for
   * both parties. The tension resolves by being precise about which layer must
   * not branch:
   *
   * | Layer | Branches? |
   * | --- | --- |
   * | This route | **yes** — after the role is resolved and the caller is already authorised |
   * | The query | **yes** — the buyer's `SELECT` does not name `system_prompt` |
   * | The mapper | **no** — two closed functions, neither with a mode flag |
   *
   * What 006 was protecting is the mapper: a conditional deciding what a caller
   * may see is a disclosure bug waiting to happen. That property holds. Pushing
   * the branch down into the query is *stronger* than a mapper guarantee alone —
   * on a buyer's read the prompt never enters the process, so it cannot reach a
   * log line or a stack trace either.
   *
   * Answers for an order in **any** state. A `purchased` order returns
   * `output: null` and `steps: []`; that is content, not an error — the absence
   * of an output is how non-delivery is proven.
   */
  @Get(':id/case-file')
  async getCaseFile(
    @CurrentAccount() account: Account,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<BuyerCaseFileResponse | SellerCaseFileResponse> {
    try {
      const role = await this.orders.resolveViewerRole(account.id, id);

      return role === 'seller'
        ? await this.caseFiles.getForSeller(id, account.id)
        : await this.caseFiles.getForBuyer(id, account.id);
    } catch (err) {
      throw toHttpException(err);
    }
  }

  /**
   * `POST /orders` — the purchase saga.
   *
   * ⚠️ **Not idempotent, and there is deliberately no idempotency key.** The
   * order row and its ledger debit commit before the escrow call is even
   * attempted, so a client timeout says nothing about whether the purchase
   * happened. `ui/src/api/orders.ts` documents the consequence on its side —
   * this call must never be auto-retried, by react-query or by a "try again"
   * button — and that rule depends on there being no key here. If one is ever
   * added, that comment can be deleted; until then it stands.
   *
   * Answers `201` as soon as the escrow deal confirms. It does **not** wait for
   * the agent to run: the order is left in `purchased` with a confirmed deal id,
   * which is the queue entry execution consumes (invariant #9).
   */
  @Post()
  async create(
    @CurrentAccount() account: Account,
    @Body(new ZodValidationPipe(createOrderSchema)) body: CreateOrderDto,
  ): Promise<CreateOrderResponse> {
    try {
      return await this.purchase.createOrder(account, body);
    } catch (err) {
      throw toHttpException(err);
    }
  }

  /**
   * `POST /orders/:id/accept` — the buyer takes delivery and releases the money.
   *
   * No body: the id in the path is the whole request. `202` with nothing worth
   * reading — `ui/src/api/orders.ts` discards the response deliberately, because
   * the order screen re-reads the order every second and that poll is the
   * authority on what the order now is.
   *
   * ⚠️ **Buyer only.** A seller reaching this gets the same `404` a stranger
   * does. That is not the same rule as the two reads below, which admit the
   * seller — see the class docblock.
   */
  @Post(':id/accept')
  @HttpCode(202)
  async accept(
    @CurrentAccount() account: Account,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ id: string }> {
    try {
      await this.settlement.accept(account, id);

      return { id };
    } catch (err) {
      throw toHttpException(err);
    }
  }

  /**
   * `POST /orders/:id/complain` — the buyer disputes and hands the order to the
   * auditor.
   *
   * ⚠️ **Buyer only**, for the same reason as accept, and one more: the seller is
   * notified of the dispute and has no right of reply
   * (`docs/product-workflow.md` §7.5). A route that let them respond would be
   * building an appeal process the product decided against.
   *
   * Retrying this call is safe in a way retrying `POST /orders` is not — the
   * second attempt meets an order that has already moved and is refused, rather
   * than charging anyone twice.
   */
  @Post(':id/complain')
  @HttpCode(202)
  async complain(
    @CurrentAccount() account: Account,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(complainSchema)) body: ComplainDto,
  ): Promise<{ id: string }> {
    try {
      await this.settlement.complain(account, id, body.reason);

      return { id };
    } catch (err) {
      throw toHttpException(err);
    }
  }
}
