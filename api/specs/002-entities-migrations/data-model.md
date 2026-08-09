# Phase 1 Data Model: Entities & Initial Migration

Eight tables. The authoritative SQL is
[`contracts/schema.sql`](./contracts/schema.sql); this file is the entity-side view —
the TypeScript shape each table takes, and the rules that are not visible in a column
list.

**Money**: every `*_minor` column is `BIGINT` **USD cents**, surfaced as `number`
through a shared transformer ([research.md R1](./research.md)). Token base units
appear nowhere in this model — they exist only inside the chain adapter.

```
accounts ──┬── ledger_entries                     money in/out, append-only
           ├── agents ── agent_versions           the catalogue
           └── orders ──┬── runs                  the evidence
                        ├── complaints
                        └── verdicts
```

---

## 1. `accounts` → `Account`

One per registered wallet. No role column — the same account both buys and sells.

| Column | Type | TS | Notes |
| --- | --- | --- | --- |
| `id` | `uuid` PK | `string` | `gen_random_uuid()` |
| `wallet_address` | `text` NOT NULL | `string` | Identity **and** payout address. Stored checksummed |
| `created_at` | `timestamptz` NOT NULL | `Date` | `DEFAULT now()` |

**Uniqueness is functional**: `UNIQUE INDEX ON accounts (lower(wallet_address))`. The
entity declares **no** unique constraint — a plain one would be case-sensitive and
would let the same address register twice in different casing. This is the single
place the drift check is expected to be noisy; see
[research.md R3](./research.md).

Relations: `agents` (as owner), `orders` (as buyer), `ledger_entries`.

---

## 2. `ledger_entries` → `LedgerEntry`

One per movement of platform balance. **Append-only** — no update path is modelled,
and corrections are new rows of kind `adjustment`, never edits.

| Column | Type | TS | Notes |
| --- | --- | --- | --- |
| `id` | `uuid` PK | `string` | |
| `account_id` | `uuid` FK → accounts | `string` | |
| `amount_minor` | `bigint` NOT NULL | `number` | **Signed.** Credits +, debits − |
| `kind` | `ledger_kind` NOT NULL | `LedgerKind` | |
| `order_id` | `uuid` FK → orders NULL | `string \| null` | Set on `purchase` |
| `external_ref` | `text` NULL | `string \| null` | Transfer id or tx hash |
| `created_at` | `timestamptz` NOT NULL | `Date` | |

**`ledger_kind` = `onramp` · `purchase` · `offramp` · `adjustment`.** There is no
`settlement` value and that absence is deliberate: settled funds land on-chain under
the user's own address, cannot be recaptured, and so write no ledger entry at all.

`adjustment` exists because at a hackathon something will need correcting by hand, and
doing that as an entry keeps the history honest.

A balance is `SUM(amount_minor)` — see
[`contracts/repository-api.md`](./contracts/repository-api.md). **No cached balance
column exists on this or any other table.**

---

## 3. `agents` → `Agent`

One per listed agent. Holds nothing a buyer sees — all presentation lives on the
version, so nothing shown to a buyer can change without producing a new version.

| Column | Type | TS | Notes |
| --- | --- | --- | --- |
| `id` | `uuid` PK | `string` | |
| `owner_account_id` | `uuid` FK → accounts | `string` | The seller |
| `onchain_agent_id` | `bigint` UNIQUE NULL | `number \| null` | NULL until `registerAgent` confirms |
| `active` | `bool` NOT NULL | `boolean` | `DEFAULT true`; mirrors `setAgentActive` |
| `created_at` | `timestamptz` NOT NULL | `Date` | |

**NULL is not an error state.** A row exists before its transaction lands; `NULL`
is the honest representation of "submitted, not yet confirmed", and it makes the
retry query `WHERE onchain_agent_id IS NULL` trivial.

No `current_version` column — it is `MAX(version)` over `agent_versions`, and a
denormalisation that can drift is not worth the read it saves at this scale.

---

## 4. `agent_versions` → `AgentVersion`

One row per definition edit. **Immutable once written.**

| Column | Type | TS | Notes |
| --- | --- | --- | --- |
| `id` | `uuid` PK | `string` | |
| `agent_id` | `uuid` FK → agents | `string` | |
| `version` | `int` NOT NULL | `number` | UNIQUE with `agent_id` |
| `name` | `text` NOT NULL | `string` | |
| `description` | `text` NOT NULL | `string` | |
| `capabilities` | `text[]` NOT NULL | `string[]` | Half of Guardian's yardstick. May be empty, never absent |
| `exclusions` | `text[]` NOT NULL | `string[]` | The other, defensive half |
| `price_minor` | `bigint` NOT NULL | `number` | `CHECK > 0` |
| `input_schema` | `jsonb` NOT NULL | `object` | Validates buyer input |
| `output_schema` | `jsonb` NOT NULL | `object` | The load-bearing one |
| `system_prompt` | `text` NOT NULL | `string` | ⚠️ **RESTRICTED — seller IP** |
| `model` | `text` NOT NULL | `string` | e.g. `claude-haiku-4-5` |
| `timeout_seconds` | `int` NOT NULL | `number` | `DEFAULT 120`; beyond it, non-delivery |
| `definition_hash` | `bytea` NOT NULL | `Buffer` | keccak256 of the canonical definition |
| `created_at` | `timestamptz` NOT NULL | `Date` | |

