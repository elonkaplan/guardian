# Data Model: Cron jobs

**Feature**: `010-cron-jobs` · **Spec**: [spec.md](./spec.md) · **Research**: [research.md](./research.md)

## 0. No schema change

**No migration. No new column, no new index, no enum member, no constraint.** Everything below is a
read of, or a conditional write to, columns that API-02 created and API-07/API-08 have been
maintaining. This section is first because it is the most useful thing to know about this feature.

| Considered | Rejected because |
| --- | --- |
| `orders.claimed_at`, to give the reaper an exact clock | The `COALESCE(runs.started_at, orders.created_at)` fallback covers a window measured in milliseconds against a job that ticks once a minute (R7) |
| `orders.reclaimed_at` or a `reclaimed` state | `settled` + `settled_at` already means exactly "the chain paid this out", and `ESCROWED_ORDER_STATES` already treats it correctly (R9) |
| A `job_runs` table for retry counts | Nothing here retries with state. The next tick is the retry (R5) |
| `orders.unconfirmed_reported_at` | An in-memory `Set` re-announces on restart, which is when somebody is looking (R12) |

---

## 1. Entities this feature touches

### `orders` — read and written

| Column | Used by | How |
| --- | --- | --- |
| `id` | all | selection, and the subject of every log line |
| `state` | all | the queue (invariant #9); every write is conditional on its expected prior value |
| `onchain_deal_id` | sweeper, reclaimer | the argument to `release`/`reclaim`. **NULL excludes the row** (R10) |
| `delivered_at` | sweeper | start of the review window |
| `review_window_seconds` | sweeper | the per-order snapshot, never the seller's current setting |
| `created_at` | reclaimer, reaper | the 24-hour deadline; the reaper's fallback clock |
| `agent_version_id` | reaper | joins to the **pinned** version for `timeout_seconds` (invariant #6) |
| `settled_at` | reclaimer | written when `reclaim` confirms |
| `buyer_account_id` | unconfirmed report | named in the log line so the order is traceable to a person |

Never touched by any job: `price_minor`, `input`, `acceptance_criteria`, `disputed_at`,
`audit_attempts`, `audit_failed_at`.

### `runs` — three columns written, by the reaper only

| Column | Reaper |
| --- | --- |
| `started_at` | **read** — the run's clock (R7) |
| `finished_at` | written, **and the guard**: the whole `UPDATE` is `WHERE finished_at IS NULL` |
| `duration_ms` | written — `now() - started_at` in ms |
| `error` | written — a fixed abandonment string |
| `output`, `output_valid`, `steps` | ⚠️ **never named in any statement.** Invariant #7 |

### `agent_versions` — one column read

`timeout_seconds`, reached through `orders.agent_version_id`. Nothing else. In particular not
`system_prompt` — invariant #3 is untouched because no job has a reason to load a definition.

### The escrow deal — the authority

Not a database entity. `EscrowReadService.getDeal` returns `OnChainDeal`, whose `state` is a
`DealState` (`None|Open|Delivered|Disputed|Settled`). **When the database and the chain disagree
about a deal, the chain is right and the order is corrected** (R6). No job ever writes the reverse.

---

## 2. State transitions this feature adds

The machine as `src/entities/enums.ts` documents it today:

```
purchased → running → delivered → released              (uncontested)
                   ↘ failed                             (produced nothing)
                     delivered → disputed → adjudicated → settled
```

This feature performs four transitions, two of which are new edges:

| # | Transition | Job | Precondition (DB) | Precondition (chain) | New edge? |
| --- | --- | --- | --- | --- | --- |
| 1 | `delivered → released` | Sweeper | `delivered_at + review_window <= now()` | `release` confirmed, or deal reads `Settled` | No — the existing uncontested ending |
| 2 | `running → failed` | Reaper | past `timeout + grace` | none — no chain call | No — API-08 writes this edge too |
| 3 | `purchased → settled` | Reclaimer | deal id set, `created_at + 24h <= now()` | `reclaim` confirmed, or deal reads `Settled` | **Yes** |
| 4 | `failed → settled` | Reclaimer | as above | as above | **Yes** |

### Why the two new edges break no existing reader

They are the only structural change this feature makes to the product's state machine, so each
consumer of `orders.state` was checked:

| Reader | Effect of a `purchased`/`failed` order becoming `settled` |
| --- | --- |
| `ESCROWED_ORDER_STATES` / `inEscrowMinor` | **Correct and required.** The order leaves the escrowed set at exactly the moment `balances[buyer]` rises, so the price appears in `settledFundsMinor` instead. This is the reason the edge exists (R9) |
| `accounts.service.ts` → `settledFundsMinor` | Reads `balanceOfCents` from the chain, not from `orders`. Already reports the reclaimed money the instant the transaction confirms |
| `ExecutionRepository.claimNext` | Selects `state = 'purchased'`; a settled order is no longer selected. Correct — the deal is closed and there is nothing to deliver against |
| `GuardianRepository.findAuditPending` / `findSettlePending` | Select `disputed` / `adjudicated`. Unaffected |
| The complaint path (`orders`) | A settled order cannot be complained about, which is correct: the escrow is `Settled` and `dispute` would revert `"not delivered"` anyway |
| `escrow-exposure.repository.ts`'s `NOT (state = 'failed' AND onchain_deal_id IS NULL)` | Unaffected. The reclaimer never selects a NULL-deal-id row, so it never turns one of those into `settled` |

**`settled_at` is written on both new edges**, so "when did the money leave escrow" is answerable
for a reclaim exactly as it is for an adjudicated dispute.

---

## 3. The three selection predicates, exactly

### Sweeper — due for release

```sql
SELECT id, onchain_deal_id
  FROM orders
 WHERE state = 'delivered'
   AND onchain_deal_id IS NOT NULL
   AND delivered_at + (review_window_seconds * INTERVAL '1 second') <= now()
 ORDER BY delivered_at
 LIMIT 1
```

Uses `orders_sweeper_idx (state, delivered_at)` — the index API-02 created for this job.
`onchain_deal_id IS NOT NULL` is belt-and-braces: an order cannot reach `delivered` without one,
because `markDelivered` is called with the id. It stays because the id is dereferenced two lines
later and a NULL would be a crash rather than a skip.

`ORDER BY delivered_at` and `LIMIT 1` with a drain loop, rather than fetching a batch: each
iteration re-reads the current truth, so an order whose state changed while the previous chain call
was in flight is simply not selected again.

### Reclaimer — due for reclaim

```sql
SELECT id, onchain_deal_id
  FROM orders
 WHERE state IN ('purchased', 'failed')
   AND onchain_deal_id IS NOT NULL
   AND created_at + INTERVAL '24 hours' <= now()
 ORDER BY created_at
 LIMIT 1
```

The 24 hours mirrors the contract's `DELIVERY_DEADLINE` constant. Both `IS NOT NULL` and the state
list are load-bearing and argued in R10. Uses `orders_undelivered_idx (state, created_at)`.

### Reaper — abandoned mid-run

```sql
SELECT o.id, r.id AS run_id, r.started_at
  FROM orders o
  JOIN agent_versions v ON v.id = o.agent_version_id
  LEFT JOIN runs r      ON r.order_id = o.id
 WHERE o.state = 'running'
   AND COALESCE(r.started_at, o.created_at)
       + (v.timeout_seconds * INTERVAL '1 second')
       + INTERVAL '60 seconds'                      -- REAPER_GRACE_MS
       <= now()
 ORDER BY o.created_at
 LIMIT 1
```

`LEFT JOIN` plus `COALESCE`, not an inner join: an order in `running` with no run row at all is the
crash-between-two-statements case, and an inner join would leave it stuck forever — the exact hole
the reaper exists to close (R7).

### Not a job — unconfirmed purchases (R12)

```sql
SELECT id, buyer_account_id, created_at
  FROM orders
 WHERE state = 'purchased'
   AND onchain_deal_id IS NULL
   AND created_at + INTERVAL '5 minutes' <= now()
```

The full set, not `LIMIT 1` — it is a report, not a work queue. Deduplicated in memory against a
`Set<string>` of already-reported order ids.

---

## 4. The four writes, all conditional

| Write | Statement shape | Idempotent because |
| --- | --- | --- |
| Release | `UPDATE orders SET state='released' WHERE id=$1 AND state='delivered'` | A second attempt matches zero rows |
| Reclaim | `UPDATE orders SET state='settled', settled_at=now() WHERE id=$1 AND state IN ('purchased','failed')` | Same |
| Reap (order) | `UPDATE orders SET state='failed' WHERE id=$1 AND state='running'` | Same — and this is what keeps API-08's `markDelivered` race honest in both directions |
| Reap (run) | `UPDATE runs SET finished_at=now(), duration_ms=…, error=… WHERE order_id=$1 AND finished_at IS NULL` | The guard is also what protects an already-recorded output (R8) |

Each returns its affected-row count so the job logs what actually happened rather than what it
intended. A zero means somebody else got there first, which is an ordinary outcome and logged at
debug, not error.

---

## 5. Deal state → order state, the reconciliation table

What the sweeper and reclaimer do when a chain write reverts and the deal is then read (R6):

| Job | Deal reads | Meaning | Action |
| --- | --- | --- | --- |
| Sweeper | `Settled` | somebody released or the buyer accepted | write `released`, log at info |
| Sweeper | `Disputed` | the buyer complained and won the race | leave the order alone; Guardian owns it. Log at warn once |
| Sweeper | `Delivered` | our clock ran ahead of block time | do nothing; next pass. Log at debug |
| Sweeper | `Open` | should be impossible for a `delivered` order | log at error; do not write |
| Reclaimer | `Settled` | somebody reclaimed, or it was resolved | write `settled` + `settled_at`, log at info |
| Reclaimer | `Delivered` / `Disputed` | delivery landed after all; our row is stale | leave alone, log at warn — the sweeper or Guardian owns it now |
| Reclaimer | `Open` | our clock ran ahead of `openedAt` | do nothing; next pass. Log at debug |
| either | `DealNotFoundError` | the id does not exist on this escrow | log at error naming the id; never write. Points at a wrong `ESCROWED_ADDRESS` or a redeployed contract |

`ChainOutcomeUnknownError` never reaches this table. It is logged at error with its transaction
hash and the order is left exactly as it was — reconciling it would mean guessing at a transaction
that may still confirm.

---

## 6. Validation rules carried from the spec

- **FR-012 / FR-027**: no `INSERT INTO ledger_entries` appears anywhere in `src/jobs/`. This is
  checkable by grep and is worth checking (invariant #5).
- **FR-018**: no call to `markDelivered`, `accept`, `dispute`, `resolve`, or `forceResolve` appears
  anywhere in `src/jobs/`. The module's only chain writes are `release` and `reclaim`.
- **FR-019**: no statement in `src/jobs/` names `runs.output`, `runs.output_valid`, or `runs.steps`.
- **FR-009 / FR-023**: no query in `src/jobs/` selects `disputed`, `adjudicated`, `released`, or
  `settled`. The four state literals that appear are `delivered`, `purchased`, `failed`, `running`.
