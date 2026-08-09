import { Injectable } from '@nestjs/common';

import { EscrowOperatorService } from '../chain/escrow-operator.service';
import { DealReconciler } from './deal-reconciler';
import {
  DELIVERY_DEADLINE_HOURS,
  RECLAIMER_INTERVAL_MS,
  UNCONFIRMED_GRACE_MS,
} from './jobs.constants';
import {
  JobsRepository,
  type DueOrder,
  type UnconfirmedOrder,
} from './jobs.repository';
import { PollingJob } from './polling-job';

/**
 * The job nobody watches, and the one a buyer's money depends on.
 *
 * An escrow deal that was opened and never delivered against holds a buyer's
 * money with **no way out of its own accord**. Two orders end up in that
 * position: one that was never picked up and never ran at all, and one whose
 * agent ran and produced nothing. Both look identical to the contract — the deal
 * is `Open`, the delivery deadline is ticking, and once it passes anyone at all
 * may return the money to the buyer.
 *
 * This is the platform doing that on the buyer's behalf. It is the buyer's
 * guarantee that a silent platform cannot keep their money (User Story 3).
 *
 * The two populations are not distinguished here because the contract does not
 * distinguish them — `reclaim` requires `DealState.Open`, and a deal is Open in
 * both cases, since `markDelivered` is only ever called on success. See
 * `JobsRepository.findReclaimable`, whose state list contains `failed` for
 * exactly that reason.
 *
 * ## ⚠️ It writes NO ledger entry, and that is the part most likely to be got
 * wrong
 *
 * The buyer's money does **not** come back to their platform balance. `reclaim`
 * credits `balances[buyer]` on-chain, at the buyer's **own** address, as a claim
 * they withdraw themselves — where the platform cannot recapture it (invariant
 * #5).
 *
 * Crediting the ledger as well reads as kindness and is the one error no later
 * entry can correct (invariant #1): the buyer would hold the same cents twice,
 * once as spendable platform balance and once as an on-chain claim, and the pool
 * would owe more than it holds. The platform's solvency rests on that never
 * happening (FR-027).
 *
 * So there is no `INSERT INTO ledger_entries` anywhere on this path, and there
 * must never be one. `guardian.service.ts` carries the identical prohibition for
 * the dispute path — *"`LedgerKind` deliberately has no `settlement` member and
 * this feature does not add one"* — and `jobs.repository.ts` states it as the
 * first of three absences that `tasks.md` T043 greps for.
 *
 * ## ⚠️ Chain first, then Postgres
 *
 * `state = 'settled'` is a **claim about where the money is**. Writing it before
 * the chain confirms tells a buyer their money is back when nothing has moved —
 * the same ordering `sweeper.job.ts` argues for `state = 'released'`, and the
 * same one `guardian.service.ts` uses for `resolve`, because *"the contract, not
 * our database, is the authority"*.
 *
 * The failure this ordering leaves is benign and self-healing. Chain succeeds,
 * database write fails, the order stays `purchased`/`failed`; the next pass
 * selects it again, the chain refuses the duplicate, and the reconciler writes
 * the state that should have been written a cadence ago. There is no window in
 * which the platform has recorded a refund that did not happen.
 *
 * ## Why the resting state is `settled` and not `failed`
 *
 * `failed` is **inside** `ESCROWED_ORDER_STATES` and `settled` is **outside** it
 * (`src/orders/order-states.ts`). Leaving a reclaimed order in `failed` — which
 * is where an order whose agent produced nothing already sits, so it is the
 * tempting no-op — would keep `inEscrowMinor` summing its price at the same
 * moment `accounts.service.ts` starts reporting those cents in
 * `settledFundsMinor`, which it reads from the chain directly. The buyer would
 * see the same money in two figures at once (FR-028).
 *
 * `JobsRepository.markReclaimed` carries the full argument; it is cross-
 * referenced rather than restated so there is one copy to keep true.
 *
 * ## Slow cadence on purpose
 *
 * Five minutes, against a deadline a whole day away. An order becomes
 * reclaimable at a moment the contract decides, and being noticed up to five
 * minutes later changes nothing a buyer can perceive. **Nothing in a rehearsal
 * waits for this job** — it ranks last of the three precisely because its
 * deadline outlives the demo.
 *
 * ## The unconfirmed-purchase report rides this timer
 *
 * FR-030's report is not a fourth job and deliberately does not own a fourth
 * timer. It wants the same cadence this job already runs at (both are
 * `300_000`), it reads the same table, and its rows are adjacent to this job's —
 * a `purchased` order with a NULL `onchain_deal_id` is exactly the row
 * `findReclaimable` excludes. Giving it its own `PollingJob` would add a class
 * and a startup line to run one `SELECT` on the schedule this one already keeps.
 *
 * ⚠️ It is **visibility only**, and that is a decision taken explicitly rather
 * than a half-built fourth job. It changes no state, writes no ledger entry, and
 * makes no chain call. The purchase saga leaves an order there when `openDeal`'s
 * outcome is *unknown* — sent, no receipt — because the money may genuinely be
 * escrowed and compensating would promise the buyer cents the pool does not
 * hold. And `order.entity.ts` is explicit that retrying `openDeal` against a
 * NULL id is how one purchase ends up with **two deals escrowing two prices**,
 * since the contract assigns a new deal on every call. Recovery is by looking the
 * logged transaction hash up by hand, which is why the log line names the buyer.
 */
