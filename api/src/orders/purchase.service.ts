import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import type { Address } from 'viem';

import { validateAgainstSchema } from '../catalog/schema-validation';
import { ChainError, ChainOutcomeUnknownError } from '../chain/errors';
import type { AppConfig } from '../config/env.schema';
import { EscrowOperatorService } from '../chain/escrow-operator.service';
import type { Account } from '../entities/account.entity';
import type { Order } from '../entities/order.entity';
import { LedgerKind } from '../entities/enums';
import { InsufficientBalanceError } from '../ledger/ledger.errors';
import { LedgerRepository } from '../ledger/ledger.repository';
import type { CreateOrderDto } from './dto/create-order.dto';
import type { CreateOrderResponse } from './dto/order-response.dto';
import { AgentNotPurchasableError, InsufficientFundsForPurchaseError } from './orders.errors';
import { OrderRepository } from './order.repository';

/**
 * The purchase saga — the riskiest flow in the backend, and the one place money,
 * the chain and asynchronous work meet inside a single request.
 *
 * ```text
 * 1. VALIDATE          agent purchasable · input matches inputSchema
 * 2. ONE TRANSACTION   lock buyer · sum ledger · refuse · insert order · insert debit
 *                      └─ COMMIT
 * 3. CHAIN             openDeal(...) → store the deal id
 *                      ├─ knowable failure  → state=failed + compensating credit
 *                      └─ unknown outcome   → change NOTHING
 * 4. ANSWER            201; execution picks the order up from its state
 * ```
 *
 * ---
 *
 * ## ⚠️ Step 2 commits BEFORE step 3. This is the opposite of `catalog/`.
 *
 * `catalog/agent-writes.service.ts` puts its chain call *inside* the uncommitted
 * transaction, so a chain failure rolls back and records nothing — which deletes
 * the compensation path rather than having to get it right. That is the better
 * shape wherever it applies, and it does not apply here. **Do not copy it into
 * this file.**
 *
 * The difference is what a rollback destroys. In the catalogue, a rolled-back
 * `registerAgent` loses an agent row nobody has paid for. Here, a rollback loses
 * **the only record that a particular buyer's money entered escrow**. If
 * `openDeal` was broadcast and later confirms, the contract holds real tokens
 * against a deal whose order row was rolled away — money locked with no record
 * of whose it is, recoverable only by reading event logs by hand.
 *
 * `docs/CONTEXT.md` invariant #1 ranks exactly that outcome as the one worth
 * paying a compensation path to avoid: *"a bad DB write is one compensating row,
 * a stray on-chain deal is recoverable only by hand."* So the rule is not "chain
 * calls go inside transactions" — it is **whichever side is unrecoverable goes
 * second, and the recoverable side is committed first so it survives to describe
 * what happened.**
 *
 * `settlement.service.ts` uses the catalogue's shape, correctly, because neither
 * accepting nor complaining can strand money that is already escrowed.
 *
 * (`specs/007-orders-purchase-saga/research.md` R2)
 */
@Injectable()
export class PurchaseService {
  private readonly logger = new Logger(PurchaseService.name);
  private readonly reviewWindowSeconds: number;

  constructor(
    private readonly dataSource: DataSource,
    private readonly orders: OrderRepository,
    private readonly ledger: LedgerRepository,
    private readonly escrow: EscrowOperatorService,
    config: ConfigService<AppConfig, true>,
  ) {
    // Read once at construction, not per request. `env.schema.ts` declares
    // REVIEW_WINDOW_SECONDS as `.int().min(1)` with **no default**, so a zero or
    // absent window is a boot failure rather than a runtime branch — there is no
    // running process in which the bad value exists. That is FR-014's guard, and
    // it is stronger than a check here could be, because configuration cannot be
    // bypassed by a caller.
    //
    // ⚠️ A zero review window is the silent killer: the complaint button never
    // works, the order auto-releases instantly, and nothing raises an error
    // anywhere (`docs/smart-contract.md` §11.3).
    this.reviewWindowSeconds = config.get('REVIEW_WINDOW_SECONDS', { infer: true });
  }

