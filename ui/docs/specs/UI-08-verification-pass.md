# UI-08 — Verification pass & contract reconciliation

**Component:** `ui/` · **Depends on:** UI-01…07, **API-12** (`docs/openapi.yaml` +
`docs/openapi-divergences.md`), and **a live API that can complete a purchase** ·
**Size:** Medium

> ⚠️ **This is the only spec that runs the product.** Everything before it was
> written, typechecked, and built — none of it has been rendered in a browser or
> pointed at a real response.

> **Feed this file to `/speckit-specify`.** Read [`../CONTEXT.md`](../CONTEXT.md)
> first.

## Goal

Turn seven code-complete specs into a demo that has actually been seen to work, and
fix what the first real data reveals.

## Why this spec exists

UI-01 through UI-07 were built against **types describing an API that did not yet
exist**. That is a legitimate way to build in parallel, and it has one failure mode
that this spec is here to catch.

The failure mode is already documented, because it happened. UI-05's citation
normaliser read `raw.clause`; the API sends `quote`. The shapes agreed, the field
name did not, and **nothing caught it** — `RawCitation`'s fields are optional
`unknown` (correctly, because `verdicts.citations` is unvalidated `jsonb`), so a
wrong name is an absent value rather than a type error. `tsc` passed. The build
passed. There are no tests. The checklist would have rendered as empty rows in Act 2,
on stage, and the first time anyone would have known is the first real audit.

That was found by reading two documents side by side. **There are more boundaries
than anyone has read**: the order payload, the case file, the balance figures, the
ledger rows, the agent listing. Assume at least one more disagreement exists.

## In scope

### 1. Reconcile every boundary against the contract

**Read `docs/openapi-divergences.md` before `docs/openapi.yaml`.** The order matters.

API-12 writes the contract **from the running implementation**, so `openapi.yaml`
describes what the API genuinely does — which makes it the right thing for this
frontend to match, and the wrong thing to trust blindly. A field the API named
incorrectly is in there too, described faithfully. The divergence report is where
API-12 diffed the code against `api-design.md` and recorded which is which.

| The row says | Then |
| --- | --- |
| *(not in the report)* | **The contract is correct. The UI matches it** — fix the UI. |
| `api-wrong` | **Do not match it.** The API is the defect; the design is right. Escalate, and if it cannot be fixed in time, record what the UI does about it. |
| `design-stale` | The contract is correct and `api-design.md` has been updated to agree. Match it. |
| `intentional` | Match it, and read the recorded reason — it usually implies something for the UI. |

> **Why this is not paranoia.** `67dcf4d` was a field the UI called `clause` and the
> API sends `quote`. A contract generated from the API at that moment would have
> documented `quote` and this pass would have renamed the UI to match — correct by
> luck, since the API happened to be right. Had the mistake been the API's, the same
> mechanism would have propagated it into the frontend and closed the ticket. The
> divergence report is the only thing that tells those two cases apart.

Check all of it, per endpoint and per type:

- **Field names.** The bug class above. Compare strings, not shapes.
- **Enum members, exhaustively** — `OrderState` (8), `LedgerKind` (4),
  `CitationSource` (3), tier values. A value the API can emit and the UI cannot
  render is a page with no face; the UI's exhaustive switches turn it into a **thrown
  error**, not a graceful degrade.
- **Nullability**, in both directions — a field the UI treats as always-present that
  arrives `null`, and one it defends against that never is.
- **Money**: every figure in minor units, `Minor` suffix, two-numbers rule intact,
  and `settledFundsMinor` nullable.
- **Casing** — `snake_case` vs `camelCase`, decided once, applied everywhere.
- **Status codes and error shapes**, including which failures are retryable. UI-04
  and UI-05 both treat 404/403 as fatal and everything else as transient; confirm the
  API agrees about which is which.
- **Auth per endpoint.** API-04's guard is **global and fail-closed**, so an endpoint
  the UI believes is public and the API guards returns 401 on a page with no sign-in
  prompt. Check `@Public()` coverage against every unauthenticated call the UI makes.
- **Seller-authorised reads.** `GET /orders/:id`, `/case-file`, and `/verdict` are
  buyer *or* agent owner (api-design §3.4). Verify as a **seller account**, not only
  as a buyer — the narrow check passes every buyer-side test and kills half of UI-07.

**Deliverable: a written reconciliation note** — one row per disagreement: what
differed, whether the divergence report says the API is at fault, and how it was
resolved. **Every `api-wrong` row from API-12 must appear here** with what the UI
did about it, even if the answer is "nothing, escalated". If a category was checked
and found clean, say so explicitly — an empty list somebody produced is evidence, an
empty list nobody produced is not.

### 1b. Find the decoupled surface, not just the mismatched fields

Field-level agreement is not integration. Enumerate both directions:

- **Endpoints the UI calls that the contract does not define.** Each is a 404 waiting
  for the page that calls it.
- **Endpoints the contract defines that no page reaches.** `api-design.md` §4 already
  states the intended answer — everything is reachable except `/offramp/routes`. Any
  *other* orphan is either a missing UI affordance or dead backend work; name which.
- **Query parameters and their semantics**, not just their names — `GET
  /agents?owner=me` must include **inactive** agents, or UI-07's availability toggle
  is one-way (api-design §3.3).
- **Polling cadences against what the endpoint can bear**: Order Detail 1s, Wallet /
  My Orders / `/sell` 5s. `GET /me` now does a chain read; confirm 5s is survivable.
- **Flows that span both sides**: purchase → execution → delivery → complaint →
  verdict → settlement. Walk each transition and confirm the state the API writes is
  a state the UI renders.

