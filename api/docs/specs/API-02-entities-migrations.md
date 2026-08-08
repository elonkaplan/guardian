# API-02 — Entities & the initial migration

**Component:** `api/` · **Depends on:** API-01 · **Size:** Medium

> **Feed this file to `/speckit-specify`.** Read [`../CONTEXT.md`](../CONTEXT.md)
> first — it carries the nine backend invariants this spec assumes.

## Goal

The eight tables, as TypeORM entities plus a hand-written initial migration.

## In scope

- Entities: `accounts`, `agents`, `agent_versions`, `orders`, `runs`, `complaints`,
  `verdicts`, `ledger_entries`
- Enums: `ledger_kind` (`onramp`/`purchase`/`offramp`/`adjustment`), `order_state`
  (8 values), `verdict_tier` (5 values)
- All indexes — especially `orders (state, delivered_at)`, the sweeper's
- The `lower(wallet_address)` unique index
- A repository helper for available balance: `SUM(amount_minor)`

## Out of scope

**Automated tests of any kind** (MVP decision — see `../CONTEXT.md`). Plus:

Services, controllers, business rules. Entities and schema only.

## Acceptance

- `migration:run` builds the whole schema from empty
- The three UNIQUE constraints reject their duplicates
- Balance is computed by `SUM`, with **no cached balance column anywhere**

## Watch out for

- **Write the migration from the DDL, not from entity inference.** The enums, the
  functional unique index, and the constraints are all easier to write directly than
  to coax out of decorators.
- **Three UNIQUEs are product rules, not hygiene**: `complaints.order_id` (one
  complaint per order), `verdicts.order_id` (no appeals), `runs.order_id` (one
  execution per purchase). Enforced by the database so no service can violate them.
- **All money columns are `BIGINT` in USD cents.** Token base units appear only in
  the chain adapter.
- `orders` references `agent_version_id`, **never `agent_id`** — that's what makes
  "judged against the version that ran" true by construction.

## Source

`../../../docs/database-schema.md` §2–§8.