  /**
   * Buy an agent's service. Returns as soon as the escrow deal is confirmed.
   *
   * The buyer comes from the authenticated session and never from the request
   * body (FR-006) — there is no field for it to arrive in.
   */
  async createOrder(account: Account, dto: CreateOrderDto): Promise<CreateOrderResponse> {
    // ─── 1. VALIDATE ────────────────────────────────────────────────────
    // All of it before any transaction and before any chain call. A bad input
    // is a `400` the caller can fix, and there is no reason for it to cost a row
    // lock or a gas-priced revert — the same argument `agent-writes.service.ts`
    // makes for validating schemas before opening its transaction.
    const version = await this.orders.findPurchasableVersion(dto.agentId);

    if (version === null) {
      // Unknown, inactive, or never registered on-chain — one refusal for three
      // facts, so no response can confirm which. See `orders.errors.ts`.
      throw new AgentNotPurchasableError(
        `agent ${dto.agentId} cannot be purchased`,
        dto.agentId,
      );
    }

    const validation = validateAgainstSchema(version.inputSchema, dto.input);

    if (!validation.valid) {
      // `fieldErrors.input` carries Ajv's own message, JSON Pointer and all, so
      // the buyer is told *where* their document failed rather than that it did.
      // The shape matches what `zod-validation.pipe.ts` produces for a body
      // failure, so the client has one error format to render.
      throw new BadRequestException({
        message: 'Input does not satisfy the agent’s declared input schema',
        fieldErrors: { input: [validation.errors] },
      });
    }

    // `bigint` columns come off a raw select as strings; convert once, here, at
    // the boundary — the same conversion `balance.repository.ts` does.
    const priceMinor = Number(version.priceMinor);

    // ─── 2. ONE TRANSACTION ─────────────────────────────────────────────
    const order = await this.runPurchaseTransaction(account, version, dto, priceMinor);

    // ─── 3. CHAIN ───────────────────────────────────────────────────────
    return this.openDealFor(account, version, order, priceMinor);
  }

  /**
   * The Postgres phase: one transaction, and the buyer's ledger error translated
   * into this module's vocabulary on the way out.
   *
   * ## ⚠️ Why the translation is not optional
   *
   * `LedgerRepository.debitWithinTransaction` throws `InsufficientBalanceError`,
   * which belongs to `ledger/` — a different module with a different hierarchy.
   * `orders-http.ts` maps `OrdersError` subclasses and delegates everything else
   * to the chain mapper, which rethrows what it does not recognise. So an
   * untranslated ledger error leaves this file as a `500`: *"something broke"*
   * for the single most ordinary refusal in the product, a buyer who cannot
   * afford what they clicked.
   *
   * It also loses the two figures. `InsufficientFundsForPurchaseError` carries
   * `availableBalanceMinor` and `priceMinor` so the client can say *"you have
   * $2.50, this costs $5.00"* without a second round trip, and a `500` carries
   * nothing at all.
   *
   * This was caught by `scripts/verify-007.mjs`, not by reading the code: the
   * declared throw and the actual throw were different classes, and nothing in
   * the type system relates them.
   */
  private async runPurchaseTransaction(
    account: Account,
    version: { agentVersionId: string },
    dto: CreateOrderDto,
    priceMinor: number,
  ): Promise<Order> {
    try {
      return await this.dataSource.transaction(async (manager) => {
      // ⚠️ The order is inserted BEFORE the debit, and the ordering is forced by
      // the schema rather than chosen: `ledger_entries.order_id` carries
      // `REFERENCES orders(id)`, so a debit written first fails the foreign key.
      // The natural reading of "take the money, then record what it bought" does
      // not compile.
      const row = await this.orders.insertOrder(manager, {
        buyerAccountId: account.id,
        agentVersionId: version.agentVersionId,
        // Both of these are SNAPSHOTS, not live reads (FR-011). A seller
        // republishing a second later cannot move what this buyer was charged,
        // and turning the review window down between rehearsals cannot retime an
        // order that was already sold.
        priceMinor,
        reviewWindowSeconds: this.reviewWindowSeconds,
        input: dto.input,
        acceptanceCriteria: dto.acceptanceCriteria,
      });

      // ⚠️ The affordability check lives INSIDE this call and inside this
      // transaction, behind a `FOR UPDATE` on the buyer's `accounts` row. That
      // is what makes two simultaneous purchases against one balance resolve to
      // one order and one refusal instead of two orders and a negative balance
      // (FR-008). `debitWithinTransaction` throws before writing anything if the
      // ledger is short, and the throw rolls this order insert back with it.
      //
      // `amountMinor` is passed POSITIVE — the amount being taken out — and the
      // repository writes its negation. One place a sign error is possible, and
      // it is the place that just compared the magnitude against the balance.
      await this.ledger.debitWithinTransaction(manager, {
        accountId: account.id,
        amountMinor: priceMinor,
        kind: LedgerKind.Purchase,
        orderId: row.id,
      });

        return row;
      });
    } catch (err) {
      if (err instanceof InsufficientBalanceError) {
        // Nothing was written — the throw happened inside the transaction and
        // before the insert, so the rollback is total and the lock is released.
        throw new InsufficientFundsForPurchaseError(
          `available balance is ${err.availableMinor} cents, price is ${priceMinor} cents`,
          err.availableMinor,
          priceMinor,
        );
      }

      throw err;
    }
  }

