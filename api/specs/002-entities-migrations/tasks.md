---
description: "Task list for Entities & Initial Migration implementation"
---

# Tasks: Entities & Initial Migration

**Input**: Design documents from `/specs/002-entities-migrations/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/](./contracts/)

**Tests**: **No test tasks.** Automated tests remain out of scope for this component
per [`docs/CONTEXT.md`](../../docs/CONTEXT.md). Verification tasks run the
corresponding scenario from [quickstart.md](./quickstart.md) by hand — mostly
inserting a row and expecting the database to refuse it.

**Organization**: Grouped by user story. Note the shape of this feature: US1 delivers
the migration, and **US2 and US3 add no new code at all** — the rules they describe are
already in the migration, and their tasks are the proof that they work. That is honest
rather than awkward: a constraint you have not tried to violate is a constraint you do
not know you have.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2, US3, US4)
- Include exact file paths in descriptions

## Path Conventions

All paths are relative to `guardian/api/` unless prefixed `../` (repository root).

---

## Phase 1: Setup (Shared Building Blocks)

**Purpose**: The two files every entity imports.

- [X] T001 [P] Create `api/src/entities/enums.ts` — three TypeScript string enums whose members and **declared order** match [`contracts/schema.sql`](./contracts/schema.sql) exactly: `LedgerKind` (`onramp`, `purchase`, `offramp`, `adjustment` — note there is deliberately **no** `settlement`), `OrderState` (`purchased`, `running`, `delivered`, `failed`, `released`, `disputed`, `adjudicated`, `settled`), `VerdictTier` (`none`, `quarter`, `half`, `three_quarter`, `full`). Add a comment that order is significant because Postgres sorts enum values by declaration, so reordering silently changes the meaning of `ORDER BY state`
- [X] T002 [P] Create `api/src/entities/transformers.ts` — export `bigintTransformer: ValueTransformer` converting Postgres `bigint` to `number` on read (`from`) and back on write (`to`), handling `null` on both sides. Comment why it exists: the `pg` driver returns `bigint` as a **string**, so without this `total + entry.amountMinor` produces `"2000200"` — a money bug that type-checks. Cents in a JS `number` are exact to ~$90 trillion; see [research.md R1](./research.md)

**Checkpoint**: `npm run build` passes.

---

## Phase 2: Foundational (Entities & DataSource Wiring)

**Purpose**: All eight entities, plus the DataSource changes they require.

**⚠️ CRITICAL**: T011 replaces the entity glob with explicit imports
([research.md R9](./research.md)), so `data-source.ts` will not compile until **all
eight** entity files exist — which means nothing runs, including `migration:run`, until
this phase is complete. That is a real dependency, not a bookkeeping one.

Column types, nullability, and every constraint come from
[data-model.md](./data-model.md). Every entity: `@PrimaryGeneratedColumn('uuid')` for
`id`, and `created_at` as `{ type: 'timestamptz', default: () => 'now()' }` — **not**
`@CreateDateColumn`, which would use the application's clock instead of the
database's ([research.md R7](./research.md)).

- [X] T003 [P] Create `api/src/entities/account.entity.ts` — table `accounts`: `id`, `walletAddress` (`text`, NOT NULL), `createdAt`. **Declare NO unique constraint on `walletAddress`** and add a comment saying why: uniqueness is the functional index `lower(wallet_address)` created in the migration, and a plain `@Index({ unique: true })` here would be case-sensitive and would let `0xAbC…` and `0xabc…` both register — the exact bug FR-010 exists to prevent ([research.md R3](./research.md))
- [X] T004 [P] Create `api/src/entities/agent.entity.ts` — table `agents`: `ownerAccountId` + `@ManyToOne` to `Account`, `onchainAgentId` (`bigint`, nullable, unique, `bigintTransformer`), `active` (`boolean`, default true), `createdAt`. Comment that `NULL` on `onchainAgentId` means "submitted, not yet confirmed" and is an honest state, not an error
- [X] T005 [P] Create `api/src/entities/agent-version.entity.ts` — table `agent_versions`, all 14 columns per [data-model.md §4](./data-model.md): `capabilities`/`exclusions` as `{ type: 'text', array: true }` (NOT NULL, may be empty), `priceMinor` with `bigintTransformer`, `inputSchema`/`outputSchema` as `jsonb`, `definitionHash` as `bytea` → `Buffer`, `timeoutSeconds` default 120. Add `@Unique(['agentId', 'version'])`
- [X] T006 [P] Create `api/src/entities/order.entity.ts` — table `orders` per [data-model.md §5](./data-model.md). **`agentVersionId` + `@ManyToOne` to `AgentVersion`, and NO `agentId` column of any kind** — adding one would be a defect, not a convenience; it is what makes "judged against the definition that actually ran" true by construction. `state` bound to the `order_state` enum via `enumName`. `priceMinor` and `reviewWindowSeconds` are snapshots, commented as such
- [X] T007 [P] Create `api/src/entities/run.entity.ts` — table `runs`: `orderId` unique + `@OneToOne` to `Order`, `input` (`jsonb` NOT NULL), **`output` (`jsonb`, nullable)**, `steps` (`jsonb`, default `'[]'`), `error`, `outputValid` (`boolean`, nullable), `startedAt`/`finishedAt`/`durationMs`. Comment on `output`: **NULL is the non-delivery evidence, not an error** — never default it to `{}`, never retry over it; the UNIQUE on `orderId` exists precisely so a well-meaning retry cannot destroy it
- [X] T008 [P] Create `api/src/entities/complaint.entity.ts` — table `complaints`: `orderId` **unique** + `@OneToOne` to `Order`, `reason`, `createdAt`. Comment that the UNIQUE is the product rule "no amendments, no re-filing", enforced by the database rather than by an API check someone forgets
- [X] T009 [P] Create `api/src/entities/verdict.entity.ts` — table `verdicts` per [data-model.md §8](./data-model.md): `orderId` **unique**, `tier` bound to `verdict_tier` via `enumName`, `refundMinor` (`bigint`, transformer), `reasoning`, `citations` (`jsonb`, default `'[]'`), `verdictHash` (`bytea`), `model`, `onchainTxHash` (nullable). Comment that the UNIQUE means no appeals — and that persisting the verdict is what makes the demo replayable, since Opus 5 exposes no `temperature`
- [X] T010 [P] Create `api/src/entities/ledger-entry.entity.ts` — table `ledger_entries`: `accountId` + `@ManyToOne` to `Account`, `amountMinor` (`bigint`, transformer, **signed**), `kind` bound to `ledger_kind` via `enumName`, `orderId` (nullable FK to `Order`), `externalRef` (nullable), `createdAt`. Comment: **append-only** — no update path is modelled, corrections are new `adjustment` rows, and there is no cached balance column anywhere
- [X] T011 Modify `api/src/data-source.ts` — two changes: (a) add `uuidExtension: 'pgcrypto'` so TypeORM emits `gen_random_uuid()` rather than `uuid_generate_v4()`, matching the DDL; without it the drift check fails on all eight tables. Add a comment that the flag name is a leftover and that **no extension is installed** — `gen_random_uuid()` has been core since Postgres 13. (b) Replace the `entities: [__dirname + '/**/*.entity{.ts,.js}']` glob with an explicit array importing all eight classes, so a missing entity is a compile error rather than a runtime `EntityMetadataNotFound` ([research.md R2](./research.md), [R9](./research.md))
- [X] T012 Run `npm run build` and confirm it passes; then start the stack and confirm `/health` still returns 200 — the entity metadata is loaded at boot, so a malformed decorator surfaces here rather than at first query

**Checkpoint**: Entities compile and the app boots with them registered.

---

## Phase 3: User Story 1 — A cold database becomes the full schema (Priority: P1) 🎯 MVP

**Goal**: One migration builds all 8 tables, 3 enum types, and 20 indexes from empty.

**Independent Test**: `docker compose down -v && docker compose up`, then count tables
and enum types — 8 and 3.

- [X] T013 [US1] Create `api/src/migrations/<timestamp>-InitialSchema.ts` — a hand-written migration whose `up()` executes the statements of [`contracts/schema.sql`](./contracts/schema.sql) **verbatim and in that order** (enums → accounts → agents → agent_versions → orders → runs → complaints → verdicts → ledger_entries, indexes with their tables). Transcribe the SQL; do **not** generate it from the entities — the named enum types, the functional unique index, and the `CHECK` constraints are exactly what decorator inference loses. Generate the file skeleton with `npm run migration:generate -- src/migrations/InitialSchema` **or** write it by hand with a `Date.now()` timestamp prefix; either way the body is the contract's SQL
- [X] T014 [US1] Write the migration's `down()` — drop every object `up()` created, in reverse dependency order (tables reverse of creation, then the three `DROP TYPE`). FR-004 requires a revert that leaves nothing behind
- [X] T015 [US1] Run quickstart Scenario A steps A1–A4: cold start, then confirm **8** tables (excluding `migrations`), **3** enum types with values in exactly the declared order, every index from [data-model.md § Index inventory](./data-model.md), and that an `INSERT` supplying neither `id` nor `created_at` returns both populated
- [X] T016 [US1] Run quickstart Scenario A5: `docker compose run --rm migrate` a second time exits 0 with "No migrations are pending"; `npm run migration:revert` leaves only the `migrations` table; a third `migrate` rebuilds cleanly

**Checkpoint**: The schema exists and is reproducible from empty. This is the MVP and
it unblocks every later API spec.

---

## Phase 4: User Story 2 — The database refuses to break product rules (Priority: P2)

**Goal**: Prove that all six uniqueness rules and four CHECK constraints reject their
violation.

**Independent Test**: Attempt each violation; every one must be rejected by the
database, not by application code.

**No new code.** These constraints ship in T013. What follows is the proof.

- [X] T017 [US2] Seed a minimal fixture in the running database — one account, one agent, one agent version, one order — per the setup block in [quickstart.md Scenario B](./quickstart.md). Keep the returned ids; the rest of this phase needs them
- [X] T018 [US2] Run rejections B1–B3: a second `complaints` row, a second `verdicts` row, and a second `runs` row for the same `order_id`. Confirm each is rejected by `complaints_order_id_key`, `verdicts_order_id_key`, `runs_order_id_key` respectively — by **constraint name**, so a rejection for an unrelated reason is not mistaken for success
- [X] T019 [US2] Run rejection B4 with **three casings** of one wallet address (upper, lower, mixed): the first insert succeeds and both others are rejected by `accounts_wallet_lower_idx`. This is the check that distinguishes a functional unique index from a plain one, and it is the one most worth doing carefully
- [X] T020 [US2] Run rejections B5–B6: duplicate `(agent_id, version)`, and duplicate `onchain_agent_id`
- [X] T021 [US2] Run rejections B7–B9: `price_minor = 0` on both `agent_versions` and `orders`, `review_window_seconds = 0`, and `refund_minor = -1`. Note B9 uses `-1` rather than `0` — the constraint is `>= 0` because a `none` verdict legitimately refunds nothing
- [X] T022 [US2] Run rejections B10–B11: a row referencing a non-existent account / agent version / order, and `DELETE FROM accounts` while dependent rows exist

**Checkpoint**: Every product rule that has money attached is enforced by the database.

---

## Phase 5: User Story 3 — Pinning and immutability (Priority: P3)

**Goal**: Purchases resolve to the exact definition that ran, and the restricted column
is unmistakably marked.

**Independent Test**: `orders` has `agent_version_id` and no `agent_id`; adding a new
version leaves an existing order untouched.

- [X] T023 [US3] Add the disclosure marker to `api/src/entities/agent-version.entity.ts` — a doc-comment on the `systemPrompt` property naming it as **seller IP that must never be serialised to a buyer**, noting that Guardian reads it while the buyer's copy of the case file must have it stripped, and that the serialiser enforcing this is API-06's job, not this feature's. FR-023 requires the marker to be unambiguous enough that the later serialiser has something to key on
- [X] T024 [US3] Run quickstart Scenario C1 and C4: `information_schema` shows `orders` has exactly one agent-related column, `agent_version_id` — **an `agent_id` column here is a defect** — and `agents` carries nothing a buyer is shown
- [X] T025 [US3] Run quickstart Scenario C2 and C3: insert version 2 of the seeded agent, then confirm the existing order still resolves to version 1, and that its `price_minor` is unchanged by the new version's price
- [X] T026 [US3] Run quickstart Scenario C5: confirm the `systemPrompt` marker from T023 is present and unmissable

**Checkpoint**: The structural property behind the arbitration story holds by
construction.

---

## Phase 6: User Story 4 — Balance is derived, never stored (Priority: P4)

**Goal**: A balance helper that sums an append-only ledger, and a schema with no
cached total anywhere.

**Independent Test**: Insert `+10000, −2500, +500`; the helper returns `8000`. Search
the schema for a stored balance; find nothing.

- [X] T027 [US4] Create `api/src/ledger/balance.repository.ts` — an `@Injectable()` `BalanceRepository` with `getAvailableBalanceMinor(accountId: string): Promise<number>`, implemented as `SELECT COALESCE(SUM(amount_minor), 0) FROM ledger_entries WHERE account_id = $1` through the query builder. Per [`contracts/repository-api.md`](./contracts/repository-api.md): returns a **`number`**, never a string; returns **`0`** and never `null` for an account with no entries — the `COALESCE` is part of the contract, because "has nothing" and "does not exist" are different facts and only the first is true here. `SUM(bigint)` returns `numeric`, which the driver hands back as a string, so convert once at this boundary
- [X] T028 [US4] Create `api/src/ledger/ledger.module.ts` — imports `TypeOrmModule.forFeature([LedgerEntry])`, provides and **exports** `BalanceRepository` so API-05 can build on it
- [X] T029 [US4] Register `LedgerModule` in `api/src/app.module.ts`
- [X] T030 [US4] Run quickstart Scenario D1–D2: insert `+10000`, `−2500`, `+500` for one account and confirm the helper returns `8000`; call it for a fresh account and confirm it returns the number `0` — not `null`, not `"0"`
- [X] T031 [US4] Run quickstart Scenario D3–D4: a search of `information_schema.columns` for any column matching `%balance%` or `%cached%` returns **zero rows**, and every `%_minor` column is `bigint`
- [X] T032 [US4] Run quickstart Scenario D5: read a row with a money column through the repository and confirm `typeof value === 'number'`. A string here is the R1 bug and it type-checks, so it has to be looked at directly rather than inferred

**Checkpoint**: All four stories independently functional.

---

## Phase 7: Polish & Cross-Cutting Concerns

- [X] T033 Run quickstart Scenario E, the drift check: `npm run migration:generate -- src/migrations/DriftCheck` must report no changes or produce an empty `up()`. **One known exception**: TypeORM cannot express a functional index, so it may propose dropping `accounts_wallet_lower_idx` — that output is expected and **must not be applied**. Any *other* proposed change is real drift and is fixed in the entity, never by editing the migration. Delete the generated file either way
- [X] T034 [P] Add a schema section to `api/README.md` — the eight tables, the three enums, where the DDL contract lives, and the migration commands. Note the drift-check exception so the next person does not "fix" the functional index
- [X] T035 [P] Confirm no test scaffolding was introduced: no `*.spec.ts`, no `test/` directory, no test scripts in `api/package.json`
- [X] T036 Complete the [quickstart.md sign-off checklist](./quickstart.md) — all 10 rows, SC-001 through SC-009 plus FR-020 and FR-023

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: no dependencies
- **Foundational (Phase 2)**: needs Setup — **blocks everything**, because T011 makes
  `data-source.ts` import all eight entities explicitly, so nothing compiles or runs
  until they all exist
- **US1 (Phase 3)**: needs Foundational
- **US2 (Phase 4)**: needs US1 — the constraints it proves ship in T013
- **US3 (Phase 5)**: needs US1 for the schema checks, and T017's fixture for C2/C3
- **US4 (Phase 6)**: needs US1. Independent of US2 and US3 in code
- **Polish (Phase 7)**: T033 needs Foundational **and** US1 (it compares the two)

### Cross-story notes

- **US2 and US3 add almost no code.** US2 adds none at all; US3 adds one doc-comment.
  Their tasks are verification, and that is the point — the rules live in the migration,
  and a constraint nobody has tried to violate is a constraint nobody knows they have.
- **T017's fixture is shared.** US3's T025 reuses the rows US2 seeds. Run US2 first, or
  re-seed.
- **T023 edits a file created in T005.** Sequential, not parallel.

### Parallel Opportunities

- **Phase 1**: T001 ∥ T002 — different files, no shared imports
- **Phase 2**: T003–T010 are eight separate files and can all be written in parallel.
  Relation targets are referenced through lazy arrows (`@ManyToOne(() => Account)`), so
  write order does not matter — but **compilation needs all eight**, so T011 and T012
  wait for the whole set
- **Phase 4**: T018, T020, T021, T022 are independent rejections once T017 has seeded;
  T019 is independent of the fixture entirely
- **Phase 7**: T034 ∥ T035

---

## Parallel Example: Phase 2

```bash
# All eight entity files at once — different files, lazy relation references:
Task: "Create api/src/entities/account.entity.ts"
Task: "Create api/src/entities/agent.entity.ts"
Task: "Create api/src/entities/agent-version.entity.ts"
Task: "Create api/src/entities/order.entity.ts"
Task: "Create api/src/entities/run.entity.ts"
Task: "Create api/src/entities/complaint.entity.ts"
Task: "Create api/src/entities/verdict.entity.ts"
Task: "Create api/src/entities/ledger-entry.entity.ts"
# then T011 (data-source) and T012 (build) once all eight land
```

---

## Implementation Strategy

### MVP First (through User Story 1)

1. Phase 1: Setup (T001–T002)
2. Phase 2: Foundational (T003–T012)
3. Phase 3: US1 (T013–T016)
4. **STOP and VALIDATE**: `docker compose down -v && docker compose up` → 8 tables, 3 enums

That is bootstrap step 4 in
[`docs/project-structure.md`](../../../docs/project-structure.md) §6 fully complete
("tables exist"), and it unblocks API-03 onward.

### Incremental Delivery

1. Setup + Foundational → entities compile, app boots
2. + US1 → **the schema exists and rebuilds from empty. MVP.**
3. + US2 → every money-adjacent rule proven enforced
4. + US3 → pinning confirmed, restricted column marked
5. + US4 → balance derived, no cached total
6. + Polish → drift check clean, sign-off green

### Where the risk actually is

Three tasks are where this feature goes wrong quietly, and all three are cheap to get
right and expensive to discover later:

- **T011's `uuidExtension: 'pgcrypto'`** — omit it and every entity disagrees with the
  migration on its `id` default, and the drift check fails on all eight tables at once
- **T003's absent unique constraint** — add a plain `@Index({ unique: true })` on
  `walletAddress` "for correctness" and case-insensitive identity is silently gone
- **T013 transcribed, not generated** — generate the migration from entities instead of
  from the contract and you lose the named enum types, the functional index, and the
  four CHECK constraints, which is most of what this feature is for

---

## Notes

- **No test tasks by design.** Verification is T015, T016, T018–T022, T024–T026,
  T030–T033, T036 — run by hand against [quickstart.md](./quickstart.md)
- `[P]` = different files, no dependencies
- Commit after each task or logical group
- The DDL in [`contracts/schema.sql`](./contracts/schema.sql) was executed against
  Postgres 16 during planning and the catalog read back, so the expected counts in T015
  (8 tables, 3 types, 20 indexes, 4 CHECKs) are measured, not estimated
