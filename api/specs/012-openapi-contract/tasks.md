---

description: "Task list for 012-openapi-contract"
---

# Tasks: The published API contract & its divergence report

**Input**: Design documents from `/specs/012-openapi-contract/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/](./contracts/)

**Tests**: **No automated tests.** Standing component decision (`docs/CONTEXT.md` § *Automated tests — out of scope*). `scripts/verify-012.mjs` is a **capture and verification harness**, not a test suite — it records real responses so the contract can be written from them, and asserts the handful of facts the spec makes acceptance scenarios. Do not add jest, supertest, or a `tests/` directory.

**Organization**: Grouped by user story. Paths are relative to `api/`.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: [US1]…[US4], mapping to the user stories in spec.md
- Include exact file paths in descriptions

## ⚠️ One same-file constraint dominates this feature

Almost every US1 task edits **one file**, `docs/openapi.yaml`. They are therefore **not** parallelisable, and the near-absence of `[P]` below is a fact about the work rather than an oversight. The genuinely parallel work is in Setup and Foundational.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Dependencies and the build-config changes that decide whether `GET /docs` works where the demo runs

- [X] T001 Add `@nestjs/swagger` and `js-yaml` to `dependencies` and `@types/js-yaml` to `devDependencies` in `package.json`, then `npm install` and confirm `package-lock.json` updated
- [X] T002 [P] In `.dockerignore`, add `!docs/openapi.yaml` **after** the existing `docs/` and `*.md` lines so the contract is copied into the image; confirm with `docker build -t g-api-test . && docker run --rm g-api-test ls -l /app/docs/openapi.yaml`
- [X] T003 [P] In `docker-compose.yml`, add `./docs/openapi.yaml:/app/docs/openapi.yaml:ro` to the `api` service's `volumes` list so editing the contract does not require a rebuild
- [X] T004 [P] Create the placeholder `docs/openapi.yaml` with only `openapi: 3.1.0`, an `info` block naming the Guardian API, and empty `paths: {}` — so T002/T003 have a file to prove and so the serving story can be verified before the contract is written

**Checkpoint**: dependencies installed; a file at `docs/openapi.yaml` is present inside a built container

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Establish what the router actually serves, and capture the real responses every later phase is written from

**⚠️ CRITICAL**: No contract authoring may begin until the captures exist. Writing YAML before this phase is the "transcribed from types" failure the spec forbids (FR-005, FR-006).

- [X] T005 Boot the stack (`docker compose up -d`), extract the registered routes from the Nest boot log (`docker compose logs api | grep "Mapped {"`), and reconcile against `specs/012-openapi-contract/contracts/route-inventory.md` — correct the inventory file wherever the router disagrees, and record the true count
- [X] T006 Seed the demo (`curl -sX POST localhost:3000/demo/seed`) and confirm three agents and three fixtures come back, so the verdict and case-file routes are reachable
- [X] T007 Create `scripts/verify-012.mjs` importing `api`, `signIn`, `psql`, `ok`, `note`, `h`, `summary` from `scripts/verify-011-lib.mjs`; sign in as two accounts (a buyer and the demo seller), top the buyer up, and write every captured body plus its status to `$SCRATCH/captures/<METHOD>_<path>.json`
- [X] T008 In `scripts/verify-012.mjs`, drive one Act 3 order end to end — purchase → failed → complain → poll until a verdict exists — so `GET /orders/:id/verdict` and the post-settlement timestamp fields can be captured with real values
- [X] T009 In `scripts/verify-012.mjs`, capture a success body for **every** route in the corrected inventory, calling routes 18, 19 and 24 as **both** buyer and seller and saving both bodies separately; print any route that produced no capture
- [X] T010 In `scripts/verify-012.mjs`, provoke and capture every failure listed in `specs/012-openapi-contract/contracts/error-shapes.md` § *Failures the capture must provoke* (400×3, 401×2, 402, 404×4, 409×3, 503)

**Checkpoint**: `$SCRATCH/captures/` holds one file per route, both case-file variants, and ~14 failure bodies, with zero routes reported missing

---

## Phase 3: User Story 1 - A frontend engineer can trust one document instead of guessing (Priority: P1) 🎯 MVP

**Goal**: `docs/openapi.yaml` describes every registered route, with shapes taken from the captures field for field.

**Independent Test**: Diff the route set in the contract against the boot log both ways (zero differences), then pick any captured body and confirm every one of its field names appears in the contract with matching type and nullability.

### Assertions to add to the harness (these are acceptance scenarios, not tests)

- [X] T011 [US1] In `scripts/verify-012.mjs`, assert `GET /me` returns `settledFundsMinor` as a **present key** even when its value is `null` (SC-005, US1 #4)
- [X] T012 [P] [US1] In `scripts/verify-012.mjs`, assert the seller can read routes 18, 19 and 24 for an order on their own agent, and is refused on 21 and 22 (US1 #3, US3 #3)
- [X] T013 [P] [US1] In `scripts/verify-012.mjs`, assert no response body from any route except `GET /agents/:id/versions` and the seller's case file contains `systemPrompt` (invariant #3)

### Authoring the contract — all in `docs/openapi.yaml`, sequential

- [X] T014 [US1] Replace the placeholder in `docs/openapi.yaml` with the document skeleton: `openapi: 3.1.0`, `info` (title, version, a description stating the document describes observed behaviour and pointing at `openapi-divergences.md`), `servers`, `tags` per module, and `components.securitySchemes.bearerAuth` (HTTP bearer, JWT)
- [X] T015 [US1] Add the four enumerations to `components/schemas` in `docs/openapi.yaml` — `OrderState` (8), `LedgerKind` (4), `VerdictTier` (5), `CitationSource` (3) — with the exact member strings from `src/entities/enums.ts` (FR-009, SC-004)
- [X] T016 [US1] Add the auth, accounts, funding and Rain response schemas to `docs/openapi.yaml` per `data-model.md` §2, writing `settledFundsMinor` as `type: [integer, "null"]` **and** listing it in `required` (FR-010, FR-011)
- [X] T017 [US1] Add the catalogue response schemas to `docs/openapi.yaml` — `AgentSummaryResponse`, `OwnedAgentResponse`, `AgentListingResponse`, `AgentVersionDetailResponse`, `CreateAgentResponse`, `CreateVersionResponse`, `SetActiveResponse` — noting in `AgentVersionDetailResponse` that `systemPrompt` is owner-only
- [X] T018 [US1] Add the orders and case-file response schemas to `docs/openapi.yaml`, with `BuyerCaseFileResponse` / `SellerCaseFileResponse` (`allOf`) and a description on `OrderRunResponse.output` recording that `null` is the evidence of non-delivery, not an error
- [X] T019 [US1] Add `CitationResponse` and `VerdictResponse` to `docs/openapi.yaml`, with the citation field named **`quote`** and a description noting that a reader expecting `clause` is reading the wrong name
- [X] T020 [US1] Add the demo and health response schemas to `docs/openapi.yaml`, taking `HealthCheckResponse` verbatim from the captured Terminus body rather than from the library's types
- [X] T021 [US1] Add the request schemas to `docs/openapi.yaml` per `data-model.md` §3, with the real constraints from the Zod schemas (`amountMinor` = positive int ≤ `Number.MAX_SAFE_INTEGER`; `timeoutSeconds` positive int default 120), reusing one `CreateAgentRequest` `$ref` for both `POST /agents` and `POST /agents/:id/versions`
- [X] T022 [US1] Add the five error schemas to `docs/openapi.yaml` per `contracts/error-shapes.md`, each from a captured body, with a description on the 404/403 pair recording that the consuming UI treats them as final and every other status as retryable (FR-012)
- [X] T023 [US1] Add `paths` for auth, accounts, funding and Rain to `docs/openapi.yaml` (routes 1–10) with exact success codes — 201 for `/auth/nonce` and `/auth/verify`, 200 for the funding and Rain routes — and mark both Rain routes as requiring auth
- [X] T024 [US1] Add `paths` for the catalogue to `docs/openapi.yaml` (routes 11–16), documenting `GET /agents` as three behaviours: anonymous → public listings, `?owner=me` with a token → owned listings including inactive, `?owner=me` without → 401, and any other `owner` value → 400
- [X] T025 [US1] Add `paths` for orders, sales and the verdict to `docs/openapi.yaml` (routes 17–24), with 201 on `POST /orders`, **202** on accept and complain, `oneOf` on the case file with the viewer-selection rule stated, and *buyer or agent owner* recorded on routes 18, 19, 24 against *buyer only* on 21, 22 (FR-008)
- [X] T026 [US1] Add `paths` for demo and health to `docs/openapi.yaml` (routes 25–27), with 200 on both demo routes, a note that they are unauthenticated by recorded decision, and the 503 response on `GET /health`
- [X] T027 [US1] Apply `security` per operation in `docs/openapi.yaml`: `bearerAuth` on every jwt route, `security: []` on the public ones, and an explicit description on `GET /agents` covering the optional-auth case (FR-007)

### Verification

- [X] T028 [US1] Lint the contract — `npx @redocly/cli lint docs/openapi.yaml` — and fix until zero errors (SC-001)
- [X] T029 [US1] Diff the contract's path/method set against the boot log both ways and confirm zero entries appear in one and not the other (SC-002)
- [X] T030 [US1] For every capture in `$SCRATCH/captures/`, diff its field names against the corresponding contract schema **in both directions** and fix every mismatch — a field in the contract that no capture produced is as wrong as a captured field the contract omits (SC-003)

**Checkpoint**: the contract is complete, valid, and matches reality field for field — usable by UI-08 even with nothing else in this feature done

---

## Phase 4: User Story 2 - Every difference from the design is written down and judged (Priority: P2)

**Goal**: `docs/openapi-divergences.md` records every difference against the three design sources, each with a verdict and a resolution.

**Independent Test**: Pick any row at random and confirm its design claim, its code behaviour, and its verdict can each be checked independently against their named sources.

**Depends on**: Phase 3 — the diff runs against the finished contract, not against the source. Diffing the design against the code first lets the design's vocabulary leak into the document, which is how the two collapse into one.

- [X] T031 [US2] Create `docs/openapi-divergences.md` from `specs/012-openapi-contract/contracts/divergence-report.template.md`, pre-filled with the six candidate rows from `plan.md` § *Known divergence candidates*
- [X] T032 [US2] Diff the contract against `../docs/api-design.md` §3.1–§3.5 route by route — path, method, auth, request, response — and add a row for every difference to `docs/openapi-divergences.md`
- [X] T033 [US2] Diff the contract's money fields against `../docs/api-design.md` §3.2.1 (the three-figure table and the `settledFundsMinor` nullability rule) and add any rows found
- [X] T034 [US2] Diff the contract's enumerations and field nullability against `../docs/database-schema.md` §8 (`ledger_kind`, `order_state`, `verdict_tier`, and the nullable columns) and add any rows found
- [X] T035 [US2] Diff `CitationResponse` and `VerdictResponse` against the Zod schema in `../docs/tech-stack.md` §5 and add any rows found — the tier-enum mismatch (`"0"…"100"` vs `none`…`full`) is expected here
- [X] T036 [US2] Assign one of `api-wrong` / `design-stale` / `intentional` to every row in `docs/openapi-divergences.md`, with no row left unverdicted (FR-018)
- [X] T037 [US2] Resolve every `design-stale` row by editing the design document itself — `../docs/api-design.md` and/or `../docs/tech-stack.md` — and name the edit in the row's resolution column (FR-020)
- [X] T038 [US2] Record the reason for every `intentional` row, and complete the *Documented from source, not captured* section for the two 502 chain responses (FR-021)
- [X] T039 [US2] If the diff found nothing at all, still write `docs/openapi-divergences.md` stating the comparison was performed and found nothing — a missing file and a clean diff must not look the same (FR-019, SC-007)

**Checkpoint**: every difference is recorded and verdicted; UI-08 can tell which parts of the contract are safe to adopt

---

## Phase 5: User Story 3 - Behaviour the report calls a defect is fixed, not documented (Priority: P3)

**Goal**: Rows verdicted `api-wrong` are corrected in the API and re-documented; anything uncorrectable is marked so nobody builds on it.

**Independent Test**: For each `api-wrong` row, either exercise the corrected behaviour against the running API, or find a `DO NOT ADOPT` marker in **both** the contract and the report.

**Depends on**: Phase 4 — there is nothing to fix until the report says what is broken.

- [X] T040 [US3] Decide the verdict on the bare `{ "error": "CODE" }` shape from `src/guardian/verdict.controller.ts` by checking how the frontend actually consumes those three cases; record the decision and its reasoning in `docs/openapi-divergences.md`
- [X] T041 [US3] If that row is `api-wrong`, make the fix **additive** in `src/guardian/verdict.controller.ts` — add `statusCode` and `message` alongside the existing `error` key, never remove `error` — so nothing already reading the code breaks
- [X] T042 [US3] Apply the code fix for every other `api-wrong` row, confining changes to what the row requires; changing behaviour outside these rows is out of scope (FR-025)
- [X] T043 [US3] Re-run the relevant captures in `scripts/verify-012.mjs` for each fixed row and update `docs/openapi.yaml` to describe the corrected behaviour (FR-022)
- [X] T044 [US3] For any `api-wrong` row that could not be fixed in time, add a `DO NOT ADOPT` marker to **both** the row in `docs/openapi-divergences.md` and the affected operation's description in `docs/openapi.yaml`, and fill the report's *Known wrong, not fixed* section (FR-023)
- [X] T045 [US3] Confirm `GET /orders/<random uuid>` and `GET /orders/<another buyer's order>` both return **404** — not 403, not 500 — since a 500 makes the frontend retry forever (US3 #2, SC-010)

