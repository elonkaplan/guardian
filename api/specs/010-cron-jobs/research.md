# Research: Cron jobs — the three timers that make the deadlines fire

**Feature**: `010-cron-jobs` · **Date**: 2026-08-09 · **Spec**: [spec.md](./spec.md)

Fifteen decisions. Three of them contradict something written down elsewhere, and those three are
marked ⚠️ and argued at length; the rest are confirmations that the plumbing this feature needs
already exists and behaves the way the spec assumed.

---

## R1 — ⚠️ No `@nestjs/schedule`. A shared `PollingJob` base instead

**Decision**: Do not add the dependency. Put a small abstract `PollingJob` base class in
`src/jobs/` that owns the timer, the re-entrancy guard, and the shutdown teardown, and derive the
three jobs from it.

**This contradicts the source brief**, which says in one line: *"Uses `@nestjs/schedule`."* It also
retires a promise made twice in the codebase — `execution.poller.ts` and `guardian.poller.ts` both
carry a "No `@nestjs/schedule`" section saying *"API-10 will introduce it, and standardising then is
a five-line change."* The promise is being kept; the library is not the thing that keeps it.

**Rationale**, in the order the arguments actually matter:

1. **The one job that most wants a decorator cannot use one.** `@Interval(ms)` takes a
   compile-time constant. The sweeper's cadence is `SWEEPER_INTERVAL_MS`, an environment key that
   exists precisely so a rehearsal can run it at three seconds and production at sixty. Reading it
   from config means `SchedulerRegistry.addInterval(name, setInterval(fn, ms))` — which is
   `setInterval` plus a registry entry, in a class that now also injects `SchedulerRegistry`. The
   declarative form is unavailable exactly where it would have been worth having.

2. **The re-entrancy guard is hand-written either way.** `@Interval` fires on a fixed cadence
   whether or not the previous tick finished. A sweep that takes four seconds against a
   three-second cadence overlaps itself and sends two `release` transactions for the same deal —
   one of which is wasted gas on a chain that charges the full limit. Both existing pollers already
   observed this; it is the entire content of their objection and it is unchanged.

3. **What the two docblocks actually asked for was standardisation, and a base class delivers
   it better.** The library would give three classes a decorator and leave each of them with its
   own `draining`/`stopping` pair. The base class removes that duplication outright, and it is the
   thing an eventual fourth job inherits. It is also adoptable by the two existing pollers later as
   a pure deletion, with no new import in their `package.json`.

4. **Cost.** `@nestjs/schedule` pulls in `cron` and requires `ScheduleModule.forRoot()` in
   `AppModule`, for three timers in an MVP that has decided against job queues, distributed
   locking, and retry frameworks. It is the same category of dependency those exclusions rejected.

**Where the base class lives**: `src/jobs/polling-job.ts`. Not `src/common/` — nothing outside
`src/jobs/` imports it today, and putting it in `common/` would invite `execution/` and `guardian/`
to depend on it, which is a refactor of two working modules that this feature has no reason to
perform. If that refactor is ever wanted, moving one file is the whole of it.

**Alternatives considered**: (a) `@nestjs/schedule` with `SchedulerRegistry` for all three — same
code, one more dependency; (b) `@Interval` for the reaper and reclaimer, `setInterval` for the
sweeper — two mechanisms for three jobs, the worst outcome; (c) one combined timer running all
three passes — couples three independent cadences and makes a slow sweep delay the reaper.

---

## R2 — The module is `src/jobs/`, and it imports rather than duplicates

**Decision**: A new `JobsModule` at `src/jobs/`, registered in `AppModule`. It contains the base
class, three job services, one repository, one reconciler, and a constants file. It imports
`ChainModule` for `EscrowOperatorService` and `EscrowReadService`, and declares `Order` and `Run`
through `TypeOrmModule.forFeature`.

**Rationale**: `docs/CONTEXT.md` §3's module map already names it — *"`jobs` | Sweeper · reclaimer ·
reaper"* — and `docs/project-structure.md` lists the directory. This is the one module in the map
that does not exist yet.

