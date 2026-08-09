# Phase 1 — Data Model: Catalogue & the serialisation boundary

**Feature**: `006-agent-catalogue` · **Date**: 2026-08-09 · **Spec**: [spec.md](./spec.md) · **Research**: [research.md](./research.md)

**No migration.** Every table, column, constraint and index comes from
`1786238842921-InitialSchema` ([R14](./research.md)). This feature is the first thing that
writes `agents` or `agent_versions`.

---

## 1. What already exists

### 1.1 `agents` — one row per listed agent

| Column | Type | Written by this feature |
| --- | --- | --- |
| `id` | `uuid` PK | `POST /agents` |
| `owner_account_id` | `uuid` → `accounts` | `POST /agents`, from the session — never the body |
| `onchain_agent_id` | `bigint` NULL UNIQUE | `POST /agents`, after the receipt |
| `active` | `bool` NOT NULL DEFAULT `true` | `PATCH /agents/:id/active` |
| `created_at` | `timestamptz` | default |

Holds nothing a buyer sees. Everything presented lives on a version, which is what makes
"nothing shown can change without producing a new version" true structurally rather than
by policy.

**`onchain_agent_id` NULL has exactly one meaning after this feature: *the outcome of
registration is unknown*.** Not "pending", not "queued", not "will be retried" — see
[R8](./research.md). Every other registration failure rolls the row back, so a NULL id is
a residue of a receipt timeout and nothing else.

⚠️ **The entity doc-comment is out of date and must be rewritten.**
`src/entities/agent.entity.ts` currently describes NULL as *"submitted, not yet confirmed
— an honest state, not an error"* and advertises `WHERE onchain_agent_id IS NULL` as a
trivial retry query. Both sentences describe the async contract the brief was revised away
from, and the retry it suggests is the one thing [R8](./research.md) forbids: a second
`registerAgent` mints a *second* on-chain agent rather than retrying the first.

