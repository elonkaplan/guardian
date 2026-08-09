import { Injectable, Logger } from '@nestjs/common';
import { DataSource, type EntityManager } from 'typeorm';

import { ChainOutcomeUnknownError } from '../chain/errors';
import { EscrowOperatorService } from '../chain/escrow-operator.service';
import { EscrowReadService } from '../chain/escrow-read.service';
import { DealState } from '../chain/types';
import type { Account } from '../entities/account.entity';
import { OrderState } from '../entities/enums';
import type { Order } from '../entities/order.entity';
import { OrderRepository } from './order.repository';
import {
  AlreadyComplainedError,
  ComplaintWindowClosedError,
  InvalidOrderStateError,
  OrderNotDisputableError,
  OrderNotVisibleError,
} from './orders.errors';

/**
 * The two ways a buyer ends an order: accepting it, or complaining about it.
 *
 * ## ⚠️ This file uses the CATALOGUE's transaction shape, not the purchase's
 *
 * Both methods here open a transaction, write to Postgres, call the escrow
 * **inside** it, and commit only if the chain agreed — the shape
 * `catalog/agent-writes.service.ts` documents. `purchase.service.ts` does the
 * opposite, and the difference is not inconsistency.
 *
 * A purchase commits first because a rollback would destroy the only record of
 * whose money is in escrow. Neither method here can produce that: the deal
 * already exists, the order row already exists, and the money is already locked.
 * A rollback loses nothing but the attempt, so the shape that deletes the
 * compensation path is the right one.
 *
 * (`specs/007-orders-purchase-saga/research.md` R8)
 *
 * ## Both actions are the buyer's alone
 *
 * A seller reaching either gets the same `404` a stranger gets. The seller is
 * notified of a dispute and has **no right of reply** — a decision recorded in
 * `docs/product-workflow.md` §7.5, not an unbuilt feature. The two *reads* admit
 * them; the writes do not.
 *
 * ## Neither writes a ledger entry
 *
 * Settlement is an on-chain fact. The contract credits `balances[buyer]` and
 * `balances[seller]` at the users' **own** addresses, where the platform cannot
 * recapture the money — which is the property that lets either party exit
 * without us (invariant #5). Inventing a ledger row for it would be a lie about
 * where the money is, and `LedgerKind` deliberately has no `settlement` member.
 */
@Injectable()
export class SettlementService {
  private readonly logger = new Logger(SettlementService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly orders: OrderRepository,
    private readonly escrow: EscrowOperatorService,
    private readonly escrowRead: EscrowReadService,
  ) {}

  /**
   * The buyer takes delivery early, releasing the full amount to the seller.
   *
   * ## ⚠️ Rolls back on EVERY failure, including an unknown outcome
   *
   * This is the opposite of what `complain` does below, and the rule behind both
   * is: **choose the branch whose bad case is a stale label rather than stranded
   * money.**
   *
   * | If the `accept` did not land | If it did land |
   * | --- | --- |
   * | Order stays `delivered`; the sweeper releases it when the window expires. **Self-heals, seller paid.** | Deal is `Settled`; the sweeper's `release` reverts and the order sits at `delivered` with a stale label over money that reached the seller correctly. |
   *
   * Committing `released` on an unknown outcome would take the order out of the
   * sweeper's query (`state = 'delivered' AND now() >= delivered_at + window`),
   * so a call that had not landed would leave the money escrowed with nothing
   * left to settle it and the seller unpaid indefinitely. A wrong label is
   * recoverable by hand; that is not.
   */
  async accept(account: Account, orderId: string): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const order = await this.loadForBuyer(manager, orderId, account);

      if (order.state !== OrderState.Delivered) {
        // The contract permits `accept` only from `Delivered`, so refusing here
        // is not a duplicate check — it is refusing before spending a
        // transaction to be told the same thing by the chain.
        throw new InvalidOrderStateError(
          `order ${orderId} is ${order.state} and cannot be accepted`,
          orderId,
          order.state,
        );
      }

      if (order.onchainDealId === null) {
        throw new OrderNotDisputableError(
          `order ${orderId} has no escrow deal and cannot be settled`,
          orderId,
        );
      }

      await this.orders.markReleased(manager, orderId);

      // Inside the transaction: a failure below rolls the state change back and
      // the order is simply not accepted.
      await this.escrow.accept(BigInt(order.onchainDealId));

