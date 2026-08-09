# API-12 — The OpenAPI contract & Swagger UI

**Component:** `api/` · **Depends on:** API-01 · **Size:** Small

> ⚠️ **Numbered last, built next.** Everything else here is dependency-ordered;
> this one is not. Its whole value is being written **before** API-06…11, because a
> contract that describes what was already built prevents nothing.

> **Feed this file to `/speckit-specify`.** Read [`../CONTEXT.md`](../CONTEXT.md)
> first.

## Goal

One document that both components build against, and a URL where anyone can read it.

## In scope

- **`docs/openapi.yaml`** — the full HTTP contract, hand-written from
  `docs/api-design.md` §3. Every endpoint, its auth, its request and response
  schemas, and its error shapes.
- **Serve it at `GET /docs`** via `SwaggerModule.setup()`, loading the YAML from
  disk. `@nestjs/swagger` for the UI only.
- The four enums the UI switches on, spelled out as schema `enum`s: `OrderState`
  (8 members), `LedgerKind` (4), citation `source` (3), and the refund tiers.
- The **money-field names**, verbatim: `availableBalanceMinor`, `inEscrowMinor`,
  `settledFundsMinor` (nullable), `priceMinor`, `amountMinor`, `refundMinor`.
- A stated **casing convention** — `camelCase` on the wire — recorded once so it
  stops being an assumption.

## Out of scope

**Automated tests of any kind** (MVP decision — see `../CONTEXT.md`). Plus:

Request/response validation middleware, client SDK generation, versioning, and any
change to an existing endpoint's behaviour. **This spec writes a document and serves
it. It does not alter the API.**

## Acceptance

- `docs/openapi.yaml` parses as valid OpenAPI 3.1
- Every endpoint in `api-design.md` §3.1–3.5 appears, with the same path, method,
  and auth rule
- `GET /docs` renders the document, and it is reachable in the browser
- The three money figures and all four enums match `api-design.md` and
  `database-schema.md` exactly, member for member

## Watch out for

- **Write it from `api-design.md`, never from the code.** A document generated from
  decorators describes what exists; this one has to constrain what does not exist
  yet. That is the entire point, and it is lost the moment someone regenerates it.
- **Do not decorate DTOs to produce it.** `@ApiProperty()` across eleven specs is
  real work that buys a *descriptive* document — the opposite of what is wanted.
  Load the YAML and hand it to `SwaggerModule.setup()`; it is about fifteen lines in
  `main.ts`.
- **`GET /docs` must be `@Public()`.** API-04's guard is global and fail-closed, so
  without it the contract is behind a login and a judge sees a 401.
- **This is transcription, not design.** Every decision is already made and pinned —
  §3.2.1 for the money figures, §3.4 for seller-authorised reads, `tech-stack.md` §5
  for the citation schema, `database-schema.md` §8 for the enums. If a question feels
  open while writing it, the answer exists in one of those; find it rather than
  deciding it here. A contract that quietly invents a field is worse than none.
- **Nullable is not optional.** `settledFundsMinor` is always present and may be
  `null` — it means *unknown*, never zero (§3.2.1). Marking it optional invites
  `?? 0`, which tells a seller who was paid that they earned nothing.
- **Seller-authorised reads.** `GET /orders/:id`, `/case-file`, and `/verdict` are
  buyer *or* agent owner. Spell that out per endpoint; it is the rule most likely to
  be implemented narrowly and silently.

## Stretch — only if it costs minutes

A boot-time check that every route Nest registered appears in the YAML, and every
path in the YAML is registered. It turns contract drift into a startup error instead
of something UI-08 finds later. Skip it the moment it stops being cheap.

## Source

`../../../docs/api-design.md` §3 (**the source of truth**) ·
`../../../docs/database-schema.md` §8 (enums) · `../../../docs/tech-stack.md` §5
(verdict schema) · `../../../ui/src/api/types.ts` (what the UI already assumes).