**`system_prompt` is the one column with a disclosure rule.** Guardian reads it; a
buyer's copy of the case file must have it stripped. This feature's obligation is to
**mark** it unambiguously — a doc-comment on the property naming it as restricted and
pointing at the rule — so that the serialiser built in API-06 has something to key on.
Enforcement is explicitly not delivered here.

---

## 5. `orders` → `Order`

One per purchase.

| Column | Type | TS | Notes |
| --- | --- | --- | --- |
| `id` | `uuid` PK | `string` | |
| `onchain_deal_id` | `bigint` UNIQUE NULL | `number \| null` | From `openDeal` |
| `buyer_account_id` | `uuid` FK → accounts | `string` | |
| `agent_version_id` | `uuid` FK → **agent_versions** | `string` | **Pinned** |
| `price_minor` | `bigint` NOT NULL | `number` | Snapshot at purchase. `CHECK > 0` |
| `acceptance_criteria` | `text` NOT NULL | `string` | Free text |
| `state` | `order_state` NOT NULL | `OrderState` | `DEFAULT 'purchased'` |
| `review_window_seconds` | `int` NOT NULL | `number` | `CHECK > 0` — never 0 |
| `created_at` | `timestamptz` NOT NULL | `Date` | |
| `delivered_at` | `timestamptz` NULL | `Date \| null` | |
| `disputed_at` | `timestamptz` NULL | `Date \| null` | |
| `settled_at` | `timestamptz` NULL | `Date \| null` | |

**There is no `agent_id` column, and adding one would be a defect.** Pointing at the
version is what makes "judged against the definition that actually ran" true by
construction rather than by discipline. Reaching the agent is
`order → agent_version → agent`.

`price_minor` and `review_window_seconds` are **snapshots**, not live reads — a seller
editing their listing after a sale cannot change what the sale was for.

### `order_state`

```
purchased → running → delivered → released          (uncontested: the sweeper)
                   ↘ failed                          (execution produced nothing)
                     delivered → disputed → adjudicated → settled
```

Declared order is `purchased`, `running`, `delivered`, `failed`, `released`,
`disputed`, `adjudicated`, `settled` — **and must not be reordered**, because
Postgres sorts enum values by declaration.

