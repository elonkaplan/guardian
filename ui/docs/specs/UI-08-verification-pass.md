# UI-08 — Verification pass & contract reconciliation

**Component:** `ui/` · **Depends on:** UI-01…07 **and a live API that can complete a
purchase** · **Size:** Medium

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

### 1. Reconcile every boundary against real responses

For **each** type in `src/api/types.ts`, compare against what the API actually
returns — not against the spec, against the wire.

- Field **names**, not just shapes. This is the class of bug above.
- Nullability: a field the UI treats as always-present that arrives `null`
- Money: every figure in **minor units**, and the two-numbers rule intact
- Casing: `snake_case` vs `camelCase` at the boundary, decided once
- Any field the UI reads that the API does not send, and vice versa

**Deliverable: a short reconciliation note** listing every disagreement found and how
it was resolved. If the list is empty, say so explicitly — an empty list that was
looked for is worth something; an empty list nobody produced is worth nothing.

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

### 4. UI-05's explicit carryovers

Named because they were deferred with a reason, not forgotten:

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
- The reconciliation note exists and every disagreement in it is resolved
- No console errors on any of the eight pages
- No page polls after reaching a terminal state (watch the network tab — a laptop
  hammering an endpoint for a finished order is a needless way to look bad)
- A buyer's case file contains no prompt text **in the response body**
- The verdict card passes the greyscale and 3m-legibility checks

## Watch out for

- **Field names are the bug class.** Shapes agreeing is not contracts agreeing. Read
  the actual JSON.
- **Do not "fix" the API from here.** A disagreement found at this boundary may be
  the API's to change, not the UI's — the specs and `docs/tech-stack.md` §5 decide
  which side is wrong. `67dcf4d` moved the UI *and* corrected a stale root doc; both
  were needed.
- **A green rehearsal on a fast local machine hides timing bugs.** The countdown, the
  1s poll, and the sweeper interact. Run at least one rehearsal without a warm cache.
- **Resist rebuilding.** At this point in the schedule the temptation on seeing a
  rendered page for the first time is to redesign it. The demo needs it to work.

## Source

`../../../docs/ui-design.md` · `../../../docs/product-workflow.md` §5.3, §5.5 ·
`../CONTEXT.md` §3 (the six things that must be visible) · commit `67dcf4d` (the
boundary bug this spec generalises).
