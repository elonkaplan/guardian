# Phase 1 — Internal contracts: Order Detail

**Feature**: [spec.md](../spec.md) · **Data model**: [data-model.md](../data-model.md)

The module surface this feature adds, the shared surfaces it touches, and the
backend handoff (§7) — the list to diff against the real API on first contact.

---

## 1. `src/api/orders.ts` — extended

```ts
export function createOrder(request: CreateOrderRequest): Promise<CreateOrderResponse>; // UI-03, unchanged
export function fetchOrder(id: string): Promise<Order>;
export function acceptOrder(id: string): Promise<void>;
export function complainAboutOrder(id: string, reason: string): Promise<void>;
```

- `fetchOrder` → `GET /orders/:id`. No shape tolerance, deliberately: UI-03 allowed
  exactly one (the catalogue list envelope) because a misread there renders as a
  legitimate-looking empty catalogue. Here a wrong field name renders as a missing
  countdown or an empty output panel — loud, immediate, and fixed in one file.
- `acceptOrder` → `POST /orders/:id/accept`, no body.
- `complainAboutOrder` → `POST /orders/:id/complain`, body `{ reason }`.
- Both actions discard the response body (data-model §1) and both are allowed to
  reject; the caller re-reads the order either way.

The file's existing header comment about `POST /orders` not being idempotent stays,
and gains a short note that the rule does **not** extend to these two calls, with the
reason (research R11). Someone will otherwise copy it.

---

## 2. `src/lib/orderState.ts` — new, pure

```ts
export type OrderFace = 'working' | 'review' | 'nothing-came-back' | 'arbitration' | 'concluded';
export function faceFor(state: OrderState): OrderFace;
export function isTerminalState(state: OrderState): boolean;
export function stateRank(state: OrderState): number;
export function stateLabel(state: OrderState): string;  // the chip in the header
```

Total functions over the `OrderState` union, exhaustively switched. No React, no
fetch. `stateLabel` is here rather than in a component so the header chip and any
future list share one vocabulary.

---

## 3. `src/lib/duration.ts` — new, pure

```ts
export function formatRemaining(ms: number): string; // "1h 03m" · "4m 12s" · "9s" · "0s"
export function formatElapsed(ms: number): string;   // same vocabulary
```

