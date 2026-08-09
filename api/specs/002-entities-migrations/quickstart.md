# Quickstart & Validation: Entities & Initial Migration

No test suite — [`docs/CONTEXT.md`](../../docs/CONTEXT.md) puts automated tests out of
scope for this component. **This file is the test suite.** Most of it is inserting a
row and expecting the database to say no.

## Prerequisites

- API-01 complete and the stack starting cleanly
- If a native Postgres holds host port 5432, prefix every `docker compose` command
  with `POSTGRES_HOST_PORT=5433`

A shorthand used throughout:

```bash
psql() { docker compose exec -T postgres psql -U postgres -d guardian "$@"; }
```

> **These expectations are measured, not assumed.** During planning,
> [`contracts/schema.sql`](./contracts/schema.sql) was executed against a scratch
> database on this project's Postgres 16 and the catalog read back: 8 tables, 3 enum
> types, 20 indexes, 4 CHECK constraints. Every rejection in Scenario B was triggered
> and confirmed, and the constraint names in the table below are the ones Postgres
> actually reported. If your run disagrees, the migration has drifted from the
> contract — not the other way round.

---

## Scenario A — Schema builds from empty (US1, P1)

Proves FR-001 → FR-006; measures SC-001, SC-002, SC-008.

```bash
docker compose down -v && docker compose up -d
```

**A1 — Inventory.** Expect exactly **8** and **3**:

```sql
SELECT count(*) FROM information_schema.tables
 WHERE table_schema='public' AND table_name <> 'migrations';

SELECT typname FROM pg_type t
  JOIN pg_enum e ON t.oid = e.enumtypid GROUP BY typname ORDER BY typname;
```

Expected types: `ledger_kind`, `order_state`, `verdict_tier`.

**A2 — Enum values, in declaration order.** Order is significant — Postgres sorts by
it, so a reordering silently changes `ORDER BY state`:

```sql
SELECT t.typname, string_agg(e.enumlabel, ',' ORDER BY e.enumsortorder)
  FROM pg_type t JOIN pg_enum e ON t.oid=e.enumtypid GROUP BY t.typname;
```

Expected exactly:
- `ledger_kind` → `onramp,purchase,offramp,adjustment` — **no `settlement`**
- `order_state` → `purchased,running,delivered,failed,released,disputed,adjudicated,settled`
- `verdict_tier` → `none,quarter,half,three_quarter,full`

