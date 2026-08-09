# Contract: `GuardianCaseFile` — what the auditor is shown

**Module**: `src/guardian/case-file-assembler.ts` · **Consumers**: `claude-auditor.ts` (as the
user turn), `verdict-validation.ts` (as the corpus a citation must trace to, and the text a
ruling must not reproduce)

> ## ⚠️ Guardian sees the seller's system prompt. The containment is on the output.
>
> `agent-definition.md` §4 is a table with a row per party, and Guardian's row says **yes**:
>
> | Party | Sees the system prompt? |
> | --- | --- |
> | Platform / execution workspace | Yes — it runs it |
> | **Guardian** | **Yes — needed for intent-vs-effort judgment** |
> | Seller | Yes — it's theirs |
> | **Buyer** | **No — redacted**, even in a dispute |
>
> The same section states the containment as an instruction: *"Guardian's reasoning may describe
> execution behaviour ('the agent made one extraction attempt and stopped') but must never quote
> the prompt."*
>
> That rule is right and an instruction is the wrong place for it, because verdict reasoning is
> model output that reaches the buyer with **no serialiser in between** — the only buyer-facing
> text in the product with that property. So the rule becomes a check before the ruling is
> stored: `verdict-validation.ts` rejects any verdict whose reasoning reproduces a verbatim run
> of the prompt (`verdict-schema.md` §5 gate 7, `research.md` R13).
>
> **An earlier draft of this contract excluded the prompt and the raw trace.** It is withdrawn.
> It reversed a settled product decision, and it removed the input `product-workflow.md` §6.3
> says the tried-versus-stub distinction depends on. R6 records why in full.

---

## 1. The shape

```ts
/**
 * Everything Guardian is handed for one audit.
 *
 * ⚠️ This type deliberately carries the seller's `systemPrompt` and the RAW execution
 * steps. It is the only place outside `execution/` that assembles both. Nothing built
 * from this type may be returned from a controller.
 */
export interface GuardianCaseFile {
  input: Record<string, unknown>;
  acceptanceCriteria: string;
  complaint: string;

  capabilities: string[];
  exclusions: string[];

  /**
   * ⚠️ The pinned version's `system_prompt`, verbatim. Present because the
   * intent-versus-effort judgment needs it (agent-definition §4).
   *
   * ⚠️ Also the corpus for the leak check: `verdict-validation.ts` reads this field
   * to decide whether the ruling reproduced it. Passing a redacted or truncated
   * prompt here would silently weaken that check.
   */
  systemPrompt: string;

  /** ⚠️ Explicit. Never inferred from `output` being absent. */
  delivered: boolean;
  output: unknown | null;
  error: string | null;

  /** ⚠️ `runs.steps` as recorded — `reasoning` included. See §4. */
  steps: ExecutionStep[];

  timings: {
    startedAt: string | null;
    finishedAt: string | null;
    durationMs: number | null;
  };
}
```

`ExecutionStep` is imported from `src/entities/execution-step.ts` — the same declaration the
execution engine writes and the seller's case file reads. No second interface.

---

## 2. Field by field

