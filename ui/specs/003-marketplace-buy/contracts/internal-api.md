# Phase 1 — Internal contracts: Marketplace & Agent Detail

**Feature**: 003-marketplace-buy · **Date**: 2026-08-08

The module surface this feature adds. Companion to [`../../001-ui-foundation/contracts/internal-api.md`](../../001-ui-foundation/contracts/internal-api.md) and [`../../002-wallet-connect/contracts/internal-api.md`](../../002-wallet-connect/contracts/internal-api.md), which it extends rather than replaces.

Section 8 is the part UI-04 and UI-07 read: consumed backend endpoints, and the assumptions this feature makes about shapes that do not exist yet.

---

## 1. `src/api/agents.ts` — the catalogue

```ts
function fetchAgents(): Promise<AgentSummary[]>;      // GET /agents
function fetchAgent(id: string): Promise<AgentListing>; // GET /agents/:id
```

Both go through `apiGet` and inherit the base URL, the 10s timeout, `Authorization` if a credential happens to exist, and `ApiError` normalisation. Neither requires a session — these routes are public (`api-design.md` §3.3).

**`fetchAgents` normalises the list envelope.** It accepts a bare array or a single-key wrapper (`agents` / `items` / `data`) and returns an array either way. This is the **only** shape tolerance in the API layer and it exists for one reason: an envelope misread as an array renders as "no agents are listed yet" — a plausible, silent, empty stage. Do not generalise this to other endpoints (research R3).

---

## 2. `src/api/orders.ts` — the purchase

```ts
function createOrder(request: CreateOrderRequest): Promise<CreateOrderResponse>; // POST /orders
```

**Rules for callers**

| Rule | Why |
| --- | --- |
| Never call this twice for one buyer intent without a confirmed refusal in between. | The purchase is not idempotent. API-07 commits the order and the ledger debit in one transaction before responding; a timeout says nothing about whether it committed. |
| Never retry automatically — not on timeout, not through `useMutation`'s `retry`. | Same reason. `retry: false` is already the client-wide default; do not override it here. |
| Never send a price, a review window, or any settlement parameter. | `CreateOrderRequest` has nowhere to put them, and `reviewWindowSeconds` comes from backend config (`api-design.md` §4). FR-021. |

This file will grow `acceptOrder`, `complainAboutOrder`, and the order reads in UI-04. Keep it the single home for `/orders*`.

---

## 3. `src/lib/inputSchema.ts` — schema to form, and back

Pure functions. No React, no fetch, no throwing.

```ts
function buildInputForm(schema: unknown): InputForm;

function buildPayload(
  form: InputForm,
  values: Record<string, string | boolean>,
): Record<string, unknown>;

function validateFields(
  form: InputForm,
  values: Record<string, string | boolean>,
): Record<string, string>;          // fieldName → message; empty means valid

function parseRawInput(text: string):
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; message: string };
```

**Invariants**

- `buildInputForm` **never throws**, whatever it is handed. Its input is arbitrary JSON that reached the database through a raw textarea in UI-07; `null`, a string, an array, or a schema with a cyclic-looking shape must all resolve to `mode: 'raw'` rather than a crash. A thrown error here white-screens the detail page for an agent that is otherwise perfectly buyable.
- The renderable predicate is defined **once**, here. The renderer and the payload builder both read `form.mode`; neither re-derives it.
- `buildPayload` omits blank optional fields rather than sending `""`, and never omits booleans ([data-model.md §2](../data-model.md)).
- Nothing in this module knows about money, auth, or routing.

---

## 4. `src/hooks/useAccountSummary.ts` — the balance, shared

```ts
interface AccountSummaryResult {
  data: AccountSummary | undefined;
  /** True when there is no usable figure — not signed in, still loading, or errored. */
  unknown: boolean;
}

function useAccountSummary(): AccountSummaryResult;
```

Subscribes to the `['me']` query key that `BalanceWidget` already polls at 5s. **It sets no interval of its own and issues no additional request** — TanStack Query deduplicates by key, so this is a subscription to an existing cache entry (research R8).

| Rule | Why |
| --- | --- |
| No component calls `fetchMe()` directly to check affordability. | Two sources of truth for one number that is also in the header, able to disagree for five seconds. |
| `unknown === true` must never be treated as "cannot afford". | FR-028. An unreadable balance defers to the backend; blocking on it is a self-inflicted demo stop with no operator override. |

---

## 5. Components

All under `src/components/`, matching the flat convention UI-01 and UI-02 established.

```ts
// A catalogue card. Presentational; the whole card is the link target.
function AgentCard(props: { agent: AgentSummary }): JSX.Element;

// Capabilities and exclusions, as contract terms.
function ContractTerms(props: {
  capabilities: string[];
  exclusions: string[];
}): JSX.Element;

// The generated form controls, or the raw JSON fallback.
function SchemaFields(props: {
  form: InputForm;
  values: Record<string, string | boolean>;
  errors: Record<string, string>;
  disabled: boolean;
  onChange(name: string, value: string | boolean): void;
}): JSX.Element;

// The criteria textarea plus its consequence copy and soft warning.
function AcceptanceCriteriaField(props: {
  value: string;
  error?: string;
  warning?: string;
  disabled: boolean;
  onChange(value: string): void;
}): JSX.Element;

// The whole buy flow: form state, affordability, submit, navigation.
function BuyPanel(props: { agent: AgentListing }): JSX.Element;

// Shared loading / error / empty rendering for a query-backed screen.
function LoadState(props: {
  status: 'loading' | 'error' | 'empty';
  message?: string;
  onRetry?(): void;
}): JSX.Element;
```