**It does not import `ExecutionModule` or `GuardianModule`, and that is deliberate.** The reaper
needs to write to a `runs` row, which `execution/` owns. Importing `ExecutionService` to get at it
would give a cron job a handle on the thing that starts model calls. The reaper's write is one
`UPDATE` with a `finished_at IS NULL` guard (R8) and it goes through this module's own repository
against the `Run` entity. Two modules writing different columns of the same table under different
preconditions is a smaller cost than a cron job holding the execution engine.

The standing rule that `execution` and `guardian` must not import each other is untouched: `jobs`
imports neither.

---

## R3 — Cadences: one environment key, two constants

**Decision**:

| Job | Cadence | Where it comes from |
| --- | --- | --- |
| Sweeper | `SWEEPER_INTERVAL_MS` | already in `env.schema.ts`, required, no default |
| Reclaimer | `RECLAIMER_INTERVAL_MS = 300_000` | constant in `src/jobs/jobs.constants.ts` |
| Reaper | `REAPER_INTERVAL_MS = 60_000` | constant |
| Reaper grace | `REAPER_GRACE_MS = 60_000` | constant |
| Unconfirmed-purchase grace | `UNCONFIRMED_GRACE_MS = 300_000` | constant |

**No new environment keys.** The line this codebase already draws — stated in `env.schema.ts`'s
auth section and again in `guardian.constants.ts` — is that a value goes in the environment when it
genuinely varies by deployment, and *"every optional environment key is one more thing that can be
absent at 3am."* The sweeper's cadence varies: three seconds on stage, sixty in production, and it
is already there. The reclaimer's does not — it enforces a 24-hour contract deadline, and no
deployment wants it faster or slower. The reaper's does not either.

The grace margins are product judgements about when a run counts as abandoned, not deployment
tuning, and `guardian.constants.ts` makes exactly this argument about `GUARDIAN_MODEL`: a value a
deployment could change silently changes the meaning of an outcome.

**Alternatives considered**: mirroring `EXECUTION_POLL_INTERVAL_MS`/`GUARDIAN_POLL_INTERVAL_MS` and
adding two more defaulted env keys. Rejected: those two are both genuinely rehearsal-sensitive
(a rehearsal wants a purchase to visibly start working within a second). Nothing in a rehearsal
waits 24 hours for the reclaimer.

---

## R4 — Each pass claims by conditional `UPDATE … RETURNING`, and drains

**Decision**: Every state transition is a single `UPDATE orders SET state = … WHERE id = … AND
state = <expected>` — the condition on the current state is what makes it idempotent — and every
pass loops until its query returns nothing, rather than handling one order per tick.

**Rationale**: `execution.repository.ts` already established both halves. `markDelivered` and
`markFailed` are conditional on `state = 'running'` for precisely this reason, and `markDelivered`'s
docblock names the race with *this* feature: *"Between the claim and this call the reaper may have
decided the order was stuck and moved it to `failed` (API-10). Writing `delivered` unconditionally
would resurrect an order the reaper has already accounted for."* The reaper's own write has to hold
up its end of that — conditional on `state = 'running'`, so an order that reached `delivered` between
selection and write is not dragged back (FR-022).

Draining rather than one-per-tick is `ExecutionPoller.drain`'s argument, and it applies harder here:
a rehearsal that runs three acts back to back produces several orders whose windows expire together,
and the sweeper taking three cadences to clear them is visible on stage (FR-015).

**The selection query does *not* need `FOR UPDATE SKIP LOCKED`.** `claimNext` uses it because
execution genuinely may run concurrent workers one day. Here a pass is single-threaded by the
re-entrancy guard, and across processes the conditional `UPDATE` plus the chain's own state check is
already sufficient — the worst outcome of two processes racing is a duplicate `release` transaction,
which the contract rejects for free at simulation (R6). Adding the lock would suggest a guarantee
this feature does not need and does not have.

---

## R5 — Chain first, then Postgres — and why that is not a violation of invariant #1

**Decision**: All three money-touching transitions call the chain first and write the order's new
state only after a confirmed receipt.

