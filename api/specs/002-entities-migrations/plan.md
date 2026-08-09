# Implementation Plan: Entities & Initial Migration

**Branch**: `002-entities-migrations` | **Date**: 2026-08-08 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/002-entities-migrations/spec.md`

## Summary

Eight tables, three enum types, nine indexes, and every constraint — delivered as one
hand-written migration plus eight TypeORM entities that agree with it.

The migration is transcribed from the DDL in
[`docs/database-schema.md`](../../../docs/database-schema.md) §8, **not** generated
from the entities. Three things in that DDL do not survive decorator inference
faithfully — the named enum types, the `lower(wallet_address)` functional unique
index, and the `CHECK` constraints — and they are exactly the parts that encode
product rules. Writing the SQL and then making the entities match is the direction
that keeps them.

One small piece of behavior ships with it: a balance helper that returns
`COALESCE(SUM(amount_minor), 0)` for an account. No cached column, anywhere.

## Technical Context

**Language/Version**: TypeScript on Node 24 (container) / 26 (host), compiled by
TypeScript 6.0.3 — pinned in API-01, see that feature's research R11.

**Primary Dependencies**: TypeORM 1.1.0 + `pg`. No new dependencies; every package
this feature needs was installed by API-01.

**Storage**: PostgreSQL 16. Eight tables, three enum types, nine indexes.

**Testing**: None. Automated tests are out of scope for this component per
[`docs/CONTEXT.md`](../../docs/CONTEXT.md); verification is the SQL script in
[quickstart.md](./quickstart.md), most of it insert-and-expect-rejection.

**Target Platform**: Linux container via Compose; also runs on the host.

**Performance Goals**: Not a performance feature. The one index that matters is
`orders (state, delivered_at)` — the sweeper re-runs it every few seconds through the
whole demo.

**Constraints**: `synchronize: false` stays off (API-01 FR-012). Money is `BIGINT` USD
cents everywhere; token base units never appear. No cached balance column. Orders
reference `agent_version_id`, never `agent_id`.

**Scale/Scope**: Demo scale — hundreds of rows. Eight entity files, one enum file, one
transformer, one repository, one migration.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

`.specify/memory/constitution.md` is still the unmodified Spec Kit template — all
`[PRINCIPLE_N_NAME]` placeholders, no ratified principles. **Result: PASS (vacuous)**,
recorded as a known gap rather than an oversight, exactly as in API-01.

The governance that actually binds here is the nine invariants in
[`docs/CONTEXT.md`](../../docs/CONTEXT.md) §2. This feature touches six of them, and
each is discharged by a specific artifact:

| Invariant | How this feature satisfies it |
| --- | --- |
| #2 One money unit: USD cents | Every amount column is `BIGINT` cents; no base-unit column exists ([data-model.md](./data-model.md)) |
| #3 `system_prompt` never reaches a buyer | Column carries an explicit restricted marker; the serialiser is API-06's job, not this one |
| #4 The ledger is append-only | No `UPDATE` path modelled, no balance column, balance is `SUM` |
| #5 Settlement writes no ledger entry | `ledger_kind` has four values and `settlement` is deliberately not one |
| #6 Orders point at `agent_version_id` | FK is to `agent_versions`; there is no `agent_id` column on `orders` |
| #7 `runs.output IS NULL` is evidence | `output` is nullable by design; `runs.order_id` is UNIQUE so nothing can retry over it |

**Post-Phase-1 re-check: PASS.** No new project, no queue, no cache, no abstraction
beyond entities and one repository. Complexity Tracking is empty.

## Project Structure

### Documentation (this feature)

```text
specs/002-entities-migrations/
├── plan.md              # This file
├── research.md          # Phase 0 — 9 decisions, mostly TypeORM/DDL fidelity
├── data-model.md        # Phase 1 — all 8 tables, column by column
├── quickstart.md        # Phase 1 — the manual verification SQL
├── contracts/
│   ├── schema.sql            # The authoritative DDL this migration must produce
│   └── repository-api.md     # The balance helper's signature and semantics
├── checklists/
│   └── requirements.md  # Spec quality checklist (16/16 pass)
└── tasks.md             # Phase 2 (/speckit-tasks — NOT created here)
```

### Source Code (repository root)

```text
api/src/
├── entities/                        # NEW — all eight, one file each
│   ├── enums.ts                     # ledger_kind · order_state · verdict_tier
│   ├── transformers.ts              # bigint ⇄ number, one place
│   ├── account.entity.ts
│   ├── ledger-entry.entity.ts
│   ├── agent.entity.ts
│   ├── agent-version.entity.ts
│   ├── order.entity.ts
│   ├── run.entity.ts
│   ├── complaint.entity.ts
│   └── verdict.entity.ts
├── ledger/                          # NEW — the one behavior in this feature
│   ├── ledger.module.ts
│   └── balance.repository.ts        # COALESCE(SUM(amount_minor), 0)
├── migrations/
│   └── 17xxxxxxxxxxxx-InitialSchema.ts   # NEW — hand-written from contracts/schema.sql
├── data-source.ts                   # MODIFIED — register entities, uuidExtension
├── app.module.ts                    # MODIFIED — import LedgerModule
├── config/                          # unchanged
├── database/                        # unchanged
└── health/                          # unchanged
```

**Structure Decision**: entities live in a flat `src/entities/`, not colocated into
`accounts/`, `catalog/`, `orders/` — those modules do not exist yet, and inventing
them now to hold a file each would be structure invented ahead of its content. The
existing `entities: [__dirname + '/**/*.entity{.ts,.js}']` glob from API-01 already
picks them up wherever they sit, so a later move is a move, not a rewrite. `ledger/`
is created as a real module because API-05 will build directly on top of it.

## Complexity Tracking

> No Constitution Check violations. Table intentionally empty.
