# Phase 1 — Data Model: Orders & the Purchase Saga

**Feature**: `007-orders-purchase-saga` · **Date**: 2026-08-09 · **Plan**: [plan.md](./plan.md)

One migration. Everything else is already mapped by `002-entities-migrations`.

---

## 1. The migration — `orders.input`

```sql
ALTER TABLE "orders" ADD COLUMN "input" jsonb NOT NULL;
```

No default and no backfill: `orders` is empty, and this feature writes the first row.

### Why this column has to exist ([R5](./research.md))

`POST /orders` accepts the buyer's input. The only column in the schema that can hold it
today is `runs.input`, and the `runs` row is written by **execution** — API-08, unbuilt. So
between the purchase committing and execution starting there is nowhere for it to live, and
the feature cannot be built without deciding where it goes.

| Option | Verdict |
| --- | --- |
| Write the `runs` row at purchase, fill `input`, leave `output` NULL | ❌ **Destroys invariant #7.** `runs.output IS NULL` is the non-delivery evidence. Every not-yet-started order would be indistinguishable from an agent that returned nothing — and `ui/src/api/types.ts` states in writing that `Order.run === null` is how the screen knows a `purchased` order has not started |
| Keep the input in memory, hand it to execution at dispatch | ❌ Does not survive a restart. The reaper (api-design §6) exists precisely for orders whose process died mid-execution; an order it re-picks would have no input to run |
| **`orders.input jsonb NOT NULL`** | ✅ The order becomes a complete record of what was bought |

### `runs.input` is not made redundant

The two columns answer different questions and both are evidence:

| Column | Records | Written by |
| --- | --- | --- |
| `orders.input` | What the buyer paid for | This feature, at purchase |
| `runs.input` | What was actually sent to the agent | API-08, at execution |

In the MVP they will hold the same document. They are not merged because the case file
quotes the **order's** copy (FR-038, FR-040), which is what lets an order that failed to
open, or that has not run yet, still show what was asked for. An order with no run has no
`runs.input` and must still produce a case file.

### `jsonb`, not `text`

Matches `runs.input`, `input_schema` and `output_schema`. The column is read back as an
object with no parse step, and Postgres validates that it is JSON at write time.

---

## 2. The order state machine, with the chain beside it

`order_state` is unchanged — all eight members already exist in
`src/entities/enums.ts` and in the initial migration. This feature is the first code to move
between them.

| Product state | On-chain deal | `onchain_deal_id` | Reached by | Owner |
| --- | --- | --- | --- | --- |
| `purchased` | `Open` | set | escrow confirmed | **this feature** |
| `purchased` | *unknown* | **NULL** | receipt never arrived ([R3](./research.md)) | **this feature** → API-10 |
| `failed` | *none* | **NULL** | escrow known to have failed — compensated | **this feature** |
| `running` | `Open` | set | a worker picked the order up | API-08 |
| `delivered` | `Delivered` | set | run succeeded, `markDelivered` landed | API-08 |
| `failed` | `Open` | **set** | run produced nothing | API-08 |
| `released` | `Settled` | set | buyer accepted, **or** the window lapsed | **this feature** (accept) / API-10 (sweeper) |
| `disputed` | `Disputed` | set | buyer complained | **this feature** |
| `adjudicated` | `Disputed` | set | verdict persisted, `resolve` not yet called | API-09 |
| `settled` | `Settled` | set | `resolve` landed | API-09 |

### ⚠️ `failed` is two situations, and `onchain_deal_id` is what tells them apart

This is the single most important row-shape distinction in the feature ([R14](./research.md)).

| | `failed` + NULL deal id | `failed` + deal id set |
| --- | --- | --- |
| What happened | `openDeal` was refused | The agent ran and produced nothing |
| Written by | This feature's compensating branch | API-08 |
| Tokens in escrow | **No** — nothing was ever locked | **Yes** — until the reclaimer sweeps |
| Ledger | debit **+ compensating credit** | debit only |
| Counts toward `inEscrowMinor` | **No** (FR-020) | **Yes** |
| `runs` row | none | one, with `output IS NULL` |
| Can be complained about | **No** — nothing to dispute | **Yes** (FR-034) |

