/**
 * Errors thrown by `AgentRunner` implementations and caught by `ExecutionService`
 * (contracts `agent-runner.md`, "The contract").
 *
 * ⚠️ **These are never mapped to an HTTP status, and never will be.** Unlike
 * `orders/orders.errors.ts` and `catalog/catalog.errors.ts`, this module has no
 * controller downstream of it — nothing calls `AgentRunner.run` over HTTP, and
 * nothing in `execution/` renders a response body. Every one of these is caught
 * inside `ExecutionService`'s step 5b (`run-record.md`, "The pipeline") and turned
 * into exactly two writes: a `runs` row (`error` set, `output` left NULL,
 * `output_valid` left NULL) and `UPDATE orders SET state='failed'`. There is no
 * caller further out that ever sees the instance — do not add an
 * `HttpException` mapping for these on the assumption one is missing; none is
 * missing, none belongs.
 */
export abstract class ExecutionError extends Error {
  /**
   * ⚠️ **The `message` must never contain the seller's `system_prompt` or raw
   * model output.** `runs.error` is fine to hold either — it is redacted on the
   * way out to a buyer by the case-file serialiser (invariant #3, `run-record.md`
   * point 4) — but before it reaches that column, this `message` is also the
   * thing a `logger.error(err)` call reaches for, and a log line goes around
   * every serialiser this codebase has. `ClaudeAgentRunner`'s own logging rule
   * (`agent-runner.md`) is the same restriction stated the other way round: log
   * the order id, the model, the duration and the failure kind, never the prompt
   * or the response body. Constructing one of these with a message built from
   * `error.response.data` or similar is the mistake this class exists to make
   * awkward — every subclass below takes the identifying fields as separate,
   * typed properties precisely so the message string never has to carry them.
   */
  constructor(
    message: string,
    public readonly orderId: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

/**
 * The run exceeded `timeoutMs` — the pinned agent version's `timeout_seconds`,
 * converted once at the call site (`agent-runner.md`, `AgentRunRequest.timeoutMs`).
 *
 * **Enforced twice in `ClaudeAgentRunner`** — the SDK's own `timeout` request
 * option and an `AbortController` armed for the same deadline — because the
 * first bounds the HTTP request and the second bounds the whole call including
 * anything the SDK does around it. Whichever one actually fires, the runner
 * throws this same class; the two triggers are not distinguished because a
 * caller three layers up has no use for which timer won.
 *
 * ⚠️ **Whatever the model had produced by the deadline is discarded, not
 * salvaged.** FR-026 forbids returning a partial or unvalidated output just
 * because most of a response arrived — a run that timed out is not a run that
 * delivered, and there is no "close enough" for structured output a buyer would
 * pay for. `timeoutSeconds` is carried as the seller-facing limit (not the
 * millisecond value the runner actually timed) because that is the number
 * `runs.error` should name and the number that matches what the seller
 * configured on the pinned definition.
 *
 * **Run-record outcome**: `runs` row gets `state='failed'` on the order,
 * `runs.output` left NULL, `runs.error` set from this error's message,
 * `runs.output_valid` left NULL — there is no output to validate.
 *
 * Never retried. `run-record.md` point 1 is unconditional: one row per order,
 * ever, no retry path in this feature or permitted to be added to it.
 */
export class AgentTimeoutError extends ExecutionError {
  constructor(
    message: string,
    orderId: string,
    public readonly timeoutSeconds: number,
    cause?: unknown,
  ) {
    super(message, orderId, cause);
  }
}

/**
 * The model call itself failed to produce a usable result — it errored at the
 * transport or API level, the provider refused the request (content policy,
 * rate limit, invalid credentials), or it resolved but returned something that
 * could not be parsed as the structured output it was asked for.
 *
 * ⚠️ **This is a legitimate evidence-producing outcome, not an error to paper
 * over.** Invariant #7 (`docs/CONTEXT.md`) is exactly this case: `runs.output IS
 * NULL` is how non-delivery is *proven*, not a gap to be filled by a retry, a
 * fallback model, or a synthesized placeholder output. `agent-runner.md` states
 * the same rule from the runner's side — `maxRetries: 0` is load-bearing, not
 * tidiness, because a hidden retry would make `duration_ms` false and could turn
 * one purchased run into three model calls the buyer never agreed to pay for.
 * **There is no retry anywhere** in this feature: not here, not in
 * `ExecutionService`, not in a cron. A run either delivers once or this class is
 * thrown once and the order moves to `failed` for good.
 *
 * This is also the class `ExecutionService` throws *on behalf of* a runner that
 * threw something else entirely (`agent-runner.md`: "Anything else escaping a
 * runner is a bug, and the service treats an unexpected throw as
 * `AgentRunFailedError` rather than letting it reach the poller"). A run that
 * dies without a record is the one outcome with no evidence at all, so an
 * unrecognised throw is folded into this class rather than left to crash the
 * poller and leave the order stuck at `running`.
 *
 * `cause` carries the underlying error (an SDK exception, a JSON parse failure,
 * whatever the unrecognised throw actually was) for local debugging. ⚠️ It is
 * not read by anything that reaches a buyer, and per the base class's warning,
 * neither `cause` nor `message` may be built from the model's raw output or the
 * seller's `system_prompt`.
 *
 * **Run-record outcome**: `runs` row gets `state='failed'` on the order,
 * `runs.output` left NULL, `runs.error` set from this error's message,
 * `runs.output_valid` left NULL.
 */
export class AgentRunFailedError extends ExecutionError {
  constructor(message: string, orderId: string, cause?: unknown) {
    super(message, orderId, cause);
  }
}

/**
 * The pinned agent definition itself could not be used to attempt a run at all
 * — the API refused the `outputSchema` before the model call could be attempted
 * (`agent-runner.md`'s "the API refused the `outputSchema` itself"), or
 * `run-record.md` step 2's load of `agent_version_id` came up missing.
 *
 * **Distinct from `AgentRunFailedError` because the fault is not the attempt —
 * it is what was attempted.** A schema Ajv accepted at listing time
 * (`catalog/schema-validation.ts`'s `assertValidJsonSchema`) can still be one a
 * model provider's structured-output constraint refuses to compile against; the
 * two validators do not promise the same acceptance set, and FR-007 requires the
 * refusal to name *which* field was the problem rather than reporting a generic
 * run failure. `field` is typed as the same union `catalog.errors.ts`'s
 * `InvalidJsonSchemaError` uses for the identical reason: naming
 * `'outputSchema'` (or another pinned-definition field found unusable before the
 * run started) lets `runs.error` be built without re-deriving which field broke,
 * and a field added to the definition later fails to compile here rather than
 * silently landing as prose.
 *
 * **Run-record outcome**: `runs` row gets `state='failed'` on the order,
 * `runs.output` left NULL, `runs.error` naming `field`, `runs.output_valid` left
 * NULL. Never retried, for the same reason as `AgentRunFailedError`: the
 * definition is pinned at purchase time (invariant #6) and does not change
 * under a failed order, so an identical retry meets an identical refusal.
 */
export class DefinitionUnusableError extends ExecutionError {
  constructor(
    message: string,
    orderId: string,
    public readonly field: string,
    cause?: unknown,
  ) {
    super(message, orderId, cause);
  }
}