### 1.2 `agent_versions` — one immutable row per definition

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` PK | |
| `agent_id` | `uuid` → `agents` | |
| `version` | `int` | `UNIQUE (agent_id, version)`; from 1, consecutive |
| `name` | `text` | listing |
| `description` | `text` | listing |
| `capabilities` | `text[]` | listing — **contract terms, stored verbatim** (FR-041) |
| `exclusions` | `text[]` | listing — same |
| `price_minor` | `bigint` | USD cents; `CHECK (price_minor > 0)` |
| `input_schema` | `jsonb` | listing **and** execution |
| `output_schema` | `jsonb` | listing **and** execution |
| `system_prompt` | `text` | ⚠️ **seller IP — never serialised to a buyer** |
| `model` | `text` | execution only |
| `timeout_seconds` | `int` DEFAULT 120 | execution only |
| `definition_hash` | `bytea` | keccak256 of the canonical definition |
| `created_at` | `timestamptz` | |

**Rows are written once and never updated or deleted** (FR-032). Nothing in this feature
issues an `UPDATE` or `DELETE` against this table; the only mutation anywhere in the
feature is `agents.onchain_agent_id` and `agents.active`.

**`input_schema` and `output_schema` sit on both sides of the boundary.** They are the
only definition fields a buyer sees that the execution engine also consumes — a buyer
needs them to know what to supply and what to expect. That is deliberate and is why the
listing/execution split below is a field list rather than "everything except three
columns".

---

## 2. The three faces of a version

One table, three projections. Which columns are even *read* differs per route
([R9](./research.md) layer 1).

| Field | Public summary `GET /agents` | Public detail `GET /agents/:id` | Owner list `?owner=me` | Owner versions `/versions` |
| --- | :-: | :-: | :-: | :-: |
| `id` (agent) | ✅ | ✅ | ✅ | — |
| `name` | ✅ | ✅ | ✅ | ✅ |
| `description` | ✅ | ✅ | ✅ | ✅ |
| `priceMinor` | ✅ | ✅ | ✅ | ✅ |
| `capabilities` | — | ✅ | — | ✅ |
| `exclusions` | — | ✅ | — | ✅ |
| `inputSchema` | — | ✅ | — | ✅ |
| `outputSchema` | — | ✅ | — | ✅ |
| `version` | — | ✅ | — | ✅ |
| `active` | — | — | ✅ | — |
| `listed` | — | — | ✅ | — |
| **`systemPrompt`** | — | — | — | ✅ |
| **`model`** | — | — | — | ✅ |
| **`timeoutSeconds`** | — | — | — | ✅ |
| `definitionHash` | — | — | — | ✅ |
| `createdAt` | — | — | — | ✅ |

The last five rows are the boundary. **Exactly one column of this table is reachable only
through the rightmost route**, and that route is owner-scoped, on a path no buyer-facing
view shares.

`active` and `listed` appear only in the owner's list because they are the two facts a
seller can act on and a buyer cannot: the public catalogue contains only agents for which
both are true, so publishing them there would be a column of `true`.

---

## 3. The canonical definition

The exact payload hashed into `definition_hash` and committed on-chain
([R2](./research.md), [R3](./research.md)):

```json
{
  "capabilities":   ["…"],
  "description":    "…",
  "exclusions":     ["…"],
  "inputSchema":    { … },
  "model":          "…",
  "name":           "…",
  "outputSchema":   { … },
  "priceMinor":     200,
  "systemPrompt":   "…",
  "timeoutSeconds": 120
}
```

Ten fields, shown in the order they canonicalise into — object keys sorted by UTF-16 code
unit, recursively, then `JSON.stringify` with no spacing, then UTF-8, then `keccak256`.

**What is excluded, and why it matters**: `id`, `agentId`, `version`, `ownerAccountId`,
`createdAt`, `definitionHash` itself. The hash commits to what was sold and what runs, not
to which UUID a row happened to get — otherwise a reseeded database produces a different
commitment for an identical definition, and the reproducibility the hash exists for is
gone.

`version`'s exclusion is a **correction to the spec**, argued in [R3](./research.md); FR-016
has been amended. Two versions with identical definitions therefore share a fingerprint,
which is correct because nothing resolves a version *from* a hash — an order pins
`agent_version_id` (invariant #6) and Guardian recomputes the pinned version's hash.

**The wire names are the canonical names.** `priceMinor`, not `price_minor`. The
definition is a product artifact that a third party re-hashes from the API contract, not
from our column naming.

---

## 4. Derived values

Nothing below is stored.

| Value | Derived from | Rule |
| --- | --- | --- |
| An agent's current listing | `agent_versions` | `DISTINCT ON (agent_id) … ORDER BY agent_id, version DESC` ([R10](./research.md)). No `current_version` column exists, by design |
| `listed` | `agents.onchain_agent_id` | `!== null`. The only field in the feature computed from a nullable id ([R12](./research.md)) |
| Next version number | `agent_versions` | `MAX(version) + 1` for the agent, computed **inside** the `FOR UPDATE` lock ([R8](./research.md)). `UNIQUE (agent_id, version)` is the backstop, not the mechanism |
| Public visibility | `agents` | `active = true AND onchain_agent_id IS NOT NULL` — one clause, never applied by halves (FR-021) |
| `definitionHash` | the ten fields above | Recomputed, never copied from a previous version |

---

## 5. State

`agents.active` is the only state in the feature, and it is a boolean with no transition
rules: any value may be set from any value, by the owner, at any time. `PATCH` with the
value already held is a success with no side effect (US3 #9) — the idempotence
`ui/specs/007-seller-pages` R9 relies on, and the reason that call is exempt from the UI's
non-idempotency doctrine.

**It never affects a running order.** `setAgentActive` gates `openDeal` only; deals
already open carry their own pinned `defHash` and `defVersion` (`smart-contract.md` §4.2).
Nothing in this feature reads or writes `orders`.

---

## 6. Relationships this feature must not break

- **`orders.agent_version_id`, never `agent_id`** (invariant #6). No code here touches
  `orders`, and version immutability is what makes the pin meaningful: a row an order
  points at can never be rewritten under it (FR-035).
- **`agents.owner_account_id` → `accounts.id`** is the authorisation edge for every
  owner-scoped route here, and — per `api-design.md` §3.4 — the one API-07 and API-09 walk
  as `orders → agent_version → agent.owner_account_id` to authorise a seller. Nothing in
  this feature should make that traversal harder.
