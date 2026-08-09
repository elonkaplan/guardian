# Phase 1 — Internal contracts: Wallet Connect & Session

**Feature**: 002-wallet-connect · **Date**: 2026-08-08

The module surface this feature adds, and the surface it changes. UI-03 through UI-07 build on both. Companion to [`../../001-ui-foundation/contracts/internal-api.md`](../../001-ui-foundation/contracts/internal-api.md), which this extends rather than replaces.

---

## 1. `src/auth/AuthContext.tsx` — the one answer to "who is signed in?"

```ts
type AuthState =
  | { status: 'resolving' }
  | { status: 'signed-out' }
  | { status: 'signed-in'; address: Address };

interface AuthContextValue {
  state: AuthState;
  /** Convenience, equivalent to state.status === 'signed-in'. */
  isSignedIn: boolean;
  /** Called by useSignIn after a successful verify. Persists and transitions. */
  onSignedIn(session: StoredSession): void;
  /** Disconnect: clears the credential and releases the wallet. FR-024, FR-025. */
  signOut(): void;
}

function AuthProvider(props: { children: ReactNode }): JSX.Element;
function useAuth(): AuthContextValue;
```

**Rules for callers**

| Rule | Why |
| --- | --- |
| No component reads `localStorage`, `readSession`, or `readToken` to decide what to render. | FR-014. Storage is not reactive; a component that reads it directly will not re-render on sign-out. `BalanceWidget`'s `useHasSession` is the existing instance of this and is removed by this feature. |
| No component derives signed-in state from `useConnection()`. | FR-016. A locked wallet is not a signed-out user (research R5). |
| `signOut()` is the only way to end a session from the UI. | It must clear storage *and* call wagmi's `disconnect`; doing one without the other leaves a half-state. |

`AuthProvider` owns the three involuntary sign-outs — the `guardian:unauthenticated` listener (FR-017), the account-change comparison (FR-018), and wallet disconnection (FR-019) — so no screen has to.

---

## 2. `src/auth/useSignIn.ts` — the flow, in one place

```ts
type SignInPhase =
  | 'idle' | 'connecting' | 'requesting-nonce'
  | 'awaiting-signature' | 'verifying';

interface SignInFailure {
  kind: 'wallet-rejected' | 'signature-refused' | 'no-wallet'
      | 'backend-unreachable' | 'wallet-error';
  message: string;
}

interface UseSignInResult {
  phase: SignInPhase;
  failure: SignInFailure | null;
  /** Available connectors, de-duplicated by id. Empty means no wallet. FR-001, FR-005. */
  connectors: readonly Connector[];
  /** Resolves; never rejects. Re-entry while phase !== 'idle' is a no-op. FR-011. */
  signIn(connector: Connector): Promise<{ ok: boolean }>;
  /** Clears `failure` so the screen can be retried without a reload. FR-009. */
  reset(): void;
}

function useSignIn(): UseSignInResult;
```

**The sequence**, imperative and in this order (research R6):

```
connectAsync({ connector })        → address        phase: connecting
POST /auth/nonce { address }       → nonce          phase: requesting-nonce
signMessageAsync({ message: nonce })→ signature     phase: awaiting-signature
POST /auth/verify { address, signature } → token    phase: verifying
onSignedIn({ token, address })                      phase: idle, ok
```

**Invariants**

- `signIn` **never rejects.** A promise rejection reaching a click handler is how a declined signature ends up in the console styled like a crash.
- Every failure path leaves no stored credential and no partial state (FR-010). `phase` returns to `idle`.
- Each call obtains a fresh nonce; nonces are never cached across attempts (FR-012).
- There is **no `useEffect` watching `address`.** An account switch must not trigger a signature prompt (FR-018).
- `signMessageAsync` is the only signing call in the application. Adding a second one is out of scope by FR-003 and should fail review.

---

## 3. `src/api/auth.ts` — two endpoint wrappers

```ts
function requestNonce(address: Address): Promise<NonceResponse>;   // POST /auth/nonce
function verifySignature(
  address: Address, signature: Hex,
): Promise<VerifyResponse>;                                        // POST /auth/verify
```

Both go through `apiPost` and therefore inherit the base URL, the timeout, and `ApiError` normalisation. Neither attaches a credential of its own — `client.ts` adds one only if it happens to exist, which is harmless here.

---

## 4. `src/api/session.ts` — extended, not replaced

**Added:**

```ts
interface StoredSession { token: string; address: Address }

function readSession(): StoredSession | null;   // null unless BOTH keys present
function writeSession(session: StoredSession): void;
function clearSession(): void;                  // clears both keys
```

**Unchanged and still exported:** `readToken`, `writeToken`, `clearToken`, `UNAUTHENTICATED_EVENT`. `client.ts` continues to use `readToken` and must not learn about addresses.

The existing module comment says "UI-02 is the only caller of `writeToken`, after signature verification." That prediction is now `writeSession`; update the comment rather than leaving it pointing at the wrong function.

---

## 5. `src/chain/chains.ts` — the single chain definition

```ts
export const monadTestnet: Chain;   // viem's, with MonadVision as the explorer
export function explorerTxUrl(hash: Hex): string;
export function explorerAddressUrl(address: Address): string;
```