Never negative — both clamp at zero. Never throws on `NaN` (an unparseable timestamp
yields `—`, matching `formatUsd`'s behaviour on a non-finite figure).

---

## 4. `src/lib/serverClock.ts` — new

```ts
export function noteServerDate(header: string | null): void;
export function serverNow(): number;
export function clockSkewMs(): number;
```

Module-level mutable state, which is unusual in this codebase and is the reason it
has its own file rather than living in `client.ts`: it is observable behaviour worth
a comment block and a name, not a variable buried in a request function. Never
throws — a malformed header is ignored. See data-model §3 for the 2000ms deadband.

---

## 5. Hooks

### `src/hooks/usePolling.ts` — one additive option

```ts
export interface PollingOptions<T> {
  intervalMs: number;
  isTerminal?: (data: T) => boolean;
  enabled?: boolean;
  isFatalError?: (error: ApiError) => boolean;  // NEW — stop the schedule permanently
}
```

Evaluated in the existing `refetchInterval` callback's error branch. Defaulted, so
`BalanceWidget`, `PollTestPage`, and any UI-06 caller are unaffected. The hook's
comment explaining why errors normally keep polling gains the exception (research
R15).

### `src/hooks/useNow.ts` — new

```ts
export function useNow(intervalMs: number, active?: boolean): number;
```

**The app's only `setInterval`.** Added during implementation, and not in the original
plan: the elapsed line and the countdown are both time-driven, and two independent
timers is how one of them ends up leaked or throttled differently. It reports an
*instant* from `serverNow()`, never a duration — callers subtract — which is what
makes a suspended tab a non-event. Recomputes on `visibilitychange`; `active: false`
creates no timer at all.

### `src/hooks/useCountdown.ts` — new

```ts
export function useCountdown(deadlineMs: number | null): {
  remainingMs: number;
  expired: boolean;
};
```

Built on `useNow`; creates no timer of its own. `null` means there is no window, and
yields `expired: false` — "no window" and "the window closed" must not collapse, or a
never-delivered order would claim its release is being processed. Recomputes from the
deadline on every tick rather than decrementing (FR-018), and deactivates the clock at
zero.

### `src/hooks/useOrder.ts` — new

```ts
export function useOrder(id: string): {
  order: Order | undefined;
  face: OrderFace | undefined;
  error: ApiError | null;
  notFound: boolean;      // 404 / 403 — the poll has stopped
  stale: boolean;         // updates are failing but we still have data
  isPolling: boolean;
  refetch: () => void;
};
```

The page's whole data layer. Wraps `usePolling(['order', id], …)` with
`intervalMs: 1000`, `isTerminal: (o) => isTerminalState(o.state)`, and
`isFatalError: (e) => e.kind === 'http' && (e.status === 404 || e.status === 403)`.
Owns the monotonic guard (data-model §5) and the one-shot `['me']` invalidation on
the terminal transition (research R13).

`stale` is `error !== null && order !== undefined` — the quiet "not updating"
indicator of FR-014, as distinct from `error` with no data, which is the full error
state.

---

## 6. Components — `src/components/`

| Component | Props | Responsibility |
| --- | --- | --- |
| `OrderSummaryHeader` | `{ order }` | The persistent band: agent name, price, state chip, order id. Rendered on every face (FR-003). |
| `OutputPanel` | `{ output: unknown }` | Table / prose / JSON by inspection (research R9). Scrolls internally. |
| `CriteriaPanel` | `{ criteria: string }` | The buyer's words verbatim, labelled as fixed at purchase (FR-023). |
| `ReviewCountdown` | `{ remainingMs, expired }` | The clock, its label, and the expired wording (FR-016, FR-019, FR-021). Takes the computed remainder, not the deadline: the hook owns the clock, the component owns the words. |
| `OrderActions` | `{ order }` | Accept and Complain; both mutations, the in-flight guard, refusal and silence copy (FR-025–FR-032). No `disabled` prop — which action is available is derived from `order.state`, and the page withdraws the whole component when the window has expired. |
| `ComplainDialog` | `{ open, pending, error, onConfirm, onCancel }` | Native `<dialog>`; reason field, finality copy, confirm (FR-027–FR-029). |
| `VerdictSlot` | `{ state }` | The reserved region UI-05 fills (FR-007). Renders a labelled container and one line; never a blank gap. |
| `SubmittedInput` | `{ input }` | What the buyer sent, on the working face and below the fold elsewhere (FR-004). |

`OrderActions` owns both mutations rather than the page, so that "either action in
flight disables both" is one component's local truth instead of a prop threaded
through two siblings.

`ComplainDialog` is presentational: it does not call the API. The mutation lives in
`OrderActions`, which is what lets the dialog stay open showing a refusal with the
typed reason intact.

---

## 7. Consumed backend endpoints — **the handoff list**

None of these are built. This is the section to diff against the API when the orders
module lands; everything else in the feature is downstream of it.

### `GET /orders/:id` — authenticated, buyer-scoped

```json
{
  "id": "uuid",
  "state": "delivered",
  "agentName": "LedgerBot",
  "priceMinor": 200,
  "acceptanceCriteria": "extract all line items with totals",
  "reviewWindowSeconds": 30,
  "createdAt": "2026-08-08T12:00:00.000Z",
  "deliveredAt": "2026-08-08T12:00:12.000Z",
  "disputedAt": null,
  "settledAt": null,
  "run": { "input": { "receipt": "…" }, "output": [ { "item": "Napkins", "amount": 2.4 } ] }
}
```

Assumptions to confirm:

1. **camelCase**, as in the documented `POST /orders` body.
2. **`agentName` is included.** The client cannot resolve it — the order points at an
   `agent_version_id`. If it is absent the header loses the agent's name; if it is
   nested (`agent: { name }`) that is a one-line change in `fetchOrder`.
3. **`run` is embedded**, with `input` and `output`. A separate `GET /orders/:id/run`
   would double this page's request rate on a 1s poll and is worth pushing back on.
4. **`run.output` is `null` on `failed`**, not an empty object or a missing key.
5. **`reviewWindowSeconds` is the order's snapshot**, not a global config value.
6. **404 for an unknown id, 403 or 404 for another buyer's order.** Either is handled;
   a 500 is not, and would keep the page polling.
7. **No `steps`, no `systemPrompt`, no `model` anywhere in this payload.** The buyer's
   view is redacted at the serialiser (`docs/api-design.md` §1.3).

### `POST /orders/:id/accept` — authenticated

No body. Expected: 2xx on success; 4xx when the order is no longer `delivered`
(already released, already disputed). The response body is ignored.

### `POST /orders/:id/complain` — authenticated

Body `{ "reason": "…" }`. Expected: 2xx on success; 4xx when the window has closed or
the order is not in a complainable state. The response body is ignored.

### Cross-cutting request

**`Access-Control-Expose-Headers: Date`** on API responses. Without it the browser
hides the `Date` header cross-origin and the countdown silently falls back to the
device clock (research R3). One header on the CORS config; no code change anywhere
else.

---

## 8. Unchanged surfaces

- **`src/routes/paths.ts`** — `orderDetail(id)` already exists. Untouched.
- **`src/routes/AppRoutes.tsx`** — the route already exists and is already wrapped in
  `RequireAuth`, which satisfies FR-035 including the return-to-order behaviour via
  its `state={{ from: location }}`. Untouched.
- **`src/lib/queryClient.ts`** — untouched, and deliberately so: its
  `refetchIntervalInBackground: true` is what research R5 relies on.
- **`src/api/errors.ts`**, **`src/lib/money.ts`**, **`src/components/LoadState.tsx`**,
  **`src/components/RequireAuth.tsx`**, **`src/components/BalanceWidget.tsx`** — all
  reused as-is.
- **`package.json`**, **`.env.example`**, **`vite.config.ts`** — no additions.
