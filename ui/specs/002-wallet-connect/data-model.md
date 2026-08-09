# Phase 1 — Data Model: Wallet Connect & Session

**Feature**: 002-wallet-connect · **Date**: 2026-08-08

Client-side types only. This feature persists nothing server-side and owns no database.

---

## 1. Persisted state

Two independent stores survive a page reload. Keeping them separate is the point (research R5) — conflating them is what makes a locked wallet look like a signed-out user.

| Key | Owner | Written by | Cleared by | Meaning |
| --- | --- | --- | --- | --- |
| `guardian.jwt` | `src/api/session.ts` | this feature, after verify | disconnect · 401 · account change | **Identity.** Opaque; never decoded, never checked for expiry locally. |
| `guardian.address` | `src/api/session.ts` | this feature, after verify | same three | Which address the credential belongs to. Display + account-change comparison. |
| `wagmi.store` | wagmi | wagmi | wagmi (`disconnect`) | Which wallet is attached. **Not identity.** |

`guardian.jwt` and `guardian.address` are written and cleared together, always. A token without its address is a bug — the header would have nothing to show and FR-018's comparison would have nothing to compare.

---

## 2. Types

### `StoredSession` — `src/api/session.ts`

```
StoredSession {
  token:   string       // opaque credential
  address: Address      // the address that signed
}
```

`readSession(): StoredSession | null` returns `null` unless **both** keys are present — a half-written pair (storage evicted one, or an interrupted write) is treated as no session rather than as a session with a hole in it.

The existing `readToken` / `writeToken` / `clearToken` remain exported unchanged. `client.ts` uses `readToken` and must stay ignorant of addresses.

### `AuthState` — `src/auth/AuthContext.tsx`

A discriminated union, so a component that renders an address cannot be reached without one:

```
AuthState =
  | { status: 'resolving' }
  | { status: 'signed-out' }
  | { status: 'signed-in', address: Address }
```

**Transitions** — the complete set. Anything not listed here does not change auth state:

| From | Event | To | Requirement |
| --- | --- | --- | --- |
| `resolving` | boot, stored session found | `signed-in` | FR-013 |
| `resolving` | boot, no stored session | `signed-out` | FR-014 |
| `signed-out` | verify succeeded | `signed-in` | FR-007 |
| `signed-in` | user activated disconnect | `signed-out` | FR-025 |
| `signed-in` | `guardian:unauthenticated` fired | `signed-out` | FR-017 |
| `signed-in` | wallet's active account ≠ session address | `signed-out` | FR-018 |
| `signed-in` | wallet reported site disconnected | `signed-out` | FR-019 |

Notably **absent**: wallet locked, wallet reconnecting, wrong network. None of them touch auth state (FR-016, FR-031).

`resolving` is reachable for at most one render tick, because the store read is synchronous. It exists so `RequireAuth` is written correctly for the day someone validates the token against the backend on boot — see research R5.

### `SignInPhase` — `src/auth/useSignIn.ts`

What the connect screen shows while the flow runs. Ordered; each value names the step in progress:

```
SignInPhase = 'idle' | 'connecting' | 'requesting-nonce' | 'awaiting-signature' | 'verifying'
```

Any phase other than `idle` blocks re-entry (FR-011). `awaiting-signature` is the one worth surfacing in copy — it is the phase where the user has to go look at their extension popup.

### `SignInFailure` — `src/auth/useSignIn.ts`

The four outcomes FR-009 requires, plus the ones that don't fit:

```
SignInFailure {
  kind:    'wallet-rejected' | 'no-wallet' | 'backend-unreachable'
         | 'signature-refused' | 'wallet-error'
  message: string      // shown to the user, plain language
}
```

- `wallet-rejected` — connection prompt declined.
- `signature-refused` — signature prompt declined or dismissed. Distinct from the above because it happens a step later and the retry means something different.
- `backend-unreachable` — from `isConnectivityError(ApiError)`; the nonce or verify call never got an answer.
- `wallet-error` — anything else from the wallet, including a rejected signature *verification* (an `ApiError` of kind `http`, message taken from the backend).
- `no-wallet` — no connector available at all; the connect screen shows this before offering a control (FR-005).

None of these are thrown. `signIn()` resolves with `{ ok: true }` or `{ ok: false, failure }` — an exception escaping into a click handler is how a rejected signature ends up in the console looking like a crash.

### `WalletErrorKind` — `src/chain/walletErrors.ts`

```
WalletErrorKind = 'rejected' | 'no-wallet' | 'unsupported' | 'unknown'
```

Classified by walking the viem error chain for `UserRejectedRequestError` rather than reading `.code` off the outer error (research R7).

---

## 3. Chain

### `monadTestnet` — `src/chain/chains.ts`

The app's single chain definition (FR-027). viem's built-in, with one field replaced:

| Field | Value | Source |
| --- | --- | --- |
| `id` | `10143` | viem |
| `name` | `Monad Testnet` | viem |
| `nativeCurrency` | Testnet MON Token / MON / 18 | viem |
| `rpcUrls.default.http` | `https://testnet-rpc.monad.xyz` | viem |
| `contracts.multicall3` | `0xcA11bde…76CA11` | viem |
| `testnet` | `true` | viem |
| **`blockExplorers.default`** | **MonadVision · `https://testnet.monadvision.com`** | **overridden** — see research R3 |

UI-05's transaction links come from this object's `blockExplorers.default.url`. Nothing else in the frontend may name an explorer host.

---

## 4. API payloads — `src/api/types.ts` (extended)

Per `docs/api-design.md` §3.1:

```
NonceRequest    { address: Address }
NonceResponse   { nonce: string }

VerifyRequest   { address: Address, signature: Hex }
VerifyResponse  { token: string }
```

**The message signed is the `nonce` value verbatim**, as a personal message. The verify payload carries no message field, so the backend must reconstruct what it issued — there is nowhere for a structured sign-in message to travel. Recorded as an assumption in the spec, and confined to one line of `useSignIn` if the backend later adopts a different format.

Field casing carries the same caveat as `AccountSummary` already does in that file: the meanings are documented, the exact JSON keys are not. One file changes if API-01 lands something different.

---

## 5. Route access

Not a runtime entity — a table the route tree encodes. Listed here because it is the feature's actual access-control policy and belongs somewhere reviewable.

| Path | Access | Why |
| --- | --- | --- |
| `/` | public | The connect screen itself. |
| `/agents` | public | `GET /agents` is public in `api-design.md` §3.3. |
| `/agents/:id` | public | `GET /agents/:id` is public, listing fields only. |
| `/orders` | **guarded** | Your orders. |
| `/orders/:id` | **guarded** | Your order. |
| `/wallet` | **guarded** | Your money. |
| `/sell` | **guarded** | Your listings. |
| `/sell/new` | **guarded** | Creates something owned by you. |
| `*` | public | Not-found needs no session. |

Guarding the catalogue would contradict the backend and make the product feel closed for no reason (FR-021).
