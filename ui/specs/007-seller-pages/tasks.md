---

description: "Task list for 007-seller-pages"
---

# Tasks: Seller pages — joining the marketplace, and the other side of a dispute

**Input**: Design documents from `/specs/007-seller-pages/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/internal-api.md](./contracts/internal-api.md), [quickstart.md](./quickstart.md)

**Tests**: **None.** No unit, integration, or e2e tests are written for this component — a deliberate, time-boxed MVP decision recorded in `ui/docs/CONTEXT.md` and restated as FR-043. Every task below carries its verification as a [quickstart.md](./quickstart.md) reference instead, and those are run by hand.

**Organization**: Grouped by user story. Each story is an independently demonstrable increment.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: different file, no dependency on an incomplete task — safe to run concurrently
- **[Story]**: US1–US4, matching [spec.md](./spec.md)
- Paths are relative to `ui/` unless stated otherwise

**Two files are touched by more than one story and therefore gate concurrency**: `src/components/OwnedAgentList.tsx` (US2 builds it, US4 replaces its availability cell) and `src/index.css` (every story). The stories stay independently *testable*; they are not independently *editable*. Repeated under Dependencies.

---

## Phase 1: Setup

**Purpose**: Establish the premises the rest of the plan rests on. No code.

- [X] T001 **Confirm rather than negotiate.** Every rule this feature would have had to ask for is already written down — api-design §3.3 and §3.4, and the API briefs themselves: `GET /agents?owner=me` includes inactive agents (API-06, called out twice), the three order reads authorise the **buyer *or* the agent's owner** (API-07 acceptance, API-09), and `POST /agents` **awaits the `registerAgent` receipt** before answering (API-06). Read [contracts §11.3–11.5](./contracts/internal-api.md), confirm nothing has drifted, and note the ownership split: **API-06** unblocks US1, US4, and the agents half of US2; **API-07 + API-09** unblock US3 and the sales half of US2. Nothing here needs a decision from anyone.
- [X] T002 Verify the baseline before touching anything: `npm run typecheck`, `npm run build`, `npm run dev`, and confirm `/sell` and `/sell/new` both currently render the `PagePlaceholder` from `src/pages/MyAgentsPage.tsx` and `src/pages/CreateAgentPage.tsx`. **Note: there is no `npm run lint`.** This component has no ESLint script, config, or dependency — earlier specs in this series ask for one, and running it produces an npm error that reads like a broken checkout. `tsc --noEmit` under `strict` plus `noUncheckedIndexedAccess` is the only static gate this repo actually has, which is worth knowing before relying on a lint pass to catch anything below.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The shared unwrap, the wire types, the API layer, and the three pure modules every story reads from.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [X] T003 Create `src/lib/listEnvelope.ts` exporting `unwrapList<T>(payload: unknown, keys: readonly string[]): T[]` — accepts a bare array or a single-key envelope around one, returns `[]` for anything else rather than throwing. The module comment must preserve the argument both existing copies carry: this belongs in `lib/`, called explicitly by each fetcher with its own keys, and **not** in `client.ts`, where a future endpoint would inherit it by accident (R16).
- [X] T004 Replace the private `unwrapList` in `src/api/agents.ts` and the private `unwrapEntries` in `src/api/wallet.ts` with calls to `unwrapList` from T003, passing `['agents','items','data']` and `['entries','items','data']` respectively. Pure refactor — no behaviour change, no signature change. Keys stay per-caller; a shared union would let `GET /sales` accept an `agents` envelope (R16). Depends on T003.
- [X] T005 Add `Sale`, `OwnedAgent`, `CreateAgentRequest`, and `SetAgentActiveRequest` to `src/api/types.ts` per [data-model.md §1](./data-model.md). **`Order` is not touched** — the `OrderIdentity` extraction was withdrawn when api-design §3.4 opened `GET /orders/:id` to the seller (R3). Document on `OwnedAgent` that the absent `systemPrompt`/`model` fields are the FR-037 guarantee, not an oversight, and on `SetAgentActiveRequest` that the value is absolute rather than a toggle instruction (R9).
- [X] T006 Add `fetchOwnedAgents`, `createAgent`, and `setAgentActive` to `src/api/agents.ts` per [contracts §2](./contracts/internal-api.md). Ids through `encodeURIComponent`. **Two doctrines, stated apart and both in writing**: `createAgent` is non-idempotent — inserts an agent, inserts version 1, calls `registerAgent` on-chain, then answers, so silence is unresolvable and it is never retried automatically (R10); `setAgentActive` is **idempotent by construction** because the client sends an absolute value, so the paragraph above must not be copied onto it (R9). Depends on T004, T005.
- [X] T007 [P] Create `src/api/sales.ts` with `fetchSales(): Promise<Sale[]>` calling `GET /sales`, unwrapping with keys `['sales','items','data']`. Its own file rather than an addition to `api/orders.ts`, on the precedent `api/verdicts.ts` set: that file is the buyer's order lifecycle and its rule about writes has nothing to say about a seller's read ([contracts §3](./contracts/internal-api.md)). Depends on T003, T005.
- [X] T008 [P] Create `src/lib/perspective.ts` exporting `export type Perspective = 'buyer' | 'seller'`, with a comment explaining why it is its own module: three components and two pages share it and none of them owns it, and it selects copy only — never layout, never which fields render, never arithmetic (R2).
- [X] T009 [P] Add an optional second parameter to `parseUsd` in `src/lib/money.ts`: `options?: { ceilingMessage?: string }`. Purely additive — the default message, `TREASURY_CEILING_CENTS`, the integer-only arithmetic, and every existing call site are unchanged. Document why the *number* stays shared while the sentence varies: both ceilings guard the same slipped decimal at the same magnitude, and a second constant would imply a pricing policy this product does not have (R14).
- [X] T010 [P] Create `src/lib/agentDraft.ts` per [contracts §5](./contracts/internal-api.md): `parseSchemaText(text, subject)`, `cleanTerms(terms)`, and `buildCreateAgentRequest(fields)`. Pure — no React, no fetch, no module state, and it must never throw for any input. `parseSchemaText` checks **well-formedness and plain-object-ness only** and nothing further (R12); the `subject` parameter is what makes a broken output contract say "output" (quickstart A7). `buildCreateAgentRequest` reports **every** failure in one pass, keyed by form field name. Depends on T005.
- [X] T011 [P] Add `sellerSale: '/sell/sales/:id'` to `routePatterns` and `sellerSale: (id: string) => `/sell/sales/${id}`` to `paths` in `src/routes/paths.ts`. The route itself is registered in US3 (T030); the builder lands here because US2's sales rows link with it.

**Checkpoint**: `npm run typecheck` and `npm run build` clean. Quickstart **F8** prints exactly one `unwrapList` definition, and **F9** shows both doctrine paragraphs in `api/agents.ts`.

---

## Phase 3: User Story 1 — List an agent (Priority: P1) 🎯 MVP

**Goal**: A person who has never sold here fills in a form and their agent is in the marketplace beside the seeded ones.

**Independent Test**: On a signed-in account, complete the form end to end and confirm the new agent appears in the public marketplace and opens like any other listing — with no seeded data and no other screen from this feature required.

- [X] T012 [P] [US1] Create `src/components/TermListField.tsx`: an ordered list of single-line terms, each individually removable, with an add control. Props `{ label, hint, terms, disabled, onChange, addLabel }`. The `hint` renders adjacent to the control and is **always visible** — FR-013 requires it read before the seller types, and a lede at the top of a nine-field form is scrolled past (R13). Holds no validation; `cleanTerms` runs at assembly.
- [X] T013 [P] [US1] Create `src/components/SchemaTextArea.tsx`: a labelled raw JSON textarea with hint and error slots. Props `{ label, hint, value, error?, disabled, onChange, id }`. **No parsing of its own** — the page calls `parseSchemaText` and hands back a message, exactly as `AmountField` delegates to `parseUsd`. No schema builder, field adder, or type picker (FR-015).
- [X] T014 [US1] Replace the `PagePlaceholder` in `src/pages/CreateAgentPage.tsx` with the form: name, description, price (`AmountField`), capabilities and exclusions (two `TermListField`s with the two hints from [research R13](./research.md)), input and output contracts (two `SchemaTextArea`s), system prompt, and model. The model field is an `<input list>` backed by a `<datalist>` of `claude-haiku-4-5` and `claude-sonnet-5`, pre-filled with the first — free text, so the backend stays the authority (R15). Depends on T012, T013.
- [X] T015 [US1] Wire submission validation in `src/pages/CreateAgentPage.tsx`: call `buildCreateAgentRequest`, map returned errors onto their controls by field name, and **submit nothing** when any error is present. The price passes `ceilingMessage: 'Enter a price under $10,000 — anything higher is almost certainly a slipped decimal.'` (FR-016, FR-018, FR-019). Depends on T014.
- [X] T016 [US1] Add the mutation in `src/pages/CreateAgentPage.tsx`: `useMutation` over `createAgent`, guarded by a `useRef` written **synchronously** — `isPending` and the `disabled` attribute both come from state and several activations in one frame read the same stale `false` (R10). On settle, invalidate `['agents','mine']` and `['agents']`; on success, navigate to `paths.sell()` (FR-020, FR-021). Depends on T015.
- [X] T017 [US1] Add the two failure branches in `src/pages/CreateAgentPage.tsx`: a refusal (any 4xx) shows its reason in place, keeps every entered value, and re-enables submit; a connectivity failure sets `ambiguous`, locks the control, offers **no retry**, and points at `/sell` — following `BuyPanel`'s shape and `api/orders.ts`'s rule (FR-022, R10). Depends on T016.
- [X] T018 [P] [US1] Style the create form in `src/index.css`: term rows, schema textareas (reuse the existing raw-JSON block's conventions), field hints as visibly informational rather than as warnings, and the nine fields legible on a demo laptop.

**Checkpoint**: Quickstart **Part A** end to end with the API stopped, then **Part B** once `POST /agents` exists. US1 is demonstrable alone — it is the answer to "can anyone sell here?", and nothing else in this feature is needed to give it.

---

## Phase 4: User Story 2 — See my agents and my sales (Priority: P1)

**Goal**: The seller's home — their listings and their sales, each list with its own empty, loading, and failure states.

**Independent Test**: Sign in with an account that owns agents and has sales; both lists render, and breaking one endpoint leaves the other working.

- [X] T019 [P] [US2] Create `src/hooks/useOwnedAgents.ts`: `usePolling(['agents','mine'], fetchOwnedAgents, { intervalMs: 5000 })`, no terminal predicate. The comment carries R6 — this cadence contradicts `docs/ui-design.md` §5's "Load only" for this page, deliberately, because the sales list beside it is the entire notification mechanism behind `docs/product-workflow.md` §7.5.
- [X] T020 [P] [US2] Create `src/hooks/useSales.ts`: `usePolling(['sales'], fetchSales, { intervalMs: 5000 })`, no terminal predicate. **List page only** — the dispute screen reads the order directly through `useOrder` and must not acquire a `useSale` here (R7).
- [X] T021 [P] [US2] Create `src/components/OwnedAgentList.tsx`: name, price, and availability per row, plus its own `LoadState` empty ("You have not listed an agent yet", with the way to list one) and error-with-retry branches. **Inactive agents render alongside active ones, visibly distinguished, never filtered** (FR-003) — availability is a read-only label at this stage; US4 replaces that cell with a control.
- [X] T022 [P] [US2] Create `src/components/SalesList.tsx`: agent name, amount, state via `stateLabel`, and time per row, each row linking to `paths.sellerSale(sale.id)`. A sale with `disputedAt !== null` is visibly distinguished — a fact rather than `state === 'settled'`, which would miss a dispute still in flight (FR-005, FR-009). Own empty and error branches. An unrecognised state still renders its row.
- [X] T023 [US2] Replace the `PagePlaceholder` in `src/pages/MyAgentsPage.tsx` with the composition: heading, the "list an agent" link reachable without scrolling past either list (FR-008), then the two sections driven by T019 and T020. Two independent queries, so one list's failure cannot take the other down (FR-007). Depends on T019–T022.
- [X] T024 [P] [US2] Style the two sections in `src/index.css`: each scrolls within its own region when long, leaving the other reachable (FR-010); available and unavailable distinguishable by word, not colour alone.

**Checkpoint**: Quickstart **Part C** (C1–C11). Note that a sales row currently lands on `NotFoundPage` — the route is registered in T030. That is the one edge of this story that is not self-contained, and it is deliberate: US3 owns the screen.

---

## Phase 5: User Story 3 — See a dispute against me, and that there is no reply (Priority: P2)

**Goal**: The full case file, the verdict, and a screen that reads as a scope decision rather than a missing feature.

**Independent Test**: With an account owning an agent whose order was disputed and ruled on, open that sale and confirm the case file and verdict both render in full and that no reply, appeal, or response control exists anywhere.

- [X] T025 [P] [US3] Add a **required** `perspective: Perspective` prop to `src/components/CaseFilePanel.tsx`, selecting three strings: the `<summary>` text, "What you submitted" → "What the buyer submitted", and "Your acceptance criteria" → "The buyer's acceptance criteria". Copy only — no layout, no field, no branch changes (R2, [data-model §2](./data-model.md)).
- [X] T026 [P] [US3] Add a **required** `perspective: Perspective` prop to `src/components/CitationChecklist.tsx`, selecting two strings: the note's "the criteria **you** wrote" → "the criteria **the buyer** wrote", and `sourceLabel('criterion')` "Your criterion" → "The buyer's criterion". `'capability'` and `'exclusion'` do **not** vary — those are facts about the clause, not about the reader.
- [X] T027 [US3] Add a **required** `perspective: Perspective` prop to `src/components/VerdictCard.tsx`, selecting the two `Split` labels ("You get back"/"The seller keeps" → "The buyer gets back"/"You keep") and forwarding it to `CitationChecklist`. `order: Order` is unchanged, `splitFor`/`tierDisplay` are untouched, and `TxHashLink` needs no perspective. Depends on T026.
- [X] T028 [US3] Pass `perspective="buyer"` at the four existing call sites in `src/pages/OrderDetailPage.tsx` — `VerdictCard` in `ArbitrationFace` and `ConcludedFace`, `CaseFilePanel` in both. **No default anywhere**: a forgotten prop must be a compile error, not a screen that addresses a seller as the buyer (R2). Depends on T025, T027.
- [X] T029 [US3] **Regression gate.** Confirm nothing changed on the buyer's order screen, *before* the seller's screen is built on top. Depends on T028. The gate has two tiers, because the orders module does not exist yet: **today** it is `npm run typecheck` plus a diff review confirming the three components changed strings only — no layout, no logic, no `splitFor`/`tierDisplay`/`normaliseVerdict`, and no defaulted `perspective`. **The moment `GET /orders/:id`, `/case-file`, and `/verdict` exist**, re-run UI-04's and UI-05's own acceptance in full — the arbitration and concluded faces, the verdict card, the citation checklist, the case file, the explorer link — and do it before the demo, not after. A string-only diff is good evidence and not proof.
- [X] T030 [US3] Register `routePatterns.sellerSale` in `src/routes/AppRoutes.tsx` inside `RequireAuth`, beside the two existing `/sell` routes, rendering `SellerSalePage` (FR-041).
- [X] T031 [US3] Create `src/pages/SellerSalePage.tsx`: read the route id, call the existing `useOrder(id)` — **not** a new hook and **not** the sales list (R7) — and render `OrderSummaryHeader` unchanged plus a breadcrumb back to `/sell`. Handle `notFound` as a dead end ("this order does not exist, or it was not placed against one of your agents") and `stale` as a quiet notice over a screen that still reads correctly, both mirroring `OrderDetailPage`. Depends on T030.
- [X] T032 [US3] Compose the evidence in `src/pages/SellerSalePage.tsx`: `useVerdict(order.id, order.state)` and `useCaseFile(order.id, order.disputedAt !== null)`, both unchanged, rendering `VerdictCard` and `CaseFilePanel` with `perspective="seller"`. `defaultOpen` follows the buyer's rule — open while no ruling has landed, collapsed once the verdict renders above it. Each panel keeps its own failure surface, so neither can blank the other (FR-030, FR-031, FR-034, FR-035). Depends on T031, and on T025/T027 for the prop.
- [X] T033 [US3] Add the two remaining branches to `src/pages/SellerSalePage.tsx`: the sentence beneath the verdict — notified, verdicts are final, no reply is collected **from either side** (FR-033, wording in [research R18](./research.md)) — and the never-disputed case, which renders the sale plus a statement that there is no dispute rather than an error or an empty case file (FR-036). **No reply, appeal, respond, contest, or comment control is added anywhere, in any state, disabled or otherwise** (FR-032). Depends on T032.
- [X] T034 [P] [US3] Style the dispute screen in `src/index.css`: the summary band, the verdict and case file spacing, and the no-appeal sentence as an explanation rather than a warning. A long output or step list scrolls in its own region without pushing the verdict off screen.

**Checkpoint**: Quickstart **Part E** (E1–E19) and **F1**, **F3**. E16 and E17 are the two that confirm R7 landed — 1s while live, all three reads stopped once settled.

---

## Phase 6: User Story 4 — Take a listing off the market, and put it back (Priority: P3)

**Goal**: A seller controls whether their agent is on sale, and the marketplace agrees.

**Independent Test**: On an account owning an available agent, switch it off, confirm the marketplace no longer offers it, switch it on, confirm it returns.

- [X] T035 [US4] Create `src/components/AvailabilityToggle.tsx`: one row's `PATCH` through `setAgentActive`, taking `{ agent: OwnedAgent }`. **No optimistic value is held anywhere** — the switch renders the server's answer only, because the list polls underneath it and an optimistic switch would move, revert on the next poll, then move again for one click (R8, FR-025, FR-027). Disabled while in flight; a shared `useRef` guard so two `PATCH`es cannot race to opposite values (FR-026). On settle, invalidate `['agents','mine']` **and** `['agents']`, so the public catalogue agrees on the next visit.
- [X] T036 [US4] Replace the read-only availability cell in `src/components/OwnedAgentList.tsx` with `AvailabilityToggle`, and surface a failed change beside its own row with the reason, leaving the rest of the screen undisturbed (FR-027, FR-028). Depends on T035, and on T021 having landed.
- [X] T037 [P] [US4] Style the toggle and its per-row error in `src/index.css`: a quiet control, no danger colour — switching a listing off is routine and reversible, following the `.wallet-menu` disconnect precedent.

**Checkpoint**: Quickstart **Part D** (D1–D8). **D4** (no flicker to the attempted state) and **D8** (an agent switched off is still listed after a reload) are the two that fail quietly.

---

## Phase 7: Polish & Cross-Cutting Concerns

- [X] T038 Run the boundary sweep, quickstart **Part F** F1–F10. F1 (no reply affordance), F2 (nothing renders an execution spec), and F5 (no defaulted perspective) are the three that guard requirements satisfied by an *absence*, which is the kind that regresses silently.
- [ ] T039 **BLOCKED — needs a rendered screen.** [P] Greyscale checks **F11** and **F12**: available/unavailable and disputed/ordinary distinguishable by word on `/sell`, and every ✓/✗ readable as a word on the dispute screen.
- [ ] T040 **BLOCKED — needs API-06, API-07, API-09.** Every seller route is behind `RequireAuth`, and signing in needs `POST /auth/*` plus a wallet, so no screen in this feature has been rendered even once. `tsc --noEmit` and `vite build` are the only gates that have actually run. Run quickstart **Part G** — the full acceptance, including the two human checks: a first-time seller listing an agent unaided in under 5 minutes (SC-001), and a seller reading their dispute screen knowing without asking that there is no appeal (SC-006).

---

## Dependencies & Execution Order

### Phase dependencies

- **Setup (Phase 1)**: no dependencies. T001 should go out first — it is the only task with a lead time attached to someone else.
- **Foundational (Phase 2)**: blocks every story. T003 → T004 → T006 is the one hard chain; T007–T011 fan out once T005 lands.
- **US1 (Phase 3)** and **US2 (Phase 4)**: both P1, both start once Phase 2 is done, and they share no file. Genuinely parallel.
- **US3 (Phase 5)**: independent of US1 and US2 in code. Its one soft edge is that US2's sales rows have nowhere to land until T030.
- **US4 (Phase 6)**: needs T021 (`OwnedAgentList`) to exist before T036 edits it. Otherwise independent.
- **Polish (Phase 7)**: after whichever stories are being shipped.

### Cross-story file contention

| File | Stories | Rule |
| --- | --- | --- |
| `src/index.css` | US1, US2, US3, US4 | Append per story in its own commented section; never edited concurrently |
| `src/components/OwnedAgentList.tsx` | US2 (T021), US4 (T036) | US4 waits for T021 |
| `src/pages/SellerSalePage.tsx` | US3 (T031→T032→T033) | Strictly sequential |
| `src/pages/CreateAgentPage.tsx` | US1 (T014→T017) | Strictly sequential |

### Within each story

- Pure modules and components before the page that composes them.
- The perspective props (T025–T027) before their call sites (T028), and **T029 before any seller screen is built on them**.
- No tests to fail first — every checkpoint is a quickstart part run by hand.

---

## Parallel Example: after Foundational lands

```bash
# T005 done, T003/T004 done. Six files, no shared edits, none importing another:
Task: "T007 Create src/api/sales.ts"
Task: "T008 Create src/lib/perspective.ts"
Task: "T009 Add ceilingMessage to parseUsd in src/lib/money.ts"
Task: "T010 Create src/lib/agentDraft.ts"
Task: "T011 Add sellerSale pattern and builder to src/routes/paths.ts"
```

```bash
# Both P1 stories, once Phase 2 is complete — two developers, no contention until index.css:
Developer A: T012 → T013 → T014 → T015 → T016 → T017    (US1, the create form)
Developer B: T019 → T020 → T021 → T022 → T023           (US2, the seller's home)
```

---

## Implementation Strategy

### MVP (US1 only)

1. Phase 1 → Phase 2 → Phase 3.
2. **Stop and validate**: quickstart Part A, then Part B once `POST /agents` exists.
3. What you have is the feature's actual argument. The marketplace stops being a catalogue someone else populated, and the obvious question from the floor — *can anyone list an agent?* — has an answer you can demonstrate live.

### Incremental delivery

1. Foundation → **US1** (the form — the proof anyone can join)
2. → **US2** (the seller's home — where a listing lands, and the only place a dispute is announced)
3. → **US3** (the other side of a dispute — the half that makes adjudication look even-handed)
4. → **US4** (the toggle — the smallest piece of real ownership on the screen)

### A note on build order versus priority

The phases above run in spec priority order. [plan.md](./plan.md)'s implementation order swaps the last two, doing US4 before US3, for one reason: **US3 touches the demo's most persuasive artefact** (T025–T029), and that is work to schedule when rested rather than at the end of a long day. Either order is correct — the two stories are independent — so take the swap if it suits, and keep T029 as the gate either way.

### What is buildable today (checked 2026-08-09)

`grep -rn "@Controller(" api/src/` returns **auth, health, accounts, funding, rain**. There is no catalogue module and no orders module, so none of this feature's four endpoints exists — and neither do `GET /agents`, `GET /orders/:id`, `/case-file`, or `/verdict`, which means the shipped marketplace and order screens cannot be exercised live either.

| Tasks | State |
| --- | --- |
| T001–T011 (Setup, Foundational) | **Fully buildable and verifiable.** Types, pure modules, and the API layer need no server |
| T012–T018 (US1) | **Buildable**; quickstart Part A passes with the API stopped. Part B waits on `POST /agents` **and** `GET /agents` |
| T019–T024 (US2) | **Buildable**; renders its empty and error branches honestly, which is most of C3–C7. C1–C2 and C8 wait on `GET /agents?owner=me` and `GET /sales` |
| T025–T028 (US3 perspective) | **Buildable**; typecheck-verifiable |
| T029 | **Half-runnable** — see the task; the live half waits on the orders module |
| T030–T034 (US3 screen) | Buildable, unverifiable. Part E needs all three order reads |
| T035–T037 (US4) | Buildable, unverifiable. Part D needs `PATCH` and both agent lists |

Roughly 26 of 40 tasks can be finished and checked without waiting on anyone. The remainder are written and then sit until **API-06** (catalogue — US1, US4, the agents half of US2) and **API-07 + API-09** (orders and the verdict — US3, the sales half of US2) land. See [contracts §11.5](./contracts/internal-api.md).

### If the API slips

Phases 1–2 plus all of US1's validation path (T010, T012–T015) are worth landing regardless: quickstart **Part A** is a complete acceptance run for the create form needing nothing but the dev server, and form validation is the part nobody returns to once agents are listing successfully.

---

## Notes

- **No tests, by decision.** Every checkpoint above is a quickstart part run by hand, and the demo rehearsal is the real regression check.
- `[P]` = different file, no dependency on an incomplete task.
- Commit after each task or logical group.
- **Three departures from written-down rules are deliberate and argued**: polling `/sell` where `docs/ui-design.md` §5 says load-only (T019, T020 — R6), extracting the envelope unwrap where two files say it is deliberately not generalised (T003 — R16), and exempting `setAgentActive` from the non-idempotency doctrine two other files state emphatically (T006 — R9). Each carries its reasoning in [research.md](./research.md); none is an oversight, and a reviewer who finds them should read the R-number before "fixing" them.
- **Two decisions were withdrawn during planning** after api-design §3.3 and §3.4 were amended: no `OrderIdentity` extraction (R3) and no `useSale` (R7). If either appears in a diff, it is a revival of something the doc made unnecessary.
