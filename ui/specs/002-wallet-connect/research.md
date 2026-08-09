# Phase 0 — Research: Wallet Connect & Session

**Feature**: 002-wallet-connect · **Date**: 2026-08-08

Twelve decisions. Versions and API surfaces below were checked against the npm registry and the published type definitions on 2026-08-08, not recalled.

---

## R1 — Dependency versions

**Decision**: `wagmi@3.7.6`, `viem@2.55.11`. Both as regular dependencies.

**Rationale**: The source spec sets a floor of viem ≥ 2.40.0 (Monad's stated minimum); 2.55.11 is current `latest` and clears it. wagmi's published peer requirements are `viem: 2.x`, `react: >=18`, `typescript: >=5.9.3`, `@tanstack/react-query: >=5.0.0` — the project satisfies all four already (React 19.2.8, TypeScript 5.9.3, react-query 5.101.4). The react-query dependency is the one UI-01 took on early precisely because wagmi would require it here; that call now pays off with no version negotiation.

**Alternatives considered**: RainbowKit or ConnectKit for a pre-built connect modal — rejected as a heavy dependency for a flow whose entire UI is a list of installed wallets. Raw viem with hand-rolled connector logic — rejected by the source spec, and correctly: connector lifecycle is exactly the kind of thing that costs hackathon hours for no demo value.

---

## R2 — wagmi v3 renamed the account hooks

**Decision**: Use `useConnection` and `useConnectionEffect`. Do not use `useAccount` / `useAccountEffect`.

**Rationale**: This is the non-obvious one, and every wagmi tutorial in existence gets it wrong for v3. Checking `wagmi@3.7.6/dist/types/exports/index.d.ts` directly:

```
/** @deprecated use `useConnection` instead */
useConnection as useAccount, useConnection

/** @deprecated use `useConnectionEffect` instead */
useConnectionEffect as useAccountEffect, useConnectionEffect
```

The old names still work — they are aliases, not removals — but writing new code against a deprecated alias on day one is a gratuitous cleanup task for whoever touches this next. `useConnect`, `useDisconnect`, `useSignMessage`, `useSwitchChain`, `useConnectors`, and `useChainId` are unrenamed.

**Consequence for review**: if you see `useAccount` in the diff, it came from a tutorial, not from this plan.

---

## R3 — The chain definition, and a discrepancy worth knowing about

**Decision**: Import viem's built-in `monadTestnet` and re-export it with the block explorer overridden to MonadVision. One module, `src/chain/chains.ts`, is the app's only chain definition (FR-027).

**Rationale**: viem 2.55.11 does ship `monadTestnet` (`viem/chains`), so `docs/project-structure.md` §5.1's "viem ≥ 2.40 may export it — use it if present" resolves to *yes, use it*. Its definition matches the project doc on everything that matters:

| Field | viem's built-in | `project-structure.md` §5.1 |
| --- | --- | --- |
| `id` | `10_143` | 10143 ✅ |
| `nativeCurrency` | `Testnet MON Token` / MON / 18 | MON / 18 ✅ |
| `rpcUrls.default` | `https://testnet-rpc.monad.xyz` | same ✅ |
| `blockExplorers.default` | **`Monad Testnet explorer` @ `testnet.monadexplorer.com`** | **`MonadVision` @ `testnet.monadvision.com`** ⚠️ |

Both explorer hosts are live, and `testnet.monadexplorer.com` redirects to `testnet.monadvision.com` — the project doc has the current brand and viem has the older host. Either would work, but UI-05 renders explorer links that a judge will click on stage, and a visible redirect hop plus a hostname that doesn't match what the UI says is a small avoidable wobble.

So: take viem's definition for the id, currency, RPC, multicall address and `testnet: true`, and override `blockExplorers.default` to MonadVision. Overriding rather than redefining means a future viem release that corrects the URL, adds contracts, or tunes `blockTime` flows through, and the delta stays one visible object.

**Alternatives considered**: define the chain locally from scratch per §5.1's snippet — works, but discards the multicall address and future upstream fixes for no gain. Use viem's unmodified — leaves the UI naming an explorer host it doesn't actually link to.

---

## R4 — Wallet choice comes from EIP-6963 discovery, not a hardcoded list

**Decision**: `createConfig({ multiInjectedProviderDiscovery: true, connectors: [injected()] })`, and render the connect screen from `useConnectors()`.

**Rationale**: FR-001 requires the visitor to choose among available wallets rather than having one picked implicitly, and the edge cases call out multiple extensions installed. EIP-6963 discovery — on by default in wagmi v3 and confirmed present in `CreateConfigParameters` — makes each announcing extension appear as its own connector with its own name and icon. That is the whole feature, for free. The explicit `injected()` entry is the fallback for a wallet that doesn't announce itself.

**Watch out**: a wallet that both announces via EIP-6963 *and* injects on `window.ethereum` can surface twice. The connect list should de-duplicate on connector `id` before rendering, or the user sees "MetaMask" twice and reasonably wonders which one is real.

**Alternatives considered**: hardcoding `injected()` alone and calling it done — one entry, no choice, and a second installed extension silently wins or loses depending on injection order.

---

## R5 — Identity is the token; the wallet connection is not identity

**Decision**: `AuthProvider` derives signed-in state from the stored credential alone. wagmi's connection state has no vote.

**Rationale**: This is the load-bearing decision of the feature, and it resolves FR-016 and Story 2 scenario 3 in one stroke. Two things persist across a reload, independently:

| | Persisted by | Restores | Means |
| --- | --- | --- | --- |
| `guardian.jwt` | our `session.ts` | synchronously | **who you are** |
| `wagmi.store` | wagmi's own storage + `reconnectOnMount` | asynchronously | which wallet is attached |

If signed-in state were derived from wagmi, a locked extension or a slow reconnect would sign the user out on every reload — which is precisely the demo stumble Story 2 exists to prevent. Deriving it from the credential makes a locked wallet a non-event, because nothing after sign-in needs the wallet at all: this feature requests exactly one signature, ever.

**Consequence for FR-015 ("resolving")**: reading `localStorage` is synchronous, so authentication state is known on the first render and the `resolving` value collapses to at most one tick. It stays in the type anyway — the route guard has to handle it, and if the token is ever validated against the backend on boot, the redirect race reappears the moment someone makes that change. One enum member is cheap insurance; a guard that assumes synchronous resolution is a landmine.

---

## R6 — Sign-in is one imperative async function, not an effect chain

**Decision**: A single `signIn()` in `useSignIn`, calling `connectAsync` → `requestNonce` → `signMessageAsync` → `verifySignature` → `writeSession`. No `useEffect` watching the address.

**Rationale**: The tutorial shape — connect, then an effect that fires when `address` becomes defined and kicks off signing — has two bugs this spec explicitly forbids:

- it fires again when the user switches accounts in the wallet, throwing an unrequested signature prompt at them (FR-018 says an account change ends the session, it does not silently re-sign);
- under `StrictMode` and on reconnect-after-reload it can fire when nobody asked to sign in.

An imperative sequence runs exactly when the button is pressed. `connectAsync` resolves with the accounts, so the address is in hand as a local value and never has to be observed. Concurrency (FR-011) becomes a single in-flight flag guarding the function's entry rather than a dependency-array puzzle.

**Alternatives considered**: the effect chain, as above. Also a state machine (XState or hand-rolled) — the flow has four steps and one failure branch per step; a machine would be more apparatus than flow.

---

## R7 — Wallet errors get the same treatment `ApiError` got

**Decision**: `src/chain/walletErrors.ts` maps anything thrown by wagmi/viem into a small discriminated union: `rejected` · `no-wallet` · `unsupported` · `unknown`.

**Rationale**: FR-009 requires four distinguishable outcomes: connection refused, signature refused, backend unreachable, backend rejected the signature. The backend half already exists — `ApiError` with `isConnectivityError` from UI-01 separates "couldn't reach it" from "it said no". The wallet half doesn't. viem throws `UserRejectedRequestError` (EIP-1193 code 4001) nested inside wrapper errors, so detection means `error.walk(e => e instanceof UserRejectedRequestError)` rather than an `instanceof` on the top-level throw — a `.code === 4001` check on the outer error silently misses it.

The reason this is one module rather than four `try/catch` blocks: a rejected signature is a *normal user choice*, and the copy for it ("you declined the signature — try again when ready") must not look like the copy for a crash. Centralising the classification is what keeps that consistent between the connect step and the sign step.

---

## R8 — Store the signing address next to the token

**Decision**: Extend `session.ts` with `guardian.address` written and cleared alongside `guardian.jwt`; expose `readSession()` / `writeSession()` / `clearSession()` while keeping the existing token functions.

**Rationale**: FR-018 requires ending the session when the wallet's active account changes to a *different* address — which requires knowing which address the session belongs to. Three sources were possible: decode it from the JWT, fetch `GET /me`, or store it. Decoding is out — `session.ts` documents the token as deliberately opaque, never decoded, and breaking that for a display string is a bad trade. `GET /me` is async and would make the header flicker on every load. Storing it is synchronous, survives reload, and doubles as the source for the abbreviated address in the header (FR-033).

The existing `readToken` / `writeToken` / `clearToken` stay exported: `client.ts` uses `readToken` and has no business knowing about addresses.

---

## R9 — Network switching, including adding the chain

**Decision**: `useSwitchChain().switchChainAsync({ chainId: monadTestnet.id })`. No hand-rolled `wallet_addEthereumChain`.

**Rationale**: FR-029 requires adding the network when the wallet doesn't know it. wagmi's injected connector already does this: on a `4902 Unrecognized chain ID` it falls back to `wallet_addEthereumChain`, built from the chain object in the config — which is why R3's single definition matters here too. Hand-rolling the add call would mean assembling the same parameters a second time and keeping them in sync.

A declined switch throws a user-rejection, classified by R7 and swallowed into "banner stays put" (FR-030). Nothing about the switch is allowed to break the current screen.

---

## R10 — The banner lives in the shell

**Decision**: `NetworkBanner` renders in `AppShell` between the header and `<Outlet/>`.

**Rationale**: FR-028 says every screen. The shell is already the thing that survives navigation without remounting — the same property that lets the balance widget keep polling across page changes. Putting the banner in each page would be eight copies and an inevitable ninth page that forgets.

It renders only when a wallet is connected *and* on the wrong chain: a signed-out visitor with no wallet attached has no network to be wrong about, and a banner there would be noise.

---

## R11 — Redirect destination rides on router state

**Decision**: `RequireAuth` renders `<Navigate to={paths.connect()} state={{ from: location }} replace />`; `ConnectPage` reads `location.state.from` after a successful sign-in and navigates there, defaulting to the marketplace.

**Rationale**: FR-022/FR-023. Router state rather than a query parameter keeps the entry screen's URL clean during a demo, and rather than module state because it must survive the redirect render. `replace` keeps the protected URL out of history, so browser-back from the connect screen doesn't bounce the user through the guard again.

The default destination is the marketplace, not the connect screen: sending a freshly signed-in user back to a connect button is a dead end.

---

## R12 — Provider order in `main.tsx`

**Decision**:

```
WagmiProvider (config, reconnectOnMount)
└─ QueryClientProvider          ← already there, must be inside Wagmi
   └─ BrowserRouter
      └─ AuthProvider
         └─ AppRoutes
```

**Rationale**: wagmi's hooks use react-query internally, so `WagmiProvider` must be the outer of the two — this ordering is a wagmi requirement, not a preference. `AuthProvider` goes inside `BrowserRouter` so that anything auth-related can navigate later without a second reshuffle; it does not navigate today (the shell's existing `guardian:unauthenticated` listener still owns that, per FR-017).

`main.tsx`'s existing dynamic-import bootstrap stays exactly as it is — the wagmi config imports `config.ts` transitively for nothing, but the fail-loud-on-bad-configuration behaviour it protects is worth more than the tidiness of a static import.

---

## Resolved unknowns

Every `NEEDS CLARIFICATION` from Technical Context is closed above. Nothing in this feature is blocked on an answer from outside the repo, with one dependency noted for the record: the exact JSON field names of `/auth/nonce` and `/auth/verify` are documented by meaning in `docs/api-design.md` §3.1 but not by casing. `src/api/types.ts` already carries that caveat for `AccountSummary`, and the same containment applies — if API-01 lands different names, one file changes.
