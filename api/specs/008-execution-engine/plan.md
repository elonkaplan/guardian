# Implementation Plan: The Execution Engine — the wrapped workspace

**Branch**: `008-execution-engine` | **Date**: 2026-08-09 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/008-execution-engine/spec.md`

## Summary

One new module — `src/execution/` — plus one new dependency, one new environment key, one type
moved, and **no migration**. No HTTP endpoints: this feature is a worker, and the only thing
that starts it is the order's own state.

**The schema for this feature was built two specs ago and is complete.** `Run` already carries
`input`, `steps`, `output`, `error`, `output_valid`, `started_at`, `finished_at`, `duration_ms`,
already has the `UNIQUE (order_id)` that makes FR-012 structural rather than remembered, and
already documents in its own comments why `output` must stay nullable. `orders.input` was added
by API-07 precisely so this feature would have the buyer's input to send. `validateAgainstSchema`
already exists and is already configured on the 2020-12 dialect **because this feature was going
to hand `output_schema` to the Anthropic API** — `schema-validation.ts` says so in its own header.
`ANTHROPIC_API_KEY` is already required at boot. The work here is the pipeline, not the plumbing.

Six decisions carry the feature, all argued in [research.md](./research.md):

- **There is no dispatcher, so this feature grows its own poller** (R1). API-07 deliberately left
  `purchased` + a deal id as the queue entry and defined no seam; API-10's cron table has a
  reaper but no execution trigger. So the trigger belongs here, and it is a serialised
  claim-one-and-run loop rather than a fan-out.
- **The claim is a single conditional `UPDATE … RETURNING`** (R2), which makes FR-004's
  "exactly one execution wins" a property of Postgres rather than of the loop's timing. The
  `UNIQUE (order_id)` on `runs` is the backstop, and if it ever fires, a model call was already
  wasted.
- **The run row is inserted at claim time and updated once at the end** (R3). This is the one
  place the plan argues *against* a comment in the existing code, and the argument is that the
  comment is about a different moment.
- **The demo script substitutes at the model call, not at the run record** (R4). A scripted
  crash then travels the ordinary failure path, which is exactly what API-11's brief demands.
- **The request carries no `effort` and no `thinking`** (R5). Both 400 on `claude-haiku-4-5`,
  which is the model all three demo agents name, and the model is the seller's choice rather
  than ours — so the request must be built from the definition and nothing else.
- **A delivery the chain would not confirm leaves the order in `running`** (R6), and that
  resting state has two existing recoveries rather than none.

### Two spec amendments, made during planning

**1. The three demo fixtures *are* owned — by API-11.** The spec's Assumptions said no spec owns
them, following `product-workflow.md` §5.5, which says exactly that. That sentence is stale:
`docs/specs/API-11-demo-seed.md` lists all three fixtures in a table, names the three
deterministic failure modes, and calls itself *"where the demo gets designed"*. The split is
therefore mechanism here, content there — and API-11 already declares `Depends on: API-06,
API-08`, so the dependency direction agrees. The Assumptions entry is corrected and R4 defines
the seam API-11 fills.

**2. The stuck-`running` resting state has named recoveries.** FR-020 leaves an order short of
`delivered` when the chain will not confirm the announcement, and the spec called recovery
"out of scope" without saying what would eventually touch it. Two things already will: API-10's
reaper flips a `running` order past its timeout to `failed`, and API-07's complaint path already
issues `markDelivered` and `dispute` as one action for a `failed` order — which re-announces the
delivery that was lost and lands the order in front of the auditor with its real output intact.
Neither is built here, but "nothing recovers this" was wrong and worth correcting, because the
combination changes what the resting state costs. See R6.

## Technical Context

**Language/Version**: TypeScript 6.0 on Node 22 (`engines.node >= 22`)

**Primary Dependencies**: NestJS 11 · TypeORM 1.1 · **`@anthropic-ai/sdk` (new — the only
dependency this feature adds)** · Ajv 8 via the existing `Ajv2020` instance · Zod 4 for the
environment schema. Not added: `@nestjs/schedule` (R1), no queue, no broker, no retry framework.

**Storage**: PostgreSQL. `runs`, `orders`, `agent_versions`, `agents` — all four already exist.
**No migration in this feature.**

**Testing**: None. Automated tests of every kind are out of scope for this component
(`docs/CONTEXT.md`). Acceptance is by hand, via [quickstart.md](./quickstart.md), and the demo
rehearsal is the test suite.

**Target Platform**: Single Linux container, one process. Single-process is an assumption the
claim query does not rely on — it is safe under multiple processes too — but the poller's
concurrency limit is per-process and would need revisiting before a second replica.

**Project Type**: Backend web service; this feature is the one part of it with no route.

**Performance Goals**: Demo scale. One run in flight at a time, a poll every
`EXECUTION_POLL_INTERVAL_MS` (default 1000). A seller agent's own run is a single non-streaming
model call — seconds, dominated by the model. Pickup latency of up to one poll interval is
acceptable because the buyer's screen polls the order anyway.

**Constraints**: Every run is bounded by the pinned definition's `timeout_seconds` (default 120).
Exactly one run record per order, enforced by `UNIQUE (order_id)`. No retry at any layer,
including the SDK's own (R5). No streaming — a structured output has nothing to render
incrementally.

**Scale/Scope**: ~11 new files in one module, ~4 edited files elsewhere, three seeded demo agents
downstream. Three orders per rehearsal.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

`.specify/memory/constitution.md` is the **unmodified Spec Kit template** — no principles have
been ratified, so there are no constitution gates to evaluate and none are asserted here.

The binding constraints for this component are `docs/CONTEXT.md`'s nine invariants and its module
map. Those are checked instead, since they are what a reviewer will actually hold this feature to.

| Constraint | Applies here? | How this design satisfies it |
| --- | --- | --- |
| #1 Two-phase money ordering | No | This feature moves no money and writes no ledger entry. `markDelivered` transfers nothing; it starts a clock. |
| #2 One money unit (USD cents) | Trivially | Execution touches no amount at all. The only chain call takes a deal id. |
| #3 `system_prompt` never reaches a buyer | **Yes** | Execution *must* read it and *must* record the model's prose beside it (FR-015). The boundary is API-06's serialiser on the way out, which API-07 already extended to summarise `reasoning`. This feature adds no buyer-facing response, so it adds no new place for the column to leak — but it does add a new writer of prose into `runs.steps`, which is why R7 pins the step shape rather than inventing one. |
| #4 Ledger append-only | No | No ledger writes. |
| #5 Settlement writes no ledger entry | No | No settlement here. |
| #6 Orders point at `agent_version_id` | **Yes** | The whole of FR-005/6. The load query joins `orders.agent_version_id`, never `agents` → latest version. R8. |
| #7 `runs.output IS NULL` is evidence | **Yes** | The feature that produces it. FR-022–026; no retry path exists to overwrite it, and the `UNIQUE` makes that structural. |
| #8 Verdict persisted before the chain call | No | Verdicts are API-09. |
| #9 `orders.state` is the queue | **Yes** | R1 and R2: the poller's only input is a state predicate, and the claim is a state transition. No Redis, no BullMQ, no broker. |
| §3 `execution` must not import `guardian` | **Yes** | Nothing in `src/execution/` imports `src/guardian/` — which does not exist yet, so the rule is cheap to keep and easy to break later. Direction is one-way by construction: execution writes `runs`, API-09 reads it. |
| Tests out of scope | **Yes** | No test files are produced. `quickstart.md` is a manual script. |

**Result: pass, with one thing to watch.** #3 is the constraint this feature is most able to
break, not through a response body but through a log line — `agent_versions.system_prompt` and
the model's own prose both pass through this module, and `order.repository.ts` already argues
that not fetching a column is the only layer that also protects a stack trace. R7 carries that
rule forward: the runner never logs the prompt or the raw model text, and errors surfaced to logs
carry the order id rather than the payload.

*Post-design re-check (after Phase 1): unchanged. The design adds no buyer-facing surface, no
ledger write, and no import of a module that does not exist. The one addition worth restating is
that `runs.steps` now has a producer as well as consumers, and its shape is fixed by a type that
Phase 1 moves next to the entity so both sides compile against the same declaration.*

## Project Structure

### Documentation (this feature)

```text
specs/008-execution-engine/
├── plan.md              # This file
├── research.md          # Phase 0 output — the eight decisions
├── data-model.md        # Phase 1 output — the run record and the state moves
├── quickstart.md        # Phase 1 output — manual validation, act by act
├── contracts/           # Phase 1 output — three internal contracts, no HTTP
│   ├── agent-runner.md
│   ├── demo-script-registry.md
│   └── run-record.md
├── checklists/
│   └── requirements.md
└── tasks.md             # Phase 2 output (/speckit-tasks — NOT created here)
```

### Source Code (repository root)

```text
api/src/
├── execution/                       # NEW — the whole feature
│   ├── execution.module.ts          # wires the poller, the service, the two runners
│   ├── execution.constants.ts       # max output tokens, poll concurrency, step labels
│   ├── execution.errors.ts          # AgentRunFailedError, AgentTimeoutError, DefinitionUnusableError
│   ├── execution.repository.ts      # claim-one, load pinned definition, open/close the run row
│   ├── execution.service.ts         # the pipeline: claim → run → record → deliver | fail
│   ├── execution.poller.ts          # the only trigger; a serialised setInterval loop
│   ├── agent-runner.ts              # the port: AgentRunner, AgentRunRequest, AgentRunOutcome
│   ├── claude-agent-runner.ts       # the real one — @anthropic-ai/sdk, structured outputs
│   ├── scripted-agent-runner.ts     # deterministic demo mode; delegates when unscripted
│   ├── demo-script.registry.ts      # the seam API-11 fills; ships empty
│   └── run-trace.ts                 # composes ExecutionStep[] from what the runner reports
│
├── entities/
│   └── execution-step.ts            # NEW — ExecutionStep moved here, beside run.entity.ts
│
├── orders/dto/case-file.dto.ts      # EDIT — re-export ExecutionStep from its new home
├── config/env.schema.ts             # EDIT — + EXECUTION_POLL_INTERVAL_MS
└── app.module.ts                    # EDIT — + ExecutionModule

