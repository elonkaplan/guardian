---
description: "Task list for 009-guardian-audit-engine"
---

# Tasks: The Guardian audit engine — the cited verdict

**Input**: Design documents from `/specs/009-guardian-audit-engine/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/](./contracts/)

**Tests**: **No test tasks.** Automated tests of every kind are out of scope for `api/`
(`docs/CONTEXT.md`). [quickstart.md](./quickstart.md) is the suite and a failed rehearsal is a
red build.

**Organization**: Tasks are grouped by user story so each can be implemented and demonstrated
independently.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: Which user story this task serves (US1–US5)
- Every task names an exact file path

## Path Conventions

Single NestJS project rooted at `api/`. All paths below are relative to `api/`.

---

## ⚠️ Read before starting

Five things about this feature are easy to get wrong and expensive to get wrong. Each is a task
below, and each is here because a reviewer will check it:

1. **`verdicts.order_id` is UNIQUE and that constraint is the product rule** ("no appeals"). Never
   add a delete, an upsert, or a cleanup path to `verdicts`.
2. **The verdict row commits BEFORE the chain call** (invariant #8). This is `purchase.service.ts`'s
   transaction shape, not `settlement.service.ts`'s, and here it is mandated rather than chosen.
3. **Guardian sees the seller's `system_prompt` and the raw trace** (`agent-definition.md` §4).
   The containment is a check on the ruling before it is stored (T041), not exclusion at the input.
   This is the only requirement in the feature enforced by a runtime check on model output.
4. **No sampling parameters.** `temperature` / `top_p` / `top_k` all return **400** on Opus 5.
5. **Nothing writes `verdicts` except the one persist path.** No fixture, no config, no failure
   branch (FR-041, SC-013).

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Module scaffold, configuration, and the one migration. Nothing here calls a model or
a chain.

- [X] T001 Create the module directory `src/guardian/` with an empty `src/guardian/dto/` subdirectory
- [X] T002 [P] Add `GUARDIAN_POLL_INTERVAL_MS` (coerced int, default `2000`) and `GUARDIAN_AUDIT_TIMEOUT_MS` (coerced int, default `180000`) to the Zod schema in `src/config/env.schema.ts`, following the existing `EXECUTION_POLL_INTERVAL_MS` entry's shape and comment style
- [X] T003 [P] Create `src/guardian/guardian.constants.ts` exporting `GUARDIAN_MODEL = 'claude-opus-5'`, `GUARDIAN_MAX_OUTPUT_TOKENS`, `GUARDIAN_MAX_AUDIT_ATTEMPTS = 3`, `LEAK_RUN_WORDS = 8`, and `REFUND_BPS` — each with a doc-comment saying why it is a constant and not a catalogue field or env key, mirroring `src/execution/execution.constants.ts`
- [X] T004 Add `auditAttempts` (`smallint`, NOT NULL, default `0`) and `auditFailedAt` (`timestamptz`, nullable) columns to `src/entities/order.entity.ts`, with doc-comments stating that only `src/guardian/` may write them and that they are about the audit, not the complaint (data-model.md §7)
- [X] T005 Generate and hand-review the migration in `src/migrations/` adding those two columns to `orders` — confirm it contains **only** those two `ADD COLUMN` statements and no incidental drift from entity/schema divergence
- [X] T006 Run `npm run migration:run` against the dev stack and confirm both columns exist with the right defaults via `\d orders`

**Checkpoint**: The app boots, the two env keys are required, and `orders` has the two new columns.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The types, errors, port, and repository every user story needs. **No user story work
can begin until this phase is complete.**

- [X] T007 [P] Create `src/guardian/guardian.errors.ts` with an abstract `AuditFailedError` base carrying `orderId` and a typed `reason` discriminant, plus one subclass per gate (`AuditorRefusedError`, `AuditorTruncatedError`, `UnusableVerdictError`, `UntraceableCitationError`, `NonDeliveryFloorError`, `PromptLeakError`, `AuditTimeoutError`, `AuditorUnavailableError`) — each taking identifying fields as typed properties so no message string ever has to carry case-file text (the rule `src/execution/execution.errors.ts` states and the reason it gives)
- [X] T008 [P] Add the ⚠️ header doc-comment to `src/guardian/guardian.errors.ts` recording that **audit-path errors are never mapped to an HTTP status** — this module has a controller, but no route is downstream of the audit pipeline, so an `HttpException` mapping for these is not missing and does not belong (the read path's errors are separate, T046)
- [X] T009 [P] Create the `GuardianCaseFile` and `AuditStep` interfaces in `src/guardian/case-file-assembler.ts` exactly as specified in [contracts/guardian-case-file.md](./contracts/guardian-case-file.md) §1, importing `ExecutionStep` from `src/entities/execution-step.ts` rather than redeclaring it, and including the ⚠️ notes on `systemPrompt` (§3) and `steps` (§4)
- [X] T010 [P] Create the abstract `Auditor` port in `src/guardian/auditor.ts` declaring `AuditRequest`, `AuditOutcome`, and one `audit()` method, mirroring `src/execution/agent-runner.ts` — including the ⚠️ never-logged note on the case file and the returned reasoning
- [X] T011 Create `src/guardian/guardian.repository.ts` injecting `Repository<Verdict>` and issuing its own query-builder reads against `orders`, `agent_versions`, `agents`, `runs`, and `complaints` — with the header doc-comment explaining that this is the **second** query in the codebase to select `system_prompt`, why it must (agent-definition §4), and that the module has no controller returning anything built from it (contracts/guardian-case-file.md §7)
- [X] T012 Implement `claimAuditPending()` in `src/guardian/guardian.repository.ts` — a `SELECT` with predicate `state = 'disputed' AND onchain_deal_id IS NOT NULL AND audit_attempts < 3 AND NOT EXISTS (SELECT 1 FROM verdicts WHERE order_id = o.id)`, returning the full case-file row in one join (research R1, R14)
- [X] T013 Implement `claimSettlePending()` in `src/guardian/guardian.repository.ts` — predicate `state = 'adjudicated' AND verdict exists AND verdict.onchain_tx_hash IS NULL`, returning the **stored** tier, verdict hash, and deal id and **nothing from the auditor** (research R1, this is what makes FR-024 structural)
- [X] T014 ⚠️ Verify T012 and T013 return populated rows against real data before building on them — the single defect found in the execution engine's verification run was a raw query whose result shape was *asserted* rather than checked, invisible to `tsc`, which moved 13 orders into a state with no record (008 tasks.md, "The defect the run caught")
- [X] T015 Implement `insertVerdictAndAdjudicate()`, `recordSettlement()`, `incrementAuditAttempts()`, and `markAuditFailed()` in `src/guardian/guardian.repository.ts`, each taking an `EntityManager` so the caller owns the transaction boundary
- [X] T016 Create `src/guardian/guardian.module.ts` registering the repository, the port binding, the service, the poller, and the controller; import `ChainModule` for `EscrowGuardianService` and `OrdersModule` for `OrderRepository`, and **do not import `ExecutionModule`** (`docs/CONTEXT.md` §3)
- [X] T017 Register `GuardianModule` in `src/app.module.ts`
- [X] T018 [P] Export `EscrowGuardianService` from `src/chain/chain.module.ts` if it is not already exported, without exporting the guardian client itself

**Checkpoint**: The app boots with the module wired. Both claim queries return correct rows against
hand-seeded data. No user story is functional yet.

---

## Phase 3: User Story 1 — A complaint becomes a cited, tiered ruling that moves money (P1) 🎯 MVP

**Goal**: A disputed order is audited, the ruling is recorded with citations, and the escrow settles
at the ruled tier.

**Independent test**: File a complaint on a delivered order; observe a ruling with a tier and ≥1
citation, and an on-chain split matching that tier. Verified by [quickstart.md](./quickstart.md) §3.

### The case file

- [X] T019 [US1] Implement `assembleCaseFile()` in `src/guardian/case-file-assembler.ts` mapping the repository row to `GuardianCaseFile` — including `systemPrompt` **verbatim** (it is also the corpus the leak check reads, so truncating it silently weakens T041) and `steps` as the **raw** `runs.steps` with `reasoning` intact
- [X] T020 [US1] Set `delivered` as an **explicit boolean** from `runs.output IS NOT NULL`, never inferred from an omitted field, and make an order with no run row assemble a complete case file (`delivered: false`, `output: null`, `steps: []`, all timings null) rather than failing (FR-004, FR-005, contracts/guardian-case-file.md §5)
- [X] T021 [US1] Source `capabilities`, `exclusions`, and `systemPrompt` from the **pinned** `agent_versions` row reached through `orders.agent_version_id` — never the agent's current listing (invariant #6, FR-002)

### The prompt and the schema

- [X] T022 [P] [US1] Create `src/guardian/verdict.schema.ts` with the `CitationSchema` and `VerdictSchema` Zod definitions from [contracts/verdict-schema.md](./contracts/verdict-schema.md) §1, plus the exhaustive `Record<wire tier, VerdictTier>` map and its doc-comment explaining why it is a table and not a cast (the argument `src/chain/tier.ts` makes at length)
- [X] T023 [P] [US1] Create `src/guardian/verdict-prompt.ts` exporting `GUARDIAN_SYSTEM_PROMPT` as a **frozen module-level `const`** containing the role, the two-yardstick standard (product §4.1), the five-tier rubric (§4.2), the citation requirements, the inconclusive-evidence rule (§7.4), the non-delivery rule, and the instruction never to quote the seller's instructions (agent-definition §4)
- [X] T024 [US1] ⚠️ Add the header warning to `src/guardian/verdict-prompt.ts`: **no interpolation of any kind** — no date, no order id, no agent name, no computed count. Any per-request value in this string makes every prefix unique and silently disables prompt caching (research R8)
- [X] T025 [US1] Verify `GUARDIAN_SYSTEM_PROMPT` exceeds **512 tokens** using `client.messages.count_tokens`, because that is Opus 5's minimum cacheable prefix and below it caching silently does nothing (research R8)

### The auditor

- [X] T026 [US1] Implement `ClaudeAuditor` in `src/guardian/claude-auditor.ts` — one non-streaming `client.messages.parse()` with `output_config: { format: zodOutputFormat(VerdictSchema) }`, the case file `JSON.stringify`'d as the entire user turn, and `system: [{ type: 'text', text: GUARDIAN_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }]`
- [X] T027 [US1] ⚠️ Send **no** `temperature`, `top_p`, or `top_k` — all three return **400** on Opus 5 — and construct the SDK client with **`maxRetries: 0`**, with the doc-comment carrying both reasons (research R7; the retry argument `claude-agent-runner.ts` already makes)
- [X] T028 [US1] Arm the audit deadline twice in `src/guardian/claude-auditor.ts` — the SDK `timeout` request option **and** an `AbortController` on the same `GUARDIAN_AUDIT_TIMEOUT_MS` deadline, cleared in a `finally` — because the first bounds the HTTP request and the second bounds the whole call (FR-038, research R14, the construction `claude-agent-runner.ts` uses)
- [X] T029 [US1] ⚠️ Check `response.stop_reason === 'refusal'` and `=== 'max_tokens'` **before reading any content block**, throwing `AuditorRefusedError` / `AuditorTruncatedError` — a refusal is a normal HTTP **200** with an empty or partial `content` array, so indexing `content[0]` unconditionally throws on `undefined` and reports a crash for what is really a declined audit (FR-039, research R7)
- [X] T030 [US1] Handle `parsed_output === null` and catch **`AnthropicError`** (not `ZodError` — the helper rewraps Zod's error) as `UnusableVerdictError` in `src/guardian/claude-auditor.ts`
- [X] T031 [US1] ⚠️ Add the logging-discipline doc-comment and implement it in `src/guardian/claude-auditor.ts`: every log line carries the order id, model, duration, and failure class — and **never** the case file, request body, response body, or reasoning. When mapping an SDK error, log its class name and HTTP status only; the API's error body can echo request fragments (contracts/verdict-schema.md §6)

### Validation gates

- [X] T032 [US1] Create `src/guardian/verdict-validation.ts` with the shared `normalise()` helper — trim, collapse internal whitespace runs to one space, casefold — used by both the traceability check and the leak check so the two cannot drift
- [X] T033 [US1] Implement the citation-traceability check: every citation's normalised `quote` must be a substring of some normalised clause of the kind named by its `source` — `capabilities[]`, `exclusions[]`, or the single `acceptanceCriteria` string. A failure throws `UntraceableCitationError` for the **whole** audit; citations are never dropped or repaired (FR-012, research R4)
- [X] T034 [US1] ⚠️ Implement the **prompt-leak containment**: reject the ruling if any window of ≥ `LEAK_RUN_WORDS` consecutive normalised words from `caseFile.systemPrompt` occurs in `reasoning`, throwing `PromptLeakError`. Reads `reasoning` **only** — `quote` is covered structurally by the `source` enum plus T033 (FR-042, research R13)
- [X] T035 [US1] Add the doc-comment to the leak check recording that **paraphrase is deliberately not detected**: `agent-definition.md` §4 explicitly permits reasoning that describes execution behaviour, and its own example sentence is a paraphrase — so a paraphrase detector would reject the rulings the product doc calls correct
- [X] T036 [US1] Ensure the leak-detected log line and `PromptLeakError` message name the order id and the failure class **without reproducing the matched text**

### Recording and settling

- [X] T037 [P] [US1] Create `src/guardian/refund.ts` with `REFUND_BPS` as an exhaustive `Record<VerdictTier, number>` (0 / 2500 / 5000 / 7500 / 10000) and `refundMinorFor(tier, priceMinor)` using `Math.floor` — with the doc-comment stating this is a **record of the ruling, not the instrument of payment**, that the contract computes and pays the real split, and why `Record<K, V>` rather than a switch (research R9; `src/chain/tier.ts` explicitly declines to own this)
- [X] T038 [P] [US1] Create `src/guardian/verdict-hash.ts` computing SHA-256 over a canonical projection with a **literal field order** (`orderId`, `tier`, `refundMinor`, `reasoning`, `citations` in the model's order, `model`) via `node:crypto`, returning 32 bytes — the width the contract's `bytes32` parameter requires (research R5)
- [X] T039 [US1] Add the ⚠️ note to `src/guardian/verdict-hash.ts`: the hash is computed **once, at persist time, and never recomputed** — the settle path reads the stored `bytea`, so the anchor is a fact about what was signed rather than a function that must keep agreeing with itself across deploys
- [X] T040 [US1] Implement the audit pipeline in `src/guardian/guardian.service.ts`: assemble → audit → validate → persist → settle, catching `AuditFailedError` at the top and writing nothing on failure
- [X] T041 [US1] ⚠️ Implement **transaction A** in `src/guardian/guardian.service.ts` — insert the `verdicts` row and move the order `disputed → adjudicated` in one transaction, and **commit it before calling the chain** (invariant #8, FR-018, research R12). Add the doc-comment explaining that this is `purchase.service.ts`'s shape and **not** `settlement.service.ts`'s, because a rollback here would destroy a non-reproducible ruling
- [X] T042 [US1] Call `EscrowGuardianService.resolve(dealId, tier, verdictHash)` **outside any transaction**, then implement **transaction B** writing `onchain_tx_hash` and moving `adjudicated → settled` (FR-021, FR-022)
- [X] T043 [US1] Ensure the settlement path writes **no ledger entry** and confirm `LedgerKind` still has no `settlement` member (FR-026, invariant #5)

### The trigger

- [X] T044 [US1] Create `src/guardian/guardian.poller.ts` — `setInterval` started in `onApplicationBootstrap`, cleared in `onModuleDestroy`, with hand-written `draining` / `stopping` re-entrancy guards and **silence on an empty tick**, mirroring `src/execution/execution.poller.ts` (research R1)
- [X] T045 [US1] Drain the **audit-pending** pass in the poller, one order per tick, and increment `audit_attempts` on every failure; stamp `audit_failed_at` on the attempt that reaches `GUARDIAN_MAX_AUDIT_ATTEMPTS` and stop selecting the order (FR-043, research R14)

**Checkpoint**: quickstart §3 passes end to end — a complaint produces a cited, settled verdict with
a matching on-chain split. **This is the MVP.**

---

## Phase 4: User Story 2 — The seller can read the ruling made against them (P2)

**Goal**: Both parties retrieve the identical ruling; nobody else can confirm the order exists.

**Independent test**: With one recorded ruling, retrieve it as buyer and as agent owner and diff;
retrieve as a stranger and confirm the order is not found. Verified by quickstart §8.

- [X] T046 [P] [US2] Create `src/guardian/dto/verdict-response.dto.ts` with `VerdictResponse` and `CitationResponse` exactly as specified in [contracts/verdict-api.md](./contracts/verdict-api.md) §2 — with the ⚠️ note that `source`, `quote`, and `met` are read **literally** by the UI and a renamed field renders as an absent panel rather than an error
- [X] T047 [US2] Create `src/guardian/verdict-serialiser.ts` mapping a verdict row to `VerdictResponse` by naming each field — never spreading a row — with the doc-comment explaining that the guarantee comes from the parameter type having no dangerous member, the same construction `src/orders/order-serialiser.ts` uses
- [X] T048 [US2] Pass `citations` through **with no reshaping** — no renaming, no filtering by `met`, no sorting. It was validated on the way in and stored verbatim; transforming it here would mean the parties read something other than the ruling that was made (contracts/verdict-api.md §6)
- [X] T049 [US2] Create `src/guardian/verdict.service.ts` authorising through the existing `OrderRepository.findVisibleToAccount` — **do not write a second authorisation query** (contracts/verdict-api.md §3)
- [X] T050 [US2] Create `src/guardian/verdict.controller.ts` as `@Controller('orders')` with one `@Get(':id/verdict')` behind the JWT guard, returning `404 ORDER_NOT_FOUND` for both "no such order" and "not your order" so the two are indistinguishable (FR-031)
- [X] T051 [US2] Return `404 VERDICT_NOT_FOUND` for a visible order whose audit is still being attempted — never a partial or provisional ruling (FR-034)
- [X] T052 [US2] ⚠️ Return `409 AUDIT_FAILED` with `attempts` and `failedAt` for a visible order whose `audit_failed_at` is set, so the client can distinguish *"the ruling is still coming"* from *"no ruling is coming"* — without this the buyer's screen says a ruling is being prepared indefinitely (FR-044, contracts/verdict-api.md §4.1)

**Checkpoint**: quickstart §8 passes. Both parties read the ruling; a stranger cannot confirm the
order exists; an exhausted audit reports itself.

---

## Phase 5: User Story 3 — Non-delivery resolves at a full refund (P3)

**Goal**: A dispute on an order that produced nothing rules at the full tier, **with reasoning and
citations** rather than a bare tier.

**Independent test**: Dispute an order whose run produced no output; confirm the full tier and a
full refund on-chain. Verified by quickstart §6.

- [X] T053 [US3] Add the non-delivery rule to `GUARDIAN_SYSTEM_PROMPT` in `src/guardian/verdict-prompt.ts`: an absent output is the full-refund case, and the ruling must still cite the capability that was not delivered
- [X] T054 [US3] ⚠️ Implement the **non-delivery floor** in `src/guardian/verdict-validation.ts`: if `caseFile.delivered === false` and the returned tier is not `full`, throw `NonDeliveryFloorError`. **Assert, never override** — an override would pair a `full` tier with reasoning arguing for something else, producing a verdict that contradicts itself on screen (FR-014, research R10)
- [X] T055 [US3] Add the doc-comment recording why there is **no code short-circuit** for non-delivery: it would produce the bare, uncited tier the whole feature exists to avoid, and Act 3 is the act where explanation is most persuasive
- [X] T056 [US3] Verify an order with **no run row at all** reaches the full tier through the same path (FR-005), not just one whose run produced `output IS NULL`

**Checkpoint**: quickstart §6 passes, both variants.

---

## Phase 6: User Story 4 — A ruling is final and is replayed, never recomputed (P4)

**Goal**: A decided order is never audited again, and every read returns identical bytes.

**Independent test**: Audit an order, force it back to `disputed`, confirm no second ruling appears
and no model call is made. Verified by quickstart §7.

- [X] T057 [US4] Confirm the audit-pending predicate's `NOT EXISTS (verdict)` clause (T012) prevents a decided order from reaching the model at all — the selection-time enforcement of FR-025
- [X] T058 [US4] Handle a Postgres unique violation (`23505`) on the `verdicts` insert as "someone else owns this": log, abandon, touch nothing. The `UNIQUE (order_id)` is the guarantee; reaching it means a model call was already wasted (research R2)
- [X] T059 [US4] ⚠️ Add the module-level note to `src/guardian/guardian.repository.ts` that **no delete, upsert, or cleanup path may ever be added to `verdicts`** — the constraint *is* the product rule that there are no appeals
- [X] T060 [US4] Confirm `reasoning` and `citations` are stored **exactly as returned** — no trimming, reordering, or normalisation. The normalisation in T032 is for comparison only and is never written (contracts/verdict-schema.md §7)

**Checkpoint**: quickstart §7 passes, including three identical response hashes.

---

## Phase 7: User Story 5 — A failed settlement does not cost the ruling (P5)

**Goal**: A chain failure after a ruling leaves the ruling readable and the order retryable from
the stored row.

**Independent test**: Force the escrow call to fail after a ruling; confirm the ruling is readable
and the order is `adjudicated`; restore the chain and confirm it settles without re-auditing.
Verified by quickstart §4.

- [X] T061 [US5] Drain the **settle-pending** pass in `src/guardian/guardian.poller.ts` using `claimSettlePending()` (T013), calling `resolve` with the **stored** tier and verdict hash and never touching the auditor (FR-024)
- [X] T062 [US5] Handle `ContractRevertError`, `ChainConnectivityError`, and `ChainOutcomeUnknownError` from `resolve` by leaving the verdict committed and the order `adjudicated`, logging at `error` with the order id and any transaction hash (FR-023)
- [X] T063 [US5] Confirm a retry after a lost receipt re-sends `resolve` and lets the **contract** — not our database — be the authority on whether the deal is already settled; a revert there is a safe, informative failure
- [X] T064 [US5] Add the doc-comment to `src/guardian/guardian.service.ts` explaining why an unknown chain outcome is **not** rolled back here, in contrast to `settlement.service.ts`'s `accept`: rolling back would destroy the only copy of a ruling that cannot be reproduced, because `temperature` does not exist on Opus 5

**Checkpoint**: quickstart §4 passes, including the unchanged `verdicts.created_at` on retry.

---

## Phase 8: Polish & Cross-Cutting Concerns

- [X] T065 [P] Run the static regression greps from [contracts/guardian-case-file.md](./contracts/guardian-case-file.md) §9 and confirm `systemPrompt` appears in **exactly three** files under `src/guardian/`
- [X] T066 [P] Confirm `grep -rn "from '../execution" src/guardian/` returns nothing (`docs/CONTEXT.md` §3)
- [X] T067 [P] Confirm `grep -n 'reasoning' src/orders/order-serialiser.ts` still shows no path from a step's reasoning to a buyer-facing field — FR-036 is a **regression check, not new work** (research R11)
- [ ] T068 ⚠️ Run quickstart §9 in full — the canary check across all three demo acts, including **forcing** the leak check to fire. It is the only thing that exercises FR-042 end to end, and the only requirement here enforced by a runtime check rather than a constraint
- [X] T069 Run quickstart §11 in full — bounded attempts, the terminal `AUDIT_FAILED` response, and the three forced gates (refusal, truncation, deadline), confirming the worker keeps picking up work after each (SC-011, SC-012)
- [X] T070 Run quickstart §10 and confirm `cache_read_input_tokens > 0` on a second audit. ⏱️ **Timebox to ten minutes** — caching is cost, not correctness; if it does not resolve quickly, record what you observed and move on
- [X] T071 Confirm no code path writes `verdicts` except the persist path in `guardian.service.ts` — no fixture, no config, no failure branch (FR-041, SC-013)
- [ ] T072 Run quickstart §12: all three demo acts end to end, **twice**, confirming the second pass returns byte-identical verdicts
- [X] T073 Record a verification-run section at the bottom of this file — what passed, what remains, and any finding for a downstream spec — following the pattern the execution engine's tasks.md established

---

## Dependencies & Execution Order

### Phase dependencies

```
Setup (T001–T006)
   ↓
