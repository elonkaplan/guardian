# Guardian API

The Guardian backend: marketplace, execution host, audit engine, and the only
component that talks to the chain. Currently at the foundation stage — config
loading, database connection, and migrations are wired up, with a single
`GET /health` endpoint. No domain logic yet.

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

## Tests

There are no automated tests in this component, by project decision.
Verification is the manual script in
[`specs/001-api-foundation/quickstart.md`](./specs/001-api-foundation/quickstart.md).
