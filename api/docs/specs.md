# `api/` — Spec Breakdown

> How the backend is split into speckit-sized specs.

Twelve specs. Eleven are dependency-ordered; **API-12 is numbered last and built
next**, because a contract written after the fact prevents nothing. Read
[`CONTEXT.md`](./CONTEXT.md) first.

| # | Spec | Depends on | Size |
| --- | --- | --- | --- |
| API-01 | Foundation: Nest, config, Docker, health | — | M |
| API-02 | Entities & the initial migration | 01 | M |
| API-03 | Chain adapter (viem) | 01 | M |
| API-04 | Wallet auth | 02 | S |
| API-05 | Accounts, ledger & funding | 02, 03, 04 | M |
| API-06 | Catalogue & the serialisation boundary | 02, 03, 04 | M |
| API-07 | Orders & the purchase saga | 05, 06 | **L — the risky one** |
| API-08 | Execution engine | 07 | L |
| API-09 | Guardian audit engine | 07, 08 | **L — the product** |
| API-10 | Cron jobs | 07 | S |
| API-11 | Demo seed & the three seller agents | 06, 08 | M |
| API-12 | **OpenAPI contract & Swagger UI** | 01–11 — **runs last, feeds UI-08** | S |

**Why this shape.** The split follows dependencies, not module boundaries — each
spec ends at a point where something is *verifiable by hand*. API-03 lands a real
transaction on the explorer; API-05 moves real tokens; API-07 completes a purchase;
API-09 settles a verdict on-chain. If a spec can't be checked without the next one,
it's drawn in the wrong place.

**The three that carry risk** are 07 (money + chain + async in one flow), 08 and 09
(LLM behaviour, which no amount of design de-risks). Everything else is
comparatively mechanical.

---

## API-01 — Foundation

**Deliver:** a NestJS app that starts, connects to Postgres, and answers `/health`.

- Nest scaffold, TypeScript strict
- **Typed, validated config** from the repo-root `.env` — fail loudly at boot on a
  missing key rather than at first use
- `data-source.ts` with **`synchronize: false`** (non-negotiable — see API-02)
- `docker-compose.yml`: `postgres` (healthcheck) → `migrate` (one-shot) → `api`
- `Dockerfile`, migration npm scripts
- `GET /health`

**Done when** `docker compose up` gives a responding `/health` from cold.

**Note:** `DATABASE_URL` differs inside Docker (`postgres`, not `localhost`) — it's
overridden in compose. The most common "works on my machine" trap in this setup.

**Source:** project-structure §2, §3.

---

## API-02 — Entities & the initial migration

**Deliver:** 8 TypeORM entities + a hand-written initial migration.

- `accounts`, `agents`, `agent_versions`, `orders`, `runs`, `complaints`,
  `verdicts`, `ledger_entries`
- Enums: `ledger_kind`, `order_state`, `verdict_tier`
- All indexes from database-schema §7 — especially `orders (state, delivered_at)`,
  the sweeper's

**Write the migration from the DDL, not from entity inference.** The enums, the
`lower(wallet_address)` unique index, and the UNIQUE constraints on
`complaints.order_id` / `verdicts.order_id` / `runs.order_id` are easier to write
directly than to coax out of decorators.

**Those three UNIQUEs are product rules, not hygiene** — one complaint per order, no
appeals, one execution per purchase. Enforced by the database so no service can
violate them by accident.

**Done when** `migration:run` builds the schema and the constraints reject the
things they're meant to.

**Source:** database-schema §2–§8.

---

## API-03 — Chain adapter

**Deliver:** `chain/` — the only module that talks to Monad or knows about token
base units.

- `monadTestnet` chain definition; `publicClient`, `operatorClient`,
  `guardianClient`
- Contract ABI + typed wrappers for every function in smart-contract §4
- `toBaseUnits` / `fromBaseUnits` — **the single conversion point**
- Receipt waiting, tx-hash return, typed errors
- Explicit gas limits on operator hot paths (Monad charges the limit)

**`guardianClient` gets an ABI containing only `resolve`.** Role separation should
be a compile error, not a convention.

**Done when** a throwaway script calls `registerAgent` and the transaction appears on
MonadVision.

**Source:** smart-contract §4, project-structure §1, §5.

