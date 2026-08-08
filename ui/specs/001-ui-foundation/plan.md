# Implementation Plan: UI Foundation

**Branch**: `001-ui-foundation` | **Date**: 2026-08-08 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-ui-foundation/spec.md`

## Summary

Scaffold the Guardian frontend to the point where the seven feature specs that follow can each start from a running application: eight addressable screens with placeholders inside a persistent shell, one typed client through which every backend call passes, one shared polling mechanism, a two-figure balance widget in the header, and a one-command container start.

The technical approach is deliberately small. Vite 8 + React 19 + TypeScript 5.9 in strict mode; React Router 7 in declarative mode with a layout route supplying the shell; a hand-written `fetch` client (~80 lines) that normalises every failure into one `ApiError`; and TanStack Query behind a thin `usePolling` wrapper rather than a hand-rolled timer loop. That last choice is the one non-obvious call — see Key Decisions below.

Nothing here is user-facing. The users served are the developer building UI-02 through UI-07 and the operator who has to start the app reliably before a rehearsal.

## Technical Context

**Language/Version**: TypeScript 5.9.3, `strict: true` plus `noUncheckedIndexedAccess`, `noUnusedLocals`, `noUnusedParameters`, `exactOptionalPropertyTypes`

**Primary Dependencies**: React 19.2.8 · Vite 8.2.1 (`@vitejs/plugin-react` 6.0.5) · react-router-dom 7.18.2 · @tanstack/react-query 5.101.4

**Storage**: `localStorage`, one key (`guardian.jwt`). No client database, no persisted cache.

**Testing**: **None.** No unit, integration, or e2e tests — an explicit project decision (`ui/docs/CONTEXT.md`); the escrow contract is the only component that keeps a suite. Acceptance is by hand via [quickstart.md](./quickstart.md).

**Target Platform**: Desktop Chrome on a demo laptop. No mobile, no cross-browser matrix, no responsive work beyond what a laptop needs.

**Project Type**: Single-page web frontend, one of three components in the `guardian/` repo (`api/`, `ui/`, `sc/`).

**Performance Goals**: Order Detail polls at 1 s; Wallet, My Orders, and the header widget at 5 s. Route transitions instant (no full reload). No bundle-size or render-timing budget — this is a demo, not a product.

**Constraints**: Only `VITE_`-prefixed environment variables may reach the browser bundle — the guardrail keeping `OPERATOR_PRIVATE_KEY` out, and not to be worked around. All money is integer USD cents. viem's floor is ≥ 2.40.0 when UI-02 introduces it. No SSE, no websockets — polling only.

**Scale/Scope**: 8 routes, ~20 source files, 2 backend endpoints consumed. One developer, hours not days.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

**Status: NOT EVALUATED — no ratified constitution exists.**

`.specify/memory/constitution.md` is the unmodified Spec Kit template: every principle is still a `[PRINCIPLE_N_NAME]` placeholder and the version reads `[CONSTITUTION_VERSION]`. There are no gates to check against, so this section cannot pass or fail honestly — recording that plainly rather than stamping a vacuous ✅.

**Consequence**: nothing blocks this plan. But the governance that would normally catch drift across seven sibling features is absent, so the standards this feature sets in code — one client, one polling mechanism, one money formatter, no `fetch` outside `api/` — are enforced only by review. If you want them enforced, `/speckit-constitution` before UI-02 is the moment; after seven features have landed it is archaeology.

**Post-Phase 1 re-check**: unchanged. No constitution was added during planning.

## Key Decisions

Full reasoning in [research.md](./research.md). The three that a reviewer would want to challenge:

| Decision | Why | Reversibility |
| --- | --- | --- |
| **TanStack Query, not a hand-rolled polling hook** (R4) | `wagmi@3` requires it as a peer dependency and UI-02 installs wagmi — so it arrives one spec later regardless. Hand-rolling now means writing 60 lines containing exactly the three races the source spec warns about (unmount leaks, overlapping requests), then discarding them. | The `usePolling` signature is identical either way; swapping the body is one file, invisible to callers. |
| **TypeScript 5.9, not 7.0** (R2) | npm `latest` is `7.0.2`, the Go-native rewrite, GA very recently. At this codebase size the compile-speed win is worth nothing, while a tooling gap costing an afternoon is a real risk on a time-boxed build. | One line in `package.json`. |
| **Health check treats *any* HTTP response as reachable** (R6) | `/health` is named in this feature's acceptance criteria and in the bootstrap checklist, but does **not** appear in `docs/api-design.md` §3's endpoint tables. This feature must not fail acceptance on the API team's routing choice, and "the server answered" is what SC-002 actually cares about. | Trivial to tighten to a 200 once confirmed. |

**Spec correction made during planning**: FR-021 originally said the header shows *available balance and settled funds*. Both `docs/api-design.md` §3.2 and `ui/docs/specs.md` (UI-06) establish that `GET /me` returns **available balance and in-escrow**, while settled funds live on-chain in `balances[]` and are the Wallet page's concern. The spec now reads available + in-escrow. Two figures rather than one is the rule that matters (`ui/docs/CONTEXT.md` §3.5); *which* two is settled by what a single call can return.

## Project Structure

### Documentation (this feature)

```text
specs/001-ui-foundation/
├── plan.md              # This file
├── spec.md              # Feature specification
├── research.md          # Phase 0 — 11 resolved decisions
├── data-model.md        # Phase 1 — client-side types
├── quickstart.md        # Phase 1 — the manual acceptance run
├── contracts/
│   └── internal-api.md  # Phase 1 — module surface UI-02…UI-07 build on
├── checklists/
│   └── requirements.md  # Spec quality checklist
└── tasks.md             # Phase 2 — created by /speckit-tasks, not here
```

### Source Code (repository root)

```text
ui/
├── src/
│   ├── main.tsx                    entry — QueryClientProvider, BrowserRouter
│   ├── config.ts                   VITE_API_URL, validated at load (FR-006)
│   ├── index.css                   custom properties + shell layout only
│   ├── api/
│   │   ├── client.ts               fetch wrapper: base URL, bearer, timeout, 401 (FR-006…012)
│   │   ├── errors.ts               ApiError union + isConnectivityError (FR-010)
│   │   ├── session.ts              localStorage token: read / write / clear (FR-008, 011)
│   │   ├── types.ts                hand-written payload types
│   │   └── me.ts                   GET /me wrapper for the header widget
│   ├── hooks/
│   │   └── usePolling.ts           the shared refresh mechanism (FR-014…020)
│   ├── lib/
│   │   └── money.ts                Cents type + formatUsd (integer cents only)
│   ├── routes/
│   │   ├── paths.ts                path builders — no inline route strings
│   │   └── AppRoutes.tsx           route table + catch-all (FR-001…005)
│   ├── components/
│   │   ├── AppShell.tsx            layout route: header + <Outlet/> (FR-003)
│   │   └── BalanceWidget.tsx       two labelled figures, links to Wallet (FR-021…024)
│   └── pages/
│       ├── ConnectPage.tsx         ┐
│       ├── MarketplacePage.tsx     │
│       ├── AgentDetailPage.tsx     │ eight placeholders — each names its
│       ├── OrderDetailPage.tsx     │ screen and echoes any path param
│       ├── MyOrdersPage.tsx        │ (FR-002). Content arrives in UI-02…07.
│       ├── WalletPage.tsx          │
│       ├── MyAgentsPage.tsx        │
│       ├── CreateAgentPage.tsx     ┘
│       └── NotFoundPage.tsx        catch-all with a link home (FR-005)
├── .env.example                    VITE_API_URL, documented
├── Dockerfile                      node:24-alpine, vite --host 0.0.0.0
├── docker-compose.yml              per project-structure §3.2
├── index.html
├── package.json
├── tsconfig.json
└── vite.config.ts
```

**Structure Decision**: Follows the layout already fixed in `docs/project-structure.md` §2 — `src/pages`, `src/components`, `src/api`, and a `src/chain/` directory that this feature does **not** create (wagmi and viem arrive with UI-02; an empty directory now would be a promise, not a structure). Added beyond §2: `src/hooks/`, `src/lib/`, and `src/routes/`, each holding shared machinery that three or more later features consume and that has nowhere sensible to live under the documented four.

The `pages/`-holds-placeholders convention matters more than it looks: each later feature replaces exactly one file's contents, so two features touching different screens never collide.

## Implementation Order

Dependency-ordered, matching the spec's story priorities. Each step is independently verifiable against the corresponding part of [quickstart.md](./quickstart.md).

| # | Step | Story | Verify |
| --- | --- | --- | --- |
| 1 | Scaffold: `package.json`, `tsconfig.json`, `vite.config.ts`, `index.html`, `main.tsx`, `index.css` | — | `npm run dev` serves a page |
| 2 | `config.ts` + `.env.example` | — | Quickstart B3 |
| 3 | `routes/paths.ts`, nine page placeholders, `AppRoutes.tsx`, `AppShell.tsx` (header without the widget) | US1 | Quickstart **Part A** |
| 4 | `api/errors.ts`, `api/session.ts`, `api/client.ts`, `checkHealth` | US2 | Quickstart **Part B** |
| 5 | `hooks/usePolling.ts` | US3 | Quickstart **Part C** |
| 6 | `lib/money.ts`, `api/types.ts`, `api/me.ts`, `BalanceWidget.tsx` into the shell | US4 | Quickstart **Part D** |
| 7 | `Dockerfile`, `docker-compose.yml` | US5 | Quickstart **Part E** |

Steps 3 and 5 need no backend and can be done and verified offline. Step 6 is the first that requires the API to be up.

**Stop-and-check after step 5.** Steps 3–5 are the whole of what UI-02 depends on; if the polling mechanism is right, the rest of the frontend inherits it. Steps 6 and 7 are valuable but neither blocks the next feature.

## Complexity Tracking

No constitution gates exist to violate, so this table is empty by construction rather than by virtue.

One dependency is worth naming as a judgement call rather than a violation: **`@tanstack/react-query` is introduced one feature before it is strictly required**. It is not speculative — `wagmi@3` makes it mandatory in UI-02 — but it is early, and the alternative (60 dependency-free lines) was genuinely close. The reasoning is in R4; if you disagree, the swap is one file and no caller changes.