This state machine is finer than the contract's. `orders.state` is also the work
queue: no Redis, no BullMQ, and a cron reaper catches anything stuck
(invariant #9).

---

## 6. `runs` → `Run`

The evidence. **Exactly one per order** — `order_id` is UNIQUE.

| Column | Type | TS | Notes |
| --- | --- | --- | --- |
| `id` | `uuid` PK | `string` | |
| `order_id` | `uuid` FK → orders **UNIQUE** | `string` | One execution per purchase |
| `input` | `jsonb` NOT NULL | `object` | What the buyer supplied |
| `output` | `jsonb` **NULL** | `object \| null` | **NULL is the non-delivery signal** |
| `steps` | `jsonb` NOT NULL | `unknown[]` | `DEFAULT '[]'`. Reasoning turns, tool calls, retries |
| `error` | `text` NULL | `string \| null` | |
| `output_valid` | `bool` NULL | `boolean \| null` | NULL = not yet checked |
| `started_at` | `timestamptz` NOT NULL | `Date` | |
| `finished_at` | `timestamptz` NULL | `Date \| null` | |
| `duration_ms` | `int` NULL | `number \| null` | Supports "delivered late" shortfalls |

**`output IS NULL` is evidence, not an error.** It is how non-delivery is proven.
Never retry over it, never clean it up, and never default it to `{}` — the UNIQUE on
`order_id` is there specifically so that a well-meaning retry cannot destroy it.

`steps` is what lets Guardian distinguish *genuinely tried* from *returned a stub*. It
can be large; Postgres TOASTs it automatically and the schema imposes no ceiling.

---

## 7. `complaints` → `Complaint`

| Column | Type | TS | Notes |
| --- | --- | --- | --- |
| `id` | `uuid` PK | `string` | |
| `order_id` | `uuid` FK → orders **UNIQUE** | `string` | One complaint per order |
| `reason` | `text` NOT NULL | `string` | |
| `created_at` | `timestamptz` NOT NULL | `Date` | |

The UNIQUE does real work: "no amendments, no re-filing" becomes a database
guarantee rather than an API check someone forgets.

---

## 8. `verdicts` → `Verdict`

| Column | Type | TS | Notes |
| --- | --- | --- | --- |
| `id` | `uuid` PK | `string` | |
| `order_id` | `uuid` FK → orders **UNIQUE** | `string` | One verdict — no appeals |
| `tier` | `verdict_tier` NOT NULL | `VerdictTier` | |
| `refund_minor` | `bigint` NOT NULL | `number` | `CHECK >= 0`. Note **≥**, not > — a `none` verdict refunds nothing |
| `reasoning` | `text` NOT NULL | `string` | Human-readable |
| `citations` | `jsonb` NOT NULL | `unknown[]` | `DEFAULT '[]'` |
| `verdict_hash` | `bytea` NOT NULL | `Buffer` | Anchored on-chain in `resolve()` |
| `model` | `text` NOT NULL | `string` | e.g. `claude-opus-5` |
| `onchain_tx_hash` | `text` NULL | `string \| null` | The demo's clickable proof |
| `created_at` | `timestamptz` NOT NULL | `Date` | |

**`verdict_tier` = `none` · `quarter` · `half` · `three_quarter` · `full`**, in that
declared order.

Persisting the verdict is what makes the demo replayable: a re-run shows the stored
verdict rather than re-auditing, which removes live-model variance from the stage.
`temperature` is not available on Opus 5, so verdicts cannot be made reproducible by
sampling control — they are reproducible by being *stored*.

---

## Enums (`src/entities/enums.ts`)

| TS enum | Postgres type | Values (order significant) |
| --- | --- | --- |
| `LedgerKind` | `ledger_kind` | `onramp`, `purchase`, `offramp`, `adjustment` |
| `OrderState` | `order_state` | `purchased`, `running`, `delivered`, `failed`, `released`, `disputed`, `adjudicated`, `settled` |
| `VerdictTier` | `verdict_tier` | `none`, `quarter`, `half`, `three_quarter`, `full` |

Each entity column binds with `enumName` so it reuses the named type rather than
letting TypeORM invent a per-column duplicate.

---

## Constraint inventory

Verified by executing [`contracts/schema.sql`](./contracts/schema.sql) against
Postgres 16 and reading the catalog back: **8 primary keys, 6 unique constraints,
4 CHECK constraints, 6 explicit named indexes — 20 indexes in total.**

| # | Constraint | Catalog name | Product rule it encodes |
| --- | --- | --- | --- |
| 1 | `UNIQUE (lower(wallet_address))` | `accounts_wallet_lower_idx` | One account per wallet, whatever the casing |
| 2 | `complaints.order_id` UNIQUE | `complaints_order_id_key` | One complaint per order — no amendments, no re-filing |
| 3 | `verdicts.order_id` UNIQUE | `verdicts_order_id_key` | One verdict per order — no appeals; and the demo stays replayable |
| 4 | `runs.order_id` UNIQUE | `runs_order_id_key` | One execution per purchase — a retry cannot destroy the evidence |
| 5 | `UNIQUE (agent_id, version)` | `agent_versions_agent_id_version_key` | Version numbers are unique within an agent |
| 6 | `agents.onchain_agent_id` UNIQUE | `agents_onchain_agent_id_key` | One row per on-chain agent |
| 7 | `orders.onchain_deal_id` UNIQUE | `orders_onchain_deal_id_key` | One row per on-chain deal |
| 8 | `CHECK (price_minor > 0)` | on `agent_versions` **and** `orders` | No zero-price listings or orders |
| 9 | `CHECK (review_window_seconds > 0)` | on `orders` | A zero window collapses the dispute window |
| 10 | `CHECK (refund_minor >= 0)` | on `verdicts` | Refunds are never negative; zero is valid |

Rows 8–10 are **four** constraints across three rules — `price_minor > 0` appears on
two tables.

## Index inventory

| Index | Serves |
| --- | --- |
| `orders_sweeper_idx (state, delivered_at)` | **The sweeper.** Every few seconds, all demo long |
| `orders_undelivered_idx (state, created_at)` | Undelivered orders past the delivery deadline |
| `orders_buyer_idx (buyer_account_id, created_at DESC)` | A buyer's order history |
| `ledger_account_idx (account_id, created_at)` | Balance and statements |
| `agents_owner_idx (owner_account_id)` | A seller's listings |
| `accounts_wallet_lower_idx` | Case-insensitive identity lookup |
| `runs.order_id` (from UNIQUE) | Case-file assembly |
| `agents.onchain_agent_id`, `orders.onchain_deal_id` (from UNIQUE) | Mapping chain events back to rows |