**Rationale**: Invariant #1 is a rule about the **ledger**, and its subject is which of two writes
increases what the platform owes. Neither `release` nor `reclaim` writes a ledger entry at all
(R9), so the invariant's table has no row for them. What governs here is invariant #5 — *settlement
writes no ledger entry, because settled funds are on-chain under the user's own address* — plus the
plain fact that `orders.state = 'released'` is a **claim about where the money is**. Writing it
before the chain agrees tells a seller they have been paid when nothing has moved.

This is the shape `guardian.service.ts` already uses for `resolve`: chain call, then a transaction
that records the hash and moves `adjudicated → settled`, with the comment that *"the contract, not
our database, is the authority on whether the deal is already `Settled`."* The same sentence is the
whole of this feature's error handling.

**The failure mode this leaves is benign and self-healing**: chain succeeds, the database write
fails, the order stays in its old state. The next pass selects it again, the chain refuses the
duplicate call, and R6's reconciliation writes the state that should have been written a cadence
ago. There is no window in which the platform has recorded a payout that did not happen.

The reaper is the exception and makes no chain call at all (FR-018) — nothing was delivered, so
there is nothing to tell the contract.

---

## R6 — ⚠️ Reconcile by reading the deal, never by matching the revert string

**Decision**: On any `ContractRevertError` from `release` or `reclaim`, read the deal with
`EscrowReadService.getDeal` and decide from `DealState`. Never branch on `reason`.

**Rationale**: the strings do not carry enough information, and this is provable from the deployed
contract (`sc/src/GuardianEscrow.sol`, mirrored in `docs/smart-contract.md` §9):

```solidity
function release(uint256 dealId) external {
    require(d.state == DealState.Delivered, "not delivered");
    require(block.timestamp >= d.deliveredAt + d.reviewWindow, "window open");

function reclaim(uint256 dealId) external {
    require(d.state == DealState.Open, "not open");
    require(block.timestamp >= d.openedAt + DELIVERY_DEADLINE, "too early");
```

Four strings, and they partition the outcomes wrongly for our purposes:

| Call | `reason` | What actually happened | What the job must do |
| --- | --- | --- | --- |
| `release` | `"window open"` | our clock ran ahead of block time | nothing; retry next pass |
| `release` | `"not delivered"` | **either** somebody already released it **or** the buyer disputed it | read the deal — these need opposite responses |
| `reclaim` | `"too early"` | our clock ran ahead | nothing; retry next pass |
| `reclaim` | `"not open"` | already settled, or it was delivered after all | read the deal |

The `"not delivered"` row is the one that forces this. A deal that is `Settled` means the job's work
is done and the order should be marked `released`; a deal that is `Disputed` means the buyer won the
race and the order must be left for Guardian. One string, two states, opposite actions. A job that
matched on the string would either mark a disputed order released — settling a live dispute in our
database while the money sits frozen on-chain — or leave a settled deal being retried forever.

The two "too early" strings are safe to match on, and the design still does not, for a smaller
reason: they are the *only* two reasons apart from the state checks, so `state == expected` after
the read is exactly equivalent and needs no string table to stay correct if the contract's wording
ever changes.

**This costs one extra `eth_call` per failed attempt and none per success**, because the read only
happens in the catch. `executeWrite` runs `simulateContract` before broadcasting, so a premature or
already-settled call **reverts for free** and never reaches the mempool — no gas, on a chain that
charges the full limit. The reconciliation path is cheap precisely because the adapter already
refuses to pay for a doomed transaction.

