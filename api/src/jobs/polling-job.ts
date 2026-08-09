import {
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';

/**
 * The timer every background job in this module runs on.
 *
 * One `setInterval`, one re-entrancy guard, one `try/catch`, one teardown —
 * written once here so that no job service contains any of them. A subclass
 * declares a name, a cadence and a `runOnce()`, and inherits every guarantee
 * below without restating it.
 *
 * ## ⚠️ Why this exists instead of `@nestjs/schedule`
 *
 * The source brief for this feature says, in one line, *"Uses
 * `@nestjs/schedule`."* It does not, and the reason is not taste
 * (`specs/010-cron-jobs/research.md` R1).
 *
 * **The one job that most wants a decorator cannot use one.** `@Interval(ms)`
 * takes a **compile-time constant**. The sweeper's cadence is
 * `SWEEPER_INTERVAL_MS` — an environment key that exists precisely so a
 * rehearsal can auto-release at three seconds while production runs at sixty —
 * so the declarative form was unavailable exactly where it would have been
 * worth having. Reading a cadence from config means
 * `schedulerRegistry.addInterval(name, setInterval(fn, ms))`: `setInterval`
 * plus a registry entry plus a dependency, in a class that now also injects
 * `SchedulerRegistry`.
 *
 * **And the re-entrancy guard is hand-written under either mechanism.**
 * `@Interval` fires on a fixed cadence whether or not the previous tick
 * finished. A sweep that takes four seconds against a three-second cadence
 * overlaps itself and sends two `release` transactions for the same deal, one
 * of which is wasted gas on a chain that charges the full limit. The library
 * would have given three classes a decorator and left each of them with its own
 * `draining`/`stopping` pair — which is the duplication this base class was
 * supposed to remove.
 *
 * ## The five guarantees
 *
 * 1. **One pass at a time.** A tick that fires while the previous pass is still
 *    running returns immediately. This is the whole reason the class exists:
 *    `@nestjs/schedule` does not provide it, so it would otherwise be written
 *    three times.
 * 2. **A throw from `runOnce()` can never reach the `setInterval` callback.**
 *    An unhandled rejection inside a timer callback can take a Node process
 *    down, and one job failing must never stop the other two. The pass is
 *    abandoned, the timer is not.
 * 3. **The timer is cleared on `onModuleDestroy`.** A dangling `setInterval`
 *    keeps the event loop alive and turns `Ctrl-C` into "process did not exit"
 *    — which looks like a hang rather than a missing `clearInterval`.
 *    `execution.poller.ts` documents having been bitten by exactly this.
 * 4. **`stopping` is set *before* the timer is cleared**, so a pass already in
 *    flight stops claiming new work instead of working through a fifty-order
 *    backlog while the process is trying to shut down.
 * 5. **Exactly one log line at startup, and nothing else from the base, ever.**
 *    Idle passes are silent by construction, because there is no per-tick log
 *    to suppress. A job that narrates every second buries the lines that
 *    matter — the release, the reclaim, the reap.
 *
 * ## What it deliberately does not do
 *
 * - **No backoff, no jitter, no retry count.** The next tick *is* the retry
 *   (research R5). A job that failed because the chain was unreachable will
 *   fail identically one cadence later and succeed the moment it is back, which
 *   is the behaviour wanted for an outage measured in minutes. Backoff would
 *   only delay the recovery it is supposed to protect.
 * - **No cross-job coordination.** Three independent timers, so a slow sweep
 *   cannot delay the reaper.
 * - **No `SchedulerRegistry`, no dynamic reconfiguration.** Cadences are read
 *   once, in the subclass constructor, and fixed for the life of the process.
 *
 * ## Later adoption by the two existing pollers
 *
 * `ExecutionPoller` and `GuardianPoller` each carry a "No `@nestjs/schedule`"
 * section promising that API-10 would standardise this. Both can extend
 * `PollingJob` as a **pure deletion** — their `timer`, `draining`, `stopping`,
 * `onApplicationBootstrap` and `onModuleDestroy` members are this base line for
 * line, and their `drain()` becomes `runOnce()`. Doing it would also require
 * moving this file to `src/common/`, since `execution/` importing from `jobs/`
 * inverts the dependency.
 *
 * **That refactor is deliberately not part of this feature.** Both modules work
 * and both are load-bearing for the demo; destabilising them to remove
 * duplication is the wrong trade during a hackathon. Recorded here so the
 * option is not lost.
 */
export abstract class PollingJob
  implements OnApplicationBootstrap, OnModuleDestroy
{
  /** Log context, and the name in the startup line. Usually the class name. */
  protected abstract readonly name: string;

  /**
   * Cadence in ms. Read once, in the subclass constructor — from
   * `jobs.constants.ts` for the fixed ones, from `ConfigService` for the
   * sweeper.
   */
  protected abstract readonly intervalMs: number;

  /**
   * The logger, named after the concrete subclass.
   *
   * ⚠️ It cannot be named after `this.name`. Abstract members are implemented
   * as *derived-class field initialisers*, and those run **after** the base
   * class's — so `this.name` is still `undefined` while this line executes, and
   * every job would get a `Logger(undefined)` context. Deferring construction
   * to `onApplicationBootstrap` would fix the ordering but leave the field
   * possibly-undefined for the whole constructor, which strict mode can only
   * express as a `!` assertion — a lie that costs more than it buys.
   *
   * `this.constructor.name` sidesteps the ordering entirely: it resolves the
   * runtime constructor, so a `ReaperJob` gets `ReaperJob` even though the
   * initialiser lives up here. It is the same value `execution.poller.ts` and
   * `guardian.poller.ts` pass literally as `ExecutionPoller.name`, obtained the
   * only way a base class can obtain it. `this.name` is still used for the
   * startup line, where it is set and where the spec asked for it.
   */
  protected readonly logger = new Logger(this.constructor.name);

  /**
   * Set on shutdown so an in-flight pass stops claiming new work.
   *
   * `protected` because it is half of a contract with the subclass: the base
   * promises to set it first thing on shutdown, and `runOnce()` promises to
   * check it between iterations of its drain loop. Neither half works alone.
   */
  protected stopping = false;

  private timer: NodeJS.Timeout | null = null;

  /**
   * The re-entrancy guard. One pass in flight per process.
   *
   * ⚠️ This is a *concurrency* control, not a correctness guarantee. It says
   * nothing about a second process, where what actually prevents a duplicate
   * transition is that every claim is a conditional
   * `UPDATE … WHERE state = <expected>` (research R4). The guard exists so that
   * a pass slower than its own cadence does not race itself.
   */
  private draining = false;

  /**
   * One pass over whatever this job is responsible for.
   *
   * Called on every tick that is not already in flight. Implementations SHOULD
   * **drain** — loop until there is nothing due — rather than handling one row
   * per tick, so that three orders that came due together do not take three
   * cadences to clear. They MUST check `stopping` between iterations, so that
   * shutdown is not held open by a backlog.
   *
   * May throw. The base swallows and logs; a throw abandons the pass, never the
   * timer.
   */
  protected abstract runOnce(): Promise<void>;

  /**
   * Start the timer once the whole application is up.
   *
   * `onApplicationBootstrap` rather than `onModuleInit` on purpose: these jobs
   * reach for the chain and the database on their very first tick, and a tick
   * that fires while another module is still initialising would be doing it
   * against a half-built application.
   */
  onApplicationBootstrap(): void {
    this.logger.log(`${this.name} started, interval=${this.intervalMs}ms`);
    this.timer = setInterval(() => {
      void this.tick();
    }, this.intervalMs);
  }

  /**
   * Stop claiming work, then let the process exit.
   *
   * ⚠️ The order of the two statements is the guarantee. `stopping` is set
   * **before** the timer is cleared, so a pass that is already mid-drain sees
   * the flag on its next iteration and returns instead of grinding through
   * every remaining due order while the process is trying to die. Clearing the
   * timer first would stop future ticks and change nothing about the one that
   * is running.
   *
   * Clearing the timer at all is the other half: a dangling `setInterval` keeps
   * the event loop alive, and the symptom is a `Ctrl-C` that appears to hang.
   */
  onModuleDestroy(): void {
    this.stopping = true;
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * The guarded body every tick goes through.
   *
   * ⚠️ **This method never throws, and never rejects.** It is invoked from a
   * `setInterval` callback with `void`, so there is nobody left to catch it —
   * an escaping rejection is an unhandled rejection, and an unhandled rejection
   * can take the process down. One job's bad pass must not stop the other two
   * jobs, nor the next pass of this one.
   *
   * The `finally` is what makes the guard safe: a pass that throws still
   * releases `draining`, so a single failure cannot wedge the job permanently
   * off.
   */
  private async tick(): Promise<void> {
    if (this.draining || this.stopping) return;
    this.draining = true;

    try {
      await this.runOnce();
    } catch (err: unknown) {
      // Deliberately the error's class name only, following
      // `guardian.poller.ts`: a log line goes around every serialiser, and the
      // messages that reach here can carry a revert payload, a row, or a
      // seller's prompt. The class name is enough to tell a defect from an
      // outage; the pass is abandoned either way and the next tick retries it.
      this.logger.error(
        `${this.name} pass failed: ${err instanceof Error ? err.name : typeof err}`,
      );
    } finally {
      this.draining = false;
    }
  }
}