**A3 — Indexes.** Every index in
[data-model.md](./data-model.md#index-inventory) must be present:

```sql
SELECT indexname FROM pg_indexes WHERE schemaname='public' ORDER BY indexname;
```

**A4 — Database-generated defaults (FR-006).** Insert supplying neither id nor
timestamp; both must come back populated:

```sql
INSERT INTO accounts (wallet_address) VALUES ('0xAAA0000000000000000000000000000000000001')
  RETURNING id, created_at;
```

**A5 — Idempotent re-apply and clean revert (SC-008).**

```bash
docker compose run --rm migrate                    # exits 0, "No migrations are pending"
npm run migration:revert                           # removes everything it created
psql -c "\dt"                                      # only `migrations` remains
docker compose run --rm migrate                    # rebuilds cleanly
```

---

## Scenario B — The database refuses to break product rules (US2, P2)

Proves FR-007 → FR-014; measures SC-003, SC-004. **Every statement below must fail.**

Seed first:

```sql
INSERT INTO accounts (wallet_address) VALUES ('0xBbB0000000000000000000000000000000000002');
-- then create an agent, an agent_version, and an order from those ids
```

| # | Attempt | Must be rejected by |
| --- | --- | --- |
| B1 | A second `complaints` row for the same `order_id` | `complaints_order_id_key` |
| B2 | A second `verdicts` row for the same `order_id` | `verdicts_order_id_key` |
| B3 | A second `runs` row for the same `order_id` | `runs_order_id_key` |
| B4 | An account with the **same address in different casing** | `accounts_wallet_lower_idx` |
| B5 | A second `agent_versions` row with the same `(agent_id, version)` | the composite UNIQUE |
| B6 | A second `agents` row with the same `onchain_agent_id` | `agents_onchain_agent_id_key` |
| B7 | `price_minor = 0` on an agent version, and on an order | the `CHECK` |
| B8 | `review_window_seconds = 0` on an order | the `CHECK` |
| B9 | `refund_minor = -1` on a verdict | the `CHECK` |
| B10 | Any row referencing a non-existent account / agent version / order | the FK |
| B11 | `DELETE FROM accounts` where orders reference it | the FK |

B4 is the one worth doing carefully — try upper, lower, and mixed casing of the same
address. All but the first must be rejected. This is the check that distinguishes a
functional unique index from a plain one.

B9 uses `-1`, not `0`: `refund_minor >= 0` and a `none` verdict legitimately refunds
nothing.

---

## Scenario C — Pinning and immutability (US3, P3)

Proves FR-020 → FR-023.

**C1 — Orders point at versions, never agents:**

```sql
SELECT column_name FROM information_schema.columns
 WHERE table_name='orders' AND column_name LIKE '%agent%';
```

Expected exactly one row: `agent_version_id`. **An `agent_id` column here is a
defect**, not a convenience.

**C2 — A new version does not disturb an existing order.** Insert version 2 of the
agent, then confirm the order still resolves to version 1 and to version 1's name and
price.

**C3 — The price is a snapshot.** Change the listing price on a new version; the
order's `price_minor` is unchanged.

**C4 — Presentation lives on the version:**

```sql
SELECT column_name FROM information_schema.columns WHERE table_name='agents';
```

Expected: `id`, `owner_account_id`, `onchain_agent_id`, `active`, `created_at` — and
nothing a buyer is shown.

**C5 — The restricted column is marked.** `grep -n "system_prompt" -A3` the entity
file: the property must carry a comment naming it as seller IP that never reaches a
buyer. Nothing enforces it yet — that is API-06 — but the marker must be
unmissable.

---

## Scenario D — Balance is derived (US4, P4)

Proves FR-015 → FR-019; measures SC-005, SC-006, SC-007.

**D1 — Sum matches.** Insert entries of `+10000`, `-2500`, `+500` for one account;
the helper returns `8000`.

**D2 — Empty account returns 0, not null:**

```sql
SELECT COALESCE(SUM(amount_minor), 0) FROM ledger_entries WHERE account_id = '<fresh account>';
```

Then call the repository helper for the same account and confirm it returns the
number `0` — not `null`, not `"0"`.

**D3 — No cached balance anywhere (SC-006):**

```sql
SELECT table_name, column_name FROM information_schema.columns
 WHERE table_schema='public' AND (column_name LIKE '%balance%' OR column_name LIKE '%cached%');
```

Expected: **zero rows.**

**D4 — Every money column is `bigint` (SC-007):**

```sql
SELECT table_name, column_name, data_type FROM information_schema.columns
 WHERE table_schema='public' AND column_name LIKE '%_minor';
```

Expected: all `bigint`. Then confirm no column name mentions base units, wei, or
decimals.

**D5 — The transformer returns numbers, not strings.** Read a row with a money column
through the repository and confirm `typeof value === 'number'`. A string here is the
bug from [research.md R1](./research.md) and it type-checks, so it must be looked at
directly.

---

## Scenario E — Entities agree with the schema (SC-009)

```bash
npm run migration:generate -- src/migrations/DriftCheck
```

**Expected, verbatim:**

```
No changes in database schema were found - cannot generate a migration.
```

**No exceptions.** Not "empty `up()`", not "only the functional index" — nothing at
all. The entities declare every index, CHECK, unique, and foreign-key constraint name
explicitly so that the two sides match completely
([research.md R10](./research.md)).

**If this command generates a file, read it before doing anything else.** The first
time it was run here it proposed 32 changes, including dropping all four CHECK
constraints and all five named indexes — `orders_sweeper_idx` among them. Applying
that would have silently deleted the product rules this feature exists to enforce.
Anything it proposes now is real drift: fix the **entity**, never the migration, and
never apply the generated file.

If a file was generated, delete it.

---

## Sign-off checklist

| # | Check | Criterion |
| --- | --- | --- |
| 1 | Cold database → 8 tables, 3 enums, all indexes | SC-001, SC-002 |
| 2 | All 5 uniqueness rules reject their duplicate | SC-003 |
| 3 | Casing variants of one address all rejected | SC-004 |
| 4 | Balance equals the sum; empty case returns `0` | SC-005 |
| 5 | No balance/cached column anywhere | SC-006 |
| 6 | Every money column is `bigint` cents | SC-007 |
| 7 | Re-apply changes nothing; revert removes everything | SC-008 |
| 8 | Drift check clean but for the known functional-index exception | SC-009 |
| 9 | `orders` has `agent_version_id` and no `agent_id` | FR-020 |
| 10 | `system_prompt` carries its restricted marker | FR-023 |

Treat a failed run here the way you'd treat a red build.
