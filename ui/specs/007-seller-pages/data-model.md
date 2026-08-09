# Phase 1 — Data Model: Seller pages

**Feature**: `007-seller-pages` · **Date**: 2026-08-09 · **Spec**: [spec.md](./spec.md) · **Research**: [research.md](./research.md)

No persistence, no context, no `localStorage`. Everything below is either a wire type, a value derived from one, or component-local state that dies with the screen.

---

## 1. Payload types

All new types live in `src/api/types.ts` beside the existing ones. Field names are read off `api/src/entities/*.entity.ts`, which is why they are a shorter guess than the previous two features' were ([research R1](./research.md)).

### 1.1 `Order` — unchanged

Not edited. The `OrderIdentity` extraction this section used to specify was withdrawn once api-design §3.4 authorised `GET /orders/:id` for the seller: the dispute screen holds a real `Order`, so `VerdictCard` and `OrderSummaryHeader` keep the prop type they already had ([R3](./research.md)).

### 1.2 `Sale` — `GET /sales`

```ts
export interface Sale {
  id: string;
  agentName: string;
  priceMinor: Cents;
  state: OrderState;
  createdAt: string;
  disputedAt: string | null;
}
```

`id` is the **order id**, not a separate sale id: it is what `/sell/sales/:id` carries and what the dispute screen's three reads are keyed on.

Six fields, deliberately — the minimum the sales *list* renders ([R4](./research.md)). It is no longer the dispute screen's payload, which is why it does not grow toward `Order`. Declaring fewer fields than arrive is safe; declaring more is what renders blank.

### 1.3 `OwnedAgent` — `GET /agents?owner=me`

```ts
export interface OwnedAgent extends AgentSummary {
  active: boolean;
}
```

`AgentSummary` is `{ id, name, description, priceMinor }`. The only addition is the availability flag, which the public catalogue has no use for because the public catalogue only ever contains active agents.

**What is absent is the point** ([R17](./research.md)): no `systemPrompt`, no `model`, no `timeoutSeconds`, no `inputSchema`, no `outputSchema`. If `GET /agents?owner=me` hands back whole version rows, this type gives the seller's list nowhere to put the execution spec, so no component can render one.

### 1.4 `CreateAgentRequest` — `POST /agents`

```ts
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
```

Maps one-to-one onto `agent_versions` columns. Two omissions are deliberate:

- **No `timeoutSeconds`** — the column defaults to 120 and the form does not collect it (spec Out of scope).
- **No `active`** — `agents.active` defaults to `true`. A client-supplied value would be a second authority over whether a brand-new listing is live.

There is **no `CreateAgentResponse`**. `createAgent` discards its response, following `acceptOrder`'s precedent: the seller's list refetch is the authority on what now exists, and declaring a response shape would be asserting something about an endpoint nobody has built.

### 1.5 `SetAgentActiveRequest` — `PATCH /agents/:id/active`

```ts
export interface SetAgentActiveRequest {
  active: boolean;
}
```

An absolute value, never a toggle instruction. That is what makes the call idempotent and is the whole of [R9](./research.md)'s argument for treating it differently from the money POSTs. Response discarded.

---

## 2. `Perspective` — the one new non-wire type

```ts
// src/lib/perspective.ts
export type Perspective = 'buyer' | 'seller';
```

Its own module because three components and two pages share it and none of them owns it. It selects copy and nothing else — never layout, never which fields render, never arithmetic ([R2](./research.md)).

Where it changes a string:

| Site | `'buyer'` | `'seller'` |
| --- | --- | --- |
| `VerdictCard` → `Split` label 1 | You get back | The buyer gets back |
| `VerdictCard` → `Split` label 2 | The seller keeps | You keep |
| `CitationChecklist` note | …the criteria **you** wrote… | …the criteria **the buyer** wrote… |
| `CitationChecklist` → `sourceLabel('criterion')` | Your criterion | The buyer's criterion |
| `CaseFilePanel` summary | your input, your criteria | the buyer's input, their criteria |
| `CaseFilePanel` heading 1 | What you submitted | What the buyer submitted |
| `CaseFilePanel` heading 2 | Your acceptance criteria | The buyer's acceptance criteria |

