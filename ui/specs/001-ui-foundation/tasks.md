---

description: "Task list for UI Foundation implementation"
---

# Tasks: UI Foundation

**Input**: Design documents from `/specs/001-ui-foundation/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/internal-api.md](./contracts/internal-api.md), [quickstart.md](./quickstart.md)

**Tests**: **None.** No unit, integration, or e2e tasks appear below — automated tests are excluded by explicit project decision (`ui/docs/CONTEXT.md`, spec FR-028). The `Verify` tasks at the end of each phase are the manual acceptance runs from [quickstart.md](./quickstart.md), and they are not optional: they are the only verification this component gets.

**Organization**: Grouped by user story so each is independently implementable and verifiable.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: Which user story the task belongs to (US1–US5)
- All paths are relative to `ui/` (the component root, which is also the working directory)

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: A Vite project that boots. Versions are pinned from research R1/R2 — do not resolve `latest`.

- [X] T001 Create `package.json` with dependencies `react@^19.2.8`, `react-dom@^19.2.8`, `react-router-dom@^7.18.2`, `@tanstack/react-query@^5.101.4`; devDependencies `vite@^8.2.1`, `@vitejs/plugin-react@^6.0.5`, `typescript@~5.9.3`, `@types/react`, `@types/react-dom`; scripts `dev`, `build`, `preview`, `typecheck` (`tsc --noEmit`)
- [X] T002 [P] Create `tsconfig.json` with `strict: true`, `noUncheckedIndexedAccess`, `noUnusedLocals`, `noUnusedParameters`, `exactOptionalPropertyTypes`, `jsx: react-jsx`, `moduleResolution: bundler`, and `types: ["vite/client"]` so `import.meta.env` is typed
- [X] T003 [P] Create `vite.config.ts` with the React plugin and `server: { host: true, port: 5173 }` — `host: true` is what makes the container reachable from the host (research R9)
- [X] T004 [P] Create `index.html` with a `#root` div and the module script pointing at `/src/main.tsx`
- [X] T005 [P] Create `.env.example` documenting `VITE_API_URL=http://localhost:3000`, with a comment stating that only `VITE_`-prefixed variables reach the browser bundle
- [X] T006 [P] Create `.gitignore` covering `node_modules/`, `dist/`, `.env.local`, `.env.*.local`
- [X] T007 Run `npm install`, then `cp .env.example .env.local`, then confirm `npm run dev` serves a blank page at `http://localhost:5173` with no console errors (depends on T001–T006)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Configuration, styling primitives, route constants, and the React entry point. Every user story depends on these.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [X] T008 Create `src/config.ts` exporting a validated `config.apiUrl` read from `import.meta.env.VITE_API_URL` — non-empty, parses as a URL, trailing slash stripped; throws a `ConfigError` naming the variable when absent, at module load rather than at first request (FR-006, data-model §1)
- [X] T009 [P] Create `src/index.css` with CSS custom properties for colour and spacing plus the shell header layout — no framework, no CSS-in-JS (FR-029, research R11)
- [X] T010 [P] Create `src/routes/paths.ts` exporting the eight path builders from data-model §6 (`connect`, `marketplace`, `agentDetail(id)`, `orders`, `orderDetail(id)`, `wallet`, `sell`, `createAgent`) — later features link through these, never through inline strings
- [X] T011 Create `src/main.tsx` mounting React in `StrictMode` inside `<BrowserRouter>`, importing `./config` first so a misconfigured start fails immediately, and importing `./index.css` (depends on T008, T009)

**Checkpoint**: The app boots, is configured, and has a route vocabulary. User stories can begin.

---

## Phase 3: User Story 1 — Every page has an address that resolves (Priority: P1) 🎯 MVP

**Goal**: Eight product screens plus a not-found screen, all addressable, all rendering inside a persistent shell.

**Independent Test**: Visit all nine addresses with **no backend running**; each renders its placeholder, parameterised routes echo their id, and the console stays clean. This is [quickstart.md](./quickstart.md) Part A.