**Rules for callers**

| Rule | Why |
| --- | --- |
| `ContractTerms` renders both lists in full, unconditionally. It takes no `collapsed`, `limit`, or `expandable` prop, and must not grow one. | FR-006. The prop is the mechanism by which "show all" would arrive later; not having it is the guarantee. |
| `ContractTerms` renders the exclusions block even when `exclusions` is empty, with explicit "the seller declared none" copy. | FR-009. A section that vanishes reads as a seller with no limits, which is the opposite of what an empty list means. |
| `BuyPanel` is the only component that calls `createOrder`. | One place holds the non-idempotency rule (§2). |
| No component on either screen reads `localStorage` or `readToken` to decide what to render. | Inherited from UI-02 §1. Use `useAuth()`. |
| No component renders a field named `systemPrompt`, `model`, or `timeoutSeconds`. | FR-011. `AgentListing` has no such property — this rule exists so a future "just add the field" stays a review failure rather than a silent leak. |

---

## 6. Pages

```ts
function MarketplacePage(): JSX.Element;   // REWRITE — was a placeholder
function AgentDetailPage(): JSX.Element;   // REWRITE — was a placeholder
```

`MarketplacePage` owns the four-state render (loading / populated / empty / error, FR-003). `AgentDetailPage` owns the listing fetch, the 404 branch (FR-012), and the reading order that puts `ContractTerms` above `BuyPanel` (FR-008) — the ordering is a property of this file's JSX, so a reviewer checks it here.

Neither page is wrapped in `RequireAuth`, and neither should be (research R10).

---

## 7. Unchanged surfaces

This feature adds **no** new environment variables, **no** new `localStorage` keys, and **no** dependencies. It changes no existing module's exported surface. The edits to existing files are additive:

| File | Edit |
| --- | --- |
| `src/api/types.ts` | + `AgentSummary`, `AgentListing`, `JsonSchema`, `CreateOrderRequest`, `CreateOrderResponse` |
| `src/index.css` | + card grid, contract terms, form, buy panel blocks |
| `src/pages/MarketplacePage.tsx` | rewrite |
| `src/pages/AgentDetailPage.tsx` | rewrite |

`src/routes/paths.ts` already has `marketplace()`, `agentDetail(id)`, `orderDetail(id)`, and `wallet()` — every link this feature needs exists. No route strings are written inline.

---

## 8. Consumed backend endpoints

**None of these three are built yet.** `GET /agents` and `GET /agents/:id` arrive with API-06; `POST /orders` with API-07. The shapes below are this feature's assumption, derived from `docs/api-design.md` §3.3–3.4 and `api/specs/002-entities-migrations/data-model.md` §4. **This section is the handoff: if API-06/API-07 land differently, this is the list to diff against.**

### `GET /agents` — public

```
200 → [ { id, name, description, priceMinor }, … ]
      (a single-key envelope around that array is also accepted — §1)
```

### `GET /agents/:id` — public

```
200 → { id, name, description, priceMinor,
        capabilities: string[], exclusions: string[],
        inputSchema: object, outputSchema: object }
404 → unknown or unlisted agent
```

Must **never** include `systemPrompt`, `model`, or `timeoutSeconds`. The client has no property to receive them, so a regression on the server side surfaces as unused JSON rather than a leak — but the serialiser (API-06) remains the actual enforcement point.

### `POST /orders` — authenticated

```
body → { agentId, input: object, acceptanceCriteria: string }
201  → { id }
4xx  → refusal; `message` is rendered verbatim on the form
```

Expected refusals, all rendered inline with values preserved: agent deactivated between load and purchase, input failing `input_schema`, empty acceptance criteria, insufficient balance.

**Three coordination notes for API-07**, in priority order:

1. **A refusal must be distinguishable from a chain failure.** A `201` means the order exists — even if step 3 later marks it `failed`, that is the order screen's story, not this form's. Anything that is *not* a created order should be a 4xx/5xx so the form can keep the buyer's typed values on screen.
2. **An idempotency key would let this form offer a safe retry.** Today a timeout on `POST /orders` is unresolvable from the client, so the buyer is sent to `/orders` to look (research R12). If API-07 ever accepts and honours a client-supplied key, the ambiguous branch can become a retry and this note can be deleted.
3. **An agreed error-code vocabulary would let the form give better copy** than echoing `message` — specifically for "agent no longer available", which deserves a route back to the catalogue rather than a paragraph. Deliberately not invented client-side (research R11).

### `GET /me` — authenticated, already consumed

Read via the existing `['me']` query for the affordability check. This feature adds no new call to it.
