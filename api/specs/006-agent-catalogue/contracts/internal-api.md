# Phase 1 — Internal Contracts: Catalogue

**Feature**: `006-agent-catalogue` · **Date**: 2026-08-09 · **Plan**: [plan.md](../plan.md)

Six endpoints. Field names here are **literal** — `docs/openapi.yaml` still does not exist
(API-12 is written but unbuilt), so this file is the contract the UI reconciles against,
exactly as `005-accounts-ledger-funding/contracts/internal-api.md` was.

**Casing**: `camelCase` on the wire, everywhere. **Money**: integer USD cents, always
suffixed `Minor`. **Lists**: bare JSON arrays, no envelope ([R11](../research.md)).

---

## 0. Route table

| # | Method | Path | Auth | Returns |
| --- | --- | --- | --- | --- |
| 1 | `GET` | `/agents` | **optional** ([R6](../research.md)) | `AgentSummaryResponse[]` |
| 2 | `GET` | `/agents?owner=me` | required | `OwnedAgentResponse[]` |
| 3 | `GET` | `/agents/:id` | public | `AgentListingResponse` |
| 4 | `POST` | `/agents` | required | `CreateAgentResponse` |
| 5 | `POST` | `/agents/:id/versions` | owner | `CreateVersionResponse` |
| 6 | `PATCH` | `/agents/:id/active` | owner | `SetActiveResponse` |
| 7 | `GET` | `/agents/:id/versions` | owner | `AgentVersionDetailResponse[]` |

Routes 1 and 2 share a path and method and split on the query parameter
([R7](../research.md)). Routes 3 and 7 are separate paths on purpose — that separation
**is** FR-030, and no future refactor may collapse them behind a flag.

---

## 1. `GET /agents` — the public catalogue

`@OptionalAuth()`. No parameters. Returns every agent that is both `active` and registered
on-chain, each as its **latest** version.

```ts
interface AgentSummaryResponse {
  id: string;          // agents.id (uuid) — NOT the version id, NOT the on-chain id
  name: string;
  description: string;
  priceMinor: number;  // integer USD cents
}
```

Four fields, matching `ui/src/api/types.ts`'s `AgentSummary` exactly.

| Case | Response |
| --- | --- |
| No agents / none visible | `200 []` — never `404` |
| Agent inactive | absent |
| Agent with `onchain_agent_id IS NULL` | **absent** (FR-021) — a buyer is never shown an agent that cannot be bought |
| No credential | `200`, served normally |
| Credential present but invalid or expired | `401` ([R6](../research.md)) |

---

## 2. `GET /agents?owner=me` — the seller's own agents

Same path, same method. `owner=me` is the only accepted value; any other value is a `400`
rather than a silent fallback to the public list.

```ts
interface OwnedAgentResponse {
  id: string;
  name: string;
  description: string;
  priceMinor: number;
  active: boolean;   // agents.active
  listed: boolean;   // onchain_agent_id !== null  ([R12](../research.md))
}
```

| Case | Response |
| --- | --- |
| Owns nothing | `200 []` |
| Inactive agents | **included** — this is the whole point (FR-025); filtering here makes the toggle one-way |
| `listed: false` agents | **included**, flagged — the only view in the product where they appear (FR-026) |
| Another account's agents | never present |
| `owner=me` with no credential | **`401`** — never a fallback to the public list (FR-027) |
| `owner=someone-else` | `400` |

⚠️ **`listed` is a new field for UI-07.** `ui/specs/007-seller-pages/data-model.md` §1.3
declares `OwnedAgent extends AgentSummary { active: boolean }`. Sending `listed` is safe —
that document states declaring fewer fields than arrive is safe — but until `OwnedAgent`
and `OwnedAgentList` are edited the seller sees an unregistered agent rendered as a
healthy one. See [R12](../research.md).

---

## 3. `GET /agents/:id` — the public detail view

`@Public()`. `:id` is the **agent** uuid.

```ts
interface AgentListingResponse {
  id: string;
  name: string;
  description: string;
  priceMinor: number;
  capabilities: string[];   // may be empty; never absent
  exclusions: string[];     // may be empty; never absent
  inputSchema: object;
  outputSchema: object;
  version: number;          // ([R13](../research.md))
}
```

**There is no `systemPrompt`, no `model`, and no `timeoutSeconds`, and there is no input
under which there could be.** Those three columns are not selected by the query behind
this route ([R9](../research.md) layer 1).

| Case | Response |
| --- | --- |
| Agent inactive | **`404`** — not `403`. A listing that can be seen is a listing that can be bought |
| `onchain_agent_id IS NULL` | **`404`** (FR-022) |
| Unknown uuid | `404` |
| Malformed uuid | `400` |
| Several versions exist | the **latest** version's listing (FR-023) |