The compensating branch is the **only** writer of `failed` with a NULL deal id, which is
what makes the predicate in §4 exact rather than a heuristic.

### ⚠️ A NULL `onchain_deal_id` means different things in `purchased` and in `failed`

| State | NULL deal id means | Correct response |
| --- | --- | --- |
| `purchased` | Either mid-saga, or the receipt never arrived. **The money may be escrowed.** | Leave it. Counts as escrowed. API-10's confirmation-retry job owns it |
| `failed` | The call was refused and the buyer was compensated. **Nothing is escrowed.** | Terminal. Does not count as escrowed |

`order.entity.ts`'s current comment on the column reads *"NULL = submitted, not yet confirmed
on-chain"*, which describes only the first row. It is updated to carry both.

**Never retry `openDeal` on a NULL deal id.** The contract assigns a new deal on every call,
so a retry against a transaction that later confirms leaves two deals escrowing two prices
for one order — the same trap `agent.entity.ts` documents for `registerAgent`, with money in
it.

---

## 3. What the purchase writes, in order

One transaction. The sequence is forced by a foreign key, not chosen ([R4](./research.md)).

```text
BEGIN
  SELECT accounts.id WHERE id = :buyerId FOR UPDATE      -- serialise this buyer
  SELECT COALESCE(SUM(amount_minor),0) FROM ledger_entries WHERE account_id = :buyerId
  refuse if sum < price                                   -- nothing written yet
  INSERT INTO orders (...)                                -- MUST precede the ledger row
  INSERT INTO ledger_entries (kind='purchase', amount=-price, order_id=<the order>)
COMMIT
-- then, and only then:
openDeal(onchainAgentId, buyerWallet, reviewWindowSeconds)
```

`ledger_entries.order_id REFERENCES orders(id)`, so the debit cannot be written first. Worth
stating because the spec's phrasing reads as simultaneous and "money first" does not compile.

### The order row this feature inserts

| Column | Value | Note |
| --- | --- | --- |
| `buyer_account_id` | the session's account | Never from the body (FR-006) |
| `agent_version_id` | the agent's **latest** version at this moment | Never `agent_id` — invariant #6 |
| `price_minor` | `version.price_minor` | **Snapshot.** Read inside the transaction |
| `input` | the request's `input` | Validated against `version.input_schema` first |
| `acceptance_criteria` | the request's `acceptanceCriteria` | Non-blank; never matched against the listing (FR-004) |
| `state` | `purchased` | The column default |
| `review_window_seconds` | `REVIEW_WINDOW_SECONDS` | **Snapshot** from config (FR-011, [R6](./research.md)) |
| `onchain_deal_id` | NULL | Set after the receipt, in a second statement |

Both snapshots are the point: a seller republishing, or the demo turning the review window
down between rehearsals, must not change what an existing order was sold under.

### The ledger rows

| When | `kind` | Sign | `order_id` | `external_ref` |
| --- | --- | --- | --- | --- |
| Purchase commits | `purchase` | negative | the order | NULL |
| Escrow **known** to have failed | `adjustment` | positive, same magnitude | the same order | the failed tx hash, if there is one |
| Escrow outcome **unknown** | *(nothing)* | — | — | — |
| Accept, complain, or any settlement | *(nothing)* | — | — | — |

