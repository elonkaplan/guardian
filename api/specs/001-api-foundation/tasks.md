---
description: "Task list for API Foundation implementation"
---

# Tasks: API Foundation

**Input**: Design documents from `/specs/001-api-foundation/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/](./contracts/)

**Tests**: **No test tasks.** Automated tests of any kind are out of scope for this
component per [`docs/CONTEXT.md`](../../docs/CONTEXT.md) — the only suite the project
keeps is the escrow contract's. Verification tasks below run the corresponding
scenario from [quickstart.md](./quickstart.md) by hand.

**Organization**: Grouped by user story. A caveat worth stating plainly: these three
stories are layers of one boot path, not three separable features — the service cannot
start at all without *some* config loading, so the minimum viable config layer sits in
Foundational and US2 owns the fail-loud *behavior* (error aggregation, redaction,
placeholder detection). Each story still has its own verifiable checkpoint.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions

Single project rooted at `api/`. All paths below are relative to `guardian/api/`
unless prefixed `../` (the repository root).

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Get a compiling, dependency-complete NestJS project on disk.

- [X] T001 Scaffold the NestJS project in place at `api/` — generate `package.json`, `nest-cli.json`, `tsconfig.json`, `tsconfig.build.json`, `src/main.ts`, `src/app.module.ts`. Use `npx @nestjs/cli new . --skip-git --skip-install --package-manager npm` and then delete the generated `src/app.controller.ts`, `src/app.service.ts`, `src/app.controller.spec.ts`, and the `test/` directory — none of them are in scope
- [X] T002 Install runtime dependencies in `api/package.json`: `@nestjs/common @nestjs/core @nestjs/platform-express @nestjs/config @nestjs/terminus @nestjs/typeorm typeorm pg zod dotenv reflect-metadata rxjs`
- [X] T003 [P] Install dev dependencies in `api/package.json`: `@nestjs/cli typescript ts-node @types/node @types/express`. Do **not** install any test framework — none is in scope
- [X] T004 [P] Set `"strict": true` in `api/tsconfig.json` along with `strictNullChecks`, `noImplicitAny`, `noUncheckedIndexedAccess`, and `forceConsistentCasingInFileNames`. Nest's generated tsconfig ships with strict off — flipping it is FR-020 and it must happen before any source is written, or the codebase accumulates errors that get "fixed" by loosening the setting back
- [X] T005 [P] Create `api/.dockerignore` excluding `node_modules`, `dist`, `.git`, `specs`, `docs`, `*.md` — the bind mount and the build context must not fight
- [X] T006 [P] Remove test-related scripts from `api/package.json` (`test`, `test:watch`, `test:cov`, `test:e2e`) and add `"engines": { "node": ">=22" }`

**Checkpoint**: `npm run build` succeeds on an empty-but-strict project.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The config layer and the single `DataSource` — everything below depends
on both.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [X] T007 Create `api/src/config/env.schema.ts` — a Zod schema covering **every** key in [`contracts/config-schema.md`](./contracts/config-schema.md): core (`DATABASE_URL`, `PORT` default 3000, `NODE_ENV` default `development`), chain (RPC URL, chain id, explorer URL, `USDC_ADDRESS`, `ESCROW_CONTRACT_ADDRESS`, the operator/guardian/funder address+key pairs), LLM (`ANTHROPIC_API_KEY`), Rain (6 keys, `RAIN_ENABLED` coerced boolean), tuning (`REVIEW_WINDOW_SECONDS` int ≥ 1, `SWEEPER_INTERVAL_MS` positive int). Addresses `/^0x[a-fA-F0-9]{40}$/`, private keys `/^0x[a-fA-F0-9]{64}$/`. Coerce numbers and booleans at the boundary so `AppConfig` carries real types. Export `type AppConfig = z.infer<typeof envSchema>`. **Do not include `DEPLOYER_PRIVATE_KEY`** — see [research.md R8](./research.md)
- [X] T008 Create `api/src/config/config.module.ts` — `ConfigModule.forRoot({ isGlobal: true, envFilePath: '../.env', validate })` where `validate` calls the T007 schema. `envFilePath` resolves to the repository-root `.env` when run from `api/`, and is harmlessly absent inside Docker where Compose supplies the values through `env_file` (see [research.md R3](./research.md))
- [X] T009 Create `api/src/data-source.ts` — call `dotenv.config({ path: resolve(__dirname, '../../.env') })` at the top **before** reading `process.env` (the TypeORM CLI boots this file with no Nest lifecycle to load config first). Export named `dataSourceOptions: DataSourceOptions` with `type: 'postgres'`, `url: process.env.DATABASE_URL`, **`synchronize: false`**, `migrationsRun: false`, `entities: [__dirname + '/**/*.entity{.ts,.js}']`, `migrations: [__dirname + '/migrations/*{.ts,.js}']`, `logging: ['error', 'warn']`. Export `default new DataSource(dataSourceOptions)` for the CLI
- [X] T010 Create `api/src/database/database.module.ts` — `TypeOrmModule.forRoot(dataSourceOptions)` importing the named export from T009. Do **not** rebuild the options from `ConfigService`; one object, two consumers, no drift
- [X] T011 Wire `api/src/app.module.ts` to import `AppConfigModule` and `DatabaseModule`
- [X] T012 Rewrite `api/src/main.ts` — bootstrap, read `PORT` from the validated config, `await app.listen(port)`. Wrap the bootstrap in a `.catch()` that writes the error to stderr and calls `process.exit(1)`; the richer formatting lands in T019

**Checkpoint**: `npm run start:dev` against a reachable Postgres boots and stays up.

---

## Phase 3: User Story 1 — Cold start yields a live service (Priority: P1) 🎯 MVP

**Goal**: One command from a cold machine to a `/health` that reports a confirmed
database round-trip.

**Independent Test**: `docker compose down -v && docker compose up`, then
`curl http://localhost:3000/health` returns 200 with `database: up`.

