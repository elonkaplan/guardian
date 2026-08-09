# Implementation Plan: Wallet Connect & Session

**Branch**: `002-wallet-connect` | **Date**: 2026-08-08 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/002-wallet-connect/spec.md`

## Summary

Turn the entry screen into the product's entire registration flow — connect a wallet, sign one nonce, get a session — and give the rest of the app the two things UI-01 deliberately left as seams: a reactive answer to "who is signed in?" and a rule about which screens require one.

The technical approach is wagmi 3.7.6 over viem 2.55.11, an `AuthProvider` whose state derives from the stored credential rather than from the wallet connection, and a single imperative `signIn()` function rather than an effect chain. Those last two are the decisions a reviewer should challenge; both are in Key Decisions below.

Roughly a dozen new files under `src/chain/`, `src/auth/`, and `src/components/`, plus seven edits to existing modules. `src/chain/` is the directory UI-01 pointedly did *not* create — it exists now because wagmi and viem have arrived.

## Technical Context

**Language/Version**: TypeScript 5.9.3, unchanged strict settings. Note that `wagmi@3` declares `typescript: >=5.9.3` as a peer — the project is exactly at the floor, so a TypeScript downgrade is now a breaking change rather than a preference.

**Primary Dependencies**: **New** — `wagmi@^3.7.6`, `viem@^2.55.11`. **Existing** — React 19.2.8, react-router-dom 7.18.2, @tanstack/react-query 5.101.4 (already a wagmi peer requirement; UI-01 took it on early for exactly this).

**Storage**: `localStorage`, three keys. `guardian.jwt` and `guardian.address` are ours and written together; `wagmi.store` is wagmi's. The first two are identity; the third is not (research R5).

**Testing**: **None.** No unit, integration, or e2e tests — an explicit project decision (`ui/docs/CONTEXT.md`), restated as FR-035. Acceptance is by hand via [quickstart.md](./quickstart.md), whose Part F is the boundary check that matters most.

**Target Platform**: Desktop Chrome on a demo laptop, with a browser wallet extension installed. No mobile, no WalletConnect, no hardware wallets.

**Performance Goals**: Sign-in completes in under 30 seconds of wall time including two human approvals (SC-001). Reload restores the signed-in state within one render tick, with no visible flash of the connect screen (SC-003) — which is what forces the credential read to be synchronous.

**Constraints**: The wallet signs **exactly one thing**, the auth nonce. No transaction signing, no contract calls, no key handling — every chain write goes through the operator, server-side. Only `VITE_`-prefixed variables reach the bundle; this feature adds none. viem ≥ 2.40.0.

**Scale/Scope**: 12 new files, 7 edited, 2 backend endpoints consumed, 2 dependencies added. One developer, hours not days.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

**Status: NOT EVALUATED — no ratified constitution exists.**

`.specify/memory/constitution.md` is still the unmodified Spec Kit template: every principle reads `[PRINCIPLE_N_NAME]` and the version reads `[CONSTITUTION_VERSION]`. There are no gates to check against, so this section cannot honestly pass or fail.

UI-01's plan flagged this and said the moment to fix it was before UI-02. That moment is now, and it is passing unused. The concrete cost is visible in this feature: the two rules in [contracts/internal-api.md](./contracts/internal-api.md) §12 — one signing call, one explorer host — are enforceable only by review and by the `grep` checks in quickstart Part F. A constitution would make them a gate. This is a judgement call rather than a blocker, and the greps are a real (if manual) substitute, but recording it plainly beats stamping a vacuous ✅ twice in a row.

**Post-Phase 1 re-check**: unchanged. No constitution was added during planning.

## Key Decisions

Full reasoning in [research.md](./research.md). The four a reviewer should push on:

| Decision | Why | Reversibility |
| --- | --- | --- |
| **Auth state derives from the stored credential, never from wagmi's connection state** (R5) | Two things persist across a reload, independently: our JWT (synchronous) and wagmi's wallet connection (asynchronous, `reconnectOnMount`). Deriving identity from the wallet means a locked extension signs the user out on every reload — the exact demo stumble Story 2 exists to prevent. Nothing after sign-in needs the wallet: this feature requests one signature, ever. | Structural. Reversing it means rewriting `AuthProvider` and re-litigating Story 2. |
| **Sign-in is one imperative `async` function, not an effect watching `address`** (R6) | The tutorial shape fires a signature prompt when the user switches accounts — but FR-018 says an account change *ends* the session, it does not silently re-sign. `connectAsync` resolves with the address, so it never has to be observed. Concurrency (FR-011) becomes one in-flight flag instead of a dependency-array puzzle. | Localised to `useSignIn`; the hook's surface would not change. Quickstart D4 is the test that catches a regression. |
| **`useConnection` / `useConnectionEffect`, not `useAccount` / `useAccountEffect`** (R2) | wagmi v3 renamed them; the old names survive as `@deprecated` aliases. Verified against `wagmi@3.7.6`'s published type definitions, not recalled — every tutorial online still shows the v2 names. | One rename. But writing deprecated code on day one is a gratuitous cleanup for whoever comes next. |
| **viem's built-in `monadTestnet`, with the explorer overridden** (R3) | viem 2.55.11 does ship it, and it agrees with `project-structure.md` §5.1 on chain id, currency, RPC, and adds a multicall address. It disagrees on one field: viem says `testnet.monadexplorer.com`, the project doc says MonadVision. Both hosts are live and the former redirects to the latter — the project doc has the current brand. UI-05 puts these links in front of a judge, so take the override. | One object literal in `src/chain/chains.ts`. |

**No spec corrections were needed during planning.** The three judgement calls flagged when the spec was written — the signed message is the raw nonce, wrong network warns rather than blocks, and the catalogue stays public — all survived contact with the API surface unchanged.

## Project Structure

### Documentation (this feature)

```text
specs/002-wallet-connect/
├── plan.md              # This file
├── spec.md              # Feature specification
├── research.md          # Phase 0 — 12 resolved decisions
├── data-model.md        # Phase 1 — client-side types, storage, route access
├── quickstart.md        # Phase 1 — the manual acceptance run (Parts A–F)
├── contracts/
│   └── internal-api.md  # Phase 1 — module surface UI-03…UI-07 build on
├── checklists/
│   └── requirements.md  # Spec quality checklist
└── tasks.md             # Phase 2 — created by /speckit-tasks, not here
```

### Source Code (repository root)

```text
ui/src/
├── chain/                          NEW — the directory UI-01 declined to create
│   ├── chains.ts                   monadTestnet + explorer URL helpers (FR-027)
│   ├── wagmi.ts                    createConfig: chain, connectors, transport
│   └── walletErrors.ts             viem error → kind + copy (FR-009)
├── auth/                           NEW
│   ├── AuthContext.tsx             AuthProvider + useAuth (FR-013…019)
│   └── useSignIn.ts                connect → nonce → sign → verify (FR-006…012)
├── api/
│   ├── auth.ts                     NEW — requestNonce, verifySignature
│   ├── session.ts                  EDIT — + address, readSession/writeSession/clearSession
│   ├── types.ts                    EDIT — + nonce/verify payloads
│   └── client.ts                   unchanged — still uses readToken only
├── components/
│   ├── RequireAuth.tsx             NEW — route guard (FR-020, 022, 023)
│   ├── NetworkBanner.tsx           NEW — wrong-network notice (FR-028…032)
│   ├── WalletMenu.tsx              NEW — address + disconnect (FR-024, 033)
│   ├── AppShell.tsx                EDIT — mount banner + menu
│   └── BalanceWidget.tsx           EDIT — drop useHasSession, use useAuth
├── pages/
│   └── ConnectPage.tsx             REWRITE — the connect flow
├── routes/AppRoutes.tsx            EDIT — wrap five routes in RequireAuth
├── main.tsx                        EDIT — WagmiProvider, AuthProvider
└── index.css                       EDIT — banner, wallet menu, connect list
```

**Structure Decision**: `src/chain/` is created here, matching `docs/project-structure.md` §5.3, because wagmi and viem now exist to put in it. `src/auth/` is added beyond §2's four documented directories on the same grounds `src/hooks/` and `src/lib/` were: it holds machinery that later features consume and that has nowhere sensible to live otherwise. `AuthContext` could have gone in `components/`, but a provider and a hook are not components, and burying the app's identity model among UI files makes it harder to find than it should be.

`package.json` gains two dependencies. No new environment variables — the chain is a compile-time constant, and adding `VITE_CHAIN_ID` would be configurability nobody asked for.

## Implementation Order

Dependency-ordered, matching the spec's story priorities. Each step is verifiable against the named part of [quickstart.md](./quickstart.md).

| # | Step | Story | Verify |
| --- | --- | --- | --- |
| 1 | `npm install wagmi viem`; `src/chain/chains.ts`, `src/chain/wagmi.ts`, `src/chain/walletErrors.ts` | — | `npm run typecheck` clean |
| 2 | `session.ts` extension; `api/types.ts`; `api/auth.ts` | — | typecheck; `client.ts` untouched |
| 3 | `AuthContext.tsx`; `WagmiProvider`/`AuthProvider` into `main.tsx`; `BalanceWidget` switched to `useAuth` | US2 | App still runs signed-out; **Part A** |
| 4 | `useSignIn.ts`; rewrite `ConnectPage.tsx` | US1 | **Part B** (needs API) |
| 5 | Reload behaviour: verify boot path, corrupt-token path | US2 | **Part C** (needs API) |
| 6 | `RequireAuth.tsx`; wrap five routes; `WalletMenu.tsx` into the shell | US3 | **Part D** (needs API) |
| 7 | `NetworkBanner.tsx` into the shell; `index.css` | US4 | **Part E** (no API needed) |
| 8 | Boundary greps | all | **Part F** |

Steps 1, 2, 7 and 8 need no backend. Step 4 is the first that does.

**Stop-and-check after step 5.** Steps 3–5 are the whole of what UI-03 onward depend on: if `useAuth` is right and a reload keeps you signed in, every later feature inherits a working session. Steps 6 and 7 are required by this spec but block nothing downstream.

**Do step 3 before step 4, even though it is tempting to write the connect flow first.** `AuthProvider` is what `useSignIn` hands its result to; building the flow against a provider that doesn't exist yet means writing the persistence twice.

## Complexity Tracking

No constitution gates exist to violate, so this table is empty by construction rather than by virtue.

Two things worth naming as judgement calls rather than violations:

**`src/auth/` is a fifth top-level source directory** beyond the four in `project-structure.md` §2. The alternative was scattering the provider into `components/` and the hook into `hooks/`, splitting one coherent concept across two directories to satisfy a list written before this feature existed.

**`transports: { [monadTestnet.id]: http() }` configures a read path this feature never uses.** `createConfig`'s types require it. It is the single most natural place for "the UI never calls the escrow contract" to start eroding — a configured transport makes the first `readContract` feel like it belongs. Flagged in [contracts/internal-api.md](./contracts/internal-api.md) §6 and checked by quickstart F2.