**Checkpoint**: no operation in the contract documents a defect without saying so

---

## Phase 6: User Story 4 - Anyone can open the contract in a browser without signing in (Priority: P4)

**Goal**: `GET /docs` renders the contract to a caller holding no credentials, **inside the container**.

**Independent Test**: `curl -o /dev/null -w '%{http_code}' localhost:3000/docs` with no `Authorization` header returns 200, and the operations render and expand in a browser.

**Depends on**: Phase 1 only. It needs *a* YAML file, not the finished one — see the scheduling note in Implementation Strategy.

- [X] T046 [US4] Create `src/docs/openapi-document.ts` exporting a loader that reads `docs/openapi.yaml` from `process.cwd()`, parses it with `js-yaml`, and returns `null` after logging an error if the file is missing or unparseable — a typo in the contract must never stop the API booting
- [X] T047 [US4] In `src/main.ts`, after `app.enableCors(...)`, call the loader and — when it returns a document — `SwaggerModule.setup('docs', app, document)`; log a warning and skip the mount when it returns `null`
- [X] T048 [US4] Verify anonymously on the host: `curl -s -o /dev/null -w '%{http_code}\n' localhost:3000/docs` and `.../docs-yaml` both return 200 with **no** `Authorization` header (SC-006)
- [X] T049 [US4] ~~If either returns 401, the global guard is reaching the Swagger routes — add a `DocsController` marked `@Public()` serving the YAML, mount the UI on a non-colliding path, and re-verify.~~ **Not needed — T048 returned 200 anonymously.** `SwaggerModule.setup` registers on the HTTP adapter, outside the Nest router, so the global guard never sees `/docs`
- [X] T050 [US4] Verify **inside the container**: `docker compose up -d --build api`, then `docker compose exec api ls -l /app/docs/openapi.yaml` and an anonymous curl to `/docs`. This is the check that catches the `.dockerignore` / bind-mount problem; passing only on the host proves nothing about where the demo runs
- [X] T051 [US4] Open `http://localhost:3000/docs` in a browser, confirm all routes are listed and expandable, then edit one description in `docs/openapi.yaml`, restart the container, and confirm the change appears without a rebuild (FR-015)