  /**
   * The chain phase, which runs **after** the transaction above has committed.
   *
   * From here on a failure cannot be undone by a rollback — it has to be
   * compensated, or deliberately left alone. See the class docblock and
   * `settleFailedOpen`.
   */
  private async openDealFor(
    account: Account,
    version: { onchainAgentId: string },
    order: Order,
    priceMinor: number,
  ): Promise<CreateOrderResponse> {
    try {
      // ⚠️ No amount is passed. The contract charges `agent.price` from its own
      // storage, which is what makes the escrowed amount a snapshot rather than
      // a parameter — the price a buyer was shown cannot drift from the price
      // escrowed. Passing one would not merely be redundant; there is no
      // parameter for it, and inventing a path for one would break that
      // property.
      //
      // The review window is ours, from config, never from the request (FR-014).
      const tx = await this.escrow.openDeal(
        BigInt(version.onchainAgentId),
        account.walletAddress as Address,
        this.reviewWindowSeconds,
      );

      // Sequential `uint256` ids from a fresh contract; `Number` is exact far
      // beyond any deal id this platform will see, and the column's transformer
      // speaks `number` on both sides.
      const onchainDealId = Number(tx.value);

      await this.orders.setOnchainDealId(order.id, onchainDealId);

      this.logger.log(
        `order ${order.id} opened as deal #${onchainDealId} ` +
          `priceMinor=${priceMinor} reviewWindow=${this.reviewWindowSeconds}s tx=${tx.hash}`,
      );
    } catch (err) {
      // The three-outcome branch lives in `settleFailedOpen`, added by US2.
      // ⚠️ It is not a single compensation path: a receipt timeout is NOT a
      // failure and must not be compensated.
      await this.settleFailedOpen(order.id, account.id, priceMinor, err);
      throw err;
    }

    // ─── 4. ANSWER ──────────────────────────────────────────────────────
    // Thin by design: the client wants an id to navigate to, and `GET /orders/:id`
    // is the authority on everything else.
    //
    // Nothing is dispatched here. The order now sits in `purchased` with a
    // confirmed deal id, which IS the queue entry execution consumes —
    // `orders.state` is the queue (invariant #9), so there is no broker to
    // notify and no dispatcher to await (R13).
    return { id: order.id };
  }

