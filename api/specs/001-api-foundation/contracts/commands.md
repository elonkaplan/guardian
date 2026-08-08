# Contract: Commands

The operator-facing surface of this feature. Exit codes are part of the contract —
Compose's `service_completed_successfully` depends on them.

## npm scripts (`api/package.json`)

| Script | Command | Exit semantics |
| --- | --- | --- |
| `preflight` | `ts-node --transpileOnly src/config/preflight.ts` | Validates the environment in its own process. **Exit 1 with the full report** on any invalid key; silent and 0 otherwise |
| `start` | `npm run preflight && nest start` | Non-zero if preflight fails; otherwise long-running |
| `start:dev` | `npm run preflight && nest start --watch` | Same. The preflight gate exists because `nest start --watch` swallows its child's exit code — without it a misconfigured container stays **Up** and permanently broken instead of exiting |
| `build` | `nest build` | Non-zero on any type error — strict mode is a build gate (FR-020) |
| `migration:generate` | `typeorm-ts-node-commonjs migration:generate -d src/data-source.ts` | Requires a path argument: `npm run migration:generate -- src/migrations/InitialSchema`. Non-zero if the database is unreachable or nothing changed |
| `migration:run` | `typeorm-ts-node-commonjs migration:run -d src/data-source.ts` | **`0` on success, including when zero migrations are pending.** Non-zero on any failure |
| `migration:revert` | `typeorm-ts-node-commonjs migration:revert -d src/data-source.ts` | Reverts exactly the most recently applied migration |

`migration:run` exiting `0` with nothing to do is the normal restart path — the `api`
service gates on it, so a "nothing pending" non-zero exit would deadlock the stack.

## Compose

Run from `api/`.

| Command | Effect |
| --- | --- |
| `docker compose up` | The one command. `postgres` → healthy → `migrate` → exit 0 → `api` |
| `POSTGRES_HOST_PORT=5433 docker compose up` | Same, when a native Postgres already holds host port 5432. The published port is host convenience only — the API reaches Postgres over the Compose network either way |
| `docker compose up --build` | Same, forcing an image rebuild after a dependency change |
| `docker compose down` | Stops everything; **keeps** the `pgdata` volume |
| `docker compose down -v` | Stops everything and **destroys** the database — this is what makes the next start a true cold start |
| `docker compose logs -f api` | Follow the service; where a config-validation failure appears |
| `docker compose ps` | Confirm `migrate` shows `exited (0)` and not `exited (1)` |

## Placeholder audit

```bash
grep -n 'TODO(placeholder)' ../.env     # every value still fake
docker compose logs api | grep -i placeholder   # the boot WARN, names only
```

Both must be empty before any chain or LLM path can work. See
[`config-schema.md § Placeholders`](./config-schema.md#placeholders).

## Service dependency contract

```
postgres  ──(healthcheck: pg_isready)──▶  migrate  ──(exit 0)──▶  api
```

| Service | Gate it waits on | Failure behavior |
| --- | --- | --- |
| `postgres` | — | Retries the healthcheck up to 10× at 3s intervals |
| `migrate` | `postgres: service_healthy` | Non-zero exit ⇒ `api` never starts |
| `api` | `postgres: service_healthy` **and** `migrate: service_completed_successfully` | Config failure ⇒ non-zero exit, container stops |

## Host run (outside Compose)

```
# requires a Postgres reachable at the .env DATABASE_URL (localhost)
npm install
npm run migration:run
npm run start:dev
```

Identical behavior, one difference: `DATABASE_URL` comes from the repository-root
`.env` (host `localhost`) rather than the Compose override (host `postgres`). That
single substitution is the whole difference between the two run modes.