---

## API-04 — Wallet auth

**Deliver:** nonce → signature → JWT, and account creation.

- `POST /auth/nonce`, `POST /auth/verify` (recover address, verify, issue JWT)
- Account created on first successful verify — **the entire registration flow**
- JWT guard; a decorator exposing the current account
- Addresses stored checksummed, matched case-insensitively

**Done when** a signature produces a token that authenticates later requests, and a
second sign-in reuses the same account.

**Source:** api-design §3.1, §7.

---

## API-05 — Accounts, ledger & funding

**Deliver:** money in and out, and the Rain stubs.

- `GET /me` — **available balance and in-escrow, as separate numbers**
- `GET /me/ledger`
- `POST /topup` — funder wallet → operator pool on-chain, then a `kind='onramp'`
  ledger credit
- `POST /withdraw` — `withdrawFor(wallet)`, settled funds to the user's wallet
- `POST /offramp` — unspent balance: operator pool → funder, ledger debit
- `POST /onramp/routes`, `POST /offramp/routes` — **stubs that log the exact Rain
  payload and return "not called"**

**The stubs must look like stubs.** Log at `warn` with the full body; never fake a
`200 OK`. A mock that returns success is a thing you forget about and then
accidentally demo.

**Two numbers, not one.** `GET /me` returning a single "balance" would be wrong in
two directions at once — money lives in four places (database-schema §3.3).

**Done when** a top-up moves real test USDC and the ledger reflects it; and a
cash-out returns it to the funder.

**Source:** api-design §3.2, rain-integration §0, database-schema §3.

---

## API-06 — Catalogue & the serialisation boundary

**Deliver:** listing agents, and the redaction rule that everything downstream
depends on.

- `POST /agents` — creates agent + version 1, canonicalises and hashes the
  definition, calls `registerAgent`
- `POST /agents/:id/versions` — new immutable version, `updateAgent`
- `PATCH /agents/:id/active`
- `GET /agents`, `GET /agents/:id` — **public listing fields only**
- `GET /agents/:id/versions` — owner-only, execution spec included
- **The serialiser**: one function that cannot emit `system_prompt`

**Public and owner views are different routes, not one route with a branch.** No
conditional to get wrong.

**Canonical hashing needs a deterministic serialisation** — stable key order — or
the `defHash` won't reproduce and the on-chain commitment becomes decorative.

**Done when** a listed agent appears on-chain with a hash that can be recomputed
from the stored definition, and no public response contains a prompt.

**Source:** agent-definition §2, api-design §1.3, §3.3.

---

## API-07 — Orders & the purchase saga

⚠️ **The riskiest spec in the backend** — money, chain, and async in one request.

**Deliver:** purchase through to acceptance.

- `POST /orders` — the saga:
  1. validate (agent active, input matches `input_schema`, criteria non-empty,
     balance sufficient)
  2. **one Postgres transaction**: insert order + insert negative ledger entry
  3. `openDeal` on-chain; on receipt store `onchain_deal_id`
  4. on chain failure → `state='failed'` + compensating ledger entry
  5. dispatch execution async, return 201
- `GET /orders`, `GET /orders/:id`, `GET /sales`
- `POST /orders/:id/accept`
- `POST /orders/:id/complain` — creates the complaint, calls `dispute`, enqueues audit
- `GET /orders/:id/case-file` — redacted for buyer, full for seller
- `reviewWindowSeconds` from config; **reject `0`**

**Step 2 must be one transaction.** Any gap between the order insert and the ledger
debit is a window where the same balance can be spent twice.

**`0` is a silent killer.** A review window of zero means the complaint button never
works and the order auto-releases instantly — no error anywhere, and every act
dies on stage.

**Done when** a purchase completes end to end, the escrow holds the money, and a
forced chain failure leaves the buyer's balance whole.

**Source:** api-design §4, product-workflow §2.

---

## API-08 — Execution engine

**Deliver:** the wrapped workspace — the thing that makes the evidence trustworthy.

- Load the pinned `agent_version`
- Call Claude (`claude-haiku-4-5`) with the seller's prompt and the buyer's input,
  output constrained by the agent's `output_schema`