| Field | Source | Contract |
| --- | --- | --- |
| `input` | `orders.input` | What the buyer paid for — **the order's copy, not `runs.input`.** They are the same document in the MVP and answer different questions; an order that never ran still has one |
| `acceptanceCriteria` | `orders.acceptance_criteria` | Yardstick 1, verbatim. **A single prose field, not an array** — which is why a `criterion` citation is matched against one string (`verdict-schema.md` §4) |
| `complaint` | `complaints.reason` | The buyer's testimony. What the audit is answering, **not** a yardstick — Guardian rules against the promise and the criteria, never against "the buyer is unhappy" (product §4.1) |
| `capabilities` | **pinned** `agent_versions.capabilities` | Yardstick 2. May be **empty, never absent** — an empty array is a statement, and a complaint about something never promised should reach 0% |
| `exclusions` | **pinned** `agent_versions.exclusions` | The defensive half of yardstick 2. Same emptiness rule |
| `systemPrompt` | **pinned** `agent_versions.system_prompt` | ⚠️ See §3 |
| `delivered` | `runs.output IS NOT NULL` | ⚠️ See §5 |
| `output` | `runs.output` | `null` **is** the non-delivery evidence (invariant #7). `unknown` rather than a shape, because its shape *is* the seller's declared `output_schema`, known only at runtime |
| `error` | `runs.error` | The run's failure, verbatim. Platform-authored |
| `steps` | `runs.steps` | ⚠️ Raw, `reasoning` included. See §4 |
| `timings` | `runs.started_at` / `finished_at` / `duration_ms` | ISO strings and a number; nulls where the run never finished. A timeout is visible as a `startedAt` with no `finishedAt` |

**Every field comes from the agent version the order pinned**, never the agent's current listing
(invariant #6, FR-002). A seller who lost a dispute has every reason to edit the capability that
was cited against them; explaining a ruling with today's listing would break the trace from a
citation to its source, quietly, and in the one direction that looks like the platform covering
for the seller. This applies to `systemPrompt` too: the audit is about what ran.

---

## 3. ⚠️ `systemPrompt` — why it is here, and the two rules that follow

**Why it is here.** Guardian judges the *output* against the promise and the criteria, and for
the 0% / 50% / 100% spine that is enough. What the prompt adds is the intent-versus-effort
judgment: whether a thin-looking output came from an agent that genuinely attempted an
impossible task or from one that returned a stub without trying. `product-workflow.md` §6.3 says
those *"deserve different verdicts"*, and in tier terms that is the difference between severe
shortfall (75%) and inconclusive evidence (25%) — three quarters of the buyer's money.

**Rule 1 — this field never reaches a buyer, and this module has no controller that could send
it.** `GuardianCaseFile` is assembled, serialised into a model request, and discarded. It is
never a response body, never logged, and never attached to an error. `AuditFailedError` takes
typed identifying fields precisely so no message string ever has to carry case-file text
(`execution.errors.ts` established the pattern and the reason).

**Rule 2 — this field is the corpus for the leak check**, so it must arrive verbatim. Truncating
or normalising it here would silently narrow what `verdict-validation.ts` can detect: a ruling
could reproduce a passage that was trimmed out of the copy the checker sees, and pass. The
assembler passes the column through unchanged, and the checker does its own normalisation.

---

## 4. ⚠️ `steps` is the raw trace, `reasoning` included

`runs.steps` is passed through as recorded. `ExecutionStep.reasoning` is model prose written by
the seller's agent under the seller's prompt, and it is present.

**Why not the buyer's redacted view.** An earlier draft used `toBuyerCaseFileSteps` here, arguing
that step reasoning is derived from the prompt and could be paraphrased into buyer-facing verdict
prose. That argument only has force if the prompt itself is absent. With `systemPrompt` in the
same payload — as §4 of the product doc requires — redacting a derivative while shipping the
original buys nothing and costs the trace that `product-workflow.md` §6.3 identifies as the only
thing that separates a genuine attempt from a stub.

There were only ever two coherent positions: **both inputs in, with containment on the output**,
or **both out as an explicit product change**. This contract takes the first.

**What the trace is actually for here.** Not citation — a step is not a citable source (§6). It
is for the tier judgment: how many model turns, what failed, how long it took, and what the agent
was reasoning about when it stopped.

---

## 5. ⚠️ `delivered` is a field, not an inference

`delivered: false` with `output: null` is the platform **stating** that nothing was produced.

The alternative — omitting `output` and letting the model notice its absence — makes
non-delivery something the reader infers from silence, on the one input whose entire purpose is
to say what happened. `runs.output IS NULL` is evidence, not an error (invariant #7), and
evidence has to be legible.

This is also the flag `verdict-validation.ts` reads for the non-delivery floor (R10): if
`delivered === false` and the returned tier is not `full`, the audit fails rather than persisting
a verdict that contradicts the record. Two consumers, one explicit field.

**An order with no run row at all produces a complete case file** — `delivered: false`,
`output: null`, `error: null`, `steps: []`, all timings `null` (FR-005). The assembler never
`404`s on a missing run. The absence *is* the evidence.

---

## 6. What the auditor may cite, and why the quote field is safe

A citation's `source` is an enum of `capability | exclusion | criterion`, enforced on the wire
(FR-010, `verdict-schema.md` §2). Neither `systemPrompt` nor `steps` is a citable source.

That is a structural guarantee about the one field designed to reproduce text verbatim: a
`quote` carrying prompt text would fail R4's traceability check, because it would not be found in
any capability, exclusion, or criterion. **The leak risk is entirely in `reasoning`**, which is
free text — and that is exactly the field the containment check reads.

---

## 7. Assembly

One query per audit, joining `orders → agent_versions → agents`, left-joining `runs` and
`complaints`. It lives in `guardian.repository.ts`.

**This is the second query in the codebase that selects `system_prompt`**, and it should read
like the first. `execution.repository.ts` opens with a doc-comment explaining that it inverts
`order.repository.ts`'s rule deliberately, because the run cannot happen without the prompt. The
same applies here for the same kind of reason, with the same obligation: the module has **no
controller that returns anything built from this row**, and the field is never logged.

Guardian **reads the `runs` table** but must not **import the `execution` module**
(`docs/CONTEXT.md` §3). Execution produces the evidence; Guardian consumes it; the one-way
direction is what makes *"the platform produced the evidence, not the audited party"* true in
code rather than in prose.

### Preconditions

The assembler is only reached for an order the audit-pending predicate selected, so it may assume
`state = 'disputed'`, `onchain_deal_id IS NOT NULL`, and `audit_attempts < 3` (FR-027, FR-043). A
missing `complaints` row on a `disputed` order is possible — `settlement.service.ts` documents the
narrow window where a dispute is recorded on-chain but the complaint row could not be re-written —
and assembles as an empty `complaint`. The audit still proceeds: the yardsticks are the promise
and the criteria, and neither depends on the complaint's text.

---

## 8. Serialisation into the request

The case file is `JSON.stringify`'d as the **entire user turn**. It must not appear in the
`system` block: the system block is the frozen, cached prefix, and any per-audit content in it
voids prompt caching silently (R8).

```ts
messages: [{ role: 'user', content: JSON.stringify(caseFile) }]
```

JSON rather than a rendered prose template, for three reasons: `output` is an arbitrary
seller-declared shape with no sensible prose rendering; a template is a second place the field set
is written down and can drift from this interface; and the model reproduces quotes more faithfully
from delimited fields than from prose, which is what R4's traceability check depends on.

**The system prompt is a labelled field inside that JSON, not prepended to the instructions.**
It is seller data being shown to the auditor as evidence, and it must be legible as evidence
rather than as something the auditor should obey. The rubric names it and says what it is for.

---

## 9. Regression checks

These belong in every review of this module. The `system_prompt` grep that an earlier draft of
this contract prescribed is **wrong now** — the field is supposed to be here. What must be
checked is narrower and more useful:

```sh
# The prompt is assembled, but never leaves the module by any route
grep -rn 'systemPrompt' src/guardian/ | grep -v 'case-file-assembler\|verdict-validation\|guardian.repository'
#   → nothing. Only the assembler, the checker, and the query may name it.

# No controller in this module returns anything built from a case file
grep -rn 'GuardianCaseFile' src/guardian/verdict.controller.ts src/guardian/verdict-serialiser.ts
#   → nothing

# The prompt is never logged
grep -rn 'logger\.' src/guardian/ | grep -i 'prompt\|caseFile\|systemPrompt'
#   → nothing

# Guardian does not import execution (docs/CONTEXT.md §3)
grep -rn "from '\.\./execution" src/guardian/
#   → nothing

# The buyer's serialiser still drops step reasoning (FR-036 regression)
grep -n 'reasoning' src/orders/order-serialiser.ts
#   → nothing that reaches a buyer-facing field
```