- [X] T012 [US1] Create `src/components/PagePlaceholder.tsx` taking a screen name and an optional `{ label, value }` param pair, rendering both legibly — the nine pages below are thin wrappers over it, so the placeholder style is defined once
- [X] T013 [P] [US1] Create `src/pages/ConnectPage.tsx` rendering the "Connect" placeholder
- [X] T014 [P] [US1] Create `src/pages/MarketplacePage.tsx` rendering the "Marketplace" placeholder
- [X] T015 [P] [US1] Create `src/pages/AgentDetailPage.tsx` reading `id` via `useParams` and displaying it (FR-002)
- [X] T016 [P] [US1] Create `src/pages/OrderDetailPage.tsx` reading `id` via `useParams` and displaying it (FR-002)
- [X] T017 [P] [US1] Create `src/pages/MyOrdersPage.tsx` rendering the "My Orders" placeholder
- [X] T018 [P] [US1] Create `src/pages/WalletPage.tsx` rendering the "Wallet" placeholder
- [X] T019 [P] [US1] Create `src/pages/MyAgentsPage.tsx` rendering the "My Agents" placeholder
- [X] T020 [P] [US1] Create `src/pages/CreateAgentPage.tsx` rendering the "Create Agent" placeholder
- [X] T021 [P] [US1] Create `src/pages/NotFoundPage.tsx` with a "not found" message and a link to `paths.connect()` — never a blank page (FR-005)
- [X] T022 [US1] Create `src/components/AppShell.tsx` as a layout route: a header (balance widget slot left empty for now) above an `<Outlet/>`, so the header survives navigation without remounting (FR-003)
- [X] T023 [US1] Create `src/routes/AppRoutes.tsx` mapping all eight paths from `paths.ts` onto their pages inside the `AppShell` layout route, with a `path="*"` catch-all rendering `NotFoundPage` (depends on T012–T022)
- [X] T024 [US1] Render `<AppRoutes/>` inside `<BrowserRouter>` in `src/main.tsx` (depends on T023)
- [X] T025 [US1] **Verify** [quickstart.md](./quickstart.md) **Part A** (A1–A11): nine addresses render, params echo, back/forward causes no document request, header persists, console clean → SC-001

**Checkpoint**: A navigable eight-screen skeleton. This is a demonstrable artifact on its own and needs no backend.

---

## Phase 4: User Story 2 — The application can talk to the backend (Priority: P2)

**Goal**: One typed client through which every backend call passes, producing exactly one error shape.

**Independent Test**: Health check succeeds with the API up; every failure mode (API down, malformed response, missing config, bad token) produces a normalised error with no unhandled rejection. This is [quickstart.md](./quickstart.md) Part B.

**Reference**: [contracts/internal-api.md](./contracts/internal-api.md) §1–§3 is the exact surface to build.

- [X] T026 [P] [US2] Create `src/api/errors.ts` — `ApiError` class with `kind: 'http' | 'network' | 'timeout' | 'parse'`, `status`, `code`, `message`, optional `details`; plus `isApiError()` and `isConnectivityError()` (`kind !== 'http'`). Local codes `NETWORK_ERROR`, `TIMEOUT`, `PARSE_ERROR`, `HTTP_<status>` when the backend supplies none (FR-010, data-model §2)
- [X] T027 [P] [US2] Create `src/api/session.ts` — `readToken()`, `writeToken()`, `clearToken()` over `localStorage` key `guardian.jwt`, plus the exported `UNAUTHENTICATED_EVENT = 'guardian:unauthenticated'` constant. The token is never decoded (data-model §3)
- [X] T028 [US2] Create `src/api/client.ts` with the core request function: prefix `config.apiUrl`, attach `Authorization: Bearer` when `readToken()` is non-null, apply a 10 s `AbortSignal.timeout()` overridable via `init.signal`, parse JSON, and convert **every** failure path into an `ApiError` — a rejected `fetch` becomes `network`, an aborted signal becomes `timeout`, a bad body becomes `parse`, a non-2xx becomes `http` (depends on T026, T027)
- [X] T029 [US2] Export `apiGet<T>`, `apiPost<T>`, `apiPatch<T>` from `src/api/client.ts`, each generic over the response type (contracts §1)
- [X] T030 [US2] Add 401 handling to `src/api/client.ts`: clear the stored token and dispatch `UNAUTHENTICATED_EVENT` on `window` **before** rejecting — the client must not import the router, which is why this is an event rather than a navigation (FR-011, research R7)
- [X] T031 [US2] Add `checkHealth()` to `src/api/client.ts` calling `GET /health` and returning `{ reachable, status }`, where **any** HTTP response counts as reachable and only `network`/`timeout` count as unreachable — this keeps the check working whether or not the API exposes `/health` (FR-012, research R6)
- [X] T032 [US2] In `src/components/AppShell.tsx`, listen for `UNAUTHENTICATED_EVENT` and navigate to `paths.connect()` via `useNavigate` — a single listener at the shell, so no screen handles 401 itself (FR-011)
- [X] T033 [US2] In `src/pages/ConnectPage.tsx`, call `checkHealth()` on mount and render the result (reachable / unreachable, with the `ApiError` message when it fails) — this is what makes Part B observable without a console
- [X] T034 [US2] **Verify** [quickstart.md](./quickstart.md) **Part B** (B1–B7): reachability, backend down, missing config, credential attached and absent, 401 clears with no retry loop, malformed response → SC-002, SC-003

