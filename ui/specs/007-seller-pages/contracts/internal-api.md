# Phase 1 — Internal Contracts: Seller pages

**Feature**: `007-seller-pages` · **Date**: 2026-08-09

The module surface this feature adds or changes, and what the API has to be true for it to work (§11).

---

## 1. `api/types.ts` — edited

Purely additive. `Order` is **not** touched — the `OrderIdentity` extraction this file used to specify was withdrawn when api-design §3.4 opened `GET /orders/:id` to the seller ([research R3](../research.md)).

```ts
/** `GET /sales` — an order placed against an agent this account owns, as a list row. */
export interface Sale {
  id: string;              // the order id
  agentName: string;
  priceMinor: Cents;
  state: OrderState;
  createdAt: string;
  disputedAt: string | null;
}

/** `GET /agents?owner=me` — the catalogue row plus the flag only an owner sees. */
export interface OwnedAgent extends AgentSummary {
  active: boolean;
}

/** `POST /agents` — one agent and its version 1. */
export interface CreateAgentRequest {
  name: string;
  description: string;
  priceMinor: Cents;
  capabilities: string[];
  exclusions: string[];
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  systemPrompt: string;
  model: string;
}

/** `PATCH /agents/:id/active` — an absolute value, never a toggle instruction. */
export interface SetAgentActiveRequest {
  active: boolean;
}
```

No response type for either write. Both discard, for the reason `acceptOrder` gives.

---

## 2. `api/agents.ts` — edited

```ts
export function fetchOwnedAgents(): Promise<OwnedAgent[]>;   // GET /agents?owner=me
export async function createAgent(request: CreateAgentRequest): Promise<void>;  // POST /agents
export async function setAgentActive(id: string, active: boolean): Promise<void>; // PATCH /agents/:id/active
```

`fetchAgents` and `fetchAgent` are unchanged apart from calling the extracted `unwrapList` (§4).

`createAgent` carries the non-idempotency doctrine for this file, and it must state which rule it is following and why — the same courtesy `api/wallet.ts` paid when it re-derived `api/orders.ts`'s rule rather than copying it. Summary: `POST /agents` inserts an agent, inserts version 1, and calls `registerAgent` on-chain before answering, so a timeout says nothing about whether the listing exists. Never retried automatically; a 4xx is a refusal and is safe to correct and resubmit.

`setAgentActive` carries the opposite note, and it matters that it is written down rather than left to inference: this call is **idempotent by construction** because the client supplies an absolute value. Silence resolves on the next poll. Do not copy the paragraph above onto it.

Ids go through `encodeURIComponent`, as everywhere else in this layer.

---

## 3. `api/sales.ts` — new

```ts
export function fetchSales(): Promise<Sale[]>;   // GET /sales
```

Its own file rather than an addition to `api/orders.ts`, on the precedent `api/verdicts.ts` set: that file is the buyer's order lifecycle and its long argument about `POST /orders` is a rule about writes with nothing to say about a seller's read. Same endpoint family, different side, different rules.

Unwraps a list envelope (§4) with keys `['sales', 'items', 'data']`.

---

## 4. `lib/listEnvelope.ts` — new

```ts
export function unwrapList<T>(payload: unknown, keys: readonly string[]): T[];
```

The branch currently duplicated in `api/agents.ts` and `api/wallet.ts`, extracted at its third and fourth call sites ([research R16](../research.md)). Accepts a bare array, or a single-key envelope around one under any of `keys`; returns `[]` for anything else rather than throwing.

Callers and their keys:

| Caller | Keys |
| --- | --- |
| `fetchAgents` | `['agents', 'items', 'data']` |
| `fetchOwnedAgents` | `['agents', 'items', 'data']` |
| `fetchLedger` | `['entries', 'items', 'data']` |
| `fetchSales` | `['sales', 'items', 'data']` |

The module comment must preserve the argument the two originals carry: this belongs in `lib/`, called explicitly by each fetcher, and **not** in `client.ts`, where a future endpoint would inherit it by accident.

---

## 5. `lib/agentDraft.ts` — new

Pure. No React, no fetch, no module state. The whole of the create form's judgement.

```ts
export interface SchemaParse { ok: true; value: Record<string, unknown> }
                             | { ok: false; message: string };

/** Parses, and is a plain object. Nothing further — R12. */
export function parseSchemaText(text: string, subject: 'input' | 'output'): SchemaParse;

/** Drops empty and whitespace-only terms; trims the rest. FR-014. */
export function cleanTerms(terms: string[]): string[];

export interface DraftFields {
  name: string; description: string; price: string;
  capabilities: string[]; exclusions: string[];
  inputSchemaText: string; outputSchemaText: string;
  systemPrompt: string; model: string;
}

export type DraftResult =
  | { ok: true; request: CreateAgentRequest }
  | { ok: false; errors: Record<string, string> };

/** Validates everything and assembles the body, or returns every failure at once. */
export function buildCreateAgentRequest(fields: DraftFields): DraftResult;
```

