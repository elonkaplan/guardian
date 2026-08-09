# Contract — `PollingJob`

**This feature exposes no HTTP endpoints.** It is three background workers; nothing calls them over
the network and `docs/openapi.yaml` (API-12) gains nothing from them. Its contracts are three
internal seams, and this is the first: the base class that owns every timer concern, so that no job
service contains a `setInterval`, a boolean guard, or a lifecycle hook.

Consumers: `SweeperJob`, `ReclaimerJob`, `ReaperJob`. See [research.md R1](../research.md) for why
this exists instead of `@nestjs/schedule`.

---

## The base

```ts
// src/jobs/polling-job.ts

export abstract class PollingJob
  implements OnApplicationBootstrap, OnModuleDestroy
{
  /** Log context and the name in the startup line. Usually the class name. */
  protected abstract readonly name: string;

  /** Cadence in ms. Read once, in the subclass constructor. */
  protected abstract readonly intervalMs: number;

  /**
   * One pass. Called on every tick that is not already in flight.
   *
   * Implementations SHOULD drain — loop until there is nothing due — and MUST
   * check `stopping` between iterations so shutdown is not delayed by a backlog.
   *
   * May throw; the base swallows and logs. A throw abandons the pass, never the
   * timer.
   */
  protected abstract runOnce(): Promise<void>;

  /** Set on shutdown. Subclasses read it in their drain loop. */
  protected stopping = false;

  onApplicationBootstrap(): void;
  onModuleDestroy(): void;
}
```

## The guarantees

1. **One pass at a time.** A tick that fires while the previous pass is still running returns
   immediately. This is the whole of FR-003, and it is the reason the base exists: `@Interval` does
   not provide it, so it would otherwise be written three times (R1).
2. **`runOnce` throwing cannot reach the timer callback.** The base wraps it in `try/catch` and logs
   at error level with the error's class name. An unhandled rejection inside a `setInterval`
   callback can take a Node process down, and FR-004 says a failing job must not do that.
3. **The timer is cleared on `onModuleDestroy`.** A dangling `setInterval` keeps the event loop
   alive and turns `Ctrl-C` into what looks like a hang. `ExecutionPoller` documents having been
   bitten by exactly this.
4. **`stopping` is set before the timer is cleared**, so a pass already in flight stops claiming new
   work rather than finishing a fifty-order backlog during shutdown (FR-005).
5. **Exactly one log line at startup** — `<name> started, interval=<n>ms` — and nothing else from the
   base, ever. Idle passes are silent by construction because the base logs nothing per tick
   (FR-006).

## What it deliberately does not do

- **No backoff, no jitter, no retry count.** The next tick is the retry (R5). A job that failed
  because the chain was unreachable will fail identically in one cadence and succeed the moment it
  is back, which is the desired behaviour for an outage measured in minutes.
- **No cross-job coordination.** Three independent timers, so a slow sweep cannot delay the reaper
  (FR-004's "the other two are unaffected").
- **No `SchedulerRegistry`, no dynamic reconfiguration.** Cadences are fixed at boot.

## Subclass shape

```ts
@Injectable()
export class ReaperJob extends PollingJob {
  protected readonly name = 'reaper';
  protected readonly intervalMs = REAPER_INTERVAL_MS;

  constructor(private readonly repo: JobsRepository) { super(); }

  protected async runOnce(): Promise<void> {
    while (!this.stopping) {
      const due = await this.repo.findAbandonedRun();
      if (due === null) break;
      await this.reap(due);
    }
  }
}
```

The sweeper is identical except that `intervalMs` comes from
`config.get('SWEEPER_INTERVAL_MS', { infer: true })` — which is the reason the decorator form of
`@nestjs/schedule` was unavailable and the base class exists at all.

## Later adoption by the two existing pollers

`ExecutionPoller` and `GuardianPoller` each carry a "No `@nestjs/schedule`" section promising that
API-10 would standardise this. Both can extend `PollingJob` as a pure deletion — their `timer`,
`draining`, `stopping`, `onApplicationBootstrap` and `onModuleDestroy` members are the base,
line for line, and their `drain()` becomes `runOnce()`.

**That refactor is not part of this feature.** Both modules work, both are load-bearing for the
demo, and destabilising them to remove duplication is the wrong trade during a hackathon. It would
also require moving `polling-job.ts` to `src/common/`, since `execution/` importing from `jobs/`
inverts the dependency. Recorded here so the option is not lost.
