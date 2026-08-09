# Phase 1 — Data model: the Guardian audit engine

**One small migration.** Every table this feature reads or writes was created by API-02's
`InitialSchema`, and the one nullable column it fills — `verdicts.onchain_tx_hash` — was declared
nullable for exactly this reason. The exception is §7: two columns on `orders` that exist only to
bound audit attempts and make an exhausted audit visible. An earlier draft of this plan claimed
"no migration"; that claim did not survive the decision to bound retries (R14), and the cost is
named here rather than absorbed.

---

## 1. `verdicts` — the row this feature exists to write

Already declared in `src/entities/verdict.entity.ts`. Reproduced here with what **this**
feature puts in each column.

| Column | Type | Written by this feature |
| --- | --- | --- |
| `id` | `uuid` PK | Postgres default |
| `order_id` | `uuid` FK → orders **UNIQUE** | The audited order. **The UNIQUE is the feature's central guarantee** (research R2) |
| `tier` | `verdict_tier` NOT NULL | Mapped from the model's `'0'…'100'` enum through `verdict.schema.ts` |
| `refund_minor` | `bigint` NOT NULL, `CHECK >= 0` | `floor(priceMinor × bps / 10000)` — a record, not a payment (R9) |
| `reasoning` | `text` NOT NULL | The model's prose, **verbatim**. Shown to buyer and seller |
| `citations` | `jsonb` NOT NULL DEFAULT `'[]'` | `{ source, quote, met }[]`, **≥ 1 element**, in the model's order |
| `verdict_hash` | `bytea` NOT NULL | 32 bytes, SHA-256 over the canonical projection (R5) |
| `model` | `text` NOT NULL | `'claude-opus-5'`, from `guardian.constants.ts` (FR-016) |
| `onchain_tx_hash` | `text` NULL | **NULL until settlement lands.** This nullability is the settle-retry predicate (R1) |
| `created_at` | `timestamptz` NOT NULL | Postgres default |

**Two constraints do real work and neither is checked in application code as a substitute:**

- `UNIQUE (order_id)` — FR-025 and FR-021. "There are no appeals" is a database guarantee, and
  it is what arbitrates the concurrent-audit race that R2 deliberately does not claim against.
  A second audit's insert fails; it does not overwrite.
- `CHECK (refund_minor >= 0)` — note `>=`, not `>`. A `none` verdict legitimately refunds
  nothing, and the entity's own comment says so.

**`citations` is `jsonb` and its shape is enforced at the boundary, not by the column.** The
entity types it `unknown[]`. The shape guarantee comes from `verdict.schema.ts` on the way in
(the decoded, validated Zod output is what gets inserted) and from
`dto/verdict-response.dto.ts` on the way out. Nothing between those two points may reshape it —
the UI reads `source` / `quote` / `met` literally (FR-033).

---

## 2. What this feature reads

All read-only. No column of any of these is written except the two `orders` state moves in §3.

