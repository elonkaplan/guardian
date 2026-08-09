# Guardian API

The Guardian backend: marketplace, execution host, audit engine, and the only
component that talks to the chain. Currently at the foundation stage — config
loading, database connection, migrations, and wallet auth are wired up, with
`GET /health` and the `/auth` routes. No domain logic yet.

## Quick start (Docker)

From `api/`:

```bash
docker compose up
```

Then:

```bash
curl http://localhost:3000/health
# {"status":"ok","info":{"database":{"status":"up"}}}
```

Requires the repository-root `.env` to exist and be fully populated (placeholder
values count as populated — see [Placeholders](#placeholders)).

**Port conflict gotcha:** if a native Postgres already holds port 5432 on the
host, `postgres`'s published port will fail to bind. Start with:

```bash
POSTGRES_HOST_PORT=5433 docker compose up
```

That published port is only for host convenience (e.g. `psql` from your
machine) — the API reaches Postgres over the Compose network regardless, so
this override never affects the API itself.

## Running on the host instead

```bash
npm install
npm run migration:run
npm run start:dev
```

Requires a Postgres reachable at the `.env` `DATABASE_URL` (`localhost`).

The only difference between this and the Docker path: `DATABASE_URL`. The
repository-root `.env` value targets `localhost`; the Compose files override it
to host `postgres` for the `migrate` and `api` services. That single
substitution is the whole difference between the two run modes, and forgetting
it is the most common "works on my machine" trap here.

## Commands

| Script | Command | Exit semantics |
| --- | --- | --- |
| `build` | `nest build` | Non-zero on any type error — strict mode is a build gate |
| `preflight` | `ts-node --transpileOnly src/config/preflight.ts` | Validates config before start; non-zero on failure |
| `start` | `npm run preflight && nest start` | Runs preflight, then starts |
| `start:dev` | `npm run preflight && nest start --watch` | Non-zero if config validation fails; otherwise long-running |
| `migration:generate` | `typeorm-ts-node-commonjs migration:generate -d src/data-source.ts` | Requires a path argument: `npm run migration:generate -- src/migrations/SomeName`. Non-zero if the database is unreachable or nothing changed |
| `migration:run` | `typeorm-ts-node-commonjs migration:run -d src/data-source.ts` | **`0` on success, including when zero migrations are pending.** Non-zero on any failure |
| `migration:revert` | `typeorm-ts-node-commonjs migration:revert -d src/data-source.ts` | Reverts exactly the most recently applied migration |

`migration:run` exiting `0` with nothing pending is the normal restart path —
the `api` Compose service depends on this exit code, so a "nothing to do"
non-zero exit would deadlock the stack.

## How the stack starts

```
postgres  ──(healthcheck: pg_isready)──▶  migrate  ──(exit 0)──▶  api
```

| Service | Gate it waits on | Failure behavior |
| --- | --- | --- |
| `postgres` | — | Retries the healthcheck up to 10x at 3s intervals |
| `migrate` | `postgres: service_healthy` | Non-zero exit stops `api` from ever starting |
| `api` | `postgres: service_healthy` and `migrate: service_completed_successfully` | Config failure exits non-zero, container stops |

`service_completed_successfully` on `migrate` is the load-bearing clause: it's
what stops the API from starting up and serving against a half-migrated
schema.

## Configuration

One `.env` file at the repository root, shared with `ui/` and `sc/`. Every key
is validated at boot; a missing or malformed value stops startup and names
every offending key in the error output.

See [`specs/001-api-foundation/contracts/config-schema.md`](./specs/001-api-foundation/contracts/config-schema.md)
for the full key table.

`DEPLOYER_PRIVATE_KEY` is deliberately **not** read by the API — it belongs to
`sc/` only.

`DEMO_SELLER_ADDRESS` is required and has no default. It is the payout address the
three seeded demo agents are registered under, so it is where every seller payout
in the demo lands. ⚠️ It is fixed at registration and cannot be amended afterwards
— a wrong value has to be re-registered as new agents, not corrected. Use an
address someone in the room controls.

## Placeholders

The chain, wallet, and Anthropic values are currently format-valid fakes
(`0xDEAD…`, `sk-ant-placeholder-…`) pending the `sc/` deploy. The API logs a
`WARN` at boot naming every key still holding a placeholder.

Before any demo run, confirm none remain:

```bash
grep -n 'TODO(placeholder)' ../.env
docker compose logs api | grep -i placeholder
```

Both must be empty before any chain or LLM path can work.

## Schema

Eight tables, three enum types, 20 indexes, four `CHECK` constraints — built by one
hand-written migration, `src/migrations/*-InitialSchema.ts`.

```
accounts ──┬── ledger_entries              money in/out, append-only
           ├── agents ── agent_versions    the catalogue
           └── orders ──┬── runs           the evidence
                        ├── complaints
                        └── verdicts
```

| Enum type | Values |
| --- | --- |
| `ledger_kind` | `onramp`, `purchase`, `offramp`, `adjustment` |
| `order_state` | `purchased`, `running`, `delivered`, `failed`, `released`, `disputed`, `adjudicated`, `settled` |
| `verdict_tier` | `none`, `quarter`, `half`, `three_quarter`, `full` |

Enum member order is significant — Postgres sorts by declaration order, so reordering
changes the meaning of `ORDER BY state`.

**The authoritative DDL is
[`specs/002-entities-migrations/contracts/schema.sql`](./specs/002-entities-migrations/contracts/schema.sql).**
The migration is transcribed from it; entities in `src/entities/` are written to
match. If the three ever disagree, the contract wins.

A few things in here are load-bearing and look like oversights if you don't know why:

- **No cached balance column, anywhere.** A balance is `SUM(amount_minor)` over the
  append-only ledger — see `src/ledger/balance.repository.ts`.
- **`accounts.wallet_address` has no plain `UNIQUE`.** Uniqueness is the functional
  index `lower(wallet_address)`, because a plain one is case-sensitive and would let
  the same address register twice.
- **`orders` references `agent_version_id`, never `agent_id`.** Adding an `agent_id`
  column would be a defect.
- **`runs.output` is nullable on purpose.** `NULL` is the non-delivery evidence.
- **All money is `bigint` USD cents.** Token base units live only in the chain adapter.

### Changing the schema

```bash
npm run migration:generate -- src/migrations/SomeName   # needs a path argument
npm run migration:run
npm run migration:revert
```

`migration:generate` against an in-sync schema must print **"No changes in database
schema were found"**. If it generates a file, that is real drift — read it, fix the
**entity**, and delete the file. Never apply a generated migration blind: entities
declare every index, `CHECK`, unique, and foreign-key constraint *name* explicitly so
this check stays trustworthy, and the first run before that was in place proposed
dropping all four CHECKs and all five named indexes.

## The published contract

Every route this service serves is described in
[`docs/openapi.yaml`](docs/openapi.yaml) — OpenAPI 3.1, hand-written from responses
captured off the running API rather than generated from decorators. It is browsable
at **`GET /docs`**, which needs no credentials:

```bash
open http://localhost:3000/docs        # Swagger UI
curl -s localhost:3000/docs-yaml       # the document itself, over HTTP
```

**Read [`docs/openapi-divergences.md`](docs/openapi-divergences.md) before building
against it.** The contract describes what the code *does*, which is not the same
question as whether the code is *right* — every place the two documents disagree with
the product design is recorded there with a verdict. One row is marked
`DO NOT ADOPT`: the buyer's case-file `steps` is always empty where the design says it
carries a summarised trace.

Three things to know if you edit the contract:

- It is read from disk at boot, so a change needs `docker compose restart api` — the
  file is bind-mounted, so it does **not** need a rebuild.
- `.dockerignore` excludes `docs/` and carries a `!docs/openapi.yaml` negation. Remove
  that line and `/docs` keeps working on your host and 404s in the container.
- A malformed document does not stop the API booting: the loader logs an error and
  skips mounting Swagger. If `/docs` is missing, check the startup log.

Regenerate the captures the contract is written from with:

```bash
node scripts/verify-012.mjs ./captures
```

## Auth

A wallet signature in, a session token out. **Connecting a wallet is the entire
registration** — no passwords, no email, no roles. First successful sign-in creates the
account.

### Signing in

```bash
# 1. ask for a challenge
curl -s -X POST http://localhost:3000/auth/nonce \
  -H 'content-type: application/json' \
  -d '{"address":"0x45fFda76D73321D35f53396f822bA550b6AF5389"}'
# {"nonce":"3f7a…","message":"Guardian: sign in to your account.\n\n…"}

# 2. sign `message` VERBATIM — byte for byte, newlines included
cast wallet sign --private-key "$PK" "$MESSAGE"

# 3. exchange the signature for a token
curl -s -X POST http://localhost:3000/auth/verify \
  -H 'content-type: application/json' \
  -d '{"address":"0x45fF…5389","signature":"0xcf9c…1c"}'
# {"token":"eyJhbGciOiJIUzI1NiIs…"}
```

The message is composed server-side (`src/auth/sign-in-message.ts`) and returned so the
format has exactly one implementation. Assembling it on the client means two copies of an
unversioned string, and the failure mode is silent — a changed word or a trailing newline
recovers some unrelated address and the user sees "signature does not match" with nothing
pointing at formatting.

Then `Authorization: Bearer <token>` on everything else. Valid **7 days**. There is no
refresh, no sign-out, and no revocation — a token simply lapses.

`GET /auth/session` (protected) returns `{ accountId, address }`: what a client calls on
load to learn whether a stored token is still good and whose it is. **It is not `/me`** —
that arrives in API-05 with balance and escrow, and the two do not collide.

### ⚠️ Endpoints are protected by DEFAULT

`JwtAuthGuard` is registered as a global `APP_GUARD` and is fail-closed. **A new route
needs no annotation to be protected.** Opting out is the only thing that takes a keystroke:

```ts
import { Public } from '../auth/public.decorator';

@Get()
@Public()
check() { /* … */ }
```

Public today: `GET /health`, `POST /auth/nonce`, `POST /auth/verify`, the catalogue reads
(API-06), and `/demo/*`. Everything else is protected by saying nothing. Adding `@Public()`
anywhere else deserves the scrutiny of deleting an authorisation check, because that is
what it is.

### Who is calling, and what they may touch

`@CurrentAccount()` hands a handler the full `Account` the guard already loaded — no second
query:

```ts
const agent = await this.agents.findById(id);
if (agent.ownerAccountId !== account.id) throw new ForbiddenException();
```

**`401` means "I don't know who you are"; `403` means "I know, and it isn't yours."** The
guard only ever produces `401`. Every `403` in this backend comes from a check like the one
above, written at the resource.

**There are no roles.** No role column, no role claim, no `@Roles()` decorator. The same
account sells agents and buys other people's; permission is always ownership of the
specific row.

### Do not import `src/auth/` internals

`AuthModule` exports nothing, on purpose — `JwtService`, `NonceStore`, and `AuthService`
all stay inside it. Anything that could sign a token could mint one for another account,
which would make the guard decorative; the guarantee is only real if there is exactly one
place a token is born. `@Public()` and `@CurrentAccount()` are the whole contract, and
nothing outside `auth/` should read the `Authorization` header or decode a token.

`JWT_SECRET` (32+ characters) is a required `.env` key — the API will not boot without it.

Contracts:
[`auth-api.md`](./specs/004-wallet-auth/contracts/auth-api.md) (HTTP shapes and error
table) and
[`guard-contract.md`](./specs/004-wallet-auth/contracts/guard-contract.md) (the surface
API-05 onward is written against).

## The demo rig

Two routes, at `/demo`. Both are **unauthenticated and unguarded by any
environment check** — a recorded decision (`docs/api-design.md` §8), because you
will run the three acts many times and re-seeding by hand at 3am is how demos
get broken.

| Method | Path | What it does |
| --- | --- | --- |
| `POST` | `/demo/seed` | Creates the three seller agents and returns the fixtures for driving the acts. Idempotent. |
| `POST` | `/demo/reset` | Clears orders, runs, complaints and verdicts. Keeps accounts, agents and the ledger. |

⚠️ **Anyone who can reach a deployed instance can call both.** The containment is
that neither is dangerous in a way the operator could not reproduce themselves:
the seed is idempotent, the reset clears nothing on an empty database, neither
response carries a seller's `systemPrompt`, and reset makes no chain call at all.

### ⚠️ `reset` does not give the money back

It deletes the platform's *record* of a rehearsal. It does not — and cannot —
recall funds. Ledger entries are **preserved**, not reversed: balances after a
reset are exactly what they were before it. Money that reached an escrow deal or
settled on-chain is under an address the platform cannot spend from.

So a long rehearsal session spends real balance and needs topping up through the
ordinary funding path. If reset is called mid-act, the response reports how many
orders were still in flight — each of those left funds escrowed until the
contract's own deadline permits a force-settlement.

### Running the demo

```bash
curl -s -X POST localhost:3000/demo/seed > seed.json     # slow: three on-chain registrations
jq -r '.fixtures[] | "act \(.act) → \(.agentKey) → expect \(.expectedTier)"' seed.json
```

Then, for each act in order, post that fixture's `input` and `acceptanceCriteria`
to `POST /orders`, wait for the order to reach `delivered` or `failed`, and post
its `complaint` to `POST /orders/:id/complain`.

⚠️ **Paste the fixture, do not retype it.** The seeded outcome is keyed on the
exact input, so a changed character — or a reordered array — gets a real model
run instead of the scripted one. (That is the honest answer to *"is this thing
actually running?"*, and worth demonstrating on purpose.)

Between rehearsals: `curl -s -X POST localhost:3000/demo/reset`. No re-seed is
needed — the agents survive, and the fixtures are registered at boot rather than
by the seed, so they survive a restart too.

`DEMO_SELLER_ADDRESS` is where every seller payout lands. See
[`specs/011-demo-seed-fixtures/quickstart.md`](./specs/011-demo-seed-fixtures/quickstart.md)
for the full verification run.

## Tests

There are no automated tests in this component, by project decision. Verification is
the manual scripts in
[`specs/001-api-foundation/quickstart.md`](./specs/001-api-foundation/quickstart.md)
and
[`specs/002-entities-migrations/quickstart.md`](./specs/002-entities-migrations/quickstart.md).
