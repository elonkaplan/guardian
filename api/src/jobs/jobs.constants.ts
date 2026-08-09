/**
 * Every fixed number and string the three timers use.
 *
 * Grouping them here — rather than as literals at each call site — is what
 * makes it possible to audit every value that decides when money moves by
 * reading one file. `src/execution/execution.constants.ts` and
 * `src/guardian/guardian.constants.ts` do the same thing for the same reason,
 * and this file is the third of the set: that one bounds what the platform
 * spends running a seller's agent, the second bounds what it spends judging the
 * result, and this one bounds how long anything is allowed to sit.
 *
 * ## ⚠️ `SWEEPER_INTERVAL_MS` is deliberately NOT here
 *
 * It is the one cadence in this feature that genuinely varies by deployment —
 * three seconds during a rehearsal so an uncontested trade visibly auto-releases
 * on stage, sixty in production so the query does not run twenty times a minute
 * forever — and it already exists in `src/config/env.schema.ts` as a required
 * key with no default.
 *
 * It is also the reason this feature does not use `@nestjs/schedule`. The
 * library's `@Interval(ms)` decorator takes a **compile-time constant**, so the
 * one job whose cadence is configurable could not have used the declarative form
 * anyway — it would have been
 * `schedulerRegistry.addInterval(name, setInterval(...))`, which is
 * `setInterval` plus a registry entry plus a dependency. See
 * `specs/010-cron-jobs/research.md` R1, and `polling-job.ts` for what replaced
 * it.
 *
 * ## Why everything below is a constant and not an environment key
 *
 * `env.schema.ts` states the line in its auth section: a value belongs in the
 * environment when it genuinely varies per deployment, because *"every optional
 * environment key is one more thing that can be absent at 3am."* Nothing below
 * varies. The two intervals pace jobs whose deadlines are fixed by the escrow
 * contract, and the two grace margins are product judgements about when
 * something counts as abandoned — a deployment that could change those would be
 * silently changing what "non-delivery" means, which is the same argument
 * `guardian.constants.ts` makes about `GUARDIAN_MODEL` (research R3).
 */

/**
 * How often the reclaimer looks for an escrow deal to return to its buyer.
 *
 * Five minutes, against a deadline of twenty-four hours. The cadence is
 * irrelevant to the outcome — an order becomes reclaimable at a moment the
 * contract decides, and being noticed up to five minutes later changes nothing
 * a buyer can perceive. It is not faster because there is no reason, and a
 * query against `orders` every few seconds for a deadline a day away is the
 * definition of pointless load.
 *
 * Nothing in a rehearsal waits for this job. It is the buyer's guarantee
 * against a silent platform, not part of the demo.
 */
export const RECLAIMER_INTERVAL_MS = 300_000;

/**
 * How often the reaper looks for an order abandoned mid-execution.
 *
 * One minute — the shortest of the three, because this is the only job whose
 * latency a person actually feels. An order stuck in `running` shows a buyer a
 * screen that says work is in progress when nothing is; every minute of that is
 * a minute of the product lying. It costs one indexed query per minute.
 */
export const REAPER_INTERVAL_MS = 60_000;

/**
 * How long past its own declared time limit a run is allowed to sit before the
 * reaper calls it abandoned.
 *
 * ⚠️ **This margin is the only thing standing between the reaper and killing a
 * run that is still working.** The deadline it is added to is the pinned
 * version's `timeout_seconds` — the seller's declared budget, which a run is
 * entitled to use in full — so without a margin a run finishing at 99.9% of its
 * budget races the reaper for its own result. `ExecutionRepository.markDelivered`
 * is conditional on `state = 'running'` precisely so that race resolves safely
 * rather than corruptly, but resolving safely is not the same as not having it.
 *
 * A minute is generous against timeouts measured in tens of seconds and small
 * against a wedged order's cost. Raising it makes a stuck order invisible for
 * longer; lowering it starts killing slow-but-live runs.
 */
export const REAPER_GRACE_MS = 60_000;

/**
 * How long a purchase may sit without a confirmed escrow deal before it is
 * reported.
 *
 * The resting state this covers is real and deliberate: API-07's saga leaves an
 * order in `purchased` with a NULL `onchain_deal_id` when the `openDeal`
 * transaction's outcome is **unknown** — sent, no receipt — because the money
 * may genuinely be escrowed and compensating would promise the buyer cents the
 * pool does not hold. Five minutes is far beyond the sub-second confirmation
 * this chain gives, so anything still unconfirmed at that point needs a human.
 *
 * ⚠️ It is a **reporting** threshold and nothing else. No state changes, no
 * ledger entry, no chain call — see the report in `reclaimer.job.ts` and the
 * warning on `Order.onchainDealId`.
 */
export const UNCONFIRMED_GRACE_MS = 300_000;

/**
 * The escrow's `DELIVERY_DEADLINE`, mirrored so the reclaimer's SQL can express
 * it as an interval.
 *
 * ⚠️ **This is a mirror of a contract constant, not a policy this module owns.**
 * `GuardianEscrow.sol` declares `uint32 public constant DELIVERY_DEADLINE = 24
 * hours` and enforces it itself — `reclaim` reverts `"too early"` before that
 * point no matter what this file says. Changing this number cannot move the
 * deadline; it can only make the platform ask at the wrong time, which is
 * harmless in one direction (asking early is refused for free at simulation) and
 * negligent in the other (asking late leaves a buyer's money sitting).
 *
 * Kept in hours rather than ms because it is only ever interpolated into a
 * Postgres interval literal.
 */
export const DELIVERY_DEADLINE_HOURS = 24;

/**
 * What the reaper writes into `runs.error` when it closes an abandoned run.
 *
 * ⚠️ It is written **only** where `finished_at IS NULL` — see
 * `JobsRepository.closeAbandonedRun`. A run that already finished has its own
 * error (or none, and a real output), and overwriting either would destroy
 * evidence.
 *
 * Phrased as what is known rather than as a diagnosis: the platform can see that
 * no worker came back, and cannot see whether the process was deployed over,
 * crashed, or was killed. From the buyer's side those are the same event
 * regardless.
 */
export const ABANDONED_RUN_ERROR =
  'abandoned: no worker returned; reaped by the API-10 reaper';