- Write the `runs` row: `input`, `steps`, `output`, `error`, timings
- `output_valid` — does the output satisfy its own declared schema?
- Success → `markDelivered` on-chain → `state='delivered'`
- Crash/timeout → `state='failed'`, `output` stays NULL
- **Deterministic demo mode** for the three seeded agents (product-workflow §5.5)

**`output` NULL is the evidence of non-delivery.** Never retry over it; the `runs`
UNIQUE on `order_id` makes that structural.

**`steps` is what separates "genuinely tried" from "returned a stub."** Those
deserve different verdicts and only the trace can tell them apart — so capture
reasoning turns, not just the final answer.

**Done when** a purchase produces output and a delivered order, and a deliberately
failing agent produces a `failed` order with a NULL-output run.

**Source:** product-workflow §6, agent-definition §2.2, tech-stack §3.

---

## API-09 — Guardian audit engine

⚠️ **This is the product.** Everything else is scaffolding around it.

**Deliver:** case file → verdict → on-chain settlement.

- Assemble the case file: buyer input · acceptance criteria · **pinned** listing
  promise and exclusions · run steps · output · errors · timings
- Guardian system prompt + tier rubric (0/25/50/75/100), with prompt caching on the
  stable prefix
- Claude (`claude-opus-5`), structured output →
  `{ tier, reasoning, citations[] }` where each citation is
  `{ source, quote, met }`
- Persist the verdict + `verdict_hash` **before** the chain call
- `guardianClient.resolve(dealId, tier, verdictHash)` → `state='settled'`
- Refuse to re-audit an order that already has a verdict
- `GET /orders/:id/verdict`

**Citations are the product's credibility.** A tier alone is an assertion; a tier
plus *"this clause, unmet, here is the quote"* is an audit. The UI renders them as a
checklist, so they must be structured — not prose containing quotes.

**Persist before settling, and never re-audit.** Verdicts are final by product rule,
and this is also what makes the demo replayable without live-model variance —
`temperature` isn't available on Opus 5, so a second audit could differ.

**Done when** a complaint produces a persisted, cited verdict and a settled deal
whose split matches the tier.

**Source:** product-workflow §4.1–§4.3, §7.4, tech-stack §3, §5.

---

## API-10 — Cron jobs

**Deliver:** the three timers that make the contract's deadlines actually fire.

| Job | Interval | Does |
| --- | --- | --- |
| Sweeper | `SWEEPER_INTERVAL_MS` | `delivered` past its window → `release()` |
| Reclaimer | 5 min | `purchased` past `DELIVERY_DEADLINE` → `reclaim()` |
| Reaper | 1 min | `running` past its timeout → `failed` |

**The sweeper is the one the audience sees** — it's what makes Act 1's uncontested
trade auto-release with nobody touching the keyboard.

**The reaper exists because there's no job queue.** Restart the backend mid-run and
an order sits in `running` forever. Marking it failed is correct: from the buyer's
side, an agent that never returned is non-delivery regardless of cause.

**Done when** an untouched delivered order releases on its own, and a killed
execution ends up `failed`.

**Source:** api-design §6, smart-contract §6.3.

---

## API-11 — Demo seed & the three seller agents

**Deliver:** the catalogue the demo runs on — and the acts' failure modes.

- `POST /demo/seed` — creates **LedgerBot** ($2.00), **TLDR Agent** ($1.00),
  **PolyglotAI** ($1.50): full definitions with capabilities, exclusions, input and
  output schemas, prompts
- `POST /demo/reset` — clears orders/runs/complaints/verdicts between rehearsals
- Fixture inputs for all three acts: the 5-line receipt, the summarisable document,
  the input PolyglotAI crashes on
- Deterministic failure modes: LedgerBot returns 3 of 5 items; TLDR returns a valid
  85-word summary (so its complaint is *correctly rejected*)

**This spec is where the demo actually gets designed**, not just implemented. The
agents must fail *on cue* — seeded inputs that reliably produce the intended output,
rather than hoping a live model misbehaves on schedule.

**Act 1's agent must succeed.** Its point is that Guardian rejects an unjustified
complaint — get that wrong and the demo's opening argument inverts.

**Done when** a seeded database can run all three acts end to end, twice, with the
same verdicts.

**Source:** product-workflow §5, agent-definition §6.