`sourceLabel('capability')` and `sourceLabel('exclusion')` do **not** vary. "Promised capability" and "Declared exclusion" are facts about the clause, not about who is reading it.

---

## 3. Derived values

Nothing here is stored; each is computed from the values above at render time.

| Value | From | Rule |
| --- | --- | --- |
| `order` on the dispute screen | `useOrder(id)` | The route's `:id` fetched directly. `notFound` comes from the hook — a 404 or 403 — rather than from a missing row in a list ([R7](./research.md)). |
| `disputed` | `order.disputedAt !== null` | Gates `useCaseFile` and separates FR-036's "no dispute" screen from the dispute screen. A fact, not a state test — the same test `ConcludedFace` makes. |
| Case-file `defaultOpen` | `order.state` | Open while the ruling has not landed (the panel is the only thing to read); collapsed once a verdict renders above it. The same rule the buyer's two faces use. |
| Row emphasis in the sales list | `sale.disputedAt !== null` | FR-005. A fact rather than `state === 'settled'`, which would miss a dispute still in flight. |
| Sales list ordering | `createdAt` | Newest first. The list is not re-sorted client-side beyond that. |
| `terms` sent | the term list | `terms.map(t => t.trim()).filter(t => t !== '')` — FR-014, applied at assembly, never while typing. |
| `priceMinor` | the price field's text | `parseUsd(text, { ceilingMessage })`, integer cents throughout ([R14](./research.md)). |
| `inputSchema` / `outputSchema` | the two textareas | `parseSchemaText(text)` — parses, and is a plain object ([R12](./research.md)). |
| Split figures | `sale.priceMinor` + `verdict.refundMinor` | `splitFor`, unchanged. The seller's screen does **not** re-derive the split from the tier percentage, for the reason `lib/verdict.ts` already gives. |

---

## 4. Query keys and cache flow

| Key | Fetcher | Cadence | Stops when | Read by |
| --- | --- | --- | --- | --- |
| `['agents', 'mine']` | `fetchOwnedAgents` | 5s | never | `/sell` |
| `['sales']` | `fetchSales` | 5s | never | `/sell` |
| `['agents']` | `fetchAgents` | load only | — | the public marketplace (**invalidated** by this feature, never read by it) |
| `['order', orderId]` | `fetchOrder` | 1s | `released` or `settled` | `/sell/sales/:id` — unchanged hook |
| `['verdict', orderId]` | `fetchVerdict` | 1s | `txHash !== null` or `state === 'settled'` | `/sell/sales/:id` — unchanged hook |
| `['case-file', orderId]` | `fetchCaseFile` | read once | first success or first failure | `/sell/sales/:id` — unchanged hook |

Each key has exactly one observer, on one route. `['order', orderId]` is shared with the buyer's screen by key, but the two are never mounted together and each fetches its own party's authorised view of the same row.

The dispute screen's three keys are the buyer's three keys, at the buyer's cadences, through the buyer's hooks — this feature adds no order-following machinery of its own ([R7](./research.md)).

**Invalidations**, all on `settled` rather than `success`, following `OrderActions` and `WalletActions`:

| After | Invalidate | Why |
| --- | --- | --- |
| `createAgent` | `['agents','mine']`, `['agents']` | The new listing must be on the seller's list on arrival and in the public catalogue behind them. |
| `setAgentActive` | `['agents','mine']`, `['agents']` | The switch reflects the refetched value ([R8](./research.md)); the catalogue must agree on the next visit (US4 scenario 3). |

Nothing in this feature invalidates `['me']`. No money moves.

---

## 5. Local state

