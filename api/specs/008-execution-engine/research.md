# Phase 0 Research — The Execution Engine

Eight decisions. Each names what was chosen, why, and what was rejected.

There were no `NEEDS CLARIFICATION` markers in the Technical Context to resolve — the stack was
fixed by API-01 and the two things this feature could have had to invent (where the buyer's input
lives between purchase and execution, and which JSON Schema dialect the output constraint speaks)
were both decided in earlier specs *in anticipation of this one*. R3 and R5 record where.

---

## R1 — The trigger is a poller this feature owns, not a dispatch call

**Decision**: `src/execution/execution.poller.ts` — a `setInterval` started in
`onApplicationBootstrap`, cleared in `onModuleDestroy`, running one claim-and-execute cycle at a
time. Interval from a new `EXECUTION_POLL_INTERVAL_MS` (default 1000). No `@nestjs/schedule`, no
call from `PurchaseService`, no event emitter.

**Rationale**: API-07's R13 settled that `POST /orders` calls nothing, defines no dispatcher
interface, and leaves `purchased` + a confirmed deal id as the queue entry — explicitly reserving
the move to `running` for this feature. API-10's cron table has a sweeper, a reclaimer, a reaper
and a confirmation retry, and no execution trigger. Between the two specs the trigger is
unclaimed, and it belongs to the worker that performs the transition.

A poller is also the only option that covers the restart case for free. An order placed in the
second before a deploy has a committed row, escrowed money, and nobody holding a promise to run
it; a poller finds it on the next tick, and an in-process call never would.

**Why not `@nestjs/schedule`**: API-10 will introduce it and standardising then is a five-line
change. Adding it here buys nothing today — `@Interval` fires on a fixed cadence regardless of
whether the previous tick finished, so the re-entrancy guard has to be hand-written either way,
which is the only part that carries risk.

**Why one at a time**: three demo orders, one process, and a serialised loop makes the log
readable during a rehearsal. A concurrency limit above one is a two-line change to the loop and
nothing else in the design assumes the limit is one — except the poller itself, which is
per-process and would need revisiting before a second replica.

