import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { EscrowOperatorService } from '../chain/escrow-operator.service';
import type { AppConfig } from '../config/env.schema';
import { DealReconciler } from './deal-reconciler';
import { JobsRepository, type DueOrder } from './jobs.repository';
import { PollingJob } from './polling-job';

/**
 * The job the audience sees.
 *
 * A buyer bought something, the agent delivered, and the buyer did nothing at
 * all — did not accept, did not complain, closed the tab. The review window runs
 * out. Nothing in the escrow moves on its own: the money is still locked, the
 * seller is still unpaid, and the contract will sit in that position forever
 * unless somebody sends it a transaction saying the window is over.
 *
 * This sends it. That is the ending of the demo's first act, and it happens with
 * nobody touching the keyboard.
 *
 * ## The platform is a convenience here, not a dependency
 *
 * `release` is **permissionless** (`docs/smart-contract.md` §4.3): a seller the
 * platform never sweeps can send the transaction themselves, and so can anyone
 * else. That is deliberate — *"a seller must never depend on the platform to get
 * paid"* — and it is also why this job may never assume it was the one that
 * acted. It has to be equally correct arriving second, which is what the
 * reconciliation below is for.
 *
 * ## ⚠️ Chain first, then Postgres
 *
 * `state = 'released'` is a **claim about where the money is**. Writing it before
 * the chain confirms tells a seller they have been paid when nothing has moved.
 *
 * This is not invariant #1 — that rule is about which of two *ledger* writes goes
 * second, and this job writes no ledger entry at all (invariant #5: the payout
 * lands on-chain under the seller's own address, where the platform cannot
 * recapture it). It is the same shape `guardian.service.ts` uses for `resolve`,
 * for the same reason it gives: *"the contract, not our database, is the
 * authority on whether the deal is already Settled."*
 *
 * The failure this ordering leaves is benign and self-healing. Chain succeeds,
 * database write fails, order stays `delivered`; the next pass selects it again,
 * the chain refuses the duplicate, and the reconciler writes the state that
 * should have been written a cadence ago. There is no window in which the
 * platform has recorded a payout that did not happen.
 *
 * ## Quiet unless it acted
 *
 * An empty pass logs nothing. A premature refusal logs at **debug** — two clocks
 * disagreeing by a second is the system working, and a rehearsal log that is red
 * for correct behaviour trains everyone to ignore it.
 */
@Injectable()
export class SweeperJob extends PollingJob {
  protected readonly name = 'sweeper';
  protected readonly intervalMs: number;

  constructor(
    private readonly repository: JobsRepository,
    private readonly escrow: EscrowOperatorService,
    private readonly reconciler: DealReconciler,
    config: ConfigService<AppConfig, true>,
  ) {
    super();
    // The one cadence in this module that is an environment key rather than a
    // constant — three seconds on stage, sixty in production. See the header of
    // `jobs.constants.ts` for why the other two are not, and `polling-job.ts`
    // for why this key is the reason `@nestjs/schedule` was declined.
    this.intervalMs = config.get('SWEEPER_INTERVAL_MS', { infer: true });
  }

  /**
   * Release every order whose window has closed, then return.
   *
   * Draining rather than one per tick because a rehearsal that runs three acts
   * back to back produces several orders whose windows expire together, and the
   * sweeper taking three cadences to clear them is visible on stage (FR-015).
   *
   * ⚠️ `skipped` is not an optimisation. Without it the drain is an infinite
   * loop: an order this pass failed to advance still satisfies the selection
   * predicate, so the next iteration picks the identical row. See
   * `JobsRepository.findReleasable`, which argues why skipping is the right fix
   * and breaking out of the loop is not.
   */
  protected async runOnce(): Promise<void> {
    const skipped: string[] = [];

    while (!this.stopping) {
      const due = await this.repository.findReleasable(skipped);
      if (due === null) break;

      // Per-order containment: one order that cannot be handled costs that
      // order one cadence, not the rest of the pass. The base class's catch is
      // the outer net for a defect, not the routine path for a failing chain
      // call (FR-004).
      let advanced = false;
      try {
        advanced = await this.release(due);
      } catch (err: unknown) {
        this.logger.error(
          `order ${due.orderId}: release failed, deal=${due.onchainDealId} ` +
            `kind=${err instanceof Error ? err.name : typeof err}`,
        );
      }

      if (!advanced) skipped.push(due.orderId);
    }
  }

  /**
   * One order: pay the seller, then record it.
   *
   * @returns whether the order left `delivered`. `false` puts it on this pass's
   * skip list; the next tick tries it again from scratch.
   */
  private async release(due: DueOrder): Promise<boolean> {
    try {
      const tx = await this.escrow.release(due.onchainDealId);
      const moved = await this.repository.markReleased(due.orderId);

      if (moved) {
        this.logger.log(
          `order ${due.orderId} released to its seller, deal=${due.onchainDealId} tx=${tx.hash}`,
        );
      } else {
        // The chain paid out but our row had already moved — a concurrent
        // accept, or a duplicate pass. The money is right; only our write lost.
        this.logger.debug(
          `order ${due.orderId} released on-chain but was no longer 'delivered' locally (tx=${tx.hash})`,
        );
      }
      return true;
    } catch (err: unknown) {
      return this.reconcile(due, err);
    }
  }

  /**
   * Decide what a failed `release` meant, by reading the deal.
   *
   * ⚠️ **Never by matching the revert string.** `release` reverts
   * `"not delivered"` for *both* "somebody already released it" and "the buyer
   * disputed it" — one string, two states, and opposite correct responses. See
   * `deal-reconciler.ts`, which carries the full table.
   */
  private async reconcile(due: DueOrder, err: unknown): Promise<boolean> {
    const verdict = await this.reconciler.reconcile(
      err,
      due.onchainDealId,
      'sweeper',
    );

    switch (verdict.kind) {
      case 'done': {
        const moved = await this.repository.markReleased(due.orderId);
        this.logger.log(
          `order ${due.orderId} was already settled on-chain; recorded as released` +
            (moved ? '' : ' (row had already moved)'),
        );
        return true;
      }

      case 'not-yet':
        // Our clock ran ahead of block time. Expected, free (the revert was
        // caught at simulation and never broadcast), and emphatically not an
        // error — see the class header.
        this.logger.debug(
          `order ${due.orderId}: review window not closed in block time yet; retrying next pass`,
        );
        return false;

      case 'leave-alone':
        this.logger.warn(
          `order ${due.orderId} left alone: ${verdict.why}. It belongs to Guardian now, not the sweeper`,
        );
        return false;

      case 'unknown':
        this.logger.error(`order ${due.orderId}: ${verdict.why}`);
        return false;
    }
  }
}
