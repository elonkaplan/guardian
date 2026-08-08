# Phase 0 Research: API Foundation

Eight decisions. Each one is somewhere this feature could quietly go wrong later.

---

## R1 — Config validation library: Zod

**Decision**: Validate the environment with a Zod schema passed to
`ConfigModule.forRoot({ validate })`.

**Rationale**: Zod is already in the stack — [`docs/tech-stack.md`](../../../docs/tech-stack.md)
specifies `client.messages.parse()` with a Zod schema for both LLM roles. Reusing it
for config means one validation idiom in the codebase and no new dependency. It also
gives the thing `class-validator` cannot: `z.infer<typeof schema>` is a *type*, so the
validated config is statically typed for free (FR-008), rather than a `Record<string,
unknown>` you cast at each read.

**Alternatives considered**: `class-validator` + `class-transformer` is the NestJS
documentation default, but it needs a decorated class and still yields a value whose
type you assert; Joi is the other documented option and drags in a second schema
grammar for no benefit.

---

## R2 — Fail-fast semantics: collect all errors, exit non-zero, print no values

**Decision**: The `validate` function runs `schema.safeParse(process.env)`. On failure
it formats **every** issue (`result.error.issues`) as `KEY: message`, writes them to
stderr, and throws — Nest's bootstrap then rejects and `main.ts` calls
`process.exit(1)`. The formatter prints key names and expected forms only; it never
prints the received value.

**Rationale**: FR-007 requires all offending keys in one message — a developer who
fixes one key, restarts, and finds a second missing key has learned the same lesson
twice. Zod's `safeParse` collects issues by default; `parse` throws on the first one
only when the schema is short-circuited, so the collect-all behavior is free as long
as the top-level object schema is used. FR-009 is why the value is never echoed:
`DATABASE_URL` contains a password and `*_PRIVATE_KEY` is a private key — a validation
error is precisely the moment naive code prints "expected X, received Y".

**Alternatives considered**: throwing on the first issue (simpler, worse); logging via
the Nest logger (not yet constructed at validation time — this runs during module
initialization, so stderr is the reliable channel).

---

## R3 — Locating the repository-root `.env` from two different working directories

**Decision**: `ConfigModule.forRoot({ isGlobal: true, envFilePath: '../.env' })` for
the Nest process, and an explicit `dotenv.config({ path: resolve(__dirname, '../../.env') })`
at the top of `src/data-source.ts` for the CLI.

**Rationale**: This is the "works on my machine" trap the source spec warns about,
in a second form. Outside Docker the process cwd is `api/`, so `../.env` resolves to
the repository root. Inside Docker there *is* no `../.env` — the values arrive through
Compose's `env_file: ../.env`, already in `process.env`, and `ConfigModule` silently
skips a missing env file rather than failing. Both paths therefore work with one
setting. `data-source.ts` needs its own `dotenv` call because the TypeORM CLI boots it
directly, with no Nest lifecycle to load config first — forget this and
`migration:run` reports an undefined connection string that looks like a Docker
networking fault.

**Alternatives considered**: a symlinked `api/.env` (invisible indirection, and it
breaks `.gitignore` expectations); duplicating keys into `api/.env` (two sources of
truth — the exact thing the root-`.env` decision exists to prevent).

---

## R4 — One `DataSource`, exported two ways

**Decision**: `src/data-source.ts` exports a named `dataSourceOptions:
DataSourceOptions` **and** a default `new DataSource(dataSourceOptions)`. The Nest
`DatabaseModule` imports `TypeOrmModule.forRoot(dataSourceOptions)`; the CLI consumes
the default export via `-d src/data-source.ts`.

**Rationale**: If the application and the CLI each build their own connection config,
they drift — and the drift shows up as migrations applied to a database the API isn't
reading. One object, two consumers, no divergence possible.

Settings on that object:

| Setting | Value | Why |
| --- | --- | --- |
| `type` | `postgres` | — |
| `url` | `process.env.DATABASE_URL` | Single connection string, overridden in Compose |
| `synchronize` | **`false`** | Invariant. Two schema mechanisms fighting is worse than either alone (FR-012) |
| `migrationsRun` | `false` | The `migrate` service runs them, not the app (FR-017) |
| `entities` | `[__dirname + '/**/*.entity{.ts,.js}']` | Glob covers ts-node and compiled runs |
| `migrations` | `[__dirname + '/migrations/*{.ts,.js}']` | Same |
| `logging` | `['error', 'warn']` | Query logging would print parameter values |

**Alternatives considered**: `TypeOrmModule.forRootAsync` reading from `ConfigService`
— slightly more idiomatic Nest, but then the CLI can't reuse it without booting Nest,
which reintroduces the drift this decision exists to prevent.

---

## R5 — Health check: Terminus with a database ping