- [X] T013 [P] [US1] Create `api/src/health/health.module.ts` — imports `TerminusModule` and `TypeOrmModule`, declares `HealthController`
- [X] T014 [US1] Create `api/src/health/health.controller.ts` — `@Get('health')` with `@HealthCheck()`, running `TypeOrmHealthIndicator.pingCheck('database', { timeout: 1500 })`. No auth guard, now or ever (FR-001). Response envelope must match [`contracts/health.openapi.yaml`](./contracts/health.openapi.yaml): 200 when up, **503** when down
- [X] T015 [US1] Register `HealthModule` in `api/src/app.module.ts`
- [X] T016 [US1] Create `api/Dockerfile` — single stage on `node:24-alpine`, `WORKDIR /app`, copy `package*.json`, `npm ci` installing **all** dependencies including dev (the migration script needs `ts-node` at runtime — a pruned production image cannot run it), copy the source, `EXPOSE 3000`, `CMD ["npm", "run", "start:dev"]`
- [X] T017 [US1] Create `api/docker-compose.yml` with two services for now — `postgres` (`postgres:16-alpine`, user/password/db all `postgres`/`postgres`/`guardian`, `pgdata` named volume, ports `5432:5432`, **healthcheck** `pg_isready -U postgres` at 3s × 10 retries) and `api` (`build: .`, `env_file: ../.env`, **`DATABASE_URL` overridden** to `postgresql://postgres:postgres@postgres:5432/guardian` — host `postgres`, not `localhost`, per FR-018 — ports `3000:3000`, `depends_on: postgres: { condition: service_healthy }`, volume `./src:/app/src` for reload). The `migrate` service is added in T024
- [X] T018 [US1] Run [quickstart.md Scenario A](./quickstart.md) — A (cold start under 90 s), A2 (warm restart under 30 s), A3 (three consecutive cold cycles) — and D1 (stop Postgres, confirm `/health` returns 503, restart, confirm 200). A 200 while Postgres is stopped is a hard failure

**Checkpoint**: `docker compose up` from cold yields a responding `/health`. This is the
feature's headline acceptance criterion and a complete MVP on its own.

---

## Phase 4: User Story 2 — Misconfiguration fails loudly at boot (Priority: P2)

**Goal**: A wrong `.env` stops the service with a message that names every offending
key and leaks no secrets.

**Independent Test**: Blank `DATABASE_URL` and set `PORT=abc` together; one start must
name both, exit non-zero, and print neither value.