**Alternatives considered**: a Nest event from `PurchaseService` (re-introduces the seam 007
declined, and drops orders placed during a restart); `LISTEN/NOTIFY` on an insert trigger (a
second queueing mechanism next to the state column, which invariant #9 exists to prevent).

---

## R2 — Claiming is one conditional `UPDATE … RETURNING`, not select-then-update

**Decision**: claim and load in a single statement.

```sql
UPDATE orders SET state = 'running'
WHERE id = (
  SELECT id FROM orders
  WHERE state = 'purchased' AND onchain_deal_id IS NOT NULL
  ORDER BY created_at
  LIMIT 1
  FOR UPDATE SKIP LOCKED
)
RETURNING id, agent_version_id, onchain_deal_id, input;
```

Zero rows returned means there is nothing to do. One row means this caller owns the order and
nobody else can.

**Rationale**: FR-004 requires the claim to be indivisible, and this is the form where that is a
property of the database rather than of how fast the loop happens to be. `SKIP LOCKED` means a
second worker takes the *next* order instead of blocking on the first, which is the behaviour you
want if the concurrency limit is ever raised. `onchain_deal_id IS NOT NULL` in the predicate
discharges FR-003 in the same statement — an order whose `openDeal` was refused (API-07 leaves
those in `failed`) or whose outcome was unknown (left in `purchased` with a NULL deal id) is
never picked up, which is exactly right: the second kind may still have money in escrow and the
confirmation-retry job, not this one, decides its fate.

**On the `UNIQUE (order_id)` backstop**: it is not the mechanism, and if it ever fires in
production it means two runs were already in flight and one of them burned a real model call
before losing the race. The service treats a unique violation as "someone else owns this" and
returns without touching the order — the correct behaviour, and one that must never be reached.

**Alternatives considered**: `SELECT … FOR UPDATE` then `UPDATE` in a transaction (identical
guarantee, two round trips, and a transaction held open across the read); an advisory lock keyed
on the order id (an additional locking scheme for no additional safety).

---

## R3 — The run row is inserted at claim, updated once at the end

**Decision**: insert `runs (order_id, input, started_at, steps='[]')` immediately after the claim
succeeds; a single `UPDATE` at the end sets `output`, `steps`, `error`, `output_valid`,
`finished_at`, `duration_ms`.

**Rationale**: US1 scenario 1 requires a record with a start time to exist while the run is in
flight, and API-10's reaper needs to see `state = 'running'` with a `started_at` to decide an
order is past its timeout. A row written only at the end leaves a crashed run with no evidence at
all — the process dies, the order sits in `running`, and there is nothing to say what was even
attempted.

**This is the one place the plan argues against an existing comment, and the comment is right
about a different moment.** `order.entity.ts` warns: *"Do not 'simplify' this away by writing the
`runs` row at purchase time instead… a run row that exists before execution starts makes every
pending order indistinguishable from a crashed one."* That is a warning about writing the row
**at purchase**, when the order is `purchased` and no worker has touched it. Inserting at *claim*
is after the transition to `running`, so the two states stay distinguishable by exactly the thing
the comment cares about: a `purchased` order still has no run row. The pairing is
`purchased` → no row; `running` → row with no `finished_at`; anything later → a closed row. That
is also why `orders.input` exists as a separate column, and API-07's migration argues it at
length.

**Alternatives considered**: buffering the record in memory and writing once (loses everything on
the restart the reaper exists for); two rows, one provisional (the `UNIQUE` forbids it, correctly).

---

## R4 — Deterministic demo mode substitutes the *model call*, never the record

**Decision**: an `AgentRunner` port with one method. Two implementations:
`ClaudeAgentRunner` (real) and `ScriptedAgentRunner`, which consults a `DemoScriptRegistry` and
delegates to the real runner when nothing matches. `ExecutionService` depends on the port and
cannot tell them apart. The registry ships **empty**; API-11 fills it.

A script is keyed on the pair `(definitionHash, inputHash)` — the pinned version's
`definition_hash`, and a hash over the canonical form of the buyer's input. A scripted entry
resolves to either an output or a thrown failure.

**Rationale**: API-11's brief is unusually pointed about this: *"Act 3's crash must travel the
ordinary failure path… A seeded shortcut that writes a verdict directly, or an error row that
never reaches `failed`, removes the very thing Guardian reads."* Substituting at the model call
means the scripted crash is an ordinary thrown error inside the ordinary pipeline, so the failure
branch, the empty `output`, the recorded `error`, the timings, and the `failed` transition are all
the real ones. FR-034 — a deterministic run produces a full record in the same shape as any other
— stops being something to remember and becomes something that could not have gone otherwise.

**Why key on `definition_hash`**: it already exists on every version, it is computed by
`definition-hash.ts` over the canonical definition, and it is committed on-chain at listing. API-11
authors the three definitions and can compute the same hash from the same constants. It cannot
collide by accident with a real seller's agent unless that seller published a byte-identical
definition — in which case the scripted behaviour is arguably the honest one anyway. Keying on
agent *name* would let anyone shadow a demo agent by naming theirs "LedgerBot".

**Why key on the input too**: FR-033 requires an unseeded input to behave like an ordinary agent.
`product-workflow.md` §5.5 describes *seeded inputs*, not seeded agents, and a judge who types
their own receipt into LedgerBot should get a real answer rather than the scripted three-of-five.

**Alternatives considered**: an environment flag putting the whole engine in demo mode (turns the
question "is this evidence real?" into a deployment question, which is the worst possible place
for it); a `demo` boolean column on `agent_versions` (a migration, a catalogue schema change, and
a field a seller could set); scripting inside the seeded agents' system prompts, i.e. prompting
the model to fail (this is exactly what §5.5 rejects — *"rather than hoping a live model misbehaves
on schedule"*).

---

## R5 — The request carries model, system, input, and an output constraint. Nothing else.

**Decision**: one non-streaming `messages.create` with `model` and `system` from the pinned
definition, the buyer's input serialised into a single user message, `max_tokens` from a module
constant, and `output_config: { format: { type: 'json_schema', schema: <the version's
output_schema> } }`. **No `thinking`, no `output_config.effort`, no `temperature`/`top_p`/`top_k`,
and `maxRetries: 0`.**

**Rationale, parameter by parameter**:

- **`effort` and `thinking` are omitted because they would 400.** All three demo agents run on
  `claude-haiku-4-5` (`tech-stack.md` §2.2), where `effort` is not supported and adaptive thinking
  is not available. But the deeper reason is that **the model is the seller's field**
  (`agent-definition.md` §2.2 — *"cost/quality is the seller's call"*), so the request has to be
  buildable for whatever model a definition names. Any parameter whose validity depends on the
  model tier cannot be hard-coded into a request built from seller data. Omitting them is the only
  choice that is correct for every model at once.
- **Sampling parameters are omitted** — removed on the Opus/Sonnet 5 tier and pointless here.
  Determinism for the demo comes from R4, not from sampling control, which is the same conclusion
  `tech-stack.md` §5 reaches for the audit.
- **`maxRetries: 0`.** The SDK retries 408/409/429/5xx twice by default. Two hidden retries make
  `duration_ms` a lie, spend up to three times the declared `timeout_seconds` in wall clock, and
  quietly turn one purchased run into three model calls. A failure here is a *legitimate outcome
  that produces evidence*, not an error to paper over — invariant #7 is the whole point. The three
  demo acts never touch the network anyway (R4), so the reliability argument for retries buys the
  rehearsal nothing.
- **Non-streaming.** There is no partial structured output worth rendering, nobody is watching the
  token stream, and `max_tokens` is small enough that HTTP timeouts are not a concern.
- **`max_tokens` is a module constant (8192), not a definition field.** The definition has no such
  field and adding one is a catalogue schema change. 8192 is far above any of the three demo
  agents' output contracts — a summary, a handful of line items, one translation — and small
  enough that a runaway generation cannot outlast the timeout.

**The dialect question was already settled.** `schema-validation.ts` uses `Ajv2020` rather than the
default draft-07 export, and its header says why in as many words: *"API-08 hands `outputSchema` to
the Anthropic API to constrain a seller agent's output, and that ecosystem is 2020-12."* So the
schema stored at listing is validated against the dialect this feature will hand to the API. There
is nothing to reconcile.

**What is *not* settled, and becomes a run failure**: structured outputs impose constraints Ajv
does not — every object needs `additionalProperties: false`, recursion is unsupported, and
numeric/string constraints like `minLength` are ignored or rejected. A seller schema can therefore
pass listing and be refused at run time. FR-007 and US5 scenario 6 already say what happens: a run
failure naming the definition, recorded like any other. **This is a note for API-11**: the three
demo agents' output contracts must satisfy the stricter set, or Act 2 fails for a reason that has
nothing to do with line items.

---

## R6 — A delivery the chain will not confirm leaves the order in `running`, and that state has two recoveries

**Decision**: on a `ContractRevertError`, `ChainConnectivityError`, or `ChainOutcomeUnknownError`
from `markDelivered`, the run record stays exactly as written (output and all), the order is
**not** moved, the failure is logged at `error` with the order id and any transaction hash, and the
agent is never re-run.

**Rationale**: the three candidate states are all wrong in different ways, and the least wrong is
to not move. `delivered` would be the platform believing its own database about the chain: the
review window is opened by the contract at `markDelivered`, so a buyer would see a clock that does
not exist, and both `accept` and the sweeper's `release` would be rejected by the contract.
`failed` would be a false statement — something *was* produced, and it is sitting in `runs.output`
where Guardian would read it as a delivery while the state says nothing arrived. So the order rests
in `running` with a complete, closed run record, which is an honest description: the work is done
and the announcement is not.

**Two things already recover it, and the spec was wrong to imply nothing does.**

1. **API-10's reaper** flips a `running` order past its timeout to `failed`. That produces the one
   combination nothing else in the system creates — `state = 'failed'` with a non-NULL `output` —
   and it is survivable rather than corrupt: Guardian's non-delivery reasoning keys on the empty
   output, not on the state, so it will rule on the merits of the output it can see.
2. **API-07's complaint path** already issues `markDelivered` and `dispute` as a single action for
   a `failed` order, because a deal that was never marked delivered cannot be disputed. Applied
   here, that *re-sends the announcement that was lost* and lands the order in front of the auditor
   with its real output intact. The recovery for a lost delivery announcement turns out to be a
   path that already exists for a different reason.

Neither is built by this feature, and neither is a reason to relax anything here. But "the resting
state is a stuck order and nothing touches it" was not true, and the corrected Assumptions entry
says so.

**Alternatives considered**: retrying `markDelivered` inline (the run is finished and the evidence
is written, so a retry loop here is a different job with a different failure mode — and the
confirmation-retry job in API-10's table is where a retry belongs); moving to `delivered` and
letting the sweeper discover the contract disagrees (the buyer sees a review window that will not
honour an accept — the worst of the three).

---

## R7 — The trace conforms to `ExecutionStep`, which moves next to the entity

**Decision**: `runs.steps` is written as `ExecutionStep[]` — the type API-07 declared in
`orders/dto/case-file.dto.ts`. The declaration moves to `src/entities/execution-step.ts`;
`case-file.dto.ts` re-exports it so no existing import changes. A `run-trace.ts` helper composes
the array.

For a tool-less single-turn agent the trace is short by construction:

| Outcome | Steps written |
| --- | --- |
| Success | `model_turn` (label: the model id; `reasoning`: any assistant text alongside the structured output, usually empty) → `output` (label: `output`) |
| Model failure / timeout | `model_turn` with its `error` set → `error` (label: the failure kind) |
| Definition unusable | a single `error` step naming the field |

**Rationale**: `case-file.service.ts` already casts `runs.steps` to `ExecutionStep[]` with an
assertion its own comment calls *"unchecked, and it is deliberate"*. Today nothing writes the
column, so the assertion is a promise about a future producer. This feature is that producer, and
the cheapest way to make the promise true is to compile both sides against one declaration.
Leaving it in a consumer's DTO folder would mean the writer imports from the reader — the wrong
direction, and the sort of import that becomes a duplicated interface later.

**On the trace being thin**: it is, and the shape is still worth writing properly. FR-014's per-step
`kind`, timing and error exist because a tool-using agent produces a real trace, and because
Guardian's ability to separate *"tried and could not"* from *"returned a stub"* is what the middle
tiers rest on. With one model turn and no tools, the honest trace is two steps, and two steps that
say what happened beats one blob that does not. `agent-definition.md` §2.2 lists `tools[]` as part
of the execution spec; when it arrives, the trace grows without the shape changing.

**Invariant #3 in this file**: `ExecutionStep.reasoning` is model prose and can paraphrase the
system prompt. FR-015 requires it stored unredacted, and API-07's serialiser is what removes it
from a buyer's copy. The rule this feature adds is narrower and about a place no serialiser
reaches: **the runner never logs the system prompt, the request body, or the raw model text.** Log
lines carry the order id, the version id, the model, the duration and the failure kind.

---

## R8 — Execution owns its own read across `orders` and `agent_versions`

**Decision**: `ExecutionRepository` injects `Repository<Run>` and issues its own query builder
reads against `orders`, `agent_versions` and `agents`. It does not depend on
`OrderRepository`, `AgentRepository`, or anything exported by `OrdersModule` or `CatalogModule`.

**Rationale**: this is the pattern already in the codebase rather than a new one.
`OrderRepository` reads `agent_versions` and `agents` directly — `findPurchasableVersion`,
`findCaseFileForSeller` — with `TypeOrmModule.forFeature([Order, Complaint])` and query-builder
joins onto the entities it does not own. `docs/CONTEXT.md` §3's module map is about who owns the
*writes* and the *serialisation* of a table, not about who may read it; the catalogue's ownership
of `agent_versions` is what makes `agent-serialiser.ts` the single disclosure boundary, and a
read that never reaches a buyer does not cross it.

The load query is the mirror image of the buyer-facing ones: it selects `system_prompt`, `model`,
`output_schema` and `timeout_seconds` **because it must**, and `order.repository.ts`'s own header
explains why those columns are absent from every other read — *"the only layer that also protects a
log line, an error message and a stack trace"*. That argument is the reason this query lives in a
module with no controller.

**Alternatives considered**: exporting a loader from `CatalogModule` (a public method whose only
purpose is to hand out the system prompt, reachable from anywhere that imports the module — a
worse boundary than a private query in a module with no routes); reusing `OrderRepository` via
export (would make `OrdersModule` depend on nothing new but would put an execution-shaped claim
query in a class whose header is entirely about buyer-facing disclosure).
