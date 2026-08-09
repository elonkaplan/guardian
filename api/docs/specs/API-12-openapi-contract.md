# API-12 — The OpenAPI contract & Swagger UI

**Component:** `api/` · **Depends on:** API-01…11 (**all of them — the API must be
complete**) · **Size:** Small

> **Runs last on this side, and immediately before UI-08.** The frontend's
> reconciliation pass consumes `docs/openapi.yaml`, so this is the handoff between
> the two components.

> **Feed this file to `/speckit-specify`.** Read [`../CONTEXT.md`](../CONTEXT.md)
> first.

## Goal

Write down what the API **actually does**, so the frontend can be corrected against
something true rather than something assumed — and report anywhere that differs from
what it was supposed to do.

## The source of truth, and its one limit

**The implementation is the source of truth for this document.** Read the
controllers, the DTOs, the Zod schemas and the serialisers, and describe what they
really send. Not what `api-design.md` says, not what a spec promised — what the code
returns.

**But the implementation is not the source of truth for whether it is *correct*.**
Those are different questions, and collapsing them is the one way this spec can do
damage: a field the API named wrongly becomes a contract, and UI-08 then "reconciles"
the frontend into matching a bug. That has already happened once on this project —
`67dcf4d`, where the UI read `clause` and the API sends `quote`. Generated from the
API at that moment, the contract would have blessed the wrong name and the fix would
have gone the wrong way.

So the document describes the code, and **§ Divergence report** below is where the
code gets checked against the design.

## In scope

- **`docs/openapi.yaml`** — OpenAPI 3.1, describing every endpoint the API actually
  serves: paths, methods, auth, request and response schemas, status codes, error
  shapes.
- **Serve it at `GET /docs`** via `SwaggerModule.setup()`, loading the YAML from
  disk.
- **A divergence report** (below) — the part that keeps this honest.
- Schemas for everything the UI switches on: `OrderState` (8 members), `LedgerKind`
  (4), citation `source` (3), refund tiers, and the money fields with their exact
  names and nullability.

## The divergence report

Before finishing, diff the document against `../../../docs/api-design.md` §3 and
record **every** difference in `docs/openapi-divergences.md`:

| Column | |
| --- | --- |
| Endpoint / field | where it differs |
| Design says | from api-design.md, tech-stack.md §5, database-schema.md §8 |
| Code does | what you documented |
| Verdict | **`api-wrong`** · **`design-stale`** · **`intentional`** |

- **`api-wrong`** — the implementation deviated without a reason. **Fix the API**, or
  if that is out of time, mark it clearly so UI-08 does not adopt it.
- **`design-stale`** — the design was superseded by a decision made during
  implementation. Update `api-design.md` so the two agree.
- **`intentional`** — a deliberate departure with a recorded reason.

**An empty report is a valid result and must still be written**, stating that the
diff was performed and found nothing. UI-08 reads this file to know which parts of
the contract it may trust blindly and which it must not.

## Out of scope

**Automated tests of any kind** (MVP decision — see `../CONTEXT.md`). Plus:

Request/response validation middleware, client SDK generation, versioning. **Changing
API behaviour is out of scope except where the divergence report says `api-wrong`** —
those fixes are in scope, because shipping a contract that documents a known bug is
worse than not shipping one.

## Acceptance

- `docs/openapi.yaml` parses as valid OpenAPI 3.1
- Every route the app registers appears in it, and every path in it is registered —
  **compare against the actual router**, not against a spec
- Response schemas match real captured responses, field name for field name
- `GET /docs` renders in a browser
- `docs/openapi-divergences.md` exists, even if it says "none"

## Watch out for

- **Capture real responses; do not transcribe from types.** A DTO describes intent,
  a serialiser describes reality, and where they differ the serialiser wins. Hit each
  endpoint and read what comes back.
- **`GET /docs` must be `@Public()`.** API-04's guard is global and fail-closed, so
  without it the contract sits behind a login and a judge sees a 401.
- **Do not add `@ApiProperty()` across every DTO to generate this.** Decorating
  eleven specs' worth of DTOs at this point is real work with real regression risk in
  code that is already verified. Hand-write the YAML from observed responses and
  serve it statically; the endpoint count is about twenty-five.
- **Nullable is not optional.** `settledFundsMinor` is always present and may be
  `null` — *unknown*, never zero (api-design §3.2.1). Marking it optional in the
  schema invites `?? 0` in a generated client.
- **Document the seller-authorised reads per endpoint.** `GET /orders/:id`,
  `/case-file` and `/verdict` are buyer *or* agent owner. If the code only checks the
  buyer, that is an `api-wrong` row, not a documented behaviour.
- **Errors are part of the contract.** UI-04 and UI-05 treat 404/403 as fatal and
  everything else as retryable. If the API returns 500 for a missing order, the
  frontend retries forever — and that is the API's bug to fix, not the UI's to absorb.

## Source

The **running implementation**, first. Then
`../../../docs/api-design.md` §3 · `../../../docs/database-schema.md` §8 ·
`../../../docs/tech-stack.md` §5 — for the divergence report only.
