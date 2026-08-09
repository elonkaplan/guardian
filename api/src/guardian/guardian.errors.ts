import { VerdictTier } from '../entities/enums';

/**
 * Errors thrown by `ClaudeAuditor` and `verdict-validation.ts`, and caught by
 * `GuardianService` (contract `verdict-schema.md` §5, "The gates, in order";
 * research R7).
 *
 * One class per gate, in gate order. **None of them produces a partial verdict,
 * and none of them is repaired** — a gate that fires ends the audit, and the
 * ruling the model produced is discarded rather than trimmed, re-prompted, or
 * patched into something storable.
 *
 * ⚠️ **These are never mapped to an HTTP status, and never will be.** That
 * warning is inherited from `execution/execution.errors.ts`, but it needs a
 * longer argument here, because unlike that module `src/guardian/` *does* have a
 * controller — `GET /orders/:id/verdict`. The point is that **no route is
 * downstream of the audit pipeline**: the audit runs in a poller (research R1),
 * on its own tick, with no request waiting on it. So this module has two error
 * families that must never be mixed:
 *
 * - **audit-path errors — this file.** Caught inside `GuardianService`, turned
 *   into a counter increment, and never rendered into a response body. Nothing
 *   is holding a socket open while one of these is thrown.
 * - **read-path errors — a separate concern.** The controller's own 404 (no
 *   verdict yet) and 409 (order not in a state that has one) are plain
 *   `HttpException`s raised on the request path and have nothing to do with the
 *   classes below.
 *
 * Do not add an `HttpException` mapping for the classes in this file on the
 * assumption one is missing because the module has a controller: none is
 * missing, and none belongs. A verdict-audit failure the buyer can see is
 * FR-044's audit-failed body, which the read path derives from
 * `orders.audit_failed_at` — not from an exception that was thrown minutes
 * earlier in a background tick.
 *
 * **What `GuardianService` actually does with one of these**, uniformly, for
 * every subclass below (research R7, R14):
 *
 * 1. **Writes nothing.** No `verdicts` row, no placeholder, no marker.
 *    `verdicts.order_id` is UNIQUE and a marker row would consume the one slot,
 *    permanently blocking the real verdict — the *absence* of a row is already
 *    the marker (invariant #8).
 * 2. **Increments `orders.audit_attempts`.**
 * 3. **Leaves the order `disputed`**, where the poller's audit-pending pass
 *    finds it again on the next tick.
 * 4. **On the attempt that reaches `GUARDIAN_MAX_AUDIT_ATTEMPTS` (3), stamps
 *    `orders.audit_failed_at`** and stops retrying. The order is still
 *    `disputed` — the dispute is real and unresolved; what failed is our ability
 *    to rule on it — and the escrowed money waits for the contract's own 72-hour
 *    `forceResolve` deadline rather than being freed by a ruling nobody made.
 *
 * **Retrying is not re-auditing.** Invariant #8 refuses to re-audit an order
 * *that already has a verdict*; a failed audit persisted none, so nothing was
 * decided and nothing is being reopened. `verdicts.order_id UNIQUE` remains the
 * guarantee that a *decided* order is never judged twice.
 */
export type AuditFailureReason =
  | 'refused'
  | 'truncated'
  | 'unusable'
  | 'untraceable_citation'
  | 'non_delivery_floor'
  | 'prompt_leak'
  | 'timeout'
  | 'unavailable';

export abstract class AuditFailedError extends Error {
  /**
   * The typed discriminant, one member per gate.
   *
   * It exists so that `GuardianService`'s catch block — which does the *same*
   * four things for every subclass and differs only in what it logs — can name
   * the failure with `err.reason` instead of an `instanceof` ladder that has to
   * be extended, in the right order, every time a gate is added. A ninth gate
   * that forgets to widen this union fails to compile; a ninth gate that a
   * ladder forgets falls through to a generic branch and is logged as the wrong
   * thing, which is the failure mode that makes a rehearsal log useless.
   *
   * It is also exactly what `verdict-schema.md` §6 permits a log line to carry:
   * the failure class, and nothing from the case file or the response.
   */
  abstract readonly reason: AuditFailureReason;

