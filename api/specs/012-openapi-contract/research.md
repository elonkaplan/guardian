# Phase 0 Research: The published API contract & its divergence report

Six decisions. Each was resolved against the running code, not against a document.

---

## Decision 1 — How the contract is produced: hand-written from captured responses

**Decision**: Hand-write `docs/openapi.yaml`. Populate every schema from a JSON body
recorded off the running API by `scripts/verify-012.mjs`. Add **zero** decorators to
existing code.

**Rationale**: FR-026 forbids the annotation sweep, and the reason holds up on inspection:
the 22 response interfaces live across 10 modules whose serialisation boundaries are
load-bearing (`src/orders/order-serialiser.ts` carries a three-part argument for why
`OrderResponse` is an *exact* interface with no index signature — adding decorators means
converting those interfaces to classes and dismantling the third of those three
protections). The demo runs on this code four days from now.

Capturing also catches the one class of error a generator cannot: where the declared type
and the wire disagree. `OrderRunResponse.output` is typed `unknown | null`, which collapses
to `unknown` in TypeScript — the wire is the only place to learn what it really carries.

**Alternatives considered**:
- *`@nestjs/swagger` introspection with `@ApiProperty()` on every DTO* — rejected: highest
  regression risk of any option, on verified code, for a documentation benefit.
- *Generate from the Zod request schemas via `zod-to-json-schema`* — covers requests only.
  Ten of the twenty-seven routes take no body at all, and no response shape is a Zod schema.
- *Infer from TypeScript interfaces with `ts-json-schema-generator`* — this is exactly
  "transcribe from types", which FR-005 and FR-006 forbid.

---

## Decision 2 — How `GET /docs` is served, and how the YAML reaches the container

**Decision**: `SwaggerModule.setup('docs', app, document)` in `main.ts`, where `document` is
`js-yaml.load()` of `docs/openapi.yaml` read from `process.cwd()`. Loading is wrapped: on a
missing or unparseable file, log an error and skip the mount rather than failing boot.

Reachability inside Docker is fixed in two places:
- `.dockerignore` — add `!docs/openapi.yaml` after the existing `docs/` and `*.md` rules, so
  the file is copied into the image.
- `docker-compose.yml` — add `./docs/openapi.yaml:/app/docs/openapi.yaml:ro` to the `api`
  service's `volumes`, so editing the contract does not require a rebuild.

**Rationale**: This is the single largest silent-failure risk in the feature, and it was
found by reading the build files rather than the source. `.dockerignore` excludes both
`docs/` and `*.md`, and `docker-compose.yml` bind-mounts **only** `./src`. Without both
changes, `GET /docs` works perfectly on a host `npm run start:dev` — which is how it would
be verified — and returns nothing in the container, which is where the demo runs. The two
changes are independent: the negation covers `docker build`, the mount covers the dev loop.

Failing soft on a bad YAML is deliberate: the contract is documentation, and a typo in it
must not be able to take the API down mid-rehearsal.

**On `@Public()`**: the source brief warns that `GET /docs` must carry `@Public()` or the
global fail-closed guard will hide it. `SwaggerModule.setup()` registers its routes directly
on the Express adapter, outside the Nest router, so `APP_GUARD` should not see them — the
`@Public()` decorator has nowhere to attach. **This is verified empirically, not assumed**:
stage 4 curls `/docs` and `/docs-yaml` with no `Authorization` header. If either is
challenged, the fallback is a `DocsController` marked `@Public()` serving the YAML directly,
with the Swagger UI mounted under a path that does not collide with it.

**Alternatives considered**:
- *Move the YAML under `src/` so the existing bind-mount and `COPY` cover it* — rejected:
  `docs/openapi.yaml` is the path UI-08 reads and the path the brief names. Also `nest build`
  sets `deleteOutDir` and copies no non-TS assets, so `dist/` would need an assets rule too.
- *Embed the contract as a TypeScript string constant* — reachable everywhere, but the file
  stops being independently readable and diffable, which is most of its value.
- *Serve Swagger UI from a CDN* — network dependency at demo time.

---

## Decision 3 — What counts as a route

**Decision**: All **27** routes the app registers, enumerated in
[contracts/route-inventory.md](./contracts/route-inventory.md), including `GET /health`,
`POST /demo/seed`, `POST /demo/reset`, and the two Rain stub routes. The Swagger-owned paths
(`/docs`, `/docs-json`, `/docs-yaml`) are **excluded** from the contract itself.

**Rationale**: FR-003 makes completeness a property of the router, not of any design
document — and the routes most likely to be forgotten are exactly the ones no design
document lists. `GET /auth/session` and `GET /health` appear nowhere in `api-design.md` §3,
which is itself two rows of the divergence report.

Excluding the documentation routes from the document is the conventional reading and avoids
a self-reference no consumer benefits from; it is recorded here so it does not read as an
omission.

**Counted**: auth 3 · accounts 2 · funding 3 · rain 2 · catalog 6 · orders 6 · sales 1 ·
verdict 1 · demo 2 · health 1 = **27**. Re-derived from the running router in stage 1, not
trusted from this count.

---

## Decision 4 — How the shapes are captured

