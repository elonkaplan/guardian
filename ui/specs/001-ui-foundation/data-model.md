# Phase 1 Data Model: UI Foundation

**Feature**: `001-ui-foundation` · **Date**: 2026-08-08

This feature owns no persistent data. What follows are the client-side types that later features code against — the shapes that, once wrong, are expensive to change because seven specs depend on them.

Money is always an **integer of USD cents** (`docs/database-schema.md` §1.3). `type Cents = number`.

---

## 1. Configuration — `src/config.ts`

| Field | Type | Source | Validation |
| --- | --- | --- | --- |
| `apiUrl` | `string` | `import.meta.env.VITE_API_URL` | Non-empty, parses as a URL, trailing slash stripped. Throws `ConfigError` naming the variable if absent (FR-006). |

Validated once at module load, before React mounts, so a misconfigured start fails immediately and loudly rather than producing a screen full of "not found" errors against the wrong origin.

No other variable is read by this feature. Anything added later must carry the `VITE_` prefix (R10).

---

## 2. Normalised error — `src/api/errors.ts`

```
ApiError {
  kind:    'http' | 'network' | 'timeout' | 'parse'
  status:  number        // real HTTP status for 'http' and 'parse'; 0 otherwise
  code:    string        // backend's code when present, else a local constant
  message: string        // safe to display
  details?: unknown      // backend body, when it parsed
}
```

**Rules**

- Every failure of every call produces one of these. No caller sees a raw `TypeError` from `fetch` or a `SyntaxError` from JSON parsing (FR-010).
- `kind === 'http'` means the backend understood the request and refused it; anything else means we never got a usable answer. That distinction is what FR-010 requires callers to be able to make, and it is the difference between "you can't do that" and "something is wrong with the connection". Note `parse` falls on the connectivity side even though the server did respond — a body a screen cannot read is the same broken pipe as no body at all.
- `message` is always populated, including when the backend sends an empty body. Screens may render it directly.
- Local codes when the backend supplies none: `NETWORK_ERROR`, `TIMEOUT`, `PARSE_ERROR`, `HTTP_<status>`.

**Not modelled**: retry counts, correlation IDs, i18n keys. None have a consumer in this build.

---

## 3. Session credential — `src/api/session.ts`

| Field | Type | Notes |
| --- | --- | --- |
| storage key | `'guardian.jwt'` | `localStorage` (R7) |
| token | `string \| null` | Opaque to this feature — not decoded, not validated locally |

**Operations**: `readToken()`, `writeToken(t)`, `clearToken()`.

**Lifecycle in this feature**: read on every request (FR-008), cleared on a 401 (FR-011). Written by UI-02 after signature verification — nothing in UI-01 writes it, and that is expected, not a gap.

**Deliberately not decoded.** Expiry is discovered by the backend rejecting a request, not by the client inspecting claims. One source of truth, and no clock-skew bug on a demo laptop.

---

## 4. Account summary — `src/api/types.ts`

The only backend payload this feature consumes beyond the health check. From `GET /me` (`docs/api-design.md` §3.2):

| Field | Type | Meaning |
| --- | --- | --- |
| `address` | `string` | The user's wallet address |
| `availableBalanceMinor` | `Cents` | Spendable platform balance — the ledger `SUM` |
| `inEscrowMinor` | `Cents` | Locked in unsettled orders |

**Two figures, never summed.** They are different money in different places with different exits (`docs/database-schema.md` §3.3). The header renders both, labelled (FR-021).

**Not here**: *settled funds* (on-chain `balances[]`). Those belong to the Wallet screen in UI-06, which reads them from a different source and withdraws them by a different route. Putting them in the header would require a second data source this feature has no reason to open.

> **Field names are provisional.** They follow the API's documented meaning but the exact JSON casing isn't fixed in `api-design.md`. If API-01 lands different names, the correction is confined to `src/api/types.ts` and the one component that reads it.

---

## 5. Poll state — `src/hooks/usePolling.ts`

Not a payload; the observable state of a refresh subscription (FR-014…FR-020).

| Field | Type | Meaning |
| --- | --- | --- |
| `data` | `T \| undefined` | Latest successful result |
| `error` | `ApiError \| null` | Last failure; cleared by the next success |
| `isPolling` | `boolean` | `false` once the terminal rule matched, or once unmounted |
| `refetch` | `() => void` | Manual refresh, e.g. after a user action mutates state |

**Inputs**: a query key, a fetcher, `intervalMs`, and an optional `isTerminal: (data: T) => boolean`.

**State transitions**

```
        mount
          │  fetch immediately
          ▼
      ┌────────┐  success, !isTerminal   ┌────────┐
      │ POLLING│ ───────────────────────▶│ POLLING│  (waits intervalMs, never overlaps)
      └────────┘                         └────────┘
          │  success, isTerminal(data)         │  failure
          ▼                                    ▼
      ┌────────┐                          ┌────────┐
      │ STOPPED│  no further requests     │ POLLING│  error exposed, retried next tick
      └────────┘                          └────────┘

      unmount, from any state ──▶ STOPPED, in-flight result discarded
```

Two transitions carry the weight: **`isTerminal` is evaluated on the first fetch too**, so an order that is already settled when the page opens never schedules a second request (FR-016); and **failure does not stop the poll** (FR-019), because a backend blip mid-demo must not permanently freeze the hero page.

Omitting `isTerminal` means the subscription never stops on its own — the Wallet and My Orders case (FR-020).

---

## 6. Route table — `src/routes/paths.ts`

Path builders, not string literals. Seven later features link to these.

| Name | Path | Param |
| --- | --- | --- |
| `connect` | `/` | — |
| `marketplace` | `/agents` | — |
| `agentDetail` | `/agents/:id` | `id: string` |
| `orders` | `/orders` | — |
| `orderDetail` | `/orders/:id` | `id: string` |
| `wallet` | `/wallet` | — |
| `sell` | `/sell` | — |
| `createAgent` | `/sell/new` | — |

Fixed by `docs/ui-design.md` §2. Parameterised routes export a builder (`orderDetail(id)`) so no later feature hand-writes a template literal.

**Ordering note**: `/sell/new` must be declared before `/sell/:id` if a seller-detail route is ever added, and `/orders` must not be shadowed by `/orders/:id`. React Router v7's ranked matching handles both, but the constraint is worth recording since UI-07 will touch this file.
