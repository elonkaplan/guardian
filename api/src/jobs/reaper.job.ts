import { Injectable } from '@nestjs/common';

import {
  ABANDONED_RUN_ERROR,
  REAPER_GRACE_MS,
  REAPER_INTERVAL_MS,
} from './jobs.constants';
import { JobsRepository } from './jobs.repository';
import { PollingJob } from './polling-job';

/**
 * The job that makes "the state column is the queue" survivable.
 *
 * There is no job queue in this platform. `orders.state` **is** the queue
 * (invariant #9): an order being worked on is one whose state says `running`,
 * and that state is the only record anywhere that somebody is on it. Restart the
 * backend at that instant and the worker is gone while the state remains — the
 * order is now claimed by a process that no longer exists, and nothing will ever
 * unclaim it. The buyer waits on a screen that says work is in progress, and it
 * never is again.
 *
 * This job is the only thing that closes that hole. It is the safety net that
 * lets the state column be a real design rather than a bet on the process never
 * dying, and it is why a single restart mid-rehearsal is a recoverable event
 * rather than a permanently wedged order with a buyer's money locked behind it.
 *
 * ## `failed` is the correct answer, not a workaround
 *
 * From the buyer's side an agent that never came back is **non-delivery**,
 * regardless of whether the cause was a crash, a deploy, or a model that hung.
 * The platform cannot tell those apart and does not need to: that is exactly the
 * position the buyer is entitled to complain from, and the failure this job
 * writes is the same failure a crashed run would have written by itself. A
 * reaped order is complainable on ordinary terms, through the ordinary dispute
 * path, with no special case anywhere downstream.
 *
 * ## ⚠️ It makes no chain call, of any kind
 *
 * Not `markDelivered`, not `reclaim`, not a read. Nothing was delivered, so
 * there is nothing to tell the contract. Announcing delivery on an order that
 * produced nothing would open a review window over work that does not exist —
 * and at the end of that window the sweeper would pay a seller for it. Getting
 * the buyer's money back is the reclaimer's job, on the escrow's own 24-hour
 * `DELIVERY_DEADLINE`, and `findReclaimable` selects `failed` orders precisely
 * so that this one never has to reach for the chain.
 *
 * It also never re-runs the agent. `runs.order_id` is UNIQUE, so a retry would
 * have to overwrite the existing row — destroying the one record proving nothing
 * arrived, which is invariant #7 and the entire basis of the demo's closing act.
 *
 * ## ⚠️ It never destroys evidence
 *
 * An order can be stuck in `running` precisely because its **delivery
 * announcement was lost after a successful run**: `execution.service.ts` closes
 * the run with its output *before* it tells the chain, so a failure in between
 * leaves a `running` order whose run record holds a real output. This job marks
 * that order `failed` too — because the chain never learned of the delivery, and
 * that is the truth the money follows — but it leaves the output exactly where
 * it is, for an auditor to read on its merits rather than as non-delivery.
 *
 * The mechanism is entirely `closeAbandonedRun`'s `WHERE finished_at IS NULL`
 * guard: an already-finished run matches zero rows and is not touched. **This
 * job needs no branch for that case, which is the point** — a shape that cannot
 * be got wrong by a later edit here, because there is nothing here to edit. The
 * only visible trace is which of the two log lines the pass emits, and that is
 * deliberate: a lost delivery announcement should be *visible* in the log rather
 * than silent.
 *
 * ## What it does not touch
 *
 * `disputed` orders, including one whose `audit_failed_at` is set because
 * Guardian could not rule on it. `order.entity.ts` says so directly: *"No
 * scheduled job touches a stuck dispute — API-10's reaper covers `running`
 * only."* Such a dispute is left to the escrow's 72-hour `DISPUTE_DEADLINE` and
 * its permissionless `forceResolve`, which resolve it without the platform. The
 * enforcement is in `findAbandonedRun`, whose predicate names `running` and
 * nothing else.
 *
 * ## The grace margin is the whole safety argument
 *
 * `REAPER_GRACE_MS` sits on top of the **pinned** version's `timeout_seconds` —
 * the seller's own declared budget, which a run is entitled to use in full — and
 * it is the only thing standing between this job and killing a run that is still
 * working. Without it a run finishing at 99.9% of its budget races the reaper
 * for its own result. `ExecutionRepository.markDelivered` is conditional on
 * `state = 'running'` so that race resolves safely rather than corruptly, but
 * resolving safely is not the same as not having it.
 *
 * ## Quiet unless it acted
 *
 * An empty pass logs nothing. Losing the write race against a run that finished
 * normally logs at **debug** — that is FR-022 working exactly as designed, and a
 * rehearsal log that is red for correct behaviour trains everyone to ignore it.
 */
