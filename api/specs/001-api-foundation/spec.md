# Feature Specification: API Foundation

**Feature Branch**: `001-api-foundation`

**Created**: 2026-08-08

**Status**: Draft

**Input**: User description: "docs/specs/API-01-foundation.md — A backend service that starts, connects to Postgres, and answers `/health`, with the config, migration, and container plumbing every later spec assumes."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Cold start yields a live service (Priority: P1)

A developer with a freshly cloned repository and a filled-in root environment file runs a single command and, without any further manual step, gets a running backend that answers a health check confirming it reached the database.

**Why this priority**: This is the whole point of the foundation — every later feature is built and demonstrated on top of a stack that comes up in one command. If nothing else in this feature existed, a one-command working service still delivers value on its own.

**Independent Test**: From a machine with no prior state (no containers, no database volume), run the single start command and request the health endpoint. Delivers value: a reproducible environment anyone on the team can stand up.

**Acceptance Scenarios**:

1. **Given** no containers running and no existing database volume, **When** the developer runs the single start command, **Then** the service becomes reachable and the health endpoint reports a healthy status including confirmed database connectivity.
2. **Given** the stack is already running, **When** the health endpoint is requested repeatedly, **Then** it responds successfully every time without side effects on stored data.
3. **Given** the database is not yet accepting connections, **When** the stack is starting, **Then** the service waits for the database to become ready rather than starting and exiting.

---

### User Story 2 - Misconfiguration fails loudly at boot (Priority: P2)

A developer who forgets a required environment value learns about it immediately at startup, from a message that names what is missing — instead of discovering it hours later as an unrelated-looking runtime failure deep in a demo.

**Why this priority**: The most expensive class of failure in a time-boxed build is a configuration error that surfaces far from its cause. Independently valuable: even with nothing else built, a validated configuration layer prevents the single most common source of lost time.

**Independent Test**: Remove or blank one required configuration value and start the service; confirm it refuses to start and names the offending key. Repeat with a value of the wrong shape (e.g. a non-numeric value where a number is required).

**Acceptance Scenarios**:

1. **Given** a required configuration value is absent, **When** the service starts, **Then** startup aborts with a non-zero exit and a message that names the missing key.
2. **Given** a configuration value is present but malformed for its declared type, **When** the service starts, **Then** startup aborts with a message that names the key and describes the expected form.
3. **Given** several required values are absent at once, **When** the service starts, **Then** the failure message reports all of them, not only the first.
4. **Given** all required values are present and valid, **When** the service starts, **Then** no configuration warnings are emitted and startup proceeds.
5. **Given** the service is running, **When** application code reads a configuration value, **Then** the value is typed and guaranteed present — no code path needs to handle a missing key at point of use.

---

### User Story 3 - Schema changes are an explicit, reviewable step (Priority: P3)

Whoever runs the stack gets a database whose shape was applied by a named, versioned migration step that runs to completion before the service accepts traffic — never by the service silently reshaping the database to match the current code.

**Why this priority**: Automatic schema reshaping and hand-written migrations are two mechanisms competing for the same job, and the one that wins is the one nobody reviewed. Establishing the boundary now costs nothing; retrofitting it after data exists is painful. It ranks third only because the schema itself carries no content until the next feature.

**Independent Test**: Start the stack and observe that the migration step runs as its own unit, completes successfully, and exits before the service starts. Then confirm that starting the service against a database whose shape differs from the code's expectations does not cause the database to be altered.

**Acceptance Scenarios**:

1. **Given** a cold database, **When** the stack starts, **Then** the migration step runs to successful completion and exits, and only then does the service start.
2. **Given** the migration step fails, **When** the stack starts, **Then** the service does not start and the failure is attributable to the migration step.
3. **Given** all migrations have already been applied, **When** the stack is restarted, **Then** the migration step completes without reapplying anything and the service starts normally.
4. **Given** the service is running, **When** it connects to the database, **Then** it makes no schema modifications of any kind.
5. **Given** a developer needs to change the schema, **When** they use the provided generate / apply / revert commands, **Then** each produces a versioned artifact that can be reviewed, applied, and undone.

---

### Edge Cases

- **Database restarts while the service is running**: the health endpoint reports an unhealthy status rather than reporting healthy on the strength of the process being alive.
- **Running outside the container stack**: the same service starts against a locally reachable database using the repository-root configuration value, with no code change — the containerized run overrides only the database location.
- **Repeated cold starts**: tearing the stack down including stored data and bringing it back up produces the same result as the first cold start, with no leftover state required.
- **Port already in use**: startup fails with a message identifying the conflict rather than hanging.

## Requirements *(mandatory)*

### Functional Requirements

**Service and health**

- **FR-001**: The system MUST expose a health endpoint at `GET /health` that requires no authentication.
- **FR-002**: The health endpoint MUST report success only when the service can reach the database, and MUST report an unhealthy status when it cannot.
- **FR-003**: The health endpoint MUST respond without reading or writing any domain data.
- **FR-004**: The service MUST listen on a configurable network port, defaulting to a documented value when unset.

**Configuration**

