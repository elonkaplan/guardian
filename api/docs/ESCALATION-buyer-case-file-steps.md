# Escalation — a buyer's case-file `steps` is always empty

**Raised:** 2026-08-09 · **By:** UI-08 (frontend contract reconciliation) ·
**Against:** `api/` · **Status:** ✅ **resolved 2026-08-09 — fixed in the API**

**Decision:** fix it. The buyer's case file now carries the redacted trace.

**References:** [`openapi-divergences.md`](./openapi-divergences.md) row 5 (now `FIXED`) ·
[`openapi.yaml`](./openapi.yaml) `BuyerCaseFileResponse` ·
[`../../ui/docs/reconciliation-note.md`](../../ui/docs/reconciliation-note.md) R-04

---

## Why this file exists

The divergence report found exactly one `api-wrong` row and deliberately did not decide it,
because the decision belongs to whoever owns the seller-IP boundary rather than to a
contract-writing pass. The frontend reconciliation reached the same row from the other side
and reached the same conclusion: **it is not the frontend's to work around.**

This file was the escalation. It is kept because the decision it asked for was made, and the
record of what was weighed is worth more than the fact of the outcome.

## The defect

`GET /orders/{id}/case-file` returned `steps: []` to a buyer **unconditionally**.
`CaseFileService.getForBuyer` returned an empty array; `findCaseFileForBuyer` did not select
`runs.steps`, so the trace never entered the process on a buyer's read.

`api-design.md` §1.3 and `ui-design.md` §7.1 both state that a buyer sees a summarised
execution trace. The summarisation machinery — `toBuyerCaseFileSteps` — was already written
and in use on the seller path, and is structurally incapable of emitting `reasoning`.

**Confirmed live on 2026-08-09**: a buyer's case file for an order returned `steps: []` while
the seller's case file for the *same order* returned the populated trace.

## Why the original justification expired

The behaviour carried a long written justification in `case-file.service.ts` — it was layer 1
of a three-layer defence around seller IP. But the justification rested on a premise that no
longer held:

> *"Today it would change nothing anyway: API-08 does not exist, no `runs` row is ever written,
> and every case file in the product reports an empty trace — which is an accurate statement
> that nothing has run, not a placeholder."*

API-08 shipped. `runs` rows are written. The empty array was no longer an accurate statement
that nothing ran — it was a silent omission of evidence the design says the buyer is owed.

## What the frontend did in the meantime

**Copy only, and deliberately nothing else.**

`ExecutionSteps` previously rendered *"No execution steps were recorded for this order"* on an
empty list. On a buyer's copy that was a false statement about their order, and the worst kind:
it reads as evidence the agent did nothing, on the screen where a buyer is deciding whether they
were treated fairly. It was changed to say the trace is not included in a buyer's copy and that
this is not a statement about what the agent did.

**What the frontend did not do**, and this was the substance of the escalation:

- It did **not** call the seller's case-file endpoint as a buyer. That would break invariant #3
  from the client side, which is worse than the defect.
- It did **not** synthesise or infer steps.
- It did **not** hide the section as though the design never called for it. Hiding it would
  make the defect invisible, and an invisible defect stops being fixed.

That held: **no workaround outlived the bug.** With the API fixed, a buyer's list is non-empty
whenever a run recorded steps and the new branch is simply not reached. See *What the frontend
needs now* below for the one copy string that is now reachable only in its honest case.

## What the decision had to weigh

**For fixing it.** The machinery already existed. Adding `r.steps` to the buyer's query and
mapping through `toBuyerCaseFileSteps` is a few lines. The design says buyers are owed the
trace, and the trace is a large part of what makes a partial refund legible — a tier alone is an
assertion, a step list is a fact.

**Against fixing it.** It deliberately weakens one layer of three protecting invariant #3
(*`system_prompt` never reaches a buyer*), and the code said so explicitly:

> *"Making the change is a deliberate weakening of one layer of three, and it belongs in a diff
> that says so, not in this one."*

## The decision

**Fix it. Two layers are enough here, and the layer given up could not be kept anyway.**

The layer given up is the select list. It was the strongest of the three in kind, because it is
the only one that also protects a log line, an error message and a stack trace — none of which
pass through a mapper. But it could not be kept *and* the buyer shown a trace: `reasoning` lives
in the same jsonb column as the fields the summary is composed from, so the column-level choice
was the whole trace or none of it, and none of it meant a buyer disputing an order sees no
evidence at all.

The two that remain are not a matter of anyone's attention, which is why two is enough:

- **`toBuyerCaseFileSteps`** reads `kind`, `label`, `durationMs` and `error` by name, one
  property at a time, and never `reasoning`. `summary` is composed from the step's structure,
  so there is no code path from the model's text to a buyer's response — the same standard
  invariant #3 is held to everywhere else. Truncating the reasoning was considered and rejected
  long before this decision; the mapper's own comment explains why the leak is at the *start*
  of a paraphrase.
- **`CaseFileStepResponse`** is closed — four fields, no index signature. A fifth has nowhere
  to land, and a spread is a compile error rather than a leak.

The row type keeps `runSteps` as `unknown[]` rather than `ExecutionStep[]` on purpose: nothing
on a buyer's path can reach `reasoning` by name, because the type never declares it.

`system_prompt` itself was **not** touched. It is still absent from the buyer's select list —
now the only column that differs between the two case files — so the prompt still never enters
the process on a buyer's read. What changed is the trace, and only the trace.

## What changed

Three files in `api/src/orders/`:

- **`order.repository.ts`** — `r.steps` moved into the shared `caseFileQuery`; the seller's
  `addSelect` for it removed. `runSteps` moved from `SellerCaseFileRow` onto `CaseFileRow`.
  The buyer-query doc-comment now states which layer was given up and what replaced it.
- **`case-file.service.ts`** — `getForBuyer` returns `toBuyerCaseFileSteps(row.runSteps)`. The
  `steps` doc-comment is the diff the old one asked for: it names the layer, the two that hold,
  and the one rule for `row.runSteps` on this path — only the redactor may read it.
- **`dto/case-file.dto.ts`** — `BuyerCaseFileResponse.steps` no longer documents itself as
  always empty; `[]` now means no run, or a run with no steps.

Contract documents updated: `openapi.yaml` (the operation description, the `steps` schema, and
the header note — the `DO NOT ADOPT` marker and `x-divergence` key are gone) and
`openapi-divergences.md` row 5, now `FIXED`.

## What the frontend needs now

**Nothing.** This is what the escalation predicted: `CaseFileStep` already carries `label`,
`summary`, `durationMs` and `error`, and `ExecutionSteps` already renders them on the seller
path. The buyer's branch renders the same list from the same shape.

One follow-up worth doing, not blocking: the buyer's empty-state copy — *"the trace is not
included in a buyer's copy"* — is now reachable only for an order with no run or no recorded
steps, where it says the wrong thing for the right reason. It should go back to stating the
absence plainly. `ui/docs/manual-test-plan.md` §7.7–7.8 tells a tester the empty array is
expected, and that is no longer true either.
