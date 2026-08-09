# Contract: `ui/docs/reconciliation-note.md`

The required shape of deliverable 1's record. Not the content — that is
[research.md](../research.md), which this note is written from.

## Purpose

One row per disagreement between the frontend and the API's published contract, with how each
was resolved. It exists so the next person does not re-derive the same findings, and so a
defect in the API cannot be quietly papered over in the client where the workaround outlives
the bug.

**Audience**: someone maintaining this frontend who asks *"why does this not match the
contract?"* They should find the answer here, next to the other product documentation, without
reading a spec directory.

## Required structure

```markdown
# Frontend ↔ API reconciliation

**Date** · **Contract** (path + what it is) · **Divergence report** (path + why it is read first)

## How to read this
[Three sentences: the contract is written from the running API, so it documents the API's
 bugs as carefully as its correct parts; the divergence report is what tells them apart;
 a row here is a place the frontend does not match the contract, with why.]

## Summary
[Counts by severity and resolution. Blockers named in the first line.]

## The rows
[One table. Columns below.]

## api-wrong rows in full
[One subsection per api-wrong row: what the API does, why it is wrong, what was escalated
 and to whom, and what the frontend does meanwhile.]

## What agrees
[Checked and found matching, so no row. Prevents the next pass re-deriving it.]

## Orphan endpoints
[Contract paths no page reaches, each with a reason.]

## Fields the contract sends that no frontend type declares
[Each with the reason it was not adopted. "The API sends it" is not one.]
```

## Required columns

| Column | Rule |
| --- | --- |
| `#` | `R-NN`, stable, referenced from the test plan and any escalation |
| Boundary | Endpoint + the specific field or behaviour |
| What differed | **Both sides.** What the contract says, what the frontend does. |
| Divergence report | The row number and its verdict, or "not a row — contract correct" |
| Resolution | `fixed-frontend` · `escalated` · `ignored-with-reason` · `named-orphan` · `no-change` |
| Reason | Required on every row, including the unchanged ones |

## Completeness rules

These are what make the note checkable rather than a narrative.

1. **Every `api-wrong` row in the divergence report appears here with a resolution** —
   including "escalated, nothing changed in the frontend", which is a complete resolution.
   *(FR-024, SC-003)* Today that is one row: buyer case-file `steps`.
2. **No `api-wrong` row has `resolution: fixed-frontend`.** The frontend does not absorb an API
   defect. *(FR-003)*
3. **Every field the contract sends that no frontend type declares appears**, with a reason
   beyond "the API sends it." *(FR-005, FR-007)* Today: six.
4. **Every orphan endpoint appears**, except `POST /offramp/routes` which the spec permits by
   name — and it should appear anyway, for symmetry with `/onramp/routes`. *(FR-020)*
5. **Every row has a reason**, including `no-change` rows. A row recording agreement with no
   reason is indistinguishable from one nobody checked.

## What this note is not

- **Not a changelog.** It records disagreements and their resolutions, not every edit.
- **Not a bug tracker.** An `escalated` row closes here and stays open in `api/`. Two books.
- **Not the test plan.** It says what the frontend does; the plan says how to check it.
- **Not a place to fix the API.** A row can escalate. It cannot decide.
