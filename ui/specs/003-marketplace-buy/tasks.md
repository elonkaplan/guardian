---

description: "Task list for 003-marketplace-buy"
---

# Tasks: Marketplace & Agent Detail

**Input**: Design documents from `/specs/003-marketplace-buy/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/internal-api.md](./contracts/internal-api.md), [quickstart.md](./quickstart.md)

**Tests**: **None.** No unit, integration, or e2e tests — an explicit project decision (`ui/docs/CONTEXT.md`, restated as FR-031). Every story ends with a manual verification task pointing at the matching part of [quickstart.md](./quickstart.md). Those verification tasks *are* the test suite; do not skip them.

**Organization**: Grouped by user story so each is independently implementable and verifiable.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: US1–US5, mapping to the user stories in spec.md
- All paths are relative to `ui/`

---

## Phase 1: Setup

**Purpose**: Confirm the baseline and find out how much of the backend exists.

- [X] T001 Run `npm run typecheck` in `ui/` and confirm it is clean before any source change. **No `npm install` step exists for this feature** — it adds no dependencies, and `package.json` / `package-lock.json` must be untouched when it lands (research R4, quickstart G5)
- [X] T002 Check whether the backend endpoints exist yet: `curl "$VITE_API_URL/agents"` against the URL in `ui/.env.local`. Record the answer — if API-06 and API-07 are not built, Phases 2–4 are still fully deliverable against quickstart **Part A** (offline), and only Phases 5–7 stall. Note the response shape too: array or envelope (research R3)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The payload types, the catalogue wrappers, and the shared async-state component every story below builds on.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [X] T003 [P] Add `AgentSummary`, `AgentListing`, `JsonSchema`, `CreateOrderRequest`, and `CreateOrderResponse` to `src/api/types.ts` per [data-model.md §1](./data-model.md), carrying the same provisional-field-casing caveat the file already documents for `AccountSummary`. `capabilities`/`exclusions` are `string[]` **not optional**; `AgentListing` has **no** `systemPrompt`, `model`, or `timeoutSeconds` property and `CreateOrderRequest` has **no** price or review-window property — in both cases the absent property *is* the guarantee (FR-011, FR-021)
- [X] T004 Create `src/api/agents.ts` with `fetchAgents()` → `GET /agents` and `fetchAgent(id)` → `GET /agents/:id`, both via `apiGet`. `fetchAgents` normalises a single-key envelope (`agents` / `items` / `data`) to an array — **the only shape tolerance in the API layer**; do not generalise it (depends on T003; research R3, contracts §1)
- [X] T005 [P] Create `src/components/LoadState.tsx` rendering `'loading' | 'error' | 'empty'` with an optional `onRetry`, so the three states are visibly distinct and an empty catalogue can never be mistaken for a failed one (FR-003, contracts §5)

**Checkpoint**: Typecheck clean, no visible change yet.

---

## Phase 3: User Story 1 — Browse the catalogue and open a listing (Priority: P1) 🎯 MVP

**Goal**: Every active agent appears as a card with name, description, and price, and selecting one opens its detail screen.

**Independent Test**: Quickstart **Part A** (backend down — error and retry, no phantom empty state) then **Part B** (seeded backend — one card per agent, prices as currency, card opens the right agent).

- [X] T006 [P] [US1] Create `src/components/AgentCard.tsx` — name, description, and `formatUsd(agent.priceMinor)`, with the whole card as a link to `paths.agentDetail(agent.id)`. Route strings come from `routes/paths.ts`, never inline (FR-001, FR-002, FR-004)
- [X] T007 [US1] Rewrite `src/pages/MarketplacePage.tsx`: `useQuery({ queryKey: ['agents'], queryFn: fetchAgents })`, rendering four distinct states — loading, populated grid, empty catalogue, and error with a retry that refetches rather than reloading the page. **No search, filter, sort, pagination, or ratings controls** (depends on T004, T005, T006; FR-003, FR-005)
- [X] T008 [P] [US1] Add card-grid styles to `src/index.css` using the existing custom properties — no new tokens, no framework
- [ ] T009 [US1] Verify quickstart **Part A** and **Part B** (depends on T007, T008). B2 is the one that matters: a zero-card grid against a seeded backend means the envelope unwrap in T004 needs the real shape

**Checkpoint**: The catalogue works and is navigable. The detail screen is still a placeholder.

---

## Phase 4: User Story 2 — Read the contract terms before paying (Priority: P1)

**Goal**: Capabilities and exclusions are both fully visible on arrival, labelled as contract terms, and positioned ahead of where the buy action will be.

**Independent Test**: Quickstart **Part C** — count both lists against the seed data at a 1280×800 viewport, confirm no disclosure control exists, confirm a listing with no exclusions still says so, and confirm an unknown id gives a not-found state.

- [X] T010 [P] [US2] Create `src/components/ContractTerms.tsx` rendering both lists **in full, unconditionally**. It takes no `collapsed`, `limit`, or `expandable` prop and must never grow one — that missing prop is the mechanism by which "show more" would otherwise arrive later. An empty `exclusions` array renders explicit "the seller declared none" copy rather than nothing, and both lists are labelled as the terms a dispute is judged against, visually distinct from each other (FR-006, FR-007, FR-009, contracts §5)
- [X] T011 [US2] Rewrite `src/pages/AgentDetailPage.tsx`: `useQuery({ queryKey: ['agents', id], queryFn: … })`, a 404 branch giving a not-found state with a route back to `paths.marketplace()`, and a body carrying name, description, price, a human-readable statement of the required input derived from the schema's `title`/`description`, and the output shape. `ContractTerms` sits **above** the slot the buy panel will occupy — that ordering is a property of this file's JSX and is where a reviewer checks it (depends on T004, T005, T010; FR-008, FR-010, FR-012)
- [X] T012 [P] [US2] Add detail-screen and contract-terms styles to `src/index.css` — capabilities and exclusions must read as two different things at a glance
- [ ] T013 [US2] Verify quickstart **Part C**, including C5 (13" viewport) and C6 (a listing with no exclusions — seed one if the demo data has none) (depends on T011, T012)

**Checkpoint**: A buyer can read the whole contract. Nothing is purchasable yet.

---

## Phase 5: User Story 3 — Place an order and land on it (Priority: P1)

**Goal**: Fill the agent's inputs and acceptance criteria, buy once, and arrive on the created order.

**Independent Test**: Quickstart **Part D** (form rendering and local validation, D1–D8 and D10–D11) then **Part E** (a real purchase, the duplicate-submission check, back-navigation, and both failure branches).

- [X] T014 [P] [US3] Create `src/lib/inputSchema.ts` with `buildInputForm(schema)` returning the `InputForm` union. Implement the four-condition renderable predicate and the control mapping from [data-model.md §2](./data-model.md) — enum→select, boolean→checkbox, number/integer→number, string→textarea unless constrained short. **It must never throw**, whatever it is handed: `null`, a string, an array, and a nested schema all resolve to `mode: 'raw'` with a stated reason. Its input is arbitrary JSON that reached the database through a raw textarea (research R5, R6, contracts §3)
- [X] T015 [US3] Add `buildPayload`, `validateFields`, and `parseRawInput` to `src/lib/inputSchema.ts`. `buildPayload` omits blank **optional** fields rather than sending `""`, and never omits booleans. `validateFields` checks required-and-non-blank only — no `minLength`, `pattern`, or bounds; API-07 owns schema validation and a second partial implementation would eventually refuse what the backend accepts (depends on T014; research R7, data-model §5)
- [X] T016 [P] [US3] Create `src/api/orders.ts` with `createOrder(request)` → `POST /orders` via `apiPost`. Add the module comment stating the rule this file exists to hold: **the purchase is not idempotent — never retry it automatically** (depends on T003; contracts §2)
- [X] T017 [US3] Create `src/components/SchemaFields.tsx` rendering `form.mode === 'fields'` as labelled controls with required markers, help text from `description`, and per-field error slots — or `mode: 'raw'` as one JSON textarea with the reason and the pretty-printed schema beside it. The mode is read from the form, never re-derived (depends on T014; FR-013, FR-014)
- [X] T018 [P] [US3] Create `src/components/AcceptanceCriteriaField.tsx` — a required multi-line control with label and error slot. Consequence copy, guidance, and the soft warning are US5's job; leave the `warning` prop in the signature and unused for now (FR-015)
- [X] T019 [US3] Create `src/components/BuyPanel.tsx`: form state, the validation gate that blocks submission with per-field messages **without sending a request**, `useMutation({ mutationFn: createOrder })`, and the two failure branches — a refusal (`kind === 'http'`) renders the backend's `message` inline with every entered value preserved, while a connectivity failure renders "the order may still have been created", links to `paths.orders()`, and **offers no retry**. The action is disabled while `isPending`, which is the whole duplicate guard. On success, `navigate(paths.orderDetail(id), { replace: true })` (depends on T015, T016, T017, T018; FR-018, FR-019, FR-020, FR-022, FR-023, FR-024; research R12)
- [X] T020 [US3] Mount `BuyPanel` in `src/pages/AgentDetailPage.tsx`, below `ContractTerms` (depends on T011, T019; FR-008)
- [X] T021 [US3] In `src/components/BuyPanel.tsx`, invalidate the `['me']` query on a successful purchase so the header balance shows the debit immediately rather than up to five seconds later. This is the only cache write this feature performs (depends on T019; data-model §4)
- [X] T022 [P] [US3] Add buy-form and buy-panel styles to `src/index.css`, including the raw-JSON fallback textarea and the in-flight state of the buy action
- [ ] T023 [US3] Verify quickstart **Part D** items D1–D8 and D10–D11, then **Part E** in full (depends on T020, T021, T022). E3+E5 (click repeatedly, then count orders) and E6 (back-navigation creates nothing) are the ones worth doing twice

**Checkpoint**: A purchase works end to end. Affordability is still unchecked — the backend is the only thing refusing an underfunded buy.

---

## Phase 6: User Story 4 — Know I can afford it before I commit (Priority: P2)

**Goal**: Balance and price shown as two figures, an insufficient balance blocked locally with a route to top up, and an unreadable balance deferring to the backend.

**Independent Test**: Quickstart **Part F** — an empty account blocks with a stated shortfall and sends no request, funds added in a second tab unblock it on their own, and a blocked `GET /me` leaves the purchase available.

- [X] T024 [P] [US4] Create `src/hooks/useAccountSummary.ts` returning `{ data, unknown }`, subscribed to the `['me']` query key that `BalanceWidget` already polls at 5s. **It sets no interval and issues no request of its own** — TanStack Query deduplicates by key, so this is a cache subscription. A second `fetchMe` call site would be a second source of truth for a number already in the header (research R8, contracts §4)
- [X] T025 [US4] Derive affordability in `src/components/BuyPanel.tsx` from `useAccountSummary()` and the listing price: render available balance and price as **two separately labelled figures, never one combined number**; when short, state the shortfall as an amount and disable the buy action with a link to `paths.wallet()`; when `unknown`, **leave the action enabled** and defer to the backend — a transient `GET /me` failure must not block a purchase the backend would accept (depends on T019, T024; FR-025, FR-026, FR-028; research R9)
- [X] T026 [US4] Add the signed-out branch to `src/components/BuyPanel.tsx`: where the buy action would be, an invitation to sign in that carries the current location so the buyer returns to this agent. Do **not** wrap the route in `RequireAuth` — browsing stays public (depends on T019; FR-030, research R10)
- [X] T027 [P] [US4] Add affordability and sign-in-invitation styles to `src/index.css` — a shortfall is information, not an error; keep it quieter than a failure
- [ ] T028 [US4] Verify quickstart **Part F** (depends on T025, T026, T027). F7 is the one that catches the wrong instinct: blocked `GET /me` must leave the buy action **available**

**Checkpoint**: All three P1 stories plus affordability work. The criteria field is still a plain textarea.

---

## Phase 7: User Story 5 — Write acceptance criteria that will hold up later (Priority: P2)

**Goal**: At the moment of writing, the buyer knows these words are half of what a dispute is judged against and cannot be changed afterwards.

**Independent Test**: Quickstart **Part D** items D3, D4, D5, and D9 — the consequence copy, a concrete example, and a one-word criterion that warns without blocking.

- [X] T029 [US5] Add the consequence copy and a concrete example of a checkable criterion to `src/components/AcceptanceCriteriaField.tsx`: these criteria are half of what a later dispute is judged against, and they are fixed at purchase. Concrete beats generic — an example like *"every line item from the receipt, each with its amount, and a total"* does more than "describe your requirements" (depends on T018; FR-016)
- [X] T030 [US5] Add the soft warning in `src/components/BuyPanel.tsx` and `src/components/AcceptanceCriteriaField.tsx`: fewer than 15 characters or fewer than 3 words after trimming warns that the criterion gives Guardian little to check against. It is **a warning, not a gate** — the purchase proceeds, it does not repeat for the same text, and it is worded as a consequence rather than an error (depends on T019, T029; FR-017, data-model §5)
- [X] T031 [P] [US5] Add guidance and warning styles to `src/index.css`, distinct from the field-error styling — this must not look like something is broken
- [ ] T032 [US5] Verify quickstart **Part D** items D3, D4, D5, and D9 (depends on T030, T031). D4 is SC-004 and is worth handing to someone who has not seen the product: can they say what the field is for?

**Checkpoint**: All five stories independently functional.

---

## Phase 8: Polish & Cross-Cutting Concerns

- [X] T033 [P] Note in `README.md` that the marketplace needs API-06 (`GET /agents`) and buying needs API-07 (`POST /orders`) plus seeded agents (`POST /demo/seed`), so a clean-checkout operator knows why an empty catalogue is not a frontend bug
- [X] T034 Run the quickstart **Part G** boundary greps and confirm all seven: no `systemPrompt` anywhere in `src/`; no `signMessage`/`writeContract`/`sendTransaction` in the pages or `BuyPanel`; route strings only from `routes/paths.ts`; no price or review window in `src/api/orders.ts`; `package.json` and `package-lock.json` unchanged; no collapse mechanism in `ContractTerms.tsx`; typecheck clean (FR-006, FR-011, FR-021, FR-029)
- [X] T035 Run `npm run typecheck` and `npm run build` clean
- [ ] T036 Run the full quickstart sign-off (Parts A–G) and then the thing that actually matters: **set up both demo acts from these two screens twice in a row, with a `POST /demo/reset` in between, with no manual API calls** (depends on T034, T035; SC-007)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: no dependencies
- **Foundational (Phase 2)**: depends on Setup — **blocks every user story**
- **US1 (Phase 3)**: depends on Foundational. Runnable with the backend down (Part A)
- **US2 (Phase 4)**: depends on Foundational. Needs `GET /agents/:id`, so it needs API-06
- **US3 (Phase 5)**: depends on Foundational; T020 edits the page US2 creates. Needs API-07
- **US4 (Phase 6)**: depends on US3 — T025 and T026 both edit `BuyPanel.tsx`
- **US5 (Phase 7)**: depends on US3 — T029 edits the field US3 creates, T030 edits `BuyPanel.tsx`
- **Polish (Phase 8)**: depends on all five stories

### Story independence

US1 and US2 are genuinely independent of each other and of everything after them: one is the grid, the other the detail screen, and they share only the API wrappers from Phase 2.

**US4 and US5 are not independent of US3 in code, only in behaviour.** Both edit `BuyPanel.tsx`, which US3 creates. That is a deliberate sequencing choice rather than a design flaw — a buy panel that checks a balance before there is anything to buy is not a shippable increment. Each still delivers a separately verifiable slice (Part F, and Part D's D3/D4/D5/D9), which is what the independent-test criteria measure. If two people are working, US1+US2 fork cleanly; US3→US4→US5 is one person's lane.

### Do Phase 2 before writing any screen

`api/types.ts` is where the FR-011 guarantee lives — a listing type with no `systemPrompt` property. Writing the detail screen first and back-filling the types is how an optional `systemPrompt?: string` ends up in the file "just in case the API sends it".

### Parallel opportunities

- **Phase 2**: T003 and T005 together (separate files); T004 waits on T003
- **Phase 3**: T006 and T008 alongside each other; T007 waits on both
- **Phase 4**: T010 and T012 together; T011 waits on T010
- **Phase 5**: T014, T016, and T018 together — three separate new files with no shared dependencies. T022 (css) runs alongside all of them. T015→T017→T019 is the critical path
- **Phase 6**: T024 and T027 together
- **Phase 8**: T033 alongside anything
- **Across phases**: US1 (T006–T009) and US2 (T010–T013) can be built by two people in parallel once Phase 2 lands

---

## Parallel Example: Phase 5 (User Story 3)

```bash
# Three independent new files, no shared dependencies:
Task: "Create src/lib/inputSchema.ts — buildInputForm predicate and control mapping"
Task: "Create src/api/orders.ts — createOrder"
Task: "Create src/components/AcceptanceCriteriaField.tsx — the required textarea"
Task: "Add buy-form styles to src/index.css"