**`ChainOutcomeUnknownError` is not reconciled and not caught here.** It extends `ChainError` but is
deliberately outside the failure hierarchy, and its docblock is explicit that treating it as failure
is how a retry duplicates an on-chain action. It is logged at error level, the order is left exactly
as it was (FR-009 of the spec's resilience story), and the next pass — which begins by reading the
chain if it reverts — settles what actually happened.

---

## R7 — The reaper's clock is the run's `started_at`, with a fallback

**Decision**: an order is due when

```
COALESCE(runs.started_at, orders.created_at) + agent_versions.timeout_seconds + REAPER_GRACE_MS < now()
```

evaluated by joining `orders → agent_versions` (for the pinned time limit) and left-joining `runs`.

**Rationale**: API-08 built `runs.started_at` for this. Its `openRun` docblock states the state table
—`running` means *"open — `started_at` set, `finished_at` NULL"* — and says outright that writing the
row only at the end *"would leave a crashed process with no evidence at all, and nothing for the
reaper to read."* The time limit must come from the pinned version, not a constant, because it is
the seller's declared budget and the run was allowed to use all of it.

**The `COALESCE` covers the one gap.** `claimNext` moves the order to `running` and `openRun`
inserts the row as two statements, so a crash between them leaves an order in `running` with no run
record — and an inner join would leave that order stuck forever, which is the exact hole the reaper
exists to close. Falling back to `orders.created_at` is imperfect: an order that sat in `purchased`
for hours because the execution poller was down, and was claimed one second ago, would look
long-overdue. The window is bounded by the milliseconds between two adjacent statements against a
reaper that ticks once a minute, so in practice the run row is always there by the next tick. Naming
the residual risk is better than an inner join that trades a millisecond-wide race for a permanent
one.

**Alternatives considered**: adding a `claimed_at` column to `orders`. It would make the fallback
exact, and it costs a migration for a race no rehearsal will ever produce. Rejected on the standing
MVP rule; recorded here so the fix is known if the fallback ever misfires.

---

## R8 — The reaper's run write is guarded by `finished_at IS NULL`, not by inspecting the output

**Decision**: one statement —

```sql
UPDATE runs
   SET finished_at = now(),
       duration_ms = <now - started_at, ms>,
       error       = 'abandoned: no worker; reaped by API-10'
 WHERE order_id = $1
   AND finished_at IS NULL
```

**Rationale**: this single predicate satisfies FR-019's two halves at once, and it is the reason no
branch is needed.

There are exactly two ways an order is found in `running`:

| How it got stuck | Run record | What must happen |
| --- | --- | --- |
| The process died mid-run | open — `finished_at` NULL, `output` NULL | close it, record why |
| The run succeeded but `markDelivered` failed | **closed already** — `output` set, `finished_at` set | order → `failed`, **run untouched** |

The second is not hypothetical: `execution.service.ts` calls `closeRun` with the output *before* it
tells the chain, and API-08's spec names the resting state — a lost delivery announcement leaves a
`running` order whose run holds a real output. `finished_at IS NULL` excludes exactly that row, so
the output is never overwritten and no code has to know why.

It also means the write is idempotent by construction, and it can never touch `output`,
`output_valid`, or `steps` — the three columns invariant #7 protects. `closeRun` in `execution/`
refuses to write a stand-in into `output`; this statement never names the column at all, which is
the stronger version of the same guarantee.

**The order transition happens regardless of which row shape was found** — `running → failed`,
conditional on `state = 'running'`. A failed order with an output is a coherent thing for an auditor
to read, and API-08's spec already says so.

---

## R9 — ⚠️ A reclaimed order rests in `settled`, and writes no ledger entry

**Decision**: `reclaim` confirmed → `state = 'settled'`, `settled_at = now()`, no ledger row.

**This is the spec's second amendment to received wisdom** — the source brief says only
*"`purchased` past `DELIVERY_DEADLINE` → `reclaim()`"* and never names a resting state — and it is
forced rather than chosen.

`ESCROWED_ORDER_STATES` in `src/orders/order-states.ts` contains six of the eight states. `released`
and `settled` are the two exclusions, with the reason given in the file: *"in both, the tokens have
already been paid out to `balances[]` on-chain, where they are counted by `settledFundsMinor`
instead. Counting them here would show the same cents twice."* `failed` is in the set, and the file
explains that too: *"the money sits in escrow until the reclaimer sweeps it."*

So the moment `reclaim` confirms, `balances[buyer]` rises and `accounts.service.ts` starts reporting
those cents in `settledFundsMinor` — it reads `balanceOfCents` straight from the chain. If the order
stayed in `failed`, `inEscrowMinor` would keep summing the same price. The buyer would see their
money in two figures at once, which is the exact failure the file's warnings exist to prevent. Only
`settled` satisfies both halves, and `settled_at` is the column already there for it.

**No ledger entry, for the same reason and one more.** Invariant #5: settlement writes no ledger
entry, because settled funds are on-chain under the user's own address and cannot be recaptured.
A credit here would restore spendable balance for money that is simultaneously an on-chain claim —
the platform would owe more than the pool holds, which invariant #1 calls the one error no later
entry can correct. `guardian.service.ts` already carries a "Nothing here writes a ledger entry"
section for the identical situation on the dispute path.

**What is lost**: the word `settled` no longer implies "a dispute was adjudicated". The
non-delivery remains fully legible from the run record and from `verdicts` being absent, which is
where that evidence lives anyway.

**Alternatives considered**: (a) leave it `failed` and add `AND NOT reclaimed` to the escrow-exposure
query — needs a new column and makes a money figure depend on a flag rather than a state;
(b) a new `reclaimed` state — an enum migration, plus a decision about `ESCROWED_ORDER_STATES` that
`settled` already answers correctly. R14 of the guardian research rejected a new state on the same
grounds.

---

## R10 — ⚠️ The reclaimer's predicate covers `failed` as well as `purchased`

**Decision**:

```sql
WHERE state IN ('purchased', 'failed')
  AND onchain_deal_id IS NOT NULL
  AND created_at + INTERVAL '24 hours' <= now()
```

**Third amendment to the brief**, which names only `purchased`.

**Rationale**: the contract cannot tell the two apart. `reclaim` requires `d.state == DealState.Open`,
and a deal is `Open` both when nothing ever ran and when the agent ran and produced nothing — the
platform only ever calls `markDelivered` on success. Covering only `purchased` would strand the money
of every buyer whose agent failed, which is the population the reclaimer most exists for.
`escrow-exposure.repository.ts` already documents the intent in a table row: *"The agent ran and
produced nothing | deal id **set** | escrowed ✅ yes, until the reclaimer sweeps."*

**`onchain_deal_id IS NOT NULL` does two jobs.** It skips a `purchased` order whose `openDeal` was
never confirmed — there is no deal to reclaim, and `order.entity.ts` warns that retrying against a
NULL id is how one purchase ends up with two deals escrowing two prices. It also skips a `failed`
order whose `openDeal` was **refused**, which escrowed nothing and whose compensating `adjustment`
already restored the buyer's balance; reclaiming that one would be asking the contract about a deal
that does not exist. This is the same predicate `claimNext` uses and the narrower cousin of the one
`escrow-exposure.repository.ts` forbids — the difference does not arise here, because a job that
*acts* on a deal genuinely does need the id, where a *figure* that sums money does not.

**`created_at` rather than the deal's `openedAt`.** The contract measures from its own `openedAt`,
which is a block timestamp a second or two after our row was written, so our predicate fires
slightly early and the contract answers `"too early"`. That is R6's benign path, retried five
minutes later. Reading `openedAt` per order would mean one `eth_call` per candidate on every pass to
save one wasted free simulation on the first pass after a deadline.

---

## R11 — One order at a time within a pass

**Decision**: a drain processes candidates sequentially, awaiting each chain call before selecting
the next.

**Rationale**: every write goes out from the single operator key. viem's `writeContract` fetches the
nonce per call, so two concurrent writes from one account read the same pending nonce and one of
them is dropped or replaces the other. There is no nonce manager in `chain/` and adding one is far
outside this feature. Sequential also bounds a pass's chain exposure: a backlog of fifty orders after
an outage produces fifty transactions in sequence, not fifty in flight.

The cost is that a pass over a large backlog outlives its own cadence — which is exactly what the
re-entrancy guard (R1) is for.

---

## R12 — The unconfirmed-purchase report logs once per order per process

**Decision**: the reclaimer's pass carries a second query for
`state = 'purchased' AND onchain_deal_id IS NULL AND created_at + UNCONFIRMED_GRACE_MS <= now()`,
logs each hit at error level, and remembers which order ids it has already reported in an in-memory
`Set` so a restart re-reports and a steady state does not.

**Rationale**: FR-030 wants the order visible; FR-006 wants a quiet log. Reporting on every pass
means one error line per stuck order every five minutes forever, which by the second hour has buried
whatever else the log had to say — the same argument the quiet-by-default pollers make. Reporting
once per process is the smallest thing that satisfies both, needs no column, and re-announces on
restart when somebody is most likely to be looking.

**It rides on the reclaimer's timer rather than owning a fourth one**, because it is the same
cadence over the same table and adjacent rows, and because the confirmed decision (spec Q1) was
explicitly *visibility only* — a fourth registered job would overstate what was built.

**It makes no chain call and changes nothing.** Not the state, not the ledger. `order.entity.ts` is
unambiguous: the deal may yet confirm, recovery is by looking the logged transaction hash up by
hand, and *"never retry `openDeal` against a NULL id."*

---

## R13 — The chain adapter needs no changes

**Confirmed, not decided.** `EscrowOperatorService.release` and `.reclaim` both exist, both route
through `lifecycleWrite` → `executeWrite`, and `GAS_LIMITS` carries `release: 130_000n` and
`reclaim: 130_000n`. `EscrowReadService.getDeal` returns a mapped `OnChainDeal` with a `DealState`,
and throws `DealNotFoundError` for an id the escrow never issued rather than returning a zero-filled
struct.

One caveat worth carrying into the tasks: `chain.constants.ts` marks the `reclaim` ceiling
**ESTIMATED** — *"same shape as `release`"* — and no reclaim has ever been sent against the
deployment. `release` is the better-evidenced of the two. If a reclaim reverts once mined after
simulating cleanly, `executeWrite` raises `GasExhaustedError` and its message already names the
ceiling as the first thing to check.

---

## R14 — What no job may touch, stated as predicates

**Decision**: the three selection queries are the whole of the authorisation model, and each excludes
by naming its state rather than by a shared guard.

- Nothing selects `disputed`. A dispute Guardian has not ruled on — including one whose
  `audit_failed_at` is set — is left to the escrow's 72-hour `DISPUTE_DEADLINE` and permissionless
  `forceResolve`. `order.entity.ts` says so directly: *"No scheduled job touches a stuck dispute —
  API-10's reaper covers `running` only."*
- Nothing selects `adjudicated`. That is the invariant #8 window and `GuardianPoller`'s settle pass
  owns it.
- Nothing selects `released` or `settled`. Both are terminal and their money has left escrow.
- The reaper does not select `purchased`; an order that was never claimed is the reclaimer's after
  24 hours, and moving it to `failed` early would only relabel it.

`forceResolve` exists on `EscrowOperatorService` and is deliberately **not** wired to a timer here.
It is permissionless, so anyone can send it, and a fourth job that force-settles disputes at the
quarter tier would put an outcome Guardian did not author into the demo's closing act.

---

## R15 — The two indexes that exist are the two this feature needs

**Confirmed.** `order.entity.ts` declares `orders_sweeper_idx (state, delivered_at)` — named for this
job, added by API-02 — and `orders_undelivered_idx (state, created_at)`, which serves the reclaimer's
`state IN (…) AND created_at …` and the unconfirmed-purchase query. The reaper filters
`state = 'running'` and joins on primary keys; the leading `state` column of either index serves it,
and the `running` population is bounded by one at a time in this deployment.

**No migration in this feature**, and nothing here changes a column, a constraint, or the enum.

---

## R16 — ⚠️ FOUND DURING IMPLEMENTATION: `orders.delivered_at` was never written

**This was not a design decision. It was a live defect, found by running the sweeper against the
real database and watching it select nothing.**

`ExecutionRepository.markDelivered` wrote `{ state: OrderState.Delivered }` and nothing else. The
column existed (API-02's `InitialSchema`), the index over it existed
(`orders_sweeper_idx (state, delivered_at)`), the serialiser exposed it, the complaint path branched
on it — and no code path ever assigned it. Every order in the database sat at `delivered` with
`delivered_at NULL`.

**Two things were broken by the absence, and both read as "the code is fine"** because the column is
nullable and a NULL comparison simply produces no rows rather than an error:

1. **The sweeper could never fire.** Its predicate is
   `delivered_at + review_window <= now()`, which is NULL for every row when the left operand is
   NULL. No order is ever selected, no seller is ever paid, and the job logs nothing — which is
   indistinguishable from "nothing was due". This feature's entire P1 story was inoperative before a
   line of it was written.
2. **The complaint window never closed.** `settlement.service.ts`'s `assertWindowOpen` returns early
   on a NULL `delivered_at`. That branch is correct and deliberate for a `failed` order — nothing was
   delivered, so no window ever opened, and Act 3 must not be refused by one — but with the column
   never written, *every* order took it. A buyer could complain arbitrarily late and the API would
   accept it. The money stayed safe only because the on-chain `dispute` reverts `"window closed"` on
   its own: the API said yes and the contract said no.

**Fix**: one line in `execution.repository.ts` — `markDelivered` now sets
`deliveredAt: new Date()`. `markFailed` deliberately still does not, which is what keeps
`assertWindowOpen`'s early return meaning what it says.

**Why our receipt time and not `block.timestamp`.** The contract records its own
`deliveredAt = block.timestamp` when `markDelivered` is mined; we learn of it when the receipt comes
back, which is strictly later. That is the safe direction: the sweeper asks to release slightly
*after* the chain would already permit it, rather than before, so this makes the `"window open"`
revert of R6 *less* likely rather than more. Deriving it from block time would need an extra
`eth_call` on the delivery hot path to avoid a revert the design already tolerates for free.

**Scope note.** This is the one change this feature makes outside `src/jobs/` and outside
`app.module.ts`, and it contradicts the plan's summary claim of "no change to any existing file
except one line in `app.module.ts`". It is made anyway because US1 cannot function without it, and
because leaving a known-broken complaint window in place to protect a scope boundary would be the
wrong trade.

## R17 — ⚠️ FOUND DURING IMPLEMENTATION: the drain loop spins without a skip list

The plan specified `LIMIT 1` inside a drain loop and argued that re-reading current truth each
iteration removes the need for a lock. That is right, and it is also what makes the loop dangerous —
which the plan missed.

An order a job **fails** to advance keeps every property its predicate selects on. The next
iteration selects the identical row, fails identically, and the pass spins forever — inside a
`try/catch` that never fires, because nothing throws. A `"window open"` revert from two clocks
disagreeing by one second would have hung the sweeper.

**Breaking out of the drain on first failure is not the fix**: candidates are ordered by
`delivered_at` / `created_at`, so one stuck order would stand in front of every newer one
permanently. A sweeper that pays nobody because one deal is disputed is worse than the spin, and
quieter.

Each selection method therefore takes a `skipIds` argument and each caller accumulates the ids it
could not advance. The set lives for one pass and is discarded — the next tick starts empty and
retries everything, which is the retry policy for the whole feature (R5). See
[contracts/jobs-repository.md](./contracts/jobs-repository.md), updated to match.

## R18 — ⚠️ FOUND DURING VERIFICATION: a log line that diagnosed instead of reporting

The reaper's first implementation logged, on the branch where the run was already closed:
*"it has an output; its delivery announcement was lost"*. A live reap proved that wrong. "Already
closed" has two causes and only one is the lost announcement:

| Why the run was already closed | `output` |
| --- | --- |
| The run succeeded and `markDelivered` failed — the lost announcement | set |
| The run failed on its own and recorded its own error | **NULL** |

The second is the more common, and the order the message was tested against had
`error = 'The Anthropic API rejected the output schema…'` with a NULL output. Diagnosing it as the
first sends whoever reads the rehearsal log hunting a chain problem that is not there.

The line now reports the observation and leaves the diagnosis to whoever opens the run record —
the rule `jobs.constants.ts` already states for `ABANDONED_RUN_ERROR`.

## Cross-cutting: what this feature deliberately does not build

Named because each was considered and each is on the standing exclusion list in `docs/CONTEXT.md` §6
or the source brief: job queues, distributed locking or leader election, retry frameworks with
backoff, persisted retry counters, the removed deposit poller, a chain-scanning reconciler for
unconfirmed deals (spec Q1, decided as visibility only), and automated tests of any kind.
