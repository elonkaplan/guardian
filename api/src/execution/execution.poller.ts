import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { AppConfig } from '../config/env.schema';
import { ExecutionService } from './execution.service';

/**
 * The only thing that starts a run.
 *
 * ## ⚠️ Why a poller, and why it lives here
 *
 * `orders.state` **is** the queue (`docs/CONTEXT.md` invariant #9). API-07
 * settled that `POST /orders` calls nothing and defines no dispatcher: an order
 * sitting in `purchased` with a confirmed deal id is already, exactly, a queue
 * entry, and the move to `running` belongs to the worker that performs it
 * (`specs/007-orders-purchase-saga/research.md` R13). API-10's cron table has a
 * sweeper, a reclaimer and a reaper — and no execution trigger. Between the two
 * specs the trigger is unclaimed, so it is here.
 *
 * A poller is also the only option that covers a restart for free. An order
 * placed in the second before a deploy has a committed row, escrowed money, and
 * nobody holding a promise to run it. The next tick finds it; an in-process call
 * from the purchase never would.
 *
 * ## No `@nestjs/schedule` — and API-10 did not introduce it either
 *
 * The objection this file raised stands: `@Interval` fires on a fixed cadence
 * whether or not the previous tick finished, so the re-entrancy guard below has
 * to be hand-written either way — and that guard is the only part carrying risk
 * (research R1).
 *
 * API-10 went further and declined the dependency outright, for a reason this
 * file could not have known: `@Interval(ms)` takes a **compile-time constant**,
 * so its sweeper — whose cadence is the `SWEEPER_INTERVAL_MS` environment key —
 * could not have used the decorator at all. What it standardised on instead is
 * `src/jobs/polling-job.ts`, a base class owning the timer, the guard and the
 * teardown (`specs/010-cron-jobs/research.md` R1).
 *
 * **This poller can adopt that base as a pure deletion** — `timer`, `draining`,
 * `stopping`, `onApplicationBootstrap` and `onModuleDestroy` below are it line
 * for line, and `drain()` becomes `runOnce()`. Doing so also means moving that
 * file to `src/common/`, since `execution/` importing from `jobs/` inverts the
 * dependency. Deliberately not done: this module works and is load-bearing for
 * the demo, and destabilising it to remove duplication is the wrong trade.
 *
 * ## Quiet by default
 *
 * An empty tick logs nothing. A poller that narrates every second makes a
 * rehearsal log unreadable and buries the lines that matter — the claim, the
 * delivery, the failure.
 */
@Injectable()
export class ExecutionPoller implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(ExecutionPoller.name);
  private readonly intervalMs: number;

  private timer: NodeJS.Timeout | null = null;

  /**
   * The re-entrancy guard. One drain in flight per process — which is what
   * actually enforces `AGENT_POLL_CONCURRENCY`, since a run can outlast several
   * ticks and a second overlapping drain would claim a second order.
   */
  private draining = false;

  /** Set on shutdown so an in-flight drain stops claiming new work. */
  private stopping = false;

  constructor(
    private readonly execution: ExecutionService,
    config: ConfigService<AppConfig, true>,
  ) {
    this.intervalMs = config.get('EXECUTION_POLL_INTERVAL_MS', { infer: true });
  }

  onApplicationBootstrap(): void {
    this.logger.log(`execution poller started, interval=${this.intervalMs}ms`);
    this.timer = setInterval(() => {
      void this.drain();
    }, this.intervalMs);
  }

  /**
   * Clear the interval on shutdown, so the process can exit.
   *
   * A dangling `setInterval` keeps the event loop alive and turns `Ctrl-C` into
   * "process did not exit" — which during a rehearsal looks like a hang rather
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
   * Claim and run orders until there are none left, then return.
   *
   * Draining rather than taking one per tick so three orders placed together —
   * which is exactly what a demo rehearsal does — do not take three intervals to
   * start. Runs are still strictly sequential: `runNext` is awaited, so only one
   * agent is ever in flight.
   */
  private async drain(): Promise<void> {
    if (this.draining || this.stopping) return;
    this.draining = true;

    try {
      while (!this.stopping) {
        const claimed = await this.execution.runNext();
        if (!claimed) break;
      }
    } catch (err) {
      // Reaching here means a defect rather than a failed run — a failed run is
      // an outcome the service records and does not throw. The tick is
      // abandoned and the next one tries again; the order it was working on is
      // left in `running` for the reaper, exactly as a crashed process would.
      this.logger.error(
        `execution poll aborted: ${err instanceof Error ? err.name : 'unknown error'}`,
      );
    } finally {
      this.draining = false;
    }
  }
}