Foundational (T007–T018)   ← BLOCKS everything below
   ↓
US1 (T019–T045)  P1 🎯 MVP ← the audit pipeline
   ↓
   ├─→ US2 (T046–T052)  P2   needs a verdict row to read
   ├─→ US3 (T053–T056)  P3   needs the pipeline + validator
   ├─→ US4 (T057–T060)  P4   needs the persist path
   └─→ US5 (T061–T064)  P5   needs transaction A + the settle pass
   ↓
Polish (T065–T073)
```

**US2 through US5 are independent of each other** and can proceed in parallel once US1 is done.
Each touches a different concern: the read route, the validator's floor, the persist path's
constraint handling, and the poller's second pass.

### Within-phase notes

- **T014 gates T015 and all of US1.** Do not build on a claim query whose result shape has only
  been asserted. This is the defect the execution engine's verification run caught.
- **T032 gates T033, T034, and T054.** All three validators share one normaliser.
- **T041 gates T042 and all of US5.** The transaction boundary is the invariant.
- **T023–T025 gate T026.** The prompt must exist and clear 512 tokens before the auditor sends it.

### Parallel opportunities

| Phase | Parallel tasks |
| --- | --- |
| Setup | T002, T003 |
| Foundational | T007, T008, T009, T010 (four different files); T018 |
| US1 | T022, T023 together; then T037, T038 together |
| US2 | T046 alongside US3/US4/US5 work |
| Polish | T065, T066, T067 |

Example — the foundational fan-out:

```
T007 guardian.errors.ts  ─┐
T008 (same file header)  ─┤
T009 case-file types     ─┼─→ then T011 → T012 → T013 → T014 (serialised)
T010 auditor port        ─┘
```

---

## Implementation Strategy

### MVP scope

**Phases 1–3 (T001–T045).** That is Setup, Foundational, and User Story 1: a complaint produces a
cited, tiered ruling and the escrow settles at that tier. It is demonstrable on its own and it is
the product.

### Incremental delivery

1. **T001–T018** — module boots, queries verified against real rows. Nothing user-visible.
2. **T019–T045** — 🎯 **MVP.** quickstart §3 passes; Act 2 of the demo works end to end.
3. **T046–T052** — the seller can read the ruling. Act 1 and Act 2 become defensible on stage.
4. **T053–T056** — Act 3 (non-delivery) rules correctly.
5. **T057–T064** — finality and settlement recovery; the two properties that only show under
   forced failure.
6. **T065–T073** — the regression checks and the full rehearsal.

### Team split

One developer takes Phases 1–3 alone; nothing else can start until the pipeline exists. After
that, US2 and US5 split cleanly between two people (coordinate on `guardian.service.ts` and
`guardian.poller.ts`), with US3 and US4 as small independent slices.

---

## Notes

- **No test tasks by design.** `docs/CONTEXT.md` puts automated tests out of scope for this
  component; quickstart.md is the suite and a failed rehearsal is a red build.
- **One migration.** Two columns on `orders` (T004–T006). If a task appears to need a second,
  something has been misread — `verdicts` already has all ten columns, the `UNIQUE (order_id)`,
  and the `CHECK (refund_minor >= 0)`.
- **The `UNIQUE (order_id)` is the no-appeals guarantee.** Never add a delete, an upsert, or a
  cleanup path to `verdicts`.
- **`temperature`, `top_p`, and `top_k` return 400 on Opus 5.** That is *why* verdicts are stored
  and replayed rather than recomputed — it is the reason for the whole finality design, not an
  incidental constraint.
- **A failed audit writes nothing** — no verdict row, no placeholder, no marker row. The absence
  of a verdict row is the marker for "undecided"; `audit_failed_at` marks only "and we have
  stopped trying."
- Commit after each task or logical group; stop at any checkpoint to validate.

---

## Verification run — 2026-08-09

Run against the dev stack with the guardian poller live and real `claude-opus-5` calls.
**Four disputed orders were audited and settled end to end.**

### What passed

| Check | Result |
| --- | --- |
| Poller boots, logs once, **silent on empty ticks**, clean shutdown | ✅ |
| §3 ★ Complaint → cited ruling → `resolve` on-chain → `settled` | ✅ 4/4 orders, ~9–10 s per audit |
| Verdict row shape | ✅ `refund_minor` = `price_minor` at `full`; 3 citations each; `verdict_hash` exactly **32 bytes**; `model` recorded |
| §3 ★ **Citation traceability by eye** | ✅ every quote matches its named clause verbatim — `"Echoes text."` = `capabilities[0]`, `"complain about me"` = `acceptance_criteria`, `"No images."` = `exclusions[0]` |
| §6 ★ Non-delivery → **full** tier, still cited | ✅ 4/4 (`hasRun=false`, `output IS NULL`); reasoning names `delivered: false` and the undelivered capability |
| §10 ⚠️ **Prompt caching** | ✅ audit 1 `cache_write=2217 cache_read=0`; audits 2 and 3 `cache_read=2217 cache_write=0` |
| Cached prefix clears the 512-token minimum | ✅ **1,703 tokens**, 0 interpolations (`count_tokens` against `claude-opus-5`) |
| §11 ★ **Bounded attempts → terminal, visible failure** | ✅ `attempt=1/3` → `2/3` → *"audit FAILED permanently after 3 attempts"*; ends `attempts=3`, `audit_failed_at` set, state still `disputed`, **`verdicts=0`** — no placeholder row |
| Poller **stops** selecting an exhausted order | ✅ attempts frozen at 3 across many ticks after the fault was removed |
| Worker survives failure and keeps working (SC-012) | ✅ |
| `AUDIT_FAILED` reported to **both** parties | ✅ buyer and agent owner → `audit-failed attempts=3`; third party → `order-not-visible` |
| §8 Both parties read the identical ruling (SC-008) | ✅ buyer/seller payloads **byte-identical** |
| §8 ⚠️ Third party cannot confirm the order exists (FR-031) | ✅ genuine third party on a real order returns the **same** `order-not-visible` as a nonexistent uuid |
| §7 Replay byte-identical across reads (SC-005) | ✅ |
| Wire field is `txHash` (matches the client) | ✅ |
| Route guarded | ✅ `401` unauthenticated |
| **Validation gates, deterministic (16/16)** | ✅ fabricated quote rejected; right text + wrong `source` rejected; empty quote rejected; whitespace/case variants still trace; non-delivery floor rejects `half` and `none`; **verbatim canary rejected**; canary with different case/spacing still rejected; 7-word fragment (under the run) passes; short prompt cannot leak; paraphrase not detected (documented) |

### What remains

- **§9, the live half.** The leak check's *mechanism* is proven deterministically (above), but I could
  not make a real audit leak: given a canary prompt **and an injected directive to quote it verbatim**,
  the model **refused** — *"I will not reproduce the seller's private operating instructions. They are
  confidential and my reasoning is shown verbatim to both parties."* Both layers held, so the
  end-to-end rejection path is still unexercised by a genuine leak. The canary's absence from a
  **buyer's** `GET /orders/:id/case-file` is API-07's boundary and its own quickstart covers it.
- **§12 Acts 1 and 2.** Every disputed order in this database is a non-delivery (`output IS NULL`), so
  only Act 3 (100%) has run. **The 0% and 50% acts have never been exercised** — they need API-11's
  seeded fixtures, which produce real output to rule against. This is the largest gap.
- **§4** the induced-settlement-failure path, and **§7** the forced duplicate-verdict insert.
- **§2** a `disputed` order with a NULL `onchain_deal_id`.

### ⚠️ Finding: the settle-pending pass retries forever on a permanent revert

Observed while forcing §9: an order left `adjudicated` with a verdict whose deal is **already
`Settled` on-chain** makes `settleNext` call `resolve` every tick, fail `ContractRevertError`, and log
an error — **indefinitely**, roughly every 2 seconds.

Reachable in production by the invariant-#8 window: if `resolve` lands but the receipt is lost, the
verdict is committed with `onchain_tx_hash IS NULL` and the contract will refuse every retry.
`GUARDIAN_MAX_AUDIT_ATTEMPTS` bounds the *audit* pass; **nothing bounds the settle pass.**

Nothing is corrupted — the ruling is correct and the money already moved — but the log floods, which
is precisely what `guardian.poller.ts`'s own "quiet by default" note says must not happen during a
rehearsal. **Not fixed here**: the correct treatment is probably to read the deal's on-chain state and
record the settlement when the contract says `Settled`, which is a design decision rather than a
patch.
