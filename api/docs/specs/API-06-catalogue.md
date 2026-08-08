# API-06 — Catalogue & the serialisation boundary

**Component:** `api/` · **Depends on:** API-02, API-03, API-04 · **Size:** Medium

> **Feed this file to `/speckit-specify`.** Read [`../CONTEXT.md`](../CONTEXT.md)
> first — it carries the nine backend invariants this spec assumes.

## Goal

Sellers list agents; buyers browse them — and the redaction rule that every later
spec depends on gets built once, here.

## In scope

- `POST /agents` — creates agent + version 1, canonicalises and hashes the
  definition, calls `registerAgent`
- `POST /agents/:id/versions` — new immutable version, calls `updateAgent`
- `PATCH /agents/:id/active`
- `GET /agents`, `GET /agents/:id` — **public listing fields only**
- `GET /agents/:id/versions` — owner-only, execution spec included
- Validation that `input_schema` and `output_schema` are valid JSON Schema
- **The serialiser**: one function that structurally cannot emit `system_prompt`

## Out of scope

**Automated tests of any kind** (MVP decision — see `../CONTEXT.md`). Plus:

Orders, execution, search, pagination, ratings.

## Acceptance

- A listed agent appears on-chain with a `defHash` reproducible from the stored
  definition
- No public response contains a system prompt, under any input
- A new version leaves running orders untouched

## Watch out for

- **Canonical hashing needs deterministic serialisation** — stable key order. Without
  it the hash won't reproduce and the on-chain commitment is decorative.
- **Public and owner views are separate routes**, not one route with a branch. No
  conditional to get wrong.
- **`capabilities` and `exclusions` are contract terms**, not marketing copy — they
  are half of what Guardian judges against and get quoted verbatim in verdicts.
- The serialiser built here is extended in API-09 to cover execution steps. Build it
  as the single choke point now.

## Source

`../../../docs/agent-definition.md` §2 · `../../../docs/api-design.md` §1.3, §3.3.
