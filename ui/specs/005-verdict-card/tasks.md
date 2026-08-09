---

description: "Task list for Verdict card & case file (005)"
---

# Tasks: Verdict card & case file

**Input**: Design documents from `/specs/005-verdict-card/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/internal-api.md](./contracts/internal-api.md), [quickstart.md](./quickstart.md)

**Tests**: **None.** No unit, integration, or e2e tests are produced for this feature — an explicit, time-boxed project decision (`ui/docs/CONTEXT.md`), restated as FR-036. Every task's verification is a numbered check in [quickstart.md](./quickstart.md), run by hand. `npm run typecheck` is the only automated gate this component has.

**Organization**: Tasks are grouped by user story. Each story phase ends at a checkpoint where that story is independently demonstrable on the order screen.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: US1–US5, mapping to the user stories in [spec.md](./spec.md)
- Paths are relative to `ui/` (the working directory for this component)

---

## Phase 1: Setup

**Purpose**: Resolve the one assumption that can invalidate the feature, and make the offline branches reachable.

- [ ] T001 Confirm handoff assumption 2 with whoever is building the API's Guardian module — that `GET /orders/:id/verdict` returns `citations` as structured objects (`source` · `clause` · `met`), **not** prose. Record the answer in `specs/005-verdict-card/contracts/internal-api.md` §6. **If they arrive as prose, stop here**: FR-007 cannot be met from the client, because splitting model prose into clauses would be inventing evidence, and the fix is upstream.
- [X] T002 [P] Prepare stub payloads for the offline branches in the session scratchpad — one verdict per row of quickstart Part A (A1–A10) and one case file — as JSON files usable through Chrome DevTools local overrides. These are what makes Phases 3–6 verifiable before the API's Guardian module exists.

**Checkpoint**: The citation shape is confirmed and the abnormal payloads are ready to serve.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The types, the pure module, the two fetchers, and the two hooks. Every user story reads through these.

**⚠️ CRITICAL**: No story phase can begin until this phase is complete.

- [X] T003 [P] Add `VerdictTier`, `CitationSource`, `CitationStatus`, `RawCitation`, `Citation`, `Verdict`, `CaseFile`, and `CaseFileStep` to `src/api/types.ts`, following [data-model.md](./data-model.md) §1. `VerdictTier` must list the five enum values in the backend's declaration order. `Verdict` carries no `verdictHash`, no `model`, and no `id`; `CaseFileStep` carries `summary` and **no** `reasoning`, `prompt`, or `raw` field — the absent property is the guarantee (FR-026, research R8).
- [X] T004 Create `src/lib/verdict.ts` with `tierDisplay(tier)` — the five-row mapping from [data-model.md](./data-model.md) §3, exhaustively switched over `VerdictTier` with an `assertNever` fallthrough mirroring `src/lib/orderState.ts`, plus a runtime branch returning `{ percent: null, phrase: rawValue }` for a string that is not a member (FR-002, research R4).
- [X] T005 Add `splitFor(priceMinor, refundMinor)` and the `SplitResult` union to `src/lib/verdict.ts`. Returns `{ ok: true, buyerMinor, sellerMinor }` only when `refundMinor` is a finite integer in `[0, priceMinor]`; otherwise `{ ok: false, buyerMinor }`. **Never clamps, never returns a negative figure, and never uses the tier percentage as an operand** (FR-003, FR-004, research R3).
- [X] T006 Add `isTxHash(value)` (`/^0x[0-9a-fA-F]{64}$/`, narrowing to viem's `Hex`) and `truncateHash(value)` to `src/lib/verdict.ts` (FR-015, FR-018, research R9).
- [X] T007 Add `normaliseVerdict(payload)` to `src/lib/verdict.ts`, implementing every row of the normalisation table in [data-model.md](./data-model.md) §2. Total over any input; nothing throws; unreadable elements are counted into `unreadableCitations` rather than dropped silently. **A citation whose `met` was not recorded becomes `status: 'unrecorded'` and never `'met'`** (FR-013, research R5).
- [X] T008 Create `src/api/verdicts.ts` with `fetchVerdict(orderId)` and `fetchCaseFile(orderId)` per [contracts/internal-api.md](./contracts/internal-api.md) §1, both through `apiGet`. `fetchVerdict` calls `normaliseVerdict` before returning, so no `RawCitation` escapes the boundary.
- [X] T009 [P] Create `src/hooks/useVerdict.ts` per [contracts/internal-api.md](./contracts/internal-api.md) §3 — `usePolling(['verdict', orderId], …)`, enabled only for `adjudicated` and `settled`, 1s interval, `isTerminal: (v) => v.txHash !== null || state === 'settled'`, `isFatalError` on 404/403. One cache key, never keyed on state (FR-031, FR-033, research R6). Derives `settlementPending`.
- [X] T010 [P] Create `src/hooks/useCaseFile.ts` — `usePolling(['case-file', orderId], …)` with `enabled: disputed`, `isTerminal: () => true`, `isFatalError: () => true`: one attempt, then the schedule stops either way, with recovery through the returned `refetch`.
- [X] T011 Verify the foundation: `npm run typecheck` clean, then quickstart **G6** — add a sixth value to `VerdictTier` locally, confirm `src/lib/verdict.ts` fails to compile, and revert.

**Checkpoint**: Data flows from both endpoints into normalised types. Nothing renders yet.

---

## Phase 3: User Story 1 — Read the ruling and the split (Priority: P1) 🎯 MVP

**Goal**: A ruled order shows a card stating the refund tier, both money figures, and Guardian's reasoning, in the region UI-04 reserved.

**Independent Test**: Open a settled order; the card states the tier and two labelled figures that sum exactly to the order price, plus the reasoning. Quickstart Part B.

- [X] T012 [US1] Create `src/components/VerdictCard.tsx` — props `order`, `verdict`, `error`, `settlementPending`, `onRetry`. Renders the tier badge (`tierDisplay`), the two labelled money figures via `splitFor` and `formatUsd`, and the reasoning. Handles the `ok: false` split by showing the refund as recorded, `—` for the seller, and a reconciliation note. Renders the ruling content even when `reasoning` is empty (FR-006). Leaves a slot for the checklist (US2) and the transaction (US3). **Owns the never-blank rule**: a verdict that could not be read renders a labelled region with a retry, never an empty gap (FR-034).
- [X] T013 [P] [US1] Delete `src/components/VerdictSlot.tsx` (research R13).
- [X] T014 [US1] Edit `src/pages/OrderDetailPage.tsx`: drop the `VerdictSlot` import, render `<VerdictCard>` in `ConcludedFace` when the state is `settled` and in `ArbitrationFace` when it is `adjudicated`, and call `useVerdict` from both. The `released` branch is untouched — an uncontested release has no verdict (FR-001).
- [X] T015 [US1] Edit `src/index.css`: remove the `.verdict-slot` block; add the card container, tier badge, and split-figure styles. The card must read as the conclusion of the record at 1280×800.
- [ ] T016 [US1] Validate: quickstart **Part B** (B1–B8) against a settled order, plus **A7**, **A8**, and **A9** with the stubs from T002.

**Checkpoint**: A settled order shows a real verdict card. The placeholder is gone. MVP.

---

## Phase 4: User Story 2 — Check the ruling against the clauses (Priority: P1)

**Goal**: The cited clauses render as a ✓/✗ checklist — the feature's entire argument.

**Independent Test**: On a ruled order the citations are discrete marked rows, each with origin, verbatim quote, and a met/unmet mark that survives greyscale. Quickstart Part C.

- [X] T017 [P] [US2] Create `src/components/CitationChecklist.tsx` — props `citations`, `unreadableCount`. One row per citation: an origin label ("Promised capability" / "Declared exclusion" / "Your criterion", or the raw string for an unknown source, or "Clause" when absent), the quote in a `<blockquote>`, and a status of ✓ Met / ✗ Not met / — Not recorded. **Glyph plus word, never colour alone** (FR-010). Renders the "no clauses were cited" line for an empty list (FR-012) and a "N citations could not be read" line when `unreadableCount > 0`.
- [X] T018 [US2] Compose `CitationChecklist` into `src/components/VerdictCard.tsx`, positioned so the reasoning reads as support for the checklist rather than in place of it (FR-005).
- [X] T019 [US2] Edit `src/index.css`: checklist rows, origin labels, quote treatment, and the status marks. Unmet rows carry the greater visual weight (FR-011); a 400-character clause must not break the layout or push other rows out of view (FR-014).
- [ ] T020 [US2] Validate: quickstart **Part C** (C1–C7, including the greyscale screenshot and the from-the-back-of-the-room check) plus **A1–A6** with the stubs.

**Checkpoint**: The ruling is checkable rather than asserted. C7 — a stranger naming the failed clauses without reading the reasoning — is the real gate.

---

## Phase 5: User Story 3 — Verify that the money actually moved (Priority: P1)

**Goal**: The settlement transaction is shown, validated, and followable to MonadVision.

**Independent Test**: On a settled order the hash links out to the public explorer on the first try, in a new tab; on an `adjudicated` order there is no link at all. Quickstart Part D.

- [X] T021 [P] [US3] Create `src/components/TxHashLink.tsx` — props `txHash`, `state`. Implements the four renderings in [data-model.md](./data-model.md) §3: a validated hash becomes a truncated link built by `explorerTxUrl` from `src/chain/chains.ts` with `target="_blank" rel="noopener noreferrer"`, a visible external-destination marker, and a copy control that puts the **full** value on the clipboard; `null` on `adjudicated` reads as settlement completing; `null` on `settled` reads as no reference recorded; a non-hash string renders as unlinkable text. **No link, no placeholder, and no disabled control in any of the last three cases** (FR-015 – FR-019, research R9).
- [X] T022 [US3] Compose `TxHashLink` into `src/components/VerdictCard.tsx`, passing `settlementPending` through from the hook rather than re-deriving it.
- [X] T023 [US3] Edit `src/index.css`: the transaction row, the monospace hash, the external marker, and the copy acknowledgement.
- [ ] T024 [US3] Validate: quickstart **Part D** (D1–D6), plus **A10** with the stub. D2 — the link resolving on MonadVision first try — is the one that matters.

**Checkpoint**: The one claim on the page a sceptic can verify independently now works.

---

## Phase 6: User Story 4 — Read what Guardian was given (Priority: P2)

**Goal**: The evidence behind the ruling — input, criteria, listing promises and exclusions, execution steps with timings — available from the moment a dispute exists.

**Independent Test**: A disputed order shows an open case-file panel; a settled one shows it collapsed beneath the card; a never-disputed order shows none. Quickstart Part E.

- [X] T025 [P] [US4] Create `src/components/ExecutionSteps.tsx` — props `steps`. An ordered list rendering each step's label, its `summary`, its duration, and any error shown rather than hidden (FR-022). Renders `summary` and nothing else from the step's text; there is no other text field on the type.
- [X] T026 [US4] Create `src/components/CaseFilePanel.tsx` — props `caseFile`, `error`, `loading`, `defaultOpen`, `onRetry`. A native `<details>`/`<summary>` (research R11) containing the submitted input, the acceptance criteria, the promised capabilities, the declared exclusions, the output rendered through the existing `OutputPanel`, and `ExecutionSteps`. Owns its own error surface with a retry, so a failed case file never prevents the card above from rendering (FR-035).
- [X] T027 [US4] Edit `src/pages/OrderDetailPage.tsx`: call `useCaseFile` and render `CaseFilePanel` whenever `order.disputedAt !== null` — `defaultOpen` on the arbitration face, collapsed on the concluded face. Never rendered for an order that was released uncontested (FR-020, FR-025).
- [X] T028 [US4] Edit `src/index.css`: the `<details>` panel, its section headings, and the step list. Large inputs, outputs, and step lists scroll within their own regions so the card above stays put (FR-024).
- [ ] T029 [US4] Validate: quickstart **Part E** (E1–E8) plus **A12**. E4 (a citation quote traced to the panel's listing text) and E8 (nothing resembling a seller's instructions anywhere) are the two that carry requirements.

**Checkpoint**: The citations have a visible provenance.

---

## Phase 7: User Story 5 — The verdict arrives on its own (Priority: P2)

**Goal**: The card appears unattended when the ruling lands, the transaction appears in place when settlement completes, and everything stops once the order is final.

**Independent Test**: Sit on a disputed order and touch nothing; the card appears, then the link appears without the card rebuilding, then the requests stop. Quickstart Part F.

- [X] T030 [US5] Finish the failure surfaces in `src/components/VerdictCard.tsx`: a 500 on the verdict read renders a stated message and a working retry inside the concluded region while the case file below continues to render (FR-034, FR-035, quickstart A11).
- [ ] T031 [US5] Validate the live path: quickstart **Part F** (F1–F6) with hands off the keyboard, watching the network panel. F2 (the link appearing without the badge, figures, or checklist rebuilding) and F4 (zero requests five minutes after settling) are the two that can only be checked here.

**Checkpoint**: All five stories work. The demo's closing beat runs unattended.

---

## Phase 8: Polish & Cross-Cutting Concerns

- [X] T032 [P] Run the boundary sweep: quickstart **Part G** (G1–G9). Expect zero hits on every grep, no diff on `package.json`, `package-lock.json`, `src/hooks/usePolling.ts`, `src/lib/queryClient.ts`, and `src/api/client.ts`, and no remaining reference to `VerdictSlot`.
- [ ] T033 [P] Reconcile [contracts/internal-api.md](./contracts/internal-api.md) §6 against the API as built: tick off the 13 assumptions, and note whether `sellerMinor` arrived — if it did, delete the subtraction and the reconciliation guard from `splitFor` and simplify `VerdictCard` accordingly (research R3).
- [ ] T034 Run the rehearsal: **Act 2 end to end, twice, from `POST /demo/reset`**, without touching anything outside the browser (SC-010).
- [ ] T035 The gate no table encodes: show the finished card to someone who has not seen the product and ask why the refund was what it was. If they answer by reading the checklist back, the feature is done; if they answer "because the AI decided", it is not (SC-001).

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: T001 gates everything — a prose citation payload invalidates US2 and with it the point of the feature. T002 gates offline verification only.
- **Foundational (Phase 2)**: depends on Setup. **Blocks all five stories.**
- **User Stories (Phases 3–7)**: all depend on Phase 2. US1 must land before US2, US3, and US5 (they compose into `VerdictCard`); US4 is independent of all of them.
- **Polish (Phase 8)**: depends on every story you intend to ship.

### User Story Dependencies

- **US1 (P1)**: after Phase 2. No story dependencies. This is the MVP.
- **US2 (P1)**: after US1 — `CitationChecklist` is composed into the card. The component itself (T017) can be built in parallel with US1.
- **US3 (P1)**: after US1 — same reason. `TxHashLink` (T021) can be built in parallel with US1.
- **US4 (P2)**: after Phase 2, **fully independent of US1–US3**. A second developer can take it start to finish.
- **US5 (P2)**: after US1; its live behaviour is mostly delivered by T009's stopping rule, so this phase is one code task and one long verification.

### Within Each Story

- Component before composition before CSS before validation.
- `src/lib/verdict.ts` tasks (T004–T007) are sequential — one file.
- `src/index.css` tasks are sequential across phases — one file, four blocks.
- `src/pages/OrderDetailPage.tsx` is edited twice (T014, T027); do not run those in parallel.

### Parallel Opportunities

- T009 and T010 (two hook files) after T008.
- T013 (deleting `VerdictSlot`) alongside T012.
- T017 and T021 (`CitationChecklist`, `TxHashLink`) can both be written while US1's card is in progress — they are new files with no imports from it.
- T025 alongside T026 (`ExecutionSteps` is a leaf).
- **US4 in full, in parallel with US1–US3, US5**, by a second developer.
- T032 and T033 in Phase 8.

---

## Parallel Example: after Phase 2

```bash
# Developer A — the card and everything that composes into it:
Task: "T012 Create src/components/VerdictCard.tsx"
Task: "T013 Delete src/components/VerdictSlot.tsx"