  /**
   * ⚠️ **The `message` must never be constructed from the case file, the
   * request body, the response body, or `reasoning`.**
   *
   * `execution/execution.errors.ts` makes the same demand and the argument runs
   * one step further here. There, a message eventually landed in `runs.error` —
   * a column the case-file serialiser redacts on the way out to a buyer, so the
   * string had at least one safe destination. **Here it has none**, because a
   * failed audit persists nothing at all. The only place one of these strings
   * ever lands is a log line, and a `logger.error(err)` goes *around* every
   * serialiser this codebase has.
   *
   * And the input is worse. The case file this module is handed contains the
   * seller's `system_prompt` **verbatim** — that is deliberate (research R6: the
   * auditor needs it to tell "tried hard, task was impossible" from "returned a
   * stub without trying"), and the whole containment for it is that the prompt
   * never leaves this pipeline in any text a human reads. Building a message
   * from `caseFile`, from `error.response.data`, or from the ruling's own
   * `reasoning` walks the prompt straight out through the log, which is the
   * mistake this class exists to make awkward.
   *
   * Every subclass below therefore takes its identifying fields as **separate,
   * typed properties**, precisely so the message string never has to carry them:
   * a caller that wants to know which citation, which tier, or which deadline
   * reads a property rather than parsing prose. `verdict-schema.md` §6 states
   * the positive rule — a log line carries the order id, the model, the
   * duration, and the failure class, and nothing else. When mapping an SDK
   * error, log its class name and HTTP status only; the API's error body can
   * echo fragments of the request that produced it. The raw thing stays attached
   * as `cause` for local debugging and reaches no buyer, no seller, and no
   * response body.
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
 * Gate 1 — the auditor declined to rule. `response.stop_reason === 'refusal'`.
 *
 * ⚠️ **This arrives as an HTTP 200, not as a thrown SDK error**, which is the
 * whole reason the gate is written down rather than left to the transport
 * branch. A refusal is a normal successful response with an empty or partial
 * `content` array and a `stop_details.category`. It is checked **before any
 * content block is read**: code that indexes `content[0]` unconditionally throws
 * on `undefined` and reports "the audit crashed" for what is really "the auditor
 * declined." `claude-agent-runner.ts` learned this one feature earlier and its
 * `buildOutcome` orders its checks the same way.
 *
 * This is not a rare-and-theoretical branch here. Opus 5 ships elevated safety
 * classifiers, and this feature feeds it buyer-authored complaint prose and
 * seller-authored listing text, neither of which the platform controls — a
 * dispute over, say, a security-scanning agent is exactly the benign-but-adjacent
 * case that trips one.
 *
 * `category` is the refusal category the API reported, carried as an optional
 * typed property because the SDK does not promise one on every refusal. It is
 * safe to log: it is a classifier label, not case-file content.
 *
 * ⚠️ **Never re-prompt with softened text.** Re-asking a declined audit until it
 * answers differently is precisely what "verdicts are final" forbids, and it
 * would be doing it before the first verdict even existed (research R7,
 * alternatives rejected). The retry is the poller's, it is bounded at three, and
 * it re-sends the same case file.
 *
 * **Outcome**: nothing written, `orders.audit_attempts` incremented, order left
 * `disputed`. A refusal that reproduces on all three attempts is the exact case
 * `orders.audit_failed_at` was added to make visible.
 */
export class AuditorRefusedError extends AuditFailedError {
  readonly reason = 'refused';

  constructor(
    message: string,
    orderId: string,
    public readonly category?: string,
    cause?: unknown,
  ) {
    super(message, orderId, cause);
  }
}

/**
 * Gate 2 — the auditor ran out of tokens mid-ruling.
 * `response.stop_reason === 'max_tokens'`.
 *
 * ⚠️ **Thinking is on by default on Opus 5, and `max_tokens` bounds thinking and
 * output *together*.** Omitting the `thinking` parameter runs adaptive, unlike
 * Opus 4.8 where omitting it meant none — so a ceiling sized to the visible
 * verdict alone truncates during reasoning and never reaches the tier at all.
 * The symptom of `GUARDIAN_MAX_OUTPUT_TOKENS` being too low is therefore not a
 * short verdict; it is a dispute that never gets decided, three times, and then
 * an audit-failed stamp.
 *
 * Like gate 1, checked before any content block is read. Whatever partial
 * ruling arrived is **discarded, not salvaged** — a truncated ruling may have
 * chosen a tier before it finished weighing the clause that would have changed
 * it, and a verdict is replayed forever (invariant #8). There is no "close
 * enough" for a refund percentage.
 *
 * `maxTokens` is carried as the ceiling that was actually sent, so a rehearsal
 * log can say which number needs raising without the case file being anywhere
 * near the message.
 *
 * **Outcome**: nothing written, attempt counted, order left `disputed`.
 */
export class AuditorTruncatedError extends AuditFailedError {
  readonly reason = 'truncated';