- [X] T019 [US2] Create `api/src/config/format-errors.ts` — turn a `ZodError` into a multi-line report, one line per issue as `KEY: expected <form>`. Iterate **all** of `error.issues`, not just the first (FR-007). Print the key path and the expected form only — **never** `issue.received` or any value, because `DATABASE_URL` holds a password and `*_PRIVATE_KEY` holds a private key, and a validation failure is exactly where naive code echoes what it got (FR-009)
- [X] T020 [US2] Wire T019 into the `validate` function in `api/src/config/config.module.ts` — on `safeParse` failure, write the formatted report to `process.stderr` and throw. Confirm the report reaches stderr rather than being swallowed by Nest's exception rendering; the Nest logger does not exist yet at validation time
- [X] T021 [US2] Confirm `api/src/main.ts` exits non-zero on a config failure and that no partial startup happens — no port bound, no database connection attempted
- [X] T022 [US2] Create `api/src/config/detect-placeholders.ts` and call it from bootstrap after validation succeeds — match each value against `/^0xDEAD0+\d{4}$/` (addresses and keys) and an `sk-ant-placeholder` prefix, then emit **one** `Logger.warn` naming every key still holding a fake. **Names only, never values.** Must not block boot. Rationale in [research.md R9](./research.md) — a fake private key is a valid secp256k1 scalar, so without this the failure surfaces much later as an unfunded-account error on-chain that looks nothing like a config problem
- [X] T023 [US2] Run [quickstart.md Scenario B](./quickstart.md) end to end — B1 missing key, B2 malformed, B3 multiple-at-once, **B3b the full-key sweep** (blank each of the 15 platform keys in turn, confirm each is named), B3c `grep -rn DEPLOYER src/` returns nothing, B4 no secret in any output, B5 `process.env` appears only in `env.schema.ts` and `data-source.ts`, B6 the placeholder warning fires and goes quiet per-key when a value becomes real

**Checkpoint**: Every configuration key is enforced and every failure is legible.

---

## Phase 5: User Story 3 — Schema changes are an explicit, reviewable step (Priority: P3)

**Goal**: Migrations run as their own one-shot step that must exit 0 before the API
starts, and the running service never touches schema.

**Independent Test**: `docker compose ps -a` shows `migrate` `exited (0)` and `api`
started after it; a database shape diff across an API restart is empty.

- [X] T024 [P] [US3] Add the three scripts to `api/package.json`: `migration:generate` → `typeorm-ts-node-commonjs migration:generate -d src/data-source.ts`, `migration:run` → `... migration:run -d src/data-source.ts`, `migration:revert` → `... migration:revert -d src/data-source.ts`. Exit semantics are contractual — see [`contracts/commands.md`](./contracts/commands.md); in particular `migration:run` must exit **0** when nothing is pending, because the `api` service gates on it and a non-zero "nothing to do" would deadlock every restart
- [X] T025 [P] [US3] Create `api/src/migrations/.gitkeep` so the directory exists and the `migrations` glob in `data-source.ts` resolves on a fresh clone
- [X] T026 [US3] Add the `migrate` service to `api/docker-compose.yml` — `build: .`, `env_file: ../.env`, the same `DATABASE_URL` override, `command: ["npm", "run", "migration:run"]`, `depends_on: postgres: { condition: service_healthy }`. One-shot: it runs and exits. Reuses the T016 image so `migrate` and `api` are guaranteed to be the same code
- [X] T027 [US3] Extend the `api` service's `depends_on` in `api/docker-compose.yml` to add `migrate: { condition: service_completed_successfully }`. This clause is what makes a failed migration stop the API instead of letting it serve against a half-migrated schema (FR-017)
- [X] T028 [US3] Verify by inspection that `api/src/data-source.ts` still has `synchronize: false` and `migrationsRun: false`. This is the non-negotiable invariant — left true, TypeORM reshapes the schema to match entities and the migrations become decoration
- [X] T029 [US3] Run [quickstart.md Scenario C](./quickstart.md) — C1 ordering (`migrate` exits 0 before `api` starts), C2 a failing migration prevents `api` from starting, C3 schema diff across an API restart is empty, C4 `migration:run` is idempotent and `migration:revert` works