  /**
   * What to do about an order whose `openDeal` did not return a deal id.
   *
   * ## ⚠️ There are THREE outcomes, not two, and only one of them compensates
   *
   * | Outcome | Order | Ledger | Why |
   * | --- | --- | --- | --- |
   * | Knowable failure — revert, gas, connectivity, funds | `state = 'failed'` | **+ compensating credit** | Nothing was escrowed, so restoring the balance restores the buyer completely |
   * | **`ChainOutcomeUnknownError`** — broadcast, no receipt | **unchanged** | **nothing** | The transaction may still confirm; the money may genuinely be escrowed |
   *
   * ## Why compensating an unknown outcome is the worst bug this file can have
   *
   * `chain/errors.ts` calls `ChainOutcomeUnknownError` *"THE MOST IMPORTANT
   * ERROR IN THIS MODULE"* and states the rule: a receipt timeout is **not** a
   * failure, and must not be treated as one.
   *
   * If the credit is written and the transaction then confirms, the buyer's
   * spendable balance has been restored *and* their money is locked in escrow.
   * The operator pool now holds **less** than the ledger claims — `pool >= Σ
   * ledger` broken in the one direction no later row can repair, because the
   * tokens are on-chain in a deal we would have to unwind by hand. Every other
   * mistake in this feature costs a wrong number on a screen; this one costs
   * solvency.
   *
   * So the unknown branch writes nothing at all. The order rests in `purchased`
   * with a NULL deal id, which is a legitimate row shape rather than a loose end:
   * it keeps the money visible in `inEscrowMinor` (which is where it probably
   * is), and `docs/api-design.md` §6 already assigns it an owner — the
   * confirmation-retry job (API-10), *"`onchain_deal_id IS NULL` past a grace
   * period → retry or fail"*.
   *
   * ⚠️ **That job must not resolve one by calling `openDeal` again.** The
   * contract assigns a new deal on every call, so a retry against a transaction
   * that later confirms leaves two deals escrowing two prices for one order.
   *
   * The caller rethrows either way: the buyer is told the purchase did not
   * complete, and cannot act on the difference between the two. The platform
   * must.
   *
   * (`specs/007-orders-purchase-saga/research.md` R3)
   */
  private async settleFailedOpen(
    orderId: string,
    accountId: string,
    priceMinor: number,
    err: unknown,
  ): Promise<void> {
    if (err instanceof ChainOutcomeUnknownError) {
      // ⚠️ Deliberately no writes. Read the docblock above before "tidying" this
      // branch into the one below — they look like the same failure and are not.
      this.logger.error(
        `openDeal outcome UNKNOWN for order ${orderId}; ` +
          `left in 'purchased' with NULL onchain_deal_id, NOT compensated, NOT retryable. ` +
          `The ${priceMinor}¢ may be escrowed — awaiting the confirmation-retry job. ` +
          `tx=${err.hash}`,
      );
      return;
    }

    // A knowable failure: nothing was escrowed, so the buyer is made whole.
    //
    // One transaction for both writes, so an order can never be `failed` without
    // its compensating credit, or vice versa.
    try {
      await this.dataSource.transaction(async (manager) => {
        await this.orders.markFailed(manager, orderId);

        // ⚠️ `appendEntry`, not a reversal or an update. The ledger is
        // append-only (invariant #4): the original debit STAYS, and the
        // correction sits beside it, so the buyer's statement shows what was
        // attempted and what was given back rather than quietly showing neither
        // (FR-019). `adjustment` is the kind that exists for exactly this.
        //
        // Positive, and equal to the debit's magnitude to the cent.
        await this.ledger.appendEntry(
          {
            accountId,
            amountMinor: priceMinor,
            kind: LedgerKind.Adjustment,
            orderId,
            externalRef: err instanceof ChainError ? err.operation : null,
          },
          manager,
        );
      });

      this.logger.warn(
        `openDeal FAILED for order ${orderId}; marked 'failed' and credited ` +
          `${priceMinor}¢ back to account ${accountId}`,
      );
    } catch (compensationError) {
      // ⚠️ The worst outcome in the feature: the buyer has paid and holds
      // nothing. There is no automatic recovery — a retry here would race the
      // same failure — so this line is what makes a manual correction possible
      // within minutes rather than when the buyer notices.
      this.logger.error(
        `COMPENSATION FAILED for order ${orderId}: account ${accountId} has been ` +
          `debited ${priceMinor}¢ with no escrow deal and no compensating credit. ` +
          `Requires a manual 'adjustment' entry. cause=${String(compensationError)}`,
      );
    }
  }
}