| Screen | State | Notes |
| --- | --- | --- |
| Create agent | `name`, `description`, `price`, `systemPrompt`, `model` — five `useState<string>` | `model` initialised to `claude-haiku-4-5` |
| | `capabilities`, `exclusions` — two `useState<string[]>` | Each starts `['']`, so the field renders one empty row rather than an empty region |
| | `inputSchemaText`, `outputSchemaText` — two `useState<string>` | Pre-filled with a minimal example object, so the field teaches its own format |
| | `errors` — one `useState<Record<string, string>>` | Set on submit only; never on keystroke |
| | `ambiguous` — `useState<boolean>` | Set when a submission fails with a connectivity error ([R10](./research.md)). Deliberately not cleared by editing |
| | `inFlight` — `useRef<boolean>` | Written synchronously; the guard `isPending` cannot be |
| Owned agent row | `pendingId` — `useState<string \| null>` on the list, or per-row `isPending` | Whichever row is mid-`PATCH`. No optimistic value is held anywhere ([R8](./research.md)) |
| | `inFlight` — `useRef<boolean>` | Shared across rows: two `PATCH`es racing to opposite values land in an order nobody chose |
| Seller sale screen | none | Every value comes from a query. The screen holds no state at all |

No screen in this feature persists anything, and none writes to a context.

---

## 6. Failure states, and what each one shows

| Situation | Screen |
| --- | --- |
| `['agents','mine']` fails, `['sales']` fine | The agents section shows `LoadState status="error"` with a retry; the sales section renders normally (FR-007) |
| `['sales']` fails, `['agents','mine']` fine | The mirror image |
| Either list is empty | `LoadState status="empty"` with its own sentence — "You have not listed an agent yet" / "No sales yet" — never a blank region (FR-007) |
| A sale carries an unrecognised state | The row still renders; `stateLabel` is exhaustively switched, so an unknown state is a **compile error** in `lib/orderState.ts` rather than a missing row (FR-009) |
| `/sell/sales/:id` returns 404 or 403 | A dead end: "No such sale — this order does not exist, or it was not placed against one of your agents", with a link back to `/sell`. `useOrder`'s own `notFound`, and the poll has already stopped |
| The order read fails transiently | `useOrder`'s `stale` — a quiet notice over a screen that still reads correctly, never a blanked verdict |
| The sale is not disputed | The summary band, the state, and a sentence: there is no dispute on this sale. No case-file panel, no verdict card (FR-036) |
| Case file fails | Reported inside the panel with a retry. The verdict card above is untouched — `CaseFilePanel` already owns this (FR-035) |
| Verdict fails | Reported inside the card with a retry. The case file below still renders — `VerdictCard` already owns this (FR-035) |
| Disputed, not yet ruled | Case file open, and a line saying Guardian has not ruled yet. The verdict appears on its own when `state` reaches `adjudicated` (FR-034) |
| `createAgent` refused (4xx) | The reason in place, every entered value kept, submit re-enabled (FR-022) |
| `createAgent` silent (timeout / network) | Locked, no retry, pointed at `/sell` ([R10](./research.md)) |
| `setAgentActive` fails | The reason beside the row; the switch shows the server's value, never the attempted one (FR-027) |
| Session expires | `client.ts` clears the token and dispatches `UNAUTHENTICATED_EVENT`; `AppShell` navigates to connect. Nothing new here |
| Signed out | `RequireAuth` redirects, carrying the attempted location. All three routes are guarded |

---

## 7. What this feature does *not* model

- **No agent edit or version model.** No `AgentVersion` type, no `GET /agents/:id/versions` call, no version comparison (FR-038). That endpoint is the one documented as returning execution specs, and this feature never reaches it.
- **No execution spec on the way back.** `systemPrompt` and `model` exist in exactly one type, `CreateAgentRequest`, which only ever travels outward ([R17](./research.md)).
- **No earnings, payouts, or seller analytics** (FR-039). Money is the wallet screen's subject; a second place that adds up what a seller has made would be a second authority over a figure the wallet already owns.
- **No buyer identity on a sale.** The seller learns what was ordered, what it cost, and what was ruled — not who bought it.
- **No notification model.** The sales list *is* the notification ([R6](./research.md)), which is why it polls.
- **No second way of following an order.** The dispute screen uses `useOrder`, `useVerdict`, and `useCaseFile` exactly as the buyer's screen does. No `useSale`, no list-poll standing in for a resource read, no order state machine of this feature's own ([R7](./research.md)).
