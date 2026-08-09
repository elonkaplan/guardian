# UI-08 — Contract reconciliation & the manual test plan

**Component:** `ui/` · **Depends on:** UI-01…07, **API-12** (`docs/openapi.yaml` +
`docs/openapi-divergences.md`), and **a running API** · **Size:** Medium

> ⚠️ **This spec does not run the product. It makes the frontend match the API, and
> writes down how a human checks the result.** Every acceptance criterion in UI-01
> through UI-07 was deferred to a manual pass — this is where that pass gets
> *specified*, not performed.

> **Feed this file to `/speckit-specify`.** Read [`../CONTEXT.md`](../CONTEXT.md)
> first.

## Goal

Two deliverables:

1. A frontend corrected against what the API actually does.
2. **`docs/manual-test-plan.md`** — a script someone can execute start to finish
   without reading any source code, and know unambiguously whether it passed.

## Why this spec exists

UI-01 through UI-07 were built against **types describing an API that did not yet
exist**. That is a legitimate way to build in parallel, and it has one failure mode.

The failure mode is documented because it happened. UI-05's citation normaliser read
`raw.clause`; the API sends `quote`. The shapes agreed, the field name did not, and
**nothing caught it** — `RawCitation`'s fields are optional `unknown` (correctly,
because `verdicts.citations` is unvalidated `jsonb`), so a wrong name is an absent
value rather than a type error. `tsc` passed. The build passed. There are no tests.
The checklist would have rendered as empty rows in Act 2, on stage.

**There are more boundaries than anyone has read.** Assume at least one more
disagreement exists.

---

## In scope — part 1: reconciliation (code)

### 1.1 Reconcile every boundary against the contract

**Read `docs/openapi-divergences.md` before `docs/openapi.yaml`.** The order matters.

API-12 writes the contract **from the running implementation**, so `openapi.yaml`
describes what the API genuinely does — which makes it the right thing to match, and
the wrong thing to trust blindly. A field the API named incorrectly is in there too,
described faithfully. The divergence report is where API-12 diffed the code against
`api-design.md` and recorded which is which.

| The row says | Then |
| --- | --- |
| *(not in the report)* | **The contract is correct. Fix the UI to match it.** |
| `api-wrong` | **Do not match it.** The API is the defect. Escalate; if it cannot be fixed in time, record what the UI does instead. |
| `design-stale` | The contract is correct and `api-design.md` now agrees. Match it. |
| `intentional` | Match it, and read the reason — it usually implies something for the UI. |

Check, per endpoint and per type:

- **Field names.** Compare strings, not shapes. This is the bug class above.
- **Enum members, exhaustively** — `OrderState` (8), `LedgerKind` (4),
  `CitationSource` (3), tiers. The UI's switches have no `default`, so a member the
  API can emit and the UI cannot render **throws**.
- **Nullability**, both directions.
- **Money**: minor units, `Minor` suffix, `settledFundsMinor` nullable.
- **Casing**, decided once and applied everywhere.
- **Status codes and error shapes.** UI-04 and UI-05 treat 404/403 as fatal and
  everything else as retryable — confirm the API agrees which is which. A 500 on a
  missing order means the frontend retries forever.
- **Auth per endpoint.** API-04's guard is global and fail-closed: an endpoint the UI
  thinks is public and the API guards returns 401 on a page with no sign-in prompt.
- **Seller-authorised reads** — `GET /orders/:id`, `/case-file`, `/verdict` are buyer
  *or* agent owner.

### 1.2 Find the decoupled surface

Field agreement is not integration. Enumerate both directions:

- Endpoints the UI calls that the contract does not define — each a 404 in waiting.
- Endpoints the contract defines that no page reaches. Everything should be reachable
  except `/offramp/routes` (api-design §4); name any other orphan.
- Query semantics, not just names — `?owner=me` must include **inactive** agents.
- Every state transition the API writes, confirmed to be one the UI renders.

> **Do not generate types from `openapi.yaml`.** Several UI types encode guarantees
> **by omission** — `AgentListing` has no `systemPrompt`, `CaseFile` has no `prompt`
> or `raw`, `PurchaseRequest` has no `price` or `reviewWindowSeconds`. Those absences
> *are* invariant #3 and FR-021, enforced by shape rather than discipline. A generator
> faithfully reproducing an API that sends one extra field would delete the guarantee
> while everything still compiled.

**Deliverable: a reconciliation note.** One row per disagreement: what differed,
whether the divergence report blames the API, how it was resolved. Every `api-wrong`
row must appear with what the UI did about it, even if that is "nothing, escalated."

---

## In scope — part 2: `docs/manual-test-plan.md`

**The tester is a human with a browser, and has not read the source.** Write for
that reader.

### The one rule

> **Every step states exactly one expected result, specific enough that pass or fail
> is not a judgement call.**

*"Check the wallet page looks right"* is worthless. *"The Settled figure reads `—`
with the note 'unknown, not zero'; it does not read `$0.00`"* is a test.

### Required structure

**§0 Preconditions** — everything true before step 1: services up and on which ports
(Postgres is on `5433`; a native Postgres holds 5432), which wallets need MON and test
USDC, `POST /demo/seed` run, browser wallet connected to Monad Testnet (chain 10143).
Anything the tester must fix before starting belongs here, not discovered at step 40.