The compensating credit is a new row beside the standing debit — invariant #4, and FR-019
requires the statement to show both. There is no `settlement` kind and none is added:
settled funds land on-chain under the parties' own addresses and the platform never holds
them (invariant #5).

---

## 4. The escrow-exposure predicate

`EscrowExposureRepository.sumOpenOrderValueMinor` today sums `price_minor` over
`ESCROWED_ORDER_STATES`. It gains exactly one exclusion:

```sql
WHERE buyer_account_id = :accountId
  AND state IN (:...ESCROWED_ORDER_STATES)
  AND NOT (state = 'failed' AND onchain_deal_id IS NULL)   -- ← added
```

`ESCROWED_ORDER_STATES` itself is **unchanged**; `failed` stays in it, for the reason
`order-states.ts` already argues at length.

### ⚠️ Why this is not the change that file forbids

`escrow-exposure.repository.ts` carries a warning: *"Filter by STATE only. Never add
`AND onchain_deal_id IS NOT NULL`."* That warning is correct and this is not that predicate.

| Row | `AND onchain_deal_id IS NOT NULL` (forbidden) | `AND NOT (failed AND NULL)` (added) |
| --- | --- | --- |
| `purchased`, deal id NULL — mid-saga or unconfirmed | ❌ dropped — the buyer's balance falls with nothing rising | ✅ **kept** |
| `failed`, deal id NULL — compensated | ✅ dropped | ✅ dropped |
| `failed`, deal id set — execution produced nothing | ❌ kept, correctly, but by accident | ✅ kept |

The forbidden predicate is about *confirmation*; this one is about *compensation*. They
coincide on one row and disagree on the row that matters. Both doc-comments are updated so
the next reader meets the refined rule rather than a warning their change appears to break.

---

## 5. The execution step shape — a contract for API-08

Nothing in this feature writes `runs.steps`. But the buyer's case file redacts them, and the
redaction is structural rather than textual ([R11](./research.md)), so the shape has to be
fixed here for API-08 to write against.

```ts
interface ExecutionStep {
  kind: 'tool_call' | 'model_turn' | 'output' | 'error';
  label: string | null;        // platform-authored: a tool name, a phase name
  reasoning: string | null;    // ⚠️ MODEL PROSE — seller-facing only, never mapped for a buyer
  durationMs: number | null;
  error: string | null;
  startedAt: string | null;    // ISO-8601
}
```

### The redaction, field by field

| Field | Seller's copy | Buyer's copy |
| --- | --- | --- |
| `kind` | verbatim | drives the platform-authored `summary` |
| `label` | verbatim | verbatim — platform-authored, no model text in it |
| `reasoning` | verbatim | **absent.** Not truncated, not summarised by a model — dropped |
| `durationMs` | verbatim | verbatim |
| `error` | verbatim | verbatim |
| `startedAt` | verbatim | absent — not in the UI's `CaseFileStep` |

**`reasoning` is dropped rather than shortened** because the first sentence of a paraphrase
is still a paraphrase, and the leak is at the start. The buyer's `summary` is composed from
`kind` and `label` — *"called the extraction tool"*, *"produced no output"* — which is a
summary of the step, authored by the platform, with no code path from the model's text to
the response.

This is the extension `agent-serialiser.ts`'s doc-comment predicts (it names API-09; the
case-file route is API-07's, so it lands here) and it belongs in the same module rather than
in a second boundary that could drift.

Until API-08 exists, `runs` has no rows and every case file returns `steps: []`.

---

## 6. Entities — nothing else changes

| Entity | Change |
| --- | --- |
| `order.entity.ts` | **`input` column added**; doc-comments on `onchainDealId` and `state` updated per §2 |
| `complaint.entity.ts` | none — `order_id UNIQUE` already makes one-complaint-per-order a database guarantee (FR-031) |
| `ledger-entry.entity.ts` | none |
| `run.entity.ts` | none — read only |
| `agent-version.entity.ts` | none — read only, joined for the listing and the prompt |

`complaints.order_id UNIQUE` is worth naming: FR-031 requires the constraint to live in
storage rather than in a check that can be bypassed, and it already does. A second complaint
fails on the constraint inside the transaction, which rolls back the chain call with it.

---

## 7. Reads, and the joins behind them

| Route | Joins | Index used |
| --- | --- | --- |
| `GET /orders` | `orders → agent_versions` (for `agentName`) | `orders_buyer_idx (buyer_account_id, created_at DESC)` |
| `GET /sales` | `orders → agent_versions → agents` filtered on `owner_account_id` | none — see [R15](./research.md) |
| `GET /orders/:id` | `orders → agent_versions → agents`, `LEFT JOIN runs` | primary keys |
| `GET /orders/:id/case-file` | same, plus the listing columns | primary keys |

**The buyer-or-seller check is part of the same query**, not a second read: the join already
carries `agents.owner_account_id`, so authorisation is a comparison on a row that was
fetched anyway (FR-035, [R7](./research.md)).

**The two case-file queries differ in one column.** The seller's selects
`agent_versions.system_prompt`; the buyer's does not name it. That is layer 1 of the
disclosure boundary — on a buyer's read the prompt never enters the process, which is the
only layer that also protects a log line and a stack trace.
