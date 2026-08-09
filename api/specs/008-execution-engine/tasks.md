---

description: "Task list for 008-execution-engine"
---

# Tasks: The Execution Engine — the wrapped workspace

**Input**: Design documents from `/specs/008-execution-engine/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/](./contracts/)

**Tests**: **No test tasks.** Automated tests of every kind are out of scope for `api/` — a
time-boxed MVP decision recorded in `docs/CONTEXT.md`. Every acceptance criterion is verified by
hand through [quickstart.md](./quickstart.md), and the verification tasks below name the section
that discharges each story.

**Organization**: Tasks are grouped by user story. The stories here are **branches of one
pipeline** rather than independent features — US1 builds the pipeline and leaves every order in
`running`; US2 and US3 add its two exits; US4–US6 add guarantees over the top. Each is still a
complete, separately verifiable increment, and the checkpoints say exactly what works after each
one.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: US1–US6, mapping to the user stories in [spec.md](./spec.md)
- All paths are relative to `api/`

## Path Conventions

Backend service, single project. New code lands in `api/src/execution/`; four files elsewhere are
edited. **No migration** — `runs`, `orders.input` and `agent_versions` all already exist.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: The dependency, the config key, and an empty module Nest will boot.

- [X] T001 Add `@anthropic-ai/sdk` to `dependencies` in `package.json` and install it — the only dependency this feature adds (plan.md, Technical Context)
- [X] T002 Add `EXECUTION_POLL_INTERVAL_MS` to the TUNING block of `src/config/env.schema.ts`, mirroring `SWEEPER_INTERVAL_MS` (`z.coerce.number().int().positive()`) with a default of `1000`
- [X] T003 Create `src/execution/execution.module.ts` as an empty `@Module({})` and register it in the imports array of `src/app.module.ts`, with a doc-comment stating that this module registers no controller because nothing calls it over HTTP

**Checkpoint**: The process boots with the module loaded and does nothing.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The declarations every story compiles against. Nothing here has behaviour.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [X] T004 Move the `ExecutionStep` interface from `src/orders/dto/case-file.dto.ts` into a new `src/entities/execution-step.ts`, beside `run.entity.ts`, preserving every doc-comment verbatim — especially the ⚠️ warnings on `label` (crosses to a buyer untouched) and `reasoning` (model prose, seller only)
- [X] T005 Re-export `ExecutionStep` from `src/orders/dto/case-file.dto.ts` so every existing import keeps compiling, with a one-line comment saying the declaration moved because this feature is its writer (research R7)
- [X] T006 [P] Create `src/execution/execution.errors.ts` with `AgentTimeoutError`, `AgentRunFailedError` and `DefinitionUnusableError`, following the shape of `src/orders/orders.errors.ts` — each carrying the order id and a cause, and each documented with the run-record outcome it produces (contracts/agent-runner.md)
- [X] T007 [P] Create `src/execution/execution.constants.ts` with `AGENT_MAX_OUTPUT_TOKENS = 8192` and the step labels (`output`, `model_error`, `timeout`, `definition_unusable`), each with the rationale from research R5 and R7
- [X] T008 [P] Create `src/execution/agent-runner.ts` declaring `AgentRunRequest`, `AgentRunOutcome` and the abstract `AgentRunner` class exactly as specified in [contracts/agent-runner.md](./contracts/agent-runner.md), including the ⚠️ never-logged notes on `systemPrompt` and `assistantText`

**Checkpoint**: Types exist, nothing runs. `npm run build` is clean and no existing import broke.

---

## Phase 3: User Story 1 — The platform runs the agent and keeps the receipts (Priority: P1) 🎯 MVP

**Goal**: An order in `purchased` with a deal id is claimed, the pinned definition is loaded, the
agent runs, and exactly one complete run record exists afterwards. The order is left in `running` —
its two exits are US2 and US3.

**Independent Test**: Purchase an agent, confirm the order moves to `running` within one poll
interval and that exactly one `runs` row exists carrying the input, a trace, timings and either an
output or an error. Force a second attempt and confirm it is impossible. Quickstart §2, §6, §7.

### Implementation for User Story 1

- [X] T009 [US1] Create `src/execution/execution.repository.ts` with `claimNext()` — the single conditional `UPDATE orders SET state='running' WHERE id = (SELECT … WHERE state='purchased' AND onchain_deal_id IS NOT NULL ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED) RETURNING id, agent_version_id, onchain_deal_id, input`, returning `null` on zero rows (research R2; FR-002, FR-003, FR-004)
- [X] T010 [US1] Add `loadPinnedDefinition(agentVersionId)` to `src/execution/execution.repository.ts`, selecting `system_prompt`, `model`, `output_schema`, `timeout_seconds` and `definition_hash` from `agent_versions` **by id**, never by resolving the agent's latest version — with a doc-comment stating why this is the one query in the codebase that fetches `system_prompt` and why it lives in a module with no controller (research R8; FR-005, FR-006)
- [X] T011 [US1] Add `openRun(orderId, input)` and `closeRun(runId, patch)` to `src/execution/execution.repository.ts` — the insert sets `order_id`, `input`, `started_at`; the update sets `steps`, `output`, `error`, `output_valid`, `finished_at`, `duration_ms`. `openRun` must surface a unique-violation as a distinguishable result rather than a raw driver error (data-model.md §1; FR-012, FR-013)
- [X] T012 [P] [US1] Create `src/execution/run-trace.ts` composing the success trace — a `model_turn` step (label = the model id, `reasoning` = the runner's `assistantText`, own `durationMs` and `startedAt`) followed by an `output` step — returning `ExecutionStep[]` (data-model.md §2)
- [X] T013 [P] [US1] Create `src/execution/claude-agent-runner.ts` implementing `AgentRunner` with one non-streaming `messages.create`: `model`, `system` and the output-schema constraint from the request, `max_tokens` from the constant, and request options `{ timeout, signal, maxRetries: 0 }`. **Send no `thinking`, no `effort`, no sampling parameters** — each would 400 on a model a seller may legitimately name (research R5; contracts/agent-runner.md)
- [X] T014 [US1] Create `src/execution/execution.service.ts` with the pipeline claim → load → open → run → close, in that order, leaving `orders.state` untouched after the claim. A unique-violation from `openRun` returns immediately without touching the order and **without calling the model** (contracts/run-record.md; FR-012)
- [X] T015 [US1] Create `src/execution/execution.poller.ts` — a `setInterval` started in `onApplicationBootstrap` and cleared in `onModuleDestroy`, running one claim-and-execute cycle at a time behind a re-entrancy guard, at `EXECUTION_POLL_INTERVAL_MS`. It logs once at startup and stays silent on empty ticks (research R1)
- [X] T016 [US1] Wire `ExecutionRepository`, `ClaudeAgentRunner` (as the `AgentRunner` provider for now), `ExecutionService` and `ExecutionPoller` into `src/execution/execution.module.ts`, importing `TypeOrmModule.forFeature([Run])` and `ChainModule`
- [X] T017 [US1] Establish the logging discipline across `src/execution/claude-agent-runner.ts` and `src/execution/execution.service.ts`: every line carries the order id, the version id, the model, the duration and the failure kind — and **never** the system prompt, the request body, the response body or `assistantText`. Invariant #3's boundary is a serialiser on the way out; a log line goes around it (research R7)
- [ ] T018 [US1] Verify with [quickstart.md](./quickstart.md) §1, §2, §6, §6a and §7 — poller quiet and shutting down cleanly, the claim opening a record with the input copied, the run un-repeatable, two claimants producing one winner, and neither an ineligible nor an unconfirmed order ever picked up

**Checkpoint**: A purchase runs an agent and produces one complete, permanent record. Every order
ends up parked in `running` — expected, and fixed by the next two phases.

---

## Phase 4: User Story 2 — A successful run delivers (Priority: P1)

**Goal**: A run that produced an output announces the delivery on-chain and moves the order to
`delivered`, opening the buyer's review window.

**Independent Test**: Purchase from a working agent and confirm the order reaches `delivered`, the
escrow contract agrees, and the run record carries a non-empty output with a finish time and a
duration. Quickstart §3, §3a.

**Depends on**: US1 (the pipeline it attaches an exit to).

### Implementation for User Story 2

- [X] T019 [US2] Add the success branch to `src/execution/execution.service.ts`: after `closeRun` succeeds, call `EscrowOperatorService.markDelivered(dealId)`, and only on confirmation move the order to `delivered`. The record write must precede the chain call, and a comment must say why this is *not* invariant #1's money ordering — nothing moves here (research R6; FR-018, FR-019)
- [X] T020 [US2] Add `markDelivered(orderId)` to `src/execution/execution.repository.ts` performing the `purchased`-free transition `UPDATE orders SET state='delivered' WHERE id = $1 AND state='running'`, so a concurrently-reaped order is not resurrected
- [X] T021 [US2] Handle the three chain outcomes in `src/execution/execution.service.ts`: `ContractRevertError`, `ChainConnectivityError` and `ChainOutcomeUnknownError` all leave the order in `running` with the run record untouched, log at `error` with the order id and any transaction hash, and **never re-run the agent**. Document the two existing recoveries — the reaper and the complaint path — so the resting state does not read as abandoned (research R6; FR-020, FR-021)
- [ ] T022 [US2] Verify with [quickstart.md](./quickstart.md) §3 and §3a — the order reaches `delivered`, the contract agrees, the review window is running, the closed-run log line precedes the `markDelivered` line, and a version republished mid-run changes nothing about what ran

**Checkpoint**: The happy path is complete end to end. Act 1 of the demo is reachable.

---

## Phase 5: User Story 3 — A crash or a timeout is proven (Priority: P1)

**Goal**: A crash, an unreachable model or a run past its declared limit lands as `failed` with an
empty output — the evidence Act 3 depends on.

**Independent Test**: Purchase from a deliberately failing agent and confirm `failed`, an empty
`output`, a recorded `error`, no `markDelivered` on the deal, and no second run record ever.
Quickstart §4, §4a, §4b.

**Depends on**: US1. Independent of US2 — the two exits do not touch each other.

### Implementation for User Story 3

- [X] T023 [US3] Add the failure branch to `src/execution/execution.service.ts`: catch the three error types, close the run with `error` and the timings while leaving `output` and `output_valid` NULL, and move the order to `failed`. **No chain call on this path at all** — telling the contract a deal was delivered would make it releasable to a seller who delivered nothing (FR-022, FR-024)
- [X] T024 [US3] Add `markFailed(orderId)` to `src/execution/execution.repository.ts`, conditional on `state='running'` for the same reason as T020
- [X] T025 [US3] Enforce the deadline in `src/execution/claude-agent-runner.ts` with an `AbortController` armed for `timeoutMs` alongside the SDK's own `timeout`, throwing `AgentTimeoutError` naming the seconds from the definition. **Whatever the model had produced is discarded** — a partial answer the buyer never received is not a delivery (FR-010, FR-026)
- [X] T026 [US3] Treat any unexpected throw escaping a runner as `AgentRunFailedError` in `src/execution/execution.service.ts`, so no run can end without a record — a run that dies unrecorded is the one outcome with no evidence at all (contracts/agent-runner.md)
- [X] T027 [P] [US3] Extend `src/execution/run-trace.ts` with the failure traces — `model_turn` carrying its own `error` followed by an `error` step, and a lone `error` step for an unusable definition — so an attempt that produced nothing still records that it was made (FR-016; data-model.md §2)
- [X] T028 [US3] Add a guard in `src/execution/execution.repository.ts`'s `closeRun` that refuses to write `{}`, `""` or any stand-in into `output`, with a comment naming invariant #7 — NULL is the claim, and the entity comment already says so (FR-023)
- [ ] T029 [US3] Verify with [quickstart.md](./quickstart.md) §4, §4a and §4b — `output` NULL rather than empty, the deal still `Open` on-chain, a two-step trace, a timeout landing within a second or two of the declared limit, and a complaint against the failed order reaching `disputed`

**Checkpoint**: Both exits work. All three demo acts are reachable through real code paths.

---

## Phase 6: User Story 4 — The trace, not just the answer (Priority: P2)

**Goal**: The recorded trace carries enough to separate "genuinely tried" from "returned a stub",
and none of it leaks to a buyer.

**Independent Test**: Run an agent and confirm the trace has more than the final answer in it. Set
the system prompt to a marker and confirm it appears in the seller's case file and in neither the
buyer's copy nor any log line. Quickstart §8.

**Depends on**: US1 and US3 (both write traces).

### Implementation for User Story 4

- [X] T030 [US4] Complete per-step capture in `src/execution/run-trace.ts` — `durationMs` and `startedAt` on every step, `reasoning` on the model turn only, and the step's own `error` where it failed — so a slow or failing phase is identifiable without re-running anything (FR-014)
- [X] T031 [US4] Add a `label` discipline check to `src/execution/run-trace.ts`: every value written to `label` is a literal from `execution.constants.ts` or the model id, never model output and never a fragment of the prompt. It is the one text field a buyer sees verbatim, and the DTO says so (data-model.md §2)
- [X] T032 [US4] Confirm nothing in `src/execution/execution.repository.ts` or `src/execution/run-trace.ts` truncates, summarises or size-caps `steps`, `error` or `output` — Postgres TOASTs the column and the schema imposes no ceiling (FR-017)
- [ ] T033 [US4] Verify with [quickstart.md](./quickstart.md) §8 — a marker prompt appearing zero times in the log and in both buyer-facing responses, at least once in the seller's case file, and no step `label` carrying a sentence

**Checkpoint**: The evidence is complete on the way in and filtered on the way out, and the filter
is demonstrably still working now that something writes prose into `steps`.

---

## Phase 7: User Story 5 — Schema conformance (Priority: P2)

**Goal**: Every run that produced an output records whether that output satisfies its own declared
contract, so the auditor is handed a fact rather than an argument.

**Independent Test**: Run one agent whose output satisfies its schema and one whose output does
not; confirm `output_valid` is correct on both and that **both** orders reached `delivered`.
Quickstart §5.

**Depends on**: US1 and US2.

### Implementation for User Story 5

- [X] T034 [US5] Call `validateAgainstSchema(outputSchema, output)` from `src/catalog/schema-validation.ts` in `src/execution/execution.service.ts`'s success branch and record the result on `output_valid` — the existing function, unchanged, already on the 2020-12 dialect for exactly this caller (FR-027)
- [X] T035 [US5] Leave `output_valid` NULL in `src/execution/execution.service.ts` when there is no output, never `false` — there was nothing to check, and the empty output already carries that meaning (FR-028; data-model.md §5)
- [X] T036 [US5] Keep a non-conforming output exactly as returned in `src/execution/execution.service.ts` and still move the order to `delivered`, with a comment stating that conformance is a fact for the auditor and not a second definition of non-delivery (FR-029)
- [X] T037 [US5] Wrap the conformance call in `src/execution/execution.service.ts` so that a throw from the checker leaves `output_valid` NULL and logs at `error` **without** converting a completed delivery into a non-delivery (FR-030)
- [X] T038 [US5] Map a structured-output rejection of the schema itself to `DefinitionUnusableError` in `src/execution/claude-agent-runner.ts`, naming the field — Ajv is more permissive than the API, so a seller schema can pass listing and be refused at run time (research R5; FR-007)
- [ ] T039 [US5] Verify with [quickstart.md](./quickstart.md) §5 — both conformance answers recorded, both orders `delivered`, and `output_valid` never `false` on a row whose output is NULL

**Checkpoint**: Every completed run answers the conformance question, and no answer can turn a
delivery into a non-delivery.

---

## Phase 8: User Story 6 — The seeded agents fail on cue (Priority: P3)

**Goal**: The mechanism that makes a seeded run deterministic, shipped empty. The fixtures
themselves belong to the demo-seed work.

**Independent Test**: With no entries registered, confirm every run is live and nothing changes.
After the demo-seed work registers fixtures, run the three acts twice and diff. Quickstart §10.

**Depends on**: US1 (the port it substitutes at) and US3 (the failure path a scripted crash
travels).

### Implementation for User Story 6

- [X] T040 [P] [US6] Create `src/execution/demo-script.registry.ts` with `DemoScript`, `DemoScriptEntry`, `register()`, `lookup()` and `size`, keyed on `sha256(definitionHash) ‖ sha256(canonicalJson(input))`, throwing at registration on a duplicate key rather than at run time ([contracts/demo-script-registry.md](./contracts/demo-script-registry.md))
- [X] T041 [US6] Create `src/execution/scripted-agent-runner.ts` extending `AgentRunner`, consulting the registry and delegating to `ClaudeAgentRunner` on a miss. A `{ kind: 'failure' }` entry throws the **same** `AgentRunFailedError` a real crash throws, so it travels the ordinary failure path (research R4; FR-031, FR-032, FR-033)
- [X] T042 [US6] Swap the `AgentRunner` provider in `src/execution/execution.module.ts` to `ScriptedAgentRunner` and export `DemoScriptRegistry`, so the demo-seed work can import the module and register three entries. `ExecutionService` must remain unable to tell which implementation it got (FR-034)
- [X] T043 [US6] Verify with [quickstart.md](./quickstart.md) §10 — an empty registry changing nothing and every run live. The three-acts-twice diff waits on the demo-seed work

**Checkpoint**: The mechanism is in place and inert. The demo-seed work can fill it.

---

## Phase 9: Polish & Cross-Cutting Concerns

- [X] T044 [P] Write `scripts/verify-008.mjs` following the shape of `scripts/verify-007.mjs`, driving a purchase through to `delivered` and asserting the run record's shape, so the load-bearing quickstart checks are repeatable at 3am
- [X] T045 [P] Write `scripts/verify-008-failure.mjs` forcing the crash path and asserting `output IS NULL`, `state='failed'`, and that the deal was never marked delivered on-chain — the check that cannot be reached by using the product normally
- [X] T046 [P] Update the module table in `docs/CONTEXT.md` §3 if `execution`'s one-line description no longer matches what was built, and note in `docs/specs.md` that API-08 owns the deterministic-demo mechanism while API-11 owns the fixtures
- [X] T047 Re-read `src/execution/` for invariant #3: no log line, error message or stack trace can carry `system_prompt` or model prose. This is the one constraint this feature is most able to break and the only layer that protects it is not fetching or not printing
- [ ] T048 Run the full [quickstart.md](./quickstart.md) top to bottom, including §9's restart-mid-run check, and record the four ★ load-bearing results

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: no dependencies
- **Foundational (Phase 2)**: needs Setup — blocks every story
- **US1 (Phase 3)**: needs Foundational. **Blocks every other story** — it is the pipeline the rest attach to
- **US2 (Phase 4)** and **US3 (Phase 5)**: both need US1, and are independent of each other. Two people can take one exit each
- **US4 (Phase 6)**: needs US1 and US3 (it completes traces both of them write)
- **US5 (Phase 7)**: needs US1 and US2 (conformance is recorded on the success branch)
- **US6 (Phase 8)**: needs US1 and US3 (a scripted crash must have a failure path to travel)
- **Polish (Phase 9)**: needs everything

```text
Setup → Foundational → US1 ─┬─ US2 ─┬─ US5 ─┐
                            │       │       ├─ Polish
                            └─ US3 ─┴─ US4 ─┤
                                    └─ US6 ─┘
