# Phase 1 Data Model: API Foundation

**This feature defines no domain entities and no tables of its own.** Entities and the
schema DDL arrive in API-02. What follows is the three structured things this feature
does introduce — two of them in memory, one owned by TypeORM.

---

## 1. Configuration Set *(in-memory, immutable)*

The validated result of parsing `process.env` at boot. Constructed exactly once,
before the first request; never re-read, never mutated.

**Shape** (`AppConfig = z.infer<typeof envSchema>`) — 24 fields across five groups, the
full platform set per FR-010. Types and formats for every key are in
[`contracts/config-schema.md`](./contracts/config-schema.md); the type-level summary:

| Group | Fields | Coerced types |
| --- | --- | --- |
| Core | `DATABASE_URL`, `PORT`, `NODE_ENV` | `PORT` → `number`, `NODE_ENV` → union |
| Chain | `MONAD_RPC_URL`, `MONAD_CHAIN_ID`, `MONAD_EXPLORER_URL`, `USDC_ADDRESS`, `ESCROW_CONTRACT_ADDRESS`, 3 address + 3 key fields | `MONAD_CHAIN_ID` → `number` |
| LLM | `ANTHROPIC_API_KEY` | — |
| Rain | `RAIN_ENABLED` + 5 fields | `RAIN_ENABLED` → `boolean` |
| Tuning | `REVIEW_WINDOW_SECONDS`, `SWEEPER_INTERVAL_MS` | both → `number` |

`DEPLOYER_PRIVATE_KEY` is present in `.env` but **absent from `AppConfig`** — the API
must not be able to sign a deployment.

**Invariants**

- No member is optional. If a key is in `AppConfig`, it is present and well-formed —
  this is what lets consumers read it without a null check (FR-008).
- Coercion happens once, at the boundary: `PORT` is a `number` in the type, not a
  string that each consumer parses.
- Fields marked secret must never appear in log output, error messages, or the
  `/health` response (FR-009).

**Validation outcomes**

| Condition | Result |
| --- | --- |
| All required present and well-formed | Boot proceeds; no warnings emitted |
| One or more missing or malformed | stderr lists **every** offending key with its expected form; process exits non-zero |
| Extra unrecognized env vars present | Ignored — the schema is not `.strict()`; the OS environment always carries unrelated variables |
| Valid, but the value is a known placeholder | Boot **proceeds**; one `WARN` names every key still holding a fake — names only, never values |

**Placeholder state.** The chain, wallet, and Anthropic fields currently hold
format-valid fakes (`0xDEAD…`, `sk-ant-placeholder-…`) pending the `sc/` deploy. They
are structurally indistinguishable from real values to the type system — which is why
detection is a runtime check with a loud warning rather than something the schema can
express. See [research.md R9](./research.md#r9--placeholder-detection-at-boot).

---

## 2. Migration Record *(persisted, owned by TypeORM)*

TypeORM's bookkeeping table. This feature creates the mechanism; API-02 supplies the
first row with real content.

**Table**: `migrations` (created automatically on first `migration:run`)

| Column | Type | Meaning |
| --- | --- | --- |
| `id` | `SERIAL PRIMARY KEY` | Insertion order |
| `timestamp` | `BIGINT` | Migration's numeric prefix — the ordering key |
| `name` | `VARCHAR` | Class name, e.g. `InitialSchema1754640000000` |

**Lifecycle**

```
generated  →  reviewed in a diff  →  applied (row inserted)  →  [ revertible (row deleted) ]
```

**Invariants**

- **Applied at most once per database.** `migration:run` compares the `migrations`
  table against the files in `src/migrations/` and applies only the gap (FR-014).
- **Ordering is by `timestamp`, not filename sort or `id`.** Two developers generating
  migrations in parallel get a deterministic order from the clock.
- **Only the `migrate` service writes this table.** The API process runs with
  `migrationsRun: false` and `synchronize: false`, so it never inserts a row and never
  alters schema (FR-012, FR-017).
- **A migration is a pair.** Every generated file has both `up` and `down`;
  `migration:revert` undoes exactly the most recent row.

**Expected state at the end of this feature**: the table exists and is empty (or holds
one no-op migration). `migrate` exiting `0` against zero pending migrations is the
success case, not a warning.

---

## 3. Health Report *(in-memory, response-only)*

The value returned by `GET /health`. Terminus's standard envelope — not persisted, not
derived from any stored row.

| Field | Type | Meaning |
| --- | --- | --- |
| `status` | `'ok' \| 'error'` | Overall verdict — `ok` only if every indicator is up |
| `info` | `Record<string, { status: 'up' }>` | Indicators that passed |
| `error` | `Record<string, { status: 'down', message?: string }>` | Indicators that failed |
| `details` | `Record<string, { status: 'up' \| 'down' }>` | `info` and `error` merged — every indicator, always |

**Indicators**

| Name | Check | Timeout |
| --- | --- | --- |
| `database` | `SELECT 1` over the shared `DataSource` | 1500 ms |

**Invariants**

- **Shallow by design.** One indicator: the database. The Monad RPC endpoint and the
  Anthropic API are deliberately not probed — a third-party outage must not render
  this service unhealthy (see [research.md R5](./research.md#r5--health-check-terminus-with-a-database-ping)).
- **Read-only.** The check touches no domain table and writes nothing (FR-003).
- **No secrets.** The `error.database.message` on failure must not echo
  `DATABASE_URL`; on connection failure it reports the failure class, not the
  credentials (FR-009).
- **`status: 'error'` carries HTTP 503**, not 200 — so Compose, a load balancer, and
  `curl --fail` all agree with the body.

Full request/response contract: [`contracts/health.openapi.yaml`](./contracts/health.openapi.yaml).
