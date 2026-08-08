# Implementation Plan: API Foundation

**Branch**: `001-api-foundation` | **Date**: 2026-08-08 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-api-foundation/spec.md`

## Summary

Stand up the `api/` service so that one command from a cold machine yields a NestJS
process answering `GET /health` with a confirmed database round-trip. Three pieces of
plumbing carry the weight, and every later spec assumes all three:

1. **A Zod-validated environment layer** parsed once at boot from the repository-root
   `.env`, covering **every** platform key (FR-010) and failing with a non-zero exit
   that names every offending one — exposing the result as a typed object with no
   optional members, so no consumer ever handles a missing key at point of use.
2. **A single `DataSource` definition** shared by the running application and the
   TypeORM CLI, with `synchronize: false` — migrations are the only mechanism that
   ever touches schema.
3. **A three-service Compose stack** — `postgres` (healthcheck) → `migrate` (one-shot,
   must exit 0) → `api` — so `docker compose up` stays one command while schema
   changes remain an explicit, reviewable artifact.

No entities, no domain logic, no chain access, no automated tests (project decision).

## Technical Context

**Language/Version**: TypeScript 5.x on Node.js 24 LTS in-container; Node 26.7 is what
the developer has locally and both work — nothing here uses version-gated APIs.

**Primary Dependencies**: NestJS 11 (`@nestjs/common`, `core`, `config`, `terminus`),
TypeORM 0.3.x + `pg`, Zod 4 (already the project's validation library — the Anthropic
SDK's `messages.parse()` uses it, so config validation adds no new dependency).

**Storage**: PostgreSQL 16 (`postgres:16-alpine`), reached over a single
`DATABASE_URL`. No schema content in this feature.

**Testing**: None. Automated tests of any kind are out of scope for this component per
[`docs/CONTEXT.md`](../../docs/CONTEXT.md); verification is the manual script in
[quickstart.md](./quickstart.md).

**Target Platform**: Linux containers via Docker Compose; also runs directly on the
developer's macOS host against a local Postgres.

**Project Type**: Single backend web service.

**Performance Goals**: Cold start to healthy `/health` under 90s excluding image
pulls (SC-002); warm restart under 30s (SC-003); `/health` itself is a single
`SELECT 1` and should answer in single-digit milliseconds.

**Constraints**: `synchronize: false` is non-negotiable. Secrets must never reach
logs. One `.env`, at the repository root, shared with `ui/` and `sc/`. Development
posture only — source is bind-mounted for reload, the Postgres port is published, no
TLS, no secret manager.

**Scale/Scope**: One developer machine, one demo. Roughly a dozen source files.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

`.specify/memory/constitution.md` is the **unmodified Spec Kit template** — every
principle is still a `[PRINCIPLE_N_NAME]` placeholder. There are no ratified gates to
evaluate.

| Gate | Status |
| --- | --- |
| Constitution defines enforceable principles | ⚠️ Not ratified — template placeholders only |
| Design violates a ratified principle | N/A — none exist |

**Result: PASS (vacuous).** Recorded so the gap is a known state rather than an
oversight. The de facto governance for this component is the nine invariants in
[`docs/CONTEXT.md`](../../docs/CONTEXT.md) §2; of those, only **#9 (`orders.state` is
the queue — no Redis, no BullMQ)** touches this feature, and the plan honors it: the
stack introduces no queue or broker, only Postgres.

**Post-Phase-1 re-check: PASS.** The design adds no project, no queue, no cache, and
no abstraction layer beyond what NestJS supplies. Complexity Tracking is empty.

## Project Structure

### Documentation (this feature)

```text
specs/001-api-foundation/
├── plan.md              # This file
├── research.md          # Phase 0 output — 8 decisions with rationale
├── data-model.md        # Phase 1 output — config set, migration record, health report
├── quickstart.md        # Phase 1 output — the manual verification script
├── contracts/
│   ├── health.openapi.yaml   # GET /health request/response contract
│   ├── config-schema.md      # Every env key: type, required-when, secret flag
│   └── commands.md           # npm scripts + compose commands and their exit semantics
├── checklists/
│   └── requirements.md  # Spec quality checklist (all 16 items pass)
└── tasks.md             # Phase 2 output (/speckit-tasks — NOT created here)
```

### Source Code (repository root)

```text
guardian/
├── .env                          # already exists — the single source of config
├── .env.example                  # already exists — the committed key template
└── api/
    ├── src/
    │   ├── main.ts               # bootstrap; exits non-zero on config failure
    │   ├── app.module.ts         # imports ConfigModule, DatabaseModule, HealthModule
    │   ├── data-source.ts        # THE DataSource — used by Nest and by the CLI
    │   ├── migrations/           # generated migrations land here (empty in API-01)
    │   ├── config/
    │   │   ├── env.schema.ts     # Zod schema + AppConfig type + validate()
    │   │   └── config.module.ts  # global ConfigModule.forRoot({ validate })
    │   ├── database/
    │   │   └── database.module.ts  # TypeOrmModule.forRootAsync from data-source.ts
    │   └── health/
    │       ├── health.module.ts
    │       └── health.controller.ts  # GET /health via Terminus + TypeORM ping
    ├── Dockerfile                # single-stage dev image, all deps present
    ├── docker-compose.yml        # postgres → migrate → api
    ├── .dockerignore
    ├── package.json              # migration:generate / :run / :revert
    ├── tsconfig.json             # strict: true
    └── nest-cli.json