api/package.json                     # EDIT — + @anthropic-ai/sdk
```

**Structure Decision**: A new top-level module under `src/`, matching every other module in the
map (`docs/CONTEXT.md` §3 names `execution` as its own module and pairs it with the rule that it
and `guardian` must not import each other). It owns no entity file of its own — `Run` already
lives in `src/entities/` with the other seven — and it registers no controller, because nothing
calls it over HTTP.

**Why `ExecutionStep` moves.** It is declared today in `src/orders/dto/case-file.dto.ts`, where
API-07 put it because API-07 was the only thing that read it. This feature is the thing that
*writes* it, and `case-file.service.ts` already casts `runs.steps` to it with an assertion its own
comment calls unchecked. Leaving the declaration in a sibling module's DTO folder would mean the
producer imports from a consumer's DTO — the wrong direction, and the kind of import that gets
"cleaned up" into a duplicate type six weeks later. Moving it to `src/entities/execution-step.ts`
puts it beside the column it describes; the re-export from `case-file.dto.ts` keeps every existing
import compiling, so this is a two-line change rather than a refactor.

## Complexity Tracking

> No constitution gates exist to violate. Three choices are more than the minimum and are
> justified here rather than in research, because each is the kind of thing a reviewer should be
> able to challenge in one line.

| Choice | Why needed | Simpler alternative rejected because |
| --- | --- | --- |
| A runner **port** with two implementations, rather than an `if (isDemo)` inside one service | The scripted path must not be able to skip the recording, the conformance check, or the state moves — the demo's credibility rests on `output IS NULL` arriving through the real path (API-11's brief says so explicitly) | A branch inside the service puts the demo shortcut *upstream* of the evidence, which is precisely the shortcut API-11 warns against. The port makes the substitution physically incapable of reaching the record. |
| A **poller** rather than an in-process call from `PurchaseService` | API-07 R13 rejected a dispatcher seam and left the state as the queue; a poller also recovers an order whose purchase answered a moment before the process died | A direct call is lower-latency but re-introduces the seam 007 declined, couples orders to execution, and silently drops any order placed during a restart. The poller subsumes it. |
| A **new env key** for the poll interval | `SWEEPER_INTERVAL_MS` sets the precedent that demo-visible cadences are tunable without a rebuild, and rehearsal wants 1s while a real deployment does not | A constant would need a code change to slow down, and the same argument that produced `SWEEPER_INTERVAL_MS` applies unchanged. |