`buildCreateAgentRequest` reports **all** failures in one pass rather than stopping at the first. A nine-field form that surfaces one error per submission is a form people submit five times.

Field keys in `errors` match the form's field names, so the page maps them onto controls without a lookup table.

Never throws, for any input. Same rule as `parseUsd`: it sits behind controls a person is actively typing into.

---

## 6. `lib/perspective.ts` — new

```ts
export type Perspective = 'buyer' | 'seller';
```

A shared vocabulary, not a behaviour. See [data-model §2](../data-model.md) for every string it selects.

---

## 7. `lib/money.ts` — edited

```ts
export interface ParseUsdOptions { ceilingMessage?: string }
export function parseUsd(input: string, options?: ParseUsdOptions): ParseResult;
```

Purely additive: the default message, the ceiling value, the integer arithmetic, and every other rule are unchanged, and every existing call site keeps working with one argument ([research R14](../research.md)).

`TREASURY_CEILING_CENTS` remains the single ceiling. Only the sentence varies.

---

## 8. Hooks

| Hook | File | Signature | Notes |
| --- | --- | --- | --- |
| `useOwnedAgents` | `hooks/useOwnedAgents.ts` | `() => { agents, error, loading, refetch }` | `usePolling(['agents','mine'], fetchOwnedAgents, { intervalMs: 5000 })`. No terminal predicate |
| `useSales` | `hooks/useSales.ts` | `() => { sales, error, loading, refetch }` | `usePolling(['sales'], fetchSales, { intervalMs: 5000 })`. No terminal predicate. **The list page only** |

`useOrder`, `useVerdict`, and `useCaseFile` are **used unchanged** by the seller's dispute screen. All three take an order id and a gate, and none of them knows or cares who is reading.

`useOrder` is the one that changed hands late: api-design §3.4 authorises `GET /orders/:id` for the seller, so the dispute screen follows the order through the hook that already does it — 1s while live, stopped on terminal, 404/403 as a dead end, and the monotonic guard that keeps a ruling from dropping back to an earlier state. The `useSale(id)` this file used to specify — a 5s poll of the whole sales list, selecting one row — is **withdrawn** ([research R7](../research.md)).

---

## 9. Components

### New

| Component | Props | Job |
| --- | --- | --- |
| `OwnedAgentList` | `{ agents, error, loading, onRetry }` | The seller's listings, each with its availability control |
| `AvailabilityToggle` | `{ agent: OwnedAgent }` | One row's `PATCH`, its in-flight state, and its failure. Owns no optimistic value |
| `SalesList` | `{ sales, error, loading, onRetry }` | The sales table; each row links to `/sell/sales/:id` |
| `TermListField` | `{ label, hint, terms, disabled, onChange, addLabel }` | A repeatable single-line term list. Used twice, worded differently ([research R13](../research.md)) |
| `SchemaTextArea` | `{ label, hint, value, error?, disabled, onChange, id }` | A raw JSON textarea and its refusal. Holds no parsing — the page calls `parseSchemaText` |

### Edited — props only, behaviour unchanged

| Component | Change | Call sites to update |
| --- | --- | --- |
| `VerdictCard` | **+ `perspective: Perspective`** | `OrderDetailPage` ×2 |
| `CitationChecklist` | **+ `perspective: Perspective`** | `VerdictCard` ×1 |
| `CaseFilePanel` | **+ `perspective: Perspective`** | `OrderDetailPage` ×2 |

`OrderSummaryHeader` is **not edited**. It takes `Order`, the seller's screen now has one, and its three labels — "Order", "Price", and the state chip — are true from either side.

`perspective` is required, so a forgotten one is a compile error rather than a screen that addresses a seller as the buyer.

### Pages

| Page | File | State |
| --- | --- | --- |
| My agents | `pages/MyAgentsPage.tsx` | placeholder **replaced** |
| Create agent | `pages/CreateAgentPage.tsx` | placeholder **replaced** |
| Seller's sale | `pages/SellerSalePage.tsx` | **new** |

---

## 10. Routes

`routes/paths.ts` gains one pattern and one builder:

```ts
routePatterns.sellerSale = '/sell/sales/:id';
paths.sellerSale = (id: string) => `/sell/sales/${id}`;
```

`AppRoutes` renders it inside `RequireAuth`, beside the two existing `/sell` routes. It cannot collide with `/sell/new` under any route ranking ([research R5](../research.md)).

---

## 11. Backend handoff

Four endpoints to build, three to widen. The database beneath them exists — `agent.entity.ts`, `agent-version.entity.ts`, and `order.entity.ts` are mapped with the column names this feature reads.

