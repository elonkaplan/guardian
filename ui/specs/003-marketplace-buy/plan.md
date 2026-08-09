# Implementation Plan: Marketplace & Agent Detail

**Branch**: `003-marketplace-buy` | **Date**: 2026-08-08 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/003-marketplace-buy/spec.md`

## Summary

Turn two placeholder screens into the catalogue and the purchase, and capture the two documents every later verdict is judged against: the seller's declared capabilities and exclusions, read; and the buyer's acceptance criteria, written.

The technical approach is deliberately thin. No new dependencies, no new environment variables, no new persisted state. Three genuinely new pieces of logic — a schema-to-form mapping (`lib/inputSchema.ts`), an affordability derivation that shares the balance query the shell is already polling, and a purchase mutation that treats "no answer" differently from "refused" because the purchase is not idempotent. Everything else is `useQuery`, existing components, and the `paths` module.

Roughly ten new files under `src/api/`, `src/lib/`, `src/hooks/`, and `src/components/`, plus two page rewrites and three additive edits. The decisions a reviewer should push on are all in Key Decisions below; the one change to the spec made during planning is R10.

## Technical Context

**Language/Version**: TypeScript 5.9.3, React 19.2.8. Unchanged strict settings.

**Primary Dependencies**: **None added.** Existing: `@tanstack/react-query@5.101.4` (queries, and `useMutation` for the purchase), `react-router-dom@7.18.2`. wagmi and viem are *not* used by this feature — nothing here touches a wallet.

**Storage**: None. No `localStorage` keys, no new query persistence. Form values live in component state and are intentionally lost on navigation.

**Testing**: **None.** No unit, integration, or e2e tests — an explicit project decision (`ui/docs/CONTEXT.md`), restated as FR-031. Acceptance is by hand via [quickstart.md](./quickstart.md); Part G is the set of checks a reviewer would otherwise have to remember.

**Target Platform**: Desktop Chrome on a demo laptop, at roughly 1280×800 — the viewport SC-002 is measured at.

**Performance Goals**: Catalogue-to-order in under 90 seconds including typing real acceptance criteria (SC-001). No perceptible cost from the affordability check, which is why it must not add a request (research R8).

**Constraints**: No wallet signature and no chain call anywhere in this feature (FR-029) — the purchase is one authenticated backend call. No code path capable of rendering a seller's `system_prompt` (FR-011), enforced by the payload type having no such property. Money is integer cents end to end; the only arithmetic performed is one shortfall subtraction on integers.

**Scale/Scope**: 10 new files, 4 edited, 3 backend endpoints consumed — **none of which exist yet** (API-06 and API-07 are unbuilt; see Risks). One developer, hours not days.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

**Status: NOT EVALUATED — no ratified constitution exists.**

`.specify/memory/constitution.md` is still the unmodified Spec Kit template: every principle reads `[PRINCIPLE_N_NAME]`, the version reads `[CONSTITUTION_VERSION]`. There are no gates to check against, so this section cannot honestly pass or fail.

This is the **third consecutive feature** to record that. UI-01's plan said the moment to fix it was before UI-02; UI-02's plan said the moment was now. It is now demonstrably not going to happen mid-hackathon, and pretending otherwise each time is worse than stating it plainly: the substitute is `quickstart.md` Part G, which turns this feature's four structural rules — no `systemPrompt` anywhere, no signing call, no hidden exclusions, no added dependency — into `grep`s a reviewer runs in thirty seconds. That is a weaker guarantee than a gate and a real one.

**Post-Phase 1 re-check**: unchanged. No constitution was added during planning.

## Key Decisions

Full reasoning in [research.md](./research.md). The five worth arguing about:

| Decision | Why | Reversibility |
| --- | --- | --- |
| **Build against API-06/API-07 before they exist, isolating every shape assumption in three files** (R1, R2) | The two components were specified to run in parallel and the shapes are not guesswork — `api-design.md` §3.4 fixes the purchase body, `api/specs/002-entities-migrations` §4 fixes the columns behind the listing. Waiting serialises the two workstreams for no design benefit. camelCase is chosen because it is what the one documented JSON body uses. | A rename inside `src/api/types.ts` plus two wrappers. Caught on the first real integration load. |
| **Exactly one shape tolerance — the catalogue list envelope** (R3) | A wrong field name renders as a blank price: visible. A list envelope read as an array renders as *"no agents are listed yet"*: plausible, silent, and an empty stage in a demo. Only the asymmetric failure earns a defensive branch, and generalising it would hide the mismatches we want surfaced. | Four lines in `fetchAgents`. |
| **Hand-rolled schema→form, no `@rjsf/core`** (R4, R5) | rjsf is four packages (`core`, `utils`, `validator-ajv8`, a theme) with its own markup, to render what the spec restricts to flat objects of primitives. The supported subset is ~120 lines of pure function, and the raw-JSON fallback means no seller schema can make a listing unbuyable. | Structural — but the fallback is the escape hatch, so the blast radius of being wrong is one ugly form, not a blocked purchase. |
| **The buy panel subscribes to the `['me']` query the shell already polls** (R8) | `BalanceWidget` polls `['me']` every 5s on every screen. A second `useQuery` on that key is a cache subscription, not a request: zero extra traffic, and a top-up in another tab unblocks the button on its own. A separate `fetchMe` would create a second source of truth for a number already in the header, able to disagree with it for five seconds. | One hook. |
| **A purchase that gets no answer is never offered a retry** (R12) | `POST /orders` is not idempotent — API-07 commits the order and the ledger debit together, then responds. A 10s client timeout says nothing about whether that committed, so "try again" is how a buyer pays twice. The buyer is sent to `/orders`, where the truth is. A refusal (`kind === 'http'`) is the opposite case and does offer correct-and-retry. | Copy and one branch — but reversing it is a money bug, not a UX change. |

### One spec correction was made during planning

**FR-030 was rewritten** (research R10). It said both screens require an authenticated session; that contradicts the existing router, where UI-01/UI-02 deliberately left `/agents` and `/agents/:id` public with a comment explaining that `api-design.md` §3.3 makes both endpoints public and guarding them client-side would make the product feel closed for no reason. That reasoning is better than the requirement, so browsing stays open and **buying** is what requires a session. `RequireAuth`'s existing `state={{ from: location }}` handling gives the return-to-agent behaviour with no new work.

One further divergence is **not** a correction: the spec's Assumptions say this screen re-reads the balance on return rather than on a timer. Because of R8 it inherits the shell's 5s poll and is live. That satisfies FR-027 more strongly than written, so the requirement stands as-is — but a reader comparing the two documents should know why they differ.

## Project Structure

### Documentation (this feature)

```text
specs/003-marketplace-buy/
├── plan.md              # This file
├── spec.md              # Feature specification
├── research.md          # Phase 0 — 13 resolved decisions
├── data-model.md        # Phase 1 — payload types, form model, query keys, validation
├── quickstart.md        # Phase 1 — the manual acceptance run (Parts A–G)
├── contracts/
│   └── internal-api.md  # Phase 1 — module surface + the API-06/API-07 handoff (§8)
├── checklists/
│   └── requirements.md  # Spec quality checklist
└── tasks.md             # Phase 2 — created by /speckit-tasks, not here
```

### Source Code (repository root)

```text
ui/src/
├── api/
│   ├── agents.ts                   NEW — fetchAgents, fetchAgent (+ the one envelope unwrap)
│   ├── orders.ts                   NEW — createOrder; grows accept/complain in UI-04
│   └── types.ts                    EDIT — + AgentSummary, AgentListing, JsonSchema,
│                                          CreateOrderRequest, CreateOrderResponse
├── lib/
│   └── inputSchema.ts              NEW — buildInputForm, buildPayload, validateFields,
│                                          parseRawInput. Pure; never throws
├── hooks/
│   └── useAccountSummary.ts        NEW — subscribes to ['me']; adds no request
├── components/
│   ├── AgentCard.tsx               NEW — one catalogue card
│   ├── ContractTerms.tsx           NEW — capabilities + exclusions, always in full
│   ├── SchemaFields.tsx            NEW — generated controls, or the raw JSON fallback
│   ├── AcceptanceCriteriaField.tsx NEW — the textarea plus its consequence copy
│   ├── BuyPanel.tsx                NEW — form state, affordability, submit, navigation
│   └── LoadState.tsx               NEW — shared loading / error / empty rendering
├── pages/
│   ├── MarketplacePage.tsx         REWRITE — four-state grid
│   └── AgentDetailPage.tsx         REWRITE — listing, contract terms, buy panel
└── index.css                       EDIT — grid, terms, form, buy panel blocks
```

**Structure Decision**: no new directories. `src/components/` stays flat, as UI-01 and UI-02 left it — six components is not enough to earn a folder, and inventing `components/marketplace/` now would leave UI-04 guessing whether to add `components/order/`.

The one placement worth defending is `lib/inputSchema.ts`. It could have lived beside `SchemaFields.tsx`, but it is a pure data transformation with no React in it, which is exactly what `src/lib/` holds (`money.ts`, `queryClient.ts`). Keeping it separate also means the renderable predicate has one home that both the renderer and the payload builder read, rather than two components each deciding for themselves what "renderable" means.

`routes/paths.ts` is untouched: `marketplace()`, `agentDetail(id)`, `orderDetail(id)`, and `wallet()` all already exist. `AppRoutes.tsx` is untouched too — both routes are already declared, and per R10 neither gains a guard.

## Implementation Order

Dependency-ordered, matching the spec's story priorities. Each step is verifiable against the named part of [quickstart.md](./quickstart.md).

| # | Step | Story | Verify |
| --- | --- | --- | --- |
| 1 | `api/types.ts` additions; `api/agents.ts`; `api/orders.ts` | — | `npm run typecheck` clean |
| 2 | `components/LoadState.tsx`; rewrite `MarketplacePage.tsx`; CSS for the grid | US1 | **Part A** (offline), then **Part B** |
| 3 | `components/ContractTerms.tsx`; rewrite `AgentDetailPage.tsx` with terms above the buy slot | US2 | **Part C** |
| 4 | `lib/inputSchema.ts` — predicate, control mapping, payload, validation | US3 | Typecheck; feed it a nested schema and a `null` and confirm neither throws |
| 5 | `components/SchemaFields.tsx`; `components/AcceptanceCriteriaField.tsx` | US3, US5 | **Part D** |
| 6 | `hooks/useAccountSummary.ts`; affordability derivation inside `BuyPanel` | US4 | **Part F** (F7 is the one that matters) |
| 7 | `components/BuyPanel.tsx` — mutation, in-flight guard, `replace` navigation, the two failure branches | US3 | **Part E** (E3, E5, E6, E10) |
| 8 | Invalidate `['me']` after a successful purchase | US3 | Part E, E7 |
| 9 | Boundary sweep | — | **Part G** |

Steps 2 and 3 are worth landing before the API exists — Part A is the offline acceptance and catches the error-state work that is easy to skip when the happy path is available.

## Risks

| Risk | Impact | Response |
| --- | --- | --- |
| **API-06 and API-07 are not built.** All three consumed endpoints are assumptions. | Parts B–G of the quickstart cannot run. Field names may be wrong on first contact. | Deliberate (R1). [contracts/internal-api.md §8](./contracts/internal-api.md) is the diff list for the integration run, and the blast radius is three files. |
| **The list-vs-envelope shape** of `GET /agents`. | An empty catalogue that looks legitimate. | The one tolerance (R3), plus quickstart B2 which names it explicitly. |
| **A seller schema the form renders badly** but does not fall back on — e.g. a flat schema with fifteen properties. | An ugly but working form. | Accepted. The fallback covers *unbuyable*; ugly is not a demo blocker with three seeded agents. |
| **`POST /orders` timing out after committing.** | A buyer unsure whether they paid. | R12: no retry offered, sent to `/orders`. The real fix is an idempotency key, flagged for API-07 in contracts §8. |
| **No constitution**, third feature running. | Structural rules enforced by review only. | Part G converts the four that matter into greps. |

## Complexity Tracking

No constitution exists, so there are no violations to justify. Nothing in this plan adds a dependency, a directory, an environment variable, or a persisted key.