# Then the critical path, in order:
Task: "Add buildPayload/validateFields/parseRawInput"   # needs inputSchema
Task: "Create src/components/SchemaFields.tsx"          # needs inputSchema
Task: "Create src/components/BuyPanel.tsx"              # needs all of the above
```

---

## Implementation Strategy

### MVP first (US1 only)

1. Phase 1 Setup → 2. Phase 2 Foundational → 3. Phase 3 US1 → 4. **Stop and verify Parts A and B** → 5. Demoable: the catalogue is real data on screen, and every route beyond it already exists.

### Incremental delivery

| Increment | Adds | Verify | Needs backend |
| --- | --- | --- | --- |
| Setup + Foundational | Nothing user-visible | typecheck | no |
| + US1 | The catalogue (**MVP**) | Parts A, B | Part B only |
| + US2 | The contract a buyer reads | Part C | API-06 |
| + US3 | The purchase | Parts D, E | API-07 |
| + US4 | Affordability caught before submitting | Part F | API-05 + API-07 |
| + US5 | Criteria that hold up in a dispute | Part D (D3–D5, D9) | no |
| + Polish | Boundary greps, rehearsal | Part G, SC-007 | all |

### If the backend is not ready

Phases 1–4 are worth doing anyway. Part A is real acceptance and covers the error and empty states that are easy to skip once a happy path is available — and building the four-state grid while the API is down is the only time you are guaranteed to see all four.

---

## Notes

- **No test tasks by design.** The manual verification tasks (T009, T013, T023, T028, T032, T036) are the acceptance criteria — a skipped one is an unverified story.
- **The rule that outlives this feature**: `POST /orders` is not idempotent. It is stated in `src/api/orders.ts`'s module comment (T016) and enforced by the connectivity branch in `BuyPanel` (T019). A future "just add a retry button" is a money bug, not a UX improvement.
- **Three endpoints do not exist yet.** [contracts/internal-api.md §8](./contracts/internal-api.md) is the diff list for the day API-06 and API-07 land; the blast radius is `api/types.ts`, `api/agents.ts`, and `api/orders.ts`.
- With no ratified constitution, T034's greps are the only enforcement the structural rules have. Run them.
- Commit after each task or logical group. Stop at any checkpoint to verify a story independently.

---

## Verification status (2026-08-08)

**The six verification tasks above are open, and they stay open**: Parts B–F need `GET /agents`, `GET /agents/:id`, and `POST /orders`, which API-06 and API-07 have not built yet. `GET /health` answers on `localhost:3000`; `GET /agents` returns 404.

What *was* verified, by hand in Chrome, against a throwaway fixture serving the documented shapes (scratchpad only — nothing added to this repo):

| Checked | Result |
| --- | --- |
| Part A — backend unreachable | Error state with a working retry; **not** an empty grid. Unknown agent id gives an error with a route back |
| Part B — grid | Two cards, name/description/price, prices as `$2.00` / `$15.00`, card opens the right agent. The fixture deliberately returns an **envelope**, so the unwrap in `fetchAgents` is exercised |
| Part C — contract terms | Both lists in full above the buy action, labelled as contract terms, visually distinct. An agent with **no exclusions** renders the explicit "declared none" copy |
| Part C — 404 | `No such agent` with a route back to the catalogue |
| Part D — generated fields | Unconstrained string → **textarea**; enum → select with an unselected option; boolean → checkbox; integer → number |
| Part D — nested schema | Raw JSON fallback with the stated reason and the schema printed beside it; the listing stays buyable |
| Part D — validation | Buy with empty fields blocks with per-field messages and **sends no request** |
| Part D — thin criterion (D9) | `ok` produces the warning in the warning colour, distinct from the error, and does not block |
| Part F — unknown balance (F7) | `GET /me` failing leaves the buy action **enabled**, with "balance could not be read" — FR-028 confirmed in the browser, not just in the type system |
| Part F — signed out (F8) | Listing renders in full; a sign-in invitation replaces the buy action |
| Part G — boundaries | All seven pass. G1 and G6 were reworded to match code rather than any mention, so a doc comment can name the field it forbids |

**Still unverified, and only the real backend can settle it**: a purchase actually creating an order (E2–E8), the duplicate-submission count (E3/E5), back-navigation not resubmitting (E6), a backend refusal preserving typed values (E9), the ambiguous no-answer branch (E10), the insufficient-balance block and top-up round trip (F1–F6), and the twice-through rehearsal (SC-007).

One thing the fixture run caught that is worth keeping in mind when the real API lands: a CORS **preflight** answered with a non-2xx makes the browser reject before the app sees any status, which the client reports as "could not reach the API" — indistinguishable on screen from the backend being down. If a 404 from `GET /agents/:id` ever shows up as a connectivity error, check the preflight before suspecting this feature.