**UI-05 will link transaction hashes to the explorer. Those links come from here.** No other module may name an explorer host — that is what makes FR-027's "one place" true rather than aspirational. The helpers exist now, unused by this feature, precisely so the next feature has somewhere obvious to reach for; two lines is a cheap alternative to a hardcoded URL appearing in a page component.

---

## 6. `src/chain/wagmi.ts` — the wagmi config

```ts
export const wagmiConfig: Config;
```

```
chains:                        [monadTestnet]
transports:                    { [monadTestnet.id]: http() }
connectors:                    [injected()]
multiInjectedProviderDiscovery: true      // EIP-6963; gives per-wallet choice
storage:                       default (localStorage, key `wagmi.store`)
```

`transports` is required by `createConfig`'s types even though this feature performs no chain reads. One `http()` satisfies it. **It must not grow into a read path** — the frontend never calls the escrow contract (FR-003), and a configured transport is the most natural place for that rule to start eroding.

---

## 7. `src/chain/walletErrors.ts`

```ts
type WalletErrorKind = 'rejected' | 'no-wallet' | 'unsupported' | 'unknown';

function classifyWalletError(error: unknown): WalletErrorKind;
function walletErrorMessage(kind: WalletErrorKind, step: 'connect' | 'sign' | 'switch'): string;
```

`rejected` is detected by walking the viem error chain for `UserRejectedRequestError`, **not** by reading `.code === 4001` off the outer error — viem wraps, and the outer error does not carry the code (research R7).

`walletErrorMessage` takes the step because "you declined the connection", "you declined the signature", and "you declined the network switch" are three different sentences, and only one of them should ever appear at a time.

---

## 8. `src/components/RequireAuth.tsx`

```tsx
function RequireAuth(props: { children: ReactNode }): JSX.Element;
```

| Auth state | Renders |
| --- | --- |
| `resolving` | A resolving placeholder. **Never a redirect** (FR-015). |
| `signed-out` | `<Navigate to={paths.connect()} state={{ from: location }} replace />` |
| `signed-in` | `props.children` |

Applied in `AppRoutes` to the five guarded paths in [`../data-model.md`](../data-model.md) §5. `replace` keeps the protected URL out of history so browser-back does not re-trigger the guard.

---

## 9. `src/components/NetworkBanner.tsx`

Renders in `AppShell`, between the header and `<Outlet/>` — every screen, one copy (FR-028, research R10).

**Visible only when** a wallet is connected **and** `chainId !== monadTestnet.id`. A signed-out visitor with no wallet attached has no network to be wrong about.

Names both networks, offers a switch calling `switchChainAsync({ chainId: monadTestnet.id })`. wagmi's injected connector falls back to `wallet_addEthereumChain` on an unrecognised chain, so FR-029 needs no hand-rolled add call. A declined switch leaves the banner in place and must not break the screen (FR-030) — the switch handler catches, classifies via §7, and does nothing dramatic.

**The banner never blocks.** No overlay, no disabled controls, no early return from the shell. Wrong network warns; it does not gate (FR-031).

---

## 10. `src/components/WalletMenu.tsx`

Signed in: the abbreviated address (`0x1234…abcd`) and a disconnect control, in the header, on every screen (FR-024, FR-033). Signed out: renders nothing — `BalanceWidget` already owns the sign-in affordance and two of them side by side would be noise.

---

## 11. Changes to existing modules

| File | Change | Requirement |
| --- | --- | --- |
| `src/main.tsx` | Wrap in `WagmiProvider` (outside `QueryClientProvider` — wagmi's hooks use react-query internally); add `AuthProvider` inside `BrowserRouter`. Keep the dynamic-import bootstrap. | research R12 |
| `src/components/AppShell.tsx` | Add `NetworkBanner` and `WalletMenu`. Keep the existing `guardian:unauthenticated` listener — it still owns the navigation half of FR-017 while `AuthProvider` owns the state half. | FR-017, FR-028, FR-033 |
| `src/components/BalanceWidget.tsx` | **Delete the local `useHasSession` hook**; use `useAuth().isSignedIn`. Its own comment says it is a stand-in "until UI-02 owns real session state". | FR-014, FR-034 |
| `src/routes/AppRoutes.tsx` | Wrap the five guarded routes in `RequireAuth`. | FR-020, FR-021 |
| `src/pages/ConnectPage.tsx` | Replace the placeholder with the connect flow. Keep the health indicator — sign-in has a backend dependency and a failed rehearsal should be diagnosable at a glance. | FR-001, FR-005, FR-009, FR-023 |
| `src/api/types.ts` | Add `NonceRequest`/`NonceResponse`/`VerifyRequest`/`VerifyResponse`. | §4 above |
| `package.json` | Add `wagmi@^3.7.6`, `viem@^2.55.11`. | research R1 |

---

## 12. Two rules that outlive this feature

1. **`signMessageAsync` appears exactly once in the codebase**, in `useSignIn`. The wallet signs the auth nonce and nothing else; every chain write goes through the operator, server-side. A second signing call, or any `useWriteContract` / `sendTransaction`, contradicts FR-003 and `docs/CONTEXT.md` §2.
2. **Explorer URLs come from `src/chain/chains.ts`.** A hardcoded `testnet.monadvision.com` in a page component is the failure mode FR-027 exists to prevent — and given viem's built-in definition points at the older host (research R3), a second hardcoded copy would eventually disagree with the first.