`version` is not declared by `ui/src/api/types.ts`'s `AgentListing`; it is additive and
ignored until API-12 adds it.

---

## 4. `POST /agents` — list an agent

Authenticated. The caller becomes the owner; there is no `ownerAccountId` in the body and
one would be ignored.

```ts
interface CreateAgentRequest {
  name: string;              // non-empty
  description: string;       // non-empty
  capabilities: string[];    // may be empty
  exclusions: string[];      // may be empty
  priceMinor: number;        // amountMinorSchema — positive, whole, safe integer
  inputSchema: object;       // must validate as JSON Schema 2020-12
  outputSchema: object;      // must validate as JSON Schema 2020-12
  systemPrompt: string;      // non-empty
  model: string;             // non-empty; free text, no allowlist
  timeoutSeconds?: number;   // optional, positive int, defaults to 120
}
```

Matches `ui/specs/007-seller-pages` §1.4's `CreateAgentRequest` field for field. That type
omits `timeoutSeconds` and `active`; both omissions are honoured — `timeoutSeconds`
defaults to 120, and `active` is not accepted at all, because `agents.active` defaults to
`true` and a client-supplied value would be a second authority over whether a new listing
is live.

**Synchronous. It does not return until `registerAgent` has confirmed** (FR-012).

```ts
interface CreateAgentResponse {
  id: string;              // agents.id
  version: number;         // always 1
  onchainAgentId: number;  // never null on a 201 — that is the contract
  definitionHash: string;  // '0x…' 32 bytes, so the seller can verify it on-chain
  active: boolean;         // always true
}
```

| Case | Status | Recorded |
| --- | --- | --- |
| Success | `201` | agent + version 1 + on-chain id |
| Missing or empty required field | `400` | nothing |
| `inputSchema` is not a valid schema | `400`, naming `inputSchema` (FR-008) | nothing |
| `outputSchema` is not a valid schema | `400`, naming `outputSchema` | nothing |
| `priceMinor` ≤ 0, fractional, or unsafe | `400` | nothing |
| No credential | `401` | nothing |
| Chain reverted / out of funds / gas | `502` | **nothing** — rolled back ([R8](../research.md)) |
| **Receipt timed out** (`ChainOutcomeUnknownError`) | `502` | **agent + version 1, `onchain_agent_id` NULL**, tx hash and `defHash` logged at `error` |

The last two rows are the same status code and different worlds. Only the timeout leaves a
row, and it leaves one because the transaction may still confirm — deleting it would
orphan a live on-chain agent with no record anywhere.

⚠️ **Never retry a `listed: false` agent by calling `registerAgent` again.** The contract
assigns a *new* id; the seller ends up owning two on-chain agents, one unreachable.

---

## 5. `POST /agents/:id/versions` — publish a new version

Owner only. Same body as `POST /agents`.

```ts
interface CreateVersionResponse {
  id: string;              // the new agent_versions.id
  agentId: string;
  version: number;         // previous + 1
  definitionHash: string;  // '0x…'
}
```

| Case | Status | Recorded |
| --- | --- | --- |
| Success | `201` | version N+1; `updateAgent` carries its hash and price |
| Not the owner | `403` | nothing |
| Unknown agent | `404` | nothing |
| Validation failure | `400`, same rules as §4 | nothing |
| Chain failed, any reason | `502` | **nothing** — the row is inserted inside the transaction and rolled back with it ([R8](../research.md)) |
| Agent has `listed: false` | `409` | nothing — there is no on-chain agent to update |

**Price unchanged still calls `updateAgent`** (FR-034): the hash changed even if the price
did not, and the on-chain commitment is the hash.

**Existing versions are untouched** — no `UPDATE`, no `DELETE`, ever (FR-032). A running
order keeps pointing at the version it opened against (FR-035); nothing in this endpoint
reads or writes `orders`.

An identical resubmission is accepted and produces a new version carrying **the same
`definitionHash`** ([R3](../research.md)). That is not a bug and must not be "fixed" by
refusing it.

---

## 6. `PATCH /agents/:id/active` — availability

Owner only.

```ts
interface SetAgentActiveRequest { active: boolean }   // absolute, never a toggle
interface SetActiveResponse { id: string; active: boolean }
```

| Case | Status | Effect |
| --- | --- | --- |
| Success | `200` | `setAgentActive` on-chain, then commit |
| Already in that state | `200` | Idempotent; no error |
| Not the owner | `403` | nothing |
| Unknown agent | `404` | nothing |
| Body is not `{ active: boolean }` | `400` | nothing |
| Chain failed | `502` | **nothing** — rolled back |
| Agent has `listed: false` | `409` | nothing |

