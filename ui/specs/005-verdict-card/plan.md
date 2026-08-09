# Implementation Plan: Verdict card & case file

**Branch**: `005-verdict-card` | **Date**: 2026-08-08 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/005-verdict-card/spec.md`

## Summary

Replace the reserved region UI-04 left on the concluded face with the component the audit's credibility rests on: a card carrying the refund tier, the two money figures, Guardian's reasoning, the cited clauses **as a ✓/✗ checklist**, and the settlement transaction linked out to MonadVision — plus a case-file panel showing the evidence Guardian was given.

The approach is thinner than UI-04's. **No shared machinery changes at all**: `usePolling`'s two predicates, added last feature for the order poll, turn out to express both of this feature's cadences exactly — the verdict polls at 1s between `adjudicated` and the transaction landing then stops (R6), and the case file is read exactly once. No new dependencies, no new environment variables, no route, no persisted state, and one `useState` in the whole feature.

Four decisions carry the weight. **The split comes from the settled refund amount, never from the tier's percentage** (R3) — two independent calculations of a rounded quantity disagree eventually, and the number that settled is the number that is true. **Citations are normalised tolerantly at the boundary** (R5), a deliberate exception to this app's no-shape-tolerance rule, because the column is unvalidated `jsonb` and dropping a ragged citation deletes evidence from the one screen that exists to show evidence. **Execution steps arrive on a new type from the one route documented as redacted** (R8), which is why this does not reverse UI-04's decision to keep `steps` off `OrderRun`. And **`VerdictSlot` is deleted rather than grown** (R13).

Nine new files, three edits, one deletion. The spec needed no corrections during planning — a first for this component.

## Technical Context

**Language/Version**: TypeScript 5.9.3, React 19.2.8. Unchanged strict settings.

**Primary Dependencies**: **None added.** Existing: `@tanstack/react-query@5.101.4` (via `usePolling`, unchanged), `react-router-dom@7.18.2`. viem contributes one type import (`Hex`) and the chain definition `explorerTxUrl` already wraps; wagmi is not used and must not be — the frontend never calls the escrow contract (`ui/docs/CONTEXT.md` §2, FR-029).

**Storage**: None. No `localStorage` keys, no context, no refs. The verdict is immutable once settled, so there is nothing to cache beyond what React Query already holds.

**Testing**: **None.** No unit, integration, or e2e tests — an explicit project decision (`ui/docs/CONTEXT.md`), restated as FR-036. Acceptance is by hand via [quickstart.md](./quickstart.md); Part A is the branch sweep the demo will never produce, Part G is the boundary sweep, and "what done means" is a stranger reading the checklist back to you.

**Target Platform**: Desktop Chrome on a demo laptop at roughly 1280×800, and a projector — SC-005 and SC-006 are both about what survives the room.

**Performance Goals**: Zero requests for a settled order once its card has been read (FR-033). One verdict request per second only during the `adjudicated → settled` window, which is seconds long.

**Constraints**: No chain call and no wallet signature (FR-029). No code path capable of rendering seller-private material, enforced by `CaseFileStep` having `summary` and no `reasoning`, `prompt`, or `raw` (FR-026). Money is integer cents; the feature performs exactly one arithmetic operation on it, guarded (R3). No client-side redaction (FR-027) — this screen renders what it is given and refuses to have anywhere to put a prompt.

**Scale/Scope**: 9 new files, 3 edited, 1 deleted, 2 backend endpoints consumed — **neither of which exists yet** (the API's Guardian module is unbuilt; `api/specs/` holds 001–003). One developer, a day.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

**Status: NOT EVALUATED — no ratified constitution exists.**

`.specify/memory/constitution.md` is still the unmodified Spec Kit template. Fifth consecutive feature to record it; UI-03's plan made the argument at length and repeating it is noise. The substitute is unchanged and works: [quickstart.md](./quickstart.md) Part G turns this feature's structural rules — no chain call, no seller IP in the types, one explorer host, no new dependency, no shared-machinery edits, no percentage arithmetic on money, the placeholder actually deleted — into nine commands a reviewer runs in under a minute.

**Post-Phase 1 re-check**: unchanged. No constitution was added during planning, and no design decision below would violate one if it existed.

## Key Decisions

Full reasoning in [research.md](./research.md). The five worth arguing about:

| Decision | Why | Reversibility |
| --- | --- | --- |
| **The split is `refundMinor` and `price − refundMinor`, never the tier's percentage** (R3) | `refund_minor` is what the API hashed into `verdict_hash` and what `resolve()` actually moved. A client-side percentage is a second calculation of a rounded quantity, and on an odd-cent price there is a version of the demo where the card says $0.50 and the explorer says $0.49. Out-of-range values render the seller's figure as `—` with a note rather than clamping — clamping produces two plausible numbers that quietly contradict the chain, which is the exact failure this feature exists to prevent. | If the API sends `sellerMinor`, the subtraction and its guard become dead code to delete. Requested in the handoff as a *should*. |
| **Citations are normalised tolerantly — a deliberate exception** (R5) | `fetchOrder` has no shape tolerance and its comment argues why. That rule is wrong here: the column is `jsonb` with no schema, typed `unknown[]` by the API's own model, so tolerance *is* the contract. And the failure modes differ — a tolerant agent list is silently wrong, whereas an incomplete citation row is loudly wrong and says what is missing. One asymmetry is absolute: a citation with no recorded `met` is never rendered as met. | The normaliser is one function at the boundary; strictness is a rewrite of forty lines. |
| **The verdict polls to a stopping condition on one cache key** (R6) | Between `adjudicated` and `settled` the ruling exists but `onchain_tx_hash` is null, and FR-031 wants the link to appear unattended. Keying the query on state would refetch cleanly but unmount and rebuild the card — visible flicker on the demo's closing beat. One key, `isTerminal: txHash !== null \|\| settled`, updates in place. The `\|\| settled` half closes the case where settlement records no hash, which would otherwise poll a permanently-null field forever. | Two predicates in one hook. |
| **Steps arrive on `CaseFileStep`, not on `OrderRun`** (R8) | The diff looks like a regression of UI-04's "the absent property is the guarantee". It is not: `GET /orders/:id` is a general read, while `GET /orders/:id/case-file` is the one route documented as *"redacted for a buyer, full for the seller"*, whose serialiser summarises reasoning text precisely because a step can paraphrase its own instructions. So the buyer's step has `summary` and no `reasoning`. `OrderRun` keeps having no steps at all. | Delete one type; the panel loses its most legible section. |
| **The transaction hash is shape-validated before it becomes a link** (R9) | FR-018 forbids a link with nothing behind it, and a malformed hash is exactly that — authoritative-looking, clicked on stage by the one person who wants to verify the claim, landing on an explorer 404. The item whose entire job is independent verifiability cannot fail when someone verifies it. | One regex and one branch. |

**No spec corrections were needed.** UI-03 and UI-04 each amended two requirements during planning; this spec's four informed guesses (case file available from `disputed`, the refund amount governing the split, citations arriving structured, no card for an uncontested release) were re-examined against the schema and the existing code in R3, R5, R7, and R15, and all four survived unchanged.

## Project Structure

### Documentation (this feature)

```text
specs/005-verdict-card/
├── plan.md              # This file
├── spec.md              # Feature specification (unamended)
├── research.md          # Phase 0 — 15 resolved decisions
├── data-model.md        # Phase 1 — payload types, normalisation rules, derived figures, query keys
├── quickstart.md        # Phase 1 — the manual acceptance run (Parts A–G)
├── contracts/
│   └── internal-api.md  # Phase 1 — module surface + the backend handoff (§6)
├── checklists/
│   └── requirements.md  # Spec quality checklist
└── tasks.md             # Phase 2 — created by /speckit-tasks, not here
```

### Source Code (repository root)

```text
ui/src/
├── api/
│   ├── types.ts                    EDIT — + VerdictTier, Citation, Verdict, CaseFile, CaseFileStep
│   └── verdicts.ts                 NEW  — fetchVerdict, fetchCaseFile
├── lib/
│   └── verdict.ts                  NEW  — tier vocabulary, the split, citation normalisation, hash validation
├── hooks/
│   ├── useVerdict.ts               NEW  — polls until the transaction lands, then stops
│   └── useCaseFile.ts              NEW  — one attempt, then explicit retry
├── components/
│   ├── VerdictCard.tsx             NEW  — badge, split, reasoning, and the never-blank rule
│   ├── CitationChecklist.tsx       NEW  — the feature's argument
│   ├── TxHashLink.tsx              NEW  — validate, truncate, link out, copy in full
│   ├── CaseFilePanel.tsx           NEW  — the evidence, in a native <details>
│   ├── ExecutionSteps.tsx          NEW  — what the agent did, with timings
│   └── VerdictSlot.tsx             DELETE — replaced by the real card (R13)
├── pages/
│   └── OrderDetailPage.tsx         EDIT — card on adjudicated and settled; case file whenever disputed
└── index.css                       EDIT — card, badge, split, checklist rows, steps, details panel;
                                           the .verdict-slot block is removed
