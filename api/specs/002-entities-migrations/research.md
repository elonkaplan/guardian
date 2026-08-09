# Phase 0 Research: Entities & Initial Migration

Nine decisions. Most are about one question: **where TypeORM's decorators and the
hand-written DDL disagree, and which one wins.** The DDL wins every time; these
decisions are how the entities are made to agree with it.

---

## R1 — `BIGINT` money reaches JavaScript as a string

**Decision**: every `bigint` money column gets a transformer that converts to
`number` on read and back on write. One shared transformer in
`src/entities/transformers.ts`; no column declares its own.

**Rationale**: the `pg` driver returns `BIGINT` as a **string**, because a Postgres
`bigint` can exceed `Number.MAX_SAFE_INTEGER`. Left alone, `price_minor` is `"200"`
and `total + entry.amountMinor` silently produces `"2000200"`. That is a money bug
that type-checks.

Converting to `number` is safe here and the arithmetic is worth the check: cents in a
`number` are exact up to 9,007,199,254,740,991 — about **$90 trillion**. The demo
deals in dollars. `BIGINT` stays the storage type because changing it later means a
migration on live data; the ceiling is the database's, not JavaScript's.

**Alternatives considered**: `BigInt` throughout (correct, and it poisons every
arithmetic site, JSON serialisation, and the Zod schemas downstream for a range we
will never reach); leaving strings and converting at each use site (the same
conversion written twenty times, nineteen of them eventually).

**Applies to**: `ledger_entries.amount_minor`, `agent_versions.price_minor`,
`orders.price_minor`, `verdicts.refund_minor`, and the two on-chain id columns
`agents.onchain_agent_id`, `orders.onchain_deal_id`.

---

## R2 — `gen_random_uuid()`, and TypeORM's misleading flag for it

**Decision**: set `uuidExtension: 'pgcrypto'` in `dataSourceOptions`. Do **not**
create the pgcrypto extension.

**Rationale**: verified by reading the installed driver —
`PostgresDriver.uuidGenerator` returns `gen_random_uuid()` when `uuidExtension` is
`'pgcrypto'` and `uuid_generate_v4()` otherwise. The DDL specifies
`gen_random_uuid()`, so without the flag every entity's generated default disagrees
with the migration and the drift check (SC-009) fails on all eight tables.

The flag name is a leftover. Verified live against this project's Postgres 16:

```
SELECT gen_random_uuid();            -- works
SELECT extname FROM pg_extension;    -- plpgsql only
```

`gen_random_uuid()` has been core since Postgres 13. **The `CREATE EXTENSION IF NOT
EXISTS "pgcrypto"` line in the source DDL is unnecessary and is dropped** — an
extension nobody needs is a permission requirement and a portability footgun for
nothing.

**Alternatives considered**: generating UUIDs in the application (loses the property
that a hand-inserted debugging row is as valid as an application row — FR-006);
keeping pgcrypto for literal fidelity to the source DDL (fidelity to a line that was
itself unnecessary).

---

## R3 — The `lower(wallet_address)` functional index is migration-only

**Decision**: create it in the migration as raw SQL. The `Account` entity declares
**no** unique constraint on `walletAddress` at all, and carries a comment saying why.

**Rationale**: TypeORM's metadata cannot express a functional index. If the entity
declared `@Index({ unique: true })` on the column, `migration:generate` would want a
plain `UNIQUE (wallet_address)` — which is **case-sensitive**, and would let
`0xAbC…` and `0xabc…` both register as separate accounts. That is precisely the bug
FR-010 exists to prevent, arriving through the door marked "correctness".

**Predicted noisy, measured clean.** This decision anticipated that TypeORM would
propose *dropping* `accounts_wallet_lower_idx` as an object it does not understand.
Running the check against the real schema showed it does **not** — TypeORM ignores the
functional index entirely rather than trying to remove it. The drift check reports no
changes at all (see R10). The entity comment stays, because the reason not to add a
plain unique constraint is unchanged.