**Checkpoint**: Every later feature can add an endpoint by writing one typed wrapper and nothing else.

---

## Phase 5: User Story 3 — Live screens update themselves and then stop (Priority: P3)

**Goal**: One refresh mechanism, correct on all six behaviours the contract specifies.

**Independent Test**: Attach `usePolling` to a fetcher whose result becomes terminal after a few ticks; watch the Network panel confirm cadence, stop-on-terminal, no overlap, and clean unmount. Verifiable with a stub fetcher — **no backend required**. This is [quickstart.md](./quickstart.md) Part C.

**Reference**: [contracts/internal-api.md](./contracts/internal-api.md) §4 and [data-model.md](./data-model.md) §5 (state diagram).

- [X] T035 [US3] Create `src/lib/queryClient.ts` exporting a `QueryClient` with `retry: false` (a 1 s poll retries on its own next tick; layered retries multiply requests), `refetchOnWindowFocus: false` (a backgrounded tab returning must not fire a burst), `staleTime: 0` (research R4)
- [X] T036 [US3] Wrap the app in `<QueryClientProvider>` in `src/main.tsx`, outside `<BrowserRouter>` (depends on T035)
- [X] T037 [US3] Create `src/hooks/usePolling.ts` implementing the contracts §4 signature: `useQuery` with `refetchInterval` as a function returning `false` once `isTerminal(data)` matches and `intervalMs` otherwise; `enabled` honoured; returns `{ data, error, isPolling, refetch }` with `error` typed as `ApiError | null`. `isTerminal` omitted ⇒ polls until unmount (FR-014–FR-020) (depends on T036)
- [X] T038 [US3] **Verify** [quickstart.md](./quickstart.md) **Part C** (C1–C8): cadence, stop-on-terminal over a two-minute watch, terminal-on-first-fetch issuing exactly one request, clean unmount, no overlap under throttling, failure retried not fatal, backgrounded tab, no timer accumulation → SC-004, SC-005, SC-006

**Checkpoint**: The mechanism UI-04, UI-06, and the header widget all depend on is built once and correct. **This is the natural stopping point** — everything UI-02 needs now exists.

---

## Phase 6: User Story 4 — The shell shows money and a way to reach it (Priority: P4)

**Goal**: Two labelled money figures in the header, self-refreshing, linking to Wallet.

**Independent Test**: Signed in, both figures appear on all eight screens and update within ~5 s without a reload; signed out, a sign-in affordance and no polling. This is [quickstart.md](./quickstart.md) Part D. **Requires the API running** and depends on US2 + US3.