@Injectable()
export class ReclaimerJob extends PollingJob {
  protected readonly name = 'reclaimer';
  // A constant, not an environment key: unlike the sweeper's, this cadence has
  // no deployment that wants it different — see `jobs.constants.ts`, which
  // argues why only `SWEEPER_INTERVAL_MS` lives in `env.schema.ts`. Hence no
  // `ConfigService` in this constructor.
  protected readonly intervalMs = RECLAIMER_INTERVAL_MS;

  /**
   * Orders already named in the unconfirmed-purchase report.
   *
   * Process-lifetime, unbounded, and both are fine: it holds one UUID per stuck
   * purchase, a population that needs a human before it needs a cache eviction
   * policy. Cleared by a restart, which re-reports — correct, since a new process
   * has a new log.
   */
  private readonly reported = new Set<string>();

  constructor(
    private readonly repository: JobsRepository,
    private readonly escrow: EscrowOperatorService,
    private readonly reconciler: DealReconciler,
  ) {
    super();
  }

  /**
   * Drain everything reclaimable, then report what is stuck.
   *
   * The report goes **last** and inside its own `try/catch`: it is diagnostics,
   * and a failing `SELECT` there must not discard a pass that has already
   * returned money to buyers.
   */
  protected async runOnce(): Promise<void> {
    await this.drain();

    try {
      await this.reportUnconfirmed();
    } catch (err: unknown) {
      this.logger.error(
        `unconfirmed-purchase report failed: ` +
          `${err instanceof Error ? err.name : typeof err}`,
      );
    }
  }

  /**
   * Reclaim every order whose delivery deadline has passed, then return.
   *
   * ⚠️ `skipped` is not an optimisation. Without it the drain is an infinite
   * loop: an order this pass failed to advance still satisfies the selection
   * predicate, so the next iteration picks the identical row. See
   * `JobsRepository.findReclaimable` and `findReleasable`, which argue why
   * skipping is the right fix and breaking out of the loop is not — breaking out
   * trades the spin for starvation, since candidates are ordered by `created_at`
   * and one stuck order would stand in front of every newer one forever.
   */
  private async drain(): Promise<void> {
    const skipped: string[] = [];

    while (!this.stopping) {
      const due = await this.repository.findReclaimable(
        DELIVERY_DEADLINE_HOURS,
        skipped,
      );
      if (due === null) break;

      // Per-order containment: one order that cannot be handled costs that
      // order one cadence, not the rest of the pass. The base class's catch is
      // the outer net for a defect, not the routine path for a failing chain
      // call (FR-004).
      let advanced = false;
      try {
        advanced = await this.reclaim(due);
      } catch (err: unknown) {
        this.logger.error(
          `order ${due.orderId}: reclaim failed, deal=${due.onchainDealId} ` +
            `kind=${err instanceof Error ? err.name : typeof err}`,
        );
      }

      if (!advanced) skipped.push(due.orderId);
    }
  }

