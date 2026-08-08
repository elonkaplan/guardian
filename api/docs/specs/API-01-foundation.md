# API-01 — Foundation

**Component:** `api/` · **Depends on:** — · **Size:** Medium

> **Feed this file to `/speckit-specify`.** Read [`../CONTEXT.md`](../CONTEXT.md)
> first — it carries the nine backend invariants this spec assumes.

## Goal

A NestJS application that starts, connects to Postgres, and answers `/health` — with
the config, migration, and Docker plumbing every later spec assumes.

## In scope

- NestJS scaffold, TypeScript strict mode
- **Typed, validated config** loaded from the repo-root `.env`, failing loudly at
  boot on a missing key rather than at first use
- `data-source.ts` with **`synchronize: false`**
- `docker-compose.yml`: `postgres` (with healthcheck) → `migrate` (one-shot) → `api`
- `Dockerfile`, and `migration:generate` / `migration:run` / `migration:revert` scripts
- `GET /health`

## Out of scope

**Automated tests of any kind** (MVP decision — see `../CONTEXT.md`). Plus:

Entities, migrations content (API-02), any domain logic, auth, chain access.

## Acceptance

- `docker compose up` from cold yields a responding `/health`
- A missing required env var stops boot with a clear message
- `migrate` runs as its own service and the API waits for it to exit successfully

## Watch out for

- **`synchronize: false` is non-negotiable.** Left true, TypeORM reshapes the schema
  to match entities and the migrations become decoration — two mechanisms fighting,
  and the winner is the one nobody wrote.
- **`DATABASE_URL` differs inside Docker** — the host is `postgres`, not
  `localhost`. It's overridden in compose; the root `.env` value is for running
  outside Docker. Most common "works on my machine" trap in this setup.
- **The Postgres healthcheck matters.** Without it the API starts before Postgres
  accepts connections and the container exits — a failure that looks like a code bug.

## Source

`../../../docs/project-structure.md` §2, §3.
