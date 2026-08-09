/**
 * One recorded action of a run, **as stored** — `runs.steps`, verbatim.
 *
 * ## Why this lives beside `run.entity.ts` rather than in a DTO folder
 *
 * API-07 declared this interface in `orders/dto/case-file.dto.ts`, ahead of its
 * producer, because the buyer's redaction is *structural* rather than textual:
 * the buyer's mapper is safe only because it never reads `reasoning`, and that
 * is a claim about a shape, so the shape had to be fixed before the writer
 * existed.
 *
 * API-08 is that writer. It moved here so the producer does not import from a
 * consumer's DTO folder — the wrong direction, and the sort of import that
 * becomes a duplicated interface six weeks later. `case-file.dto.ts` re-exports
 * it, so every existing import still resolves and both sides compile against one
 * declaration. That is also what turns `case-file.service.ts`'s
 * `as ExecutionStep[]` from a promise about a hypothetical producer into an
 * assertion about a real one.
 *
 * ⚠️ **`reasoning` is the field that carries model prose, and it is
 * seller-facing only.** Model text goes in `reasoning` and **nowhere else**.
 * Putting a sentence of it into `label`, into `error`, or into a fifth field
 * added later defeats the redaction silently, because the buyer's mapper copies
 * those fields through verbatim and no test would fail. The field-by-field
 * contract:
 *
 * | Field        | Seller's copy | Buyer's copy |
 * | ------------ | ------------- | ------------ |
 * | `kind`       | verbatim | drives the platform-authored `summary` |
 * | `label`      | verbatim | verbatim — platform-authored, no model text in it |
 * | `reasoning`  | verbatim | **absent** — dropped, not truncated, not summarised |
 * | `durationMs` | verbatim | verbatim |
 * | `error`      | verbatim | verbatim |
 * | `startedAt`  | verbatim | absent — the UI's `CaseFileStep` does not declare it |
 */
export interface ExecutionStep {
  /**
   * What kind of action this was. A closed union rather than `string` so that
   * the platform-authored `summary` can be composed by an exhaustive switch: a
   * fifth kind added later becomes a compile error in the composer rather than
   * a step that renders with no sentence under it.
   *
   * `tool_call` has no producer yet — seller agents have no tools in the MVP
   * (`docs/agent-definition.md` §2.2 lists `tools[]`, and nothing grants one).
   * It stays in the union because the composer that reads it is already
   * exhaustive over four members.
   */
  kind: 'tool_call' | 'model_turn' | 'output' | 'error';

  /**
   * Platform-authored — a tool name, a phase name. Safe for a buyer verbatim
   * **because the platform wrote it**, not because it is short.
   *
   * ⚠️ Never put model output here to "give the buyer more detail". This is the
   * one text field that crosses the boundary untouched. Every value API-08
   * writes is a literal from `execution.constants.ts` or the model id.
   */
  label: string | null;

  /**
   * ⚠️ **MODEL PROSE. Seller-facing only, never mapped for a buyer.** A
   * reasoning turn can paraphrase the system prompt it was given without ever
   * touching the `system_prompt` column, which is why the disclosure boundary
   * is wider than one field (`agent-serialiser.ts`). This is where that prose
   * lives, and the buyer's mapper does not read it. That is the whole
   * redaction.
   */
  reasoning: string | null;

  durationMs: number | null;

  /** The failure this step recorded, if it failed. Shown to both parties. */
  error: string | null;

  /** ISO-8601. Seller-facing only — not in the buyer's step shape. */
  startedAt: string | null;
}