**Checkpoint**: a judge with only the URL can browse the whole contract

---

## Phase 7: Polish & Cross-Cutting Concerns

- [X] T052 [P] Add a short section to `api/README.md` pointing at `docs/openapi.yaml`, `docs/openapi-divergences.md`, and `GET /docs`, so the next reader finds them without being told
- [X] T053 Run `git diff --stat` and confirm no DTO or serialiser under `src/` was modified except where a `api-wrong` row required it (SC-011)
- [X] T054 Walk the *Done when* table in `quickstart.md` end to end and confirm SC-001 … SC-011 each pass
- [X] T055 Re-run one demo act after all changes to confirm nothing in this feature disturbed the rehearsal path — the API's behaviour should be unchanged except for the `api-wrong` fixes

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: no dependencies
- **Foundational (Phase 2)**: needs Setup — **blocks Phase 3, 4 and 5**
- **US1 (Phase 3)**: needs Phase 2
- **US2 (Phase 4)**: needs US1 — the diff runs against the finished contract
- **US3 (Phase 5)**: needs US2 — nothing to fix until the report names it
- **US4 (Phase 6)**: needs **Setup only**. Despite being P4 it is the least dependent phase in the feature
- **Polish (Phase 7)**: needs everything

### User Story Dependencies

Unlike most features, these stories form a **chain**: US1 → US2 → US3. That is inherent — a divergence report presupposes a contract, and a fix presupposes a report. US4 is the only genuinely independent story.