**Idempotent by construction** — an absolute value applied twice leaves the world as
applying it once did. `ui/specs/007-seller-pages` R9 depends on this in writing.

**Running orders are never affected** (FR-038). `setAgentActive` gates `openDeal` only.

---

## 7. `GET /agents/:id/versions` — the owner's full definitions

Owner only. **The one route in the feature that returns the execution spec.**

```ts
interface AgentVersionDetailResponse {
  id: string;
  version: number;
  name: string;
  description: string;
  capabilities: string[];
  exclusions: string[];
  priceMinor: number;
  inputSchema: object;
  outputSchema: object;
  systemPrompt: string;     // ← the only route that may emit this
  model: string;
  timeoutSeconds: number;
  definitionHash: string;   // '0x…' — re-hashable against the chain by hand
  createdAt: string;        // ISO 8601
}
```

Newest version first.

| Case | Response |
| --- | --- |
| Owner | `200` with every version, complete |
| **Not the owner** | **`404`, not `403`** — the refusal must not reveal that the agent exists (FR-029) |
| No credential | `401` |
| Unknown agent | `404` — indistinguishable from the row above, deliberately |
| Agent inactive | `200`, normally — availability does not restrict the owner's own view |

⚠️ `403` on the wrong-owner case would make this endpoint an existence oracle for other
sellers' agent ids. §5 and §6 use `403` because the caller already holds the id from their
own list; this one is a read whose whole purpose is disclosure.

---

## 8. Errors

The shape the existing controllers already produce, unchanged.

| Status | Meaning here |
| --- | --- |
| `400` | Malformed body, invalid schema, bad price, unknown `owner` value, malformed uuid |
| `401` | No credential where one is required; **or** an invalid credential on `GET /agents` |
| `403` | Not the owner, on a write whose id the caller legitimately holds |
| `404` | Not found, inactive, unregistered, or not yours on §7 |
| `409` | Agent is not registered on-chain, so there is nothing to update |
| `502` | The chain call did not complete. **Nothing was recorded**, except §4's timeout row |

`502` is never returned with a body implying success. A caller that receives one may
safely assume the world is unchanged — with the single documented exception of §4's
receipt timeout, which is why that response says the listing did not complete rather than
that it failed.

---

## 9. Internal module surface

```ts
// src/catalog/definition-hash.ts — no Nest, no DI, pure
export function canonicalise(definition: CanonicalDefinition): string;
export function definitionHash(definition: CanonicalDefinition): {
  hex: `0x${string}`;
  bytes: Buffer;
};

// src/catalog/agent-serialiser.ts — the choke point ([R9](../research.md))
export function toAgentSummary(v: ListingFields & { agentId: string }): AgentSummaryResponse;
export function toAgentListing(v: ListingFields & { agentId: string }): AgentListingResponse;
export function toOwnedAgent(v: ListingFields & { agentId: string }, a: AgentStatusFields): OwnedAgentResponse;
// NOTE: no toAgentVersionDetail here. The owner's full view is mapped in
// agent-versions.service.ts, on purpose — this module's parameter types are
// what make the boundary structural, and a mapper that must see systemPrompt
// does not belong behind them.

// src/catalog/schema-validation.ts
export function assertValidJsonSchema(value: unknown, field: 'inputSchema' | 'outputSchema'): void;

// src/auth/optional-auth.decorator.ts — new ([R6](../research.md))
export const OptionalAuth: () => MethodDecorator;
export const OptionalAccount: () => ParameterDecorator;  // Account | undefined
```

`ListingFields` is `Pick<AgentVersion, 'name' | 'description' | 'capabilities' |
'exclusions' | 'priceMinor' | 'inputSchema' | 'outputSchema' | 'version'>` — it has no
`systemPrompt` property, which is the guarantee.

---

## 10. Handoff

**To UI-07** — one edit, worth making: add `listed: boolean` to `OwnedAgent` and a badge to
`OwnedAgentList`. Without it the seller's list renders an unregistered agent as a healthy
one, which is the only silent failure this feature can produce ([R12](../research.md)).

**To API-12** — transcribe this file. Two additions to `ui/src/api/types.ts`'s existing
shapes: `version` on `AgentListing` (§3) and `listed` on `OwnedAgent` (§2). Everything else
matches what the UI already declares.

**To API-07** — `GET /agents/:id` is the buyer's price quote, and `openDeal` pulls
`agents.price` from the chain. The two agree only while `updateAgent` and the version row
commit together, which §5 guarantees. A purchase saga that caches a price from the listing
rather than reading it at purchase time reopens the gap `smart-contract.md` §11 names.

**To API-09** — the serialiser in §9 is the module execution steps get redacted through.
Extend it; do not build a second boundary beside it.
