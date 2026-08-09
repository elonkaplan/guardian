/**
 * `GET /orders/:id/case-file` — the two shapes one route returns
 * (`specs/007-orders-purchase-saga/contracts/internal-api.md` §4), plus the
 * execution-step contract the redaction is defined against
 * (`data-model.md` §5).
 *
 * This is the evidence Guardian is handed when a delivery is disputed, and it
 * is **the one route in the product that returns different content to different
 * callers**. Everything difficult about this file follows from that.
 *
 * ## ⚠️ TWO TYPES, NOT ONE WITH OPTIONAL FIELDS
 *
 * The obvious shape is one interface with `systemPrompt?: string` and
 * `rawSteps?: ExecutionStep[]`, filled in when the caller is the seller. **That
 * is a shape branch** — a single type that means different things depending on
 * who asked — and the whole disclosure design exists to avoid exactly that
 * (006 FR-030, research R10). With optional members, every mapper, every test
 * and every future edit is one `if` away from populating them on a buyer's
 * read, and nothing in the type system objects.
 *
 * With two types, the buyer's mapper takes a parameter type with no such member
 * and returns a closed interface with nowhere to put one: it is **structurally
 * incapable** of emitting the prompt. That is the same construction
 * `agent-serialiser.ts` uses and the same reason `agent-version-detail.dto.ts`
 * is a separate file from `agent-listing.dto.ts`.
 *
 * The route branches; the serialiser does not (contracts §4):
 *
 * | Layer   | Branches? |
 * | ------- | --------- |
 * | Route   | **yes** — after the caller's role is resolved and checked |
 * | Query   | **yes** — the buyer's `SELECT` does not name `system_prompt` |
 * | Mapper  | **no** — two closed functions, neither with a mode flag |
 *
 * Pushing the branch down into the query is stronger than the mapper guarantee
 * alone: on a buyer's read the prompt never enters the process, so it cannot
 * reach a log line or a stack trace either.
 *
 * ⚠️ **`SellerCaseFileResponse extends BuyerCaseFileResponse` is not a shape
 * branch.** It is a strictly wider type with its own name, reachable only from
 * the seller's mapper. The buyer's type is not weakened by one property, and a
 * function returning `BuyerCaseFileResponse` still cannot emit a prompt.
 *
 * ## Closed, like their neighbours
 *
 * No index signature, and no `extends` from a TypeORM entity — only the one
 * `extends` above, between two hand-written interfaces. `return { ...version }`
 * must remain a compile error here above all: an `AgentVersion` row carries
 * `systemPrompt`, `model` and `timeoutSeconds`, and this is the file where a
 * spread would land them in front of a buyer who is mid-dispute.
 *
 * ⚠️ **Field names are literal.** `BuyerCaseFileResponse` is
 * `ui/src/api/types.ts`'s `CaseFile` field for field. A mismatched key does not
 * throw — it renders as an absent panel on the evidence screen.
 */

/**
 * `ExecutionStep` — one recorded action of a run, as stored in `runs.steps`.
 *
 * **The declaration moved to `src/entities/execution-step.ts`** when API-08 —
 * the feature that *writes* the column — was built. It was declared here first
 * because the buyer's redaction is structural and the shape had to exist before
 * its producer did; now that the producer exists, keeping the declaration in a
 * consumer's DTO folder would mean the writer imports from a reader. The
 * re-export keeps every existing import in this module resolving unchanged, and
 * the field-by-field disclosure contract lives with the declaration.
 */
import type { ExecutionStep } from '../../entities/execution-step';

export type { ExecutionStep };

/**
 * One step **as the buyer is allowed to see it** — `ui/src/api/types.ts`'s
 * `CaseFileStep`, field for field.
 *
 * ⚠️ **No `reasoning`, no `prompt`, no `raw`. That absence IS the guarantee.**
 * There is nowhere here for model text to land even if the query upstream
 * regressed and started selecting it, and no component can render a step it was
 * never given.
 */
export interface CaseFileStepResponse {
  /**
   * `ExecutionStep.label`, passed through. Platform-authored, so it crosses the
   * boundary verbatim.
   *
   * Non-nullable here while it is `string | null` on `ExecutionStep`: a step
   * with no label still needs a heading in the buyer's list, and composing one
   * from `kind` is the mapper's job rather than the screen's.
   */
  label: string;

  /**
   * ⚠️ **PLATFORM-AUTHORED, composed from the step's `kind` and `label`** —
   * *"called the extraction tool"*, *"produced no output"*. There is no code
   * path from the model's text to this field.
   *
   * ⚠️ **Model prose is DROPPED — never truncated, never model-summarised.**
   * The first sentence of a paraphrase is still a paraphrase and the leak is at
   * the start, so shortening would look like compliance and would not be; and
   * asking a model to summarise reasoning means feeding the prose to a model
   * whose output ships to the buyer, which is the same disclosure with an extra
   * step in front of it (research R11, `ui/docs/ui-design.md` §7.1).
   *
   * `null` when the step's structure supports no sentence worth writing.
   */
  summary: string | null;