  constructor(
    message: string,
    orderId: string,
    public readonly maxTokens: number,
    cause?: unknown,
  ) {
    super(message, orderId, cause);
  }
}

/**
 * Gate 3 — the response came back whole but could not be decoded into a ruling:
 * `response.parsed_output === null`, or the SDK's parse threw.
 *
 * ⚠️ **The parse failure surfaces as `AnthropicError`, not `ZodError`.** The
 * SDK's `zodOutputFormat` helper catches Zod's error and rewraps it with
 * formatted issues, so a `catch` narrowed on `ZodError` silently matches nothing
 * and the real failure escapes to gate 8 as an unrecognised throw. Catch the
 * SDK's type. (`verdict-schema.md` §2, consequence 2; research R3.)
 *
 * ⚠️ **`parsed_output` may be `null` on an otherwise successful response**, so
 * it is checked rather than dereferenced. That is a separate branch from the
 * throw, and both land here because a caller three layers up has no use for
 * which of the two produced no ruling.
 *
 * This gate is about **shape only**. The citation count is *not* enforced here:
 * `.min(1)` survives `transformJSONSchema` as `minItems: 1` and is enforced on
 * the wire, so a zero-citation ruling is not representable and never reaches
 * this code (`verdict-schema.md` §2 — read the transform, not the general rule
 * about dropped constraints). Nor are the two enums, which the API enforces the
 * same way; a tier of `'37'` cannot come back.
 *
 * **Outcome**: nothing written, attempt counted, order left `disputed`. The
 * underlying `AnthropicError` is attached as `cause` and, per the base class,
 * neither it nor the message is unpacked into prose — its formatted issues can
 * quote the response.
 */
export class UnusableVerdictError extends AuditFailedError {
  readonly reason = 'unusable';

  constructor(message: string, orderId: string, cause?: unknown) {
    super(message, orderId, cause);
  }
}

/**
 * Gate 4 — a citation's `quote` could not be traced to a clause of the kind its
 * `source` names (FR-012, `verdict-schema.md` §4, research R4).
 *
 * The check is a normalised-substring containment —
 * `casefold(collapse_whitespace(trim(s)))`, then "does the quote occur inside
 * any clause of that kind" — matched against `capabilities`, `exclusions`, or
 * the single `acceptanceCriteria` string according to `source`. Substring rather
 * than equality because a citation legitimately quotes one sentence of a
 * multi-sentence criterion, and normalised rather than raw because a model
 * reproducing a clause across a line wrap is quoting faithfully.
 *
 * ⚠️ **One bad citation fails the whole audit; it is not dropped and the verdict
 * is not repaired.** Editing a ruling makes the stored verdict differ from the
 * one that was made, which breaks the replay property invariant #8 exists to
 * provide — and the surviving `reasoning` may still argue from the citation that
 * was quietly removed, producing a ruling that cites evidence the record no
 * longer contains.
 *
 * `source` and `index` are carried as typed properties so a rehearsal can be
 * told *which* citation failed without the quote — the disputed text itself —
 * appearing anywhere in the message or the log. `index` is the position in the
 * model's own `citations` array, which is the order the verdict would have been
 * stored in.
 *
 * **Outcome**: nothing written, attempt counted, order left `disputed`. Worth
 * knowing during a rehearsal: this gate firing repeatedly usually means the
 * rubric or the case file is ambiguous, not that the model is malfunctioning.
 */
export class UntraceableCitationError extends AuditFailedError {
  readonly reason = 'untraceable_citation';