**The two rules that mattered most are no longer a handoff.** api-design §3.3 and §3.4 now carry them in the endpoint tables themselves, with the reasoning attached, so API-06 and API-07 read the same text this feature was built against. What is left below is shapes and defaults.

### 11.1 What is called

| Method | Path | Auth | Returns | Status |
| --- | --- | --- | --- | --- |
| `GET` | `/agents?owner=me` | owner | `OwnedAgent[]` — including inactive | **api-design §3.3** |
| `POST` | `/agents` | seller | anything; the body is discarded | api-design §3.3 |
| `PATCH` | `/agents/:id/active` | owner | anything; the body is discarded | api-design §3.3 |
| `GET` | `/sales` | seller | `Sale[]` | api-design §3.4 |
| `GET` | `/orders/:id` | **buyer or seller** | `Order` | **api-design §3.4** |
| `GET` | `/orders/:id/case-file` | **buyer or seller** | `CaseFile`, unredacted for the seller | **api-design §3.4** |
| `GET` | `/orders/:id/verdict` | **buyer or seller** | `Verdict` | **api-design §3.4** |

The last three are already consumed by UI-04 and UI-05; what is new here is the second reader, and §3.4 authorises it.

### 11.2 Settled by the doc, no longer assumed

1. **`GET /agents?owner=me` includes inactive agents.** api-design §3.3 gives it its own row and states the consequence: without it the availability toggle is one-way, because deactivating an agent removes it from the only screen that could switch it back on. Quickstart **D8** still checks it — the doc records the intent, the check catches the implementation.
2. **The order read, the case file, and the verdict authorise the buyer *or* the agent's owner.** api-design §3.4, with the reasoning: a seller told a dispute was filed who cannot then open the case file has been notified of an accusation they are not allowed to see. Authorisation runs `orders → agent_version → agent.owner_account_id`. The three writes stay buyer-only, which is product-workflow §7.5 expressed as an access rule.

### 11.3 What remains assumed

3. **`GET /agents?owner=me` carries `active`.** Without it the list cannot distinguish a listed agent from a withdrawn one, and the toggle has no value to render.
4. **`PATCH /agents/:id/active` takes `{ active: boolean }`** — an absolute value, not a toggle instruction. A server-side toggle would make the call non-idempotent and would break the reasoning in [research R9](../research.md).
5. ~~**`POST /agents` completes the on-chain `registerAgent` before answering.**~~ **Settled.** `api/docs/specs/API-06-catalogue.md` scopes it as *"calls `registerAgent` and **awaits the receipt**, returning with `onchain_agent_id` set"*. The form has nothing to wait for because there is nothing left outstanding when it answers, and SC-002 — a newly listed agent is purchasable with no manual fix — holds by construction.
6. **`GET /sales` selects by `agents.owner_account_id`** and returns rows carrying at least `id`, `agentName`, `priceMinor`, `state`, `createdAt`, `disputedAt`. `id` is the **order** id — it is what the dispute screen's three reads are keyed on.
7. **`agents.active` defaults to `true`**, as the entity says, so a new agent is on the market immediately. The form sends no `active`.
8. **`agent_versions.timeout_seconds` keeps its default of 120.** The form does not collect it.
9. **No idempotency key on `POST /agents`.** If one is ever accepted, the ambiguous branch in the create form and the doctrine paragraph in `api/agents.ts` can both be deleted.

### 11.4 Nothing left worth a conversation

There is no longer an assumption on this list that would break a user story if it were wrong. What remains — field names, two column defaults, and the absence of an idempotency key — shows up as a blank cell, a wrong default, or a branch that stays dead, all of them visible on first contact and fixable in `api/types.ts`.

The three that *would* have broken something are settled in writing, and none of them in this directory:

| Was | Now |
| --- | --- |
| `GET /agents?owner=me` might filter to active agents | api-design §3.3, and API-06's brief calls it out twice |
| The three order reads might be buyer-only | api-design §3.4, API-07's acceptance criteria, API-09 line 26 |
| `POST /agents` might answer before `registerAgent` lands | API-06 scopes it as *awaits the receipt* |

### 11.5 Which API feature owns what

| This feature calls | Owned by | State |
| --- | --- | --- |
| `POST /agents`, `PATCH /agents/:id/active`, `GET /agents`, `GET /agents?owner=me` | **API-06 — Catalogue** | Specified (`api/specs/006-agent-catalogue/spec.md`); no controller yet |
| `GET /sales`, `GET /orders/:id`, `GET /orders/:id/case-file` | **API-07 — Orders & purchase saga** | Brief only |
| `GET /orders/:id/verdict` | **API-09 — Guardian audit** | Brief only |

API-06 alone unblocks US1, US4, and the agents half of US2. US3 needs API-07 and API-09 together.

