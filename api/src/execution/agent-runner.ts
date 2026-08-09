/**
 * `AgentRunner` — the port that separates *running an agent* from *recording
 * what happened*. `ExecutionService` depends on this abstract class and
 * nothing else; it cannot tell which implementation it was given.
 *
 * ## Why a port, not an `if (isDemo)` branch
 *
 * Deterministic demo mode (`specs/008-execution-engine/research.md` R4)
 * substitutes at the model call, and NEVER at the run record. A
 * `ScriptedAgentRunner` consults a registry keyed on the definition's hash
 * and the buyer's input; when nothing matches it delegates to the real
 * runner (FR-033), and when something matches it resolves or throws exactly
 * as a live call would. A scripted crash therefore travels the ordinary
 * failure path — the same thrown error types below, the same `failed`
 * transition, the same closed `runs` row — and produces real evidence.
 * `docs/specs/API-11-demo-seed.md` is explicit about why that matters: *"a
 * seeded shortcut that writes a verdict directly, or an error row that never
 * reaches `failed`, removes the very thing Guardian reads."* An `if (isDemo)`
 * inside the service would put the shortcut upstream of the evidence — the
 * exact thing that warning forbids. A port keeps the substitution downstream
 * of everything that writes a record, where the service cannot see it.
 *
 * ## Why `abstract class`, not an interface plus an injection symbol
 *
 * Nest can use an abstract class as its own injection token. That keeps the
 * wiring to `{ provide: AgentRunner, useClass: ScriptedAgentRunner }` — one
 * line — and keeps the token from drifting out of sync with the type, which
 * is the failure mode of a hand-rolled `Symbol` or string token declared
 * next to, rather than as, the contract it identifies.
 *
 * ## What the runner never does
 *
 * The runner never touches the database, the chain, or the order. It
 * receives a request and returns or throws — nothing else is observable
 * about it from outside. That narrowness is what lets `ScriptedAgentRunner`
 * be a total substitute for `ClaudeAgentRunner`: there is no side channel
 * either implementation could diverge on.
 *
 * The runner also never checks `output` against `outputSchema`. Conformance
 * is the service's job to RECORD (`runs.output_valid`), not the runner's job
 * to enforce — a runner that rejected a non-conforming output would turn a
 * delivery into a non-delivery, which FR-029 forbids. Whatever the model
 * returned under the structured-output constraint is the output.
 *
 * ## Failure throws
 *
 * Success resolves with an `AgentRunOutcome`, whose `output` is never null —
 * that is the whole reason failure is signalled by throwing rather than by a
 * nullable field a caller could forget to check. Only three errors are ever
 * thrown, all from `./execution.errors`: `AgentTimeoutError` (the run
 * exceeded `timeoutMs`), `AgentRunFailedError` (the model call errored, was
 * refused, or returned something unparseable), and `DefinitionUnusableError`
 * (the API refused `outputSchema` itself, naming the field per FR-007).
 * Anything else escaping a runner is a bug in the runner, not a fourth
 * outcome callers need to plan for.
 */
export interface AgentRunRequest {
  /**
   * `orders.id`. For error attribution and log lines only — the runner never
   * uses it to look anything up, touch the database, or branch behaviour.
   * It exists purely so a thrown `ExecutionError` and a `ClaudeAgentRunner`
   * log line can name which order they belong to without the runner reaching
   * back into `orders` (which it must never do — see "What the runner never
   * does" above).
   */
  readonly orderId: string;
  /** The pinned version's `system_prompt`. ⚠️ Never logged, never echoed. */
  readonly systemPrompt: string;
  /**
   * The pinned version's `model`. The seller's field, pinned at listing —
   * never substituted by the platform. An audit must be of the model that
   * was actually sold, not of whatever the platform would have preferred.
   */
  readonly model: string;
  /** The pinned version's `output_schema`, 2020-12 dialect. */
  readonly outputSchema: Record<string, unknown>;
  /** The buyer's input, from `orders.input`. */
  readonly input: Record<string, unknown>;
  /** The pinned version's `timeout_seconds`, already in ms. */
  readonly timeoutMs: number;
  /** `agent_versions.definition_hash`, hex. Only the scripted runner reads it. */
  readonly definitionHash: string;
}

export interface AgentRunOutcome {
  /** The structured output. Never null on this type — a failure throws. */
  readonly output: Record<string, unknown>;
  /**
   * Assistant prose accompanying the structured output, when the model
   * emitted any. ⚠️ MODEL PROSE — stored on the step's `reasoning`, never on
   * `label`, never logged.
   */
  readonly assistantText: string | null;
  /** Wall clock for the model call alone, for the `model_turn` step. */
  readonly durationMs: number;
}

export abstract class AgentRunner {
  abstract run(request: AgentRunRequest): Promise<AgentRunOutcome>;
}
