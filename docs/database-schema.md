# Guardian — PostgreSQL Schema

> **DRAFT for review.** Proposal, not yet implemented. TypeORM entities map 1:1 to
> the DDL in §8; SQL is used here because it reviews better than decorators.

**Last updated**: 2026-08-08
**Companion docs**: [smart-contract.md](./smart-contract.md) ·
[agent-definition.md](./agent-definition.md) · [rain-integration.md](./rain-integration.md) ·
[product-workflow.md](./product-workflow.md)

---

## Contents

- [1. Four decisions to review first](#1-four-decisions-to-review-first)
- [2. Table map](#2-table-map)
- [3. Identity and money](#3-identity-and-money)
- [4. The catalogue](#4-the-catalogue)
- [5. Orders, runs, disputes](#5-orders-runs-disputes)
- [6. Rain integration tables](#6-rain-integration-tables)
- [7. Indexes that matter](#7-indexes-that-matter)
- [8. Full DDL](#8-full-ddl)
- [9. Open questions](#9-open-questions)

---

## 1. Four decisions to review first

Everything else is bookkeeping. These four shape the schema.

### 1.1 The funding balance lives in Postgres, not on-chain

This wasn't explicit anywhere before, and it follows from two decisions already made:
*all smart-contract operations go through the Operator*, and *the onramp tops up a
balance* (product §7.7).

So the operator's wallet holds a **pooled** token balance on-chain, and Postgres
records **who owns how much of it**. A purchase debits the user's ledger and moves
tokens from the pool into escrow.

**This means Postgres is the source of truth for user balances.** Not ideal in a
world where we'd rather the chain were — but it's the direct consequence of
operator-driven transactions, and pretending otherwise would be worse.

### 1.2 Balances are an append-only ledger, not a mutable column

`ledger_entries` is append-only; a balance is `SUM(amount_minor)`. No `UPDATE
accounts SET balance = ...` anywhere.

Why it's worth the extra table at MVP scale: a mutable balance column loses the
*history* of how it got there, and "the numbers don't add up and nobody knows why"
is a brutal thing to debug at 3am. With a ledger, every cent traces to an onramp or
a purchase.

**No cached balance column.** At demo scale the `SUM` is free, and a cache is a
whole class of drift bug bought for nothing. Add one only if something actually
feels slow.

### 1.3 One money unit in the database: USD cents

Every amount column is `BIGINT`, in **USD cents**. `$2.00 → 200`.

Token base units (USDC, 6 decimals) appear **only** inside the chain adapter, which
multiplies by 10⁴ on the way out and divides on the way back. One conversion, one
place, one test.

The alternative — storing base units in Postgres — means every UI value needs
dividing and every mistake is a factor-of-10,000 error. Not worth it.

### 1.4 Two ID spaces, both stored

Postgres uses UUIDs; the chain uses sequential `uint256`. Rows that exist in both
carry both — `agents.onchain_agent_id`, `orders.onchain_deal_id`, nullable until
the transaction confirms.

Nullable matters: a row exists **before** its transaction lands. `NULL` is the
honest representation of "submitted, not yet confirmed", and it makes the retry
query trivial (`WHERE onchain_deal_id IS NULL`).

---

## 2. Table map

```
accounts ──┬── ledger_entries          money in / out, append-only
           ├── agents ── agent_versions   the catalogue (definitions + hashes)
           └── orders ──┬── runs          execution trace (the evidence)
                        ├── complaints
                        └── verdicts      tier + reasoning + citations
```

| Table | Rows are | Written by |
| --- | --- | --- |
| `accounts` | One per registered wallet | Registration |
| `ledger_entries` | One per platform-balance movement | Onramp, purchase (settlement is on-chain — §3.3) |
| `agents` | One per listed agent | Seller |
| `agent_versions` | One per definition edit | Seller |
| `orders` | One per purchase | Buyer |
| `runs` | **Exactly one per order** | The wrapped workspace |
| `complaints` | One per dispute | Buyer |
| `verdicts` | One per adjudication | Guardian |

### 2.1 Cut for the MVP: `buying_agents` and `rain_cards`

**User's call: buyers are humans only.** Both tables are removed, along with
`orders.buying_agent_id` and the Rain Cards integration.

**Nine tables instead of eleven — but the cost isn't the schema.** Two things go
with it, and both reach past the database:

1. **Act 3 has no mechanism.** The closing act — an autonomous agent buys, gets
   cheated, files its own complaint, wins, and retries elsewhere — was the product
   thesis in thirty seconds (product §5.3). Without an agent buyer there is no way
   to stage it.
2. **Rain's contribution thins to the onramp.** Product §7.8.1 concluded that
   spend-limited cards were *"the part of Rain most worth preserving — dropping the
   fiat rails costs a convenience, dropping the leash costs the argument."* This
   drops the leash. What remains is the onramp/offramp, which is the explicitly
   droppable half **and** cannot even reach Monad (rain-integration §1.1).

**A cheaper middle, if Act 3 is worth keeping** — the expensive part was never the
concept of an agent buyer, it was the *Rain Cards integration*. You can stage the
whole act with our own code:

- `orders.placed_by_agent boolean` — one column, no new tables
- A budget counter in `accounts`, decremented per autonomous purchase — the leash,
  without Rain
- The backend drives buy → evaluate → complain → retry

That keeps the thesis and the closing act for roughly one column plus a small
service, while still dropping the risky third-party integration. **Say the word and
I'll restore it in that shape** — otherwise the cut below stands as instructed.

---

## 3. Identity and money

### 3.1 `accounts`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` PK | |
| `wallet_address` | `text` UNIQUE NOT NULL | **Identity and payout address.** Store checksummed; index lowercased. |
| `created_at` | `timestamptz` NOT NULL | |

`cached_balance_minor` **dropped** — at demo scale the `SUM` is free, and the column
was a whole class of drift bug for nothing.

No role column. **One account is both buyer and seller** (product §7.9).

#### 3.1.1 `rain_user_id` — dropped

Rain issued **one Team ID and one User ID for the whole platform**, so `userId` on
`POST /payment-routes` is a constant, not a per-account value. It lives in `.env` as
`RAIN_USER_ID`.

That settles the open question from the previous draft in the simpler direction —
Rain identities are **platform-level, not per end-user** — and it removes the last
per-user Rain dependency entirely. No Rain provisioning step at registration:
connecting a wallet is the whole of it.

`display_name` also cut. The wallet address is the only identity the MVP needs.

### 3.2 `ledger_entries`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` PK | |
| `account_id` | `uuid` FK → accounts | |
| `amount_minor` | `bigint` NOT NULL | **Signed.** Credits positive, debits negative. |
| `kind` | `ledger_kind` NOT NULL | `onramp`, `purchase`, `offramp`, `adjustment` |
| `order_id` | `uuid` FK → orders NULL | Set on `purchase` |
| `external_ref` | `text` NULL | Rain transfer id, or an on-chain tx hash |
| `created_at` | `timestamptz` NOT NULL | |

Available balance is one query:

```sql
SELECT COALESCE(SUM(amount_minor), 0) FROM ledger_entries WHERE account_id = $1;
```

`onramp` and `offramp` are funder-wallet transfers, not Rain calls
(rain-integration §0.3) — the names are kept because that is what they model.

`adjustment` exists because at a hackathon something *will* need correcting by hand,
and doing it as a ledger entry keeps the history honest.

### 3.3 Where escrowed money comes from — and where it does *not* come back to

Yes: **a purchase is charged against the ledger balance.** But tracing it all the
way through changed the design, so it's worth being exact.

**On purchase**, two things happen together:

| | |
| --- | --- |
| Postgres | `ledger_entries` row: `kind='purchase'`, negative, linked to the order |
| Chain | Operator moves tokens from the pooled wallet into the escrow contract |

Both sides decrease by the same amount, so the pool keeps matching the ledger.

**On settlement, the money does not return to the platform.** The contract credits
`balances[buyer]` and `balances[seller]` — those are the users' *own addresses*, and
`withdrawFor` sends to the address, not to our pool. **We cannot recapture it, by
design**: that's the same property that lets either party exit without the
platform's cooperation (smart-contract §8.4).

So settlement produces **no ledger entry at all.** It's an on-chain fact, displayed
from contract state and events.

#### The four places money can be

| Location | Tracked in | Spendable on a purchase? | Who controls it |
| --- | --- | --- | --- |
| **Platform balance** | `ledger_entries` (Postgres) | ✅ Yes | Platform holds; user owns |
| **Escrow** | `deals[].amount` on-chain | ❌ Locked | Nobody, until settlement |
| **Settled** | `balances[]` on-chain | ❌ | The user — `withdrawFor` any time |
| **Own wallet** | The chain | ❌ | The user |

Displaying "in escrow" needs no new table — it's
`SUM(price_minor)` over that buyer's unsettled orders.

#### The consequence to accept

**Money is one-way out of the platform.** A refunded buyer's money lands on-chain
under their own control, *not* back in their spendable balance — so re-buying means
onramping again.

The **retry-after-refund** beat this would have made awkward belongs to Act 3′, the
autonomous variant, which is cut (§2.1) — nothing re-buys after a refund.

**But Act 3 itself is in the demo** (product-workflow §5.3), and it ends in a 100%
refund. So this consequence is now *on screen*: the buyer gets the full price back
and **their available balance does not move**, because the money lands in settled
funds, on-chain, under their own address. A presenter saying "and the money comes
back" beside an unchanged balance looks like a failure.

That is precisely what the Wallet page's third figure is for — `settledFundsMinor`
(api-design §3.2.1). Act 3 is the act that makes the two-numbers rule legible instead
of pedantic: without it, the demo's cleanest verdict appears to pay nobody.

The off-chain analogue of the solvency invariant (smart-contract §3.3):

```
operator pool token balance  >=  Σ all platform ledger balances
```

**The `>=` decides the write order of every two-phase money flow.** A crash between
the halves must leave the pool holding *more* than the ledger claims, never less, so
**whichever write increases what we owe goes second**:

| Flow | Ledger | Chain | Order | A crash leaves |
| --- | --- | --- | --- | --- |
| Purchase | ↓ | ↓ into escrow | Postgres first | ledger down, pool flat ✅ |
| Cash-out | ↓ | ↓ pool → funder | Postgres first | ledger down, pool flat ✅ |
| **Top-up** | ↑ | ↑ funder → pool | **chain first** | pool up, ledger flat ✅ |

Top-up is the only flow where the ledger side increases, and so the only one where
the backend's usual "Postgres first, chain second" heuristic (`api/docs/CONTEXT.md`
invariant #1) is the wrong way round — crediting a balance before the tokens land
promises money the pool does not hold. The heuristic is a consequence of this rule,
not the rule.

---

## 4. The catalogue

### 4.1 `agents`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` PK | |
| `owner_account_id` | `uuid` FK → accounts | The seller |
| `onchain_agent_id` | `bigint` NULL UNIQUE | From `registerAgent`; NULL until confirmed (§1.4) |
| `active` | `bool` NOT NULL DEFAULT true | Mirrors `setAgentActive` |
| `created_at` | `timestamptz` NOT NULL | |

Mutable presentation fields live on the **version**, not here — so nothing a buyer
was shown can change without producing a new version.

`current_version` dropped, on the same reasoning as the cached balance (§1.2): it is
`MAX(version)` over `agent_versions`, and a denormalisation that can drift is not
worth the read it saves at this scale.

### 4.2 `agent_versions`

The agent definition ([agent-definition.md](./agent-definition.md) §2). One row per
edit; rows are **immutable once written**.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` PK | |
| `agent_id` | `uuid` FK → agents | |
| `version` | `int` NOT NULL | UNIQUE with `agent_id` |
| `name` | `text` NOT NULL | |
| `description` | `text` NOT NULL | |
| `capabilities` | `text[]` NOT NULL | Half of Guardian's yardstick |
| `exclusions` | `text[]` NOT NULL | The other, defensive half |
| `price_minor` | `bigint` NOT NULL | USD cents |
| `input_schema` | `jsonb` NOT NULL | Validates buyer input |
| `output_schema` | `jsonb` NOT NULL | **The load-bearing one** — agent-definition §3 |
| `system_prompt` | `text` NOT NULL | ⚠️ **Seller IP — never serialise to a buyer** |
| `model` | `text` NOT NULL | e.g. `claude-haiku-4-5` |
| `timeout_seconds` | `int` NOT NULL | Beyond this the run is non-delivery |
| `definition_hash` | `bytea` NOT NULL | keccak256 of the canonical definition |
| `created_at` | `timestamptz` NOT NULL | |

**`system_prompt` is the one column with a disclosure rule.** Guardian reads it;
the buyer's copy of the case file must have it stripped (agent-definition §4). Worth
a dedicated serialiser rather than trusting every endpoint to remember.

*(`buying_agents` was the third table here — cut for the MVP, see §2.1.)*

---

## 5. Orders, runs, disputes

### 5.1 `orders`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` PK | |
| `onchain_deal_id` | `bigint` NULL UNIQUE | From `openDeal` |
| `buyer_account_id` | `uuid` FK → accounts | |
| `agent_version_id` | `uuid` FK → agent_versions | **Pinned** — never `agent_id` alone |
| `price_minor` | `bigint` NOT NULL | Snapshot at purchase |
| `acceptance_criteria` | `text` NOT NULL | **Free text** (agent-definition §8) |
| `state` | `order_state` NOT NULL | see below |
| `review_window_seconds` | `int` NOT NULL | 24h default, seconds for the demo |
| `created_at` / `delivered_at` / `disputed_at` / `settled_at` | `timestamptz` | NULLs until reached |

`order_state`: `purchased`, `running`, `delivered`, `failed`, `released`,
`disputed`, `adjudicated`, `settled` — the product state machine
(product-block-schema §2), which is **finer than the contract's** (smart-contract §7).

Pointing at `agent_version_id` rather than `agent_id` is what makes "judged against
the version that ran" true by construction rather than by discipline.

### 5.2 `runs`

The evidence. One row per execution attempt.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` PK | |
| `order_id` | `uuid` FK → orders | |
| `input` | `jsonb` NOT NULL | What the buyer supplied |
| `output` | `jsonb` NULL | NULL if it crashed — that *is* the non-delivery signal |
| `steps` | `jsonb` NOT NULL DEFAULT '[]' | Reasoning turns, tool calls, retries |
| `error` | `text` NULL | |
| `output_valid` | `bool` NULL | Did it satisfy `output_schema`? Pre-audit check (agent-definition §3) |
| `started_at` / `finished_at` | `timestamptz` | |
| `duration_ms` | `int` NULL | Supports "delivered late" shortfalls |

**`order_id` is UNIQUE — exactly one execution per purchase.** No retries in the
MVP, so the constraint makes that a database guarantee rather than a convention.
A crashed run stays as the row with `output IS NULL`, which is precisely the
non-delivery evidence Guardian needs (product §4.3) — re-running would destroy it.

`steps` is what lets Guardian distinguish *genuinely tried* from *returned a stub*
(product §6.3). Sizeable, but Postgres TOASTs it automatically — see tech-stack §7.

### 5.3 `complaints`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` PK | |
| `order_id` | `uuid` FK → orders UNIQUE | **UNIQUE enforces one complaint per order** (product §7.9) |
| `reason` | `text` NOT NULL | |
| `created_at` | `timestamptz` NOT NULL | |

The UNIQUE constraint is doing real work: "no amendments, no re-filing" becomes a
database guarantee rather than an API check someone forgets.

### 5.4 `verdicts`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` PK | |
| `order_id` | `uuid` FK → orders UNIQUE | One verdict per order — no appeals (product §4.4) |
| `tier` | `verdict_tier` NOT NULL | `none` / `quarter` / `half` / `three_quarter` / `full` |
| `refund_minor` | `bigint` NOT NULL | Computed from tier × price |
| `reasoning` | `text` NOT NULL | Human-readable |
| `citations` | `jsonb` NOT NULL | Which promise / exclusion / criterion, and whether met |
| `verdict_hash` | `bytea` NOT NULL | Anchored on-chain in `resolve()` |
| `model` | `text` NOT NULL | e.g. `claude-opus-5` — for reproducibility |
| `onchain_tx_hash` | `text` NULL | The demo's clickable proof |
| `created_at` | `timestamptz` NOT NULL | |

**Persisting the verdict is what makes the demo replayable** (tech-stack §5): a
re-run shows the stored verdict rather than re-auditing, which removes live-model
variance from the stage. The UNIQUE on `order_id` enforces it.

---

## 6. Rain integration tables

### 6.1 `payment_routes` — cut

Dropped with the live Rain integration (rain-integration §0). We never create a Rain
route, so there is no route ID to store. Funding is a funder-wallet transfer plus a
ledger entry, and both are already covered by `ledger_entries`.

**Eight tables.**

### 6.2 `rain_cards` — cut

Removed with `buying_agents` (§2.1). Scoped cards existed only to be an agent's
spending leash; with no agent buyers there is nothing to leash.

*If it comes back*: the field is `amountInUSDCents`, and Rain applies a **1.2×
authorization ceiling** over the stated limit (rain-integration §2.1) — the
effective cap is not the number you set.

---

## 7. Indexes that matter

| Index | Why |
| --- | --- |
| `orders (state, delivered_at)` | **The sweeper's query.** Runs every few seconds during the demo (smart-contract §6.3) — this one earns its keep more than any other. |
| `orders (state, created_at)` | Finding undelivered orders past `DELIVERY_DEADLINE` |
| `orders (onchain_deal_id)` | Mapping chain events back to rows |
| `ledger_entries (account_id, created_at)` | Balance computation and statements |
| `agents (owner_account_id)` | A seller's listings |
| `runs (order_id)` | Case-file assembly |
| `lower(accounts.wallet_address)` UNIQUE | Address casing varies; identity must not |

---

## 8. Full DDL

```sql
CREATE EXTENSION IF NOT EXISTS "pgcrypto";   -- gen_random_uuid()

CREATE TYPE ledger_kind      AS ENUM ('onramp','purchase','offramp','adjustment');  -- settlement is on-chain only, see §3.3
CREATE TYPE order_state      AS ENUM ('purchased','running','delivered','failed','released','disputed','adjudicated','settled');
CREATE TYPE verdict_tier     AS ENUM ('none','quarter','half','three_quarter','full');

CREATE TABLE accounts (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_address        text        NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX accounts_wallet_lower_idx ON accounts (lower(wallet_address));

CREATE TABLE agents (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_account_id  uuid        NOT NULL REFERENCES accounts(id),
  onchain_agent_id  bigint      UNIQUE,
  active            bool        NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX agents_owner_idx ON agents (owner_account_id);

CREATE TABLE agent_versions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id         uuid        NOT NULL REFERENCES agents(id),
  version          int         NOT NULL,
  name             text        NOT NULL,
  description      text        NOT NULL,
  capabilities     text[]      NOT NULL,
  exclusions       text[]      NOT NULL,
  price_minor      bigint      NOT NULL CHECK (price_minor > 0),
  input_schema     jsonb       NOT NULL,
  output_schema    jsonb       NOT NULL,
  system_prompt    text        NOT NULL,   -- seller IP: never expose to buyers
  model            text        NOT NULL,
  timeout_seconds  int         NOT NULL DEFAULT 120,
  definition_hash  bytea       NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (agent_id, version)
);

-- buying_agents and rain_cards: cut for the MVP (see §2.1)

-- payment_routes: cut with the live Rain integration (see §6.1)

CREATE TABLE orders (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  onchain_deal_id        bigint      UNIQUE,
  buyer_account_id       uuid        NOT NULL REFERENCES accounts(id),
  agent_version_id       uuid        NOT NULL REFERENCES agent_versions(id),
  price_minor            bigint      NOT NULL CHECK (price_minor > 0),
  acceptance_criteria    text        NOT NULL,
  state                  order_state NOT NULL DEFAULT 'purchased',
  review_window_seconds  int         NOT NULL CHECK (review_window_seconds > 0),
  created_at             timestamptz NOT NULL DEFAULT now(),
  delivered_at           timestamptz,
  disputed_at            timestamptz,
  settled_at             timestamptz
);
CREATE INDEX orders_sweeper_idx  ON orders (state, delivered_at);
CREATE INDEX orders_undelivered_idx ON orders (state, created_at);
CREATE INDEX orders_buyer_idx    ON orders (buyer_account_id, created_at DESC);

CREATE TABLE runs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id      uuid        NOT NULL UNIQUE REFERENCES orders(id),  -- one run per order
  input         jsonb       NOT NULL,
  output        jsonb,
  steps         jsonb       NOT NULL DEFAULT '[]'::jsonb,
  error         text,
  output_valid  bool,
  started_at    timestamptz NOT NULL DEFAULT now(),
  finished_at   timestamptz,
  duration_ms   int
);

CREATE TABLE complaints (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id    uuid        NOT NULL UNIQUE REFERENCES orders(id),  -- one per order
  reason      text        NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE verdicts (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id         uuid         NOT NULL UNIQUE REFERENCES orders(id),  -- no appeals
  tier             verdict_tier NOT NULL,
  refund_minor     bigint       NOT NULL CHECK (refund_minor >= 0),
  reasoning        text         NOT NULL,
  citations        jsonb        NOT NULL DEFAULT '[]'::jsonb,
  verdict_hash     bytea        NOT NULL,
  model            text         NOT NULL,
  onchain_tx_hash  text,
  created_at       timestamptz  NOT NULL DEFAULT now()
);

CREATE TABLE ledger_entries (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id    uuid        NOT NULL REFERENCES accounts(id),
  amount_minor  bigint      NOT NULL,          -- signed
  kind          ledger_kind NOT NULL,
  order_id      uuid        REFERENCES orders(id),
  external_ref  text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ledger_account_idx ON ledger_entries (account_id, created_at);
```

---

## 9. Decisions

All three resolved. Nine tables, no open schema questions.

| Question | Decision |
| --- | --- |
| Multiple `runs` per order? | **No** — `order_id` is UNIQUE. One execution per purchase. |
| On-chain event log table? | **Not now** — the sweeper re-reads contract state instead. Simpler, and stateless across restarts. |
| Cached balance column? | **Dropped** — always `SUM`. |
| Where settlement is recorded | **On-chain only** — no ledger entry (§3.3) |

The one thing recorded rather than fixed: **money is one-way out of the platform**
(§3.3). Harmless with Act 3 cut; it would need revisiting if agent buyers come back.