**Alternatives considered**: storing the address lowercased and making it a plain
UNIQUE (loses the checksummed casing, which is the payout address and what a user
recognises on an explorer); a `CHECK (wallet_address = lower(wallet_address))` plus
plain UNIQUE (same loss, more machinery); a database trigger (a trigger to enforce
what an index already enforces).

---

## R4 — Named enum types, declared once

**Decision**: create the three types in the migration with `CREATE TYPE`. Entities use
`@Column({ type: 'enum', enum: <TsEnum>, enumName: '<pg_type_name>' })`.

**Rationale**: `enumName` is what makes TypeORM bind to the existing named type. Omit
it and TypeORM invents a per-column type — `orders_state_enum` — so the migration's
`order_state` sits unused beside an auto-created near-duplicate, and every later table
that wants the same type gets its own copy.

Enum **value order matters** and must match the DDL exactly: Postgres orders enum
values by declaration, and `ORDER BY state` would silently change meaning if the TS
enum were reordered.

**Alternatives considered**: `text` columns with a `CHECK` constraint (portable, and
throws away the type Postgres already gives us); TypeORM's `simple-enum` (stores as
varchar — same loss).

---

## R5 — `CHECK` constraints belong to the migration

**Decision**: all five `CHECK`s live in the migration SQL. Entities carry
`@Check(...)` decorators mirroring them **only** where it costs nothing; the migration
is authoritative.

**Rationale**: `price_minor > 0`, `review_window_seconds > 0`, and
`refund_minor >= 0` are product rules — a zero review window collapses the dispute
window entirely (see [`docs/smart-contract.md`](../../../docs/smart-contract.md)
§11.3), and a zero-price agent breaks the escrow's arithmetic. They are enforced in
the database so that no service, present or future, can write a violating row.

**Alternatives considered**: validating in the application layer only (every future
write path has to remember; one forgetting is a demo with a broken order).

---

## R6 — Column type mappings, decided once

| DDL type | Entity declaration | Note |
| --- | --- | --- |
| `uuid` PK | `@PrimaryGeneratedColumn('uuid')` | With R2's flag, emits `gen_random_uuid()` |
| `bigint` | `{ type: 'bigint', transformer: bigintTransformer }` | R1 |
| `int` | `{ type: 'int' }` | `version`, `timeout_seconds`, `review_window_seconds`, `duration_ms` — no transformer needed |
| `text` | `{ type: 'text' }` | Never `varchar`; the DDL has no length limits |
| `text[]` | `{ type: 'text', array: true }` | `capabilities`, `exclusions` — NOT NULL, may be empty |
| `jsonb` | `{ type: 'jsonb' }` | `input_schema`, `output_schema`, `steps`, `citations`, `input`, `output` |
| `bytea` | `{ type: 'bytea' }` → `Buffer` | `definition_hash`, `verdict_hash` — 32-byte keccak256 |
| `bool` | `{ type: 'boolean' }` | `active` NOT NULL, `output_valid` nullable |
| `timestamptz` | `{ type: 'timestamptz' }` | Always `timestamptz`, never `timestamp` |

**On `bytea` vs `text`**: hashes are stored as raw bytes, not hex strings. It halves
the storage, it makes "is this 32 bytes" a type-level fact, and the chain adapter
already deals in `0x`-prefixed hex at its own boundary — the conversion belongs there,
with the other one.

**On nullable `jsonb`**: `runs.output` is nullable and that nullability is load-bearing
— invariant #7 says `output IS NULL` **is** the non-delivery evidence. The entity must
declare `nullable: true`, and nothing may ever default it to `{}`.

---

## R7 — Timestamp defaults come from the database

**Decision**: `created_at` and `runs.started_at` use `default: () => 'now()'` in the
entity, matching `DEFAULT now()` in the DDL. No `@CreateDateColumn`.

