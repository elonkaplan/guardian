# Implementation Plan: Demo seed & the three seller agents

**Branch**: `011-demo-seed-fixtures` | **Date**: 2026-08-09 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/011-demo-seed-fixtures/spec.md`

## Summary

A new `demo/` module with two unauthenticated routes and one piece of static content.

`POST /demo/seed` creates a demo seller account from a configured payout address, publishes three agent listings through the **existing** catalogue write path — so each one is registered on-chain exactly like a real seller's — and returns the three fixtures an operator needs to drive the acts. `POST /demo/reset` clears orders, runs, complaints and verdicts, unlinks (never deletes) the ledger entries that pointed at them, and leaves accounts and the catalogue standing.

The three fixtures are registered into the **already-built, currently-empty** `DemoScriptRegistry` at module bootstrap rather than at seed time. That is the plan's one non-obvious decision and it falls out of a fact about the existing code: `definition_hash` is a pure function of the definition, so the fixtures' keys can be computed from the same static definition objects the seed publishes, with no database read. Registration therefore survives a restart for free, and FR-026 costs nothing (research [R1](./research.md)).

Everything the acts then exercise — execution, evidence, audit, settlement — is untouched. This feature authors content and adds two routes; it builds no new mechanism.

## Technical Context

**Language/Version**: TypeScript 6.0 on Node ≥ 22

**Primary Dependencies**: NestJS 11, TypeORM, viem (via the existing `chain/` adapter), Zod 4 for the two response DTOs. No new dependency.

**Storage**: PostgreSQL. **No migration** — the feature writes existing tables through existing repositories and deletes from them.

**Testing**: None. Automated tests are out of scope for this component by standing decision; [quickstart.md](./quickstart.md) is the hand-verification suite and the demo rehearsal is the real one.

**Target Platform**: The same Docker-composed API service as every other feature.

**Project Type**: Backend service module (`api/src/demo/`).

**Performance Goals**: A cold seed completes in under two minutes (SC-002); it is dominated by three sequential on-chain `registerAgent` calls, each awaiting a receipt. A reset is a handful of statements in one transaction.

**Constraints**:

- No new mechanism for making runs deterministic — the substitution seam exists and ships empty (FR-023).
- Nothing may write an order state, a run row, or a verdict directly (FR-022).
- No ledger row may be deleted or reversed (FR-031), which collides with an existing foreign key and is the reset design's whole problem (research [R4](./research.md)).
- Both routes are public and unguarded by recorded decision, so neither response may carry a `system_prompt` (FR-010).

**Scale/Scope**: 3 listings, 3 fixtures, 2 routes, ~8 source files, 0 migrations.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

`.specify/memory/constitution.md` is the **unfilled template** — every principle is still a `[PRINCIPLE_N_NAME]` placeholder. There are no ratified gates to evaluate, so the constitution gate is vacuous and passes.

The governing constraints for this component are `docs/CONTEXT.md`'s nine invariants, which are checked here instead:

| Invariant | Bearing on this feature | Status |
| --- | --- | --- |
| 1 — two-phase money ordering | The seed moves no money. It does not credit balances; funding stays on its existing path. | ✅ untouched |
| 2 — USD cents only | Prices are declared in cents (200 / 100 / 150); the one conversion stays inside `chain/`, reached only through `EscrowOperatorService`. | ✅ |
| 3 — `system_prompt` never reaches a buyer | Both new responses are built from explicit DTOs with nowhere to put it (FR-010, contract §1.3). | ✅ enforced by shape |
| 4 — the ledger is append-only | Reset deletes no ledger row. It nulls a dangling FK and leaves every `amount_minor` in place, so every balance is unchanged. | ⚠️ see Complexity Tracking |
| 5 — settlement writes no ledger entry | Untouched; reset cannot recall settled funds and does not pretend to (FR-032). | ✅ |
| 6 — orders pin `agent_version_id` | Seed reconciliation publishes a *new version* when a definition drifts, never edits one, so orders already judged keep their pinned text. | ✅ |
| 7 — `runs.output IS NULL` is evidence | Act 3's crash goes through `ScriptedAgentRunner` → `AgentRunFailedError` → the ordinary failure path. No demo code touches `runs`. | ✅ by construction |
| 8 — verdict persisted before the chain call, re-audit refused | Untouched. Reset deletes verdicts wholesale, which is how the next rehearsal is decided afresh. | ✅ |
| 9 — `orders.state` is the queue | Untouched. Reset deletes rows out of the queue, which is the one race this feature must handle (FR-034, research [R5](./research.md)). | ✅ handled |

**Post-Phase-1 re-check**: unchanged. The design added no chain call, no money movement, and no writer of run or verdict rows.

## Project Structure

### Documentation (this feature)

```text
specs/011-demo-seed-fixtures/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/
│   ├── demo-api.md          # The two routes, request and response shapes
│   ├── seeded-definitions.md # The three agent definitions, verbatim
│   └── fixtures.md          # The three acts: input, criteria, complaint, outcome
└── tasks.md             # Phase 2 output (/speckit-tasks — NOT created here)
```

### Source Code (repository root)

```text
api/src/
├── demo/                          # NEW — the whole feature
│   ├── demo.module.ts             # Registers fixtures at bootstrap (OnModuleInit)
│   ├── demo.controller.ts         # POST /demo/seed · POST /demo/reset — both @Public()
│   ├── demo-seed.service.ts       # Idempotent create-or-reconcile of the three listings
│   ├── demo-reset.service.ts      # One transaction: unlink ledger, delete four tables
│   ├── demo.errors.ts             # Seed-path errors → HTTP mapping
│   ├── seeded-agents.ts           # ★ CONTENT: the three definitions (static, exported)
│   ├── fixtures.ts                # ★ CONTENT: the three acts, keyed to those definitions
│   ├── structured-output-guard.ts # Refuses a schema the model service would reject
│   └── dto/
│       ├── seed-response.dto.ts
│       └── reset-response.dto.ts
├── catalog/
│   └── catalog.module.ts          # CHANGED — export AgentWritesService + AgentRepository
├── config/
│   └── env.schema.ts              # CHANGED — add DEMO_SELLER_ADDRESS
└── app.module.ts                  # CHANGED — register DemoModule
```

**Structure Decision**: A new sibling module under `src/`, matching every other feature in this component. It is a leaf: `DemoModule` imports `CatalogModule`, `AccountsModule` and `ExecutionModule`, and nothing imports `DemoModule`. Two existing modules widen their export lists (`CatalogModule` currently exports nothing, by a documented decision that anticipated exactly this kind of extension); nothing else is edited.

The content lives in two files that hold **only** content — `seeded-agents.ts` and `fixtures.ts`. That separation is deliberate: the fixtures are the fragile part of this feature and the part most likely to be edited at 3am, and they should be editable without reading a service.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| Reset writes to `ledger_entries` (nulls `order_id`), touching an append-only table | `ledger_entries.order_id` has a foreign key to `orders` with no `ON DELETE`, so deleting orders while the entries stand is a constraint violation. Something has to give. | **Deleting the entries** (the obvious read of "clears orders") reverses purchase debits and credits back money that has already left the pool for an escrow or a settlement — it breaks the solvency invariant and rewrites history. **Keeping the orders** contradicts FR-029 and leaves every rehearsal's evidence on screen. **Adding `ON DELETE SET NULL`** is the same write with a migration in front of it. Nulling the pointer preserves every amount, every balance and the append-only property of what the ledger actually records; only the provenance link to a row that no longer exists is lost, and the reset response says how many were unlinked (FR-032). Full argument in research [R4](./research.md). |
| `CatalogModule` gains exports where its docblock says "Nothing is exported" | The seed must publish through the real seller path — `AgentWritesService.createAgent` — or the listings are not registered on-chain and not buyable. | Reimplementing agent creation inside `demo/` would duplicate the hash, the transaction and the unknown-outcome branch, and the duplicate is the one that drifts. The docblock already anticipates this: it says nothing is exported *yet* and names the next feature that would need it. |
