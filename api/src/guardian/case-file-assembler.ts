import type { ExecutionStep } from '../entities/execution-step';
import type { AuditPendingRow } from './guardian.repository';

/**
 * `GuardianCaseFile` — everything the auditor is handed for one audit
 * (`specs/009-guardian-audit-engine/contracts/guardian-case-file.md`).
 *
 * ## ⚠️ This type carries the seller's IP on purpose
 *
 * `docs/agent-definition.md` §4 is a table with a row per party, and Guardian's
 * row says **yes**:
 *
 * | Party | Sees the system prompt? |
 * | --- | --- |
 * | Platform / execution workspace | Yes — it runs it |
 * | **Guardian** | **Yes — needed for intent-vs-effort judgment** |
 * | Seller | Yes — it's theirs |
 * | **Buyer** | **No — redacted**, even in a dispute |
 *
 * The prompt is here because the auditor cannot otherwise tell *"tried hard and
 * the task was impossible"* from *"returned a stub without trying"* — and
 * `docs/product-workflow.md` §6.3 says the same of the raw execution steps:
 * *"Those deserve different verdicts, and only the trace can tell them apart."*
 * In tier terms that distinction is 25% versus 75% of the buyer's money.
 *
 * ## ⚠️ So the containment is on the OUTPUT, not the input
 *
 * §4 states the rule as an instruction to the auditor — *"Guardian's reasoning
 * may describe execution behaviour ('the agent made one extraction attempt and
 * stopped') but must never quote the prompt."* An instruction is the wrong
 * enforcement mechanism when the text it governs is model output that reaches
 * the buyer with **no serialiser in between**, which is exactly what a verdict's
 * `reasoning` is — the only buyer-facing text in the product with that property.
 *
 * So `verdict-validation.ts` turns it into a check: a ruling whose `reasoning`
 * reproduces a verbatim run of `systemPrompt` is rejected as a failed audit
 * before it is ever stored (FR-042, research R13). Paraphrase is deliberately
 * **not** detected — §4 permits reasoning that describes execution behaviour,
 * and its own example sentence is a paraphrase, so a paraphrase detector would
 * reject the rulings the product doc calls correct.
 *
 * ## ⚠️ Three rules that follow, and none of them is optional
 *
 * 1. **Nothing built from this type may be returned by a controller**, logged,
 *    or interpolated into an error message. It is assembled, serialised into one
 *    model request, and discarded. `guardian.errors.ts` takes identifying fields
 *    as typed properties precisely so no message string has to carry case-file
 *    text.
 * 2. **`systemPrompt` must arrive verbatim.** It is also the corpus the leak
 *    check reads, so truncating or normalising it here would silently narrow
 *    what can be detected — a ruling could reproduce a passage trimmed out of
 *    the copy the checker sees, and pass.
 * 3. **The seller loses nothing.** `GET /orders/:id/case-file` still returns
 *    `systemPrompt` and `rawSteps` unredacted to the agent's owner. The boundary
 *    is about *buyers*; withholding a seller's own prompt from its author would
 *    be theatre.
 *
 * An earlier draft of this feature excluded both the prompt and the raw trace.
 * It was withdrawn: it reversed a settled product decision, and it removed the
 * input the tried-versus-stub distinction rests on (research R6).
 */
export interface GuardianCaseFile {
  /**
   * **`orders.input`** — what the buyer paid for — not `runs.input`. The two are
   * the same document in the MVP and answer different questions; the case file
   * quotes the order's copy so that an order which failed to open, or which
   * never ran, can still show what was asked for.
   */
  input: Record<string, unknown>;

  /**
   * Yardstick 1, verbatim — the buyer's own prose, stated at purchase before any
   * work happened.
   *
   * ⚠️ **A single prose field, not an array.** That is why a `criterion`
   * citation is traced against one string while `capability` and `exclusion`
   * citations are traced against array elements (`verdict-validation.ts`).
   */
  acceptanceCriteria: string;

  /**
   * The buyer's testimony — what is alleged.
   *
   * ⚠️ **Not a yardstick.** Guardian rules against the listing promise and the
   * acceptance criteria, never against *"the buyer is unhappy"*
   * (`docs/product-workflow.md` §4.1). This is the question, not the standard.
   *
   * May be empty: `settlement.service.ts` documents a narrow window where a
   * dispute is recorded on-chain but the complaint row could not be re-written.
   * The audit still proceeds, because neither yardstick depends on this text.
   */
  complaint: string;

