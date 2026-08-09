import type { ExecutionStep } from '../entities/execution-step';
import { STEP_LABELS } from './execution.constants';

/**
 * Composes `ExecutionStep[]` for a run that SUCCEEDED — the array written to
 * `runs.steps` when a model call resolved with output (`data-model.md` §2,
 * `research.md` R7).
 *
 * ## Why this is a free function and not a method on the service
 *
 * Building a trace is a pure projection from four numbers and a nullable
 * string to an array — no database, no chain, no clock (the clock has
 * already run; it arrives here as `Date` values). Nothing below needs a
 * lifetime, so nothing below gets `@Injectable`, the same reasoning
 * `order-serialiser.ts` gives for staying a free function rather than a
 * class: a function that cannot be given a dependency cannot grow a code
 * path to a value its parameters do not contain.
 *
 * ## Why two steps, not one
 *
 * A tool-less single-turn agent makes exactly one model call. That call is
 * one step (`model_turn`); turning the model's structured output into a
 * validated `runs.output` is a second, separate piece of work with its own
 * duration, so it is a second step (`output`). `ExecutionStep['kind']` also
 * includes `'tool_call'`, which has no producer yet — the demo agents carry
 * no `tools[]` (research R7) — but the union stays four-wide so that when a
 * tool arrives, the trace GROWS by inserting `tool_call` steps between these
 * two; this function's shape does not change to accommodate it. Two steps
 * that say what happened beat one blob that does not: a buyer or a dispute
 * reader can already tell "the model ran for Xms and said Y" apart from "the
 * platform then spent Zms turning that into an output" — the seam a stub
 * output would otherwise hide.
 *
 * ## Why failure traces are not here
 *
 * `research.md` R7 also lists the model-failure, timeout and
 * definition-unusable shapes, and `data-model.md` §2 gives their exact step
 * arrays. Those are T027's job. This function's signature — one outcome in,
 * one array out, no branching on success vs failure inside it — is exactly
 * what lets a sibling `failureTrace(...)` be added next to it later without
 * reshaping anything here: same file, same `STEP_LABELS` import, same
 * `ExecutionStep` return type, a different two-or-one-element array.
 */
export function successTrace(input: {
  /** The pinned definition's `model` id — never the platform's default. Goes in `label`, not `reasoning`. */
  model: string;
  /**
   * ⚠️ MODEL PROSE. The assistant text that came back alongside the
   * structured output (`AgentRunOutcome.assistantText`), usually empty for
   * these demo agents. Goes in `reasoning` and — per the rule below —
   * NOWHERE else in the returned array.
   */
  assistantText: string | null;
  /** Wall clock for the model call alone (`AgentRunOutcome.durationMs`), excluding parsing and validation. */
  modelDurationMs: number;
  /** When the model call started. */
  modelStartedAt: Date;
  /** Wall clock spent parsing/validating the model's output after the call returned. */
  outputDurationMs: number;
  /** When that parsing/validation started. */
  outputStartedAt: Date;
}): ExecutionStep[] {
  return [
    {
      kind: 'model_turn',
      // ⚠️ The model id, and ONLY the model id. `label` is the one text
      // field `toBuyerCaseFileSteps` (`order-serialiser.ts`) copies to a
      // buyer verbatim — it is never redacted, never dropped, never
      // truncated. Writing a sentence here instead of an id would not throw,
      // would not fail a test, and would hand a buyer a fragment of model
      // output on the one field the redaction never inspects. That failure
      // mode has no compiler and no test to catch it; the discipline is the
      // only guard, which is why every other value this module writes to
      // `label` comes from `STEP_LABELS` and this one comes from the pinned
      // definition's `model` column and nothing else.
      label: input.model,
      // ⚠️ MODEL PROSE lives here and here alone. `ExecutionStep.reasoning`
      // is seller-facing only — `toBuyerCaseFileSteps` never reads this
      // property, by construction, not by convention. Storing it complete
      // and unredacted is deliberate: redaction happens once, on the way OUT
      // to a buyer, in the orders serialiser. Summarising or truncating it
      // on the way IN would make the evidence lie about what the model
      // actually said before anyone had a chance to dispute it — evidence
      // that was redacted before it was written is not evidence.
      reasoning: input.assistantText,
      durationMs: input.modelDurationMs,
      error: null,
      startedAt: input.modelStartedAt.toISOString(),
    },
    {
      kind: 'output',
      // Platform-authored literal, not a description of what the output
      // contained — describing the payload would risk the same leak
      // `label`'s warning above exists to prevent, just moved to a second
      // call site.
      label: STEP_LABELS.OUTPUT,
      // No model prose accompanies parsing/validation — this step is the
      // platform's own work, not the model's, so `reasoning` stays null.
      reasoning: null,
      durationMs: input.outputDurationMs,
      error: null,
      startedAt: input.outputStartedAt.toISOString(),
    },
  ];
}