| Table | Columns read | Why |
| --- | --- | --- |
| `orders` | `id`, `state`, `agent_version_id`, `buyer_account_id`, `price_minor`, `input`, `acceptance_criteria`, `onchain_deal_id`, `disputed_at`, `audit_attempts`, `audit_failed_at` | The subject. `acceptance_criteria` is one of the two yardsticks; `price_minor` feeds R9; `onchain_deal_id` is the `resolve` argument; the last two are §7 |
| `agent_versions` | `capabilities`, `exclusions`, `name`, **`system_prompt`** | The **pinned** listing — the other yardstick (invariant #6, FR-002) — plus the prompt, which the auditor needs for intent-versus-effort (⚠️ see below) |
| `agents` | `owner_account_id` | Authorisation for the verdict read (FR-030), reached `order → version → agent` |
| `runs` | `steps`, `output`, `error`, `started_at`, `finished_at`, `duration_ms` | The evidence. `output IS NULL` is the non-delivery fact (invariant #7) |
| `complaints` | `reason` | The buyer's testimony — what the audit is answering |

### ⚠️ This is the second query in the codebase that selects `system_prompt`

`execution.repository.ts` is the first, and its header explains that it inverts
`order.repository.ts`'s column-naming rule deliberately, because the run cannot happen without
the prompt. The same applies here: `agent-definition.md` §4 lists Guardian as one of the three
parties that sees it, because the intent-versus-effort judgment depends on it, and
`product-workflow.md` §6.3 says the same of the raw `runs.steps` — reasoning included.

An earlier draft of this document forbade both. It is withdrawn (R6): it reversed a settled
product decision and removed the input the tried-versus-stub distinction rests on.

**The obligation that replaces the prohibition** is that both must be *contained on the way out*,
because the auditor's reasoning reaches the buyer through no serialiser:

| Field | Contained by |
| --- | --- |
| `system_prompt` | ⚠️ **A check on the ruling before it is stored** — a verdict whose `reasoning` reproduces ≥ 8 consecutive normalised words of the prompt is rejected as a failed audit (FR-042, R13) |
| `runs.steps[].reasoning` | The same check. A citation cannot carry it: `source` is an enum of `capability \| exclusion \| criterion`, so a step is not a citable source |

The regression checks for reviews of this module are in `contracts/guardian-case-file.md` §9.
The one that changed shape: it is no longer *"the prompt must not appear in `src/guardian/`"* —
it is *"the prompt appears in exactly three files, and no controller returns anything built from
them."*

---

## 3. State transitions

`orders.state` is the queue (invariant #9). This feature performs exactly two moves and adds
no new state (R2).

```
                    ┌──────────────────────── settle-pending pass retries here
                    │
disputed ─────► adjudicated ─────► settled
   ▲   (Txn A:        │   (Txn B: tx_hash    
   │    verdict row   │    + state)          
   │    + state)      │                      
   └──────────────────┘  a failed/unknown chain outcome simply
      audit failed:      leaves the order here, with a readable
      no move at all,    verdict and onchain_tx_hash IS NULL
      no verdict row
```

| Move | When | Written with |
| --- | --- | --- |
| `disputed → adjudicated` | The verdict row is inserted | **Transaction A**, same statement batch as the insert (invariant #8, R12) |
| `adjudicated → settled` | `resolve` confirmed | **Transaction B**, together with `onchain_tx_hash` |

Three properties fall out of this and each maps to a requirement:

- **A verdict row and the `adjudicated` state are created together**, so `adjudicated` never
  means "we are thinking about it" — it means the invariant #8 window, exactly as
  `order-states.ts` already documents. This is why R2 does not add a claim state.
- **A failed audit performs no state move, ever.** The order stays `disputed` and the
  audit-pending predicate finds it next tick (FR-017) — until `audit_attempts` reaches the bound,
  at which point `audit_failed_at` is stamped and the predicate stops selecting it (§7). There is
  still no "audit failed" *state* and still no verdict row: the absence of a verdict row remains
  the marker for "undecided", and the new column marks only "and we have stopped trying."
- **`adjudicated` stays in `ESCROWED_ORDER_STATES`.** Unchanged by this feature, and correct:
  during that window the tokens are still escrowed. Treating the verdict as the moment money
  moved would be believing our own database about the chain's state.

---

## 4. Entities that exist only in memory

Neither is persisted; both are declared because their *shape* is a guarantee.

### `GuardianCaseFile` — what the auditor is shown

The full evidence bundle. Full contract: `contracts/guardian-case-file.md`.

| Field | Source | Note |
| --- | --- | --- |
| `input` | `orders.input` | What the buyer paid for |
| `acceptanceCriteria` | `orders.acceptance_criteria` | Yardstick 1 — one prose field, not an array |
| `complaint` | `complaints.reason` | What is alleged |
| `capabilities` | pinned `agent_versions.capabilities` | Yardstick 2. May be empty; empty is a statement |
| `exclusions` | pinned `agent_versions.exclusions` | The defensive half of yardstick 2 |
| `systemPrompt` | pinned `agent_versions.system_prompt` | ⚠️ Verbatim. Needed for intent-versus-effort (agent-definition §4), **and** it is the corpus the leak check reads — truncating it here would silently weaken FR-042 |
| `delivered` | `runs.output IS NOT NULL` | ⚠️ An explicit boolean, not an inference from a missing field (FR-004) |
| `output` | `runs.output` | `unknown \| null`. `null` **is** the evidence (invariant #7) |
| `error` | `runs.error` | The run's failure, verbatim |
| `steps` | `runs.steps` | ⚠️ **Raw, `reasoning` included** — the only thing that separates a genuine attempt from a stub (product-workflow §6.3) |
| `timings` | `runs.started_at`, `finished_at`, `duration_ms` | Nulls where the run never finished |

**This type carries the seller's IP, and nothing built from it may be returned by a controller,
logged, or attached to an error message.** It is assembled, serialised into one model request,
and discarded. `AuditFailedError` takes typed identifying fields precisely so no message string
has to carry case-file text — the pattern `execution.errors.ts` established and the reason it
gives.

### `AuditedVerdict` — what the auditor returns

The decoded, validated model output, before it becomes a row. Full contract:
`contracts/verdict-schema.md`.

```ts
interface AuditedVerdict {
  tier: VerdictTier;          // mapped from '0'|'25'|'50'|'75'|'100'
  reasoning: string;
  citations: Citation[];      // length >= 1, validated (R3, R4)
}
interface Citation { source: 'capability' | 'exclusion' | 'criterion'; quote: string; met: boolean }
```

It reaches this shape only after three gates, each of which fails the whole audit rather than
repairing the value (R7): the Zod parse (R3), the citation-traceability check (R4), and the
non-delivery floor (R10).

---

## 5. Validation rules, and where each one actually lives

The point of this table is that almost nothing is enforced by an `if` that a future edit can
delete.

| Rule | Requirement | Enforced by |
| --- | --- | --- |
| One verdict per order, forever | FR-021, FR-025 | **`UNIQUE (order_id)`** — a constraint, not a check |
| Tier is one of five | FR-009 | ⚠️ The **client-side Zod parse** — `enum` is dropped from the wire schema (R3, verified) — then `Record<VerdictTier, …>` in `tier.ts` and `refund.ts` |
| Citation source is one of three | FR-010 | ⚠️ The **client-side Zod parse**, same as the tier |
| Citations are structured, not prose | FR-032 | The **decoder** — `messages.parse()` returns objects |
| At least one citation | FR-011 | **The wire JSON Schema.** `.min(1)` → `minItems: 1`, which survives the SDK's transform (R3, corrected). Not representable |
| Quote traces to its clause | FR-012 | `verdict-validation.ts`, normalised substring (R4) |
| No output ⇒ full tier | FR-014 | `verdict-validation.ts` assertion over a model-produced tier (R10) |
| **Ruling does not quote the prompt** | **FR-042** | **`verdict-validation.ts`, verbatim word-run check before persistence (R13).** The containment for showing the auditor the prompt |
| Audit is bounded in time | FR-038 | SDK `timeout` + `AbortController` on one deadline (R14) |
| Attempts are bounded | FR-043 | `orders.audit_attempts` + the audit-pending predicate's `< 3` (§7) |
| An exhausted audit is visible | FR-044 | `orders.audit_failed_at`, surfaced by the verdict route (§7) |
| No fabricated ruling | FR-041, SC-013 | No code path writes `verdicts` except the one that persists an auditor response |
| Refund ≥ 0 | schema | **`CHECK (refund_minor >= 0)`** |
| Fingerprint is 32 bytes | contract ABI | SHA-256's output width (R5) |
| Only `disputed` + a deal id is auditable | FR-027 | The **audit-pending SQL predicate** (R1) |
| Verdict precedes the chain call | FR-018, invariant #8 | **Transaction boundary** — A commits before `resolve` is called (R12) |
| Buyer **or** agent owner may read | FR-030, FR-031 | `OrderRepository.findVisibleToAccount` — one query, already built, already returns one indistinguishable `null` |
| No prompt reaches a **buyer** | FR-035, invariant #3 | The case-file serialiser for the buyer's route (already built), plus FR-042 for the one text no serialiser covers |
| No model prose to the buyer's steps | FR-036 | Already true; `toBuyerCaseFileSteps` (R11). A regression check, not a task |
| Settlement writes no ledger row | FR-026, invariant #5 | `LedgerKind` has no `settlement` member and this feature does not add one |

---

## 6. Configuration

One new key. `ANTHROPIC_API_KEY` is already required at boot by API-08.

| Key | Type | Default | Why |
| --- | --- | --- | --- |
| `GUARDIAN_POLL_INTERVAL_MS` | int, coerced | `2000` | Both poller passes. Slower than execution's 1000 because an audit is one long call, not a stream of short ones, and because pickup latency here is bounded by SC-003's one-minute budget rather than by a screen refresh |
| `GUARDIAN_AUDIT_TIMEOUT_MS` | int, coerced | `180000` | ⚠️ The audit deadline (FR-038). Generous, because Opus 5 thinks before answering and a real audit legitimately takes tens of seconds — but finite, because one audit occupies the worker's only slot and an unbounded call stops every later dispute from being decided (SC-012) |

**Not configuration, deliberately:**

- **The model id** — `'claude-opus-5'`, a constant in `guardian.constants.ts`. Unlike a seller
  agent's model (which is the seller's choice, read from the pinned definition), the auditor's
  identity is a product decision. It is recorded per-verdict in `verdicts.model` so a stored
  ruling always says what judged it.
- **`max_tokens`** — a constant, sized generously because **thinking is on by default on Opus 5
  and `max_tokens` caps thinking plus response text together**. A limit tuned to the visible
  output alone truncates mid-verdict and surfaces as `stop_reason: 'max_tokens'` (R7).
- **Sampling parameters** — none exist. `temperature`, `top_p`, and `top_k` all return 400 on
  Opus 5, which is the reason verdicts are stored and replayed rather than recomputed
  (`docs/tech-stack.md` §5).
- **The tier basis points** — the contract's `_refundBps` values, restated in `refund.ts` as an
  exhaustive `Record`. Not a knob; an off-by-one is the number an audience watches.

- **`GUARDIAN_MAX_AUDIT_ATTEMPTS = 3`** — a constant, not a knob. The bound exists to make an
  undecidable dispute *visible*, and a deployment that could set it to a large number would
  reintroduce the silent forever-spinner it was added to remove (R14).
- **`LEAK_RUN_WORDS = 8`** — a constant. The verbatim-run length for FR-042's containment check.
  Tunable in source if a rehearsal shows false positives, but lower it rather than raise it: too
  low rejects legitimate rulings and is visible immediately; too high leaks and is not (R13).

---

## 7. The one migration: bounding and surfacing a failed audit

Two columns on `orders`. Nothing else in the schema changes.

```sql
ALTER TABLE orders
  ADD COLUMN audit_attempts   smallint    NOT NULL DEFAULT 0,
  ADD COLUMN audit_failed_at  timestamptz NULL;
```

| Column | Written when | Read by |
| --- | --- | --- |
| `audit_attempts` | Incremented on **every** failed audit, in the same statement that logs the failure | The audit-pending predicate (`AND audit_attempts < 3`) |
| `audit_failed_at` | Set on the attempt that reaches the bound | `GET /orders/:id/verdict`, to return an audit-failed body instead of an in-progress not-found (FR-044) |

**Why this is not a new order state.** The order genuinely *is* still disputed: the dispute is
real and unresolved, and what failed is our ability to rule on it — not the dispute itself. A new
state would mean migrating the `order_state` enum, deciding whether it belongs in
`ESCROWED_ORDER_STATES` (it would — the tokens are still escrowed), and adding a word to a state
machine four other specs already reason about. Two columns carry the same information and leave
the state machine alone (R14).

**Why not track attempts in memory.** It has to outlive the process. An in-memory counter resets
on restart, so a deterministically-failing order retries forever across deploys — and worse, the
terminal state would *vanish from the API* on the next restart, turning a visible failure back
into the spinner it was added to prevent.

**What happens to the money.** Nothing, here. An exhausted audit does not write a fallback ruling
to free it — that would put a row Guardian did not author into the ruling record (FR-041,
SC-013). The funds stay escrowed until the escrow's own `DISPUTE_DEADLINE` (72 hours) lets anyone
call `forceResolve`, which settles at a fixed quarter tier. That is the contract's existing
answer for *"Guardian never ruled"*, and it is deliberately slow.

**⚠️ Both columns are about the audit, not the complaint.** They must not be reset by any other
flow, and nothing outside `guardian/` may write them. Resetting `audit_attempts` to re-open a
decided dispute is not a supported operation — `verdicts.order_id UNIQUE` would refuse the second
ruling anyway, which is the correct outcome.
