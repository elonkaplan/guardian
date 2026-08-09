import { VerdictTier } from '../entities/enums';
import type { GuardianCaseFile } from './case-file-assembler';

/**
 * `Auditor` — the port that separates *judging a dispute* from *recording the
 * ruling*. `GuardianService` depends on this abstract class and nothing else;
 * it cannot tell which implementation it was given, and there is only ever one.
 *
 * ## The contract
 *
 * An implementation either returns a complete, validated `AuditOutcome` or
 * throws an `AuditFailedError` from `./guardian.errors`. There is no third
 * result. There is no partial outcome, no nullable field a caller might forget
 * to check, and no "close enough" — a verdict moves money and is final, so a
 * truncated, refused, or abandoned response is discarded rather than salvaged.
 * Every gate in `verdict-schema.md` §5 collapses to the same thing at this
 * boundary: nothing comes back. `GuardianService` catches it, writes nothing,
 * leaves the order `disputed`, and the next poller tick tries again (FR-017),
 * bounded at three attempts.
 *
 * ## Why a port at all — given there is no second implementation, and must
 * never be one
 *
 * This is the deliberate opposite of `execution/agent-runner.ts`, and the
 * difference is worth stating rather than leaving to be inferred from an
 * absence. That port exists so `ScriptedAgentRunner` can substitute for
 * `ClaudeAgentRunner` and make the demo reproducible. **`FR-041` forbids the
 * equivalent here**: no mechanism — no fixture, no configuration, no
 * environment mode — may supply a pre-determined ruling that bypasses the
 * auditor.
 *
 * The seam in execution is safe because it substitutes the thing being
 * **judged**. A seam here would substitute the **judgment**, which is the
 * single claim the product makes. So this port exists for dependency inversion
 * and for the testability of the *service* — a test can hand `GuardianService`
 * a stub that throws, to exercise the retry path, without that stub ever being
 * reachable from a running deployment. It does not exist to admit a second
 * implementation, and a `ScriptedAuditor` wired into a module is the defect
 * this comment is here to name.
 *
 * Reproducibility on stage comes from somewhere else entirely: the first
 * ruling is recorded and replayed (invariant #8), and the seeded case files are
 * unambiguous.
 *
 * ## Why `abstract class`, not an interface plus an injection symbol
 *
 * Nest can use an abstract class as its own injection token, keeping the wiring
 * to `{ provide: Auditor, useClass: ClaudeAuditor }` and keeping the token from
 * drifting out of sync with the type — the failure mode of a hand-rolled
 * `Symbol` declared next to, rather than as, the contract it identifies. The
 * same argument as `AgentRunner`, for the same reason.
 *
 * ## ⚠️ What the auditor NEVER does
 *
 * **It never persists anything.** Not the verdict, not the attempt count, not a
 * failure marker. `GuardianService` owns every write. The auditor receives a
 * request and returns or throws — nothing else about it is observable from
 * outside.
 *
 * **It never retries.** The SDK client is constructed with `maxRetries: 0`. The
 * poller is the retry, it is visible, and it is bounded at three attempts. An
 * audit is the one operation in the product that is *supposed* to happen once
 * (product §4.4), so retry logic buried in an HTTP client is the wrong place
 * for it: a client-level retry is invisible to the attempt bound, and would
 * quietly turn "decided once" into "decided as many times as the transport felt
 * like".
 *
 * **It never decides whether the outcome is acceptable.** Whether a citation is
 * traceable to the clause it names, whether the non-delivery floor holds,
 * whether the reasoning reproduced the seller's prompt — all of that is
 * `verdict-validation.ts`'s job. This port's contract is narrower and stated in
 * one line: *a structurally valid outcome, or throw*. Widening it would put the
 * product's rules in the same class as its transport, where a substituted
 * implementation could omit them.
 *
 * **It never computes the verdict hash or the refund amount.** The hash is
 * computed exactly once, downstream, over the stored row (R5); the refund is
 * derived from the tier by `refund.ts`. Neither is an input the model has any
 * business influencing.
 *
 * ## ⚠️ LOGGING DISCIPLINE — read this before writing a single log line
 *
 * This is the strongest warning in the file, and it is stronger here than
 * almost anywhere else in the codebase, because both ends of this port carry
 * text that must not be reproduced.
 *
 * **On the way in:** `AuditRequest.caseFile` contains the seller's
 * `system_prompt` **verbatim** — `agent-definition.md` §4 puts it there
 * deliberately, because the auditor needs it to tell *"tried hard, the task was
 * impossible"* from *"returned a stub without trying"* — together with the raw
 * execution trace, including each step's model-authored `reasoning`.
 *
 * **On the way out:** `AuditOutcome.reasoning` and every `citations[].quote`
 * are returned to the BUYER verbatim by `GET /orders/:id/verdict`, through no
 * serialiser at all. This is the only buyer-facing text in the product with
 * that property (FR-037).
 *
 * Therefore an implementation logs the **order id**, the **model**, the
 * **duration**, and the **failure class**. It **never** logs the case file, the
 * request body, the response body, or the returned reasoning. `logger.error(err)`
 * on a caught object goes *around* every serialiser this codebase has — the
 * redactions elsewhere are all on response paths, and none of them stands
 * between a thrown error and a log sink.
 *
 * When mapping an SDK error, log its **class name and HTTP status only**: the
 * API's error body can echo fragments of the request that produced it, and the
 * request here is the case file. The raw message stays attached as `cause` on
 * the thrown `AuditFailedError`, where local debugging can reach it and a log
 * shipper cannot.
 */
