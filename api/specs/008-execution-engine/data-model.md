# Phase 1 Data Model — The Execution Engine

**No migration.** Every table and column this feature touches already exists: `runs` came with the
initial schema, `orders.input` came with API-07's `1786320000000-OrderInput`, and
`agent_versions` came with API-06. What follows is who writes what, when, and what must be true
at each point.

---

## 1. `runs` — the evidence

One row per order, forever. `src/entities/run.entity.ts`, table `runs`.

| Column | Type | Written at | By this feature |
| --- | --- | --- | --- |
| `id` | uuid pk | insert | default |
| `order_id` | uuid **UNIQUE** → `orders(id)` | insert | the claimed order |
| `input` | jsonb NOT NULL | insert | copied from `orders.input` |
| `steps` | jsonb NOT NULL default `[]` | close | the composed `ExecutionStep[]` |
| `output` | jsonb **NULL** | close | the model's structured output, **or left NULL** |
| `error` | text NULL | close | the failure, in full |
| `output_valid` | bool NULL | close | conformance, or left NULL |
| `started_at` | timestamptz NOT NULL | insert | `now()` |
| `finished_at` | timestamptz NULL | close | `now()` |
| `duration_ms` | int NULL | close | `finished_at − started_at` |

### The three shapes a row can have

| Shape | `finished_at` | `output` | `error` | `output_valid` | Means |
| --- | --- | --- | --- | --- | --- |
| **Open** | NULL | NULL | NULL | NULL | A worker claimed the order and is running it. Also what a crashed process leaves behind — API-10's reaper reads exactly this plus a stale `started_at`. |
| **Delivered** | set | **set** | NULL | `true` \| `false` | The agent returned something. `false` means it failed its own declared contract and is still a delivery (FR-029). |
| **Non-delivery** | set | **NULL** | set | **NULL** | Nothing arrived. The empty output is the claim; the error says why. |

### Invariants

- **`UNIQUE (order_id)` is the whole no-retry guarantee** (FR-012). A second insert raises a
  unique violation, which the service treats as "another worker owns this" and returns from
  without touching the order. Nothing in this feature deletes or re-inserts a run row.
- **`output` is NULL or a real output. Never `{}`, never a string, never a stand-in** (FR-023).
  The entity comment says this and it is the single most load-bearing rule in the feature —
  invariant #7, and the entire basis of Act 3.
- **`output_valid` is NULL only when there is no output** (FR-028). A run that delivered always
  answers the question; a run that delivered nothing has no question to answer. A `false` here
  never implies non-delivery.
- **`error` is stored unredacted, prompt paraphrases and all** (FR-015). Redaction happens in
  API-07's serialiser on the way out. The rule this feature adds is that the error is never
  *logged*, only stored.
- **`steps` is written once, whole, and never truncated** (FR-017). Postgres TOASTs it; the schema
  imposes no ceiling and neither does this feature.

---

## 2. `ExecutionStep` — the trace element

Moves from `src/orders/dto/case-file.dto.ts` to `src/entities/execution-step.ts`; the old location
re-exports it. Shape unchanged — API-07 defined it and `case-file.service.ts` reads it.

| Field | Type | Buyer sees it? | Written here |
| --- | --- | --- | --- |
| `kind` | `'tool_call' \| 'model_turn' \| 'output' \| 'error'` | yes | `model_turn`, `output`, `error` — never `tool_call` yet |
| `label` | `string \| null` | **yes, verbatim** | platform-authored only: the model id, `output`, or the failure kind |
| `reasoning` | `string \| null` | **no — seller only** | assistant text accompanying the structured output, when there is any |
| `durationMs` | `number \| null` | yes | per step |
| `error` | `string \| null` | yes | the step's own failure |
| `startedAt` | ISO string \| null | seller only | per step |

⚠️ **`label` is the one text field that crosses to a buyer untouched.** The DTO says so. Every
value this feature writes into it is a literal or an identifier — a model id, the word `output`, a
failure kind — and never model output, never a fragment of the prompt, never an error message.

### The traces this feature produces

```text
success            [ model_turn(label=<model id>, reasoning=<assistant text|null>),
                     output(label="output") ]

model failed       [ model_turn(label=<model id>, error=<why>),
                     error(label="model_error") ]

timed out          [ model_turn(label=<model id>, error="timed out after Ns"),
                     error(label="timeout") ]

definition unusable[ error(label="definition_unusable") ]
```

