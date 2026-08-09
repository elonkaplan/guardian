import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';

import type { AppConfig } from '../config/env.schema';
import { Auditor, type AuditOutcome, type AuditRequest } from './auditor';
import {
  GUARDIAN_MAX_OUTPUT_TOKENS,
  GUARDIAN_MODEL,
} from './guardian.constants';
import {
  AuditorRefusedError,
  AuditorTruncatedError,
  AuditorUnavailableError,
  AuditTimeoutError,
  UnusableVerdictError,
} from './guardian.errors';
import { GUARDIAN_SYSTEM_PROMPT } from './verdict-prompt';
import { VerdictSchema, toVerdictTier } from './verdict.schema';

/**
 * The real {@link Auditor}. One non-streaming `messages.parse` per audit.
 *
 * ## ⚠️ The request omits three parameters, and each omission is load-bearing
 *
 * **`temperature`, `top_p`, `top_k`** — all three are **removed on Opus 5 and
 * return a 400**. Sending any of them does not degrade the audit, it ends it.
 * And the absence is not a limitation to route around: it is precisely why
 * verdicts are persisted and replayed rather than recomputed
 * (`docs/tech-stack.md` §5, invariant #8). There is no sampling control to pin,
 * so the *ruling* is pinned instead.
 *
 * **`thinking`** is deliberately not set either — on Opus 5, omitting it runs
 * adaptive thinking, which is what an audit wants. ⚠️ The consequence to
 * remember is that `max_tokens` bounds **thinking plus response text together**,
 * so a ceiling sized to the visible verdict alone truncates mid-ruling.
 *
 * ## ⚠️ `maxRetries: 0` is not tidiness
 *
 * The SDK retries 408/409/429/5xx twice by default. An audit is the one
 * operation in this product that is *supposed* to happen exactly once
 * (`docs/product-workflow.md` §4.4), and retry logic buried inside an HTTP
 * client is the wrong place for anything with that property — it would make
 * `durationMs` a lie and spend the platform's money three times without anyone
 * choosing to. `GuardianPoller` is the retry, it is visible, and it is bounded
 * at three attempts.
 *
 * ## ⚠️ LOGGING DISCIPLINE — the strictest in the codebase
 *
 * Every line this class writes carries the order id, the model, the duration and
 * the failure class. **Never** the case file, the request body, the response
 * body, or the returned reasoning.
 *
 * This matters more here than anywhere else for two reasons at once:
 * `AuditRequest.caseFile` carries the seller's `system_prompt` **verbatim** and
 * the raw execution trace, and `AuditOutcome.reasoning` is returned to the buyer
 * through no serialiser at all. A `logger.error(err)` goes around every
 * serialiser this codebase has. When mapping an SDK error, only its class name
 * and HTTP status are logged — the API's error body can echo back fragments of
 * the request that produced it.
 */
@Injectable()
export class ClaudeAuditor extends Auditor {
  private readonly logger = new Logger(ClaudeAuditor.name);
  private readonly client: Anthropic;

  constructor(config: ConfigService<AppConfig, true>) {
    super();
    this.client = new Anthropic({
      apiKey: config.get('ANTHROPIC_API_KEY', { infer: true }),
      // See the class header. The poller is the retry.
      maxRetries: 0,
    });
  }

