---
description: "Task list for 010-cron-jobs"
---

# Tasks: Cron jobs — the three timers that make the deadlines fire

**Input**: Design documents from `/specs/010-cron-jobs/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/](./contracts/)

**Tests**: **No test tasks.** Automated tests of every kind are out of scope for `api/`
(`docs/CONTEXT.md`). [quickstart.md](./quickstart.md) is the suite and a failed rehearsal is a
red build.

**Organization**: Tasks are grouped by user story so each can be implemented and demonstrated
independently.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: Which user story this task serves (US1–US4)
- Every task names an exact file path

## Path Conventions

Single NestJS project rooted at `api/`. All paths below are relative to `api/`.

---

## ⚠️ Read before starting

**There is no migration in this feature.** No new column, no new index, no enum member, no new
environment key, no new dependency. If you find yourself writing one, stop and re-read
[data-model.md §0](./data-model.md) — each was considered and rejected with a reason.

Five things are easy to get wrong and expensive to get wrong. Each is a task below, and each is
here because a reviewer will check it:

1. **No job writes a ledger entry, ever** (invariant #5). Settled funds land on-chain under the
   user's own address. A "refund" credit on reclaim looks like kindness and leaves the pool owing
   more than it holds. Verified by grep in T036.
2. **The reaper's run write is `WHERE finished_at IS NULL`, and it never names `output`,
   `output_valid`, or `steps`** (invariant #7). That one predicate is what stops it destroying the
   output a lost delivery announcement left behind. T019 and quickstart §5.
3. **Never branch on a revert string.** `release` reverts `"not delivered"` for *both* "already
   released" and "buyer disputed" — one string, two states, opposite correct responses. Read the
   deal (R6). T013, T025.
4. **Chain first, then Postgres.** `orders.state = 'released'` is a claim about where the money is;
   writing it before the chain confirms tells a seller they were paid when nothing moved (R5).
5. **A reclaimed order rests in `settled`, not `failed`** (R9). `failed` is inside
   `ESCROWED_ORDER_STATES` and `settled` is outside it, so the wrong choice shows the buyer the same
   cents in `inEscrowMinor` and `settledFundsMinor` at once. T023.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Module directory and the constants file. Nothing here touches a database or a chain.

- [X] T001 Create the module directory `src/jobs/`
- [X] T002 [P] Create `src/jobs/jobs.constants.ts` exporting `RECLAIMER_INTERVAL_MS = 300_000`, `REAPER_INTERVAL_MS = 60_000`, `REAPER_GRACE_MS = 60_000`, `UNCONFIRMED_GRACE_MS = 300_000`, `DELIVERY_DEADLINE_HOURS = 24`, and `ABANDONED_RUN_ERROR` (the fixed abandonment string) — each with a doc-comment saying why it is a constant rather than an environment key, mirroring the argument in `src/guardian/guardian.constants.ts` and the header note in `src/config/env.schema.ts`'s auth section (research R3)
- [X] T003 Add a header doc-comment to `src/jobs/jobs.constants.ts` (same file as T002 — sequence, do not parallelise) recording that `SWEEPER_INTERVAL_MS` is deliberately **absent** from this file — it is the one cadence that genuinely varies by deployment (3s on stage, 60s in production), it already exists in `src/config/env.schema.ts`, and it is the reason the `@nestjs/schedule` decorator form was unavailable (research R1, R3)
- [X] T004 Confirm no migration is needed: run `npm run migration:generate -- src/migrations/CheckNoDrift` and verify it produces **no** statements against `orders` or `runs`, then delete the generated file. A non-empty diff means entity/schema drift from an earlier feature, not work for this one

**Checkpoint**: `src/jobs/` exists with one constants file; the schema is confirmed untouched.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The timer base, the chain-truth seam, the repository shell, and module registration.
**No user story work can begin until this phase is complete** — all three jobs extend the base and
all three go through the repository.

- [X] T005 [P] Create `src/jobs/polling-job.ts` with the abstract `PollingJob` class per [contracts/polling-job.md](./contracts/polling-job.md): abstract `name`, `intervalMs`, `runOnce()`; a private `timer` and `draining`; a `protected stopping`; `onApplicationBootstrap` starting the interval and logging one `<name> started, interval=<n>ms` line; `onModuleDestroy` setting `stopping` **before** clearing the timer
- [X] T006 Add the `try/catch` around `runOnce()` in `src/jobs/polling-job.ts` that logs at error level with the error's class name and swallows — an unhandled rejection inside a `setInterval` callback can take the process down, and FR-004 says a failing job must not (contract guarantee 2)
- [X] T007 [P] Create `src/jobs/deal-reconciler.ts` with the `Reconciliation` discriminated union (`done` / `not-yet` / `leave-alone` / `unknown`) and an injectable `DealReconciler` taking `EscrowReadService`, per [contracts/deal-reconciler.md](./contracts/deal-reconciler.md). Implement the short-circuits: `ChainOutcomeUnknownError` → `unknown` **without reading the deal**, a non-`ChainError` → rethrow, `DealNotFoundError` or a failing read → `unknown`
- [X] T008 Add the ⚠️ doc-comment to `src/jobs/deal-reconciler.ts` (same file as T007 — sequence, do not parallelise) recording that it must **never** branch on `ContractRevertError.reason`, with the four-string table from research R6 showing why `"not delivered"` cannot disambiguate "already released" from "the buyer disputed"
- [X] T009 Create `src/jobs/jobs.repository.ts` with the injectable class shell — `@InjectRepository(Order)` and `@InjectRepository(Run)` — and the three exported row types `DueOrder`, `AbandonedRun`, `UnconfirmedOrder` from [contracts/jobs-repository.md](./contracts/jobs-repository.md). **No queries yet**; each story adds its own
- [X] T010 Add the ⚠️ header doc-comment to `src/jobs/jobs.repository.ts` stating the three module-wide prohibitions that are checkable by grep: no `ledger_entries` write anywhere in `src/jobs/`, no statement naming `runs.output` / `output_valid` / `steps`, and no query selecting `disputed`, `adjudicated`, `released`, or `settled` (data-model.md §6)
- [X] T011 Create `src/jobs/jobs.module.ts` importing `ChainModule` and `TypeOrmModule.forFeature([Order, Run])`, providing `JobsRepository` and `DealReconciler`, and exporting nothing. Add a doc-comment recording that it deliberately imports neither `ExecutionModule` nor `GuardianModule` — the reaper's `runs` write goes through this module's own repository rather than through a handle on the thing that starts model calls (research R2)
- [X] T012 Register `JobsModule` in `src/app.module.ts` and extend that file's existing docblock with a paragraph for it, making the same argument it already makes about `ExecutionModule`: registering the module is what starts the timers, so an unregistered `JobsModule` leaves every delivered order parked with the seller unpaid
- [X] T013 Boot the app (`npm run start:dev`) and confirm it starts cleanly with `JobsModule` registered and no job yet running — no new startup lines, since no `PollingJob` subclass exists

**Checkpoint**: The base class, the reconciler, the repository shell and the module all exist and
the app boots. User stories can now proceed in parallel.

---

## Phase 3: User Story 1 — The sweeper (Priority: P1) 🎯 MVP

**Goal**: A delivered order nobody touches pays its seller on its own once the review window
expires. This is Act 1's ending and the only part of this feature an audience sees.

**Independent Test**: Buy from a succeeding agent, touch nothing, wait out the review window.
The order reaches `released` with no request made, the seller's `settledFundsMinor` rises by exactly
the price, the buyer's `inEscrowMinor` falls by the same, and `ledger_entries` is unchanged.
(quickstart §2, §3)

- [X] T014 [US1] Add `findReleasable(): Promise<DueOrder | null>` to `src/jobs/jobs.repository.ts` — the `state = 'delivered' AND onchain_deal_id IS NOT NULL AND delivered_at + (review_window_seconds * INTERVAL '1 second') <= now()` select, `ORDER BY delivered_at LIMIT 1`, with a doc-comment naming `orders_sweeper_idx (state, delivered_at)` as the index API-02 created for this job
- [X] T015 [US1] Add `markReleased(orderId): Promise<boolean>` to `src/jobs/jobs.repository.ts` — `UPDATE orders SET state='released' WHERE id=$1 AND state='delivered'`, returning whether a row moved. The conditional is what makes the sweeper idempotent without a lock or a transaction (research R4)
- [X] T016 [US1] Create `src/jobs/sweeper.job.ts` extending `PollingJob`, reading `SWEEPER_INTERVAL_MS` from `ConfigService` in the constructor, with a `runOnce()` that drains — loop `findReleasable()` until null, checking `stopping` each iteration — and for each due order calls `EscrowOperatorService.release(BigInt(dealId))` **then** `markReleased`, in that order (research R5)
- [X] T017 [US1] Add the reconciliation catch to `src/jobs/sweeper.job.ts`: on a thrown error call `DealReconciler.reconcile(err, dealId, 'sweeper')` and apply the sweeper rows of [data-model.md §5](./data-model.md) — `done` → `markReleased` and log at info; `not-yet` → log at **debug** and continue; `leave-alone` → log at warn naming the order; `unknown` → log at error. Never write on anything but `done`
- [X] T018 [US1] Add one info-level log line per released order in `src/jobs/sweeper.job.ts` naming the order id and the transaction hash, and confirm an empty drain logs nothing at all (FR-006)
- [X] T019 [US1] Register `SweeperJob` as a provider in `src/jobs/jobs.module.ts`
- [X] T020 [US1] Verify by hand against [quickstart.md](./quickstart.md) §2 (⭐ the release happens with nobody touching the keyboard, the money moves in both figures, and no ledger row appears) and §3 (a released order is never swept twice, including the forced case where the chain has settled and the database has not)

**Checkpoint**: Act 1 ends on its own. This is a complete, demonstrable increment — the other three
stories can be skipped and the demo still lands.

---

## Phase 4: User Story 2 — The reaper (Priority: P1)

**Goal**: Nothing sits mid-run forever. An order abandoned by a dead process reaches `failed`, and
the evidence already on its run record survives untouched.

**Independent Test**: Kill the backend mid-run, restart, and confirm the order reaches `failed`
within a cadence plus the grace margin, the escrow was never told anything, and exactly one run
record exists with a NULL output. (quickstart §4, §5, §6)

- [X] T021 [US2] Add `findAbandonedRun(): Promise<AbandonedRun | null>` to `src/jobs/jobs.repository.ts` — the `state = 'running'` select joining `agent_versions` for `timeout_seconds` and **LEFT** joining `runs`, due when `COALESCE(r.started_at, o.created_at) + timeout + REAPER_GRACE_MS <= now()`. Doc-comment the `LEFT JOIN` + `COALESCE`: an inner join leaves an order that crashed between `claimNext` and `openRun` stuck forever, which is the exact hole the reaper exists to close (research R7)
- [X] T022 [US2] ⚠️ Add `closeAbandonedRun(orderId): Promise<boolean>` to `src/jobs/jobs.repository.ts` — `UPDATE runs SET finished_at=now(), duration_ms=…, error=ABANDONED_RUN_ERROR WHERE order_id=$1 AND finished_at IS NULL`. The statement must **not name** `output`, `output_valid`, or `steps`. Doc-comment the guard as the single predicate that satisfies both halves of FR-019 with no branch: it closes a dead process's run and silently skips the already-closed run of a successful execution whose `markDelivered` failed (research R8)
- [X] T023 [US2] Add `markReaped(orderId): Promise<boolean>` to `src/jobs/jobs.repository.ts` — `UPDATE orders SET state='failed' WHERE id=$1 AND state='running'`, with a doc-comment pointing at `ExecutionRepository.markDelivered`, which is conditional on the same state for the same race, from the other side
- [X] T024 [US2] Create `src/jobs/reaper.job.ts` extending `PollingJob` with `intervalMs = REAPER_INTERVAL_MS`, draining `findAbandonedRun()`, and calling `closeAbandonedRun` **before** `markReaped` — the reverse order leaves a window in which an order reads `failed` with an open run, the shape a case file misreads as a run still in progress (contract `jobs-repository.md`)
- [X] T025 [US2] Add the ⚠️ doc-comment to `src/jobs/reaper.job.ts` recording that it makes **no chain call of any kind** — nothing was delivered, so `markDelivered` would open a review window over work that does not exist (FR-018) — and that it never re-runs an agent
- [X] T026 [US2] Add one info-level log line per reaped order in `src/jobs/reaper.job.ts` naming the order and whether the run was closed or already closed, so the lost-announcement case is visible in the log rather than silent
- [X] T027 [US2] Register `ReaperJob` as a provider in `src/jobs/jobs.module.ts`
- [~] T028 [US2] **PARTIAL** — §5 verified live (see below); §4 and §6 need a real agent run. Verify by hand against [quickstart.md](./quickstart.md) §4 (a killed run ends `failed` with one run record and no chain call), ⭐ §5 (**a reaped order's existing output is byte-identical afterwards** — the worst failure on the page), and §6 (a live run using its full time limit is never killed)

**Checkpoint**: A restart mid-rehearsal no longer wedges an order. Independent of US1.

---

## Phase 5: User Story 3 — The reclaimer (Priority: P2)

**Goal**: Money is never stranded in a deal that never delivered. After the delivery deadline the
platform returns it to the buyer on-chain, and writes nothing to the ledger.

**Independent Test**: Point at a deal opened more than 24 hours ago that never delivered. One pass
returns the money: the order reads `settled` with a `settled_at`, the price moves from
`inEscrowMinor` to `settledFundsMinor`, and `ledger_entries` is unchanged. (quickstart §7, §8)

- [X] T029 [US3] Add `findReclaimable(): Promise<DueOrder | null>` to `src/jobs/jobs.repository.ts` — `state IN ('purchased','failed') AND onchain_deal_id IS NOT NULL AND created_at + INTERVAL '24 hours' <= now()`, `ORDER BY created_at LIMIT 1`. Doc-comment both halves: `'failed'` is in the list because the contract cannot tell "never ran" from "ran and produced nothing" — both are `DealState.Open` (research R10) — and `IS NOT NULL` excludes both the unconfirmed mid-saga order and the compensated `openDeal`-refused one
- [X] T030 [US3] ⚠️ Add `markReclaimed(orderId): Promise<boolean>` to `src/jobs/jobs.repository.ts` — `UPDATE orders SET state='settled', settled_at=now() WHERE id=$1 AND state IN ('purchased','failed')`. Doc-comment why the resting state is `settled` and **not** `failed`: `failed` is inside `ESCROWED_ORDER_STATES` and `settled` is outside it, so leaving it `failed` counts the money in `inEscrowMinor` and `settledFundsMinor` at once (research R9, `src/orders/order-states.ts`)
- [X] T031 [US3] Create `src/jobs/reclaimer.job.ts` extending `PollingJob` with `intervalMs = RECLAIMER_INTERVAL_MS`, draining `findReclaimable()`, calling `EscrowOperatorService.reclaim(BigInt(dealId))` **then** `markReclaimed`
- [X] T032 [US3] Add the reconciliation catch to `src/jobs/reclaimer.job.ts` applying the reclaimer rows of [data-model.md §5](./data-model.md) — `done` → `markReclaimed` and log at info; `not-yet` (deal still `Open`, our clock ahead of `openedAt`) → **debug**; `leave-alone` (deal `Delivered`/`Disputed`, delivery landed after all) → warn; `unknown` → error
- [X] T033 [US3] ⚠️ Add the doc-comment to `src/jobs/reclaimer.job.ts` recording that it writes **no ledger entry** — the money returns as an on-chain claim under the buyer's own address (invariant #5), and a credit here would hand the buyer the same money twice, which invariant #1 calls the one error no later entry can correct. Mirror the "Nothing here writes a ledger entry" section `src/guardian/guardian.service.ts` already carries
- [X] T034 [US3] Register `ReclaimerJob` as a provider in `src/jobs/jobs.module.ts`
- [ ] T035 [US3] Verify by hand against [quickstart.md](./quickstart.md) ⭐ §7 (all three checks: `settled` not `failed`; the price in exactly one of the two money figures; **`ledger_entries` unchanged**) and §8 (a premature reclaim is untouched and logged at debug, not error)

**Checkpoint**: The buyer's guarantee against a silent platform is in place. Independent of US1 and US2.

---

## Phase 6: User Story 4 — Safe to leave running unattended (Priority: P2)

**Goal**: Failing is uneventful. A refused or unanswered chain call costs one order one cadence and
nothing else — no crashed scheduler, no wedged process, no log nobody can read. Plus the one thing
that would otherwise be invisible: a purchase whose escrow deal never confirmed.

**Independent Test**: Point the backend at an unreachable RPC and leave it through many cadences of
all three jobs. The process stays up, all three keep ticking, every failure names an order, and the
backlog clears on its own when the chain returns. (quickstart §1, §9, §10, §12)

> The base class already carries most of this (T005, T006). What remains is per-order containment
> inside each drain, the log-level pass, and the unconfirmed-purchase report — FR-030, the
> visibility-only reading of the fourth job confirmed with the author during `/speckit-specify`.

- [X] T036 [US4] Wrap the per-order body of each drain loop in `src/jobs/sweeper.job.ts`, `src/jobs/reclaimer.job.ts` and `src/jobs/reaper.job.ts` in its own `try/catch`, so one order that cannot be handled does not abandon the rest of the pass — the base class's catch is the outer net for a defect, not the routine path for a failing chain call
- [X] T037 [US4] Confirm every drain loop checks `this.stopping` between iterations, so a fifty-order backlog is not worked through during shutdown (FR-005, contract guarantee 4)
- [X] T038 [US4] Add `findUnconfirmedPurchases(): Promise<UnconfirmedOrder[]>` to `src/jobs/jobs.repository.ts` — `state='purchased' AND onchain_deal_id IS NULL AND created_at + UNCONFIRMED_GRACE_MS <= now()`, the **whole set**, ordered by `created_at`. It is a report, not a work queue
- [X] T039 [US4] Add the unconfirmed-purchase report to `src/jobs/reclaimer.job.ts`: run it at the end of each pass, log each hit at error level naming the order id and buyer account, and deduplicate against a private `Set<string>` of already-reported ids so a steady state produces one line per order per process rather than one every five minutes (research R12)
- [X] T040 [US4] ⚠️ Add the doc-comment to that report in `src/jobs/reclaimer.job.ts` recording that it changes **nothing** — not the state, not the ledger — and makes **no chain call**: the deal may yet confirm, and `src/entities/order.entity.ts` is explicit that retrying `openDeal` against a NULL id is how one purchase ends up with two deals escrowing two prices
- [X] T041 [US4] Audit log levels across all three job files against [data-model.md §5](./data-model.md): "not yet" at debug, a lost race at warn, a real failure at error, an action taken at info, an empty pass silent. A rehearsal log that is red for a system working correctly is a defect
- [~] T042 [US4] **PARTIAL** — §1, §10 and §12 verified live (see below); §9 (unreachable chain) not run. Verify by hand against [quickstart.md](./quickstart.md) §1 (two idle minutes produce zero job lines), ⭐ §9 (an unreachable chain for ten minutes: process up, three timers ticking, every failure names an order, backlog clears with no restart), §10 (Ctrl-C exits promptly), and §12 (an unconfirmed purchase is reported exactly once, and again after a restart)

**Checkpoint**: All four stories complete. The timers can be left alone overnight.

---

## Phase 7: Polish & Cross-Cutting Concerns

- [X] T043 [P] Run the three prohibition greps from [data-model.md §6](./data-model.md) over `src/jobs/` and confirm each returns nothing: `ledger` (no ledger write, invariant #5), `output|output_valid|steps` (invariant #7), and `disputed|adjudicated|forceResolve|markDelivered|resolve\(` (research R14). Record the results in the PR description — these are absences, and an absence is only verified by looking
- [X] T044 [P] Update the "No `@nestjs/schedule`" section in `src/execution/execution.poller.ts` and `src/guardian/guardian.poller.ts`: both currently promise *"API-10 will introduce it, and standardising then is a five-line change"*, which is now wrong. Replace with a pointer to `src/jobs/polling-job.ts` and the reason the library was declined (research R1), plus a note that adopting the base here is a pure deletion, deliberately deferred
- [X] T045 [P] Add a note to `src/chain/chain.constants.ts` beside the `reclaim: 130_000n` ceiling recording that it is now exercised by a live job, that it remains **ESTIMATED** from `release`'s shape, and that a `GasExhaustedError` from `reclaim` means this ceiling first (research R13)
- [X] T046 Re-read `src/jobs/` end to end against [spec.md](./spec.md)'s FR list and confirm each of FR-001 … FR-030 is either implemented or explicitly out of scope — in particular FR-015 (a pass handles every due order, not one per tick), FR-022 (an order that left `running` between selection and write is not moved), and FR-030's three prohibitions
---

## Phase 8: Found while building (added during implementation)

Three defects surfaced by writing and running this that no amount of planning had caught. Each is
written up in research; they are listed here so the work is traceable rather than silent.

- [X] T048 ⚠️ **`orders.delivered_at` was never written by anything.** Fixed in
  `src/execution/execution.repository.ts` — `markDelivered` now sets `deliveredAt: new Date()`, with
  a docblock explaining the two things the absence broke and why our receipt time is the safe
  choice over `block.timestamp` (research R16). `markFailed` deliberately still does not set it
- [X] T049 ⚠️ **The drain loop spins forever on an order it fails to advance.** Added a per-pass
  `skipIds` argument to all three selection queries in `src/jobs/jobs.repository.ts` and a `skipped`
  accumulator to all three job drains; updated
  [contracts/jobs-repository.md](./contracts/jobs-repository.md) to match (research R17)
- [X] T050 ⚠️ **The reaper's log line diagnosed a cause it could not know.** Corrected in
  `src/jobs/reaper.job.ts` to report the observation rather than assert a lost delivery
  announcement — a live reap produced the message on a run whose output was NULL (research R18)

---

- [ ] T047 Run the full rehearsal per [quickstart.md](./quickstart.md) §13 — all three acts, end to end, **twice in one session** — and confirm no order is left in a state a human has to correct and the log between acts is quiet. This is the release gate; treat a failure exactly as a red build

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: no dependencies
- **Phase 2 (Foundational)**: depends on Phase 1 — **blocks all four user stories**
- **Phase 3 (US1) / Phase 4 (US2) / Phase 5 (US3)**: each depends only on Phase 2. Mutually
  independent; any one can ship alone
- **Phase 6 (US4)**: T036, T037 and T041 touch the three job files, so they depend on whichever of
  US1–US3 have been built. T038–T040 depend on US3 only (they ride the reclaimer's timer)
- **Phase 7 (Polish)**: depends on everything intended to ship

### User Story Dependencies

- **US1 (P1, sweeper)** — after Phase 2. No dependency on any other story. **This is the MVP.**
- **US2 (P1, reaper)** — after Phase 2. Independent. Touches no chain call and no reconciler, so it
  is the one story that can be built with the RPC down
- **US3 (P2, reclaimer)** — after Phase 2. Independent. Shares `DealReconciler` with US1 but adds
  its own rows to it, not a change to US1's
- **US4 (P2, unattended)** — mostly delivered by Phase 2's base class. Its remaining tasks harden
  whichever jobs exist

### Within Each User Story

Repository query → repository write → job service → reconciliation catch → registration →
hand verification. The verification task is last and is not optional.

### File-Level Serialisation

`src/jobs/jobs.repository.ts` and `src/jobs/jobs.module.ts` are each touched by every story, so
tasks against them are **never** `[P]` across stories. Everything else in a story phase is a
distinct file.

---

## Parallel Opportunities

```bash
# Phase 1 — after T001:
T002  jobs.constants.ts
T003  jobs.constants.ts header      # same file as T002; sequence them

# Phase 2 — the two independent new files:
T005  polling-job.ts
T007  deal-reconciler.ts
T008  deal-reconciler.ts doc-comment  # after T007

# Phases 3–5 — with three developers, one story each after Phase 2:
Dev A: T014 → T020   (sweeper)
Dev B: T021 → T028   (reaper)
Dev C: T029 → T035   (reclaimer)
# ⚠️ All three edit jobs.repository.ts and jobs.module.ts. Coordinate those two
#    files or expect merge conflicts — the queries themselves do not overlap.

# Phase 7:
T043  greps
T044  the two poller docblocks
T045  chain.constants.ts note
```

---

## Implementation Strategy

### MVP first (User Story 1 only)

1. Phase 1 — Setup (T001–T004)
2. Phase 2 — Foundational (T005–T013) — **blocks everything**
3. Phase 3 — the sweeper (T014–T020)
4. **STOP and validate**: quickstart §2 and §3
5. Act 1 now ends on its own with nobody touching the keyboard. That is the demo-visible half of
   this feature, and it is roughly a third of the work

### Incremental delivery

1. Setup + Foundational → the timers can run, none do yet
2. **+ US1 (sweeper)** → Act 1 auto-releases 🎯
3. **+ US2 (reaper)** → a restart mid-rehearsal no longer wedges an order. Highest value per line
   of the remaining three, because it is what makes rehearsing repeatable
4. **+ US3 (reclaimer)** → the buyer's 24-hour guarantee. Nothing in a rehearsal waits for it, so it
   is last of the three despite touching money
5. **+ US4 (unattended)** → containment, log levels, and the unconfirmed-purchase report
6. Polish → the three greps and the full rehearsal

### If time runs short

Ship US1 and US2. US3 enforces a deadline a day away that no demo reaches, and US4's base-class
half is already in Phase 2 — what would be lost is the per-order containment and the report, both of
which degrade to "an error takes out one pass instead of one order", which the next tick recovers.
Do not skip T043; the three prohibitions it checks are absences, and absences do not announce
themselves.

---

## Notes

- `[P]` = different files, no dependency on an incomplete task
- No test tasks by standing decision; [quickstart.md](./quickstart.md) is the suite
- **No migration, no env key, no dependency.** If a task seems to need one, re-read
  [data-model.md §0](./data-model.md) before writing it
- Commit after each task or logical group
- Stop at any checkpoint to validate a story independently

---

## Verification log — what was actually run

Recorded here because "verified by hand" is worthless without saying which hand and when.
Run 2026-08-09 against the live dev stack (Docker `api` container hot-reloading `./src`, Monad
testnet, chain id 10143).

| Check | Result |
| --- | --- |
| `npx tsc --noEmit` | clean, every step |
| Boot, all three jobs | `sweeper started, interval=3000ms` / `reaper …60000ms` / `reclaimer …300000ms` |
| §1 idle silence | ~15 sweeper passes, **0** job log lines beyond startup ✅ |
| ⭐ §2 sweeper releases | **live, real money.** Order `2de08f97` (deal 22): `release` sent, 130,000 gas, tx `0xd5d1d5ef…`; order → `released`; seller on-chain balance **0¢ → 100¢** = exactly `price_minor`; ledger rows **1 → 1 unchanged**; order left `ESCROWED_ORDER_STATES` ✅ |
| §3 no double sweep | two sweepers raced (container + local process) → **exactly one** release tx, no error, no duplicate write ✅ |
| ⭐ §5 reaper preserves evidence | order `fc9b8f72` flipped to `running`; reaper moved it back to `failed`; run row **byte-identical** (`diff` empty) — `finished_at`, `duration_ms`, `error`, `output`, `steps` all untouched ✅ |
| §10 clean shutdown | SIGTERM → process exited in ~2s, no dangling timer ✅ |
| ⭐ §12 unconfirmed report | fired at exactly +5min, ERROR level, named order + buyer + 172m wait; **still 1 occurrence** after the following tick — dedupe holds ✅ |
| FR-018 grep | only `escrow.release` and `escrow.reclaim` in `src/jobs/` ✅ |
| Prohibition greps (T043) | no `ledger` write, no `output`/`output_valid`/`steps`, no `disputed`/`adjudicated` in code ✅ |
| State-literal audit | `Released` and `Settled` appear **once each, SET side only** — never selected ✅ |

**Not run**, and why:

- **§4 / §6 (reaper against a live agent run)** — needs a real purchase to kill mid-execution. §5
  covered the dangerous half (evidence preservation); §4 and §6 cover the ordinary half.
- **§7 / §8 (T035, the reclaimer end to end)** — needs an escrow deal older than 24 hours. The
  oldest undelivered deal in the dev database is ~3 hours old, and the contract enforces
  `DELIVERY_DEADLINE` itself, so this cannot be forced by backdating `created_at`. The *selection*
  query and the no-ledger-entry rule were verified statically; the `reclaim` call itself has never
  been sent against this deployment — which is also why `GAS_LIMITS.reclaim` is still marked
  ESTIMATED (research R13).
- **§9 (unreachable chain for 30 minutes)** — not run.
- **§13 (T047, the full rehearsal)** — the release gate, and it needs someone driving the demo.