  constructor(
    message: string,
    orderId: string,
    public readonly source: 'capability' | 'exclusion' | 'criterion',
    public readonly index: number,
    cause?: unknown,
  ) {
    super(message, orderId, cause);
  }
}

/**
 * Gate 5 — the case file reported `delivered: false` and the ruling came back at
 * a tier below `full` (FR-014, `verdict-schema.md` §5, research R10).
 *
 * **This is an assertion, not an override, and the distinction is the point.**
 * Nothing short-circuits: an order with `runs.output IS NULL` goes through the
 * same audit as any other, with the absence stated explicitly in the case file
 * and named in the rubric as the full-refund case, because a code path that
 * writes `tier: full` without a model call produces a verdict with no reasoning
 * and no citations — the bare, uncited tier FR-011 forbids and the entire
 * feature exists to avoid.
 *
 * ⚠️ **Overriding the tier instead of failing would ship a self-contradicting
 * verdict** — a `full` tier paired with reasoning arguing for something else,
 * permanent (`verdicts.order_id` is UNIQUE) and rendered side by side on the
 * verdict screen. A failed audit is retried and stays visible; a verdict that
 * disagrees with itself looks like a bug in the product's core claim.
 *
 * The assertion is expected never to fire — `runs.output IS NULL` is unambiguous
 * evidence and the rubric states the rule — which is exactly why it is worth
 * having: it is a floor under the one number an audience watches land.
 *
 * `tier` carries the offending ruling as the database vocabulary
 * (`VerdictTier`), i.e. after the wire enum has been mapped through
 * `VERDICT_TIER_BY_WIRE`, so a log line reads `quarter` rather than `'25'` and
 * matches the word every other module uses.
 *
 * **Outcome**: nothing written, attempt counted, order left `disputed`.
 */
export class NonDeliveryFloorError extends AuditFailedError {
  readonly reason = 'non_delivery_floor';

  constructor(
    message: string,
    orderId: string,
    public readonly tier: VerdictTier,
    cause?: unknown,
  ) {
    super(message, orderId, cause);
  }
}

/**
 * Gate 7 — the ruling's `reasoning` reproduced a verbatim run of at least
 * `runWords` consecutive normalised words from the seller's `system_prompt`
 * (FR-042, research R13).
 *
 * ⚠️ **CRITICAL: neither the message nor any property on this class ever carries
 * the matched text.** `runWords` is the configured run length and that is the
 * whole of what is recorded. This class is thrown *because* a fragment of the
 * seller's prompt appeared somewhere it should not have; putting that fragment
 * into an error message — or into a property "for debugging" — reproduces the
 * leak in the log, which is a destination with no serialiser in front of it and
 * a longer retention than the ruling would have had. The offending `reasoning`
 * is discarded with the rest of the ruling and is not attached as `cause`
 * either. If a rehearsal needs to know what leaked, it re-runs the audit and
 * inspects it in a debugger; it does not learn it from an exception.
 *
 * **This gate is the containment for showing the auditor the seller's prompt at
 * all.** `docs/agent-definition.md` §4 puts the prompt in the case file — the
 * auditor needs it to tell "tried hard, task was impossible" from "returned a
 * stub without trying" — and states the rule as an instruction to the model:
 * *"Guardian's reasoning may describe execution behaviour … but must never quote
 * the prompt."* An instruction is the wrong enforcement mechanism when the text
 * it governs is model output that reaches the buyer with nothing in between, so
 * the rule became a check on the way to storage. §4's requirement is unchanged;
 * only its enforcement is.
 *
 * **It reads `reasoning` only, and that is structural rather than an oversight.**
 * A citation's `source` is an enum of `capability | exclusion | criterion`
 * enforced on the wire, so the prompt is not a citable source — and a `quote`
 * that did carry prompt text would already have failed gate 4, because it would
 * not be found in any capability, exclusion, or criterion.
 *
 * ⚠️ **Paraphrase is deliberately not covered.** §4 explicitly permits reasoning
 * that describes execution behaviour, and its own example — *"the agent made one
 * extraction attempt and stopped"* — is a paraphrase of what the prompt
 * instructed. A detector that caught paraphrase would reject the sentences the
 * product doc holds up as correct. What is closed structurally is the
 * **verbatim** path: the one that leaks the seller's actual words, and the one a
 * seller would recognise on sight.
 *
 * **Outcome**: nothing written, attempt counted, order left `disputed`. Rejecting
 * before the write is the point — the leaked text never exists in the database,
 * never reaches the seller's copy, and no later read has to filter for it.
 */
export class PromptLeakError extends AuditFailedError {
  readonly reason = 'prompt_leak';