  async audit(request: AuditRequest): Promise<AuditOutcome> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), request.timeoutMs);
    const startedAt = Date.now();
    let durationMs: number | null = null;

    try {
      const response = await this.client.messages.parse(
        {
          model: GUARDIAN_MODEL,
          max_tokens: GUARDIAN_MAX_OUTPUT_TOKENS,
          // ⚠️ The frozen prefix. `cache_control` here caches the rubric and
          // every instruction; the case file below is the only varying part, so
          // it must stay in the user turn. Any interpolation into
          // GUARDIAN_SYSTEM_PROMPT silently disables caching entirely (R8).
          system: [
            {
              type: 'text',
              text: GUARDIAN_SYSTEM_PROMPT,
              cache_control: { type: 'ephemeral' },
            },
          ],
          messages: [
            { role: 'user', content: JSON.stringify(request.caseFile) },
          ],
          output_config: { format: zodOutputFormat(VerdictSchema) },
        },
        {
          // Two timers on one deadline: this bounds the HTTP request, the
          // AbortController bounds the whole call including SDK-side work
          // around it. Whichever fires, the caller gets AuditTimeoutError.
          timeout: request.timeoutMs,
          signal: controller.signal,
        },
      );

      durationMs = Date.now() - startedAt;

      // ⚠️ stop_reason is checked BEFORE any content block is read. A refusal is
      // a normal HTTP 200 with an empty or partial `content` array — indexing
      // into it first throws on `undefined` and reports "the audit crashed" for
      // what is really "the auditor declined".
      if (response.stop_reason === 'refusal') {
        throw new AuditorRefusedError(
          `the auditor declined to rule on order ${request.orderId}`,
          request.orderId,
          response.stop_details?.category ?? undefined,
        );
      }
      if (response.stop_reason === 'max_tokens') {
        throw new AuditorTruncatedError(
          `the ruling for order ${request.orderId} was truncated at the token ceiling`,
          request.orderId,
          GUARDIAN_MAX_OUTPUT_TOKENS,
        );
      }

      const parsed = response.parsed_output;
      if (parsed === null || parsed === undefined) {
        throw new UnusableVerdictError(
          `the auditor returned no parseable ruling for order ${request.orderId}`,
          request.orderId,
        );
      }

      const outcome: AuditOutcome = {
        tier: toVerdictTier(parsed.tier),
        reasoning: parsed.reasoning,
        citations: parsed.citations.map((c) => ({
          source: c.source,
          quote: c.quote,
          met: c.met,
        })),
        model: GUARDIAN_MODEL,
        durationMs,
      };

      this.logger.log(
        `order=${request.orderId} model=${GUARDIAN_MODEL} ` +
          `duration_ms=${durationMs} result=ok tier=${outcome.tier} ` +
          `citations=${outcome.citations.length} ` +
          `cache_read=${response.usage.cache_read_input_tokens ?? 0} ` +
          `cache_write=${response.usage.cache_creation_input_tokens ?? 0}`,
      );
      return outcome;
    } catch (err: unknown) {
      durationMs ??= Date.now() - startedAt;
      const mapped = this.toAuditError(err, request);
      this.logger.warn(
        `order=${request.orderId} model=${GUARDIAN_MODEL} ` +
          `duration_ms=${durationMs} result=failed kind=${mapped.name}`,
      );
      throw mapped;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Map anything thrown out of the try block onto the error family the port
   * promises. Never throws itself, so `audit`'s single catch always has exactly
   * one error to log and rethrow.
   *
   * Order matters: `APIUserAbortError` and `APIConnectionTimeoutError` are
   * checked before the generic `Anthropic.APIError`, because both extend it and
   * would otherwise be swallowed by the broader check.
   *
   * ⚠️ `err.message` is attached as `cause` for local debugging but is never
   * interpolated into a message or a log line — see the class header.
   */
  private toAuditError(
    err: unknown,
    request: AuditRequest,
  ): AuditorRefusedError | AuditorTruncatedError | UnusableVerdictError | AuditTimeoutError | AuditorUnavailableError {
    if (
      err instanceof AuditorRefusedError ||
      err instanceof AuditorTruncatedError ||
      err instanceof UnusableVerdictError ||
      err instanceof AuditTimeoutError ||
      err instanceof AuditorUnavailableError
    ) {
      return err;
    }

    if (
      err instanceof Anthropic.APIUserAbortError ||
      err instanceof Anthropic.APIConnectionTimeoutError
    ) {
      return new AuditTimeoutError(
        `the audit of order ${request.orderId} exceeded its deadline`,
        request.orderId,
        request.timeoutMs,
        err,
      );
    }

    // The Zod parse failure arrives as AnthropicError, NOT ZodError — the
    // helper catches Zod's error and rewraps it with the formatted issues.
    // ⚠️ This is also where an off-menu tier or citation `source` lands: those
    // enums are dropped from the wire schema by the SDK's transform and survive
    // only as description text, so the client-side parse is the real gate.
    if (err instanceof Anthropic.AnthropicError && !(err instanceof Anthropic.APIError)) {
      return new UnusableVerdictError(
        `the ruling for order ${request.orderId} did not match the verdict schema`,
        request.orderId,
        err,
      );
    }

    if (err instanceof Anthropic.APIError) {
      return new AuditorUnavailableError(
        `the auditor could not be reached for order ${request.orderId}`,
        request.orderId,
        err,
      );
    }

    return new AuditorUnavailableError(
      `the audit of order ${request.orderId} failed for an unrecognised reason`,
      request.orderId,
      err,
    );
  }
}