> **Do not generate types from `openapi.yaml` to "fix" this.** Several UI types
> encode guarantees **by omission** — `AgentListing` has no `systemPrompt`, `CaseFile`
> has no `prompt` or `raw`, `PurchaseRequest` has no `price` or `reviewWindowSeconds`.
> Those absences *are* invariants #3 and FR-021, enforced by shape rather than
> discipline. A generator faithfully reproducing an API that sends one more field
> would silently delete the guarantee while every test still passed. Reconcile by
> hand; keep the omissions and the docblocks that explain them.

### 2. Render every page against real data

All eight pages, in a browser, against a seeded database. Not screenshots of
components — the actual routes, reached by clicking.

### 3. Run the three acts, twice

Act 1 (0%), Act 2 (50%), Act 3 (100% — non-delivery), per `product-workflow.md` §5.3.
**Twice**, with the same verdicts both times. This is the closest thing this
component has to a test suite, and `../CONTEXT.md` says to treat a failed rehearsal
the way you would treat a red build.

Specifically observed, not inferred:

- The countdown reaches zero and the page **flips on its own**, with nobody touching
  the keyboard (UI-04's central claim, never once seen)
- A complaint moves the page to `disputed` and then to a verdict without a refresh
- The transaction hash links to MonadVision and **the page it lands on exists**
- Balance figures move when an order settles

### 4. Explicit carryovers from UI-05 and UI-07

Named because they were deferred with a reason, not forgotten.

**From UI-07** (all three BLOCKED on a running API — no seller screen has ever
rendered, since every route sits behind `RequireAuth`):

- **T039 — greyscale on the seller screens**, same test as the verdict card below
- **T040 — quickstart Part G**, the seller flow end to end: list an agent, see it in
  the marketplace, toggle it inactive, see it leave — **and toggle it back**, which
  is the check that catches an `?owner=me` filtered to active
- **T029's live regression tier.** The static tier ran and found only copy strings
  and signature lines. The live tier is the one that matters: **open a settled order
  as the buyer** and confirm `perspective` changed nothing about the verdict card the
  demo's closing beat depends on
- Confirm the seller can open a disputed sale's **case file and verdict** — the
  buyer-or-owner authorisation, exercised from the seller's side

**From UI-05:**

- **Quickstart Parts B–F** — the verdict card's own verification script
- **Legibility at distance.** Read the verdict card from ~3m, the distance of a
  judge's seat. The tier, the refund figure, and the ✓/✗ marks must be legible.
- **The greyscale check.** Screenshot the card, desaturate it, confirm ✓ and ✗ are
  still distinguishable. Colour alone carrying a refund decision fails on a
  projector, and projectors are what demos run on.
- **Long-clause layout** — a citation quoting a 300-character acceptance criterion
  must not break the checklist.
- **The stranger test** — someone who has not seen the code reads a settled order and
  says what happened and why. If they cannot, the card has failed at its only job.
- **T033 — reconcile the split figures.** If the API sends `sellerMinor` directly,
  **delete the subtraction and its reconciliation guard in `splitFor`.** Deriving a
  figure the API already computed is a second source of truth for money.

### 5. The redaction boundary, checked against real output

`system_prompt` must not reach a buyer, and the boundary is wider than one column —
execution steps can paraphrase a prompt. With a real seller agent having really run:
open the case file as the **buyer**, and confirm no prompt text, no model name, and
no raw reasoning appears. Check the **network response**, not just the rendering — a
field the UI declines to display is still a field that was sent.

## Out of scope

**Automated tests of any kind** (MVP decision — see `../CONTEXT.md`). Plus:

New features, redesigns, and any page not already built. **If something is ugly but
correct, leave it.** This spec fixes what is *wrong*, not what is unpolished — with
one exception: anything that fails the legibility or greyscale checks above is wrong,
because it fails at the distance the demo is watched from.

## Acceptance

- All three acts run end to end, **twice**, producing the same verdicts
- The reconciliation note exists, covers **all three comparisons**, and every
  disagreement in it is resolved or escalated with an owner
- **No endpoint the UI calls is absent from `docs/openapi.yaml`**, and every endpoint
  it defines is either reached by a page or named as a deliberate orphan
- Every enum the UI switches on has the **same members** as the contract
- No console errors on any of the eight pages
- No page polls after reaching a terminal state (watch the network tab — a laptop
  hammering an endpoint for a finished order is a needless way to look bad)
- A buyer's case file contains no prompt text **in the response body**
- The verdict card passes the greyscale and 3m-legibility checks

## Watch out for

- **Field names are the bug class.** Shapes agreeing is not contracts agreeing. Read
  the actual JSON, and compare it to the contract rather than to memory.
- **A faithful contract is not a correct one.** `openapi.yaml` documents what the API
  does, bugs included. Matching it is usually right and occasionally the wrong move —
  `docs/openapi-divergences.md` is what tells you which, and it is the first file to
  read, not the last.
- **Do not "fix" the API from here**, but do not absorb its defects either. An
  `api-wrong` row is escalated, not worked around in the client. `67dcf4d` moved the
  UI *and* corrected a stale root doc; both were needed.
- **Absences are load-bearing.** See the generator warning above. Anything that adds
  a field to a UI type needs a reason beyond "the API sends it."
- **A green rehearsal on a fast local machine hides timing bugs.** The countdown, the
  1s poll, and the sweeper interact. Run at least one rehearsal without a warm cache.
- **Resist rebuilding.** At this point in the schedule the temptation on seeing a
  rendered page for the first time is to redesign it. The demo needs it to work.

## Source

`../../../docs/ui-design.md` · `../../../docs/product-workflow.md` §5.3, §5.5 ·
`../CONTEXT.md` §3 (the six things that must be visible) · commit `67dcf4d` (the
boundary bug this spec generalises).
