# Implementation Plan: Order Detail — the hero page

**Branch**: `004-order-detail` | **Date**: 2026-08-08 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/004-order-detail/spec.md`

## Summary

Turn the last placeholder into the screen the product is actually about: one page with five faces, driven by `orders.state`, that follows a live order at 1s, counts a review window down to zero, shows the delivered output beside the criteria the buyer wrote before any work happened, and carries Accept and Complain.

The technical approach is again deliberately thin. No new dependencies, no new environment variables, no new persisted state, and no change to the query-client defaults. Four small pure modules (`orderState`, `duration`, `serverClock`, and the countdown hook), one data hook wrapping the polling machinery UI-01 already built, eight components, and a page rewrite.

Only three pieces are genuinely new thinking: a **server-anchored clock** so the countdown cannot be wrong on a laptop with a skewed clock (R3), a **monotonic face guard** so the page cannot visibly regress (R10), and the recognition that on this screen **the poll is the recovery mechanism for an ambiguous action** — which is why UI-03's "never retry on silence" rule deliberately does not carry over (R11).

Roughly eleven new files and five edits, two of which touch shared machinery: three lines in `api/client.ts` and one optional predicate on `usePolling`. Two spec corrections were made during planning (R5 and R14) and are written up below.

## Technical Context

**Language/Version**: TypeScript 5.9.3, React 19.2.8. Unchanged strict settings.

**Primary Dependencies**: **None added.** Existing: `@tanstack/react-query@5.101.4` (the poll, and `useMutation` for both actions), `react-router-dom@7.18.2`. wagmi and viem are not used by this feature and must not be — the frontend never calls the escrow contract (`ui/docs/CONTEXT.md` §2), which is what settles FR-038 in R14.

**Storage**: None. No `localStorage` keys. An unsent complaint reason is lost on reload, correctly — a reason typed but not confirmed was not filed.

**Testing**: **None.** No unit, integration, or e2e tests — an explicit project decision (`ui/docs/CONTEXT.md`), restated as FR-037. Acceptance is by hand via [quickstart.md](./quickstart.md); Part G is the boundary sweep, and "what done means" is the rehearsal.

**Target Platform**: Desktop Chrome on a demo laptop at roughly 1280×800 — the viewport SC-003 is measured at.

**Performance Goals**: One request per second per open order, and zero once it finishes (SC-005). The countdown ticks once per second and recomputes rather than decrementing, so it cannot drift (R6).

**Constraints**: No wallet signature and no chain call anywhere (FR-033). No code path capable of rendering seller-private material — enforced by `OrderRun` having no `steps` property and `Order` having no `systemPrompt` (FR-008). Money is integer cents; this feature performs no arithmetic on it at all, only formatting.

**Scale/Scope**: 11 new files, 5 edited, 3 backend endpoints consumed — **none of which exist yet** (the API's orders module is unbuilt; `api/specs/` holds 001–003). One developer, a day.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

**Status: NOT EVALUATED — no ratified constitution exists.**

`.specify/memory/constitution.md` is still the unmodified Spec Kit template. This is the fourth consecutive feature to record that, and UI-03's plan already made the argument at length; repeating it would be noise. The substitute is unchanged and works: [quickstart.md](./quickstart.md) Part G turns this feature's structural rules — no chain call, no seller IP in the types, no new dependency, no change to the query defaults, no stray timers — into seven commands a reviewer runs in thirty seconds.

**Post-Phase 1 re-check**: unchanged. No constitution was added during planning.

## Key Decisions

Full reasoning in [research.md](./research.md). The five worth arguing about:

| Decision | Why | Reversibility |
| --- | --- | --- |
| **A server-anchored clock, degrading silently to the device clock** (R3) | The countdown is the one number the audience is invited to trust, and it is computed entirely client-side. Skew of two minutes shows a window that expired before delivery. The `Date` header is on every response the page already makes: no new endpoint, no extra request, ~20 lines. The catch worth knowing before it is debugged twice — `Date` is not CORS-safelisted, so cross-origin it reads `null` until the API sends `Access-Control-Expose-Headers: Date`. Until then the fallback is exactly today's behaviour. | Delete one module and one call site. |
| **Polling continues while the page is hidden — spec correction** (R5) | `queryClient` sets `refetchIntervalInBackground: true` with a comment written for this feature: React Query pauses intervals when the document is hidden, and on macOS an *occluded* window counts as hidden. FR-012 as written would mean the page does not flip to released when the browser sits behind a terminal — the one failure Act 1 cannot survive. | The requirement moved, not the code. Reversing it means editing one line in `queryClient.ts` and accepting the stage risk. |
| **On silence, the poll recovers — no retry rule** (R11) | Copying UI-03's R12 here would be cargo-culting. `POST /orders` was dangerous on a timeout because it debits a ledger with no screen watching. Accept and Complain are state transitions on an order this page re-reads every second: if the complaint landed, the page corrects itself within a second, and a duplicate meets an order that has already moved and is refused. So: say we did not hear back, offer no retry, and let the poll answer. | Copy and one branch. |
| **Output rendered by shape — table, prose, or JSON** (R9) | Act 2's argument is that the audience counts rows and reaches 50% before Guardian says it. Counting rows in a JSON blob is possible; counting them in a table is instant. Thirty lines in the one component the centrepiece depends on. The JSON branch guarantees no seller's output shape can produce a blank panel. | One component, three branches. |
| **`usePolling` gains one optional predicate** (R15) | The hook's error branch keeps polling, which is right for a blip and wrong for a 404 — a mistyped order URL would otherwise issue a request every second forever, the exact behaviour FR-010 and SC-005 exist to prevent. Optional and defaulted, so the three existing callers are untouched, and it belongs in the hook because the hook owns the schedule. | Additive; deleting it restores today's behaviour. |

### Two spec corrections were made during planning

**FR-012 was rewritten** (R5). It required suspending polling while the page is hidden and re-reading on return. That contradicts a deliberate UI-01 decision whose comment names this feature by its acceptance criterion. Polling now continues while hidden; the countdown is still recomputed on return, so FR-018 is untouched, and `refetchOnWindowFocus: false` means there is still no catch-up burst. US7's fourth scenario moved with it.

**FR-038 was narrowed** (R14). It said the optional header escrow figure came from the escrow contract's own total, inherited from `docs/ui-design.md` §6. The frontend never calls the escrow contract (`CONTEXT.md` §2), so that phrasing asked for the first violation of a standing rule in service of an explicitly optional nicety. The header already shows in-escrow from `GET /me`, which is the better number anyway — it is the buyer's own money, already on every page — and R13 makes it move on cue. The requirement now names the account read as its source, and the feature's cost for it is three lines.

Both edits are in `spec.md`; this section is the record of why.

## Project Structure

### Documentation (this feature)

```text
specs/004-order-detail/
├── plan.md              # This file
├── spec.md              # Feature specification (FR-012 and FR-038 amended during planning)
├── research.md          # Phase 0 — 17 resolved decisions
├── data-model.md        # Phase 1 — payload types, faces, timing model, query keys
├── quickstart.md        # Phase 1 — the manual acceptance run (Parts A–G)
├── contracts/
│   └── internal-api.md  # Phase 1 — module surface + the backend handoff (§7)
├── checklists/
│   └── requirements.md  # Spec quality checklist
└── tasks.md             # Phase 2 — created by /speckit-tasks, not here
```

### Source Code (repository root)

```text
ui/src/
├── api/
│   ├── client.ts                   EDIT — feed the Date header to serverClock (3 lines)
│   ├── orders.ts                   EDIT — + fetchOrder, acceptOrder, complainAboutOrder
│   └── types.ts                    EDIT — + OrderState, OrderRun, Order, ComplainRequest
├── lib/
│   ├── orderState.ts               NEW — faceFor, isTerminalState, stateRank, stateLabel
│   ├── duration.ts                 NEW — formatRemaining, formatElapsed
│   └── serverClock.ts              NEW — skew from the Date header; serverNow()
├── hooks/
│   ├── usePolling.ts               EDIT — + optional isFatalError predicate
│   ├── useCountdown.ts             NEW — recomputes from a deadline; never decrements
│   └── useOrder.ts                 NEW — the poll, the monotonic guard, the ['me'] nudge
├── components/
│   ├── OrderSummaryHeader.tsx      NEW — the band that survives every face
│   ├── SubmittedInput.tsx          NEW — what the buyer sent
│   ├── OutputPanel.tsx             NEW — table / prose / JSON by inspection
│   ├── CriteriaPanel.tsx           NEW — the buyer's words, verbatim
│   ├── ReviewCountdown.tsx         NEW — the clock and its expired wording
│   ├── OrderActions.tsx            NEW — both mutations, the in-flight guard, failure copy
│   ├── ComplainDialog.tsx          NEW — native <dialog>, reason, finality, confirm
│   └── VerdictSlot.tsx             NEW — the region UI-05 fills
├── pages/
│   └── OrderDetailPage.tsx         REWRITE — face selection and layout
└── index.css                       EDIT — the two-column review layout, panels, dialog, chip
```

**Structure Decision**: no new directories, for the third time. `src/components/` reaches fourteen files with this feature, which is the point where a folder starts to look tempting — and the point where inventing one costs more than it saves, because UI-05 through UI-08 would each have to guess whether their components belong in `order/`, `verdict/`, or the root. If a reorganisation happens it should happen once, after UI-08, when the full set is visible.

The four `lib/` modules are there for the same reason `money.ts` is: they are pure data transformations with no React in them, and each has two callers that must not disagree. `duration.ts` in particular exists because the elapsed line and the countdown would otherwise each invent their own wording for "four minutes".

`routes/paths.ts` and `AppRoutes.tsx` are untouched — the route exists and is already behind `RequireAuth`, which is the whole of FR-035 including the return-to-order behaviour.

## Implementation Order

Dependency-ordered, matching the spec's story priorities. Each step is verifiable against the named part of [quickstart.md](./quickstart.md).

| # | Step | Story | Verify |
| --- | --- | --- | --- |
| 1 | `api/types.ts` additions; `api/orders.ts` wrappers | — | `npm run typecheck` clean |
| 2 | `lib/orderState.ts`, `lib/duration.ts` — pure, exhaustive | — | Typecheck; add a ninth state locally and confirm `faceFor` fails to compile |
| 3 | `lib/serverClock.ts` + the `client.ts` call site | US2 | **D9**; check `clockSkewMs()` in the console with the OS clock moved |
| 4 | `hooks/usePolling.ts` predicate; `hooks/useOrder.ts` | US1, US7 | **Part A** (A3, A4 are the ones that matter), then **B2** |
| 5 | `OrderSummaryHeader`, `SubmittedInput`, page shell with face selection | US1 | **Part B** |
| 6 | `hooks/useCountdown.ts`; `ReviewCountdown` | US2 | **Part D** — D2, D3, D6, D7 |
| 7 | `OutputPanel`, `CriteriaPanel`, the two-column CSS | US3 | **Part C** at 1280×800 |
| 8 | `OrderActions` + Accept | US3 | **E1, E2** |
| 9 | `ComplainDialog` + Complain, and the refusal/silence branches | US4 | **Part E** — E3–E7, E9–E11 |
| 10 | Failed face; `VerdictSlot`; the `['me']` nudge on terminal | US5, US6 | **Part F**, **E8**, **D5** |
| 11 | Boundary sweep | — | **Part G**, then the rehearsal |

Steps 4 and 5 are worth landing before the backend exists: Part A is the offline acceptance, and A4 (a 404 must not poll) is the kind of thing nobody goes back for once the happy path works.

## Risks

| Risk | Impact | Response |
| --- | --- | --- |
| **The API's orders module is not built.** All three endpoints and the whole payload shape are assumptions. | Parts B–F cannot run. Field names may be wrong on first contact. | Deliberate (R1). [contracts/internal-api.md §7](./contracts/internal-api.md) is the diff list, with seven numbered assumptions and one CORS request. The blast radius is two files. |
| **`agentName` or `run` not embedded in `GET /orders/:id`.** | A second or third request per second on the hot path. | Called out as handoff assumptions 2 and 3, with the reason to push back rather than paper over it client-side. |
| **The sweeper is not running, or the review window is not turned down.** | D2–D4 fail for a reason that has nothing to do with this page, at the worst possible moment. | Named in the quickstart prerequisites, with the instruction to check API logs before debugging the page. |
| **`Date` header hidden by CORS.** | The countdown falls back to the device clock; FR-017 unmet in practice. | Silent and harmless (R3), flagged as a *should* in D9, one header line in the handoff. |
| **Output that is neither a flat array nor a string** — nested objects, an empty array. | An ugly but present panel. | Accepted. The JSON branch guarantees something renders; three seeded agents make the pretty paths the common ones. |
| **A rehearsal that reaches `adjudicated` before UI-05 exists.** | The concluded face looks unfinished. | `VerdictSlot` renders a labelled region and a line, never a blank gap (FR-007). It is a container, and E8 checks it. |
| **No constitution**, fourth feature running. | Structural rules enforced by review only. | Part G converts the five that matter into greps. |

## Complexity Tracking

No constitution exists, so there are no violations to justify. Nothing in this plan adds a dependency, a directory, an environment variable, or a persisted key. Two shared files are edited, both additively and both argued for in research: three lines in `api/client.ts` (R3) and one optional, defaulted option on `usePolling` (R15).
