import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { AppConfig } from '../config/env.schema';
import { GuardianService } from './guardian.service';

/**
 * The only thing that starts an audit, and the only thing that retries a
 * settlement.
 *
 * ## Why a poller, and why it lives here
 *
 * `orders.state` **is** the queue (`docs/CONTEXT.md` invariant #9), and API-08
 * already established the shape for a worker whose only trigger is a state
 * predicate. Nothing else claims this one: API-10's cron table is a sweeper, a
 * reclaimer and a reaper, none of which know what a tier is or hold the guardian
 * key. So the trigger belongs to the module that performs the transition.
 *
 * A poller also covers the restart case for free. `settlement.service.ts`
 * deliberately **commits a complaint even when the `dispute` transaction's
 * outcome is unknown**, with the comment that it does so *"so the audit can
 * proceed"* — it expects a later reader, not a callback. An in-process call from
 * the complaint would not survive a deploy in that window; the next tick does.
 *
 * ## ⚠️ Two passes, and the split is load-bearing
 *
 * | Pass | Input | Job |
 * | --- | --- | --- |
 * | audit-pending | a `disputed` order | assemble → audit → validate → persist → settle |
 * | settle-pending | an **`adjudicated` order and its stored ruling** | settle only |
 *
 * FR-024 says a retried settlement must use the stored ruling and must not
 * consult the auditor again. Written as a branch inside the audit flow that
 * would be a rule someone has to remember; written as a second pass whose input
 * is a row, the retry **has no access to an auditor at all**. The recovery for a
 * failed chain call is not an error handler — it is a different query.
 *
 * The settle pass runs **first** each tick, so an order stuck one step from done
 * is finished before a new audit is started.
 *
 * ## No `@nestjs/schedule` — and API-10 did not add it
 *
 * Same conclusion API-08 reached and it has not changed: `@Interval` fires on a
 * fixed cadence whether or not the previous tick finished, so the re-entrancy
 * guard below has to be hand-written either way — and that guard is the only
 * part carrying risk.
 *
 * API-10 declined the library rather than adopting it. Its sweeper reads its
 * cadence from `SWEEPER_INTERVAL_MS`, and `@Interval(ms)` takes a compile-time
 * constant — so the one job with the strongest case for a decorator could not
 * have used one. The standardisation is `src/jobs/polling-job.ts`, a base class
 * that owns the timer, the guard and the teardown
 * (`specs/010-cron-jobs/research.md` R1).
 *
 * **This poller can adopt it as a pure deletion**, once that file moves to
 * `src/common/` — `guardian/` importing from `jobs/` inverts the dependency.
 * Deliberately not done here; both pollers work and both are load-bearing.
 *
 * ## Quiet by default
 *
 * An empty tick logs nothing. During a rehearsal the lines that matter are the
 * ruling and the settlement, and a poller that narrates every two seconds buries
 * both.
 */
@Injectable()
export class GuardianPoller implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(GuardianPoller.name);
  private readonly intervalMs: number;

  private timer: NodeJS.Timeout | null = null;

  /**
   * The re-entrancy guard. One drain in flight per process — which is what
   * actually serialises audits, since a single audit can outlast several ticks
   * and a second overlapping drain would claim a second order.
   *
   * ⚠️ This is a *concurrency* control, not the correctness guarantee. Across
   * processes, `verdicts.order_id UNIQUE` is what makes a second ruling
   * impossible (research R2).
   */
  private draining = false;

  /** Set on shutdown so an in-flight drain stops claiming new work. */
  private stopping = false;

  constructor(
    private readonly guardian: GuardianService,
    config: ConfigService<AppConfig, true>,
  ) {
    this.intervalMs = config.get('GUARDIAN_POLL_INTERVAL_MS', { infer: true });
  }

  onApplicationBootstrap(): void {
    this.logger.log(`guardian poller started, interval=${this.intervalMs}ms`);
    this.timer = setInterval(() => {
      void this.drain();
    }, this.intervalMs);
  }

  /**
   * Clear the interval on shutdown so the process can exit.
   *
   * A dangling `setInterval` keeps the event loop alive and turns `Ctrl-C` into
   * "process did not exit", which during a rehearsal looks like a hang rather
   * than a missing `clearInterval`.
   */
  onModuleDestroy(): void {
    this.stopping = true;
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * One tick: finish what is nearly done, then start something new.
   *
   * ⚠️ **This method never throws.** `GuardianService` already turns a failed
   * audit into a counter increment, but an unexpected error escaping into a
   * `setInterval` callback is an unhandled rejection that can take the process
   * down — and a single undecidable dispute must never stop every later dispute
   * from being decided (SC-012).
   */
  private async drain(): Promise<void> {
    if (this.draining || this.stopping) return;
    this.draining = true;

    try {
      await this.guardian.settleNext();
      if (!this.stopping) {
        await this.guardian.auditNext();
      }
    } catch (err: unknown) {
      // Deliberately the class name only — this module's requests carry the
      // seller's system prompt, and a log line goes around every serialiser.
      this.logger.error(
        `guardian tick failed: ${err instanceof Error ? err.name : typeof err}`,
      );
    } finally {
      this.draining = false;
    }
  }
}
