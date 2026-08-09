# Phase 1 — Data Model: Order Detail

**Feature**: [spec.md](./spec.md) · **Research**: [research.md](./research.md)

No persisted state, no new storage. This document fixes the payload types, the state
→ face mapping, the timing model, and the two pieces of component state that are not
derivable.

---

## 1. Payload types — `src/api/types.ts` (extended)

### `OrderState`

```ts
export type OrderState =
  | 'purchased'
  | 'running'
  | 'delivered'
  | 'failed'
  | 'released'
  | 'disputed'
  | 'adjudicated'
  | 'settled';
```

A union of the eight values, in the declaration order of the backend's `order_state`
enum (`api/specs/002-entities-migrations/data-model.md` §5.1), which is fixed there
because Postgres sorts enum values by declaration. The order carries no meaning in
this file — the lifecycle ranking is in `lib/orderState.ts` — but keeping the two
lists identical means a diff between them is visible.

A union rather than a string, so that `faceFor` is exhaustively checked: adding a
ninth state to the backend produces a type error here instead of a page with no face.

### `OrderRun`

```ts
export interface OrderRun {
  input: Record<string, unknown>;
  output: unknown | null;
}
```

`output` is `unknown` because its shape is the seller's `outputSchema`, known only at
runtime (research R9 renders it by inspection). `null` is the `failed` case and is
part of the type rather than an absence, because the non-delivery face is a thing the
screen says, not a thing it omits.

What is **not** here: `steps`. Execution steps are a documented redaction hazard
(`docs/api-design.md` §1.3, `docs/ui-design.md` §7.1) and are not in this feature's
scope. The absent property is the guarantee, exactly as `AgentListing` has no
`systemPrompt` — FR-008 is enforced by the type having nowhere to put one.

### `Order`

```ts
export interface Order {
  id: string;
  state: OrderState;
  agentName: string;
  priceMinor: Cents;
  acceptanceCriteria: string;
  reviewWindowSeconds: number;
  createdAt: string;    // ISO-8601
  deliveredAt: string | null;
  disputedAt: string | null;
  settledAt: string | null;
  run: OrderRun | null;
}
```

Every field maps to a column in `api/specs/002-entities-migrations/data-model.md` §5,
plus `agentName` (resolved through `agent_version → agent` by the backend; the client
has no way to reach it and the persistent header needs it) and `run` (§6, one per
order).

`reviewWindowSeconds` is on the order, not read from configuration — it is a snapshot
taken at purchase, so an order shows the window it was actually sold under. The
countdown must use this field and nothing else.

`run` is nullable because a `purchased` order has not started. `run.output` is
separately nullable because a `failed` run has no output. Both nulls mean different
things and both are rendered differently.

Timestamps are ISO-8601 strings, parsed at the point of use with `Date.parse`. They
are not `Date` objects because they arrive from JSON and converting them at the
boundary would mean a custom reviver for one field.

### `ComplainRequest`

```ts
export interface ComplainRequest {
  reason: string;
}
```

`docs/api-design.md` §3.4 verbatim. Accept has no body.

Both actions' responses are ignored: whatever they return, the poll's next read is
the authority on what the order now is (research R12). The wrappers are typed
`Promise<void>`.

---

## 2. State → face — `src/lib/orderState.ts`

### The five faces

| Face | States | Countdown | Actions |
| --- | --- | --- | --- |
| `working` | `purchased`, `running` | — | — |
| `review` | `delivered` | ✅ | Accept · Complain |
| `nothing-came-back` | `failed` | — | Complain |
| `arbitration` | `disputed`, `adjudicated` | — | — |
| `concluded` | `released`, `settled` | — | — |

```ts
export type OrderFace = 'working' | 'review' | 'nothing-came-back' | 'arbitration' | 'concluded';
export function faceFor(state: OrderState): OrderFace;
```

`adjudicated` maps to `arbitration`, not to `concluded`: a ruling exists but the split
has not executed, and the face says settlement is finishing while the poll keeps
running (FR-011). It is the one mapping that is not obvious from the state's name.

### Terminal

```ts
export function isTerminalState(state: OrderState): boolean; // released | settled
```

Two values, per research R4 and `docs/ui-design.md` §5. Note this is narrower than
"the face is `concluded`" only in that `concluded` *is* exactly those two — the
functions are kept separate anyway, because one governs the network and the other
governs rendering, and a future state that is visually concluded but still moving
must not silently stop the poll.

