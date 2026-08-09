# Implementation Plan: Catalogue & the Serialisation Boundary

**Branch**: `006-agent-catalogue` | **Date**: 2026-08-09 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/006-agent-catalogue/spec.md`

## Summary

Six endpoints in one new module, `src/catalog/`, plus one new dependency, one widening of
the auth guard, and two entity doc-comments that this feature makes untrue.

**The database is already built and this feature is the first thing to write to it.**
`agent.entity.ts` and `agent-version.entity.ts` are mapped with every column, constraint
and default the six endpoints need — `UNIQUE (agent_id, version)`,
`CHECK (price_minor > 0)`, `active DEFAULT true`, `timeout_seconds DEFAULT 120`,
`onchain_agent_id bigint UNIQUE` nullable. **No migration.**

**The chain side is also already built, and better than expected.**
`EscrowOperatorService.registerAgent` already returns `TxResult<bigint>` with the id
recovered from the `AgentRegistered` log rather than from the function's declared return
value, and `executeWrite` already awaits a receipt, checks `receipt.status`, and maps a
receipt timeout to `ChainOutcomeUnknownError`. `GAS_LIMITS` carries measured entries for
all three registry calls. The brief's *"awaits the receipt"* requirement is satisfied by
the adapter that exists; what this feature has to get right is what happens on the
branches around it.

Five decisions carry the feature, all argued in [research.md](./research.md):

- **The canonical form is RFC 8785, hand-written in twenty lines** (R2) — and the obvious
  wrong implementation, `JSON.stringify(obj, Object.keys(obj).sort())`, produces a stable,
  reproducible, *wrong* hash by silently emptying every nested object. The seller's two
  schemas are nested objects.
- **The hashed payload excludes `version`** (R3) — which **contradicts spec FR-016 as
  written**. See below.
- **The chain call goes inside the Postgres transaction** for the two writes that can
  (R8). A chain failure rolls back and records nothing. Registration cannot use that shape
  because the contract assigns the id, so it has its own failure table — and
  `ChainOutcomeUnknownError` is the *only* thing that leaves a row with a null on-chain id.
- **The boundary is structural in three independent layers** (R9): the column is never
  selected, the serialiser's parameter type has no such property, and the return types are
  closed.
- **`@OptionalAuth()` is added to the global guard** (R6), because `GET /agents` and
  `GET /agents?owner=me` are one route in Nest and `@Public()` returns before the token is
  ever read.

### One spec correction, made during planning

**Spec FR-016 required the fingerprint to cover "listing fields, execution fields, and
version number alike". Spec scenario US4 #8 required an identical republished definition
to produce *the same* fingerprint.** Both cannot hold. R3 resolves it against the version
number — `agent-definition.md` §2.3 lists `version` and `definitionHash` as two separate
integrity fields, the contract takes `defHash` as an argument independent of the `version`
it bumps itself, and nothing anywhere resolves a version *from* a hash. FR-016 and the
fingerprint's Key Entities entry are amended in [spec.md](./spec.md); US4 #8 stands.

### One cross-component handoff this plan creates

`OwnedAgentResponse` carries a new `listed: boolean` field (R12), needed by FR-026 so a
seller can tell an agent whose registration outcome is unknown from a healthy one.
`ui/specs/007-seller-pages/data-model.md` §1.3 declares `OwnedAgent extends AgentSummary
{ active: boolean }` and nothing more. Sending the field is safe — that document states
that declaring fewer fields than arrive is safe — but **the seller's screen has nowhere to
render it until `OwnedAgent` and `OwnedAgentList` are edited.** One field, one badge. It
is worth doing: the state it reports is the only silent failure this feature can produce.

### Two entity doc-comments this feature makes untrue

Both were written against earlier readings and now describe behaviour the code will not
have. Neither is cosmetic:

- **`agent.entity.ts`** describes a null `onchain_agent_id` as *"submitted, not yet
  confirmed — an honest state, not an error"* and advertises
  `WHERE onchain_agent_id IS NULL` as a trivial **retry** query. The brief was revised to
  make `POST /agents` synchronous, and R8 shows why that retry is the one operation
  forbidden here: `registerAgent` mints a *new* on-chain agent, so a "retry" leaves the
  seller owning two, one of them unreachable.
- **`agent-version.entity.ts`** says of `system_prompt` that *"nothing enforces it yet"*.
  This is the feature where that stops being true, and the comment should name the module
  by path.

### What this plan deliberately does not build

No orders, no execution, no search, no pagination, no ratings. `OrdersModule` is not
touched — nothing here reads or writes the orders table, which is what makes "publishing a
version leaves running orders untouched" true by having no code that could do otherwise.

## Technical Context

**Language/Version**: TypeScript 6.0.3 on Node ≥22, NestJS 11. No `tsconfig.json` change.

**Primary Dependencies**: **one added — `ajv` v8** (R5), used through `ajv/dist/2020` for
JSON Schema draft 2020-12. Everything else is present: viem 2.55.11 (`keccak256`,
`toBytes` — pure utilities, no client), TypeORM 1.1.0, zod 4.4.3, `@nestjs/*` 11.

**Storage**: PostgreSQL via TypeORM. Tables `agents` (insert, update, row lock) and
`agent_versions` (insert, read). **No schema change, no migration.**

**Testing**: **None.** Automated tests are out of scope for `api/` (`docs/CONTEXT.md`).
[quickstart.md](./quickstart.md) is the verification procedure, written to be run by hand
before every rehearsal.

**Target Platform**: Linux container, Docker Compose, against Monad testnet.

**Project Type**: Web service (NestJS REST API).

**Performance Goals**: none that bind. The public catalogue is one `DISTINCT ON` query over
three rows (R10). The three writes are seller actions performed once each and are allowed
to take as long as a receipt takes — up to `RECEIPT_TIMEOUT_MS` = 30 s.

**Constraints**: `system_prompt` never reaches a buyer (invariant #3). Versions immutable.
Cents outside `chain/` (invariant #2). Nothing visible in the public catalogue that cannot
be bought. The definition hash must reproduce from the stored row by a third party.

**Scale/Scope**: demo scale — one seller, three agents, a handful of versions. No
pagination, no caching, no rate limiting.

## Constitution Check

`.specify/memory/constitution.md` is an **unfilled template** — every principle is still a
`[PRINCIPLE_N_NAME]` placeholder. There are no ratified gates to evaluate, so this section
cannot pass or fail on its own terms.

The project's real governing document is `api/docs/CONTEXT.md` §2, and this plan is checked
against its nine invariants instead:

| # | Invariant | Status |
| --- | --- | --- |
| 1 | Two-phase flows ordered so a crash leaves the safe side | ✅ R8 — the money form does not apply, but the shape does: the chain call sits inside the transaction, so a failure records nothing |
| 2 | One money unit: cents outside `chain/` | ✅ `priceMinor` is cents from DTO to hash to `registerAgent(owner, priceCents, …)`. The only `toBaseUnits` remains the one already inside `EscrowOperatorService`. `keccak256` is a pure hash, not a unit conversion (R4) |
| 3 | **`system_prompt` never reaches a buyer** | ✅ **This is the feature.** R9 — three independent layers; quickstart §3 verifies with a sentinel sweep |
| 4 | Ledger append-only | ➖ not touched |
| 5 | Settlement writes no ledger entry | ➖ not touched |
| 6 | Orders point at `agent_version_id` | ✅ upheld by version immutability (FR-032) — a row an order pins can never be rewritten under it. No orders code here |
| 7 | `runs.output IS NULL` is evidence | ➖ not touched |
| 8 | Verdict persisted before the chain call | ➖ not touched |
| 9 | `orders.state` is the queue | ➖ not touched |

**Module boundaries** (`docs/CONTEXT.md` §3) hold: `catalog` owns agents, versions,
hashing and the serialisation boundary — exactly its assigned scope — and `chain` remains
the only module that talks to Monad. No viem client is imported; only
`EscrowOperatorService`, which `ChainModule` already exports.

**One boundary is crossed deliberately and needs saying**: this feature edits `src/auth/`
to add `@OptionalAuth()` (R6). That is a change to a security-critical file the feature
does not own. The guard's fail-closed default is unchanged; what is added is a third
state, and a *bad* credential is still refused on a route that tolerates *no* credential.

**One gate genuinely fails, and it is the project's own choice**: no automated tests. That
is a recorded, time-boxed MVP decision in `docs/CONTEXT.md`, not a gap this plan
introduces. See Complexity Tracking.

## Project Structure

### Documentation (this feature)

```text
specs/006-agent-catalogue/
├── plan.md              # This file
├── research.md          # Phase 0 — 16 decisions
├── data-model.md        # Phase 1 — no migration; the three faces of a version
├── quickstart.md        # Phase 1 — the manual test suite
├── contracts/
│   └── internal-api.md  # Phase 1 — literal paths, field names, failure tables
├── checklists/
│   └── requirements.md
├── spec.md
└── tasks.md             # /speckit-tasks — NOT created here
```

### Source Code (repository root)

```text
api/src/
├── catalog/                              # NEW MODULE
│   ├── catalog.module.ts
│   ├── agents.controller.ts              # all six routes; one branch, on ?owner=me (R7)
│   ├── agents.service.ts                 # reads: public list, detail, owner list
│   ├── agent-writes.service.ts           # the three writes; owns the transactions (R8)
│   ├── agent-versions.service.ts         # the owner-only full view — the ONE place
│   │                                     #   systemPrompt is mapped
│   ├── agent.repository.ts               # DISTINCT ON queries; explicit column selects (R10)
│   ├── agent-serialiser.ts               # ⚠️ the choke point (R9) — API-09 extends this
│   ├── definition-hash.ts                # canonicalise() + definitionHash() (R2, R3, R4)
│   ├── schema-validation.ts              # ajv 2020, validateSchema + compile (R5)
│   ├── catalog.errors.ts                 # AgentNotFoundError, NotAgentOwnerError,
│   │                                     #   AgentNotRegisteredError
│   └── dto/
│       ├── create-agent.dto.ts           # zod; reuses amountMinorSchema (R15)
│       ├── set-active.dto.ts
│       ├── agent-listing.dto.ts          # closed response interfaces (R9 layer 3)
│       └── agent-version-detail.dto.ts
│
├── auth/
│   ├── optional-auth.decorator.ts        # NEW — @OptionalAuth() + @OptionalAccount() (R6)
│   └── jwt-auth.guard.ts                 # MODIFIED — the third state
│
├── entities/
│   ├── agent.entity.ts                   # MODIFIED — doc-comment only; null is a crash
│   │                                     #   state, and the retry it suggests is forbidden
│   └── agent-version.entity.ts           # MODIFIED — doc-comment only; name the serialiser
│
├── common/
│   └── amount.schema.ts                  # MODIFIED — doc-comment only; a third caller
│
└── app.module.ts                         # MODIFIED — register CatalogModule
```

**Structure Decision**: single NestJS project, one module per `docs/CONTEXT.md` §3
responsibility. The module is `catalog/` and the routes are `/agents` — those are allowed
to differ, and here they must, since the module map names `catalog` in two documents (R1).

Three structural judgements worth flagging:

**`definition-hash.ts` lives in `catalog/`, not `chain/`** (R4). Canonicalisation is a
statement about what the *product* considers the definition to be — that `exclusions` is
part of the sold contract and `createdAt` is not. `chain/` has no business knowing that.
The entity's *"hex conversion belongs in the chain adapter"* comment is about the column
being `bytea` rather than `text`, not about where a digest is computed.

**`agent-versions.service.ts` is a separate file from `agents.service.ts`** — the
owner-only full view is the one mapping that must see `systemPrompt`, and it is kept out of
the module whose parameter types are the guarantee. A mapper that needs the field does not
belong behind a boundary defined by not having it.

**Writes are split from reads** (`agent-writes.service.ts`). The three writes each own a
Postgres transaction wrapped around a chain call; the reads own none. Mixing them puts a
`FOR UPDATE` lock one careless edit away from the hottest read in the module.

## Phase 0 — Research

Complete. 16 decisions in [research.md](./research.md). No `NEEDS CLARIFICATION` markers
survived: the spec's Assumptions section resolved the product-level questions at spec time,
and this phase resolved the implementation-level ones. One decision (R3) resolved an
internal contradiction *in* the spec and the spec was amended.

## Phase 1 — Design & Contracts

Complete:

- **[data-model.md](./data-model.md)** — no migration; the three faces of a version as a
  field-by-route matrix; the exact ten-field canonical payload; what a null
  `onchain_agent_id` now means and why the entity comment is wrong.
- **[contracts/internal-api.md](./contracts/internal-api.md)** — all seven route rows with
  **literal** paths, field names and status codes, a failure table per endpoint, and the
  handoffs to UI-07, API-07, API-09 and API-12.
- **[quickstart.md](./quickstart.md)** — the manual verification procedure. Three sections
  are load-bearing: the independent hash re-derivation including the nested-schema case
  that catches the replacer-array trap, the sentinel sweep across every buyer-facing route,
  and the full availability round trip.

### Post-design constitution re-check

No change. One new dependency (`ajv`), justified below. No new module boundary crossed
beyond the `auth/` widening already declared, no invariant weakened.

The design added two things worth re-checking against invariant #3, and both hold:
`agent-versions.service.ts` is the single place `systemPrompt` is mapped and it is on an
owner-scoped route with a `404`-not-`403` refusal; and the public repository methods select
their columns explicitly, so the prompt is not merely unserialised but never fetched.

Invariant #2 was re-checked against R4 specifically: `keccak256` and `toBytes` are pure
functions over bytes, `priceMinor` enters the hashed payload as cents and leaves as cents,
and no second unit conversion was introduced anywhere.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| No automated tests | Time-boxed MVP decision recorded in `docs/CONTEXT.md`; only `sc/` keeps a suite, because a contract bug costs a redeploy | Not this feature's call to reverse. Mitigated by [quickstart.md](./quickstart.md) being a runnable procedure with explicit pass criteria, and by §10's rehearsal checklist. The sentinel sweep in §3 is the one check that would be worth a real test, and it is the cheapest to run by hand |
| A new production dependency (`ajv`) | FR-008 requires refusing a definition whose schemas are not valid schemas, naming which. `validateSchema` is exactly that check, and API-08 needs the same library to validate run output against `output_schema` — the pre-audit check agent-definition §3 calls load-bearing | A hand-rolled structural check accepts documents Ajv rejects and rejects documents Ajv accepts — a gate that disagrees with the validator that matters later. Deferring to API-08 turns a `400` at listing time into a failed run on a paid order, and a failed run is evidence of non-delivery (invariant #7): a seller's typo would become a refund |
| Editing `src/auth/` from a catalogue feature | `GET /agents` and `GET /agents?owner=me` are one Nest route, and `@Public()` returns before the token is read, so the owner query cannot learn who is asking (R6) | `GET /agents/mine` avoids the guard change and contradicts `api-design.md` §3.3, this feature's spec, and `ui/src/api/agents.ts`'s already-written `fetchOwnedAgents`. Decoding the token in the controller violates the rule `current-account.decorator.ts` states in writing — that nothing outside `auth/` reads the header |
| A Postgres transaction held open across a chain RPC (R8) | It is what makes "a failed chain call records nothing" true, rather than a compensation path that has to be right | At real scale this is connection-pool exhaustion and the answer is an outbox. At demo scale — one seller, three agents, no concurrent publishing — it costs nothing and removes an entire class of half-applied state. Recorded as scale-bounded, not as a pattern to copy |
| A `FOR UPDATE` lock for version numbering | FR-036 requires consecutive unique version numbers under concurrent publication, and `MAX(version) + 1` races | `UNIQUE (agent_id, version)` alone catches the collision — *after* the loser's chain call has already landed, leaving the contract holding a hash for a version that was never stored. The constraint is the backstop; the lock is the mechanism |
