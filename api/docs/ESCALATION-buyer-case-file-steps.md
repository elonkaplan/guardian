# Escalation — a buyer's case-file `steps` is always empty

**Raised:** 2026-08-09 · **By:** UI-08 (frontend contract reconciliation) ·
**Against:** `api/` · **Status:** open — **awaiting a decision from whoever owns the seller-IP
boundary**

**References:** [`openapi-divergences.md`](./openapi-divergences.md) row 5 (`api-wrong`,
`DO NOT ADOPT`) · [`openapi.yaml`](./openapi.yaml) `BuyerCaseFileResponse` ·
[`../../ui/docs/reconciliation-note.md`](../../ui/docs/reconciliation-note.md) R-04

---

## Why this file exists

The divergence report found exactly one `api-wrong` row and deliberately did not decide it,
because the decision belongs to whoever owns the seller-IP boundary rather than to a
contract-writing pass. The frontend reconciliation has now reached the same row from the other
side and reached the same conclusion: **it is not the frontend's to work around.**

This file is the escalation. It records the defect, what the frontend did instead, and what a
decision would need to weigh. It does not decide it either.

## The defect

`GET /orders/{id}/case-file` returns `steps: []` to a buyer **unconditionally**.
`CaseFileService.getForBuyer` returns an empty array; `findCaseFileForBuyer` does not select
`runs.steps`, so the trace never enters the process on a buyer's read.

`api-design.md` §1.3 and `ui-design.md` §7.1 both state that a buyer sees a summarised execution
trace. The summarisation machinery — `toBuyerCaseFileSteps` — is written and in use on the
seller path, and is structurally incapable of emitting `reasoning`.

**Confirmed live on 2026-08-09**: a buyer's case file for an order returns `steps: []` while the
seller's case file for the *same order* returns the populated trace.

## Why the original justification expired

The behaviour carries a long written justification in `case-file.service.ts` — it is layer 1 of
a three-layer defence around seller IP. But the justification rests on a premise that no longer
holds:

> *"Today it would change nothing anyway: API-08 does not exist, no `runs` row is ever written,
> and every case file in the product reports an empty trace — which is an accurate statement
> that nothing has run, not a placeholder."*

API-08 shipped. `runs` rows are written. The empty array is no longer an accurate statement that
nothing ran — it is a silent omission of evidence the design says the buyer is owed.

## What the frontend did instead

**Copy only, and deliberately nothing else.**

`ExecutionSteps` previously rendered *"No execution steps were recorded for this order"* on an
empty list. On a buyer's copy that is a false statement about their order, and the worst kind:
it reads as evidence the agent did nothing, on the screen where a buyer is deciding whether they
were treated fairly. It now says the trace is not included in a buyer's copy and that this is
not a statement about what the agent did.

**What the frontend did not do**, and this is the substance of the escalation:

- It does **not** call the seller's case-file endpoint as a buyer. That would break invariant #3
  from the client side, which is worse than the defect.
- It does **not** synthesise or infer steps.
- It does **not** hide the section as though the design never called for it. Hiding it would
  make the defect invisible, and an invisible defect stops being fixed.

When the API starts populating a buyer's trace, the new branch simply stops being reached. **No
workaround exists here to outlive the bug** — which is the property this escalation is protecting.

## What a decision has to weigh

**For fixing it.** The machinery already exists. Adding `r.steps` to the buyer's query and
mapping through `toBuyerCaseFileSteps` is a few lines. The design says buyers are owed the
trace, and the trace is a large part of what makes a partial refund legible — a tier alone is an
assertion, a step list is a fact.

**Against fixing it now.** It deliberately weakens one layer of three protecting invariant #3
(*`system_prompt` never reaches a buyer*), and the code says so explicitly:

> *"Making the change is a deliberate weakening of one layer of three, and it belongs in a diff
> that says so, not in this one."*

The remaining two layers are the serialiser's summarisation and the frontend's `CaseFileStep`
type, which has no field a prompt could land in. Whether two layers is enough is the actual
question, and it is a judgement about seller IP days before a demo.

## What the frontend needs, either way

Nothing urgent. The copy above is correct under both outcomes.

**If it is fixed**, no frontend change is required — `CaseFileStep` already carries `label`,
`summary`, `durationMs`, and `error`, and `ExecutionSteps` already renders them on the seller
path. The buyer's empty-state branch simply stops being reached.

**If it is not fixed before the demo**, the current state is safe: the buyer's screen states the
absence honestly rather than mislabelling it, and `ui/docs/manual-test-plan.md` §7.7–7.8 tells a
tester that the empty array is expected and that the copy is what can fail.