@Injectable()
export class ReaperJob extends PollingJob {
  protected readonly name = 'reaper';

  // A constant, not an environment key, unlike the sweeper's cadence. One minute
  // is the shortest of the three because this is the only job whose latency a
  // person feels: every minute an order sits in `running` is a minute the
  // product is telling a buyer that work is in progress when nothing is. See the
  // header of `jobs.constants.ts` for why nothing here varies by deployment.
  protected readonly intervalMs = REAPER_INTERVAL_MS;

  constructor(private readonly repository: JobsRepository) {
    super();
  }

  /**
   * Reap every order abandoned mid-execution, then return.
   *
   * Draining rather than one per tick because the event this job exists for — a
   * restart, a deploy — abandons *every* order that was running at that instant
   * at once, and clearing them one per minute would leave the last of them lying
   * for an hour.
   *
   * ⚠️ `skipped` is not an optimisation. Without it the drain is an infinite
   * loop: an order this pass failed to advance still satisfies the selection
   * predicate, so the next iteration picks the identical row. See
   * `JobsRepository.findAbandonedRun` and `findReleasable`, which argue why
   * skipping is the right fix and breaking out of the loop is not — breaking out
   * trades the spin for starvation, since candidates are ordered oldest-first.
   */
  protected async runOnce(): Promise<void> {
    const skipped: string[] = [];

    while (!this.stopping) {
      const due = await this.repository.findAbandonedRun(
        REAPER_GRACE_MS,
        skipped,
      );
      if (due === null) break;

      // Per-order containment: one order that cannot be handled costs that
      // order one cadence, not the rest of the pass. The base class's catch is
      // the outer net for a defect, not the routine path for a single failing
      // write (FR-004).
      let advanced = false;
      try {
        advanced = await this.reap(due.orderId);
      } catch (err: unknown) {
        // Deliberately the error's class name only, following `polling-job.ts`:
        // a log line goes around every serialiser, and a database error's
        // message can carry a row, a prompt, or an output.
        this.logger.error(
          `order ${due.orderId}: reap failed, ` +
            `kind=${err instanceof Error ? err.name : typeof err}`,
        );
      }

      if (!advanced) skipped.push(due.orderId);
    }
  }

  /**
   * One order: close its run, then fail the order.
   *
   * ## ⚠️ The order of the two writes is load-bearing
   *
   * The run is closed **first**. Reversed, there is a window — however brief, and
   * a pass can be interrupted anywhere — in which the order reads `failed` while
   * its run is still open, and that is precisely the shape a case file misreads
   * as a run still in progress. Closing first means every intermediate state a
   * reader can observe is one it can interpret correctly: either the order is
   * still `running` with a closed run (a reap in flight, harmless, and the next
   * pass finishes it because `markReaped` is still conditional on `running`), or
   * both are done.
   *
   * @returns whether the order left `running`. `false` puts it on this pass's
   * skip list so the drain cannot spin on it.
   */
  private async reap(orderId: string): Promise<boolean> {
    const closed = await this.repository.closeAbandonedRun(
      orderId,
      ABANDONED_RUN_ERROR,
    );
    const moved = await this.repository.markReaped(orderId);

    if (!moved) {
      // Somebody else moved it between the select and this write — almost
      // always the run itself finishing normally, which is FR-022 working: the
      // conditional UPDATE matched zero rows and a `delivered` order was not
      // dragged back to `failed`. An ordinary outcome, not an error.
      this.logger.debug(
        `order ${orderId} was no longer 'running' when the reaper wrote; ` +
          'left as it stands',
      );
      return true;
    }

    // ⚠️ States what is KNOWN, never why. An earlier version of this line read
    // "it has an output; its delivery announcement was lost" on the `!closed`
    // branch, and a live reap proved that wrong: "already closed" has two causes,
    // and only one of them is the lost announcement.
    //
    // | Why the run was already closed | `output` |
    // | --- | --- |
    // | The run succeeded and `markDelivered` failed — the lost announcement | set |
    // | The run failed on its own and recorded its own error | **NULL** |
    //
    // The second is the more common of the two, and diagnosing it as the first
    // sends whoever reads the rehearsal log looking for a chain problem that is
    // not there. `jobs.constants.ts` states the same rule for
    // `ABANDONED_RUN_ERROR`: report the observation, leave the diagnosis to
    // whoever opens the run record.
    this.logger.log(
      closed
        ? `order ${orderId} reaped to 'failed'; its open run was closed`
        : `order ${orderId} reaped to 'failed'; its run was already closed and ` +
            'was left untouched — read the run record for what it holds',
    );
    return true;
  }
}