  /**
   * One order: return the money to its buyer, then record it.
   *
   * ⚠️ Chain first, Postgres second — see the class header. `markReclaimed` is
   * only ever reached after a confirmed receipt.
   *
   * @returns whether the order left the escrowed states. `false` puts it on this
   * pass's skip list; the next tick tries it again from scratch.
   */
  private async reclaim(due: DueOrder): Promise<boolean> {
    try {
      const tx = await this.escrow.reclaim(due.onchainDealId);
      const moved = await this.repository.markReclaimed(due.orderId);

      if (moved) {
        this.logger.log(
          `order ${due.orderId} reclaimed to its buyer, deal=${due.onchainDealId} tx=${tx.hash}`,
        );
      } else {
        // The chain returned the money but our row had already moved — a
        // concurrent transition, or a duplicate pass. The money is right; only
        // our write lost.
        this.logger.debug(
          `order ${due.orderId} reclaimed on-chain but was no longer reclaimable locally (tx=${tx.hash})`,
        );
      }
      return true;
    } catch (err: unknown) {
      return this.reconcile(due, err);
    }
  }

  /**
   * Decide what a failed `reclaim` meant, by reading the deal.
   *
   * ⚠️ **Never by matching the revert string.** `reclaim` reverts `"not open"`
   * for *both* "somebody already reclaimed it" and "the seller delivered after
   * all" — one string, two states, and opposite correct responses. See
   * `deal-reconciler.ts`, which carries the full table, and note that the same
   * `DealState` means the opposite thing to this job and to the sweeper.
   */
  private async reconcile(due: DueOrder, err: unknown): Promise<boolean> {
    const verdict = await this.reconciler.reconcile(
      err,
      due.onchainDealId,
      'reclaimer',
    );

    switch (verdict.kind) {
      case 'done': {
        const moved = await this.repository.markReclaimed(due.orderId);
        this.logger.log(
          `order ${due.orderId} was already settled on-chain; recorded as settled` +
            (moved ? '' : ' (row had already moved)'),
        );
        return true;
      }

      case 'not-yet':
        // Our clock ran ahead of block time — this predicate measures from
        // `orders.created_at`, a second or two before the contract's own
        // `openedAt`, so the first pass after a deadline is *expected* to be
        // refused. Free (caught at simulation, never broadcast) and emphatically
        // not an error; see the class header.
        this.logger.debug(
          `order ${due.orderId}: the 24-hour delivery deadline has not passed in block time yet; retrying next pass`,
        );
        return false;

      case 'leave-alone':
        this.logger.warn(
          `order ${due.orderId} left alone: ${verdict.why}. The buyer's money is no longer abandoned — the sweeper or Guardian owns it now, not the reclaimer`,
        );
        return false;

      case 'unknown':
        this.logger.error(`order ${due.orderId}: ${verdict.why}`);
        return false;
    }
  }

  /**
   * Name every purchase still waiting on its escrow deal (FR-030).
   *
   * ⚠️ **Changes nothing.** No state write, no ledger entry, no chain call — see
   * the class header for why opening a second deal is the one recovery that must
   * not be automated.
   *
   * At **error** level, because a buyer is out of pocket with no record of where
   * their money went and it needs a person. Deduplicated against
   * {@link reported}, so a steady state produces one line per order per process
   * rather than one every five minutes — a report that repeats on a timer is a
   * report everybody filters out (research R12).
   */
  private async reportUnconfirmed(): Promise<void> {
    const stuck = await this.repository.findUnconfirmedPurchases(
      UNCONFIRMED_GRACE_MS,
    );

    for (const order of stuck) {
      if (this.reported.has(order.orderId)) continue;

      this.logger.error(
        `order ${order.orderId} (buyer ${order.buyerAccountId}) has been awaiting ` +
          `escrow confirmation for ${waitedFor(order)} and has no deal id. Nothing is ` +
          `retried and nothing is compensated: the deal may yet have confirmed. ` +
          `Reconcile by hand from the openDeal transaction hash in the purchase logs.`,
      );
      this.reported.add(order.orderId);
    }
  }
}

/**
 * How long a stuck purchase has been waiting, in whole minutes.
 *
 * Whole minutes because the grace period is five of them and the reader's next
 * action is measured in hours — a millisecond figure would imply a precision the
 * question does not have.
 */
function waitedFor(order: UnconfirmedOrder): string {
  const minutes = Math.floor((Date.now() - order.createdAt.getTime()) / 60_000);
  return `${minutes}m`;
}