export interface AuditRequest {
  /**
   * `orders.id`. For error attribution and log lines only — the auditor never
   * uses it to look anything up, touch the database, or branch behaviour. It
   * exists so a thrown `AuditFailedError` and a `ClaudeAuditor` log line can
   * name which dispute they belong to without reaching back into `orders`,
   * which this port must never do.
   *
   * It is also, along with the model and the duration, one of the few things
   * that may appear in a log line at all — see the logging discipline above.
   */
  readonly orderId: string;
  /**
   * Everything the auditor is shown for one dispute, assembled by
   * `case-file-assembler.ts` and serialised as the entire user turn.
   *
   * ⚠️ **This field carries the seller's `systemPrompt` verbatim and the raw
   * run trace with each step's `reasoning`.** It is never logged, never echoed
   * into an error message, and never returned from a controller. It is
   * assembled, serialised into one model request, and discarded.
   */
  readonly caseFile: GuardianCaseFile;
  /**
   * `GUARDIAN_AUDIT_TIMEOUT_MS`, the deadline for the whole audit. Armed as
   * both the SDK `timeout` option and an `AbortController` on the same instant
   * (R14), because either alone leaves a way for the call to outlive it.
   *
   * A bound is required rather than optional because one audit occupies the
   * worker's only slot: an unbounded call does not merely lose this dispute, it
   * prevents every later dispute from being decided (SC-012).
   */
  readonly timeoutMs: number;
}

/** One clause the ruling rests on. Never a step and never the system prompt. */
export interface Citation {
  /**
   * Which yardstick the quote came from. The enum is enforced on the wire
   * (FR-010), and that is a structural guarantee rather than a convenience:
   * because neither the system prompt nor a step is a citable source, a quote
   * carrying prompt text has nowhere to claim it came from and would fail
   * traceability anyway (`guardian-case-file.md` §6).
   */
  readonly source: 'capability' | 'exclusion' | 'criterion';
  /**
   * The clause text as the model reproduced it.
   *
   * ⚠️ Buyer-facing verbatim. Stored unmodified — no trimming, no reordering,
   * no normalisation — because the stored row must be the ruling that was made.
   * The normalisation `verdict-validation.ts` performs is for *comparison* and
   * is never written back.
   */
  readonly quote: string;
  /** Whether this clause was satisfied. The model's finding, not a derivation. */
  readonly met: boolean;
}

export interface AuditOutcome {
  /**
   * The refund tier, already mapped from the wire's percentage string through
   * the exhaustive table in `verdict.schema.ts` — never cast. A tier silently
   * shifted by one produces a real, wrong refund percentage, and nothing about
   * the mistake looks wrong until someone is watching the number land.
   */
  readonly tier: VerdictTier;
  /**
   * The model's explanation of the ruling.
   *
   * ⚠️ MODEL PROSE, and the single most dangerous string in this feature. It
   * reaches the buyer verbatim through no serialiser, and it is the one field
   * free enough to reproduce the seller's prompt — which is why it, and only
   * it, is what the leak check reads. Never logged.
   */
  readonly reasoning: string;
  /**
   * The clauses the ruling rests on, in the model's order. Never empty — the
   * wire schema's `minItems: 1` survives the transform, so a zero-citation
   * ruling is not representable rather than merely rejected.
   */
  readonly citations: Citation[];
  /**
   * The model that produced this ruling, recorded per-verdict (FR-016) so a
   * stored row always says what judged it even after `GUARDIAN_MODEL` changes.
   */
  readonly model: string;
  /** Wall clock for the audit call alone. Loggable, unlike everything above. */
  readonly durationMs: number;
}

export abstract class Auditor {
  abstract audit(request: AuditRequest): Promise<AuditOutcome>;
}