- [X] T039 [P] [US4] Create `src/lib/money.ts` exporting `type Cents = number` and `formatUsd(cents)` (`200 → "$2.00"`) — integer cents in, string out, no floating-point arithmetic on money anywhere (research R8)
- [X] T040 [P] [US4] Create `src/api/types.ts` with `AccountSummary { address, availableBalanceMinor, inEscrowMinor }`, commented as provisional field names pending API-01 (data-model §4)
- [X] T041 [US4] Create `src/api/me.ts` exporting `fetchMe(): Promise<AccountSummary>` over `apiGet` (depends on T029, T040)
- [X] T042 [US4] Create `src/components/BalanceWidget.tsx` rendering **two distinctly labelled figures** — available balance and in escrow — via `formatUsd`, polling `fetchMe` through `usePolling` at 5000 ms with no `isTerminal`, `enabled` only when `readToken()` is non-null. Never render a combined total (FR-021, FR-023) (depends on T037, T039, T041)
- [X] T043 [US4] Make the widget a link to `paths.wallet()` in `src/components/BalanceWidget.tsx` (FR-022)
- [X] T044 [US4] Add the two degraded states to `src/components/BalanceWidget.tsx`: signed out ⇒ a sign-in affordance, no amounts, and **no polling requests**; backend unreachable ⇒ a neutral placeholder that leaves the rest of the screen working (FR-024)
- [X] T045 [US4] Mount `<BalanceWidget/>` in the `AppShell` header slot in `src/components/AppShell.tsx`, then **verify** [quickstart.md](./quickstart.md) **Part D** (D1–D6) → SC-007

**Checkpoint**: The header frame every later screen renders inside is complete.

---

## Phase 7: User Story 5 — One command starts the whole frontend (Priority: P5)

**Goal**: `docker compose up --build` serves the app, with the bundle guardrail proven.

**Independent Test**: On a clean checkout, one command reaches the entry screen in a browser. This is [quickstart.md](./quickstart.md) Part E. Depends only on Phase 1 + US1 — **can run in parallel with US2/US3/US4**.

- [X] T046 [P] [US5] Create `ui/Dockerfile` on `node:24-alpine`: copy manifests, `npm ci`, copy source, expose 5173, `CMD` running `vite --host 0.0.0.0 --port 5173`. A dev-server image, not a production nginx build (research R9)
- [X] T047 [P] [US5] Create `ui/docker-compose.yml` per `docs/project-structure.md` §3.2 — `build: .`, `env_file: ../.env`, `environment: VITE_API_URL`, `ports: ["5173:5173"]`, `volumes: ["./src:/app/src"]`
- [X] T048 [US5] **Verify** [quickstart.md](./quickstart.md) **Part E** (E1–E3): the container serves the entry screen, the configured API address is reached, and `npm run build && grep -ri "PRIVATE_KEY\|MNEMONIC\|SECRET" dist/` returns nothing while `grep -r "VITE_API_URL\|localhost:3000" dist/` does hit — proving the search would have found a leak → SC-008, SC-009

---

## Phase 8: Polish & Cross-Cutting Concerns

- [X] T049 [P] Create `ui/README.md`: install and start commands, the `VITE_API_URL` requirement, and the note that `npm run dev` beats the container for iteration because Vite hot reload through a volume mount is laggy on macOS
- [X] T050 [P] Run `npm run typecheck` and resolve every error — with no test suite, the compiler is the only automated check this component has, so a clean `tsc --noEmit` is not optional
- [X] T051 Run the convention guardrails as greps and fix any hit: `grep -rn "fetch(" src/ --include=*.ts --include=*.tsx` should hit only `src/api/client.ts`; `grep -rnE "'/(agents|orders|wallet|sell)" src/ --exclude=*paths.ts` should return nothing. No constitution exists to enforce these, so they are checked by hand here (plan.md, Constitution Check)
- [X] T052 Run the full [quickstart.md](./quickstart.md) pass, Parts A–E in one sitting, and record any deviation in the spec's Assumptions rather than fixing it silently

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: no dependencies
- **Foundational (Phase 2)**: needs Setup — blocks all stories
- **US1 (Phase 3)**: needs Foundational
- **US2 (Phase 4)**: needs Foundational; T032 edits `AppShell.tsx`, which US1 creates
- **US3 (Phase 5)**: needs Foundational only — independent of US2
- **US4 (Phase 6)**: needs **US2 and US3** — it is the first consumer of both
- **US5 (Phase 7)**: needs Setup and US1 — independent of US2/US3/US4
- **Polish (Phase 8)**: needs everything

### Honest note on story independence