# Developer B — the two leaf components, no dependency on the card:
Task: "T017 Create src/components/CitationChecklist.tsx"
Task: "T021 Create src/components/TxHashLink.tsx"

# Developer C — the whole case file, independent end to end:
Task: "T025 Create src/components/ExecutionSteps.tsx"
Task: "T026 Create src/components/CaseFilePanel.tsx"
```

Composition (T018, T022) and the two `OrderDetailPage.tsx` edits (T014, T027) then serialise through whoever owns the card.

---

## Implementation Strategy

### MVP First (User Story 1 only)

1. Phase 1 — Setup, and **do not skip T001**.
2. Phase 2 — Foundational.
3. Phase 3 — US1.
4. **STOP and validate**: quickstart Part B. A settled order now shows a real card where the placeholder was.

That is a shippable increment, but it is deliberately *not* the feature. A card with a tier, two figures, and a reasoning paragraph is exactly the artefact the spec was written to prevent — "the AI decided 50%". **US2 is what makes the MVP worth demoing**, so treat Phases 3 and 4 as one delivery whenever there is a choice.

### Incremental Delivery

1. Setup + Foundational → data flows, nothing renders.
2. + US1 → the card exists (Part B).
3. + US2 → the ruling becomes checkable (Part C). **This is the first state worth showing anyone.**
4. + US3 → the money is independently verifiable (Part D).
5. + US4 → the evidence has provenance (Part E).
6. + US5 → it all happens unattended (Part F).
7. Polish → Part G, the handoff reconciliation, and two rehearsals.

### Building before the API exists

Phases 1–4 are reachable offline with the T002 stubs: quickstart Part A covers the whole normalisation surface without a backend, and it is the part nobody returns to once the happy path renders. Parts B–F need the Guardian module.

---

## Implementation status — 2026-08-08

**26 of 35 complete.** Every code task is done: the feature is written, `npm run typecheck` is clean, `npm run build` succeeds, and the Part G boundary sweep passes in full.

The nine open tasks are open for two reasons, neither of them code:

**Needs a person (1)** — T001, confirming with whoever builds the API's Guardian module that citations arrive structured rather than as prose. The code was written under that assumption, which is safe in one direction: `normaliseVerdict` is defensive, so a wrong shape degrades to stated-incomplete rows rather than a crash. But if citations arrive as a paragraph, FR-007 is unmeetable from the client and the fix is upstream. **Still the first thing to settle.**

**Needs the unbuilt backend (8)** — T016, T020, T024, T029, T031 (quickstart Parts B–F), T033 (reconciling the handoff against the API as built), T034 (the Act 2 rehearsal), and T035 (the stranger test). All require a running Guardian module, which `api/specs/` shows is unbuilt.

What was verified without it: the whole of quickstart Part A's logic — the normalisation table, the split guard, the tier vocabulary, and hash validation — exercised against the T002 stubs through a throwaway harness in the session scratchpad (38 assertions, all passing, including the three requirements most easily lost: FR-004 never recomputing the split from the tier, FR-013 never rendering an unrecorded citation as met, and FR-018 never linking a malformed hash). That harness is scratch, not a committed test; FR-036 stands.

What remains genuinely unseen is rendering: no part of this feature has been looked at in a browser, so the CSS — legibility at distance (SC-005), the greyscale check (SC-006), long-clause layout (FR-014) — is reasoned but unconfirmed.

---

## Notes

- **No test tasks appear in this list, by decision** (FR-036). Every task's verification is a quickstart check run by hand; `npm run typecheck` is the only automated gate.
- 35 tasks: 2 setup, 9 foundational, 5 (US1), 4 (US2), 4 (US3), 5 (US4), 2 (US5), 4 polish.
- Commit after each task or logical group. Stop at any checkpoint to validate a story on its own.
- The three requirements most easily lost in implementation are FR-004 (never recompute the split from the tier), FR-013 (an unrecorded `met` is never a ✓), and FR-018 (no link when the hash is absent or malformed). Each has its own quickstart row: G7, A3, and D4/D5/A10.