Two steps, not one (FR-016): even a run that produced nothing records that the attempt was made
and how it ended. The trace is short because a tool-less agent is one model turn — see research R7
on why the shape is still worth writing.

---

## 3. `orders` — the queue, and the two transitions this feature owns

Read: `id`, `agent_version_id`, `onchain_deal_id`, `input`, `state`.
Written: `state` only. No other column on `orders` is touched.

```text
                    ┌── claim ────────────────────────────────────┐
   purchased ───────┤  UPDATE … WHERE state='purchased'           ├──▶ running
   (deal id set)    │        AND onchain_deal_id IS NOT NULL      │
                    └─────────────────────────────────────────────┘
                                        │
                     ┌──────────────────┴───────────────────┐
                     │                                      │
        output produced + markDelivered            crash / timeout /
        confirmed by the contract                  unusable definition
                     │                                      │
                     ▼                                      ▼
                 delivered                               failed
                                                  (no chain call at all)

        output produced, markDelivered refused or unconfirmed
                     │
                     ▼
              stays running  ── reaper (API-10) ──▶ failed (with an output)
                             ── complaint (API-07) ──▶ markDelivered + dispute
```

### Preconditions on the claim

Both are in the predicate rather than checked afterwards, so an ineligible order is never claimed:

- `state = 'purchased'` — FR-002. Any other state means someone else's business.
- `onchain_deal_id IS NOT NULL` — FR-003. Excludes two different orders for two different reasons:
  one whose `openDeal` was refused (API-07 left it `failed` and already refunded), and one whose
  outcome was unknown (API-07 left it `purchased` with a NULL deal id on purpose, because the money
  may genuinely be escrowed). The second is the confirmation-retry job's problem, not this one's.

### The success ordering is fixed and not the money rule

`runs` closed → `markDelivered` → `state = 'delivered'` (FR-018, FR-019). Invariant #1's
"Postgres first" is about flows that reduce what the platform owes; nothing moves here. The reason
for this order is different: a lost chain response must leave complete evidence and a missing
announcement, never an announced delivery with no record of what was delivered.

---

## 4. `agent_versions` — the pinned definition, read only

Loaded by joining `orders.agent_version_id`, **never** by resolving the agent's latest version
(invariant #6, FR-005). All five fields come from that row and none has a fallback (FR-006):

| Field | Used for |
| --- | --- |
| `system_prompt` | the request's system prompt — ⚠️ never logged |
| `model` | the request's model — the seller's choice, never substituted (R5) |
| `output_schema` | the structured-output constraint **and** the conformance check |
| `timeout_seconds` | the abort deadline for the whole run |
| `definition_hash` | half the demo script key (R4) |

`input_schema` is deliberately **not** read: the buyer's input was validated against it at
purchase, and re-validating here would mean an order that already took the buyer's money could be
refused for an input the platform already accepted.

A missing row, or a row whose `output_schema` the model API refuses, is a run failure naming the
field (FR-007) — recorded through the ordinary failure branch, not thrown out of the poller.

---

## 5. Conformance

`validateAgainstSchema(outputSchema, output)` from `src/catalog/schema-validation.ts` — the
existing function, unchanged, already on the 2020-12 dialect for this reason.

| Situation | `output` | `output_valid` | `state` |
| --- | --- | --- | --- |
| Output satisfies the schema | stored | `true` | `delivered` |
| Output violates the schema | **stored as returned** | `false` | `delivered` |
| No output | NULL | NULL | `failed` |
| The check itself threw | stored | NULL + logged at `error` | `delivered` |

The third row is FR-028 and the fourth is FR-030: a broken checker must not be able to convert a
completed delivery into a non-delivery. Structured outputs make `false` unlikely — the API is
constraining the answer to the same schema — which is the point. It is recorded so an auditor can
assert conformance rather than assume it.

---

## 6. The demo script key — not a table

No storage. An in-memory registry (`DemoScriptRegistry`) holding entries keyed on:

```
key = sha256(definition_hash) ‖ sha256(canonical JSON of the buyer's input)
```

`definition_hash` is already a column on `agent_versions`, already keccak256 over the canonical
definition, already committed on-chain at listing. The input hash is computed per run over the
same canonical form both sides can reproduce. A miss on either half means the real runner handles
it (FR-033).

Nothing about a scripted run is persisted differently — that is the whole design (R4). The `runs`
row from a scripted execution is indistinguishable in shape from a live one, because it was
produced by the same code.