**Decision**: `scripts/verify-012.mjs`, importing `api()`, `signIn()`, `psql()`, `ok()`,
`note()` and `summary()` from the existing `scripts/verify-011-lib.mjs`. It signs in as two
distinct accounts — a buyer and the demo seller — drives one order to a verdict, hits all 27
routes plus the failure paths, writes each body to the scratchpad as JSON, and reports which
captures are missing.

**Rationale**: The harness already exists, already handles the SIWE-style nonce/sign/verify
dance, and is the pattern every previous feature verified with. Two accounts are required
because six routes have a buyer shape and a seller shape, and one of them
(`/case-file`) returns *structurally different objects* per viewer — capturing only the
buyer's leaves `SellerCaseFileResponse` undocumented.

Driving a real order to `adjudicated` is unavoidable: `GET /orders/:id/verdict` cannot be
captured any other way, and three of the four order states with timestamps only appear after
settlement. `POST /demo/seed` gives the three fixtures that make this cheap, and Act 3 (the
crash) is the fastest path to a verdict.

**Failure paths that must be captured, not imagined** — the spec makes the error shapes part
of the contract (FR-012), and there are at least five distinct ones:
a 404 for a missing order, a 403/404 for someone else's order, a 400 from
`ZodValidationPipe`, a 400 from `ParseUUIDPipe`, a 401 with no token, a 402 for insufficient
funds, and a 409 for a wrong-state action. See
[contracts/error-shapes.md](./contracts/error-shapes.md).

**Alternatives considered**:
- *A Postman/Bruno collection* — a second tool to install and no reuse of the existing
  sign-in helper.
- *Reading the serialisers and writing the YAML from them* — the serialisers are closer to
  reality than the DTOs, but `settledFundsMinor` is set by a chain read that can fail, and
  only a live capture shows the `null`.

---

## Decision 5 — How nullability and the enumerations are expressed

**Decision**: In OpenAPI 3.1 (JSON Schema 2020-12), a field that is always present and may
carry "unknown" is written as `type: [number, "null"]` **and listed in `required`**.
`type: X` with the property omitted from `required` is reserved for genuinely optional
fields, of which the contract has very few.

The four enumerations become named `components/schemas` entries — `OrderState` (8),
`LedgerKind` (4), `CitationSource` (3), `VerdictTier` (5) — referenced by `$ref` everywhere
they appear, so a value can never be enumerated inconsistently in two places.

**Rationale**: This is the precise distinction FR-011 exists to protect. `settledFundsMinor`
is `number | null` where `null` means *the chain read failed or timed out*, per
`api-design.md` §3.2.1 — a generated client that sees an optional field writes `?? 0`, and a
dash-on-the-page becomes a zero-balance on a screen showing money. OpenAPI 3.1's union type
is the only form that says "always sent, may be null"; the 3.0 `nullable: true` keyword does
not exist in 3.1 and would be silently ignored.

**Fields this applies to**: `settledFundsMinor`; every `*At` timestamp on
`OrderResponse` (`deliveredAt`, `disputedAt`, `settledAt`); `OrderResponse.run`;
`OrderRunResponse.output`; `CaseFileStepResponse.summary`/`durationMs`/`error`;
`VerdictResponse.txHash`; `LedgerEntryResponse.orderId`/`externalRef`.

Note `VerdictTier` has **five** members (`none`, `quarter`, `half`, `three_quarter`,
`full`), not the four the source brief's "refund tiers" phrasing suggests.

---

## Decision 6 — How the divergence diff is run and what "resolved" means

**Decision**: Compare the finished YAML, section by section, against exactly three sources —
`../docs/api-design.md` §3 (all of §3.1–§3.5, plus the §3.2.1 money table and the §3.4
authorisation paragraph), `../docs/database-schema.md` §8 (the three `CREATE TYPE` enums and
the column-level nullability), and `../docs/tech-stack.md` §5 (the verdict/citation Zod
schema). Write **every** difference to `docs/openapi-divergences.md` using the template in
[contracts/divergence-report.template.md](./contracts/divergence-report.template.md).

A row is **resolved** when one of these has happened, and the row records which:
- `api-wrong` → the code is fixed and the YAML describes the fix; or, if it could not be
  fixed in time, both the YAML **and** the row carry a `DO NOT ADOPT` marker (FR-023).
- `design-stale` → the design document is edited so the two agree, and the row names the
  edit.
- `intentional` → the row records the reason.

**Rationale**: The report is the only mechanism separating "the contract describes the code"
from "the contract blesses a bug", and the project has one recorded instance of exactly that
failure. Fixing the design document rather than merely noting it is what stops the same row
being rediscovered by the next reader.

Writing the report *after* the YAML is deliberate: diffing the design against the code first
would let the design's vocabulary leak into the document, which is how the two collapse into
one.

**An empty report is still written** (FR-019). A missing file and a clean diff must not look
the same.

**Alternatives considered**:
- *An automated design-vs-contract diff* — the design is prose and tables; there is nothing
  to diff mechanically, and a tool that reported "no differences" would be worse than
  nothing.
- *Skipping the report where the API is obviously right* — defeats the purpose. The
  `quote`/`clause` incident looked obvious in the wrong direction.
