---

description: "Task list for 006-wallet-page"
---

# Tasks: Wallet page — money in, money out

**Input**: Design documents from `/specs/006-wallet-page/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/internal-api.md](./contracts/internal-api.md), [quickstart.md](./quickstart.md)

**Tests**: **None.** No unit, integration, or e2e tests are written for this component — a deliberate, time-boxed MVP decision recorded in `ui/docs/CONTEXT.md` and restated as FR-037. Every task below carries its verification as a [quickstart.md](./quickstart.md) reference instead, and those are run by hand.

**Organization**: Grouped by user story. Each story is an independently demonstrable increment.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: different file, no dependency on an incomplete task — safe to run concurrently
- **[Story]**: US1–US5, matching [spec.md](./spec.md)
- Paths are relative to `ui/` unless stated otherwise

**Two files are edited by several stories and therefore gate concurrency**: `src/components/WalletActions.tsx` (US2, US4, US5) and `src/index.css` (every story). The stories remain independently testable; they are not independently *editable*. This is called out again under Dependencies.

---

## Phase 1: Setup

**Purpose**: Establish the premises the rest of the plan is built on. No code.

- [ ] T001 Send [contracts/internal-api.md §7.2](./contracts/internal-api.md) to whoever builds the API's accounts module — ten numbered assumptions. **Assumption 2 is the one that gets missed**: `GET /me` must return `settledFundsMinor: null` when `EscrowReadService.balanceOfCents` throws, rather than failing the request, because `/me` is polled every 5s by the header on every screen.
- [X] T002 Verify the baseline is clean before touching anything: `npm run typecheck`, `npm run lint`, `npm run dev`, and confirm `/wallet` currently renders the `PagePlaceholder` from `src/pages/WalletPage.tsx`.
- [X] T003 [P] Confirm the premise behind R4 in the network panel: with any signed-in screen open, exactly **one** `GET /me` fires every 5s, driven by `BalanceWidget` in `src/components/AppShell.tsx`. Everything in this feature's figure-reading depends on that being true.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The types, the API layer, and the page shell that every story renders into.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [X] T004 Add `settledFundsMinor: Cents | null` to `AccountSummary` in `src/api/types.ts`, with a comment stating that `null` means unknown and never zero, and that the existing two figures are untouched so `BalanceWidget` and `BuyPanel` are unaffected (R2, R11).
- [X] T005 Add `LedgerKind` (closed union: `onramp` | `purchase` | `offramp` | `adjustment`), `LedgerEntry`, `TopupRequest`, `OfframpRequest`, and `WithdrawResponse` to `src/api/types.ts` per [data-model.md §1](./data-model.md). Depends on T004 (same file).
- [X] T006 Apply the boundary coercion in `fetchMe` in `src/api/me.ts`: read the payload as `unknown` and reduce `settledFundsMinor` to `Cents | null` — a finite number stays, `null`/`undefined`/string/`NaN` all become `null`. The signature does not change. Document why this one field departs from `api/orders.ts`'s no-shape-tolerance rule (R3).
- [X] T007 Create `src/api/wallet.ts` with `fetchLedger`, `topUp`, `cashOut`, and `withdraw` per [contracts §3](./contracts/internal-api.md). `fetchLedger` unwraps a list envelope (`entries`/`items`/`data`) exactly as `fetchAgents` does. The module comment carries the non-idempotency doctrine for all three POSTs: **never retried automatically**, refusals are safe to correct, silence is not (R8, R16).
- [X] T008 [P] Extend `AccountSummaryResult` in `src/hooks/useAccountSummary.ts` from `{ data, unknown }` to `{ data, unknown, error }`. Additive only — `unknown` keeps its exact current meaning so `BuyPanel` is unaffected, and the hook stays a passive subscriber with no interval of its own (R4, R5).
- [X] T009 Replace the `PagePlaceholder` in `src/pages/WalletPage.tsx` with the page shell: heading, and the page-level `LoadState` branches for a first `/me` read that is in flight or has failed (with retry). The route is already guarded by `RequireAuth` in `src/routes/AppRoutes.tsx`, so no auth branch belongs here (FR-036).
- [X] T010 Add the page-level layout block to `src/index.css` (`.wallet`, section spacing), following the existing BEM-ish convention used by `.order`, `.buy`, and `.verdict-card`.

**Checkpoint**: `/wallet` renders its own shell with real load and error states. Verify **T002**'s commands still pass and **Part G, G8** prints nothing.

---

## Phase 3: User Story 1 — See what you have, and where it is (Priority: P1) 🎯 MVP

**Goal**: Three separately labelled money figures that are never summed, with the third one carrying an unknown state that degrades to a dash without taking the screen down.

**Independent Test**: Sign in with an account that has a balance, orders in flight, and a concluded dispute — three distinct figures, no total, each matching its source. Then make the settled figure unreadable and confirm the page degrades to `—` rather than failing.

- [X] T011 [US1] Create `src/components/MoneyFigures.tsx`: three labelled currency figures (available, in escrow, settled) rendered from an `AccountSummary`. Presentational — no fetching, no mutations. **No total, and no expression that adds two figures together** (FR-001, FR-002).
- [X] T012 [US1] In `src/components/MoneyFigures.tsx`, give each figure the wording that says where that money is and how it leaves — spendable here, committed to an order, already yours on-chain — readable without knowing the system's internals (FR-003).
- [X] T013 [US1] Implement the three-state rule for the settled figure in `src/components/MoneyFigures.tsx`: `null → '—'`, `0 → $0.00`, amount → formatted. Nothing may write `settledFundsMinor ?? 0`, compare it without a null check, or pass it to arithmetic (FR-005, FR-008, R2).
- [X] T014 [US1] Add the stale-figures rule to `src/components/MoneyFigures.tsx` and `src/pages/WalletPage.tsx`: when `data` exists and `error !== null`, keep the last known amounts on screen, visibly marked as not refreshed — never blank them and never replace them with zeros (FR-007).
- [X] T015 [US1] Wire `MoneyFigures` into `src/pages/WalletPage.tsx` using `useAccountSummary()`. **Do not add a `usePolling(['me'])`** — the page subscribes to the cache entry the shell already refreshes at 5s (R4, verified by quickstart B7).
- [X] T016 [P] [US1] Style the figures block in `src/index.css`: three figures readable at projector distance, labels and amounts distinguishable in greyscale (SC-011, quickstart G10/G11).

**Checkpoint**: Run quickstart **Part B** (B1–B7) and **Part F** F1–F3 and F7. US1 is demonstrable on its own: the screen answers "what do I have and where is it" with nothing else built.

---

## Phase 4: User Story 2 — Add funds (Priority: P1)

**Goal**: Money enters, the balance rises immediately, and the screen has already said where it came from.

**Independent Test**: On a zero-balance account, add funds and see the available balance reflect it without a refresh, with the treasury explanation visible on screen.

- [X] T017 [P] [US2] Add `parseUsd(input: string): ParseResult` to `src/lib/money.ts` per [contracts §4](./contracts/internal-api.md). **Integer arithmetic only** — split on the decimal point and build cents; no `parseFloat(x) * 100`, keeping the module's stated rule intact. Total: never throws, never returns a rounded approximation. Implements every row of quickstart Part A, including refusing `1.999` rather than truncating it, and the treasury ceiling (R6).
- [X] T018 [P] [US2] Create `src/components/AmountField.tsx`: a text input plus its refusal message (`{ label, value, error?, disabled, onChange }`). It holds **no parsing** — callers parse on submit — so the two money forms cannot validate differently.
- [X] T019 [US2] Create `src/components/WalletActions.tsx` with the single `useRef(false)` in-flight guard shared by all three actions, and the add-funds mutation calling `topUp`. The ref is the guard that actually holds; `isPending` is the slower belt to its braces (R9, following `src/components/OrderActions.tsx`).
- [X] T020 [US2] In `src/components/WalletActions.tsx`, invalidate `['me']` and `['ledger']` in `onSettled` — settled rather than success, because re-reading after an ambiguous failure is how the page finds out what happened (FR-009, FR-032, R14).
- [X] T021 [US2] In `src/components/WalletActions.tsx`, classify failures with `isConnectivityError`: a refusal shows the backend's message in place with a retry allowed; **silence disables the control and shows wait-and-see copy naming the statement** as the signal that will resolve it. No retry button on the silence branch (FR-012, R8).
- [X] T022 [US2] Add the provenance line beside the funding control in `src/components/WalletActions.tsx`, verbatim from the brief: *"Funded from the demo treasury — Rain's onramp has no Monad rail yet."* Visible without scrolling or opening anything, styled as a disclosure and not as a warning (FR-013, FR-014).
- [X] T023 [US2] Wire `WalletActions` into `src/pages/WalletPage.tsx`, passing the account from `useAccountSummary()`.
- [X] T024 [P] [US2] Style the action panels and the provenance note in `src/index.css` — the treasury line legible from the back of the room (SC-007).

**Checkpoint**: Run quickstart **Part A** (the whole parser, needs no backend), **C1–C4**, **C10**, and **F10**. Acts 1–3 can now be funded from the interface.

---

## Phase 5: User Story 3 — Read the statement (Priority: P2)

**Goal**: Every change in the available balance is accounted for, and the screen says plainly what the statement does *not* explain.

**Independent Test**: Fund, buy, cash out, then confirm one entry per movement, correctly signed, and that applying them in order arrives at the displayed available balance.

- [X] T025 [P] [US3] Create `src/lib/ledger.ts` with `entryDirection`, `entryLabel`, and `formatEntryTime` per [contracts §5](./contracts/internal-api.md). Direction comes from the **sign of the amount, never the kind** — an `adjustment` goes either way by definition. `formatEntryTime` returns `—` for an unparseable timestamp, matching `formatUsd` and `formatDuration`.
- [X] T026 [P] [US3] Create `src/hooks/useLedger.ts`: `usePolling(['ledger'], fetchLedger, { intervalMs: 5000, enabled: isSignedIn })`. No `isTerminal` — a statement never finishes. No `isFatalError` — a failing read is a resource that will come back (R13).
- [X] T027 [US3] Create `src/components/LedgerTable.tsx`: one row per movement showing amount, direction, kind label, and time, newest first, **keyed by `entry.id`** — which is what preserves scroll position across a poll (FR-015, FR-017, R13).
- [X] T028 [US3] In `src/components/LedgerTable.tsx`, link `purchase` rows to their order via `paths.orderDetail(entry.orderId)` from `src/routes/paths.ts` (FR-018).
- [X] T029 [US3] In `src/components/LedgerTable.tsx`, render an unrecognised kind with its own reported label rather than dropping the row, and render a zero-amount or correction entry like any other (FR-021, spec edge cases).
- [X] T030 [US3] Add the statement-scope note to `src/components/LedgerTable.tsx`: this statement explains the available balance, and settled funds move on-chain without producing an entry. **This is the sentence that stops a missing withdrawal row from reading as broken books** (FR-019, database-schema §3.3).
- [X] T031 [US3] Add the statement's own `LoadState` branches in `src/components/LedgerTable.tsx` — loading, error with retry, and an empty state that says there is no activity yet rather than rendering an error (FR-020). It must fail independently of the figures, and vice versa.
- [X] T032 [US3] Wire `LedgerTable` into `src/pages/WalletPage.tsx` via `useLedger()`.
- [X] T033 [P] [US3] Style the statement in `src/index.css`: rows scannable, credits and debits distinguishable by sign and word rather than colour alone, and the list scrolling within its own region so the figures stay visible above it (FR-022, SC-011, quickstart G10).

**Checkpoint**: Run quickstart **C5–C9**. **C6 is the one that matters** — apply every row on paper and confirm it reproduces the displayed balance. The screen deliberately does not do this for you (R12).

---

## Phase 6: User Story 4 — Withdraw settled funds (Priority: P2)

**Goal**: On-chain money the person already owns leaves to their own address, with a transaction anyone can check.

**Independent Test**: On an account with non-zero settled funds, withdraw; the settled figure falls and the transaction is followable to MonadVision.

- [X] T034 [P] [US4] Create `src/components/ExplorerTxLink.tsx` by extracting the validate-truncate-link core of `src/components/TxHashLink.tsx`: `isTxHash` before any `href` is built, middle truncation for display, full value in `title` and `href`, `target="_blank" rel="noopener noreferrer"`, URL from `explorerTxUrl` and nowhere else. A hash that does not validate renders as plain text with a caveat, never as a link (FR-030, R15).
- [X] T035 [US4] Edit `src/components/TxHashLink.tsx` to delegate its present-hash branch to `ExplorerTxLink`. **Props do not change** and the verdict card's call site does not move; the copy button and both missing-hash sentences stay here. Depends on T034.
- [X] T036 [US4] Add the withdraw mutation to `src/components/WalletActions.tsx`, calling `withdraw()` with no argument — `withdrawFor(wallet)` moves the whole balance and there is no partial withdrawal to expose. It shares the T019 in-flight ref. Depends on T019.
- [X] T037 [US4] Implement withdraw's two disabled states in `src/components/WalletActions.tsx`, with **different copy for each**: nothing settled to withdraw (zero), and could not be read just now (`null`). The button returns on its own when a later read succeeds, with no reload (FR-027, R10 — the deliberate divergence from `useAccountSummary`'s warning).
- [X] T038 [US4] State in the withdraw control's copy that it sends on-chain funds to the signed-in address and asks for no signature, and indicate that an on-chain movement may take a moment — never reporting a completion the screen has not observed (FR-023, FR-029).
- [X] T039 [US4] Render the withdrawal receipt in `src/components/WalletActions.tsx` using `ExplorerTxLink` when `txHash` is present, and a plain confirmation when it is `null` (FR-030, handoff assumption 6). Depends on T034, T036.
- [X] T040 [US4] Give withdrawal its own silence copy in `src/components/WalletActions.tsx`, naming **the settled figure falling** as the resolving signal — not the statement, which will never show a withdrawal (R8, FR-031).
- [X] T041 [P] [US4] Style the withdraw panel and receipt in `src/index.css`.

**Checkpoint**: Run quickstart **Part D**, plus **F4**, **F5**, **F11**. Re-run UI-05's verdict-card transaction-link check — T035 touched a component the demo's closing beat depends on.

---

## Phase 7: User Story 5 — Cash out unspent balance (Priority: P2)

**Goal**: Money can leave the way it came in, so the demo never has a one-way door.

**Independent Test**: On an account with an unspent balance, cash out; the available balance falls and a matching debit appears in the statement.

- [X] T042 [US5] Add the cash-out mutation to `src/components/WalletActions.tsx`, calling `cashOut(amountMinor)` and sharing the T019 in-flight ref and the T020 invalidations. Depends on T019.
- [X] T043 [US5] Add the cash-out `AmountField` in `src/components/WalletActions.tsx`, **pre-filled with the whole available balance** so the common case is one click and the funder-wallet health check actually gets exercised (R7, rain-integration §0.3). Depends on T018.
- [X] T044 [US5] Refuse an amount above the available balance locally in `src/components/WalletActions.tsx`, before anything is submitted — verified by an empty network tab, not just by the message (FR-027). Note this is the *amount* rule, not the unknown-figure rule: cash-out keeps `useAccountSummary`'s original doctrine and is never blocked by a failed read (R10).
- [X] T045 [US5] Disable cash-out with a stated reason when the available balance is zero (FR-027), and give it the statement-naming silence copy from T021.
- [X] T046 [US5] Label both exits in `src/components/WalletActions.tsx` so they cannot be confused: which figure each one moves and where that money goes — cash-out returns platform money to the treasury it was funded from; withdrawal sends on-chain money to the person's own address (FR-024, FR-025).
- [X] T047 [P] [US5] Style the cash-out panel in `src/index.css` so the two exits read as siblings with different destinations.

**Checkpoint**: Run quickstart **Part E**, including **E7** — the funder wallet's balance must fall on top-up and rise on cash-out. Both doors now work.

---

## Phase 8: Polish & Cross-Cutting

- [ ] T048 Run the full degradation pass, quickstart **Part F** (F1–F12), including pointing the API at a dead RPC and renaming `settledFundsMinor` in the response. **This is the part nobody runs**, and F6 is the `67dcf4d` check.
- [X] T049 [P] Run the boundary sweep, quickstart **Part G** G1–G9. Each prints nothing; G9 is the exhaustiveness check — add a fifth `LedgerKind` locally, expect a compile error in `src/lib/ledger.ts`, revert.
- [ ] T050 [P] Run **G10** (greyscale screenshot) and **G11** (legibility from the back of the room on the presentation display).
- [X] T051 `npm run typecheck` and `npm run lint` clean across the whole feature.
- [X] T052 Check `PagePlaceholder` is still used by the remaining unbuilt pages in `src/pages/` before assuming it is dead code — UI-07 and UI-08 have not landed. Remove nothing.
- [ ] T053 Run quickstart **Part H**: the stranger test (SC-001), the unasked treasury question (SC-007), Act 1 end to end twice with a return to `/wallet` each time, and a fifty-entry statement scrolled with the figures still visible.

---

## Dependencies & Execution Order

### Phase dependencies

- **Setup (Phase 1)** → no dependencies. T001 should go out first; it is the longest-lead item and the backend work it describes gates Phases 4–7 end to end.
- **Foundational (Phase 2)** → depends on Setup. **Blocks every story.**
- **US1 (Phase 3)** → Foundational only. This is the MVP.
- **US2 (Phase 4)** → Foundational. Independent of US1 in principle; in practice both render into the page shell from T009.
- **US3 (Phase 5)** → Foundational. Fully independent of US2, US4, US5 — different files throughout except `index.css`.
- **US4 (Phase 6)** → Foundational + T019 (the shared in-flight ref lives in `WalletActions`).
- **US5 (Phase 7)** → Foundational + T018, T019.
- **Polish (Phase 8)** → all desired stories complete.

### The two concurrency gates

- **`src/components/WalletActions.tsx`** is written by US2 (T019–T022), then extended by US4 (T036–T040) and US5 (T042–T046). One component owns all three mutations and one in-flight guard on purpose (R9) — all three movements touch the same balance, and two in flight at once produce a statement whose ordering nobody can predict. The cost is that these three stories are sequential in this file.
- **`src/index.css`** is touched by every story. The styling tasks are marked [P] because they are independent *within* a story, but two people editing this file at once will conflict.

### Within a story

Types and pure functions → API layer → hooks → components → wiring → styling. No task depends on a later one.

### Real parallel opportunities

- T008 with T004–T007 (different files, though T008's consumer arrives later)
- T017 with T018 (`lib/money.ts` and `AmountField.tsx`)
- T025 with T026 (`lib/ledger.ts` and `useLedger.ts`)
- T034 with anything in US2 (`ExplorerTxLink.tsx` is a new file with no dependants until T035)
- All styling tasks with the story that precedes them, if one person owns `index.css`

---

## Parallel Example: Foundational + first story

```bash
# After T004–T007 land (all in api/), these are genuinely independent:
Task: "T008 Extend AccountSummaryResult with error in src/hooks/useAccountSummary.ts"
Task: "T017 Add parseUsd to src/lib/money.ts"
Task: "T018 Create src/components/AmountField.tsx"
Task: "T025 Create src/lib/ledger.ts"
Task: "T026 Create src/hooks/useLedger.ts"
Task: "T034 Create src/components/ExplorerTxLink.tsx"
```

Six files, no shared edits, none of them importing another. This is the widest the feature ever gets.

---

## Implementation Strategy

### MVP (US1 only)

1. Phase 1 → Phase 2 → Phase 3.
2. **Stop and validate**: quickstart Part B and F1–F3.
3. What you have is the screen's actual argument — three kinds of money told apart, degrading correctly when the chain cannot be read. It ships value with no money moving at all, and it is the half of the feature that cannot be demonstrated by the API alone.

### Incremental delivery

1. Foundation → US1 (**MVP**: the figures)
2. → US2 (funding — this is what unblocks rehearsing Acts 1–3)
3. → US3 (the statement — what makes the balance believable rather than asserted)
4. → US4 and US5 (the two exits — without US5 the demo has a one-way door, which is the first thing an observer probes)

### If the API slips

Phases 1–2 plus T017 (`parseUsd`) and T025 (`lib/ledger.ts`) are worth landing regardless: quickstart **Part A** is a complete acceptance run for the parser needing nothing but the dev server, and it is the part nobody returns to once money is moving on screen.

---

## Notes

- **No tests, by decision.** Every checkpoint above is a quickstart part run by hand, and the demo rehearsal is the real regression check.
- `[P]` = different file, no dependency on an incomplete task.
- Commit after each task or logical group.
- Three departures from written-down rules are deliberate and argued — the `fetchMe` coercion (T006), disabling withdraw on an unknown figure (T037), and editing three shared modules (T006, T008, T035). Each carries its reasoning in [research.md](./research.md); none is an oversight, and a reviewer who finds them should read the R-number before "fixing" them.