/**
 * Composes `ExecutionStep[]` for a run that FAILED — the array written to
 * `runs.steps` alongside a NULL `output` (`data-model.md` §2, `research.md`
 * R7).
 *
 * ## ⚠️ A failed run still records that the attempt was made
 *
 * FR-016. The temptation is to write `steps: []` when nothing was produced —
 * there is, after all, no output to describe. That would erase the one
 * distinction the middle refund tiers rest on: *"the agent genuinely tried and
 * the task was impossible"* versus *"the agent returned a stub without
 * trying"*. Those deserve different verdicts and only the trace can tell them
 * apart (`docs/product-workflow.md` §6.3). An empty array says neither.
 *
 * So even the shortest failure writes what happened: the model turn that was
 * attempted, carrying its own `error`, and a terminal `error` step naming the
 * kind of failure. A definition that could not be loaded never reached a model
 * at all, so that one is a single `error` step — which is itself the honest
 * record: no attempt was made, and the case file says so rather than implying
 * one.
 *
 * ## ⚠️ `error` crosses to the buyer verbatim
 *
 * `ExecutionStep.error` is shown to both parties (see the field's contract).
 * The messages that reach it come from `execution.errors.ts`, whose base class
 * carries the matching rule: an error message must never contain the seller's
 * system prompt or raw model output. This function passes the message straight
 * through and does not sanitise it — the guarantee lives at construction, where
 * the message is written, not here where it is copied.
 */
export function failureTrace(input: {
  /**
   * The pinned definition's `model` id, or `null` when the failure happened
   * before a model was ever chosen — a definition that could not be loaded.
   * `null` is what selects the single-step shape.
   */
  model: string | null;
  /** Which failure this was. Selects the terminal step's platform-authored label. */
  kind: 'model_error' | 'timeout' | 'definition_unusable';
  /**
   * The failure, as recorded. Written to both the attempted `model_turn` step
   * and the terminal `error` step, so a reader who scans only the last step
   * still sees why.
   */
  message: string;
  /** Wall clock spent before the failure surfaced. */
  durationMs: number;
  /** When the attempt started. */
  startedAt: Date;
}): ExecutionStep[] {
  const label =
    input.kind === 'timeout'
      ? STEP_LABELS.TIMEOUT
      : input.kind === 'definition_unusable'
        ? STEP_LABELS.DEFINITION_UNUSABLE
        : STEP_LABELS.MODEL_ERROR;

  const terminal: ExecutionStep = {
    kind: 'error',
    label,
    // The platform's own record of the failure. No model prose reaches this
    // function, and none is invented here.
    reasoning: null,
    durationMs: input.durationMs,
    error: input.message,
    startedAt: input.startedAt.toISOString(),
  };

  // No model was ever chosen, so there is no model turn to record. One step,
  // and its `label` says exactly which part of the definition was unusable.
  if (input.model === null) return [terminal];

  return [
    {
      kind: 'model_turn',
      label: input.model,
      // A failed call returned no usable prose. `null` rather than the error
      // text: `reasoning` means "what the model said", and attributing the
      // platform's failure message to the model would be a small lie in the
      // one field an auditor reads to judge effort.
      reasoning: null,
      durationMs: input.durationMs,
      error: input.message,
      startedAt: input.startedAt.toISOString(),
    },
    terminal,
  ];
}
