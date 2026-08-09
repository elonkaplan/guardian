# Implementation Plan: The published API contract & its divergence report

**Branch**: `012-openapi-contract` | **Date**: 2026-08-09 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/012-openapi-contract/spec.md`

## Summary

Hand-write `docs/openapi.yaml` (OpenAPI 3.1) describing all **27 routes** the running
NestJS app registers, with shapes captured from live responses rather than transcribed
from TypeScript interfaces; serve it at `GET /docs` through `SwaggerModule.setup()` fed
a pre-built document object, reachable with no credentials; then diff the result against
`../docs/api-design.md` §3, `../docs/database-schema.md` §8 and `../docs/tech-stack.md` §5
and publish every difference in `docs/openapi-divergences.md` with a verdict.

No `@ApiProperty()` decorators are added anywhere. `@nestjs/swagger` is used purely as a
UI server for a document it did not generate, so no already-verified DTO is touched.

## Technical Context

**Language/Version**: TypeScript 5.x on Node 22+ (Docker image `node:24-alpine`)

**Primary Dependencies**: NestJS 11 (existing) · **new:** `@nestjs/swagger` (UI host for a
pre-built document) and `js-yaml` (currently only a transitive dep — must become direct)

**Storage**: None new. The contract is a file on disk read at boot; the divergence report is
a Markdown file in the repo.

**Testing**: No automated tests (standing component decision). Verification is a
`scripts/verify-012.mjs` capture harness reusing `scripts/verify-011-lib.mjs`
(`api()`, `signIn()`, `ok()`, `summary()`), plus reading `GET /docs` in a browser.

**Target Platform**: The API container from `api/docker-compose.yml`, port 3000

**Project Type**: Backend web service (single NestJS project under `api/`)

**Performance Goals**: None. `GET /docs` is a static document; the YAML is parsed once at boot.

**Constraints**:
- The contract must be reachable **anonymously** — the JWT guard is global and fail-closed.
- The YAML must be present **inside the container**. `.dockerignore` currently excludes
  `docs/` and `*.md`; unaddressed, `GET /docs` works on a host `npm run start:dev` and 404s
  in Docker, which is where the demo runs.
- A missing or unparseable YAML must not stop the API from booting.

**Scale/Scope**: 27 routes across 10 controllers · 4 enumerations · ~22 response schemas ·
~10 request schemas · at least 5 distinct error body shapes.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

`.specify/memory/constitution.md` is the **unmodified Spec Kit template** — every principle
is still a `[PRINCIPLE_N_NAME]` placeholder. There are no ratified gates to evaluate, so
this check is vacuous rather than passing.

The project's real governing constraints live in `docs/CONTEXT.md` (§2 nine invariants, §6
out of scope, "Automated tests — out of scope"). Checked against those:

| Constraint | Status |
| --- | --- |
| Invariant #3 — `system_prompt` never reaches a buyer | **Respected, and now written down.** The contract documents `GET /orders/:id/case-file` as two shapes and `systemPrompt` as seller-only. Documenting the boundary does not widen it. |
| Automated tests out of scope | Respected — verification is a capture script run by hand. |
| Out of scope: versioning, client SDKs, validation middleware | Respected — none introduced. |
| No behaviour change | Respected except where a divergence row is verdicted `api-wrong` (FR-022, FR-025). |

**Post-Phase-1 re-check**: unchanged. No new persistence, no new module boundary crossing,
no `execution ↔ guardian` import. The single new module (`src/docs/`) is wired in `main.ts`
and depends on nothing.

## Project Structure

### Documentation (this feature)

```text
specs/012-openapi-contract/
├── plan.md              # This file
├── research.md          # Phase 0 — the six decisions
├── data-model.md        # Phase 1 — the contract's component inventory
├── quickstart.md        # Phase 1 — how to build and verify it
├── contracts/
│   ├── route-inventory.md          # The authoritative 27 routes, auth mode, status codes
│   ├── error-shapes.md             # The five error bodies the API actually emits
│   └── divergence-report.template.md
└── tasks.md             # Phase 2 output (/speckit-tasks — NOT created here)
```

### Source Code (repository root = `api/`)

```text
api/
├── docs/
│   ├── openapi.yaml                 # NEW — the deliverable, hand-written
│   └── openapi-divergences.md       # NEW — the divergence report
├── src/
│   ├── main.ts                      # EDIT — load YAML, SwaggerModule.setup('docs', …)
│   └── docs/
│       └── openapi-document.ts      # NEW — read + parse the YAML, fail soft
├── scripts/
│   └── verify-012.mjs               # NEW — capture every response, diff against the YAML
├── .dockerignore                    # EDIT — re-include docs/openapi.yaml
├── docker-compose.yml               # EDIT — bind-mount the YAML for edit-without-rebuild
└── package.json                     # EDIT — add @nestjs/swagger, js-yaml
```

**Structure Decision**: The existing single NestJS service. The contract file lives at
`api/docs/openapi.yaml` because that is the path UI-08 consumes and the path the source
brief names; it is *not* placed under `src/` even though that would be simpler to ship,
because moving it would break the consumer this feature exists to serve. The container
reachability problem is solved in `.dockerignore` and `docker-compose.yml` instead — see
[research.md](./research.md) decision 2.

## Approach

Five stages, in order. Stages 1–3 are the contract; stages 4–5 are the honesty check.

1. **Inventory** — enumerate what the router actually registers (27 routes, listed in
   [contracts/route-inventory.md](./contracts/route-inventory.md)), with auth mode and
   success status per route. This list, not any design document, defines completeness.
2. **Capture** — run `scripts/verify-012.mjs` against a seeded, running API to record a
   real response body for every route, including the failure paths. Writes JSON into the
   scratchpad; the YAML is written from those files.
3. **Author** — hand-write `docs/openapi.yaml` from the captures, with shared `components`
   for the four enumerations and the ~22 response objects
   ([data-model.md](./data-model.md)).
4. **Serve** — `SwaggerModule.setup('docs', app, document)` in `main.ts`, verified
   anonymously *and inside the container*.
5. **Diff & resolve** — compare against the three design sections, write every row into
   `docs/openapi-divergences.md`, and resolve each: fix the API, update the design doc,
   record the reason, or mark it known-wrong.

**Order matters.** Authoring before capturing produces a document transcribed from types,
which is the one failure mode the spec names (FR-005). Serving before authoring produces a
`/docs` page that renders an empty or stale contract and looks finished.

## Known divergence candidates

Found while researching, before the formal diff. These are **starting rows, not the
report** — the diff in stage 5 is still run in full.

| # | Where | Design says | Code does | Likely verdict |
| --- | --- | --- | --- | --- |
| 1 | `POST /auth/nonce` | `{ address }` → `{ nonce }` | returns `{ nonce, message }` | `design-stale` — the client must sign `message` |
| 2 | `GET /auth/session` | absent from §3.1 | registered and served | `design-stale` |
| 3 | `GET /health` | absent from §3 | registered and served | `design-stale` |
| 4 | Verdict tier values | tech-stack §5 shows `"0"…"100"` | emits `none` … `full` (matches database-schema §8) | `design-stale` in tech-stack.md |
| 5 | Error bodies | §3 does not specify | **five different shapes** (see [contracts/error-shapes.md](./contracts/error-shapes.md)) | decide at implementation; the bare `{ error: "CODE" }` from the verdict route is the outlier |
| 6 | `POST` success codes | §3 does not specify | mixed 200/201/202 across POSTs | likely `intentional`, must be documented |

Two things the research **cleared**, which the source brief flagged as risks:

- **Citation field naming.** `tech-stack.md` §5 specifies `quote`; the API emits `quote`.
  The `clause`/`quote` incident (`67dcf4d`) was the UI's error and is already fixed. No row.
- **Seller-authorised reads.** `order.repository.ts` filters on
  `(o.buyer_account_id = :accountId OR a.owner_account_id = :accountId)` for
  `GET /orders/:id`, `/case-file` and `/verdict` — the buyer-*or*-owner rule of §3.4 is
  implemented. No `api-wrong` row. Still re-confirmed live in stage 2, since the spec makes
  it an acceptance scenario (US3 #3).

## Complexity Tracking

> No constitution gates exist to violate. One deliberate deviation from the source brief is
> recorded here because it adds a dependency.

| Decision | Why needed | Simpler alternative rejected because |
| --- | --- | --- |
| Add `@nestjs/swagger` | The brief specifies `SwaggerModule.setup()`; it also gives `/docs-yaml` and `/docs-json` for free, which UI-08 can fetch over HTTP instead of reading the repo | A hand-rolled HTML page loading Swagger UI from a CDN needs network access at demo time, and a CDN failure would blank the page a judge is looking at |
| Add `js-yaml` as a direct dep | The YAML is parsed at boot | Relying on it as a transitive dep of another package breaks silently on any lockfile change |