**Decision**: `@nestjs/terminus`, one controller, `TypeOrmHealthIndicator.pingCheck('database', { timeout: 1500 })`.

**Rationale**: FR-002 requires the endpoint to be red when the database is
unreachable — a process-liveness `return { status: 'ok' }` would report healthy while
every real request fails, which is worse than no health check because it makes the
Compose dependency graph lie. Terminus's ping issues `SELECT 1`, touching no domain
data (FR-003), and returns the conventional
`{ status, info, error, details }` envelope. The 1.5s timeout keeps a hung database
from hanging the probe. The route is registered before any guard exists, and no guard
is added to it (FR-001).

**Alternatives considered**: hand-rolling `dataSource.query('SELECT 1')` in a plain
controller — fewer dependencies, but re-implements the response envelope and the
timeout handling that Terminus already gets right.

**Deliberately not checked**: the Monad RPC endpoint and the Anthropic API. Both are
third-party; probing them makes an unrelated outage look like a service failure, and
would make the Compose healthcheck fail for reasons the developer cannot fix.

---

## R6 — Compose topology: healthcheck → one-shot migrate → api

**Decision**: Three services, exactly as
[`docs/project-structure.md`](../../../docs/project-structure.md) §3.1 specifies.
`postgres` declares `pg_isready` as its healthcheck; `migrate` depends on
`postgres: { condition: service_healthy }` and runs `npm run migration:run` as its
command, exiting when done; `api` depends on both `postgres: service_healthy` and
`migrate: service_completed_successfully`.

**Rationale**: `service_completed_successfully` is the load-bearing clause — it means
a failed migration stops the API from starting rather than letting it serve against a
half-migrated schema (FR-017, and the P3 acceptance scenarios). The Postgres
healthcheck is the other one: without it the API connects before Postgres accepts
connections, the first query fails, the container exits, and the symptom reads as a
code bug (FR-016).

`DATABASE_URL` is overridden in-Compose to `postgresql://postgres:postgres@postgres:5432/guardian`
— host `postgres`, not `localhost` (FR-018). The root `.env` value stays pointed at
`localhost` for running outside Docker.

