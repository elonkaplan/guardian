# Contract: Internal Module Surface

**Feature**: `001-ui-foundation` · **Date**: 2026-08-08

This feature exposes no public API to the outside world. Its contract is **inward-facing**: the module surface that UI-02 through UI-07 will build on. These signatures are the reason this feature exists, so they are specified here rather than left to implementation.

Everything below lives under `ui/src/`.

---

## 1. `api/client.ts` — the only way out of the app

```ts
export function apiGet<T>(path: string, init?: RequestInit): Promise<T>;
export function apiPost<T>(path: string, body?: unknown, init?: RequestInit): Promise<T>;
export function apiPatch<T>(path: string, body?: unknown, init?: RequestInit): Promise<T>;
export function checkHealth(): Promise<{ reachable: boolean; status: number }>;
```

**Guarantees**

| | |
| --- | --- |
| Base URL | `config.apiUrl` is prepended to `path`. Callers pass `/orders/123`, never a full URL. |
| Credential | `Authorization: Bearer <token>` attached when `readToken()` returns non-null; omitted otherwise (FR-008). |
| Timeout | 10 s via `AbortSignal.timeout()`, overridable through `init.signal`. |
| Success | Resolves with the parsed body typed as `T`. |
| Failure | **Rejects with an `ApiError`, always** — never a raw `TypeError`, `SyntaxError`, or `Response` (FR-010). |
| 401 | Clears the stored token and dispatches `guardian:unauthenticated` on `window` before rejecting (FR-011). |

**Rule for every later feature**: no screen calls `fetch` directly. Screens that need a new endpoint add a typed wrapper in `api/`, and get credential handling, timeouts, and error normalisation for free. This is what SC-010 measures.

`checkHealth()` reports `reachable: true` for **any** HTTP response including 4xx and 5xx; only network and timeout failures report `false` (see research R6).

---

## 2. `api/errors.ts`

```ts
export type ApiErrorKind = 'http' | 'network' | 'timeout' | 'parse';

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly status: number;   // real status for 'http' | 'parse'; 0 otherwise
  readonly code: string;
  readonly details?: unknown;
}

export function isApiError(e: unknown): e is ApiError;
export function isConnectivityError(e: unknown): boolean;  // kind !== 'http'
```

`isConnectivityError` is the helper FR-010 requires — it is the difference a screen needs between "the backend said no" and "the backend didn't answer", and giving it a name stops seven features from each re-deriving the check.

---

## 3. `api/session.ts`

```ts
export function readToken(): string | null;
export function writeToken(token: string): void;   // UI-02 is the only caller
export function clearToken(): void;
export const UNAUTHENTICATED_EVENT = 'guardian:unauthenticated';
```

---

## 4. `hooks/usePolling.ts` — the shared refresh mechanism

```ts
export interface PollingOptions<T> {
  intervalMs: number;
  isTerminal?: (data: T) => boolean;   // omitted ⇒ polls forever
  enabled?: boolean;                   // default true
}

export interface PollingResult<T> {
  data: T | undefined;
  error: ApiError | null;
  isPolling: boolean;
  refetch: () => void;
}

export function usePolling<T>(
  key: readonly unknown[],
  fetcher: () => Promise<T>,
  options: PollingOptions<T>,
): PollingResult<T>;
```

**Behavioural contract** — each line maps to a requirement:

1. Fetches once immediately on mount, then every `intervalMs` (FR-015).
2. Stops permanently the first time `isTerminal(data)` returns true, **including on the first fetch** (FR-016).
3. Never runs overlapping requests; the next tick is scheduled after the current request settles (FR-018).
4. On unmount: no scheduled timer survives, no state update is attempted (FR-017).
5. A failed fetch is exposed via `error` and retried on the next tick — it does **not** stop the poll (FR-019).
6. Without `isTerminal`, polls until unmount (FR-020).

**Known callers** (why the signature is shaped this way):

| Feature | Interval | `isTerminal` |
| --- | --- | --- |
| UI-04 Order Detail | 1000 ms | `o => o.state === 'released' \|\| o.state === 'settled'` |
| UI-06 Wallet | 5000 ms | — |
| UI-04 My Orders | 5000 ms | — |
| UI-01 header widget | 5000 ms | — |

The `enabled` flag exists for the header widget, which must not poll while no user is signed in.

---

## 5. `routes/paths.ts`

```ts
export const paths = {
  connect:      () => '/',
  marketplace:  () => '/agents',
  agentDetail:  (id: string) => `/agents/${id}`,
  orders:       () => '/orders',
  orderDetail:  (id: string) => `/orders/${id}`,
  wallet:       () => '/wallet',
  sell:         () => '/sell',
  createAgent:  () => '/sell/new',
} as const;
```

Link targets come from here. No later feature writes a route string inline.

---

## 6. `lib/money.ts`

```ts
export type Cents = number;
export function formatUsd(cents: Cents): string;   // 200 → "$2.00"
```

Integer cents in, display string out (`docs/database-schema.md` §1.3). The UI performs no arithmetic on money beyond what this function does, and never sees token base units.

---

## 7. Consumed backend endpoints

Only two, both read-only:

| Method | Path | Used by | Notes |
| --- | --- | --- | --- |
| `GET` | `/health` | `checkHealth()` | Any response ⇒ reachable. Tolerates absence. |
| `GET` | `/me` | header balance widget | `{ address, availableBalanceMinor, inEscrowMinor }` — field names provisional, see data-model §4 |

Every other endpoint in `docs/api-design.md` §3 is introduced by the feature that needs it.