- **FR-005**: The system MUST load all configuration from a single environment file at the repository root, shared by every component of the project.
- **FR-006**: The system MUST validate the complete set of required configuration values once, at startup, before serving any request.
- **FR-007**: The system MUST refuse to start — with a non-zero exit and a message naming every offending key — when any required value is missing or fails its declared type or format.
- **FR-008**: The system MUST expose validated configuration to application code as typed values that are guaranteed present, so no consumer handles a missing key at point of use.
- **FR-009**: The system MUST never log secret configuration values (private keys, API keys, database credentials) — neither on validation failure nor at any other time.
- **FR-010**: The required configuration set MUST cover the values the wider platform depends on — database location, chain endpoint and identifiers, contract and wallet addresses, operator and guardian signing keys, the model-provider key, the stubbed-integration toggle, and the demo review-window duration — so that later features add behavior without revisiting configuration plumbing.

**Database connection and schema**

- **FR-011**: The system MUST connect to the database using a single connection definition that is shared by the running service and by the schema tooling.
- **FR-012**: The system MUST have automatic schema synchronization permanently disabled; the running service MUST NOT create, alter, or drop database objects under any circumstance.
- **FR-013**: The system MUST provide named commands to generate a new migration, apply pending migrations, and revert the most recent one.
- **FR-014**: Applying migrations MUST be idempotent across restarts — already-applied migrations are not reapplied.

**Startup orchestration**

- **FR-015**: The system MUST bring up the full stack — database, schema migration, service — from a single command, from a cold machine with no pre-existing stored data.
- **FR-016**: The database MUST report readiness through a health probe, and dependent steps MUST wait for that readiness rather than starting optimistically.
- **FR-017**: Migration MUST run as its own one-shot step that exits on completion, and the service MUST start only after that step exits successfully.
- **FR-018**: The containerized run MUST override the database location so that it resolves inside the container network, while the repository-root value remains correct for running outside containers.
- **FR-019**: The service MUST be buildable into a runnable container image from the repository as checked in, with no manual pre-steps.

**Code quality gates**

- **FR-020**: The codebase MUST be compiled under the strictest available type-checking settings, and MUST fail the build on a type error.

### Key Entities

- **Configuration Set**: The validated collection of environment-supplied values the service needs to run. Attributes: key name, declared type/format, required-or-defaulted, secret-or-not. Sourced once at startup; immutable thereafter.
- **Migration**: A named, ordered, versioned description of a schema change, with a forward and a reverse direction. Recorded as applied so it runs at most once per database.
- **Health Report**: The outcome of a liveness check — overall status plus per-dependency status, currently just the database.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A developer with a filled-in configuration file goes from a cold machine to a healthy service with one command and zero manual intervening steps.
- **SC-002**: A cold start completes and the health endpoint returns healthy within 90 seconds on a typical developer laptop (excluding first-time image downloads).
- **SC-003**: A restart of an already-initialized stack reaches a healthy health endpoint within 30 seconds.
- **SC-004**: 100% of required configuration values, when missing or malformed, prevent startup and are named in the failure message — verified by removing each one in turn.
- **SC-005**: Time from an incorrect configuration file to the developer knowing exactly which key is wrong is under 30 seconds, requiring no log spelunking beyond the startup output.
- **SC-006**: Zero schema changes are made by the running service; the only path that alters the database is the migration step — verified by comparing the database shape before and after a service run.
- **SC-007**: Three consecutive full teardown-and-cold-start cycles all succeed, with no manual cleanup between them.
- **SC-008**: No secret value appears anywhere in startup or runtime output.

## Assumptions

- **Verification is manual.** Per the component briefing, automated tests of any kind are out of scope for this component; every acceptance scenario and success criterion above is checked by hand. The demo rehearsal is the de facto test suite.
- **The mandated stack is a given, not a choice.** The surrounding project fixes the runtime (a Node/TypeScript service framework), the database (PostgreSQL), the schema tooling (an ORM with file-based migrations), and container orchestration (Compose). This spec constrains behavior; it does not re-open those decisions.
- **The full platform configuration set is required at boot from day one**, not just the values this feature uses. The project's bootstrap order deploys the contract and funds wallets before the service is scaffolded, so those values exist by the time this runs — and validating them once here means no later feature has to touch configuration plumbing.
- **A single environment file at the repository root** serves the backend, the frontend, and the contract tooling. It is not committed; a committed template documents every key.
- **The database credentials and database name for local development are fixed and non-secret** (a local throwaway instance), so they can live in the orchestration definition rather than in the environment file.
- **Development convenience over production hardening**: source mounted for reload, database port published to the host, no TLS, no secret manager. This is a hackathon-timeboxed environment, not a deployment target.
- **Data content is out of scope**: no entities, no migration contents, no domain logic, no authentication, and no chain access are delivered here. The migration step is expected to run successfully with zero or one trivial migration; the schema itself arrives in the next feature.
- **The health check is shallow by design** — service liveness plus a database round-trip. It does not probe the chain endpoint or the model provider, both of which are external and would make an unrelated outage look like a service failure.