**Alternatives considered**: `migrationsRun: true` on the DataSource (schema changes
become invisible boot-time side effects — rejected by FR-012's intent); a wait-for-it
shell wrapper (reimplements the healthcheck Compose already provides).

---

## R7 — Single-stage development Dockerfile

**Decision**: One stage, `node:24-alpine`, `npm ci` installing **all** dependencies
including dev, `CMD ["npm", "run", "start:dev"]`. The `migrate` service reuses the
identical image with a command override.

**Rationale**: The `migration:run` script is `typeorm-ts-node-commonjs`, which needs
`ts-node` and `typescript` at runtime — a production multi-stage build that prunes dev
dependencies cannot run it. Since Compose already bind-mounts `./src:/app/src` for
reload, a slim image would be pretending anyway. One image serving both `api` and
`migrate` also guarantees the two run identical code.

`node:24-alpine` is the active LTS; the host runs Node 26.7 and nothing here uses a
version-gated API, so the gap is inert. `.dockerignore` excludes `node_modules`,
`dist`, `.git`, and `specs/` so the bind mount and build context don't fight.

**Alternatives considered**: multi-stage with a compiled `dist/` (correct for
production, and explicitly out of posture for a time-boxed demo — the spec's
Assumptions say development convenience over production hardening); a separate
migration image (two images to keep in sync, for nothing).

---

## R8 — Whole-platform schema, enforced from day one

**Decision**: `src/config/env.schema.ts` enforces **every** key in
[`contracts/config-schema.md`](./contracts/config-schema.md) — core, chain, LLM, Rain,
product tuning — each required and format-checked at boot. No stages, no optional
members, no modes.

**Rationale**: FR-010 as written. One schema, validated once, and every later module
reads a `string` rather than a `string | undefined` — which is what keeps FR-008 true
as the codebase grows rather than only on the day it was written. The alternative
considered and rejected earlier — declaring platform keys `.optional()` until first
use — would have satisfied FR-010 on paper while permanently degrading the config type
for every module that came after.

The keys that were empty are now populated with format-valid placeholders (see R9), so
enforcing everything costs nothing today.

**Format rules**:

| Key group | Rule |
| --- | --- |
| Addresses | `/^0x[a-fA-F0-9]{40}$/` |
| Private keys | `/^0x[a-fA-F0-9]{64}$/` |
| `MONAD_CHAIN_ID` | positive integer |
| `REVIEW_WINDOW_SECONDS` | integer **≥ 1** — never 0, see [`docs/smart-contract.md`](../../../docs/smart-contract.md) §11.3 |
| `SWEEPER_INTERVAL_MS` | positive integer |
| `RAIN_ENABLED` | boolean, coerced from `'true'`/`'false'` |
| URLs | parseable URL |

**One key deliberately excluded**: `DEPLOYER_PRIVATE_KEY`. It is used once by
`forge script` and nothing in the running system reads it. Validating it would invite
someone to inject it, which is the first step toward the API being able to sign a
deployment — the opposite of the role separation in
[`docs/CONTEXT.md`](../../../docs/CONTEXT.md) §5.

**Alternatives considered**: a `BOOTSTRAP=true` escape-hatch mode (a mode nobody
remembers to turn off, and it makes "fail loudly" conditional); a staged schema
activating keys at first use (defensible while the `.env` was empty, unnecessary now,
and it leaves the enforcement rule split across five future specs).

---

## R9 — Placeholder detection at boot

**Decision**: After validation succeeds, the config layer tests each value against the
known placeholder patterns — `/^0xDEAD0+\d{4}$/` for addresses and private keys, an
`sk-ant-placeholder` prefix for the Anthropic key — and emits **one** `WARN` line
naming the keys that still hold placeholders. Names only, never values. Non-blocking.

**Rationale**: This is the price of filling the `.env` with fakes so the platform-wide
schema can be enforced today. A placeholder that passes a regex is in one respect
worse than an absent value: it defers the failure and moves it far from its cause. A
fake private key is a perfectly valid secp256k1 scalar, so `viem` derives an address,
signs, and the transaction fails on-chain against an unfunded account — an error that
reads as a funding problem or an RPC problem, not as a configuration problem. Twenty
minutes of a demo rehearsal disappear into that.

The warning restores the property the empty values had for free: you find out at boot.
It stays non-blocking because the whole point of the placeholders is that the service
must start before `sc/` is deployed.

**Pattern coupling**: the regex is coupled to the placeholder convention documented at
the top of `.env`. That coupling is the design — if someone invents a different fake
value, the warning silently stops covering it, which is why the convention is written
into the file itself rather than living only here.

**Alternatives considered**: failing the boot on a detected placeholder (defeats the
purpose — nothing would start until the contract is deployed); checking the on-chain
code size at the escrow address to detect a non-contract (a real check, but it makes
boot depend on RPC availability, which R5 already rejected for `/health`); no
detection at all (cheapest, and it is precisely the failure mode this feature exists
to prevent).

---

---

## R10 — A preflight process, because `--watch` swallows exit codes *(added during implementation)*

**Decision**: `start` and `start:dev` both run `npm run preflight &&` first — a plain
`ts-node` process (`src/config/preflight.ts`) that parses the same schema, prints the
same report, and calls `process.exit(1)`.

**Rationale**: found by running quickstart B1. `nest start --watch` catches the
child's failure and keeps watching for file changes, so a container with a blank
`DATABASE_URL` printed a perfect error report and then sat there **Up** — alive,
permanently broken, and reporting success to Compose. `docker compose run` hung
rather than returning 1. The watcher is the whole reason the source is bind-mounted,
so removing it was not an option; running the check in a process that can exit
honestly was. The config module still validates at boot — the preflight is the outer
gate, not a replacement.

**Alternatives considered**: dropping `--watch` in the container (loses the reload the
bind mount exists for); `restart: on-failure` in Compose (turns a config error into a
crash loop, which is a worse way to learn the same thing).

---

## R11 — Toolchain versions found at install time *(added during implementation)*

Three resolutions differed from what the plan assumed. None changed the design; all
three are recorded because the next person will hit them.

| Package | Assumed | Actual | Consequence |
| --- | --- | --- | --- |
| TypeScript | 5.x | **6.0.3, pinned `^6`** | 7.0.2 installs by default and the Nest CLI refuses it — 7.0 ships `tsc` only, and the programmatic compiler API returns in 7.1. TS 6 also requires an explicit `rootDir` and rejects `baseUrl` |
| TypeORM | 0.3.x | **1.1.0** | No impact: `typeorm-ts-node-commonjs` still ships, and `@nestjs/typeorm@11` declares `typeorm: ^0.3.0 \|\| ^1.0.0-dev` |
| Node (image) | 24-alpine | 24-alpine | Host runs 26.7; both work |

**`incremental: true` is off, deliberately.** Combined with Nest's
`deleteOutDir: true` it produces a genuinely nasty failure: tsc wipes `dist/`, then a
surviving `.tsbuildinfo` convinces it the JavaScript is already emitted, so it writes
declarations only and the process dies on `Cannot find module dist/main`. It cost two
debugging rounds here — once inside the image (a host `.tsbuildinfo` copied in through
a gap in `.dockerignore`) and once on the host. `*.tsbuildinfo` is now ignored in both
places *and* the flag is off.

---

## Unknowns remaining

None. No `NEEDS CLARIFICATION` markers entered the Technical Context.