```

### Why the stories are not independent here

The template's usual promise — any story can be built first — does not hold for this feature and
pretending otherwise would produce a misleading plan. US1 is a pipeline with no exit; US2 and US3
are its two exits; US4, US5 and US6 are guarantees layered over the top. What *is* true is that
each phase is separately **verifiable**, and the checkpoints say what works after each.

### Within each story

Repository before service; runner before the service that calls it; service before the poller that
drives it; verification last.

### Parallel Opportunities

- **Phase 2**: T006, T007, T008 — three new files, no shared symbols
- **Phase 3**: T012 and T013 — the trace composer and the Claude runner touch nothing in common; both must land before T014
- **Phases 4 and 5**: the two exits are disjoint code paths in the same service. One file, so coordinate the edit, but the work does not overlap
- **Phase 9**: T044, T045 and T046 are three separate files

---

## Parallel Example: User Story 1

```bash
# After T009–T011 (the repository) land, these two are independent:
Task: "Create src/execution/run-trace.ts composing the success trace"
Task: "Create src/execution/claude-agent-runner.ts with one non-streaming messages.create"

# Both must complete before:
Task: "Create src/execution/execution.service.ts with the claim → load → open → run → close pipeline"
```

---

## Implementation Strategy

### MVP scope

**US1 + US2 + US3.** All three are P1 and the feature is not demonstrable without all three: US1
alone parks every order in `running`, and either exit alone covers half the demo. The stopping
point with real value is the end of Phase 5 — at which point all three acts are reachable through
real code paths, which is precisely what `docs/specs/API-11-demo-seed.md` demands of Act 3.

1. Phases 1–2 (setup and declarations)
2. Phase 3 — **stop and validate** with quickstart §2, §6, §7
3. Phase 4 — **stop and validate** with §3
4. Phase 5 — **stop and validate** with §4. This is the MVP
5. Phases 6–8 in priority order
6. Phase 9

### Incremental delivery

| After | What works |
| --- | --- |
| Phase 3 | One permanent record per purchase; orders park in `running` |
| Phase 4 | The happy path end to end; Act 1 reachable |
| Phase 5 | Both exits; **all three acts reachable** ← MVP |
| Phase 6 | The trace is complete and the disclosure boundary is re-verified |
| Phase 7 | Conformance recorded; the auditor gets a fact rather than an argument |
| Phase 8 | The demo is repeatable once the fixtures are registered |

### Parallel team strategy

One developer takes Phases 1–3 alone — nothing else can start until the pipeline exists. After
that, US2 and US3 split cleanly between two people (coordinate on `execution.service.ts`), and US6
can start alongside them as soon as US3's failure path is merged.

---

## Notes

- **No test tasks by design.** `docs/CONTEXT.md` puts automated tests out of scope for this
  component; quickstart.md is the suite and a failed rehearsal is a red build
- **No migration.** If a task appears to need one, something has been misread — `runs` has all
  nine columns, the `UNIQUE (order_id)`, and the nullable `output` already
- **The `UNIQUE (order_id)` is the no-retry guarantee.** Never add a delete, an upsert or a
  cleanup path to `runs`; if the constraint ever fires in production, two runs were already in
  flight and one wasted a model call
- **`output` is NULL or a real output.** Never `{}`, never a placeholder string. Invariant #7
- Commit after each task or logical group; stop at any checkpoint to validate


---

## Verification run — 2026-08-09

Run against the dev stack with the poller live. **A real defect was found and fixed
during this run** (see below), so the recorded results are from the fixed build.

### The defect the run caught

`ExecutionRepository.claimNext` read `manager.query()`'s result as a rows array.
TypeORM returns bare rows for a `SELECT` but the tuple `[rows, affectedCount]` for an
`UPDATE … RETURNING` — so every claim produced `orderId: undefined`, and the failure
surfaced far downstream as a not-null violation on `runs.order_id`. Fixed by
destructuring, with a comment at the site. **A typecheck cannot catch this** (the cast
asserted the wrong shape) and only running it did.

Blast radius while broken: 13 orders moved `purchased → running` with no run row, no
model call and no chain call. All 13 were restored to `purchased` before the re-run.

### What passed

| Quickstart | Check | Result |
| --- | --- | --- |
| §1 | Poller starts, logs once, silent on empty ticks, clean shutdown | ✅ |
| §2 | Claim opens a record; `runs.input` = `orders.input` | ✅ |
| §3 ★ | Success → output written → `markDelivered` on-chain → `delivered`; record written **before** the chain call | ✅ (tx `0xcd29ba…`, 2393 ms, `output_valid = true`, 2 steps) |
| §4 ★ | Crash → `output` SQL NULL (not `{}`), `output_valid` NULL, `error` set, 2-step trace, **no chain call** | ✅ across 13 orders |
| §5 | Conformance recorded — `true` on the delivered run, NULL on all 13 non-deliveries | ✅ (the `false` case was not forced) |
| §6 ★ | Run cannot be repeated — second attempt hit the UNIQUE backstop, abandoned **without a model call**, record unchanged | ✅ |
| §8 ★ | A canary system prompt appears **zero** times across every log from the session, and `steps[].reasoning` is null | ✅ |
| §10 | Empty registry → every run live, no script fired | ✅ |

### What remains

- **§3a** — republish a version mid-run and confirm the pinned one still ran.
- **§4a** — timeout (`timeout_seconds = 1`); `scripts/verify-008-failure.mjs --timeout` does this.
- **§4b** — complain against a failed order and confirm it reaches `disputed`.
- **§6a** — two processes racing one order.
- **§7** — an unconfirmed purchase (`purchased` + NULL deal id) is never claimed; no such row existed to test against.
- **§8, buyer half** — the canary's absence from `GET /orders/:id` and the buyer's case file. That is API-07's boundary and its own quickstart covers it; the buyer token from this run was not retained.
- **§9** — kill mid-run and confirm a legible open row.

### ⚠️ Finding for API-11: every seeded output schema is refused at run time

All 13 pre-existing orders failed identically with `DefinitionUnusableError`. The
Anthropic API rejects the stored schemas:

> `output_config.format.schema: For 'object' type, 'additionalProperties' must be explicitly set to false`

Confirmed by testing both variants directly: as stored → 400; with
`additionalProperties: false` added → accepted. This is exactly what research
[R5](./research.md) predicted — **Ajv is more permissive than structured outputs**, so a
seller schema passes listing and is refused at run time. The engine handled it correctly
(FR-007: a recorded run failure naming the definition, through the ordinary failure
path), but **Act 2 will fail for a reason that has nothing to do with line items** until
every demo agent's `output_schema` sets `additionalProperties: false` on each object.

The happy path was verified with a purpose-built agent carrying a compliant schema.