  /**
   * Yardstick 2, from the agent version the order **pinned** at purchase.
   *
   * May be **empty, never absent** — an empty array is a statement, and a
   * complaint about something never promised should reach the no-refund tier.
   */
  capabilities: string[];

  /** The defensive half of yardstick 2, from the same pinned version. */
  exclusions: string[];

  /**
   * ⚠️ **The pinned version's `system_prompt`, verbatim.** See the type's
   * header: it is here for the intent-versus-effort judgment, and it is the
   * corpus `verdict-validation.ts` checks the ruling against.
   *
   * ⚠️ The **pinned** version's prompt, not the agent's current one. A seller
   * who lost a dispute has every reason to edit what was cited against them, and
   * the audit is about what ran (invariant #6).
   */
  systemPrompt: string;

  /**
   * ⚠️ **Explicit, never inferred from `output` being absent.**
   *
   * `delivered: false` with `output: null` is the platform *stating* that
   * nothing was produced. Omitting the field and letting the model notice its
   * absence would make non-delivery something the reader infers from silence, on
   * the one input whose entire purpose is to say what happened.
   * `runs.output IS NULL` is evidence, not an error (invariant #7), and evidence
   * has to be legible.
   *
   * This is also the flag the non-delivery floor reads: if this is `false` and
   * the returned tier is not `full`, the audit fails rather than persisting a
   * verdict that contradicts the record (FR-014).
   */
  delivered: boolean;

  /**
   * `runs.output`, or `null`.
   *
   * `unknown` rather than a shape because its shape **is** the seller's declared
   * `output_schema`, known only at runtime.
   */
  output: unknown | null;

  /** `runs.error` — the run's failure, verbatim. Platform-authored. */
  error: string | null;

  /**
   * ⚠️ **`runs.steps` as recorded — `reasoning` INCLUDED.**
   *
   * This is the raw trace, not the buyer's redacted view. See the type header:
   * `docs/product-workflow.md` §6.3 identifies the steps as the only thing that
   * separates a genuine attempt from a stub, and redacting a derivative of the
   * prompt while shipping the prompt itself in the same payload would buy
   * nothing and cost the trace.
   *
   * ⚠️ A step is **not a citable source** — a citation's `source` is an enum of
   * `capability | exclusion | criterion` — so nothing here can reach the buyer
   * through the `quote` field. The leak risk is entirely in free-text
   * `reasoning`, which is what the containment check reads.
   */
  steps: ExecutionStep[];

  /**
   * ISO-8601 strings and a duration. Nulls where the run never finished — a
   * timeout is visible as a `startedAt` with no `finishedAt`.
   */
  timings: {
    startedAt: string | null;
    finishedAt: string | null;
    durationMs: number | null;
  };
}

/**
 * Build the case file for one disputed order.
 *
 * ⚠️ **Everything here comes from the agent version the order PINNED**, never
 * the agent's current listing (invariant #6, FR-002). The query in
 * `guardian.repository.ts` joins through `orders.agent_version_id`, so that is
 * enforced one layer down — but it is restated here because a future edit that
 * "helpfully" re-read the live agent would break the trace from a citation to
 * its source quietly, and in the one direction that looks like the platform
 * covering for the seller.
 *
 * ⚠️ **A missing run is not an error.** An order that never ran produces a
 * complete case file — `delivered: false`, `output: null`, `error: null`,
 * `steps: []`, every timing `null` (FR-005). The absence *is* the evidence, and
 * this function never throws for it.
 */
export function assembleCaseFile(row: AuditPendingRow): GuardianCaseFile {
  return {
    input: row.input,
    acceptanceCriteria: row.acceptanceCriteria,
    complaint: row.complaint,
    capabilities: row.capabilities,
    exclusions: row.exclusions,
    // Verbatim. Also the corpus `verdict-validation.ts` checks the ruling
    // against — truncating or normalising it here would silently narrow what
    // the leak check can detect (see the type header, rule 2).
    systemPrompt: row.systemPrompt,
    // Explicit, never inferred from a missing field. `runs.output IS NULL` is
    // evidence, not an absence (invariant #7).
    delivered: row.hasRun && row.output !== null,
    output: row.output,
    error: row.runError,
    // Raw — `reasoning` included. Deliberately NOT `toBuyerCaseFileSteps`.
    steps: row.steps,
    timings: {
      startedAt: row.startedAt,
      finishedAt: row.finishedAt,
      durationMs: row.durationMs,
    },
  };
}
