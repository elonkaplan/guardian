# Phase 1 — Data Model: Wallet page

**Feature**: `006-wallet-page` · **Date**: 2026-08-09 · **Research**: [research.md](./research.md)

No database, no persisted client state. This document defines the payload types crossing the API boundary, the one coercion applied to them, the derived values the screen computes, and the query keys everything hangs off.

---

## 1. Payload types

Added to `src/api/types.ts`, beside the existing hand-written types. All money is integer USD cents (`Cents`, from `lib/money`), matching every other money figure in the app and every `BIGINT` money column in the schema.

### 1.1 `AccountSummary` — edited

```ts
export interface AccountSummary {
  address: string;
  availableBalanceMinor: Cents;
  inEscrowMinor: Cents;
  /** On-chain, read server-side. `null` when the chain read failed — unknown, never zero. */
  settledFundsMinor: Cents | null;
}
```

One added property. The existing two are unchanged, which is what leaves `BalanceWidget` and `BuyPanel` untouched (R11).

**The `null` is the whole of R2.** Available balance and escrow come from Postgres in the same read as the account; settled funds come from an `eth_call` that can fail on its own. Three states — an amount, zero, unknown — and the type carries all three. The property is **required and nullable**, not optional: optionality invites `?? 0`, which is the `67dcf4d` bug written down.

### 1.2 `LedgerEntry` — new

```ts
export type LedgerKind = 'onramp' | 'purchase' | 'offramp' | 'adjustment';

export interface LedgerEntry {
  id: string;
  /** SIGNED — credits positive, debits negative. */
  amountMinor: Cents;
  kind: LedgerKind;
  /** Set on `purchase`; the order this movement paid for. */
  orderId: string | null;
  /** A transfer id or an on-chain tx hash, when the movement had one. */
  externalRef: string | null;
  /** ISO 8601. */
  createdAt: string;
}
```

Mirrors `api/src/entities/ledger-entry.entity.ts` field for field, which is why the API side of this is a serialiser rather than a design exercise. The four kinds are the `ledger_kind` enum from database-schema §3.2.

`amountMinor` is signed, and the sign is the only source of truth for direction — the screen never infers direction from `kind`. An `adjustment` can go either way by definition, and a future kind would too.

### 1.3 Request and response shapes — new

```ts
export interface TopupRequest    { amountMinor: Cents }
export interface OfframpRequest  { amountMinor: Cents }

/** `POST /withdraw` takes no body — `withdrawFor(wallet)` moves the whole balance. */
export interface WithdrawResponse { txHash: string | null }
```

`POST /topup` and `POST /offramp` are assumed to answer with the updated `AccountSummary`; if they answer with anything else the invalidation in §4 still corrects the screen within one round trip, so the response type is not load-bearing. `WithdrawResponse.txHash` is (FR-030) — see handoff assumption 6.

---

## 2. The one coercion at the boundary

Applied in `fetchMe`, and nowhere else (R3):

| Arrives as | Becomes | Why |
| --- | --- | --- |
| a finite number | itself | the ordinary case, including `0` |
| `null` | `null` | the documented chain-read failure |
| `undefined` (field absent or renamed) | `null` | unknown, not zero — the `67dcf4d` rule |
| a string, `NaN`, `Infinity` | `null` | nothing else is a readable amount |

```ts
const settled = payload.settledFundsMinor;
settledFundsMinor: typeof settled === 'number' && Number.isFinite(settled) ? settled : null
```

**The rule this enforces, stated once**: nothing in this feature may write `settledFundsMinor ?? 0`, compare it with `>` or `<` without a null check, or pass it to arithmetic. `null` is an absence of knowledge and it propagates as `—`.

Everything else on `AccountSummary` and every field of `LedgerEntry` is read strictly, per `api/orders.ts`. `fetchLedger` unwraps a possible list envelope (R16) and nothing more.

---

## 3. Derived values

All computed at render, none stored.

| Value | Rule | Requirement |
| --- | --- | --- |
| **Figure display** | `figure === null ? '—' : formatUsd(figure)` | FR-005, FR-008 |
| **Settled state** | `null → 'unknown'`, `0 → 'empty'`, `> 0 → 'available'` — three branches, never two | FR-008, FR-027 |
| **Can withdraw** | `settledFundsMinor !== null && settledFundsMinor > 0` | FR-023, FR-027 |
| **Can cash out** | `availableBalanceMinor > 0` (from the last successful read; an unknown *account* leaves the page in a load state) | FR-024, FR-027 |
| **Cash-out ceiling** | `amountMinor <= availableBalanceMinor`, refused locally above it | FR-027 |
| **Entry direction** | `amountMinor >= 0 ? 'credit' : 'debit'` — from the sign, never from `kind` | FR-015 |
| **Entry amount** | `formatUsd(Math.abs(amountMinor))`, with the direction shown separately | FR-015 |
| **Stale figures** | `data !== undefined && error !== null` — last known amounts, visibly marked | FR-007 |
| **Statement order** | newest `createdAt` first; stable sort, server order preserved on ties | FR-015 |