## API-12 — OpenAPI contract & Swagger UI

**Deliver:** one document both components build against, and a URL to read it at.

**Runs last on this side, immediately before UI-08** — it is the handoff between the
two components.

- `docs/openapi.yaml` — every endpoint, auth rule, request/response schema and error
  shape, **written from the running implementation**: what the code actually returns,
  captured from real responses rather than transcribed from DTOs
- `docs/openapi-divergences.md` — the code diffed against api-design §3, each row
  marked `api-wrong` / `design-stale` / `intentional`. **`api-wrong` rows get the API
  fixed**, or flagged so UI-08 does not adopt them
- Served at `GET /docs` via `SwaggerModule.setup()`, loading the YAML from disk —
  `@nestjs/swagger` for the UI only, **no DTO decorators**
- The four enums the UI switches on, spelled out: `OrderState` (8), `LedgerKind` (4),
  citation `source` (3), refund tiers
- Money field names verbatim, `settledFundsMinor` nullable-not-optional
- `camelCase` on the wire, recorded once so it stops being an assumption

**The implementation is the source of truth for the document — not for whether the
document is right.** Collapsing those two is the one way this spec does damage: a
field the API named wrongly becomes a contract, and UI-08 reconciles the frontend
into matching a bug. That is `67dcf4d` exactly. The divergence report is what keeps
the two questions apart.

`GET /docs` must be `@Public()`, or the global fail-closed guard puts the contract
behind a login.

**Done when** the YAML parses as OpenAPI 3.1, every route the app registers appears
in it and vice versa, response schemas match real captured responses field for field,
`/docs` renders in a browser, and the divergence report exists — even if it says
"none".

**Source:** the running implementation first; then api-design §3, database-schema §8,
tech-stack §5 for the divergence report.


## No automated tests in this component

Time-boxed MVP decision: **only the escrow contract keeps a test suite** (`sc/`
SC-02). Everything here is verified by hand against each spec's acceptance criteria.

The trade is deliberate and worth naming: the contract is the one component where a
bug moves money incorrectly *and* costs a redeploy plus an `.env` update to fix.
Everything else can be corrected in place while the app is running.

**Consequence:** demo rehearsal is now the test suite. Run all three acts end to end
more than once, and treat a failed rehearsal the way you'd treat a red build.

## Individual spec files

Run these through `/speckit-specify` **in order** — each assumes the ones above it.

| # | Spec | File |
| --- | --- | --- |
| 1 | API-01 — Foundation | [`specs/API-01-foundation.md`](./specs/API-01-foundation.md) |
| 2 | API-02 — Entities & migrations | [`specs/API-02-entities-migrations.md`](./specs/API-02-entities-migrations.md) |
| 3 | API-03 — Chain adapter | [`specs/API-03-chain-adapter.md`](./specs/API-03-chain-adapter.md) |
| 4 | API-04 — Wallet auth | [`specs/API-04-auth.md`](./specs/API-04-auth.md) |
| 5 | API-05 — Accounts, ledger & funding | [`specs/API-05-accounts-ledger-funding.md`](./specs/API-05-accounts-ledger-funding.md) |
| 6 | API-06 — Catalogue | [`specs/API-06-catalogue.md`](./specs/API-06-catalogue.md) |
| 7 | API-07 — Orders & purchase saga | [`specs/API-07-orders-purchase-saga.md`](./specs/API-07-orders-purchase-saga.md) |
| 8 | API-08 — Execution engine | [`specs/API-08-execution-engine.md`](./specs/API-08-execution-engine.md) |
| 9 | API-09 — Guardian audit engine | [`specs/API-09-guardian-audit.md`](./specs/API-09-guardian-audit.md) |
| 10 | API-10 — Cron jobs | [`specs/API-10-cron-jobs.md`](./specs/API-10-cron-jobs.md) |
| 11 | API-11 — Demo seed & agents | [`specs/API-11-demo-seed.md`](./specs/API-11-demo-seed.md) |
| 12 | API-12 — OpenAPI contract | [`specs/API-12-openapi-contract.md`](./specs/API-12-openapi-contract.md) |

Each file is self-contained enough for one speckit run: goal, in/out of
scope, acceptance criteria, and the specific traps for that slice.
