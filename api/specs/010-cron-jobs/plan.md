# Implementation Plan: Cron jobs — the three timers that make the deadlines fire

**Branch**: `010-cron-jobs` | **Date**: 2026-08-09 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/010-cron-jobs/spec.md`

## Summary

> **⚠️ Amended after implementation.** Three things were found by building and running this, and
> each is written up in research: **R16** — `orders.delivered_at` was never written by anything, so
> the sweeper could not have worked and the complaint window never closed; **R17** — the drain loop
> spins forever on an order it fails to advance, fixed with a per-pass skip list; **R18** — a reaper
> log line diagnosed a cause it could not know. R16 is the one that breaks the claim below about
> touching no existing file: `execution.repository.ts` gains one line.

One new module — `src/jobs/` — and almost nothing else. **No migration, no new environment key, no
new dependency, no HTTP surface.** Two existing files change: `app.module.ts` (one import,
one provider) and `execution.repository.ts` (one column write — see R16).

The chain adapter already has both calls this feature makes. `EscrowOperatorService.release` and
`.reclaim` exist, are gas-budgeted, and route through the same `executeWrite` pipeline that
simulates before it broadcasts. `EscrowReadService.getDeal` returns a typed `DealState`.
`orders_sweeper_idx (state, delivered_at)` was created by API-02 and named for this job.
`runs.started_at` was written eagerly by API-08 with the stated purpose of giving the reaper
something to read. Nine specs' worth of plumbing was built expecting these three timers; the work
here is the timers.

Fifteen decisions carry it, argued in [research.md](./research.md). Five matter enough to state up
front:

- **⚠️ No `@nestjs/schedule`** (R1). The library is in the source brief and was promised twice in
  existing docblocks, and it is being declined with a concrete reason: `@Interval` takes a
  compile-time constant, so the sweeper — the one job whose cadence is an environment key — cannot
  use the decorator anyway, and the re-entrancy guard is hand-written either way. What the two
  pollers actually asked for was standardisation; a shared `PollingJob` base class delivers that
  and deletes duplication instead of adding a dependency.
- **⚠️ A reclaimed order rests in `settled`, not `failed`** (R9). Forced by
  `ESCROWED_ORDER_STATES`: `failed` is inside that set and `settled` is outside it, so a reclaimed
  order left in `failed` shows the buyer the same cents in `inEscrowMinor` and `settledFundsMinor`
  at once. And it writes **no ledger entry** — invariant #5.
- **⚠️ The reclaimer covers `failed` orders too** (R10). `reclaim` requires `DealState.Open`, and a
  deal is Open whether the agent never ran or ran and produced nothing. Covering only `purchased`
  strands the money of every buyer whose agent failed.
- **Reconcile by reading the deal, never by matching the revert string** (R6). `release` reverts
  `"not delivered"` for *both* "someone already released it" and "the buyer disputed it" — one
  string, two states, opposite correct responses.
- **The reaper's run write is one `UPDATE … WHERE finished_at IS NULL`** (R8). That single predicate
  is what makes "close the abandoned run" and "never overwrite the output a lost delivery
  announcement left behind" the same statement instead of two branches.

### Three amendments to the source brief

Each is a place this plan does something the brief did not say, and each is argued in full in
research.

1. **`@nestjs/schedule` is not used** (R1). The brief names it in one line. The reasoning above
   holds regardless of which mechanism is picked; if the dependency is wanted for its own sake, the
   `PollingJob` base is where it would go and the three job services would not change.
2. **The reclaimer's resting state is `settled`** (R9). The brief specifies the trigger and the
   chain call and stops there. There is exactly one state that keeps the buyer's money figures
   honest.
3. **The reclaimer's predicate includes `failed`** (R10). The brief says `purchased`.

A fourth divergence is not an amendment but a note: the brief closes with *"Build against
`docs/openapi.yaml` (API-12)."* That file does not exist yet, and this feature adds no endpoint,
changes no response shape, and introduces no new order state — a reclaimed order returns `settled`,
which is already in the enum. There is nothing for it to diverge from.

## Technical Context

**Language/Version**: TypeScript 5.x on Node.js, NestJS 11

**Primary Dependencies**: `@nestjs/common`, `@nestjs/config`, `@nestjs/typeorm`, `viem` — **all
already present. This feature adds none.**

**Storage**: PostgreSQL via TypeORM. Reads and writes `orders`; writes two columns of `runs`. No
schema change.

**Testing**: None. Automated tests are out of scope for this component by standing decision
(`docs/CONTEXT.md`); acceptance is by hand against [quickstart.md](./quickstart.md).

**Target Platform**: Long-running Node process in Docker, one instance.

**Project Type**: Backend module — three background workers, no controller, no route.

**Performance Goals**: A sweep must clear every due order within one cadence at rehearsal scale
(tens of orders). Sequential chain calls at roughly one confirmation each, so a pass over *n* due
orders takes about *n* seconds; the re-entrancy guard absorbs a pass that outlives its cadence.

**Constraints**: No job may crash the process or the other two jobs. No job may write a ledger
entry. No job may act on `disputed`, `adjudicated`, `released`, or `settled`. Idle passes must be
silent. Every chain write goes out from the one operator key, so writes are strictly sequential
(R11).

**Scale/Scope**: Roughly 8 new files, ~600 lines including doc comments. Tens of orders in a
rehearsal; hundreds at most before the demo is over.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

`.specify/memory/constitution.md` is **an unfilled template** — every principle is still a
`[PRINCIPLE_N_NAME]` placeholder. There are no ratified gates to evaluate, so this check cannot
fail and is not being treated as a pass by default either.

The governing constraints this feature was actually checked against are the nine invariants in
`api/docs/CONTEXT.md` §2, which function as this component's real constitution:

| Invariant | Bearing on this feature | Verdict |
| --- | --- | --- |
| #1 Two-phase money, Postgres first | No ledger leg exists in either flow, so the table has no row for them. What governs is "never claim a payout the chain has not confirmed" — hence chain first, state second (R5). | ✅ Not engaged; the adjacent rule is followed |
| #2 One money unit — cents | This feature moves no amounts. Both calls take a `dealId` and the contract reads its own snapshot. | ✅ Untouched |
| #3 `system_prompt` never reaches a buyer | No job reads a definition's prompt. The reaper reads `timeout_seconds` and nothing else from `agent_versions`. | ✅ Untouched |
| #4 Ledger is append-only | No job writes a ledger row at all. | ✅ |
| #5 Settlement writes no ledger entry | This is the rule that makes both `release` and `reclaim` ledger-silent (R9). | ✅ Load-bearing and followed |
| #6 Orders point at `agent_version_id` | The reaper joins through it for the pinned time limit — it never resolves the agent's current version. | ✅ |
| #7 `runs.output IS NULL` is evidence | The reaper's `UPDATE` never names `output`, `output_valid`, or `steps`, and its `finished_at IS NULL` guard excludes the one row that already has an output (R8). | ✅ Structurally enforced |
| #8 Verdict persisted before the chain call | No job writes or reads a verdict. Nothing selects `disputed` or `adjudicated` (R14). | ✅ Untouched |
| #9 `orders.state` is the queue; a cron reaper catches anything stuck | **This feature is the second half of that sentence.** | ✅ Delivered |

**Post-Phase-1 re-check**: unchanged. The design added one module, no schema change, and no new
cross-module import beyond `ChainModule`. `jobs` imports neither `execution` nor `guardian`, so the
separation those two maintain is not weakened (R2).

## Project Structure

### Documentation (this feature)

```text
specs/010-cron-jobs/
├── plan.md              # This file
├── research.md          # Phase 0 — 15 decisions
├── data-model.md        # Phase 1 — queries, transitions, no schema change
├── quickstart.md        # Phase 1 — hand-verification of all four stories
├── contracts/
│   ├── polling-job.md   # The shared timer seam
│   ├── jobs-repository.md  # Every query and every write, verbatim
│   └── deal-reconciler.md  # The chain-truth seam
├── checklists/
│   └── requirements.md
└── tasks.md             # Phase 2 — NOT created by /speckit-plan
```

### Source Code (repository root)

```text
api/src/
├── jobs/                      # NEW — the whole feature
│   ├── jobs.module.ts         # registers three jobs; imports ChainModule + TypeOrmModule
│   ├── jobs.constants.ts      # cadences and grace margins (R3) — no env keys
│   ├── polling-job.ts         # abstract base: timer, re-entrancy guard, shutdown (R1)
│   ├── jobs.repository.ts     # the three selection queries and the four writes
│   ├── deal-reconciler.ts     # revert → read the deal → decide (R6)
│   ├── sweeper.job.ts         # delivered + window elapsed → release() → released
│   ├── reclaimer.job.ts       # open deal past 24h → reclaim() → settled; + unconfirmed report
│   └── reaper.job.ts          # running past timeout+grace → failed
│
├── app.module.ts              # MODIFIED — one import line
│
├── chain/                     # unchanged — release, reclaim, getDeal all exist
├── entities/                  # unchanged — no new column, no enum change
├── execution/                 # unchanged — not imported by jobs
├── guardian/                  # unchanged — not imported by jobs
└── orders/                    # unchanged — ESCROWED_ORDER_STATES already correct
```

**Structure Decision**: A single new module at `src/jobs/`, which is the name
`docs/CONTEXT.md` §3's module map and `docs/project-structure.md` already reserve for it. It is the
last unbuilt entry in that map. It imports `ChainModule` for the two write calls and the one read,
and declares `Order` and `Run` through `TypeOrmModule.forFeature`; it imports no other feature
module (R2). `app.module.ts` gains `JobsModule` — and the same argument its docblock already makes
about `ExecutionModule` applies verbatim here: registering the module is what starts the timers, so
an unregistered `JobsModule` would leave every delivered order parked with the seller unpaid.

### The three jobs at a glance

| Job | Cadence | Selects | Chain call | Writes |
| --- | --- | --- | --- | --- |
| Sweeper | `SWEEPER_INTERVAL_MS` (env) | `delivered` AND `delivered_at + review_window_seconds <= now()` | `release(dealId)` | `state = 'released'` |
| Reclaimer | 5 min (constant) | `state IN ('purchased','failed')` AND `deal id NOT NULL` AND `created_at + 24h <= now()` | `reclaim(dealId)` | `state = 'settled'`, `settled_at` |
| Reaper | 1 min (constant) | `running` AND `COALESCE(run.started_at, created_at) + timeout + grace <= now()` | **none** | `state = 'failed'`; `runs.finished_at`/`duration_ms`/`error` where `finished_at IS NULL` |

Plus one query that is not a job: the reclaimer's pass also reports `purchased` orders with no
confirmed deal past a grace period, at error level, once per order per process (R12) — the
visibility-only reading of the fourth job, confirmed with the author during `/speckit-specify`.

## Phase 1 design summary

- **[contracts/polling-job.md](./contracts/polling-job.md)** — the abstract base every job extends.
  Owns `setInterval`, the `draining`/`stopping` pair, `onApplicationBootstrap`,
  `onModuleDestroy`, and the guarantee that `runOnce()` throwing can never reach the timer callback.
  Subclasses implement `name`, `intervalMs`, and `runOnce()`.
- **[contracts/jobs-repository.md](./contracts/jobs-repository.md)** — every SQL statement this
  feature issues, written out. Three selects, four writes, all conditional on the state they expect.
- **[contracts/deal-reconciler.md](./contracts/deal-reconciler.md)** — the seam that turns a
  `ChainError` into one of four outcomes (`Done`, `NotYet`, `LeaveAlone`, `Unknown`) by reading the
  deal rather than by parsing a revert string.
- **[data-model.md](./data-model.md)** — the state transitions this feature adds to the machine,
  the exact predicates, and the argument for why `purchased → settled` and `failed → settled` are
  new edges that no existing reader breaks on.
- **[quickstart.md](./quickstart.md)** — hand-verification for all four user stories, including how
  to force a 24-hour deadline and a stuck `running` order without waiting a day or killing a process.

## Complexity Tracking

No constitution gates exist to violate. One deviation from the source brief carries a complexity
cost worth recording explicitly:

| Deviation | Why | Simpler alternative rejected because |
| --- | --- | --- |
| A hand-rolled `PollingJob` base instead of `@nestjs/schedule` (R1) | The sweeper's cadence is an environment key, which `@Interval`'s compile-time constant cannot take; the re-entrancy guard is hand-written under either mechanism | Using the library would mean `SchedulerRegistry.addInterval(name, setInterval(...))` for the sweeper — the same code, plus a dependency, plus `ScheduleModule.forRoot()` — and would leave the duplicated guard in all three jobs rather than removing it |
