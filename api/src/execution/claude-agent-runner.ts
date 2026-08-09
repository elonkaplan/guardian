import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';

import type { AppConfig } from '../config/env.schema';
import { AgentRunner, type AgentRunOutcome, type AgentRunRequest } from './agent-runner';
import { AGENT_MAX_OUTPUT_TOKENS } from './execution.constants';
import { AgentRunFailedError, AgentTimeoutError, DefinitionUnusableError, ExecutionError } from './execution.errors';

/**
 * The real `AgentRunner` (`agent-runner.md`, "`ClaudeAgentRunner`"). One
 * non-streaming `client.messages.create` per `run()` call — nothing more.
 *
 * ## The request is built from seller data, so it must work for ANY model
 *
 * `request.model` is the pinned definition's field, never substituted
 * (`agent-runner.ts`'s own doc comment). That constrains what this class is
 * allowed to send: a parameter that is valid on one model tier and a 400 on
 * another cannot appear in a request built generically from seller data,
 * because the seller — not the platform — chose the model.
 *
 * ⚠️ **Deliberately NOT sent: `thinking`, `output_config.effort`,
 * `temperature`, `top_p`, `top_k`.** Research R5 is explicit about why: all
 * three demo agents run on `claude-haiku-4-5`, where `effort` and adaptive
 * thinking are both unsupported and would 400 the request outright. But the
 * demo agents are only the concrete case of the general rule — *any* model a
 * seller might legitimately name could reject any one of these, so the only
 * request shape that is correct for every model at once is the one that omits
 * them entirely. Do not add one of these fields back "to improve quality" —
 * that is a per-model tuning decision the seller does not get to have made
 * for them, and it can turn every run on some other model into a guaranteed
 * `DefinitionUnusableError`... or worse, a 400 this class doesn't even parse
 * as schema-related, and every run on that model silently starts failing.
 *
 * ⚠️ **`maxRetries: 0` is load-bearing, not tidiness.** The SDK retries
 * 408/409/429/5xx twice by default. Two hidden retries would make
 * `AgentRunOutcome.durationMs` a lie (it would time one HTTP attempt while
 * three ran), could spend up to three times the seller's declared
 * `timeout_seconds` in wall clock before this class ever gets to throw
 * `AgentTimeoutError`, and — worst of all — would turn one purchased run into
 * three model calls the buyer never agreed to pay for. A failure here is a
 * legitimate, evidence-producing outcome (invariant #7): `AgentRunFailedError`
 * closes the order with a record, exactly as intended. There is no retry
 * anywhere in this feature, and this constant is where that rule is enforced
 * for the one HTTP call this class makes.
 *
 * ## Two timeout mechanisms, both armed for the same deadline
 *
 * `request.timeoutMs` is enforced twice: as the SDK's own `timeout` request
 * option, and as an `AbortController` whose `signal` is also passed on the
 * request and whose `setTimeout` fires at the same deadline. They are not
 * redundant — the SDK's `timeout` bounds the HTTP request itself, while the
 * `AbortController` bounds the *whole call*, including any SDK-side work
 * around that request (retry bookkeeping, response parsing) that the raw HTTP
 * timer does not cover. Whichever one actually fires, the result is the same
 * thrown `AgentTimeoutError`; a caller three layers up (`ExecutionService`)
 * has no use for which timer won, only for the fact that the run did not
 * finish in time. The timer is always cleared in a `finally`, so a run that
 * finishes early never leaves a dangling `setTimeout` behind.
 *
 * ## Response handling — refusal and truncation must be checked BEFORE `content`
 *
 * ⚠️ A refusal (`response.stop_reason === 'refusal'`) is a normal HTTP 200
 * with an empty or partial `content` array — it is not a thrown SDK error.
 * Code that indexes `content[0]` unconditionally will throw on `undefined`
 * (empty refusal) or silently accept a partial answer (mid-stream refusal on
 * a model that supports it) instead of reporting the actual outcome. Both
 * `refusal` and `max_tokens` are therefore checked first, before any content
 * block is read, and both become `AgentRunFailedError` — a refusal is not
 * something this class asks the model to reconsider, and a `max_tokens`
 * truncation is not something it repairs; FR-026 and FR-029 forbid returning
 * anything short of a complete, model-produced structured output.
 *
 * ## ⚠️ LOGGING DISCIPLINE — non-negotiable
 *
 * Every log line this class writes carries the order id, the model, the
 * duration, and the failure kind — and NEVER `request.systemPrompt`, the
 * request body, the response body, or `assistantText`. The reason this
 * matters more here than almost anywhere else in the codebase: the seller's
 * `system_prompt` is redacted from buyers by a serialiser on its way out
 * (invariant #3), but a `logger.error(err)` / `logger.warn(...)` call goes
 * *around* every serialiser this system has. A log line is not a buyer-facing
 * surface, but it is still a surface, and it is the one this class controls
 * directly. When mapping an SDK error to one of `./execution.errors`, the raw
 * `err.message` is never interpolated into a log line — the API's error body
 * can echo back fragments of the request that produced it (see
 * `referencesOutputSchema` below), so only the error's class name and HTTP
 * status are logged. `err.message` is still attached as `cause` on the thrown
 * `ExecutionError` for local debugging (per that module's own warning, never
 * read by anything that reaches a buyer) — it is excluded from logs
 * specifically, not from the thrown error.
 */
