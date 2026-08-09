# API-06 — Catalogue & the serialisation boundary

**Component:** `api/` · **Depends on:** API-02, API-03, API-04 · **Size:** Medium

> **Feed this file to `/speckit-specify`.** Read [`../CONTEXT.md`](../CONTEXT.md)
> first — it carries the nine backend invariants this spec assumes.

## Goal

Sellers list agents; buyers browse them — and the redaction rule that every later
spec depends on gets built once, here.

## In scope

- `POST /agents` — creates agent + version 1, canonicalises and hashes the
  definition, calls `registerAgent` and **awaits the receipt**, returning with
  `onchain_agent_id` set
- `POST /agents/:id/versions` — new immutable version, calls `updateAgent`
- `PATCH /agents/:id/active`
- `GET /agents`, `GET /agents/:id` — **public listing fields only**, active agents only
- `GET /agents?owner=me` — the owner's own agents, **including inactive ones**
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
- **`POST /agents` cannot return early.** `registerAgent` *returns* the `agentId` —
  the contract assigns it — and `openDeal` needs it, so an early return lists an
  agent nobody can buy. `onchain_agent_id IS NULL` is a crash state
  (database-schema §1.4), not an async contract, which means **`GET /agents` must
  filter it out**: one failed registration would otherwise park an unbuyable agent
  in the marketplace that fails at purchase time, on the buyer's screen. Keep it
  visible on `?owner=me`, marked not-yet-listed — the seller can act on it.
- **`?owner=me` must include inactive agents.** The public list is active-only, and
  reusing that filter for the owner's list makes the availability toggle **one-way**:
  deactivating an agent removes it from its own owner's list and nothing can switch
  it back on. UI-07's toggle depends on this.
- **`capabilities` and `exclusions` are contract terms**, not marketing copy — they
  are half of what Guardian judges against and get quoted verbatim in verdicts.
- The serialiser built here is extended in API-09 to cover execution steps. Build it
  as the single choke point now.

## Source

`../../../docs/agent-definition.md` §2 · `../../../docs/api-design.md` §1.3, §3.3.

**Build against [`../../../docs/openapi.yaml`](../../../docs/openapi.yaml)** (API-12) — it is the contract the frontend reconciles against, and a divergence here is a defect there.
