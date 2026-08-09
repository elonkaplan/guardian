---

description: "Task list for 002-wallet-connect"
---

# Tasks: Wallet Connect & Session

**Input**: Design documents from `/specs/002-wallet-connect/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/internal-api.md](./contracts/internal-api.md), [quickstart.md](./quickstart.md)

**Tests**: **None.** No unit, integration, or e2e tests — an explicit project decision (`ui/docs/CONTEXT.md`, restated as FR-035). Every story ends with a manual verification task pointing at the matching part of [quickstart.md](./quickstart.md). Those verification tasks *are* the test suite; do not skip them.

**Organization**: Grouped by user story so each is independently implementable and verifiable.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: US1–US4, mapping to the user stories in spec.md
- All paths are relative to `ui/`

---

## Phase 1: Setup

**Purpose**: Get the two new dependencies in and confirm a clean baseline.

- [X] T001 Add `wagmi@^3.7.6` and `viem@^2.55.11` to `package.json` dependencies and run `npm install`
- [X] T002 Run `npm run typecheck` and confirm it is clean before any source changes; if wagmi's `typescript: >=5.9.3` peer warns, resolve it now rather than mid-feature

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The chain definition, the session store, the API wrappers, and the auth context that every story below builds on.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [X] T003 [P] Create `src/chain/chains.ts` exporting viem's `monadTestnet` with `blockExplorers.default` overridden to MonadVision (`https://testnet.monadvision.com`), plus `explorerTxUrl(hash)` and `explorerAddressUrl(address)` helpers — the app's only chain definition and only explorer host (FR-027, research R3)
- [X] T004 [P] Create `src/chain/walletErrors.ts` with `classifyWalletError(error)` returning `'rejected' | 'no-wallet' | 'unsupported' | 'unknown'` and `walletErrorMessage(kind, step)` for `'connect' | 'sign' | 'switch'`; detect rejection by walking the viem error chain for `UserRejectedRequestError`, **not** by reading `.code === 4001` off the outer error (FR-009, research R7)
- [X] T005 Create `src/chain/wagmi.ts` exporting `wagmiConfig` from `createConfig({ chains: [monadTestnet], transports: { [monadTestnet.id]: http() }, connectors: [injected()], multiInjectedProviderDiscovery: true })` with default storage (depends on T003; research R4, contracts §6)
- [X] T006 [P] Add `NonceRequest`, `NonceResponse`, `VerifyRequest`, `VerifyResponse` to `src/api/types.ts`, carrying the same provisional-field-casing caveat the file already documents for `AccountSummary` (data-model §4)
- [X] T007 Extend `src/api/session.ts` with `StoredSession`, `readSession()`, `writeSession()`, `clearSession()` backed by `guardian.jwt` + `guardian.address`; `readSession()` returns `null` unless **both** keys are present. Keep `readToken`/`writeToken`/`clearToken` exported unchanged — `client.ts` uses `readToken` and must not learn about addresses (FR-018, research R8, contracts §4)
- [X] T008 Create `src/api/auth.ts` with `requestNonce(address)` → `POST /auth/nonce` and `verifySignature(address, signature)` → `POST /auth/verify`, both via `apiPost` (depends on T006; contracts §3)
- [X] T009 Create `src/auth/AuthContext.tsx` with the `AuthState` union (`resolving | signed-out | signed-in`), `AuthProvider`, and `useAuth()`. This task implements only `onSignedIn()` (persists via `writeSession`, transitions to signed-in) and `signOut()` (clears the session **and** calls wagmi's `disconnect`). Boot restore and the involuntary sign-outs come in later phases — initial state is `signed-out` (depends on T007; contracts §1)
- [X] T010 Wire providers in `src/main.tsx`: `WagmiProvider` **outside** `QueryClientProvider` (wagmi's hooks use react-query internally), `AuthProvider` inside `BrowserRouter`. Keep the existing dynamic-import bootstrap that renders configuration failures as a visible panel (depends on T005, T009; research R12)
- [X] T011 Delete the local `useHasSession` hook from `src/components/BalanceWidget.tsx` and derive from `useAuth().isSignedIn` instead — its own comment says it is a stand-in until UI-02 owns real session state (depends on T009; FR-014, FR-034)

**Checkpoint**: App runs signed-out, typecheck clean, no behaviour change visible yet.

---

## Phase 3: User Story 1 — Connecting a wallet signs me in (Priority: P1) 🎯 MVP

**Goal**: A visitor picks a wallet, approves two prompts, and is signed in with an account created on first verify.

**Independent Test**: Quickstart **Part A** (no wallet installed) and **Part B** (fresh address, backend running) — connect, sign, land on the marketplace, having approved exactly one connect and one signature.

- [X] T012 [US1] Create `src/auth/useSignIn.ts` exposing `phase`, `failure`, `connectors`, `signIn(connector)`, `reset()`. Implement `signIn` as **one imperative async function** — `connectAsync` → `requestNonce` → `signMessageAsync({ message: nonce })` → `verifySignature` → `onSignedIn` — with **no `useEffect` watching `address`**. It must never reject, must guard re-entry while `phase !== 'idle'`, must fetch a fresh nonce per attempt, and must leave nothing stored on any failure path (FR-006, FR-010, FR-011, FR-012; research R6, contracts §2)
- [X] T013 [US1] In `src/auth/useSignIn.ts`, derive `connectors` from `useConnectors()` de-duplicated by connector `id`, and map every thrown error into the `SignInFailure` union — `wallet-rejected`, `signature-refused`, `no-wallet`, `backend-unreachable` (via `isConnectivityError`), `wallet-error` — using `classifyWalletError` for the wallet half (depends on T012; FR-001, FR-009, research R4)
- [X] T014 [US1] Rewrite `src/pages/ConnectPage.tsx`: render one entry per available connector; show a per-phase status with `awaiting-signature` calling out the extension popup; render `failure.message` with a retry that clears it without a reload; show the no-wallet explanation instead of an unusable control when `connectors` is empty; on success navigate to `/agents`. Keep the existing API health indicator (depends on T013; FR-001, FR-005, FR-009, FR-023)
- [X] T015 [P] [US1] Add styles for the connector list, phase status, and failure message to `src/index.css`
- [ ] T016 [US1] Verify quickstart **Part A** and **Part B**, including the five failure paths in B9 (depends on T014, T015)

**Checkpoint**: Sign-in works end to end within a single page view. A reload still signs you out — that is US2's job.

---

## Phase 4: User Story 2 — My session survives a page reload (Priority: P2)

**Goal**: A reload restores the signed-in state with no wallet prompt and no flash of the connect screen.

**Independent Test**: Quickstart **Part C** — ten consecutive reloads, a direct reload of `/wallet`, a reload with the wallet **locked**, and a corrupted token that clears without a redirect loop.

- [X] T017 [US2] In `src/auth/AuthContext.tsx`, initialise state from `readSession()` **synchronously** in the `useState` initialiser, so the first render is already correct and no connect screen flashes. Derive identity from the stored credential only — never from `useConnection()` — so a locked or reconnecting wallet stays signed in (FR-013, FR-016; research R5, SC-003)
- [X] T018 [US2] In `src/auth/AuthContext.tsx`, add a `guardian:unauthenticated` listener that transitions to signed-out. The client already clears the token and fires the event, and `AppShell` already navigates — this adds the state half only, with no second navigation path and no retry loop (FR-017)
- [ ] T019 [US2] Verify quickstart **Part C** (depends on T017, T018)

**Checkpoint**: Reload survival works. `resolving` is reachable for at most one tick; leave it in the union — `RequireAuth` in the next phase must handle it.

---

## Phase 5: User Story 3 — Guards and disconnect (Priority: P3)

**Goal**: The five personal screens require a session and return you where you were headed; disconnect ends the session from anywhere.

**Independent Test**: Quickstart **Part D** — five guarded URLs redirect and return, two public URLs render freely, disconnect clears everything including browser-back, and an account switch ends the session **without a signature prompt**.

- [X] T020 [P] [US3] Create `src/components/RequireAuth.tsx`: `resolving` → a resolving placeholder and **never a redirect**; `signed-out` → `<Navigate to={paths.connect()} state={{ from: location }} replace />`; `signed-in` → children (FR-015, FR-022; contracts §8)
- [X] T021 [US3] Wrap `/orders`, `/orders/:id`, `/wallet`, `/sell`, `/sell/new` in `RequireAuth` in `src/routes/AppRoutes.tsx`. Leave `/`, `/agents`, `/agents/:id`, and the catch-all public — the catalogue endpoints are public in `api-design.md` §3.3 (depends on T020; FR-020, FR-021, data-model §5)
- [X] T022 [P] [US3] Create `src/components/WalletMenu.tsx`: abbreviated address (`0x1234…abcd`) plus a disconnect control calling `useAuth().signOut()` when signed in; renders nothing when signed out, since `BalanceWidget` already owns the sign-in affordance (FR-024, FR-025, FR-033; contracts §10)
- [X] T023 [US3] Mount `WalletMenu` in the header of `src/components/AppShell.tsx`, keeping the existing `guardian:unauthenticated` listener intact (depends on T022)
- [X] T024 [US3] In `src/pages/ConnectPage.tsx`, read `location.state.from` after a successful sign-in and navigate there, falling back to `/agents` when absent (depends on T020; FR-023)
- [X] T025 [US3] In `src/auth/AuthContext.tsx`, add the two involuntary sign-outs via `useConnectionEffect`: end the session when the wallet's active account differs from the session address, and when the wallet reports the site disconnected. **Sign out — never re-sign**; a signature prompt here means an effect is watching the address (FR-018, FR-019; quickstart D4)
- [X] T026 [P] [US3] Add styles for the wallet menu and the resolving placeholder to `src/index.css`
- [ ] T027 [US3] Verify quickstart **Part D**, including D4 (account change) and D5 (disconnect from inside the wallet) — you need a second address in the wallet for D4 (depends on T021, T023, T024, T025, T026)

**Checkpoint**: Access control complete. All three of US1–US3 work independently.

---

## Phase 6: User Story 4 — Wrong network is visible with a one-click fix (Priority: P4)

**Goal**: A wallet on the wrong chain shows a persistent banner with a working switch, and nothing is blocked.

**Independent Test**: Quickstart **Part E** — no backend needed. Banner on every screen, approved switch clears it without a reload, declined switch leaves it, an unknown chain gets added, and sign-in works throughout.

- [X] T028 [P] [US4] Create `src/components/NetworkBanner.tsx`: render only when a wallet is connected **and** `chainId !== monadTestnet.id`; name both networks; switch via `useSwitchChain().switchChainAsync({ chainId: monadTestnet.id })`, letting wagmi's connector handle `wallet_addEthereumChain` for an unknown chain; catch a declined switch through `classifyWalletError` and leave the banner in place (FR-028, FR-029, FR-030, FR-032; research R9, contracts §9)
- [X] T029 [US4] Mount `NetworkBanner` in `src/components/AppShell.tsx` between the header and `<Outlet/>` so it appears on every screen. **No overlay, no disabled controls, no early return** — wrong network warns, it never gates (depends on T028; FR-028, FR-031, research R10)
- [X] T030 [P] [US4] Add banner styles to `src/index.css` — visible enough not to be missed, quiet enough not to look like a crash
- [ ] T031 [US4] Verify quickstart **Part E**, including E5 (remove Monad Testnet from the wallet entirely, then switch) (depends on T029, T030)

**Checkpoint**: All four stories independently functional.

---

## Phase 7: Polish & Cross-Cutting Concerns

- [X] T032 [P] Update the stale module comment in `src/api/session.ts` — it predicts "UI-02 is the only caller of `writeToken`", which is now `writeSession`
- [X] T033 [P] Note the browser-wallet prerequisite and the Monad Testnet network in `README.md`, so a clean-checkout operator knows what the demo laptop needs
- [X] T034 Run the quickstart **Part F** boundary greps and confirm: exactly one `signMessage` call site; zero `sendTransaction`/`useWriteContract`/`privateKey`/`mnemonic`/seed-phrase hits; explorer hosts only in `src/chain/chains.ts`; zero `useAccount`/`useAccountEffect` (FR-003, FR-004, FR-027, SC-010; research R2)
- [X] T035 Run `npm run typecheck` and `npm run build` clean
- [ ] T036 Run the full quickstart sign-off table (Parts A–F) and record the result (depends on T034, T035)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: no dependencies
- **Foundational (Phase 2)**: depends on Setup — **blocks every user story**
- **US1 (Phase 3)**: depends on Foundational
- **US2 (Phase 4)**: depends on Foundational. Independently verifiable, but Part C is far easier to run once US1 gives you a way to sign in
- **US3 (Phase 5)**: depends on Foundational; T024 also touches `ConnectPage.tsx` from US1
- **US4 (Phase 6)**: depends on Foundational only — the one story genuinely parallel to everything else, and the only one needing no backend
- **Polish (Phase 7)**: depends on all four stories

### Story independence

US4 is fully independent. US2 and US3 both extend `AuthContext.tsx` but in disjoint areas — boot restore and the 401 listener (US2) versus the two `useConnectionEffect` sign-outs (US3). US3's T024 edits `ConnectPage.tsx`, which US1 creates; sequence them if the same file is in flight.

### Do Foundational before writing the connect flow

It is tempting to start with `ConnectPage`. Don't. `AuthProvider` is what `useSignIn` hands its result to, and building the flow first means writing the persistence twice.

### Parallel opportunities

- **Phase 2**: T003, T004, T006 all together (three separate new files). T005 waits on T003; T007 is independent; T008 waits on T006; T009 waits on T007; T010 waits on T005 + T009; T011 waits on T009.
- **Phase 3**: T015 (css) runs alongside T012–T014.
- **Phase 5**: T020, T022, T026 together — guard, menu, and styles are three separate files.
- **Phase 6**: T028 and T030 together.
- **Phase 7**: T032, T033 together.
- **Across phases**: US4 (T028–T031) can be done by a second person at any point after Phase 2, with no backend running.

---

## Parallel Example: Phase 2 Foundational

```bash
# Three independent new files, no shared dependencies:
Task: "Create src/chain/chains.ts — monadTestnet with MonadVision explorer"
Task: "Create src/chain/walletErrors.ts — viem error classification"
Task: "Add nonce/verify payload types to src/api/types.ts"

# Then, once T003 and T006 land:
Task: "Create src/chain/wagmi.ts — createConfig"        # needs T003
Task: "Create src/api/auth.ts — requestNonce/verify"    # needs T006
```

## Parallel Example: User Story 3

```bash
Task: "Create src/components/RequireAuth.tsx"
Task: "Create src/components/WalletMenu.tsx"
Task: "Add wallet menu and resolving-placeholder styles to src/index.css"
```

---

## Implementation Strategy

### MVP first (US1 only)

1. Phase 1 Setup → 2. Phase 2 Foundational → 3. Phase 3 US1 → 4. **Stop and verify Parts A and B** → 5. Demoable: connecting a wallet is the whole of registration.

### Incremental delivery

| Increment | Adds | Verify |
| --- | --- | --- |
| Setup + Foundational | Nothing user-visible | typecheck |
| + US1 | Sign-in works in-page (**MVP**) | Parts A, B |
| + US2 | Reload survival | Part C |
| + US3 | Guards, disconnect, account change | Part D |
| + US4 | Wrong-network banner | Part E |
| + Polish | Boundary checks | Part F |

### Stop-and-check after US2

Foundational + US1 + US2 are the whole of what UI-03 onward depend on: if `useAuth` is right and a reload keeps you signed in, every later feature inherits a working session. US3 and US4 are required by this spec but block nothing downstream.

---

## Notes

- **No test tasks by design.** The manual verification tasks (T016, T019, T027, T031, T036) are the acceptance criteria — a skipped one is an unverified story.
- The two rules that outlive this feature (contracts §12): `signMessageAsync` appears **exactly once**, and explorer URLs come **only** from `src/chain/chains.ts`. T034 is the check; with no ratified constitution, that grep is the only enforcement there is.
- wagmi v3 renamed the account hooks. Use `useConnection` / `useConnectionEffect`; `useAccount` / `useAccountEffect` are deprecated aliases and every tutorial online still shows the old names (research R2).
- Commit after each task or logical group. Stop at any checkpoint to verify a story independently.