@Injectable()
export class ClaudeAgentRunner extends AgentRunner {
  private readonly logger = new Logger(ClaudeAgentRunner.name);
  private readonly client: Anthropic;

  constructor(config: ConfigService<AppConfig, true>) {
    super();
    this.client = new Anthropic({
      apiKey: config.get('ANTHROPIC_API_KEY', { infer: true }),
    });
  }

  async run(request: AgentRunRequest): Promise<AgentRunOutcome> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), request.timeoutMs);
    const startedAt = Date.now();
    let durationMs: number | null = null;

    try {
      const response = await this.client.messages.create(
        {
          model: request.model,
          max_tokens: AGENT_MAX_OUTPUT_TOKENS,
          system: request.systemPrompt,
          messages: [{ role: 'user', content: JSON.stringify(request.input) }],
          output_config: {
            format: { type: 'json_schema', schema: request.outputSchema },
          },
        },
        {
          timeout: request.timeoutMs,
          maxRetries: 0,
          signal: controller.signal,
        },
      );

      durationMs = Date.now() - startedAt;
      const outcome = this.buildOutcome(response, request, durationMs);
      this.logger.log(
        `order=${request.orderId} model=${request.model} duration_ms=${durationMs} result=ok`,
      );
      return outcome;
    } catch (err) {
      durationMs ??= Date.now() - startedAt;
      const mapped = this.toExecutionError(err, request);
      this.logger.warn(
        `order=${request.orderId} model=${request.model} duration_ms=${durationMs} result=failed kind=${mapped.name}`,
      );
      throw mapped;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Turn a successful HTTP response into an `AgentRunOutcome` — or throw
   * `AgentRunFailedError` when "successful HTTP response" did not mean
   * "usable result" (refusal, truncation, or unparseable content).
   *
   * ⚠️ `stop_reason` is checked BEFORE any `content` block is read — see the
   * class header. Only after both checks pass does this method iterate
   * `content`: it takes the `text` blocks, tries to `JSON.parse` each one,
   * and treats the first block that parses to a non-null, non-array object as
   * the structured output (`request.outputSchema` is what constrained the
   * model to emit it in the first place — this method does not re-validate
   * against that schema; that is `ExecutionService`'s job to RECORD, per
   * `agent-runner.ts`'s "What the runner never does"). Any other text block —
   * in practice there is usually none — is assistant prose, joined with
   * newlines into `assistantText`.
   */
  private buildOutcome(
    response: Anthropic.Message,
    request: AgentRunRequest,
    durationMs: number,
  ): AgentRunOutcome {
    if (response.stop_reason === 'refusal') {
      throw new AgentRunFailedError(
        `Model refused the request for order ${request.orderId}`,
        request.orderId,
      );
    }
    if (response.stop_reason === 'max_tokens') {
      throw new AgentRunFailedError(
        `Model output for order ${request.orderId} was truncated at the token ceiling`,
        request.orderId,
      );
    }

    let output: Record<string, unknown> | null = null;
    const prose: string[] = [];

    for (const block of response.content) {
      if (block.type !== 'text') continue;
      const parsed: Record<string, unknown> | null =
        output === null ? parseStructuredObject(block.text) : null;
      if (parsed !== null) {
        output = parsed;
      } else {
        prose.push(block.text);
      }
    }

    if (output === null) {
      throw new AgentRunFailedError(
        `Model response for order ${request.orderId} contained no parseable structured output`,
        request.orderId,
      );
    }

    return {
      output,
      assistantText: prose.length > 0 ? prose.join('\n') : null,
      durationMs,
    };
  }

  /**
   * Map anything thrown out of the try block — an SDK error, or an
   * `AgentRunFailedError` this class already threw from `buildOutcome` — to
   * the `ExecutionError` the port promises. `run()` is the only caller and it
   * always rethrows what this returns; this method never throws itself so
   * that `run()`'s single `catch` block always has exactly one error to log
   * and rethrow.
   *
   * Order matters: `APIUserAbortError` and `APIConnectionTimeoutError` are
   * checked before the generic `Anthropic.APIError`, because both extend it
   * (directly, and via `APIConnectionError`, respectively) and would
   * otherwise be swallowed by the broader check first. Likewise
   * `BadRequestError` is checked before the generic fallback.
   */
  private toExecutionError(err: unknown, request: AgentRunRequest): ExecutionError {
    if (err instanceof ExecutionError) {
      return err;
    }

    const timeoutSeconds = request.timeoutMs / 1000;

    if (err instanceof Anthropic.APIUserAbortError || err instanceof Anthropic.APIConnectionTimeoutError) {
      return new AgentTimeoutError(
        `Agent run for order ${request.orderId} exceeded its ${timeoutSeconds}s timeout`,
        request.orderId,
        timeoutSeconds,
        err,
      );
    }

    if (err instanceof Anthropic.BadRequestError) {
      if (referencesOutputSchema(err.message)) {
        return new DefinitionUnusableError(
          `The Anthropic API rejected the output schema for order ${request.orderId}`,
          request.orderId,
          'outputSchema',
          err,
        );
      }
      return new AgentRunFailedError(
        `Anthropic API rejected the request for order ${request.orderId}`,
        request.orderId,
        err,
      );
    }

    if (err instanceof Anthropic.APIError) {
      return new AgentRunFailedError(
        `Anthropic API call failed for order ${request.orderId}`,
        request.orderId,
        err,
      );
    }

    // Anything else escaping the try block — a bug in this class, an
    // unrecognised JS error — still has to become a legitimate,
    // evidence-producing outcome rather than crash the poller
    // (`agent-runner.md`: "the service treats an unexpected throw as
    // `AgentRunFailedError`"; this class applies that same rule one layer
    // earlier, at its own boundary).
    return new AgentRunFailedError(
      `Agent run for order ${request.orderId} failed for an unrecognised reason`,
      request.orderId,
      err,
    );
  }
}

/**
 * `JSON.parse` a text block and accept it only if it is an object — never
 * `null`, never an array, never a bare string/number/boolean. Structured
 * output under a JSON Schema of `type: "object"` (which is what every seller
 * definition's `output_schema` must be, per the catalogue's own validation)
 * always parses to a plain object; anything else parsing successfully here
 * would be a coincidence, not the structured output.
 */
function parseStructuredObject(text: string): Record<string, unknown> | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null;
  }
  return parsed as Record<string, unknown>;
}