### Lifecycle rank (FR-015)

| State | Rank |
| --- | --- |
| `purchased` | 0 |
| `running` | 1 |
| `delivered` | 2 |
| `failed` | 2 |
| `disputed` | 3 |
| `released` | 4 |
| `adjudicated` | 4 |
| `settled` | 5 |

```ts
export function stateRank(state: OrderState): number;
```

Ranks are for one job only: rejecting a response that would move the page backwards.
Ties are deliberate — `delivered` and `failed` are alternative outcomes of running,
`released` and `adjudicated` are alternative exits from delivered, and neither pair
can transition into the other, so their relative order is unobservable.

---

## 3. Timing model

### The clock — `src/lib/serverClock.ts`

```ts
export function noteServerDate(header: string | null): void;
export function serverNow(): number;   // Date.now() + skewMs
export function clockSkewMs(): number; // diagnostics only
```

One module-level `skewMs`, default `0`. `client.ts` calls `noteServerDate` with
`response.headers.get('Date')` on every response, including failures. A missing,
empty, or unparseable header leaves the previous value untouched. A skew whose
magnitude is under 2000ms is stored as `0` — below that it is measuring network
latency, not a wrong clock, and a countdown that jitters by half a second on every
poll looks broken (research R3).

### The deadline

```
deadlineMs = Date.parse(order.deliveredAt) + order.reviewWindowSeconds * 1000
remainingMs = max(0, deadlineMs - serverNow())
```

Defined only when `deliveredAt !== null`. `remainingMs === 0` at load time is the
"already expired" case (FR-020): the face is still `review` if the state says
`delivered`, but the countdown reads expired and the actions are gone.

### Elapsed, on the working face

```
elapsedMs = serverNow() - Date.parse(order.createdAt)
```

Same 1s tick, same formatter family (research R7).

---

## 4. Query keys and cache

| Key | Owner | Cadence |
| --- | --- | --- |
| `['order', id]` | this feature | 1s while non-terminal; stops on terminal or on a fatal error |
| `['me']` | `BalanceWidget` in the shell | 5s; this feature invalidates it **once**, on the terminal transition (research R13) |

No other keys are read or written. The two mutations do not write to the cache
directly — they invalidate `['order', id]` and let the refetch be the truth
(research R12). Optimistic updates are deliberately absent: an optimistic
`disputed` that the backend then refuses would be the page lying about an
irreversible action.

---

## 5. Component state

Almost everything on this page is derived from one polled object. Three pieces are
not:

| State | Lives in | Why it cannot be derived |
| --- | --- | --- |
| `highestRankSeen` | `useOrder` (a ref) | History, not present state — FR-015 needs to know where the page has already been. |
| Complaint modal open / reason text | `ComplainDialog`'s parent | User intent that has not been submitted. Cleared on success; preserved across a failed submit (FR-032). |
| `actionNotice` | `OrderActions` | The "we did not hear back" line (research R11). Cleared when the state changes, because the state changing *is* the answer. |

Nothing is written to `localStorage`. Reloading the page loses an unsent complaint
reason, which is correct — a reason typed but not confirmed was not filed.

---

## 6. Validation rules

| Rule | Where | Behaviour |
| --- | --- | --- |
| Complaint reason non-empty after trim | `ComplainDialog` | Confirm disabled; nothing submitted (FR-027) |
| Reason length cap (2000 chars) | `ComplainDialog` | Soft — a counter, not a block. The backend is the authority. |
| Actions offered per face | `faceFor` + the page | Accept and Complain only on `review`; Complain only on `nothing-came-back` (FR-025) |
| Actions withdrawn once expired | `remainingMs === 0` | Neither action is offered when the window has run out (FR-020) |
| One request per intent | `mutation.isPending` | Both buttons disabled while either is in flight (FR-030) |

There is no client-side validation of *whether the action will succeed*. The backend
decides; the page re-reads.

---

## 7. What this feature does not model

- **The verdict** — tier, reasoning, citations, split, transaction hash. UI-05. The
  concluded face reserves the region (FR-007) and renders nothing from it.
- **The case file** — `GET /orders/:id/case-file` is not called. Deferred, and it
  carries a redaction obligation this feature does not take on.
- **Execution steps** — same reason; deliberately absent from `OrderRun`.
- **The seller's view** — UI-07. Nothing here branches on who is looking.
- **The orders list** — UI-06's `GET /orders`, a different key with a different
  cadence.