  constructor(
    message: string,
    orderId: string,
    public readonly runWords: number,
    cause?: unknown,
  ) {
    super(message, orderId, cause);
  }
}

/**
 * Gate 6 — the audit exceeded `GUARDIAN_AUDIT_TIMEOUT_MS` (research R14).
 *
 * **Armed twice**, as the SDK's `timeout` request option and as an
 * `AbortController` on the same deadline — the two-timer construction
 * `claude-agent-runner.ts` already uses, for the same reason: the first bounds
 * the HTTP request, the second bounds the whole call including whatever the SDK
 * does around it. Whichever timer wins, this same class is thrown; the two
 * triggers are not distinguished because no caller has a use for which one fired.
 *
 * ⚠️ **The deadline exists because one audit occupies the worker's only slot.**
 * An unbounded call does not merely lose one dispute — it stops every *later*
 * dispute from being decided, because the poller's next tick never gets to run
 * (SC-012). That makes this the one gate whose absence turns a single failure
 * into a stalled product.
 *
 * Whatever the model had produced by the deadline is discarded, not salvaged,
 * for the same reason as truncation: a ruling that did not finish is not a
 * ruling, and it would be replayed forever if it were stored.
 *
 * `timeoutMs` is the deadline that was actually armed, carried so a log can name
 * it without a lookup.
 *
 * **Outcome**: nothing written, attempt counted, order left `disputed`. Note
 * that three timeouts at the default 180 000 ms is nine minutes of wall clock
 * before `audit_failed_at` is stamped — the bound is on attempts, not on total
 * elapsed time.
 */
export class AuditTimeoutError extends AuditFailedError {
  readonly reason = 'timeout';

  constructor(
    message: string,
    orderId: string,
    public readonly timeoutMs: number,
    cause?: unknown,
  ) {
    super(message, orderId, cause);
  }
}

/**
 * Gate 8 — the auditor could not be reached or could not be made to answer: an
 * `Anthropic.APIError` at the transport or API level (rate limit, invalid
 * credentials, 5xx), an abort, or anything else that escapes the runner.
 *
 * **This is also the class thrown *on behalf of* an unrecognised throw.** An
 * exception that escapes `ClaudeAuditor` uncategorised would reach the poller
 * and kill the tick, leaving the order `disputed` with its attempt counter
 * *not* incremented — which is the one failure shape that never terminates,
 * because the bound in R14 counts attempts and an uncounted attempt is
 * invisible to it. Folding the unknown throw into this class keeps the counter
 * honest and keeps the poller alive for every other dispute waiting behind it.
 * `execution/execution.errors.ts` folds unrecognised throws into
 * `AgentRunFailedError` for the same structural reason.
 *
 * ⚠️ **`maxRetries: 0` on the SDK client is load-bearing, not tidiness.** An
 * audit is the one operation in the product that is supposed to happen exactly
 * once, and retry logic buried in an HTTP client is the wrong place for anything
 * with that property — it would make the recorded duration a lie and spend three
 * model calls where the record says one. The retry is the poller's: it is
 * visible, its interval is configured, and it is bounded at three.
 *
 * `cause` carries the underlying SDK error for local debugging. ⚠️ Per the base
 * class, it is not unpacked into the message and not logged in full: when
 * mapping an SDK error, log its class name and HTTP status only, because the
 * API's error body can echo fragments of the request that produced it — and the
 * request that produced it contains the seller's system prompt
 * (`verdict-schema.md` §6).
 *
 * **Outcome**: nothing written, attempt counted, order left `disputed`. This is
 * the gate the three-attempt bound was mostly sized for: a transient rate limit
 * should not terminate a dispute, and three attempts at a two-second poll
 * interval clears one comfortably.
 */
export class AuditorUnavailableError extends AuditFailedError {
  readonly reason = 'unavailable';

  constructor(message: string, orderId: string, cause?: unknown) {
    super(message, orderId, cause);
  }
}