/**
 * Best-effort classification of a `BadRequestError`'s message as "the API
 * refused `outputSchema` itself" vs. "the request failed for some other
 * reason".
 *
 * Takes the already-extracted `message` string rather than the error object
 * itself for a second, unrelated reason beyond keeping the signature narrow:
 * the SDK's `declare namespace Anthropic { ... }` re-exports names like
 * `BadRequestError` and `AuthenticationError` as TYPE ALIASES for the API's
 * wire-format error *bodies* (`resources/shared.ts`), not for the thrown
 * exception classes of the same name — so `Anthropic.BadRequestError` only
 * resolves correctly as a VALUE (`instanceof Anthropic.BadRequestError`,
 * used in `toExecutionError` above), never as a type annotation. Accepting a
 * plain `string` here sidesteps that landmine entirely instead of importing
 * the exception class under a second name just to type one parameter.
 *
 * ⚠️ Reads `message` for classification ONLY — the result is a boolean,
 * never logged, never echoed into the thrown error's own message (see the
 * class header's logging discipline). The Anthropic SDK builds a
 * `BadRequestError`'s `message` as `${status} ${JSON.stringify(responseBody)}`,
 * so a schema-related 400 reliably mentions the request field that was
 * rejected.
 */
function referencesOutputSchema(message: string): boolean {
  return /output_config|json_schema|output schema/i.test(message);
}