These stories are **layered, not fully independent**, and the plan says so rather than pretending otherwise. US1, US2, US3, and US5 each stand alone and are separately verifiable. US4 is genuinely dependent — a balance widget needs both a client and a polling mechanism, and inventing a way to test it without them would be busywork. Two small cross-story edits exist and are marked: T032 (US2 → `AppShell.tsx`) and T045 (US4 → `AppShell.tsx`).

### Parallel Opportunities

- **Phase 1**: T002–T006 all in parallel after T001
- **Phase 2**: T009 and T010 in parallel
- **Phase 3**: T013–T021 — nine page files, all in parallel once T012 exists
- **Phase 4**: T026 and T027 in parallel; T028 onward is one file, sequential
- **Phase 6**: T039 and T040 in parallel
- **Phase 7**: T046 and T047 in parallel
- **Across phases**: US5 (T046–T048) can run at any time after US1, alongside US2/US3/US4
- **Phase 8**: T049 and T050 in parallel

### Parallel Example: User Story 1

```text
# After T012 (PagePlaceholder) lands, launch all nine pages together:
Task: "Create src/pages/ConnectPage.tsx"
Task: "Create src/pages/MarketplacePage.tsx"
Task: "Create src/pages/AgentDetailPage.tsx"
Task: "Create src/pages/OrderDetailPage.tsx"
Task: "Create src/pages/MyOrdersPage.tsx"
Task: "Create src/pages/WalletPage.tsx"
Task: "Create src/pages/MyAgentsPage.tsx"
Task: "Create src/pages/CreateAgentPage.tsx"
Task: "Create src/pages/NotFoundPage.tsx"
```

---

## Implementation Strategy

### MVP scope

**Phases 1–3 (T001–T025)** — a navigable eight-screen skeleton. It is demonstrable on its own, needs no backend, and is the smallest thing that gives UI-02 through UI-07 somewhere to put their work.

### The scope that actually unblocks the next feature

**Phases 1–5 (T001–T038).** UI-02 (Wallet connect) needs routing, the API client, and the session module; it brings `@tanstack/react-query` with wagmi regardless. Stopping here and starting UI-02 is defensible — the header widget and the container add real value but block nothing.

### Incremental delivery

1. Setup + Foundational → the app boots
2. US1 → navigable skeleton → **MVP**
3. US2 → the app reaches the API
4. US3 → live updates, correct once and for all
5. US4 → money visible in the header
6. US5 → one-command start
7. Polish → typecheck clean, conventions checked, full quickstart pass

### A note on ordering

Get **T037 (`usePolling`) right before moving on.** Its two failure modes — a leaked 1-second interval and overlapping requests — surface on stage rather than at the desk, and three later features inherit whatever is built here. The source spec's instruction was "build it once, properly"; Phase 5 is where that gets honoured or not.

---

## What changed during implementation

Three things the plan did not anticipate, all resolved:

1. **`refetchIntervalInBackground: true` added to the query client.** React Query pauses polling whenever the document is hidden — and on macOS an *occluded* window counts as hidden, not just a background tab. Verification caught a 5 s poll producing zero requests over 12 seconds with the browser behind the terminal. Act 1's claim is that the order page flips on its own; that must not depend on window stacking. See research R4.
2. **A DEV-only polling harness at `/__poll-test`** (`src/pages/PollTestPage.tsx`), gated on `import.meta.env.DEV` so it is absent from production builds. Part C's contract — stop-on-terminal, no overlap, clean unmount — is not observable through any product screen in this feature, and `usePolling` is the component three later features inherit. Delete it if it stops earning its keep.
3. **A timeout-message bug, found and fixed.** `toTransportError` reported the default 10 s budget rather than the budget actually used, so a 500 ms timeout claimed "longer than 10 seconds".

## Notes

- No test tasks by design (FR-028). The `Verify` tasks are the acceptance run and must not be skipped as "obvious".
- `[P]` means different files with no incomplete dependencies.
- Commit after each task or logical group; stop at any checkpoint to verify independently.
- Two conventions later features depend on: **no `fetch` outside `src/api/`**, and **no route strings outside `src/routes/paths.ts`**. T051 checks both — nothing else will.