```

**Structure Decision**: Single project rooted at `api/`, matching the layout already
fixed in [`docs/project-structure.md`](../../../docs/project-structure.md) §2. No
`tests/` tree is created — automated tests are out of scope for this component, and an
empty scaffold directory would imply otherwise. `data-source.ts` sits at `src/` root
(not under `database/`) because the documented CLI scripts already reference
`-d src/data-source.ts`; the future domain modules (`auth/`, `orders/`, `chain/`, …)
slot in beside `config/`, `database/`, and `health/` without rearranging anything.

## FR-010: full enforcement, with a placeholder guard

**FR-010 is implemented literally.** Every platform key — chain endpoint and IDs,
contract and token addresses, all four wallet keypairs, the Anthropic key, the Rain
block, the product-tuning values — is required and format-validated at boot. The
schema in `src/config/env.schema.ts` matches
[`contracts/config-schema.md`](./contracts/config-schema.md) row for row, so no later
spec revisits config plumbing. `AppConfig` has no optional members, satisfying FR-008
for every key at once.

This is possible because the repository-root `.env` is now fully populated: the values
that were empty (`ESCROW_CONTRACT_ADDRESS`, the four keypairs, `ANTHROPIC_API_KEY`)
carry **format-valid placeholders** pending the `sc/` deploy — fake hex beginning
`0xDEAD` and ending in a role-identifying digit run, each line tagged
`# TODO(placeholder)`.

**The cost of that choice, and the mitigation.** A placeholder that satisfies a regex
buys a passing boot at the price of a later failure that is further from its cause: a
fake operator key is a valid secp256k1 scalar, so `viem` will happily derive an
address, sign a transaction, and fail on-chain with an unfunded-account error that
looks nothing like "you forgot to fill the `.env`". So the config layer adds one
cheap thing FR-010 alone would not give:

> **Boot-time placeholder detection.** After validation succeeds, the config layer
> matches each value against the known placeholder patterns (`/^0xDEAD0+\d{4}$/` for
> addresses and keys, an `sk-ant-placeholder` prefix for the Anthropic key) and, if
> any match, emits a single loud `WARN` at startup listing **the key names still
> holding placeholders**. Names only — never values (FR-009). It does not block boot.

That turns the confusing on-chain failure back into a message the developer saw the
moment they started the service. It is roughly fifteen lines and it is the only reason
the placeholder approach is safe.

**Definition of done for the placeholders**: `grep -n 'TODO(placeholder)' ../.env`
returns nothing, and the boot warning is silent. Until both are true, no chain or LLM
path can work — by construction, not by accident.

## Complexity Tracking

> No Constitution Check violations. Table intentionally empty.
