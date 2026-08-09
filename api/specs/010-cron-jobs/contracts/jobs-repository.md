# Contract — `JobsRepository`

The third internal seam, and the one with the least room for interpretation: **every SQL statement
this feature issues, written out.** Three selections, one report query, four writes. Nothing in
`src/jobs/` talks to the database except through this class.

Consumers: `SweeperJob`, `ReclaimerJob`, `ReaperJob`. Predicates argued in
[research.md R4, R7, R8, R10, R12](../research.md); consequences in [data-model.md](../data-model.md).

---

## The interface

```ts
// src/jobs/jobs.repository.ts

export interface DueOrder {
  readonly orderId: string;
  readonly onchainDealId: bigint;
}

export interface AbandonedRun {
  readonly orderId: string;
  /** NULL when the process died between claimNext and openRun (R7). */
  readonly runId: string | null;
  readonly startedAt: Date | null;
}

export interface UnconfirmedOrder {
  readonly orderId: string;
  readonly buyerAccountId: string;
  readonly createdAt: Date;
}

@Injectable()
export class JobsRepository {
  // selection — one at a time, re-read every iteration.
  // ⚠️ `skipIds` is not optional in practice — see "The drain would spin without
  // it" below. Callers accumulate the ids they failed to advance.
  findReleasable(skipIds?: readonly string[]): Promise<DueOrder | null>;
  findReclaimable(deadlineHours: number, skipIds?: readonly string[]): Promise<DueOrder | null>;
  findAbandonedRun(graceMs: number, skipIds?: readonly string[]): Promise<AbandonedRun | null>;

  // report — the whole set, not a queue
  findUnconfirmedPurchases(graceMs: number): Promise<UnconfirmedOrder[]>;

  // writes — every one conditional, every one returns rows affected
  markReleased(orderId: string): Promise<boolean>;
  markReclaimed(orderId: string): Promise<boolean>;
  markReaped(orderId: string): Promise<boolean>;
  closeAbandonedRun(orderId: string): Promise<boolean>;
}
```

## ⚠️ The drain would spin without `skipIds` — found during implementation

The plan specified `LIMIT 1` inside a drain loop, and argued that re-reading current truth each
iteration is what removes the need for a lock. That argument is right and it is also what makes the
loop dangerous, which the plan missed.

An order the job **fails** to advance keeps every property its predicate selects on. The chain said
`"window open"` because our clock ran ahead; the deal turned out to be `Disputed`; the RPC was
down. The next iteration selects the identical row, fails identically, and the pass spins until the
process is killed — inside a `try/catch` that would never fire, because nothing is throwing.

**Breaking out of the drain on the first failure is not the fix.** Candidates are ordered by
`delivered_at` / `created_at`, so the single oldest stuck order would stand in front of every newer
one forever. A sweeper that cannot pay anybody because one deal is disputed is worse than the spin,
and quieter.

So each caller accumulates the ids it could not advance and passes them back on the next iteration.
The set lives for exactly one pass and is discarded; the next tick starts empty and retries
everything, which is the retry policy for the whole feature (research R5).

One consequence worth noting: for the **reaper** the accumulator only ever fills from its `catch`.
A `markReaped` that returns `false` means the order is no longer `running`, so it cannot be
re-selected anyway — the guard is there for the write that *throws* and leaves the row in place.

## Selection

### `findReleasable`

```sql
SELECT id, onchain_deal_id
  FROM orders
 WHERE state = 'delivered'
   AND onchain_deal_id IS NOT NULL
   AND delivered_at + (review_window_seconds * INTERVAL '1 second') <= now()
 ORDER BY delivered_at
 LIMIT 1
```

`orders_sweeper_idx (state, delivered_at)`. `review_window_seconds` is the per-order snapshot, so a
seller editing their listing cannot move an existing order's deadline.

### `findReclaimable`

```sql
SELECT id, onchain_deal_id
  FROM orders
 WHERE state IN ('purchased', 'failed')
   AND onchain_deal_id IS NOT NULL
   AND created_at + INTERVAL '24 hours' <= now()
 ORDER BY created_at
 LIMIT 1
```

`orders_undelivered_idx (state, created_at)`. Both halves of the predicate carry weight:
`'failed'` is in the list because a deal is `Open` whether the agent never ran or ran and produced
nothing (R10); `IS NOT NULL` excludes the mid-saga order with no confirmed deal **and** the
compensated `openDeal`-refused order, which escrowed nothing.

