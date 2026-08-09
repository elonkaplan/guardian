# Phase 1 — Contracts: Wallet page

**Feature**: `006-wallet-page` · **Date**: 2026-08-09

Two contracts: the module surface inside `ui/src` (§1–§6), and the backend handoff (§7) — every assumption this feature makes about five endpoints that do not exist yet.

---

## 1. `api/types.ts` — edited

```ts
// EDITED — one property added; the existing two are untouched.
export interface AccountSummary {
  address: string;
  availableBalanceMinor: Cents;
  inEscrowMinor: Cents;
  settledFundsMinor: Cents | null;   // null = unknown, never zero
}

// NEW
export type LedgerKind = 'onramp' | 'purchase' | 'offramp' | 'adjustment';

export interface LedgerEntry {
  id: string;
  amountMinor: Cents;        // signed
  kind: LedgerKind;
  orderId: string | null;
  externalRef: string | null;
  createdAt: string;         // ISO 8601
}

export interface TopupRequest    { amountMinor: Cents }
export interface OfframpRequest  { amountMinor: Cents }
export interface WithdrawResponse { txHash: string | null }
```

`LedgerKind` is a closed union, so a `switch` over it is exhaustive and adding a fifth kind is a compile error rather than a blank cell. Unrecognised kinds still render (FR-021) — see §3.

---

## 2. `api/me.ts` — edited

```ts
export function fetchMe(): Promise<AccountSummary>
```

Signature unchanged. The body gains the §2 coercion from [data-model.md](../data-model.md): read the payload as `unknown`, pass the three Postgres fields through, and reduce `settledFundsMinor` to `Cents | null`.

**Contract**: `fetchMe` never returns a non-null `settledFundsMinor` it did not receive as a finite number, and never returns `0` for a value it did not receive as `0`.

---

## 3. `api/wallet.ts` — new

The statement read and the three money movements. This module carries the non-idempotency doctrine for all three writes, the way `api/orders.ts` carries it for `POST /orders`.

```ts
export function fetchLedger(): Promise<LedgerEntry[]>          // GET  /me/ledger
export function topUp(amountMinor: Cents): Promise<unknown>    // POST /topup
export function cashOut(amountMinor: Cents): Promise<unknown>  // POST /offramp
export function withdraw(): Promise<WithdrawResponse>          // POST /withdraw
```

- `fetchLedger` unwraps a list envelope (`entries` / `items` / `data`) exactly as `fetchAgents` does, for the reason `agents.ts` gives: a silent empty list is a plausible wrong success (R16).
- `withdraw()` takes no argument. `withdrawFor(wallet)` moves the whole balance; there is no partial withdrawal to expose.
- **None of the three may be retried automatically** — not by `react-query` `retry` (already `false` app-wide, and it must stay that way for these), not by a "try again" button on a timeout, not by a resubmit on a back navigation. A refusal is safe to correct and retry; silence is not. R8 sets the copy per action.

---

## 4. `lib/money.ts` — edited

```ts
export type ParseResult =
  | { ok: true; cents: Cents }
  | { ok: false; message: string };

export function parseUsd(input: string): ParseResult;
```

`formatUsd` is unchanged. `parseUsd` is its inverse and holds the same discipline: **no floating-point arithmetic on money** — the string is split on the decimal point and cents are built with integers (R6).

Total: every input produces an `ok` or a `message`. It never throws and never returns a rounded approximation of what was typed. Refusal messages are the ones shown to the person, so they are written as sentences, not codes.

---

## 5. `lib/ledger.ts` — new

Pure, no React, on the same grounds as `lib/verdict.ts` and `lib/orderState.ts` — vocabulary that two call sites must not disagree about.

```ts
export function entryDirection(entry: LedgerEntry): 'credit' | 'debit';
export function entryLabel(kind: LedgerKind | string): string;
export function formatEntryTime(iso: string): string;
```

- `entryDirection` reads the **sign of the amount**, never the kind. An `adjustment` goes either way by definition.
- `entryLabel` maps the four kinds to reader-facing words — *Added funds*, *Purchase*, *Cashed out*, *Adjustment* — and returns an unrecognised kind's own string rather than dropping the row (FR-021).
- `formatEntryTime` renders an absolute local date and time via `Intl.DateTimeFormat`, and `—` for an unparseable timestamp, matching `formatUsd` and `formatDuration`'s convention for a value they cannot render.

---

## 6. Components and hooks