**Rationale**: `@CreateDateColumn` makes TypeORM set the value from the *application's*
clock on insert, which means a row inserted by hand during debugging has no timestamp
and a row inserted by two processes uses two clocks. `DEFAULT now()` puts it in one
place — the database — and satisfies FR-006 literally.

---

## R8 — The balance helper is a repository, and returns a number

**Decision**: `BalanceRepository.getAvailableBalanceMinor(accountId): Promise<number>`,
implemented as `SELECT COALESCE(SUM(amount_minor), 0)` via the query builder,
provided by a small `LedgerModule`.

**Rationale**: FR-017 wants zero rather than `null` for an account with no entries, so
the `COALESCE` is part of the contract, not an implementation detail — it is the
difference between "this account has nothing" and "this account does not exist", and
only the first is true.

`SUM(bigint)` returns `numeric`, which `pg` hands back as a string; the same
conversion as R1 applies, in the repository rather than in a transformer.

Placing it in its own module gives API-05 (accounts, ledger, funding) an obvious place
to build, rather than a helper stranded in `database/`.

**Alternatives considered**: a static method on the entity (untestable, uninjectable,
and it drags the DataSource into the entity file); a database view (a second thing to
migrate for one query).

---

## R9 — Entities register explicitly; the glob stays as a safety net

**Decision**: list all eight entity classes explicitly in `dataSourceOptions.entities`,
replacing the `__dirname + '/**/*.entity{.ts,.js}'` glob from API-01.

**Rationale**: the glob is resolved at runtime against the *compiled* directory
layout, which is exactly the kind of thing that works in `ts-node` and fails in
`dist/` — API-01 already lost two rounds to a build-output surprise, and this is the
same shape of problem. Explicit imports fail at compile time instead, and they make
"which entities exist" answerable by reading one file.

**Alternatives considered**: keeping the glob (fewer edits per new entity, and the
failure mode is a runtime `EntityMetadataNotFound` that reads like a DI problem).

---

---

## R10 — Entities must declare the indexes and CHECKs, or the drift check is a trap *(added during implementation)*

**Decision**: every named index, every `CHECK`, the composite `UNIQUE`, and **every
foreign-key constraint name** is declared in the entities with an explicit name
matching the migration — `@Index('orders_sweeper_idx', …)`,
`@Check('orders_price_minor_check', '"price_minor" > 0')`,
`@Unique('agent_versions_agent_id_version_key', …)`, and
`@JoinColumn({ foreignKeyConstraintName: 'orders_buyer_account_id_fkey' })`.

**Rationale**: R5 originally hedged — "entities carry `@Check(...)` only where it costs
nothing; the migration is authoritative" — and no `@Index` decorators were planned at
all. Running the drift check exposed what that hedge actually produced. TypeORM
proposed **32 changes**, and they were not cosmetic:

- `DROP CONSTRAINT` on **all four CHECK constraints**, with no re-add
- `DROP INDEX` on **all five named indexes**, including `orders_sweeper_idx` — the
  sweeper's query, the highest-frequency read in the product
- drop-and-rename churn on all nine foreign keys and the composite unique

A developer who ran `migration:generate` in six months and applied the result — which
is the normal, expected use of that command — would have silently deleted every
product rule this feature exists to enforce, and the demo would have failed somewhere
far away from the cause.

"The migration is authoritative" is true about *intent*. It is not a defence against
tooling that will happily generate the opposite. Declaring the constraints in both
places costs a decorator each and turns the drift check from a source of noise to be
ignored into a real safety net.

**Result**: `migration:generate` now reports *"No changes in database schema were
found"* — SC-009 satisfied exactly, with no known exceptions.

**One incidental fix**: `default: () => "'[]'::jsonb"` on the two `jsonb` array columns
compared unequal against the database's identical `'[]'::jsonb`. Spelling it
`default: () => "'[]'"` compares equal. Same default, and TypeORM stops proposing a
no-op.

---

## Unknowns remaining

None. No `NEEDS CLARIFICATION` markers entered the Technical Context.