### `findAbandonedRun`

```sql
SELECT o.id AS order_id, r.id AS run_id, r.started_at
  FROM orders o
  JOIN agent_versions v ON v.id = o.agent_version_id
  LEFT JOIN runs r      ON r.order_id = o.id
 WHERE o.state = 'running'
   AND COALESCE(r.started_at, o.created_at)
       + (v.timeout_seconds * INTERVAL '1 second')
       + ($1 || ' milliseconds')::interval        -- REAPER_GRACE_MS
       <= now()
 ORDER BY o.created_at
 LIMIT 1
```

`LEFT JOIN` + `COALESCE`, never an inner join — an order in `running` with no run row is the
crash-between-two-statements case, and an inner join leaves it stuck forever (R7). The time limit
comes from the **pinned** version through `agent_version_id`, which is invariant #6 doing its job.

### `findUnconfirmedPurchases`

```sql
SELECT id, buyer_account_id, created_at
  FROM orders
 WHERE state = 'purchased'
   AND onchain_deal_id IS NULL
   AND created_at + ($1 || ' milliseconds')::interval <= now()
 ORDER BY created_at
```

The full set. It is a report, not a work queue, and the caller deduplicates in memory (R12).

## Writes

Every write is conditional on the state it expects, which is what makes each job idempotent without
a transaction, a lock, or a retry counter. Each returns whether a row moved, so the job logs what
happened rather than what it intended; a `false` means somebody else got there first and is logged
at debug.

```sql
-- markReleased
UPDATE orders SET state = 'released'
 WHERE id = $1 AND state = 'delivered';

-- markReclaimed
UPDATE orders SET state = 'settled', settled_at = now()
 WHERE id = $1 AND state IN ('purchased', 'failed');

-- markReaped
UPDATE orders SET state = 'failed'
 WHERE id = $1 AND state = 'running';

-- closeAbandonedRun
UPDATE runs
   SET finished_at = now(),
       duration_ms = EXTRACT(EPOCH FROM (now() - started_at)) * 1000,
       error       = 'abandoned: no worker returned; reaped by the API-10 reaper'
 WHERE order_id = $1
   AND finished_at IS NULL;
```

### ⚠️ Three things about `closeAbandonedRun`

1. **`finished_at IS NULL` is the whole design.** It closes the run of a process that died, and it
   silently skips the run of a successful execution whose `markDelivered` failed — that row was
   already closed by `closeRun`, with a real output on it. FR-019's two halves are one predicate,
   with no branch and nothing for a reader to remember (R8).
2. **`output`, `output_valid` and `steps` are not named.** Invariant #7 says `runs.output IS NULL`
   is the non-delivery evidence. `execution/`'s `closeRun` enforces this by *refusing* to write a
   stand-in; this statement enforces it by never mentioning the column, which is stronger.
3. **It runs before `markReaped`**, so an order that is still `running` in the database always has
   its run closed first. The reverse order would leave a window in which an order reads `failed`
   with an open run — the shape a case file would misread as a run still in progress.

### ⚠️ `markReclaimed` writes no ledger row, and neither does anything else here

There is no `INSERT INTO ledger_entries` anywhere in `src/jobs/`, and there must never be.
Invariant #5: settled funds are on-chain under the user's own address, and crediting the ledger as
well would hand the buyer the same money twice — spendable balance *and* an on-chain claim — leaving
the pool owing more than it holds. `guardian.service.ts` carries the identical prohibition for the
dispute path. This is greppable, and worth grepping.

## What is not here

- **No `FOR UPDATE SKIP LOCKED`.** `ExecutionRepository.claimNext` uses it because execution may run
  concurrent workers one day. Here a pass is single-threaded by the base class's guard, and across
  processes the conditional `UPDATE` plus the contract's own state check already make a duplicate
  harmless — the second `release` reverts for free at simulation. Adding the lock would imply a
  guarantee this feature neither needs nor has (R4).
- **No transactions.** Each write is a single statement, and the chain call that precedes it is not
  rollbackable. Wrapping one `UPDATE` in a transaction would suggest the two were atomic.
- **No batch fetch.** `LIMIT 1` inside a drain loop re-reads current truth every iteration, so an
  order whose state changed during the previous chain call is simply not selected again.