| Module | Kind | Surface | Contract |
| --- | --- | --- | --- |
| `hooks/useAccountSummary.ts` | EDIT | `{ data, unknown, error }` | Additive third field (R5). `unknown` keeps its exact current meaning so `BuyPanel` is unaffected. Still a passive subscriber — no interval of its own. |
| `hooks/useLedger.ts` | NEW | `usePolling(['ledger'], …)` at 5s | No `isTerminal`, no `isFatalError`. Gated on `isSignedIn`. |
| `components/MoneyFigures.tsx` | NEW | `{ account, stale }` | Renders three labelled figures and **never a total** (FR-002). Owns the `null → '—'` rule and the explanation beneath each figure (FR-003). Presentational: no fetching, no mutations. |
| `components/AmountField.tsx` | NEW | `{ label, value, error?, disabled, onChange }` | A text input plus its refusal message. Holds no parsing — the caller parses on submit — so the two forms cannot validate differently. |
| `components/WalletActions.tsx` | NEW | `{ account }` | Owns all three mutations, the single in-flight ref (R9), the refusal/silence classification (R8), and the withdrawal receipt. The only component in the feature that writes. |
| `components/LedgerTable.tsx` | NEW | `{ entries, error, onRetry }` | Rows keyed by `entry.id` (FR-017). Links `purchase` rows to their order via `paths.orderDetail` (FR-018). Carries the statement-scope note (FR-019). Renders its own load, error, and empty states. |
| `components/ExplorerTxLink.tsx` | NEW | `{ hash }` | Extracted from `TxHashLink` (R15): validate with `isTxHash`, truncate for display, full value in `title` and `href`, `target="_blank" rel="noopener noreferrer"`, URL from `explorerTxUrl` and nowhere else. Renders plain text for a hash that does not validate. |
| `components/TxHashLink.tsx` | EDIT | props unchanged | Delegates its present-hash branch to `ExplorerTxLink`. Keeps its copy button and its two missing-hash sentences. The verdict card's call site does not move. |
| `pages/WalletPage.tsx` | EDIT | — | Composition only. Replaces the `PagePlaceholder`. |

**Boundaries, enforced structurally rather than by review** (FR-033, FR-034, FR-035): no module in this feature imports `wagmi`, `viem`'s client, or `chain/chains.ts` beyond `explorerTxUrl` — every chain read and every chain write belongs to the backend. No module imports anything named `route` from the API layer, because `/onramp/routes` and `/offramp/routes` are stubs no screen calls.

---

## 7. Backend handoff

**Status: none of these five endpoints exists.** `api/src` has two controllers, `auth` and `health`. The readers behind three of these endpoints do exist, which is why the estimate is smaller than the list looks.

### 7.1 What is already built

| Piece | Where | Gives |
| --- | --- | --- |
| `BalanceRepository.getAvailableBalanceMinor(accountId)` | `api/src/ledger/` | `availableBalanceMinor` — the `SUM`, in cents, `COALESCE`d to 0 |
| `EscrowReadService.balanceOfCents(address)` | `api/src/chain/` | `settledFundsMinor` — a free `eth_call`, already in cents |
| `EscrowReadService.totalEscrowedCents()` | `api/src/chain/` | platform-wide escrow — **not** this account's, see assumption 3 |
| `LedgerEntry` entity | `api/src/entities/` | every field `GET /me/ledger` needs |

### 7.2 Assumptions this feature is built on

Each one is a place the frontend changes if the backend disagrees. Blast radius for 1–8 is `api/types.ts` plus `api/wallet.ts`.

1. **`GET /me`** returns `{ address, availableBalanceMinor, inEscrowMinor, settledFundsMinor }`, camelCase, all money in integer cents.
2. **`settledFundsMinor` is nullable, and the request succeeds when the chain read fails.** `balanceOfCents` throws `ChainError` when the RPC is unreachable; `/me` must catch it, log it, and return `null` for that one field. **This is the assumption most likely to be missed**, because the natural implementation lets the exception escape — and `/me` is polled every five seconds by every signed-in screen, so an escaping chain error takes the whole application's money display down. FR-008 and SC-012 exist for this case.
3. **`inEscrowMinor` is this account's escrowed money**, not the platform total. `totalEscrowedCents()` is the wrong reader for it; the figure comes from the account's unsettled orders.
4. **`GET /me/ledger`** returns this account's entries, newest first, as an array or a single-key envelope, each carrying `id`, `amountMinor` (signed), `kind`, `orderId`, `externalRef`, `createdAt`. No pagination expected at demo scale.
5. **`POST /topup { amountMinor }`** credits an `onramp` entry and answers only after it is committed — no pending state, nothing to poll for (api-design §4).
6. **`POST /withdraw`** takes no body and returns `{ txHash }` for the `withdrawFor` transaction. **Requested**: if the hash is available, send it — FR-030 shows it, and it is the one part of this screen a sceptic can verify. `null` is handled and degrades to a plain confirmation.
7. **`POST /offramp { amountMinor }`** debits an `offramp` entry and moves the money from the operator pool to the funder. If the endpoint only supports the full balance, say so and the amount field becomes read-only (R7).
8. **Refusals carry a readable `message`.** `client.ts` surfaces `message`, falling back to `code` then the status line. Insufficient balance, an amount below a minimum, a chain failure mid-withdrawal — each is shown verbatim to the person, so the wording is the backend's to get right.
9. **These three POSTs are not idempotent, and no idempotency key is expected.** If API-07 ever accepts one, the ambiguous branch in `WalletActions` and half of R8 can be deleted.
10. **The `$2` simulation minimum does not apply.** No Rain call is made (rain-integration §0.3); if the backend enforces a minimum anyway, it must be documented so the client can refuse before submitting rather than after.

### 7.3 What the frontend guarantees in return

- Never calls the escrow contract, reads chain state, or requests a wallet signature (FR-033). The settled figure is the demonstration of that boundary, not the exception to it.
- Never retries a money POST automatically (§3).
- Never sends an amount it has not parsed to integer cents, and never sends `0` or a negative (R6).
- Never displays `settledFundsMinor` as `0` unless the backend sent `0` (§2 of [data-model.md](../data-model.md)).
- Calls no `/routes` endpoint (FR-034).