**§1 Smoke** — the cheap checks that make every later failure interpretable. App
loads, `/health` answers, `/docs` renders, sign-in produces a session that survives a
reload.

**§2 The three acts**, each start to finish, per `product-workflow.md` §5.3. For each:
the exact input, the acceptance criteria to type, the expected tier, the expected
split in dollars, and what appears on screen at every state change. Explicitly:

- The countdown reaches zero and **the page flips with nobody touching the keyboard**
- A complaint moves the page to `disputed` and on to a verdict **without a refresh**
- The transaction hash links out and **the page it lands on exists**
- Balance figures move when an order settles

**§3 Seller flow** — list an agent, see it in the marketplace, toggle it inactive,
watch it leave, **toggle it back**. That last step is the one that catches an
`?owner=me` filtered to active, which looks like a working feature until someone
tries to undo it. Then: open a disputed sale as the seller and confirm the case file
and verdict are readable, and that there is no reply control.

**§4 Money** — top-up, cash-out, withdraw, and the ledger explaining all three. The
three figures never collapse into one.

**§5 Degradation** — what the tester should see when things fail: a settled figure of
`—` rather than `$0.00`, a labelled loading line rather than a blank card, a page that
does not move backwards.

**§6 Human-judgement checks** — the ones no script can make:

- **Greyscale.** Screenshot the verdict card and the seller screens, desaturate, and
  confirm ✓ and ✗ remain distinguishable. Colour alone carrying a refund decision
  fails on a projector, and projectors are what demos run on.
- **Legibility at ~3m**, a judge's distance: tier, refund figure, ✓/✗ marks.
- **The stranger test.** Someone who has not seen the code reads a settled order and
  says what happened and why. If they cannot, the card has failed at its only job.
- **Long clauses** — a citation quoting a 300-character criterion must not break the
  checklist.

**§7 Redaction** — open a buyer's case file and check the **network response**, not
the rendering. A field the UI declines to display is still a field that was sent.

### Also required in the document

- A **pass/fail column** per step. It is a checklist to run, not prose to read.
- **What a failure looks like**, wherever it is subtle. *"If the citation checklist
  renders rows with empty quotation marks, the field name is wrong — that is the
  `quote`/`clause` bug, not a styling problem."* Naming the symptom is what makes a
  tester able to report something useful.
- **A rough duration**, so a full pass can be scheduled rather than started at 3am.
- **Reset instructions** — `POST /demo/reset` between runs, and what it does and does
  not clear.

---

## Out of scope

**Running the tests.** This spec writes the plan; a human executes it. Do not report
a step as passing.

**Automated tests of any kind** (MVP decision — see `../CONTEXT.md`). Plus: new
features, redesigns, and any page not already built. **If something is ugly but
correct, leave it** — with one exception: anything that fails greyscale or the 3m
legibility check is *wrong*, not unpolished, because it fails at the distance the demo
is actually watched from.

## Acceptance

- Every `api-wrong` row from the divergence report appears in the reconciliation note
  with a resolution
- No endpoint the UI calls is absent from `docs/openapi.yaml`
- Every enum the UI switches on has the same members as the contract
- `docs/manual-test-plan.md` exists and **covers all three acts, the seller flow, the
  money flows, degradation, the four human-judgement checks, and redaction**
- **No step in it says "verify it looks correct"** — every step has one concrete
  expected result
- The plan names the carryovers below explicitly, so nothing deferred is lost

## The carryovers this plan must include

Deferred with reasons, not forgotten.

**From UI-07** — no seller screen has ever rendered, since every route sits behind
`RequireAuth`:

- T039 greyscale on the seller screens · T040 the seller flow end to end
- **T029's live regression tier**: open a settled order **as the buyer** and confirm
  the `perspective` prop changed nothing about the verdict card. The static tier only
  proved the diff was small.
- The seller reading a disputed sale's case file and verdict — buyer-or-owner
  authorisation, exercised from the seller's side

**From UI-05:** quickstart Parts B–F · greyscale · 3m legibility · long clauses · the
stranger test · **T033** — if the API sends `sellerMinor`, delete `splitFor`'s
subtraction and its reconciliation guard rather than deriving a figure the API already
computed.

## Watch out for

- **Field names are the bug class.** Shapes agreeing is not contracts agreeing.
- **A faithful contract is not a correct one.** `openapi.yaml` documents the API's
  bugs as carefully as its correct parts; the divergence report is what tells them
  apart, and it is the first file to read.
- **Do not "fix" the API from here** — but do not absorb its defects either. An
  `api-wrong` row is escalated, not worked around in the client.
- **Absences are load-bearing.** Adding a field to a UI type needs a reason beyond
  "the API sends it."
- **Write the plan for someone who will run it tired.** Ambiguity gets resolved
  optimistically at 3am, and an optimistically-resolved step is a step that did not
  run.

## Source

`docs/openapi.yaml` and `docs/openapi-divergences.md` (API-12) ·
`../../../docs/ui-design.md` · `../../../docs/product-workflow.md` §5.3, §5.5 ·
`../CONTEXT.md` §3 · commit `67dcf4d`.