      this.logger.log(`order ${orderId} accepted by buyer; deal #${order.onchainDealId} settled`);
    }).catch((err: unknown) => {
      if (err instanceof ChainOutcomeUnknownError) {
        // Rolled back already — this is the log, not a branch. See the docblock:
        // leaving the order `delivered` keeps the sweeper as its backstop.
        this.logger.error(
          `accept outcome UNKNOWN for order ${orderId}; rolled back and left 'delivered' ` +
            `so the sweeper remains its backstop. tx=${err.hash}`,
        );
      }

      throw err;
    });
  }

  /**
   * The buyer disputes the delivery, freezing the escrow and handing the order
   * to the auditor.
   *
   * ## ⚠️ Commits the complaint on an unknown outcome — the opposite of `accept`
   *
   * Two reasons, and both point the same way:
   *
   * 1. **The complaint is testimony and is not reproducible.** Rolling it back
   *    discards what the buyer wrote.
   * 2. **If the `dispute` did land, a rollback locks the buyer out.** The deal
   *    would be `Disputed` on-chain while the order read `delivered`: `release`
   *    reverts forever, and a second complaint would send another `dispute`
   *    which also reverts. The buyer would be unable to file a dispute the chain
   *    already believes they filed.
   *
   * Committing keeps the complaint and lets the audit proceed. If the dispute did
   * *not* land, the audit's `resolve` reverts loudly rather than silently.
   *
   * ## Act 3 — complaining about an order that produced nothing
   *
   * See `openDisputeOnChain` below. An order whose agent crashed has no on-chain
   * delivery, and the contract refuses `dispute` on a deal that was never marked
   * delivered.
   */
  async complain(account: Account, orderId: string, reason: string): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const order = await this.loadForBuyer(manager, orderId, account);

      // `delivered` is the normal path; `failed` is Act 3 — an agent that
      // produced nothing is the strongest case a buyer has, not an unreachable
      // one (FR-034).
      if (order.state !== OrderState.Delivered && order.state !== OrderState.Failed) {
        throw new InvalidOrderStateError(
          `order ${orderId} is ${order.state} and cannot be disputed`,
          orderId,
          order.state,
        );
      }

      if (order.onchainDealId === null) {
        // A compensated purchase: `openDeal` was refused, nothing was ever
        // escrowed, and the buyer's balance was already restored. There is no
        // deal to dispute and no money to argue over.
        throw new OrderNotDisputableError(
          `order ${orderId} has no escrow deal; nothing was escrowed to dispute`,
          orderId,
        );
      }

      if (await this.orders.hasComplaint(manager, orderId)) {
        // The `complaints.order_id UNIQUE` constraint is the real guarantee and
        // would fire a few statements later; this check exists so the buyer gets
        // a `409` rather than a constraint violation, and so the chain call is
        // never attempted for a re-filing.
        throw new AlreadyComplainedError(
          `order ${orderId} already has a complaint; there are no amendments`,
          orderId,
        );
      }

      this.assertWindowOpen(order);

      await this.orders.insertComplaint(manager, orderId, reason);
      await this.orders.markDisputed(manager, orderId);

      await this.openDisputeOnChain(orderId, BigInt(order.onchainDealId));

      this.logger.log(`order ${orderId} disputed by buyer; deal #${order.onchainDealId} frozen`);
    }).catch((err: unknown) => {
      if (err instanceof ChainOutcomeUnknownError) {
        // ⚠️ NOT rolled back. `dataSource.transaction` has already rolled back by
        // the time this runs, so the complaint must be re-written outside it —
        // see `commitComplaintAfterUnknownOutcome`.
        return this.commitComplaintAfterUnknownOutcome(orderId, reason, err);
      }

      throw err;
    });
  }

  // -------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------

  /**
   * Put the deal into `Disputed`, marking it delivered first if it never was.
   *
   * ## ⚠️ Act 3, and the one irreversible half-step in this feature
   *
   * `smart-contract.md` §4.4 requires state `Delivered` before `dispute`. An
   * order that failed in execution never called `markDelivered`, so its deal is
   * still `Open` and a dispute against it would revert — which would make the
   * demo's closing act, a crashed agent and a 100% verdict, unreachable through
   * this endpoint.
   *
   * **The branch is on the DEAL's state, not the order's.** Two reasons: the
   * order's state is our belief and the deal's is the fact, and a complaint
   * retried after a partial failure below must send `dispute` alone rather than
   * a second `markDelivered`.
   *
   * ⚠️ **`markDelivered` is called here and nowhere else in this module.** That
   * restriction is the whole safety argument (FR-035). Marking a crashed deal
   * delivered at the moment of the crash would start the on-chain review window
   * with the deal in `Delivered`, and `release()` is **permissionless** — anyone
   * could pay a seller who delivered nothing. Confining it to the complaint
   * bounds that window to the width of two sequential calls.
   *
   * ⚠️ If `dispute` fails after `markDelivered` succeeded, the transaction rolls
   * the complaint back but the on-chain mark **stands**, and the deal becomes
   * releasable when the window expires. Both hashes are logged at `error`; the
   * recovery is the buyer retrying the complaint, which this method's state read
   * routes down the `dispute`-only path.
   */
  private async openDisputeOnChain(orderId: string, dealId: bigint): Promise<void> {
    const deal = await this.escrowRead.getDeal(dealId);

    if (deal.state === DealState.Open) {
      this.logger.warn(
        `order ${orderId}: deal #${dealId} is Open (the run produced nothing); ` +
          `marking delivered so it can be disputed`,
      );

      const marked = await this.escrow.markDelivered(dealId);

      try {
        await this.escrow.dispute(dealId);
      } catch (err) {
        this.logger.error(
          `order ${orderId}: markDelivered LANDED (tx=${marked.hash}) but dispute did not. ` +
            `Deal #${dealId} is now Delivered and becomes releasable when its window expires. ` +
            `Retry the complaint — the retry will send dispute alone. cause=${String(err)}`,
        );

        throw err;
      }

      return;
    }

    await this.escrow.dispute(dealId);
  }

  /**
   * Re-write a complaint whose `dispute` transaction was broadcast but never
   * confirmed.
   *
   * The enclosing transaction has already rolled back — `dataSource.transaction`
   * rejects before its `.catch` runs — so "committing on unknown" means writing
   * the two rows again, outside it. Failure here is logged and swallowed rather
   * than thrown, because the caller is already throwing the chain error and the
   * buyer's answer does not change either way.
   */
  private async commitComplaintAfterUnknownOutcome(
    orderId: string,
    reason: string,
    cause: ChainOutcomeUnknownError,
  ): Promise<never> {
    try {
      await this.dataSource.transaction(async (manager) => {
        await this.orders.insertComplaint(manager, orderId, reason);
        await this.orders.markDisputed(manager, orderId);
      });

      this.logger.error(
        `dispute outcome UNKNOWN for order ${orderId}; complaint KEPT and order moved to ` +
          `'disputed' so the audit can proceed and the buyer's testimony is not lost. ` +
          `If the transaction never lands, the audit's resolve will revert. tx=${cause.hash}`,
      );
    } catch (err) {
      this.logger.error(
        `dispute outcome UNKNOWN for order ${orderId} AND the complaint could not be ` +
          `re-recorded. The buyer's testimony is lost and the deal may be Disputed on-chain ` +
          `with no complaint row. tx=${cause.hash} cause=${String(err)}`,
      );
    }

    throw cause;
  }

  /**
   * Load the order and refuse anyone who is not its buyer.
   *
   * ⚠️ `OrderNotVisibleError` for both "no such order" and "not your order",
   * including when the caller is the **seller**. A seller who can tell that an
   * order exists but is not theirs to settle has learned nothing useful and one
   * thing they should not have; more importantly, the writes and the reads must
   * not answer differently about existence, or the pair becomes an oracle.
   */
  private async loadForBuyer(
    manager: EntityManager,
    orderId: string,
    account: Account,
  ): Promise<Order> {
    const order = await this.orders.findForSettlement(manager, orderId);

    if (order === null || order.buyerAccountId !== account.id) {
      throw new OrderNotVisibleError(`order ${orderId} is not settleable by this account`, orderId);
    }

    return order;
  }

  /**
   * Refuse once the review window has elapsed.
   *
   * ⚠️ **The boundary is the contract's and this check only anticipates it.**
   * `dispute` requires `now < deliveredAt + reviewWindow` on-chain, so a
   * complaint at or past the closing instant reverts there regardless. Checking
   * here means the buyer gets a `409` explaining why rather than a `502` from a
   * reverted transaction — and it means no gas is spent to be told no.
   *
   * Where a complaint races the sweeper's release, the contract decides and this
   * check cannot; the platform reports the outcome it actually got.
   *
   * An order in `failed` has no `delivered_at` — nothing was ever delivered — so
   * there is no window to have closed. Act 3 must not be refused by a window that
   * never opened.
   */
  private assertWindowOpen(order: Order): void {
    if (order.deliveredAt === null) {
      return;
    }

    const closesAt = order.deliveredAt.getTime() + order.reviewWindowSeconds * 1000;

    if (Date.now() >= closesAt) {
      throw new ComplaintWindowClosedError(
        `order ${order.id}'s review window closed at ${new Date(closesAt).toISOString()}`,
        order.id,
      );
    }
  }
}
