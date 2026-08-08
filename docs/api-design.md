# Guardian — API, Modules & Jobs

> **DRAFT for review.** NestJS backend. Not yet implemented.

**Last updated**: 2026-08-08
**Companion docs**: [database-schema.md](./database-schema.md) ·
[smart-contract.md](./smart-contract.md) · [rain-integration.md](./rain-integration.md) ·
[product-workflow.md](./product-workflow.md)

---

## Contents

- [1. Three things that shape the API](#1-three-things-that-shape-the-api)
- [2. Modules](#2-modules)
- [3. Endpoints](#3-endpoints)
- [4. The purchase saga](#4-the-purchase-saga)
- [5. Execution and audit are asynchronous](#5-execution-and-audit-are-asynchronous)
- [6. Cron jobs](#6-cron-jobs)
- [7. Auth](#7-auth)
- [8. Open questions](#8-open-questions)

---

## 1. Three things that shape the API

### 1.1 Most writes are two-phase: Postgres *and* the chain

A purchase isn't a row insert — it's a database write **plus** an on-chain
transaction that can fail independently, seconds later. Same for delivery,
disputes, and verdicts.

The rule that follows: **Postgres first, chain second.** A bad database write is
trivial to compensate; a stray on-chain deal is not. Every such flow is a small saga
with an explicit failure branch (§4).

### 1.2 Two endpoints return before the work is done

`POST /orders` returns before the agent has run. `POST /orders/:id/complain` returns
before Guardian has ruled. Both kick off work measured in seconds-to-minutes.

**No job queue** — no Redis, no BullMQ. The `orders.state` column *is* the queue,
and a cron job reaps anything stuck. One less moving part to fail on stage (§5).

### 1.3 One serialisation rule, enforced in one place

`agent_versions.system_prompt` is seller IP. Guardian reads it; **the buyer must
never see it**, even in a dispute (agent-definition §4) — otherwise a frivolous
complaint becomes a way to steal a seller's work.

Every buyer-facing response goes through a serialiser that cannot emit it. Not "we
remember to omit it in each endpoint" — a single function, so the rule holds by
construction.

**The boundary is wider than one column.** Execution steps are shown to buyers
(ui-design §7.1), and a reasoning step can paraphrase its own instructions — so the
prompt can leak through `runs.steps` without ever touching `system_prompt`. The
serialiser summarises reasoning text rather than passing it through raw. This is
exactly why it's one function: the next sensitive field gets handled in one place.

---

## 2. Modules

| Module | Owns | Talks to |
| --- | --- | --- |
| `AuthModule` | Wallet sign-in, JWT | — |
| `AccountsModule` | Registration, balance, ledger | Postgres |
| `CatalogModule` | Agents + versions, definition hashing | Postgres, `ChainModule` |
| `OrdersModule` | Purchase → delivery → accept/complain | Postgres, `ChainModule`, `ExecutionModule` |
| `ExecutionModule` | **The wrapped workspace** — runs seller agents, writes run records | Anthropic API |
| `GuardianModule` | Case-file assembly, audit, verdict | Anthropic API, `ChainModule` |
| `ChainModule` | Escrow contract adapter; the **only** place cents↔base-units convert | Monad RPC |
| `RainModule` | **Stubbed** — logs the calls it would make (rain §0). No live requests. | — |
| `FundingModule` | Funder wallet → operator pool transfers, ledger credits | Monad RPC |
| `JobsModule` | Cron: sweeper, reclaimer, reaper | All of the above |

Two boundaries worth keeping strict:

**`ChainModule` is the only module that knows about token base units.** Everything
else speaks USD cents (database-schema §1.3). One conversion, one file, one test.

**`ExecutionModule` and `GuardianModule` both call Claude but never each other.**
Execution produces evidence; Guardian consumes it. Keeping them apart is what makes
"the platform produced the evidence, not the audited party" true in the code and not
just in the doc.

---

## 3. Endpoints

### 3.1 Auth

| Method | Path | Notes |
| --- | --- | --- |
| `POST` | `/auth/nonce` | `{ address }` → `{ nonce }` |
| `POST` | `/auth/verify` | `{ address, signature }` → `{ token }`. Creates the account on first sign-in. |

### 3.2 Accounts & money

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/me` | Account, available balance, amount currently in escrow |
| `GET` | `/me/ledger` | Statement |
| `POST` | `/onramp/routes` | **STUB** — logs the Rain request body, makes no call (rain §0) |
| `POST` | `/topup` | **The real funding path.** Funder wallet → operator pool + `kind='onramp'` ledger credit |
| `POST` | `/withdraw` | Operator calls `withdrawFor(wallet)` — settled funds to the user's wallet |
| `POST` | `/offramp/routes` | Returns the **funder address** as the deposit address (rain §0.3) + logs the Rain call |
| `POST` | `/offramp` | Cash out **unspent platform balance**: operator pool → funder, ledger debit |

**Money leaves the way it came in.** The funder wallet is the outside world:
top-ups draw from it, offramps return to it (rain §0.3). `POST /offramp` covers
unspent platform balance; settled funds already in a user's own wallet are sent to
the funder address by the user, exactly as Rain's real offramp works.

**The Rain stubs must look like stubs.** They log at `warn` with the full payload
and return a response that says the call was not made — never a fake success. A mock
that returns `200 OK` is a thing you forget about and accidentally demo.

`GET /me` returning **both** available balance and in-escrow is deliberate — with
money in four places (database-schema §3.3), a single "balance" number would be a
lie in three of them.

### 3.3 Catalogue

| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| `GET` | `/agents` | public | Active listings |
| `GET` | `/agents/:id` | public | **Listing fields only** — never the execution spec |
| `POST` | `/agents` | seller | Creates agent + version 1, hashes the definition, calls `registerAgent` |
| `POST` | `/agents/:id/versions` | owner | New immutable version, calls `updateAgent` |
| `PATCH` | `/agents/:id/active` | owner | Calls `setAgentActive` |
| `GET` | `/agents/:id/versions` | owner | Own definitions, execution spec included |

Same path, two shapes: `GET /agents/:id` is public and listing-only; the owner's
view is a separate route. Making them different **routes** rather than one route
with a branch means there is no conditional to get wrong.

### 3.4 Orders

| Method | Path | Notes |
| --- | --- | --- |
| `POST` | `/orders` | `{ agentId, input, acceptanceCriteria }` — the purchase saga (§4) |
| `GET` | `/orders` | Mine, as buyer |
| `GET` | `/orders/:id` | State, output, timings |
| `GET` | `/orders/:id/case-file` | **Redacted** for a buyer, full for the seller |
| `POST` | `/orders/:id/accept` | Early acceptance → `accept()` on-chain |
| `POST` | `/orders/:id/complain` | `{ reason }` → `dispute()` on-chain, enqueues the audit |
| `GET` | `/orders/:id/verdict` | Tier, reasoning, citations, tx hash |
| `GET` | `/sales` | Mine, as seller |

### 3.5 Demo

| Method | Path | Notes |
| --- | --- | --- |
| `POST` | `/demo/seed` | Creates the three seller agents |
| `POST` | `/demo/reset` | Clears orders between rehearsals. **No environment guard** — see §8. |

`/demo/*` earns its place: you will run the three acts many times, and re-seeding by
hand at 3am is how demos get broken.

**No Rain webhook endpoint** — there is no live Rain integration to receive events
from (rain §0).

---

## 4. The purchase saga

The riskiest flow in the system — it touches money, the chain, and an LLM.

```
POST /orders
  │
  ├─ 1. VALIDATE ──────────────────────────────────────────────
  │     agent active · input matches inputSchema
  │     acceptanceCriteria non-empty · balance >= price
  │
  ├─ 2. POSTGRES  (one transaction) ───────────────────────────
  │     insert order   (state = purchased, onchain_deal_id = NULL)
  │     insert ledger  (kind = purchase, negative)
  │
  ├─ 3. CHAIN ─────────────────────────────────────────────────
  │     openDeal(agentId, buyerWallet, reviewWindowSeconds)
  │     on receipt → orders.onchain_deal_id = dealId
  │
  │     ✗ on failure → state = failed
  │                  → compensating ledger entry (kind = adjustment)
  │                  → the money goes back; nothing is stranded
  │
  └─ 4. DISPATCH (async, not awaited) ─────────────────────────
        state = running · ExecutionModule takes over
        └─ 201 returned to the client here
```

**Why Postgres before the chain.** If the chain call fails we write one compensating
ledger row and the user is whole. If the *order* were on-chain first and the database
write failed, we'd have escrowed money with no record of whose it is — recoverable
only by hand.

**Why the ledger debit sits in the same transaction as the order insert.** Any gap
between them is a window where the user can spend the same balance twice. One
transaction closes it.

**`reviewWindowSeconds` comes from config, never from the client.** It's the
`REVIEW_WINDOW_SECONDS` env var, and the service refuses `0` — the silent-failure
guard from smart-contract §11.3.

---

## 5. Execution and audit are asynchronous

Both follow the same shape: a state column, a background worker, and a cron reaper
for anything that dies mid-flight.

### 5.1 Execution

```
state=running
  → load agent_version
  → Claude call: system_prompt + buyer input,
    output constrained by output_schema (structured outputs)
  → write runs row: input, steps, output, error, timings
  → output_valid = does it satisfy output_schema?
  ├─ success → markDelivered() on-chain → state = delivered
  └─ crash / timeout → state = failed, runs.output = NULL
```

**`runs.output IS NULL` is not an error condition to clean up — it *is* the
evidence** of non-delivery (product §4.3). Never retry over it; never delete it.

### 5.2 Audit

```
state=disputed
  → assemble case file: buyer input · acceptance criteria
                       · listing promise + exclusions (pinned version)
                       · run steps · output · errors · timings
  → Claude (claude-opus-5), structured output → { tier, reasoning, citations }
  → persist verdict + verdict_hash
  → resolve(dealId, tier, verdictHash) on-chain
  → state = settled
```

**The verdict is persisted before the chain call**, and re-auditing an order that
already has a verdict is refused. That's what makes the demo replayable without
live-model variance (tech-stack §5) — and it matches the product rule that verdicts
are final.

---

## 6. Cron jobs

| Job | Interval | Does |
| --- | --- | --- |
| **Sweeper** | `SWEEPER_INTERVAL_MS` (3s demo / 60s prod) | `orders WHERE state='delivered' AND now() >= delivered_at + review_window` → `release()` → `state='released'` |
| **Reclaimer** | 5 min | `state='purchased' AND now() >= created_at + 24h` → `reclaim()` |
| **Reaper** | 1 min | `state='running'` past its timeout → `state='failed'`. Catches a backend restart mid-execution. |
| **Confirmation retry** | 1 min | `onchain_deal_id IS NULL` past a grace period → retry or fail |

**The sweeper is the one that shows on stage** — it's what makes Act 1's uncontested
trade visibly auto-release. Index `orders (state, delivered_at)` exists for it
(database-schema §7).

**The reaper exists because there's no job queue.** Restart the backend mid-run and
an order sits in `running` forever without it. Marking it `failed` is correct
behaviour, not a workaround: from the buyer's side, an agent that never returned is
non-delivery regardless of why.

**The deposit poller is gone** along with the live Rain integration (rain §0).
Top-ups are now synchronous — the funder-wallet transfer confirms sub-second, so
`POST /topup` can credit the ledger and return in one request. Nothing to poll for.

---

## 7. Auth

Standard wallet sign-in: `POST /auth/nonce` → user signs → `POST /auth/verify`
recovers the address and issues a JWT. First successful verify creates the account.

No passwords, no email, no Rain provisioning (database-schema §3.1.1) — **connecting
a wallet is the entire registration flow.**

Seller and buyer are the same account; ownership is checked per resource
(`agents.owner_account_id`, `orders.buyer_account_id`) rather than by role.

---

## 8. Decisions

All resolved — no open API questions.

| Question | Decision |
| --- | --- |
| Frontend updates | **Polling.** `GET /orders/:id` on an interval. No SSE, no websockets. |
| Rain webhooks | **Moot** — Rain is stubbed entirely (rain §0), so there are no events to receive. |
| `/demo/reset` environment guard | **No guard.** |

**On polling:** the frontend drives the visible parts of the demo — the review
window counting down, "delivered", the verdict landing. An interval of ~1s is
sufficient and has no failure mode; the state is in Postgres either way, so nothing
is lost on a dropped connection.

**On `/demo/reset`:** unguarded by choice. Worth one line in a README so a
teammate or a judge poking at a deployed instance isn't surprised by what it does —
and worth remembering it exists if this ever outlives the hackathon.