### Parallel Opportunities

- T002, T003, T004 in Setup — three different files
- T012 and T013 in US1 — independent assertions, though both land in `scripts/verify-012.mjs`, so sequence them if one person is editing
- T052 in Polish
- **Phase 3 has almost no parallelism**: T014–T027 all edit `docs/openapi.yaml`. Two people editing one YAML produces conflicts faster than it produces contract.
- With two people: one runs US4 (Phase 6) while the other runs US1 (Phase 3), after Setup

---

## Implementation Strategy

### Pull US4 forward — the scheduling note

Phases are listed in spec priority order, but **run Phase 6 (US4) immediately after Phase 1**, using the placeholder YAML from T004. Two reasons:

1. The `.dockerignore` / bind-mount problem (T050) is invisible on a host and fatal in the container. Finding it on day one costs a config line; finding it during the last verification pass costs a rebuild cycle when there is no time left.
2. Whether the global guard reaches the Swagger routes (T049) changes the serving design. Learn it against an empty document, not a finished one.

### MVP

Setup → Foundational → US1. At that point `docs/openapi.yaml` is complete and accurate, and UI-08 can start against it. Everything after is the honesty check — valuable, and the reason the feature exists, but the frontend is unblocked at the US1 checkpoint.

### Incremental delivery

1. Setup + US4 → `/docs` renders (an empty contract, but reachable everywhere it needs to be)
2. Foundational → captures exist; the truth about the API is on disk
3. US1 → the contract is complete and accurate → **hand off to UI-08**
4. US2 → the report tells UI-08 which parts to trust
5. US3 → the defects the report found are fixed rather than blessed

### The failure mode to avoid

Authoring the YAML from `data-model.md` and the design docs instead of from `$SCRATCH/captures/`. It is faster, it produces a document that lints clean, and it makes the divergence report find nothing by construction — certifying a match that was never checked. If Phase 2 has not run, Phase 3 cannot start.

---

## Notes

- `[P]` = different files, no dependencies
- `data-model.md` is a **starting point read off the source**, not evidence. Where a capture disagrees with it, the capture wins and `data-model.md` is wrong
- Commit after each phase checkpoint
- The one behaviour change permitted in this feature is an `api-wrong` fix, and each one is traceable to a numbered row in `docs/openapi-divergences.md`
