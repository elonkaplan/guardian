---

description: "Task list for 004-order-detail"
---

# Tasks: Order Detail — the hero page

**Input**: Design documents from `/specs/004-order-detail/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/internal-api.md](./contracts/internal-api.md), [quickstart.md](./quickstart.md)

**Tests**: **None.** No unit, integration, or e2e tests — an explicit project decision (`ui/docs/CONTEXT.md`, restated as FR-037). Every story ends with a manual verification task pointing at the matching part of [quickstart.md](./quickstart.md). Those verification tasks *are* the test suite; do not skip them.

**Organization**: Grouped by user story so each is independently implementable and verifiable. This is the demo's screen — US2 and US3 are Acts 1 and 2 respectively, and their verification tasks are rehearsals, not checkboxes.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: US1–US7, mapping to the user stories in spec.md
- All paths are relative to `ui/`

---

## Phase 1: Setup

**Purpose**: Confirm the baseline and find out how much of the backend exists.

- [X] T001 Run `npm run typecheck` in `ui/` and confirm it is clean before any source change. **No `npm install` step exists for this feature** — it adds no dependencies, and `package.json` / `package-lock.json` must be untouched when it lands (research R17, quickstart G3)
- [X] T002 Probe the backend: `curl -i "$VITE_API_URL/orders/00000000-0000-0000-0000-000000000000"` against the URL in `ui/.env.local`. Record three things — whether the orders module exists at all, whether an unknown id gives 404, and **whether the response carries a `Date` header the browser can see** (`Access-Control-Expose-Headers`). If the module is unbuilt, Phases 2–3 are still fully deliverable against quickstart **Part A**; note it and continue (research R1, R3, contracts §7)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The payload types, the three API wrappers, the pure state/time modules, and the one shared-hook change every story below builds on.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [X] T003 [P] Add `OrderState`, `OrderRun`, `Order`, and `ComplainRequest` to `src/api/types.ts` per [data-model.md §1](./data-model.md), carrying the same provisional-field-casing caveat the file already documents for `AccountSummary`. `OrderState` is a **union of the eight values in the backend's enum declaration order**. `OrderRun` has **no `steps` property** and `Order` has **no `systemPrompt` or `model`** — the absent properties are the guarantee, exactly as on `AgentListing` (FR-008)
- [X] T004 [P] Create `src/lib/orderState.ts` with `faceFor`, `isTerminalState`, `stateRank`, and `stateLabel` per [data-model.md §2](./data-model.md). `faceFor` is an **exhaustive switch** over the union so a ninth backend state becomes a compile error rather than a page with no face; `isTerminalState` is `released | settled` **only** — `failed` and `adjudicated` keep polling (FR-002, FR-011, research R4, R10)
- [X] T005 [P] Create `src/lib/duration.ts` with `formatRemaining(ms)` and `formatElapsed(ms)` per [contracts §3](./contracts/internal-api.md) — human units at both ends of the range (`1h 03m`, `4m 12s`, `9s`), clamped at zero, `—` on `NaN`. The review window is seconds in the demo and 24 hours in principle; one formatter has to read correctly for both (FR-021, research R7)
- [X] T006 [P] Create `src/lib/serverClock.ts` with `noteServerDate`, `serverNow`, and `clockSkewMs` per [data-model.md §3](./data-model.md). Module-level `skewMs` defaulting to `0`; a missing, empty, or unparseable header leaves the previous value untouched; a skew under 2000ms is stored as `0` so network latency does not make the countdown jitter. Never throws (FR-017, research R3)
- [X] T007 Add `noteServerDate(response.headers.get('Date'))` to the response path in `src/api/client.ts` — on **every** response including failures, three lines, no signature change. Add a short comment that a `null` header cross-origin is expected until the API sends `Access-Control-Expose-Headers: Date`, and that the fallback is the device clock (depends on T006; research R3)
- [X] T008 [P] Add the optional `isFatalError?: (error: ApiError) => boolean` option to `src/hooks/usePolling.ts`, evaluated in the existing `refetchInterval` callback's error branch to stop the schedule permanently. Defaulted, so `BalanceWidget` and `PollTestPage` are unaffected. Extend the hook's existing comment about why errors normally keep polling with the exception and its reason (FR-010, research R15)
- [X] T009 Extend `src/api/orders.ts` with `fetchOrder(id)`, `acceptOrder(id)`, and `complainAboutOrder(id, reason)` per [contracts §1](./contracts/internal-api.md). **No shape tolerance** — unlike `fetchAgents`, a misread here is loud rather than silent. Both actions return `Promise<void>` and discard the response body. Add to the file's existing module comment that the non-idempotency rule for `POST /orders` **does not extend to these two calls**, and why (research R11) — someone will otherwise copy it (depends on T003)

**Checkpoint**: Typecheck clean, no visible change yet.

---

## Phase 3: User Story 1 — Watch the work happen and the result arrive (Priority: P1) 🎯 MVP

**Goal**: The page follows a live order on its own — working face with elapsed time, the result appearing without a refresh, and correct handling of an order that does not exist.

**Independent Test**: Quickstart **Part A** (offline and boundary — error with retry, a 404 that does **not** poll, sign-out round trip) then **Part B** (buy something and watch it deliver without touching anything).

- [X] T010 [US1] Create `src/hooks/useOrder.ts` per [contracts §5](./contracts/internal-api.md): wraps `usePolling(['order', id], …)` at `intervalMs: 1000` with `isTerminal: (o) => isTerminalState(o.state)` and `isFatalError: (e) => e.kind === 'http' && (e.status === 404 || e.status === 403)`. Owns the **monotonic guard** — a `useRef` of the highest `stateRank` seen, ignoring any response that ranks lower, so the page can never visibly regress from a verdict to "the agent is working". Returns `{ order, face, error, notFound, stale, isPolling, refetch }`, where `stale` is `error !== null && order !== undefined` (depends on T003, T004, T008, T009; FR-009, FR-010, FR-015)
- [X] T011 [P] [US1] Create `src/components/OrderSummaryHeader.tsx` — agent name, `formatUsd(order.priceMinor)`, the `stateLabel` chip, and the order id. This is the band that stays put while the face changes underneath it (FR-003)
- [X] T012 [P] [US1] Create `src/components/SubmittedInput.tsx` rendering `run.input` as labelled key/value rows, falling back to indented JSON for anything not flat. Handles `run === null` (a `purchased` order has not started) without rendering an empty box (FR-004)
- [X] T013 [US1] Rewrite `src/pages/OrderDetailPage.tsx`: read the id from the route, call `useOrder`, and switch on `face`. This task delivers the **working** face only (agent-is-working copy, `SubmittedInput`, a 1s-ticking elapsed time from `formatElapsed(serverNow() - Date.parse(order.createdAt))`) plus the three non-content states — first-load `LoadState status="loading"`, `LoadState status="error"` with `refetch` as `onRetry`, and a not-found branch on `notFound` with a route back to `paths.orders()`. Other faces render a stub for now. Route strings come from `routes/paths.ts` (depends on T010, T011, T012; FR-001, FR-004, FR-034)
- [X] T014 [US1] Add the quiet "updates are not getting through" indicator, shown when `stale` is true — the last known state stays fully rendered and the request rate does not change. It must be visibly *unlike* `LoadState status="error"`, which replaces the page (depends on T013; FR-014)
- [X] T015 [P] [US1] Add page-shell, summary-header, state-chip, and stale-indicator styles to `src/index.css` using the existing custom properties — no new tokens, no framework
- [ ] T016 [US1] Verify quickstart **Part A** and **Part B** (depends on T013, T014, T015). **A4 is the one that matters**: an unknown order id must produce zero repeated requests. B6 (kill the API mid-flight, restart) is the other — the page must degrade quietly and recover on its own

**Checkpoint**: The page follows a live order from purchase to delivery. No countdown, no actions yet.

---

## Phase 4: User Story 2 — The countdown runs out and the money releases on its own (Priority: P1) — **Act 1**

**Goal**: A delivered order shows a live countdown that reaches zero and is followed, unattended, by the page flipping to released.

**Independent Test**: Quickstart **Part D** — hands off the keyboard from D2, including D6 (occluded window) and D7 (laptop asleep across the window).

- [X] T017 [US2] Create `src/hooks/useCountdown.ts` per [contracts §5](./contracts/internal-api.md): takes `deadlineMs: number | null`, ticks on a 1s interval, and **recomputes `deadlineMs - serverNow()` on every tick** rather than decrementing a stored value. Also recomputes on `visibilitychange`. Clamps at zero, clears its interval at zero and on unmount. `null` creates no timer at all (depends on T006; FR-016, FR-018, FR-019, FR-013, research R6)
- [X] T018 [P] [US2] Create `src/components/ReviewCountdown.tsx` — the clock via `formatRemaining`, a label saying what happens at zero, and the two other wordings: **expired at load** (FR-020) and **zero reached while watching**, which says release is being processed rather than freezing on a stale number (depends on T005; FR-019, FR-021)
- [X] T019 [US2] Wire the **review** face in `src/pages/OrderDetailPage.tsx`: compute `deadlineMs` from `Date.parse(order.deliveredAt) + order.reviewWindowSeconds * 1000` — from the order's own snapshot, never a config value — pass it to `useCountdown`, and render `ReviewCountdown`. The concluded face gets its released copy here too, so the flip at zero has somewhere to land (depends on T017, T018; FR-016, FR-020)
- [X] T020 [P] [US2] Add countdown styles to `src/index.css`. It should be the largest single number on the page — it is the thing the room watches
- [ ] T021 [US2] Verify quickstart **Part D**, twice (depends on T019, T020). D3 is the acceptance criterion this whole feature is measured by; **D6 doubles as a regression check on `refetchIntervalInBackground: true`** — if the page did not flip while the window was covered, that setting has been reverted (research R5). D9 is a *should*, not a blocker

**Checkpoint**: Act 1 runs end to end. There is still nothing to click.

---

## Phase 5: User Story 3 — Judge the output against my own criteria, then accept (Priority: P1) — **Act 2's layout**

**Goal**: Output and acceptance criteria side by side at the demo viewport, and an Accept that settles the order at once.

**Independent Test**: Quickstart **Part C** at 1280×800 (both panels readable without scrolling between them; LedgerBot's output countable as a table) plus **E1** and **E2**.

- [X] T022 [P] [US3] Create `src/components/OutputPanel.tsx` rendering by inspection per research R9 — an array of flat objects as a **table**, a string as pre-wrapped prose, anything else as indented JSON in a `<pre>`. The table branch is what lets the audience count rows and reach 50% before Guardian says it; the JSON branch guarantees no output shape produces a blank panel. Scrolls inside its own bounded box (FR-024)
- [X] T023 [P] [US3] Create `src/components/CriteriaPanel.tsx` — `order.acceptanceCriteria` verbatim, labelled as the buyer's own words, fixed since purchase. No truncation, no paraphrase (FR-023)
- [X] T024 [US3] Add the two-column review layout to `src/index.css`: output and criteria side by side, each panel bounded and scrolling internally so a long output cannot push the criteria off the fold. One media query collapses to a stack **below 900px** — deliberately below the demo viewport so it can never fire on stage (depends on T022, T023; FR-022, FR-024, research R8)
- [X] T025 [US3] Create `src/components/OrderActions.tsx` with Accept only for now: `useMutation({ mutationFn: () => acceptOrder(order.id) })`, invalidating `['order', id]` on both success and refusal so the **refetched state picks the face** rather than an error code doing it. Disabled while pending, with visible in-flight copy. On a refusal that turns out to be "already released", the message reads as an outcome — the window closed first and the seller was paid — not as a failure (depends on T009; FR-026, FR-030, FR-031, research R12)
- [X] T026 [US3] Render `OutputPanel`, `CriteriaPanel`, and `OrderActions` on the review face in `src/pages/OrderDetailPage.tsx`, withdrawing the actions when the countdown has expired (depends on T022, T023, T025; FR-020, FR-025)
- [ ] T027 [US3] Verify quickstart **Part C** at 1280×800, plus **E1** and **E2** (depends on T024, T026). C1 is measured, not judged: if the two panels are not both readable without scrolling, the layout is wrong regardless of how it looks. E2 must produce exactly one accepted order

**Checkpoint**: A buyer can read, judge, and accept. Complaining is not possible yet.

---

## Phase 6: User Story 4 — Complain, with a reason, and see Guardian take the case (Priority: P1) — **Act 2**

**Goal**: A reason-and-confirm complaint that moves the page to the arbitration face and, in time, to a ruling — all without a refresh.

**Independent Test**: Quickstart **E3–E7** and **E9–E11**.

- [X] T028 [P] [US4] Create `src/components/ComplainDialog.tsx` as a native `<dialog>` opened with `showModal()` — focus trap, Esc, and `::backdrop` come free and correct (research R16). A free-text reason required non-empty after trim, a soft 2000-character counter, and copy stating plainly that filing is **final, cannot be withdrawn, and the ruling binds both sides**. Presentational only: it calls no API, so it can stay open showing a refusal with the typed reason intact (FR-027, FR-028)
- [X] T029 [US4] Add the complain mutation to `src/components/OrderActions.tsx`: one request per confirmation, both buttons disabled while **either** action is in flight, `['order', id]` invalidated after success or refusal. Two distinct failure branches — a refusal shows the reason and lets the refetched state re-pick the face; a connectivity failure shows "we did not hear back — this page will update on its own if it went through" with **no retry button**, because the 1s poll is the recovery mechanism here (depends on T025, T028; FR-029, FR-030, FR-031, FR-032, research R11)
- [X] T030 [US4] Render the **arbitration** face in `src/pages/OrderDetailPage.tsx` — "Guardian is reviewing", no actions, polling continues because `disputed` and `adjudicated` are not terminal. The case-file panel is explicitly **not** built here (depends on T029; FR-006, FR-011)
- [X] T031 [P] [US4] Add dialog, action-button, and arbitration-face styles to `src/index.css`
- [ ] T032 [US4] Verify quickstart **E3–E7** and **E9–E11** (depends on T030, T031). E9 and E10 are the races — whatever the backend accepts wins, and the page reconciles to it. E11 must show no retry control

**Checkpoint**: Act 2 runs end to end, up to the point where the verdict would be rendered.

---

## Phase 7: User Story 5 — Be told plainly when nothing came back (Priority: P2)

**Goal**: A failed order says so in plain language and offers the one action that makes sense.

**Independent Test**: Quickstart **Part F**.

- [X] T033 [US5] Render the **nothing-came-back** face in `src/pages/OrderDetailPage.tsx`: "the agent returned nothing" in plain language, `OrderActions` with **Complain only**, no countdown, and the submitted input still visible. Polling continues — `failed` is not terminal because the complaint transition has to appear on screen (depends on T029; FR-005, FR-011, FR-025)
- [ ] T034 [US5] Verify quickstart **Part F** (depends on T033). F4 is the one that is easy to get wrong: the page must still be polling

---

## Phase 8: User Story 6 — Land on a settled outcome (Priority: P2)

**Goal**: The page terminates correctly and reserves the place UI-05 will fill.

**Independent Test**: Quickstart **E8**, plus **D3**'s released ending.

- [X] T035 [P] [US6] Create `src/components/VerdictSlot.tsx` — a labelled, styled region that renders one honest line for `adjudicated` (a ruling exists, the split is completing) and for `settled` (the verdict card lands in UI-05). It **never renders a blank gap** and it renders **no verdict content** — no tier, reasoning, citations, split, or transaction hash (FR-007, FR-036)
- [X] T036 [US6] Render the **concluded** face in `src/pages/OrderDetailPage.tsx`: `VerdictSlot`, no actions, and the persistent record — summary header, submitted input, criteria, and output — still present beneath it so a settled order reads as a whole record rather than a stub (depends on T035; FR-007, FR-003)
- [X] T037 [P] [US6] Add verdict-slot and concluded-face styles to `src/index.css`
- [X] T038 [US6] Verify **E8** and the released ending of **D3** (depends on T036, T037)

---

## Phase 9: User Story 7 — Don't hammer the backend after the order is done (Priority: P2)

**Goal**: The network behaviour matches the claims — stops on terminal, keeps going while hidden, never escalates on failure.

**Independent Test**: Quickstart **A4**, **B2**, **B6**, **D4**, **D6**, and the network panel throughout.

- [X] T039 [US7] Add the one-shot `['me']` invalidation to `src/hooks/useOrder.ts`, fired on the **terminal transition only** — not on every poll, which would defeat the shell's 5s cadence. The header's in-escrow figure then moves at the same moment the page flips instead of up to five seconds later (depends on T010; FR-038, research R13)
- [ ] T040 [US7] Verify the full network story with the panel open (depends on T039): **A4** (a 404 never polls), **D4** (requests stop within one interval of `released` and stay stopped for five minutes), **B2** (1s cadence, no overlap, no bursts), **B6** (failures do not escalate the rate), **D6** (polling continues while occluded), and **D5** (the escrow figure moves on cue). Note `StrictMode` double-invokes effects in dev — paired requests there are expected; check a production build if in doubt

---

## Phase 10: Polish & Cross-Cutting Concerns

- [X] T041 Run quickstart **Part G** — all seven boundary greps. G1 (no chain call, no signature) and G6 (no timers outside `useCountdown`) are the two that matter most; with no ratified constitution these greps are the only enforcement the structural rules have
- [X] T042 [P] Update `ui/README.md`: the `src/lib/` and `src/hooks/` lines in the Layout tree (four new modules, three hooks), and a "Notes for the next feature" entry recording the server-clock fallback and its CORS dependency, and that the orders payload shapes are provisional with the diff list in `specs/004-order-detail/contracts/internal-api.md` §7
- [ ] T043 Run `npm run typecheck` and `npm run build`, then **run Acts 1 and 2 end to end, twice, from `POST /demo/reset`, without touching anything outside the browser** (SC-009). Act 1 is D2–D4 with your hands off the keyboard; Act 2 is C1 then E3–E8. A rehearsal that needs a refresh, a retry, or an explanation to the room is a failure, whatever the tables above say

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: no dependencies
- **Foundational (Phase 2)**: needs Setup — **blocks every story**
- **US1 (Phase 3)**: needs Foundational. **Every other story depends on it**, because `useOrder` and the page's face switch are built here
- **US2 (Phase 4)**: needs US1
- **US3 (Phase 5)**: needs US1
- **US4 (Phase 6)**: needs US3 — the complain mutation lives in `OrderActions`, created in T025
- **US5 (Phase 7)**: needs US4 — it reuses the same Complain action
- **US6 (Phase 8)**: needs US1 only
- **US7 (Phase 9)**: needs US1; its verification is most meaningful after US2
- **Polish (Phase 10)**: needs everything

This is a single-page feature, so the stories are less independent than the template's shape implies and pretending otherwise would be misleading. US1 is genuinely foundational: it delivers the data layer and the face switch. After it, **US2, US3, and US6 can proceed in parallel** — they touch different components and different faces.

### Within each story

Pure modules and components (marked [P]) before the page wiring that renders them; page wiring before the verification task.

### Parallel Opportunities

- Phase 2: T003, T004, T005, T006, T008 all in parallel; then T007 (needs T006) and T009 (needs T003)
- Phase 3: T011, T012, T015 in parallel while T010 is being written
- Phase 5: T022 and T023 in parallel
- Across phases: once US1 lands, one developer can take the countdown (US2) while another takes the two-column layout (US3)
- CSS tasks (T015, T020, T024, T031, T037) are all in `src/index.css` — they are marked [P] relative to component work, **not to each other**

---

## Parallel Example: Phase 2

```bash
# Four pure modules and one hook option, no shared files:
Task: "Add order payload types to src/api/types.ts"
Task: "Create src/lib/orderState.ts"
Task: "Create src/lib/duration.ts"
Task: "Create src/lib/serverClock.ts"
Task: "Add isFatalError option to src/hooks/usePolling.ts"