```

**Structure Decision**: no new directories, for the fourth time, and this is the feature where that starts to cost something — `src/components/` goes from twenty files to twenty-four. The argument for holding is unchanged and now nearly spent: UI-06 through UI-08 would each have to guess whether their components belong in `order/`, `verdict/`, or the root, and a reorganisation done twice is worse than one done late. **Recommendation: reorganise once after UI-08**, when the full set is visible, as a mechanical move with no behaviour change.

`src/lib/verdict.ts` earns its place on the same grounds as `orderState.ts` and `money.ts`: it is pure data transformation with no React in it, and its five functions each have callers that must not disagree — the tier vocabulary is shared by the badge and any future orders-list chip, and `splitFor` is the only arithmetic in the feature.

`src/chain/chains.ts` is **used and not edited**. Its module comment names this feature by number; `explorerTxUrl` was written for it.

## Implementation Order

Dependency-ordered, matching the spec's story priorities. Each step is verifiable against the named part of [quickstart.md](./quickstart.md).

| # | Step | Story | Verify |
| --- | --- | --- | --- |
| 0 | **Confirm handoff assumption 2** — citations arrive structured, not prose | — | A conversation, not a command. If they arrive as prose, stop and fix it upstream; there is no client-side recovery. |
| 1 | `api/types.ts` additions; `lib/verdict.ts` — pure, exhaustive, total | — | `npm run typecheck`; **G6** (add a sixth tier locally, expect a compile error) |
| 2 | `api/verdicts.ts` — both fetchers, normalisation wired at the boundary | — | **Part A** with hand-crafted responses — A1–A9 are all reachable without a backend |
| 3 | `hooks/useVerdict.ts`, `hooks/useCaseFile.ts` | US5 | **F3**, **F6** in the network panel |
| 4 | `VerdictCard` + `CitationChecklist`; delete `VerdictSlot`; page call sites | US1, US2 | **Part B**, **Part C**, **G8** |
| 5 | `TxHashLink` | US3 | **Part D** — D2 is the one that matters |
| 6 | `CaseFilePanel` + `ExecutionSteps` | US4 | **Part E** |
| 7 | `index.css` — checklist rows, badge, split, details panel | US2 | **C4** (greyscale), **C5** (distance), **C6** (long clause) |
| 8 | Failure surfaces: verdict retry, case-file retry, settlement-pending | US5 | **A11**, **A12**, **D4**, **D5** |
| 9 | Boundary sweep, then the rehearsal | — | **Part G**, then Act 2 twice |

Steps 1–2 are worth landing before the API's Guardian module exists: Part A is the whole normalisation surface and it is entirely offline, and it is the part nobody returns to once the happy path renders.

## Risks

| Risk | Impact | Response |
| --- | --- | --- |
| **Citations arrive as prose rather than structured objects.** | **Feature-invalidating.** FR-007 cannot be met from the client — splitting model prose into clauses would be inventing evidence. | The only blocking risk here. Step 0 confirms it before anything is built; handoff assumption 2 flags it as the one to check first. |
| **Neither endpoint is built.** Both payloads are assumptions. | Parts B–F cannot run; field names may be wrong on first contact. | Deliberate (R1). [contracts/internal-api.md §6](./contracts/internal-api.md) is the diff list — 13 numbered assumptions, one requested field. Blast radius is one file. |
| **`refund_minor` disagrees with what settled on-chain.** | The card would state a split the explorer contradicts — the worst failure available on this screen. | R3 takes the recorded amount as authoritative and never recomputes. If they genuinely diverge, that is an API bug the card now makes visible rather than papers over. |
| **The case file's clauses come from today's listing rather than the version that ran.** | Citation quotes disagree with the panel beneath them; a seller who edits after losing looks vindicated. | Handoff assumption 9. The client deliberately never reads `GET /agents/:id` (R15), so this cannot be hidden client-side. |
| **`onchain_tx_hash` stays null on a settled order.** | The demo's most persuasive artefact is missing. | Renders as "no transaction reference recorded" (D5) and does not poll forever (R6). The underlying fix is the API's. |
| **A leaked prompt in `steps[].summary`.** | The seller-IP guarantee breaks. | Not preventable here, and deliberately not attempted (FR-027) — a client-side filter would be theatre that also hides the serialiser's failure. The type has no field for a raw prompt; E8 and G1 are the checks. |
| **Twenty-four files in `src/components/`.** | Navigability, not correctness. | Accepted, with a recommendation to reorganise once after UI-08. |
| **No constitution**, fifth feature running. | Structural rules enforced by review only. | Part G converts the eight that matter into greps. |

## Complexity Tracking

No constitution exists, so there are no violations to justify. Nothing in this plan adds a dependency, a directory, an environment variable, a route, or a persisted key — and unlike UI-04, nothing edits shared machinery either: `usePolling`, `queryClient`, `client.ts`, `errors.ts`, and `orders.ts` are all untouched.

The one complexity worth naming is the citation normaliser (R5), which deliberately departs from a documented app-wide rule. It is confined to one function at one boundary, its rules are tabulated in [data-model.md §2](./data-model.md), and every branch has a row in quickstart Part A.