**No client-side reconciliation** of the entries against the balance (R12). The sum is the server's, computed over the same rows by Postgres.

---

## 4. Query keys and cache flow

| Key | Owner | Cadence | Notes |
| --- | --- | --- | --- |
| `['me']` | `BalanceWidget` in the shell | 5s, never stops | This page **subscribes**, it does not poll (R4). A second observer would double the request rate against `/me`. |
| `['ledger']` | this page, via `usePolling` | 5s, never stops | New. No `isTerminal` — a statement never finishes. No `isFatalError` — a failing read is a resource that will come back. |

Both gated on `isSignedIn`.

After every mutation, on **settled** rather than success (R14):

```ts
onSettled: () => {
  inFlight.current = false;
  void queryClient.invalidateQueries({ queryKey: ['me'] });
  void queryClient.invalidateQueries({ queryKey: ['ledger'] });
}
```

Both keys for all three actions, including withdrawal — which writes no ledger entry, and where the wasted refetch of a small list is cheaper than a statement that contradicts the figure above it.

**Row identity**: `key={entry.id}`. This is what preserves scroll position across a poll (FR-017, R13) — a keyed list inserts one row rather than remounting the list.

---

## 5. Local state

The feature's total mutable state, all of it in one component (`WalletActions`):

| State | Kind | Why |
| --- | --- | --- |
| top-up amount | `useState<string>` | the raw text as typed; parsed on submit, never stored as cents |
| cash-out amount | `useState<string>` | same, pre-filled from the available balance on first render with a figure (R7) |
| field errors | `useState<string \| undefined>` × 2 | the parse refusal for each input |
| in-flight guard | `useRef<boolean>` | one for all three actions (R9) — a ref because state does not change until React re-renders |
| withdrawal receipt | from the mutation's `data` | not state; `useMutation` already holds it |

No context, no `localStorage`, no derived state stored. Mutation status, errors, and responses all live in `useMutation`.

---

## 6. Failure states, and what each one shows

| Condition | Figures | Statement | Controls |
| --- | --- | --- | --- |
| Not signed in | — | — | Route guard redirects (`RequireAuth`); nothing renders |
| First `/me` read in flight | `LoadState loading` | its own loading state | hidden |
| First `/me` read failed | `LoadState error` + retry | independent | hidden |
| Refresh failed, figures known | last known, marked stale | independent | **available** — the last read is good enough to act on |
| `settledFundsMinor === null` | available + escrow normal, settled `—` | normal | Withdraw disabled, "could not be read just now"; Add funds and Cash out unaffected |
| `settledFundsMinor === 0` | all three shown | normal | Withdraw disabled, "nothing settled to withdraw" |
| First `/me/ledger` read failed | unaffected | `LoadState error` + retry | unaffected |
| Statement empty | unaffected | `LoadState empty` — "no activity yet" | unaffected |
| Action refused (`http`) | unaffected | unaffected | reason shown in place, retry allowed |
| Action silent (`network`/`timeout`) | unaffected | unaffected | that control disabled, wait-and-see copy naming the resolving signal (R8) |

The two panels fail independently. A failing statement never blanks the figures and a failing account read never blanks the statement — the same rule UI-05 applied to the verdict card and the case file.

---

## 7. What this feature does *not* model

- **A settled-funds ledger.** Settlement writes no entry, by design (database-schema §3.3). There is no client-side reconstruction of on-chain history, and the screen says so rather than implying one exists (FR-019).
- **Pending or in-flight movements.** No entry has a status. A top-up is credited before it answers; a withdrawal is either recorded or not.
- **Pagination.** `GET /me/ledger` returns what it returns (CONTEXT §5).
- **Payment routes, bank details, card details.** `POST /onramp/routes` and `POST /offramp/routes` are stubs that log; no screen calls them (FR-035).
- **The treasury's own balance.** rain-integration §0.3 makes it a health check, but it is an operator's `cast balance`, not a product surface.
