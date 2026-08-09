---

description: "Task list for 006-agent-catalogue"
---

# Tasks: Catalogue & the Serialisation Boundary

**Input**: Design documents from `/specs/006-agent-catalogue/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[data-model.md](./data-model.md), [contracts/internal-api.md](./contracts/internal-api.md),
[quickstart.md](./quickstart.md)

**Tests**: **No test tasks.** Automated tests are out of scope for `api/` — a recorded,
time-boxed MVP decision in `docs/CONTEXT.md`. Verification tasks reference sections of
[quickstart.md](./quickstart.md) instead, and they are not optional: they are the only
thing standing in for a test suite.

**Organization**: Grouped by user story so each is independently implementable and
demonstrable.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on incomplete work)
- **[Story]**: US1–US5, mapping to the user stories in [spec.md](./spec.md)
- Every task names its exact file path

---

## Before you start — four things that will bite

1. **No migration.** `agents` and `agent_versions` exist in full from
   `src/migrations/1786238842921-InitialSchema.ts`, with `UNIQUE (agent_id, version)`,
   `CHECK (price_minor > 0)`, `active DEFAULT true` and `timeout_seconds DEFAULT 120`
   already in place. If you find yourself writing one, stop and re-read
   [data-model.md](./data-model.md).

2. **The canonicaliser has an obvious wrong form that produces a stable, reproducible,
   *wrong* hash.** `JSON.stringify(obj, Object.keys(obj).sort())` looks like it sorts
   keys. The replacer *array* is one allow-list applied at **every** nesting level, so
   nested objects whose keys are not in the top-level list serialise as `{}` — and the
   seller's two schemas are nested objects. Only a recursive sort is correct
   ([R2](./research.md)). Quickstart **B8** is the check that catches this; the other
   hash checks all pass with the broken version.

3. **Never retry `registerAgent` for an agent with a null `onchain_agent_id`.** It is not
   a retry: the contract assigns a *new* id, and the seller ends up owning two on-chain
   agents, one of them unreachable ([R8](./research.md)). A null id means *the outcome is
   unknown*, not *pending*. The entity's current doc-comment says the opposite and T003
   fixes it — do that task before anyone reads the file.

4. **Field names are literal.** The UI is already built against them
   (`ui/src/api/types.ts`, `ui/specs/007-seller-pages/data-model.md`). A rename renders as
   an absent value rather than an error. Copy from
   [contracts/internal-api.md](./contracts/internal-api.md), never from memory.

---

## Phase 1: Setup

**Purpose**: Add the one dependency, and correct three doc-comments that currently
describe behaviour this feature will not have.

- [X] T001 Verify no migration is needed: confirm `agents`, `agent_versions`, the `UNIQUE (agent_id, version)` constraint, `CHECK (price_minor > 0)`, `agents_owner_idx` and the `UNIQUE` on `onchain_agent_id` all exist in `src/migrations/1786238842921-InitialSchema.ts`. Produce no migration file in this feature.
- [X] T002 Add `ajv` (v8) to `dependencies` in `package.json` and install. It is the feature's only new dependency; it is imported through `ajv/dist/2020` for draft 2020-12, because API-08 hands `output_schema` to the Anthropic API and that ecosystem is 2020-12 ([R5](./research.md)).
- [X] T003 [P] Rewrite the `onchain_agent_id` doc-comment in `src/entities/agent.entity.ts`. It currently says NULL means *"submitted, not yet confirmed — an honest state, not an error"* and advertises `WHERE onchain_agent_id IS NULL` as a trivial **retry** query. Both describe the async contract the brief was revised away from. Replace with: NULL means the registration outcome is **unknown** (a receipt timeout, the only cause — every other failure rolls back), such an agent is not purchasable and is hidden from all buyer-facing views, and ⚠️ it must never be "retried" by calling `registerAgent` again.
- [X] T004 [P] Update the `system_prompt` doc-comment in `src/entities/agent-version.entity.ts`. Its closing sentence *"Nothing enforces it yet"* stops being true in this feature. Point it at `src/catalog/agent-serialiser.ts` by path and state the three layers that enforce it ([R9](./research.md)).
- [X] T005 [P] Add a line to the docblock in `src/common/amount.schema.ts` naming its third caller: `priceMinor` on the two catalogue write DTOs. Its "no minimum and no maximum" argument now also governs what a seller may charge ([R15](./research.md)).

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The primitives every story needs — the hash, the schema check, the module
skeleton, and the guard's third state.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [X] T006 [P] Create `src/catalog/catalog.errors.ts` with `AgentNotFoundError`, `NotAgentOwnerError`, `AgentNotRegisteredError` (carrying the agent id) and `InvalidJsonSchemaError` (carrying `field: 'inputSchema' | 'outputSchema'` and Ajv's message, so the controller can name the offending field per FR-008 without re-validating).
- [X] T007 Create `src/catalog/definition-hash.ts` exporting `canonicalise(def): string` and `definitionHash(def): { hex: \`0x${string}\`; bytes: Buffer }`. Canonicalisation is RFC 8785: **recursively** sort object keys with the default string `.sort()` (UTF-16 code unit order, which is what JCS specifies), never reorder arrays, then `JSON.stringify` with no `space` argument. Hash with viem's `keccak256(toBytes(json))`; return both the `Hex` (for the chain call) and the `Buffer` (for the `bytea` column). ⚠️ Read warning 2 at the top of this file before writing the sort.
- [X] T008 [P] Create `src/catalog/schema-validation.ts` exporting `assertValidJsonSchema(value, field)`. Use `Ajv2020` from `ajv/dist/2020` with `strict: false` — a seller's schema is theirs, and Ajv's strict mode rejects legal constructions. Check in two steps: `validateSchema()` against the meta-schema, then `compile()` inside a `try`, because `compile` is what resolves `$ref` and is the operation API-08 will actually perform. Throw `InvalidJsonSchemaError` naming the field.
- [X] T009 [P] Create `src/auth/optional-auth.decorator.ts` exporting `@OptionalAuth()` and `@OptionalAccount()`, then teach `src/auth/jwt-auth.guard.ts` the third state: no `Authorization` header → allow through with `request.account` unset; header present → verify fully and **401 on any failure**, exactly as a protected route ([R6](./research.md)). `@OptionalAccount()` returns `Account | undefined` and must never be `@CurrentAccount()`, which throws a 500 by design when the guard did not populate the request. ⚠️ Give it the same doc-comment scrutiny `@Public()` carries: it belongs on browsable reads only, never on anything that writes or moves money.
- [X] T010 [P] Create `src/catalog/dto/create-agent.dto.ts` — a zod schema for the nine-field body in [contracts §4](./contracts/internal-api.md), reusing `amountMinorSchema` for `priceMinor`, with `timeoutSeconds` optional and defaulting to 120. ⚠️ `active` is **not** accepted: `agents.active` defaults to `true` and a client value would be a second authority over whether a new listing is live. The same schema serves `POST /agents/:id/versions`.
- [X] T011 [P] Create `src/catalog/dto/agent-listing.dto.ts` with the closed response interfaces — `AgentSummaryResponse`, `AgentListingResponse`, `OwnedAgentResponse`, `CreateAgentResponse`, `CreateVersionResponse`, `SetActiveResponse`. Exact interfaces, no index signature, no `extends` from an entity ([R9](./research.md) layer 3). Field names verbatim from [contracts/internal-api.md](./contracts/internal-api.md).
- [X] T012 Create `src/catalog/agent.repository.ts` with the write-side methods US1 needs: `insertAgentWithFirstVersion(ownerAccountId, definition, hashBytes, manager)` and `setOnchainAgentId(agentId, onchainId, manager)`. Both take an `EntityManager` so they run inside the caller's transaction ([R8](./research.md)). Read-side methods are added by later stories — see the multi-story file note in Dependencies.
- [X] T013 Create `src/catalog/catalog.module.ts` importing `TypeOrmModule.forFeature([Agent, AgentVersion])` and `ChainModule`, and register it in `src/app.module.ts`. ⚠️ Import `EscrowOperatorService`, never a viem client — `ChainModule` exports services and deliberately not clients, and that list is what makes the narrowed ABIs meaningful.

**Checkpoint**: the hash, the schema check and the module exist. Stories can begin.

---

## Phase 3: User Story 1 — A seller lists an agent (Priority: P1) 🎯 MVP

**Goal**: `POST /agents` creates the agent and version 1, hashes the definition, registers
it on-chain, and does not answer until the receipt has confirmed.

**Independent Test**: list an agent, confirm the response carries a non-null
`onchainAgentId`, then re-derive the fingerprint from the stored definition by an
independent computation and confirm it matches what the escrow contract holds.

- [X] T014 [US1] Add `findByIdWithLock(agentId, manager)` to `src/catalog/agent.repository.ts` — `SELECT … FOR UPDATE` over the agent row. US1 does not need it, but US3 and US4 both do and it belongs beside the other write-side queries; adding it now keeps this file off the critical path for two later stories.
- [X] T015 [US1] Create `src/catalog/agent-writes.service.ts` with `createAgent(account, dto)`. Order: validate both schemas (T008) → compute the hash (T007) → open a transaction → insert agent + version 1 → call `EscrowOperatorService.registerAgent(account.walletAddress, priceMinor, hash.hex)` → write `onchain_agent_id` → commit. Implement the three-branch failure table from [contracts §4](./contracts/internal-api.md) exactly: **clean failure rolls back and records nothing**; **`ChainOutcomeUnknownError` commits the agent and version with a null `onchain_agent_id`** and logs the tx hash *and* the `defHash` at `error` so the transaction can be reconciled by hand. ⚠️ Those two branches are the same status code and different worlds — see warning 3.
- [X] T016 [US1] Create `src/catalog/agents.controller.ts` with `@Controller('agents')` and the `POST /` handler, taking `@CurrentAccount()` and the T010 DTO through `ZodValidationPipe`. No `@Public()` anywhere in this file — the global guard is fail-closed and its silence is the control. Return `CreateAgentResponse` (`201`).
- [X] T017 [US1] Map catalogue and chain errors to HTTP in the controller, reusing the existing `toHttpException` from `src/common/chain-http.ts` for the `ChainError` family (it already maps `ChainOutcomeUnknownError` to a `502` carrying `txHash`). Add the catalogue cases: `InvalidJsonSchemaError` → `400` naming the field, `AgentNotFoundError` → `404`, `NotAgentOwnerError` → `403`, `AgentNotRegisteredError` → `409`.
- [X] T018 [US1] Verify [quickstart §1](./quickstart.md) A1–A12: `201` with a **non-null** `onchainAgentId`, `version: 1`, a 32-byte `definitionHash`, no execution-spec fields in the response, and every refusal recording nothing.
- [X] T019 [US1] Verify [quickstart §2](./quickstart.md) B1–B8 — the independent hash re-derivation against the chain, and the determinism checks. ⚠️ **B8 (nested schema) is the one that catches a broken canonicaliser**; B1–B7 pass with the wrong implementation. Also verify §5 E1: an out-of-gas registration leaves no row at all.

**Checkpoint**: agents can be listed and their commitments verified on-chain. Nothing can
read them back yet.

---

## Phase 4: User Story 2 — Buyers browse a catalogue that cannot leak the seller's craft (Priority: P1)

**Goal**: `GET /agents` and `GET /agents/:id` serve the listing to anyone, and the
execution spec is structurally unreachable through either.

**Independent Test**: set an agent's `systemPrompt` to a sentinel string, sweep every
buyer-facing route with every credential state and every malformed input, and confirm the
sentinel appears nowhere — including in the server log.

**Depends on US1 for data.** The routes are independently implementable; demonstrating
them needs an agent to exist.

- [X] T020 [US2] Create `src/catalog/agent-serialiser.ts` — **the choke point**. Define `type ListingFields = Pick<AgentVersion, 'name' | 'description' | 'capabilities' | 'exclusions' | 'priceMinor' | 'inputSchema' | 'outputSchema' | 'version'>` and export `toAgentSummary` and `toAgentListing`, each annotated with its closed return type from T011. ⚠️ The parameter type having no `systemPrompt` property **is** the guarantee — the file must not mention the field at all, not even to omit it. Add a docblock stating the three layers and that API-09 extends this module rather than building a second boundary.
- [X] T021 [US2] Add `findPublicListings()` and `findPublicListing(agentId)` to `src/catalog/agent.repository.ts`. One `DISTINCT ON (v.agent_id) … ORDER BY v.agent_id, v.version DESC` joined to `agents`, filtered `a.active = true AND a.onchain_agent_id IS NOT NULL` — **one clause, never applied by halves** (FR-021). ⚠️ Name the selected columns explicitly; `system_prompt`, `model` and `timeout_seconds` must not be fetched at all ([R9](./research.md) layer 1).
- [X] T022 [US2] Create `src/catalog/agents.service.ts` with `listPublic()` and `getPublicListing(agentId)`, mapping through T020 and throwing `AgentNotFoundError` when the row is absent — which covers inactive and unregistered agents identically, because the filter is in the query.
- [X] T023 [US2] Add `GET /` (`@OptionalAuth()`) and `GET /:id` (`@Public()`) to `src/catalog/agents.controller.ts`. Both return listing shapes only. `GET /` returns a **bare array**, no envelope ([R11](./research.md)).
- [X] T024 [US2] Validate `:id` as a uuid at the route boundary so a malformed id is a `400` rather than a Postgres error surfacing as a `500` (quickstart D4). Use `ParseUUIDPipe` or a zod param pipe, consistent with how the DTO bodies are parsed.
- [X] T025 [US2] Verify [quickstart §3](./quickstart.md) C1–C7 — the sentinel sweep across every route × every credential state, the `model`/`timeoutSeconds` sweep, the malformed-input sweep, the log check, and the two structural greps (C6: the serialiser never names the field; C7: the public reads select their columns).
- [X] T026 [US2] Verify [quickstart §4](./quickstart.md) D1–D6 — public reads work unauthenticated, `404` for unknown, `400` for malformed, and **`401` for a bad or expired credential on `GET /agents`** even though the route tolerates none.

**Checkpoint**: the marketplace is browsable and the boundary is proven by sweep.

---

## Phase 5: User Story 3 — A seller manages availability without losing the agent (Priority: P2)

**Goal**: `GET /agents?owner=me` returns all of the caller's agents including inactive and
unregistered ones, and `PATCH /agents/:id/active` toggles availability on-chain and in
Postgres — reversibly.

**Independent Test**: switch an agent off, confirm it leaves the public catalogue and stays
in the owner's list, then switch it back on from that list and confirm it returns.

- [X] T027 [US3] Add `toOwnedAgent(version, agent)` to `src/catalog/agent-serialiser.ts`, returning `OwnedAgentResponse` — the summary fields plus `active` and `listed`, where `listed` is `agent.onchainAgentId !== null` ([R12](./research.md)). Same parameter-type discipline as T020.
- [X] T028 [US3] Add `findOwnedListings(accountId)` to `src/catalog/agent.repository.ts` — the same `DISTINCT ON` as T021 with `a.owner_account_id = $1` and **both public filters dropped**. ⚠️ Reusing T021's filter here is the one-way-toggle bug: it removes an agent from the only screen that could switch it back on (FR-039).
- [X] T029 [US3] Add the `?owner=me` branch to `GET /` in `src/catalog/agents.controller.ts`: `owner=me` with no session → `401` (never a fallback to the public list); any other `owner` value → `400`; absent → the public list. Read the account with `@OptionalAccount()`. The branch selects between two repository methods and two mappers and does nothing else ([R7](./research.md)).
- [X] T030 [US3] Add `setActive(account, agentId, active)` to `src/catalog/agent-writes.service.ts`. Shape: open a transaction → `findByIdWithLock` (T014) → assert ownership → assert `onchain_agent_id` is not null (else `AgentNotRegisteredError` → `409`) → update `active` → call `EscrowOperatorService.setAgentActive` → **commit only if the chain agreed** ([R8](./research.md)). Setting the value it already holds is a success with no error (idempotent — `ui/specs/007-seller-pages` R9 depends on this in writing).
- [X] T031 [US3] Create `src/catalog/dto/set-active.dto.ts` (`{ active: boolean }`, an absolute value, never a toggle instruction) and add the `PATCH /:id/active` handler to `src/catalog/agents.controller.ts`.
- [X] T032 [US3] Verify [quickstart §7](./quickstart.md) G1–G8 — the **full round trip**, both halves. G3 is the one that matters: an agent switched off must still appear in `?owner=me`. G8 confirms the chain and the database agree after each `PATCH`.
- [X] T033 [US3] Verify [quickstart §4](./quickstart.md) D7–D12 — point `MONAD_RPC_URL` at a black hole, list an agent, and confirm the resulting null-id row is absent from `GET /agents`, `404` on `GET /agents/:id`, **present in `?owner=me` with `listed: false`**, and logged once at `error` with both hashes. Restore the URL afterwards.

**Checkpoint**: the seller can curate their catalogue, and the one silent failure state is
visible to exactly one person.

---

## Phase 6: User Story 4 — A new version supersedes without rewriting history (Priority: P2)

**Goal**: `POST /agents/:id/versions` records an immutable new version, tells the escrow
contract the new hash and price, and leaves every earlier version untouched.

**Independent Test**: publish a second version with a different price, confirm the public
listing shows it and the chain holds its hash, and confirm version 1 reads back
byte-identical.

- [X] T034 [US4] Add `nextVersionNumber(agentId, manager)` and `insertVersion(agentId, version, definition, hashBytes, manager)` to `src/catalog/agent.repository.ts`. `nextVersionNumber` is `MAX(version) + 1` and **must be called inside the T014 row lock** — `UNIQUE (agent_id, version)` is the backstop, not the mechanism (FR-036). No `UPDATE` and no `DELETE` path against `agent_versions` exists anywhere in this file.
- [X] T035 [US4] Add `publishVersion(account, agentId, dto)` to `src/catalog/agent-writes.service.ts`. Shape: transaction → lock → assert ownership → assert registered → validate schemas → hash → `nextVersionNumber` → insert → `EscrowOperatorService.updateAgent(onchainId, priceMinor, hash.hex)` → commit only if the chain agreed. ⚠️ Call `updateAgent` **even when the price is unchanged** (FR-034) — the hash changed, and the hash is the commitment. ⚠️ An identical resubmission produces a new version carrying the **same** `definitionHash` ([R3](./research.md)); that is correct and must not be "fixed" by refusing it.
- [X] T036 [US4] Add the `POST /:id/versions` handler to `src/catalog/agents.controller.ts`, reusing the T010 DTO and returning `CreateVersionResponse` (`201`).
- [X] T037 [US4] Verify [quickstart §6](./quickstart.md) F1–F8 — the public listing follows the latest version, version 1 reads back byte-identical, the chain holds version 2's hash and price, an unchanged price still calls `updateAgent`, an identical republish yields the same hash, a non-owner gets `403`, and concurrent publishes produce consecutive unique numbers.
- [X] T038 [US4] Verify [quickstart §5](./quickstart.md) E2 — with the chain unreachable, no version row survives. This is the transaction-wrapping check; a row that survives is a listing at a price the chain will not honour.

**Checkpoint**: the catalogue has history, and it cannot be rewritten.

---

## Phase 7: User Story 5 — An owner can read their own definitions in full (Priority: P3)

**Goal**: `GET /agents/:id/versions` returns every version complete with the execution
spec, to the owner and to nobody else.

**Independent Test**: request an agent's versions as the owner and confirm the private
instructions and fingerprint are present; request the same as another account and confirm
it is refused as **not found**.

- [X] T039 [US5] Create `src/catalog/dto/agent-version-detail.dto.ts` with `AgentVersionDetailResponse` — the full fourteen fields from [contracts §7](./contracts/internal-api.md), including `systemPrompt`, `model`, `timeoutSeconds`, `definitionHash` (as `0x…`) and `createdAt`.
- [X] T040 [US5] Add `findVersionsForOwner(agentId, accountId)` to `src/catalog/agent.repository.ts` — every version, newest first, all columns, scoped by owner in the query so an unauthorised caller and an unknown agent return the same empty result.
- [X] T041 [US5] Create `src/catalog/agent-versions.service.ts` holding the mapping to `AgentVersionDetailResponse`. ⚠️ **This is the one place `systemPrompt` is mapped, and it deliberately does not live in `agent-serialiser.ts`** — that module's parameter types are the guarantee, and a mapper that must see the field does not belong behind them ([R9](./research.md)).
- [X] T042 [US5] Add the `GET /:id/versions` handler to `src/catalog/agents.controller.ts`. ⚠️ **A non-owner gets `404`, not `403`** — a `403` here would make the endpoint an existence oracle for other sellers' agent ids (FR-029). The write routes use `403` because the caller already holds the id from their own list; this is a read whose entire purpose is disclosure.
- [X] T043 [US5] Verify [quickstart §8](./quickstart.md) H1–H8 — the owner gets everything, another account gets `404` indistinguishable from an unknown id, no session gets `401`, and an inactive agent is still fully readable by its owner.

**Checkpoint**: all five stories functional.

---

## Phase 8: Polish & Cross-Cutting Concerns

- [X] T044 [P] Verify [quickstart §9](./quickstart.md) I1–I6 — diff every response against `ui/src/api/types.ts` and `ui/specs/007-seller-pages/data-model.md` §1.3–1.5. Bare arrays, `camelCase`, every money field suffixed `Minor` and an integer.
- [X] T045 [P] Raise the UI-07 handoff: `OwnedAgent` needs `listed: boolean` and `OwnedAgentList` needs a badge for it. Until then an unregistered agent renders in the seller's list as a healthy one — the only silent failure this feature can produce ([R12](./research.md)). One field, one cell.
- [X] T046 [P] Note in `specs/006-agent-catalogue/contracts/internal-api.md` §10 that API-12 must transcribe this file, with two additions to the UI's existing shapes: `version` on `AgentListing` and `listed` on `OwnedAgent`. `docs/openapi.yaml` still does not exist.
- [X] T047 Run [quickstart.md](./quickstart.md) end to end, all ten sections, in order.
- [X] T048 Run the [quickstart §10](./quickstart.md) rehearsal checklist **twice in a row** with no manual correction to the catalogue between runs — that is SC-012, and it is the closest thing this component has to a green build.

---

## Dependencies & Execution Order

### Phase dependencies

- **Setup (Phase 1)**: no dependencies. T003 should land before anyone reads
  `agent.entity.ts`, because the comment it fixes describes a forbidden operation.
- **Foundational (Phase 2)**: depends on Setup (T002 specifically — T008 imports `ajv`).
  **Blocks every story.**
- **US1 (Phase 3)**: after Foundational. No dependency on other stories.
- **US2 (Phase 4)**: after Foundational. Independently implementable; **needs US1 to have
  produced data** before it can be demonstrated.
- **US3 (Phase 5)**: after Foundational. T029 edits the `GET /` handler US2 created; T033
  needs US1 and US3 together.
- **US4 (Phase 6)**: after Foundational. Needs US1 for an agent to version. T035 depends on
  T014's lock.
- **US5 (Phase 7)**: after Foundational. Needs US1 for a version to read.
- **Polish (Phase 8)**: after every story.

### Files touched by more than one story — these gate concurrency

The stories stay independently *testable*; they are not independently *editable*.

| File | Touched by |
| --- | --- |
| `src/catalog/agent.repository.ts` | Foundational (T012), US1 (T014), US2 (T021), US3 (T028), US4 (T034), US5 (T040) |
| `src/catalog/agents.controller.ts` | US1 (T016, T017), US2 (T023, T024), US3 (T029, T031), US4 (T036), US5 (T042) |
| `src/catalog/agent-writes.service.ts` | US1 (T015), US3 (T030), US4 (T035) |
| `src/catalog/agent-serialiser.ts` | US2 (T020), US3 (T027) |

The repository and the controller are touched by all five. Sequential story order avoids
every collision; parallel work on these two files does not.

### One dependency worth stating plainly

**US1 is the only story that can be demonstrated on its own.** Every other story reads or
mutates an agent, and there is no other way to create one — no seed, no fixture, no admin
route. That is what makes US1 the MVP rather than a matter of priority ordering.

### Parallel opportunities

- **Phase 1**: T003, T004, T005 in parallel (three different files, all doc-only).
- **Phase 2**: T006, T008, T009, T010, T011 in parallel — five different files. T007 is
  alone deliberately: it is the feature's highest-risk twenty lines. T012 and T013 are
  sequential against the rest.
- **Phase 8**: T044, T045, T046 in parallel; T047 and T048 are sequential and last.
- **Across stories**: not recommended — see the file table above.

---

## Parallel Example: Phase 2

```bash
# Five independent files, no shared edits:
Task: "Create src/catalog/catalog.errors.ts"                    # T006
Task: "Create src/catalog/schema-validation.ts"                 # T008
Task: "Create src/auth/optional-auth.decorator.ts + guard edit" # T009
Task: "Create src/catalog/dto/create-agent.dto.ts"              # T010
Task: "Create src/catalog/dto/agent-listing.dto.ts"             # T011

# T007 (definition-hash.ts) runs on its own — warning 2 at the top of this file.
```

---

## Implementation Strategy

### MVP first (US1 only)

1. Phase 1: Setup — one dependency, three doc-comments.
2. Phase 2: Foundational — **blocks everything**.
3. Phase 3: US1.
4. **STOP and VALIDATE**: quickstart §1 and §2. If B2 fails, the on-chain commitment is
   decorative and nothing built on top of it means anything.

### Incremental delivery

1. Setup + Foundational → the hash and the module exist.
2. US1 → agents can be listed and verified on-chain **(MVP)**.
3. US2 → the marketplace is browsable and the boundary is proven **(unblocks UI-03)**.
4. US3 → the seller can curate **(unblocks UI-07's toggle)**.
5. US4 → versions **(unblocks the dispute story's "judged against what ran")**.
6. US5 → the owner's full view.

US1 + US2 together are what API-07 needs to exist at all. US3 is what UI-07 needs.

### Notes

- `[P]` = different files, no dependency on incomplete work.
- Commit after each task or logical group.
- Stop at any checkpoint to validate a story independently.
- The verification tasks are not documentation — with no test suite, skipping one means
  that requirement was never checked by anything.