  durationMs: number | null;

  /** The step's failure, verbatim. A buyer disputing a delivery needs it. */
  error: string | null;
}

/**
 * The buyer's case file — `ui/src/api/types.ts`'s `CaseFile`, field for field.
 *
 * Returned for an order in **any** state, including `purchased`, where `output`
 * is `null` and `steps` is `[]`. An order with no run still produces a case
 * file: the absence **is** the evidence (FR-040), which is why this route never
 * `404`s on a missing run.
 *
 * ⚠️ **No `systemPrompt`, and no property that could hold one.** This is the
 * type that makes a frivolous complaint useless as an IP-extraction route: a
 * buyer who disputes an order to read the seller's prompt gets this shape, and
 * this shape has nowhere to put it.
 */
export interface BuyerCaseFileResponse {
  /**
   * **`orders.input`** — what the buyer paid for — not `runs.input`. The two
   * are the same document in the MVP and answer different questions
   * (data-model §1); the case file quotes the order's copy so that an order
   * which failed to open, or which has not run yet, can still show what was
   * asked for.
   */
  input: Record<string, unknown>;

  /** The buyer's own prose, verbatim. What the delivery is judged against. */
  acceptanceCriteria: string;

  /**
   * ⚠️ **From the agent version the order PINNED, never the agent's current
   * listing.** A seller who lost a dispute has every reason to edit the
   * capability that was cited against them, and explaining a ruling with
   * today's listing would break the trace from a citation to its source —
   * quietly, and in the one direction that looks like the platform covering for
   * the seller. This is also why the client never fetches `GET /agents/:id` to
   * fill this panel.
   *
   * May be **empty**, never absent. An empty array is a statement.
   */
  capabilities: string[];

  /** The defensive half of the same yardstick, from the same pinned version. */
  exclusions: string[];

  /**
   * `runs.output`, or `null`.
   *
   * ⚠️ **`null` is the non-delivery evidence, and it is a present field rather
   * than an omitted one.** An optional property would let "the agent returned
   * nothing" arrive as a section that simply fails to render — silence, on the
   * one screen whose entire purpose is to say what happened. Invariant #7 rests
   * on this null being visible.
   *
   * `unknown` rather than a shape because its shape **is** the seller's
   * declared `outputSchema`, known only at runtime.
   */
  output: unknown | null;

  /**
   * The **redacted** trace — `toBuyerCaseFileSteps` over `runs.steps`, never the
   * raw jsonb. `reasoning` shares that column and may not cross this boundary;
   * `CaseFileStepResponse` is closed so it has nowhere to land.
   *
   * Empty, never absent. `[]` means the order has no run, or a run recorded no
   * steps — a fact the screen states, not a placeholder.
   */
  steps: CaseFileStepResponse[];
}

/**
 * The seller's case file — the buyer's, plus the two things that are theirs.
 *
 * **This is not a leak, and the distinction is the whole feature.** The
 * boundary `systemPrompt` sits behind is about **buyers**. Here the caller is
 * the seller reading their own IP, in a dispute they are being asked to answer:
 * a seller who cannot see the prompt that ran and the reasoning it produced has
 * been told of an accusation they may not examine. Withholding it from its
 * author would be theatre.
 *
 * ⚠️ **Only the seller's mapper may return this type**, and only after the
 * route has resolved the caller as the owner of the agent the order was placed
 * against. The two mappers share no code and neither takes a mode flag; the
 * buyer's takes a parameter type with no `systemPrompt` member at all.
 *
 * `ui/src/api/types.ts`'s `CaseFile` does not declare these two fields yet.
 * Sending them is safe — that file states in writing that declaring fewer
 * fields than arrive is safe — and `ui-design.md` §7.1 says the seller's view
 * *"stays unredacted"*, so extending the client type is worth doing. Until then
 * they arrive and are ignored.
 */
export interface SellerCaseFileResponse extends BuyerCaseFileResponse {
  /**
   * The pinned version's `system_prompt`, verbatim. **It is theirs.**
   *
   * ⚠️ Never widen a buyer-facing type by copying this line. The buyer's copy
   * of this evidence is `BuyerCaseFileResponse`, directly above, and it is
   * complete for what a buyer is owed.
   *
   * ⚠️ The **pinned** version's prompt, not the agent's current one — the
   * dispute is about what ran.
   */
  systemPrompt: string;

  /**
   * `runs.steps` as recorded, **reasoning included**. The unredacted trace the
   * seller needs in order to explain what their agent actually did.
   *
   * Beside `steps` rather than instead of it: the seller sees the same redacted
   * list the buyer and the auditor were shown, plus the raw record, so they can
   * tell what was cited against them from what was not. **Always `[]` until
   * API-08 exists.**
   */
  rawSteps: ExecutionStep[];
}
