# Implementation Plan: Contract Reconciliation & Manual Test Plan

**Branch**: `008-contract-reconciliation-test-plan` | **Date**: 2026-08-09 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/008-contract-reconciliation-test-plan/spec.md`

## Summary

Two deliverables, one of which turned out to be urgent.

**The reconciliation.** Every frontend↔API boundary compared against `api/docs/openapi.yaml`,
read through `api/docs/openapi-divergences.md`. The desk pass is done and is recorded in
[research.md](./research.md): **11 disagreements, two of which stop the demo dead.**

1. **Sign-in is broken.** The contract issues `{ nonce, message }` and requires a signature
   over `message` — a multi-line string embedding the address, explicitly marked *"do NOT
   recompose this client-side."* `useSignIn` signs `nonce` verbatim. Every `POST /auth/verify`
   is a 401, and since every page but three sits behind `RequireAuth`, nothing works. This is
   the second instance of the exact bug class the source brief predicted: the field name is
   right, the value is wrong, and no type could have caught it.
2. **The verdict poll gives up on a pending audit.** `GET /orders/{id}/verdict` returns two
   different 404s — `ORDER_NOT_FOUND` (stop) and `VERDICT_NOT_FOUND` (the audit is still
   running, keep polling). `useVerdict` treats both as fatal, and `AUDIT_FAILED` (409) as
   retryable, which is backwards in both directions. Act 2's verdict card may never arrive.

The remaining nine range from the already-known (`OwnedAgentResponse.listed` absent from the
seller's type) through an `api-wrong` row that must be escalated rather than absorbed (a
buyer's case-file `steps` is unconditionally `[]`) to seven contract fields the frontend
ignores, six of them correctly.

**The test plan.** `ui/docs/manual-test-plan.md` — a checklist a human executes with a
browser and no source access. Its shape is fixed by the spec (§0–§7, one concrete expected
result per step, a pass/fail column) and its content is fixed by the three demo acts, the
seller flow, the money flows, and the carryovers from UI-05 and UI-07.

**Approach.** Reconcile first, in severity order, because the test plan describes a product
that must be able to pass it — writing steps against a build where sign-in 401s produces a
document nobody can execute. Both blockers are small, localised fixes. Then write the plan,
then execute nothing: this feature does not run it.

## Technical Context

**Language/Version**: TypeScript 5.x, React 19, Vite — existing `ui/` component, unchanged

**Primary Dependencies**: wagmi/viem (wallet + signing), TanStack Query (polling), React
Router. No new dependency is added by this feature.

**Storage**: N/A — the frontend holds a session token in browser storage and nothing else

**Testing**: **Manual only, by standing decision** (`ui/docs/CONTEXT.md` §"Automated tests").
This feature's second deliverable *is* the test procedure. No test framework is introduced.

**Target Platform**: Desktop browser with an injected wallet (MetaMask), Monad Testnet
(chain 10143). The demo runs on a laptop driving a projector — which is why greyscale and
three-metre legibility are correctness checks here rather than polish.

**Project Type**: Single-page web frontend against a REST API, plus two Markdown deliverables

**Performance Goals**: Unchanged. Order Detail polls at 1s while live and stops on a terminal
state; Wallet at 5s. No reconciliation fix may make a poll slower or more frequent.

**Constraints**:

- **Do not generate types from `openapi.yaml`.** Six frontend types encode guarantees by
  omission; a generator would restore the omitted fields and delete the guarantee while
  everything still compiled. See research R-11.
- **Do not fix the API from here.** Row 5 (`api-wrong`) is escalated, not worked around.
- **Do not build pages that do not exist.** My Orders is a placeholder; it stays one.
- No automated tests, no redesigns, no new features.

**Scale/Scope**: 21 contract paths / 27 routes · 4 enumerations · 11 frontend API modules ·
~50 components · 11 reconciliation findings · one test-plan document of roughly 70 steps

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

`.specify/memory/constitution.md` is **an unfilled template** — every principle, section, and
governance rule is still a `[PLACEHOLDER]`. There are no ratified project principles to gate
against, so no gate can pass or fail on their authority.

Rather than treat that as a free pass, the standing constraints this component actually
operates under are drawn from `ui/docs/CONTEXT.md` and checked explicitly:

| Standing constraint (source) | This feature | Status |
| --- | --- | --- |
| The frontend never holds a private key beyond signing the auth nonce (CONTEXT §2) | R-01's fix changes *what string* is signed, not how many signatures or what they authorise. Still one `signMessage` call in the codebase. | PASS |
| The frontend never calls the escrow contract (CONTEXT §2) | No chain write added. R-05 declines to adopt the contract's `explorerUrl` in favour of the existing client-side link builder — no new chain access either way. | PASS |
| The frontend has no code path that renders a seller's `systemPrompt` (CONTEXT §2) | Reinforced. R-08/R-09/R-11 keep `model`, `systemPrompt`, and version detail out of frontend types; the `api-wrong` row R-04 is escalated rather than fixed *because* fixing it weakens this boundary. | PASS |
| Polling, never SSE or websockets (CONTEXT §4) | R-02 changes which errors stop a poll. It does not change the transport or the intervals. | PASS |
| No automated tests in this component (CONTEXT §"Automated tests") | This feature's deliverable is the manual procedure that stands in for them. | PASS |
| Six things must be visible (CONTEXT §3) | R-02 protects #3 (the verdict card), R-04 concerns #1-adjacent evidence, R-06 concerns #5 (two money numbers). None is weakened. | PASS |

**Post-Phase-1 re-check**: unchanged. Phase 1 produced two Markdown documents and a boundary
inventory; it introduced no code structure, no dependency, and no new surface. PASS.

**Recommendation, not a gate**: `/speckit-constitution` has never been run for this component.
That is fine for an MVP, but it means "Constitution Check" will remain a manual restatement of
CONTEXT.md on every feature until it is.

## Project Structure

### Documentation (this feature)

```text
specs/008-contract-reconciliation-test-plan/
├── plan.md              # This file
├── spec.md              # Feature specification
├── research.md          # Phase 0 — the 11 reconciliation findings, each with a resolution
├── data-model.md        # Phase 1 — reconciliation row, test step, carryover
├── quickstart.md        # Phase 1 — how to validate this feature's own output
├── checklists/
│   └── requirements.md  # Spec quality checklist (passed)
├── contracts/
│   ├── boundary-inventory.md    # Every endpoint the UI calls ↔ every path the contract defines
│   ├── reconciliation-note.md   # Required shape of the delivered reconciliation record
│   └── test-plan-outline.md     # Required shape of docs/manual-test-plan.md
└── tasks.md             # Phase 2 output (/speckit-tasks — NOT created here)
```

### Source Code (repository root)

Paths are relative to `ui/`. Only files with a finding are listed; the reconciliation touches
nothing else.

```text
ui/
├── docs/
│   ├── manual-test-plan.md        # NEW — deliverable 2
│   └── reconciliation-note.md     # NEW — deliverable 1's record
├── src/
│   ├── api/
│   │   ├── auth.ts                # R-01 — NonceResponse gains `message`
│   │   ├── types.ts               # R-01, R-03, R-05 — the type edits
│   │   ├── agents.ts              # R-03 — `listed` through the owned-agent normaliser
│   │   ├── client.ts              # R-02 (read only — already reads `error` as `code`)
│   │   └── verdicts.ts            # R-02 — no change expected; the fix is in the hook
│   ├── auth/
│   │   └── useSignIn.ts           # R-01 — sign `message`, not `nonce`  ← BLOCKER
│   ├── hooks/
│   │   └── useVerdict.ts          # R-02 — branch on the error code  ← BLOCKER
│   └── components/
│       ├── OwnedAgentList.tsx     # R-03 — render the unregistered marker
│       ├── ExecutionSteps.tsx     # R-04 — empty-trace copy for the buyer
│       └── CaseFilePanel.tsx      # R-04 — same
└── specs/008-contract-reconciliation-test-plan/   # this feature's artifacts
```

**Structure Decision**: No new structure. This is a corrective pass over the existing `ui/`
tree plus two new documents under `ui/docs/`. The reconciliation note lives beside the test
plan rather than inside `specs/` because it is a standing record about the product, not an
artifact of this feature's planning — a reader asking "why does the frontend do this instead
of what the contract says" should find it next to the other product documentation. Nine of the
eleven findings touch one file each; the two blockers touch one function each.

## Phase 0 — Research

Complete. See [research.md](./research.md).

The research was a full walk of the boundary in both directions, not a spot check — the spec
assumed at least one further disagreement existed beyond the two known, and the walk found
nine, including one that stops sign-in.

Summary of findings by disposition:

| Finding | Boundary | Disposition |
| --- | --- | --- |
| R-01 | `POST /auth/nonce` → signature | **Fix the frontend — blocker.** Sign `message`. |
| R-02 | `GET /orders/{id}/verdict` errors | **Fix the frontend — blocker.** Branch on `error`, not status. |
| R-03 | `OwnedAgentResponse.listed` | **Fix the frontend.** Declare it, render it. |
| R-04 | Buyer case-file `steps` always `[]` | **`api-wrong` — escalate.** Record what the frontend does meanwhile. |
| R-05 | `WithdrawResponse` — `txHash` non-null, `explorerUrl`, `amountMinor` | Keep the frontend's nullable `txHash`; ignore the two extra fields, with a reason. |
| R-06 | `AccountSummaryResponse.accountId` | Ignore — nothing renders it. |
| R-07 | `GET /orders` (`BuyerOrderSummary`) | **Orphan endpoint** — My Orders is a placeholder. Named, not built. |
| R-08 | `VerdictResponse.model` | Ignore — deliberate, documented on the type. |
| R-09 | `AgentListingResponse.version` | Ignore — nothing renders it. |
| R-10 | `/onramp/routes`, `/agents/{id}/versions` ×2 | **Orphan endpoints** beyond the one the spec permits. Named. |
| R-11 | Four enumerations, casing, money, auth, seller-authorised reads | **Agree.** No change. Recorded so the next pass need not re-derive it. |

Two of the source brief's own predictions resolved differently than it expected, and both are
recorded in research.md rather than silently dropped:

- **The `quote`/`clause` bug is already fixed.** The divergence report confirms `quote` is the
  correct name and that the frontend's error was corrected after commit `67dcf4d`, which the
  brief was written against. It survives in the test plan as a named failure symptom.
- **T033 resolves as "keep the subtraction."** The contract's `VerdictResponse` carries no
  `sellerMinor`, so `splitFor`'s derivation and its reconciliation guard stay. The carryover is
  discharged with an answer, not deferred again.

## Phase 1 — Design & Contracts

Complete. Three artifacts, none of which is code.

**[data-model.md](./data-model.md)** — the three entities this feature actually creates:
a **reconciliation row** (what differed, how the divergence report classifies it, how it was
resolved), a **test step** (action, one expected result, pass/fail, failure symptom), and a
**carryover** (a deferred criterion and the step that discharges it). Includes the frontend
type changes R-01/R-03/R-05 imply, stated as field-level deltas.

**[contracts/](./contracts/)** — this feature's external interfaces are documents, not
endpoints, so the contracts directory specifies their required shape:

- `boundary-inventory.md` — the authoritative both-directions map: 21 contract paths against
  17 frontend call sites, each marked reached / orphan / undeclared-field. This is the artifact
  that makes FR-019 and FR-020 checkable rather than asserted.
- `reconciliation-note.md` — the column set and the completeness rule (every `api-wrong` row
  appears with a resolution, even "escalated, unchanged").
- `test-plan-outline.md` — §0–§7, the required steps in each, and the four rules that make a
  step executable at 3am.

**[quickstart.md](./quickstart.md)** — how to validate *this feature's* output: how to confirm
the two blocker fixes actually work against a running API, and how to check the test plan
against its own rules before handing it to a tester.

### Design decisions worth flagging

- **The two blockers are fixed before the plan is written**, not alongside it. A test plan
  written against a build where sign-in 401s cannot have been sanity-checked at all, and an
  unchecked plan is exactly the 3am-ambiguity failure the spec warns about.
- **R-04 stays broken on purpose.** The `api-wrong` row weakens a seller-IP layer to fix, days
  before a demo, and the divergence report explicitly declines to decide it. The frontend's
  response is copy — a buyer's trace panel says the trace is unavailable rather than rendering
  an empty list that reads as "nothing ran." That is a rendering change, not an absorption of
  the defect, and the note records it as such.
- **My Orders stays a placeholder.** Building it is out of scope (FR-043) and it is genuinely
  not on the demo path — all three acts run on Order Detail. But the nav links to it, so the
  test plan gets an explicit step establishing that a placeholder is the *expected* result,
  which stops a tester reporting it as a failure and stops it being mistaken for finished.

## Complexity Tracking

No constitution violations to justify — see Constitution Check. No entry required.

## Risks

| Risk | Why it matters | Mitigation |
| --- | --- | --- |
| The 11 findings are **desk-verified, not live-verified** — read from the contract and the source, with the API not running during this pass | The contract is transcribed from captured responses and is trustworthy, but R-01 in particular is a claim about runtime behaviour | quickstart.md opens with a live confirmation of R-01 and R-02 against a running API, before any other work. If R-01 does not reproduce, the finding is withdrawn and recorded as withdrawn. |
| Fixing R-01 changes the one signature the app requests | A regression here locks every user out of everything | The change is one argument to one call. The quickstart's first check is a full sign-in, and §1 of the test plan re-checks it including reload persistence. |
| R-02's fix widens what keeps polling | A poll that never stops is the failure mode `usePolling` was built to prevent | Branch on the `error` code, not on the status: `VERDICT_NOT_FOUND` keeps polling, `ORDER_NOT_FOUND` and `AUDIT_FAILED` stop. Strictly more precise than today's rule, not looser. |
| The test plan is written by someone who has read the source | The one reader it is written for has not | The stranger test in §6 is also a test of the document. Anything a stranger cannot execute is a defect in the plan, not in them. |
| Three responses in the contract were documented from source rather than captured (`WithdrawResponse` 200, the 502s, `settledFundsMinor: null`) | R-05 and the degradation section rest partly on them | Both are treated as lower-confidence in the note, and the test plan's degradation section states the expected result without asserting the wire shape. |