**Checkpoint**: All three stories independently functional. The foundation is done.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [X] T030 [P] Add a placeholder-convention note to `../.env.example` documenting the `0xDEAD…` + role-digit scheme and the `TODO(placeholder)` marker, so the convention survives someone regenerating their `.env` from the template
- [X] T031 [P] Write `api/README.md` — the two run modes (Compose and host), the command table from [`contracts/commands.md`](./contracts/commands.md), and the placeholder audit (`grep -n 'TODO(placeholder)' ../.env`)
- [X] T032 [P] Run [quickstart.md Scenario D](./quickstart.md) edge cases not yet covered — D2 host run against a local Postgres with no code change, D3 port-in-use fails clearly rather than hanging, D4 a deliberate type error fails `npm run build`
- [X] T033 Complete the [quickstart.md sign-off checklist](./quickstart.md) — all 9 rows, SC-001 through SC-008 plus FR-010 and R9. Treat a failure here the way you'd treat a red build
- [X] T034 Confirm `api/src/` contains no `tests/` directory and no test scaffolding left over from T001 — an empty test tree implies a suite that does not exist

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: no dependencies
- **Foundational (Phase 2)**: needs Setup — **blocks all stories**
- **US1 (Phase 3)**: needs Foundational
- **US2 (Phase 4)**: needs Foundational. Independent of US1 in code, but running its verification is easier once the stack comes up
- **US3 (Phase 5)**: needs Foundational **and T017** — it edits the `docker-compose.yml` that US1 creates
- **Polish (Phase 6)**: needs the stories you intend to ship

### The one real cross-story dependency

`api/docker-compose.yml` is a single file touched by both US1 (T017: `postgres` + `api`)
and US3 (T026, T027: `migrate` + the gating clause). They cannot run in parallel. If
US3 must start before US1 finishes, have T017 write the full three-service file up
front and let T026/T027 verify rather than edit.

### Within each story

- Modules before controllers; controllers before registration in `app.module.ts`
- Source before Dockerfile before Compose
- Implementation before its verification task (T018, T023, T029 each close their story)

### Parallel Opportunities

- **Phase 1**: T003, T004, T005, T006 are all different files — run together after T001/T002
- **Phase 2**: T007 and T009 touch different files and can start together; T008 needs T007, T010 needs T009, T011 needs both
- **Phase 5**: T024 (`package.json`) and T025 (`src/migrations/`) are independent
- **Phase 6**: T030, T031, T032 are independent
- **Across stories**: once Phase 2 lands, one developer can take US1 (T013–T018) while another takes US2 (T019–T023) — different directories, no shared file

---

## Parallel Example: Phase 1

```bash
# After T001 (scaffold) and T002 (runtime deps):
Task: "Install dev dependencies in api/package.json"
Task: "Set strict:true in api/tsconfig.json"
Task: "Create api/.dockerignore"
Task: "Remove test scripts from api/package.json and add engines field"
```

## Parallel Example: Phase 2

```bash
# T007 and T009 are different files with no shared imports:
Task: "Create api/src/config/env.schema.ts with the full platform Zod schema"
Task: "Create api/src/data-source.ts with dotenv + synchronize:false"
```

---

## Implementation Strategy

### MVP First (User Story 1 only)

1. Phase 1: Setup (T001–T006)
2. Phase 2: Foundational (T007–T012) — blocks everything
3. Phase 3: US1 (T013–T018)
4. **STOP and VALIDATE**: `docker compose down -v && docker compose up` → `/health` 200

That is bootstrap step 4 in [`docs/project-structure.md`](../../../docs/project-structure.md) §6
complete, and it unblocks API-02.

### Incremental Delivery

1. Setup + Foundational → the project compiles and boots
2. + US1 → **`docker compose up` works. MVP.**
3. + US2 → misconfiguration is legible; the placeholder warning is live
4. + US3 → migrations are explicit and gate the API
5. + Polish → sign-off checklist green

### Cheapest ordering shortcut

If time is tight, T022 (placeholder detection) is the single highest-value task in US2
— it is ~15 lines and it converts the most expensive failure mode in this setup (a
fake key failing on-chain, mid-rehearsal, looking like a funding bug) into a line you
read at boot. Do it even if the rest of US2 slips.

---

## Notes

- **No test tasks by design.** Verification is T018, T023, T029, T032, T033 — run by
  hand against [quickstart.md](./quickstart.md). The demo rehearsal is the real suite
- `[P]` = different files, no dependencies
- Commit after each task or logical group
- Three things in here are load-bearing and quietly catastrophic if dropped:
  **`synchronize: false`** (T009, T028), **the Postgres healthcheck** (T017), and
  **`service_completed_successfully`** (T027)
