/**
 * The three fixed numbers and the four fixed strings this feature writes
 * without deriving them from a seller's definition.
 *
 * None of these are catalogue fields. `AGENT_MAX_OUTPUT_TOKENS` and
 * `AGENT_POLL_CONCURRENCY` bound the platform's own request and loop;
 * `STEP_LABELS` are the literal `ExecutionStep.label` values a run is allowed
 * to write. Grouping them here — rather than as literals at each call site —
 * is what makes it possible to audit every value that can reach a buyer by
 * reading one file instead of grepping the runner.
 */

/**
 * The `max_tokens` ceiling on the one `messages.create` call this feature
 * makes per run.
 *
 * A module constant rather than a field on the agent definition, because the
 * definition has no such field and adding one is a catalogue schema change
 * (research R5). The definition already carries `model` — cost/quality is
 * the seller's call — but an output-length cap protects the platform's own
 * run budget, not the seller's product, so it does not belong next to
 * `model` in the catalogue.
 *
 * 8192 is far above what any of the three demo agents actually return — a
 * summary, a handful of line items, one translation — so it never clips a
 * legitimate structured output. It is also small enough that a runaway
 * generation cannot outlast the run's declared `timeout_seconds`: a model
 * that never stops emitting tokens still hits this ceiling and returns,
 * rather than tying up the poller's one slot (`AGENT_POLL_CONCURRENCY`)
 * until the timeout does the job instead.
 */
export const AGENT_MAX_OUTPUT_TOKENS = 8192;

/**
 * The platform-authored values `ExecutionStep.label` is allowed to hold.
 *
 * ⚠️ `ExecutionStep.label` is the ONE text field a buyer sees verbatim
 * (data-model.md §2: *"the one text field that crosses to a buyer
 * untouched"*). Every value written to it must be a literal from this file
 * or the model id — never model output, never a fragment of the seller's
 * system prompt, never a raw error message. That is why these are constants
 * gathered in one file rather than string literals scattered across the
 * runner: a value that did not come from here (or from `version.model`) has
 * no business in that column, and reviewing this file is enough to see the
 * whole set a buyer can ever be shown.
 *
 * A frozen object rather than four separate exports, because the four values
 * are one closed set read together at every call site that assembles a
 * step — `run-trace.ts` reaches for "the output label" or "the timeout
 * label", not for an arbitrary string, and a single import expresses that
 * better than four.
 *
 * Typed so each member is assignable wherever `ExecutionStep['label']`
 * (`string | null`) is expected.
 */
export const STEP_LABELS = Object.freeze({
  /** The `output` step of a successful run (data-model.md §2). */
  OUTPUT: 'output',
  /** The `error` step's label when the model call itself failed. */
  MODEL_ERROR: 'model_error',
  /** The `error` step's label when the run exceeded its declared timeout. */
  TIMEOUT: 'timeout',
  /**
   * The `error` step's label when the pinned definition cannot be executed
   * as stored — e.g. a schema the Anthropic API rejects at run time
   * (research R5's note for API-11), not at listing time.
   */
  DEFINITION_UNUSABLE: 'definition_unusable',
} as const);

/**
 * How many runs the poller may have in flight at once, per process.
 *
 * Three demo orders, one process, and a serialised loop keep the log
 * readable during a rehearsal (research R1). This constant does not enforce
 * the limit by itself — the poller's re-entrancy guard is what actually
 * refuses to start a second claim-and-execute cycle while one is running —
 * so this is documentation of that guard's intent, not a semaphore. Raising
 * it is a change to the poller only: nothing else in the design assumes the
 * limit is one, except the poller itself, which is per-process and would
 * need revisiting before a second replica.
 */
export const AGENT_POLL_CONCURRENCY = 1;