# Then the two that depend on them:
Task: "Wire noteServerDate into src/api/client.ts"      # needs serverClock
Task: "Extend src/api/orders.ts with the three wrappers" # needs types
```

---

## Implementation Strategy

### MVP (US1 only)

Phases 1–3. The page follows a live order and handles every way it can fail to load. That is a real increment: it replaces the placeholder and makes a purchase land somewhere useful.

### The demo increment

Phases 1–6 — US1 through US4. **This is the target.** Act 1 needs US1 + US2; Act 2 needs US1 + US3 + US4. Everything after Phase 6 is correctness and finish rather than demo capability.

### If the backend is not ready

Phases 1–3 are worth doing anyway, and Part A is real acceptance — it covers the not-found, error, retry, and stale paths, which are exactly the ones nobody goes back for once a happy path is available. A4 in particular (a 404 that must not poll) is invisible until someone looks.

Phases 4–9 stall without `GET /orders/:id`. A throwaway fixture serving the documented shape from [contracts §7](./contracts/internal-api.md) — with a settable `deliveredAt` and a short `reviewWindowSeconds` — makes the countdown and the layout verifiable ahead of the real API. Keep it in the scratchpad; nothing goes in this repo.

---

## Notes

- **No test tasks by design.** The manual verification tasks (T016, T021, T027, T032, T034, T038, T040, T041, T043) are the acceptance criteria — a skipped one is an unverified story.
- **Two spec corrections are already applied** to `spec.md` and must not be "fixed" back: FR-012 (polling continues while hidden — research R5) and FR-038 (the escrow figure comes from the account read, not from the escrow contract — research R14).
- **The rule that outlives this feature**: on this page the poll *is* the recovery mechanism. An action that gets no answer needs no retry button, because the page re-reads the order every second and corrects itself. Do not import UI-03's purchase rule here, and do not add a retry to T029.
- **Three endpoints do not exist yet.** [contracts/internal-api.md §7](./contracts/internal-api.md) is the diff list, with seven numbered assumptions and one CORS request (`Access-Control-Expose-Headers: Date`).
- **The sweeper and the review window are prerequisites, not details.** If `SWEEPER_INTERVAL_MS` is not at its demo value and the window is not turned down to seconds, T021 cannot pass and the reason will have nothing to do with this code.
- Commit after each task or logical group. Stop at any checkpoint to verify a story independently.

---

## Verification status (2026-08-08)

**All 36 implementation tasks are done; typecheck and build are clean.** Seven verification tasks stay open, and they stay open for one reason: the API's orders module does not exist. `GET /health` answers on `localhost:3000`; `GET /orders/:id` is `Cannot GET`.

What *was* verified, by hand in Chrome at 1280×800, against a throwaway fixture serving the shapes in [contracts §7](./contracts/internal-api.md) (scratchpad only — nothing added to this repo):

| Checked | Result |
| --- | --- |
| **A3, A4 — unknown order** | Not-found state with a route back. **Exactly 1 request in 20 seconds** — without `isFatalError` it would have been ~20. This is the clearest evidence the shared-hook change earns its place |
| **B1, B5 — working face** | "The agent is working…", elapsed ticking, submitted receipt shown, summary band in place |
| **B2, D4 — cadence and stop** | 10 requests across ~11s of live order (1/s, no overlap despite StrictMode), then **zero further requests over the next 25s** once `released` |
| **B6 — API killed mid-order** | Full delivered state stays on screen with a quiet warning-ruled line, request rate unchanged, **countdown keeps ticking through the outage** (R6's decoupling, visible). Recovers by itself when the API returns; the stale line clears with no interaction |
| **C1, C2, C3, C4 — output beside criteria** | Both panels readable side by side without scrolling. LedgerBot renders as a table headed **"3 rows"** beside criteria reading "Every row on the receipt must appear", above a submitted receipt with 5 — Act 2's mechanic works exactly as designed. TLDR's output renders as prose, not escaped JSON |
| **D1, D2, D3 — Act 1** | Countdown ticks, stops at `0s`, and the page flips to "Released — the seller has been paid" **unattended**. Ran twice |
| **D6 — occluded window** | Tab reporting `visibilityState: "hidden"` still flipped to Released on its own. This is the regression check on `refetchIntervalInBackground: true` and the strongest evidence for the FR-012 correction (research R5) |
| **D9 — clock anchoring** | The `Date` header is readable cross-origin **when `Access-Control-Expose-Headers: Date` is sent** — confirmed in the browser. The Guardian API sends no CORS headers today, so the device-clock fallback is in force; the header request is the one line in the backend handoff that changes it |
| **E1, E2 — accept** | Accept releases the order, countdown and both actions disappear, notice clears. **Seven rapid activations produce exactly one request** — see the defect below |
| **E3–E7 — complain** | Dialog opens modal with accurate finality copy; Confirm disabled on an empty reason; `cancel` closes it with nothing submitted and the countdown still running underneath; a filed complaint moves the page to the arbitration face, then to `adjudicated` and `settled` **on its own** |
| **E8 — verdict slot** | The reserved region reads as a finished-but-pending section ("Outcome" / "Settling the escrow"), never a blank gap, with the full record still beneath it |
| **E11 — silence** | Accept with the API down shows "We did not hear back… this page updates every second", **no retry control**, and the page keeps working |
| **F1–F4 — nothing came back** | "The agent returned nothing" in plain words, Complain offered, Accept absent, no countdown, **and still polling** |
| **G1–G7 — boundaries** | All seven pass. G6 was reworded during implementation: the app's single `setInterval` lives in `src/hooks/useNow.ts`, not `useCountdown` — see below |

### One defect found and fixed during verification

**Seven rapid activations of Accept sent seven requests.** The re-entry guard read `isPending`, which is state, and state does not change until React re-renders — so every activation dispatched within the same frame saw a stale `false`. A trackpad double-click or a held Enter key is exactly that. It violated FR-030 and SC-006, and against a real backend the extra calls would land as 409s and surface a spurious refusal.

Fixed with a synchronous `useRef` guard shared by both actions, cleared in each mutation's `onSettled`. Re-tested: **seven activations, one request, no spurious notice.** The comment in `OrderActions.tsx` records that this was measured rather than theorised, so nobody "simplifies" it back to reading `isPending`.

### One deviation from the plan

The plan put the countdown's timer inside `useCountdown`. Implementation found a second time-driven element — the elapsed line on the working face — and two independent intervals is how one of them ends up leaked or throttled differently. So `src/hooks/useNow.ts` was added as **the app's only `setInterval`**, reporting an *instant* from `serverNow()` rather than a duration; `useCountdown` is built on it and creates no timer. [contracts §5](./contracts/internal-api.md) and quickstart G6 were updated to match.

### Still unverified, and only the real backend can settle it

A5/A6 (session round trip, another buyer's order), B4 (no face flash on a mid-flight reload), D5 (the escrow figure moving on cue — the fixture serves a static `/me`), D7 (laptop asleep across the window), D8 (a delivered order already expired at load), C5/C6 (a very large output; no seller IP in a real payload), E9/E10 (the two races against the sweeper), F5, and the twice-through rehearsal (SC-009, T043).

One thing the fixture run is worth remembering for the integration day: the Guardian API currently sends **no CORS headers at all**. Until that changes, every request from the browser will fail as a connectivity error — which this page renders as "updates are not getting through", indistinguishable on screen from the backend being down. Check the preflight before suspecting this feature.
