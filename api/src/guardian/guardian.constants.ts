import { VerdictTier } from '../entities/enums';

/**
 * The fixed values this feature uses without deriving them from a seller's
 * definition, a buyer's order, or an environment key.
 *
 * Grouping them here — rather than as literals at each call site — is what
 * makes it possible to audit every number that shapes a ruling by reading one
 * file. `src/execution/execution.constants.ts` does the same thing for the same
 * reason, and the two files should be read together: that one bounds what the
 * platform spends on a seller's agent, this one bounds what it spends judging
 * the result.
 *
 * ⚠️ **Nothing in here is an environment key, and each omission is deliberate.**
 * Two things genuinely vary by deployment and live in `env.schema.ts`
 * (`GUARDIAN_POLL_INTERVAL_MS`, `GUARDIAN_AUDIT_TIMEOUT_MS`). Everything below
 * would change the *meaning* of a verdict if a deployment could set it, which is
 * the line between configuration and a product rule.
 */

/**
 * The auditor. **Not a seller field and not an environment key.**
 *
 * `src/execution/` reads `model` from the pinned agent definition, because
 * cost/quality is the seller's call for their own agent
 * (`docs/agent-definition.md` §2.2). The auditor is the opposite: which model
 * judges a dispute is a product decision, and a deployment that could point it
 * at a cheaper model would be silently changing what a verdict is worth.
 *
 * It is nonetheless recorded per-verdict in `verdicts.model` (FR-016), so a
 * stored ruling always says what judged it even after this constant changes.
 *
 * ⚠️ **Opus 5 rejects `temperature`, `top_p` and `top_k` with a 400.** That is
 * not an inconvenience to work around — it is the reason verdicts are persisted
 * and replayed rather than recomputed (`docs/tech-stack.md` §5, invariant #8).
 * There is no sampling control to pin, so the ruling is pinned instead.
 */
export const GUARDIAN_MODEL = 'claude-opus-5';

/**
 * The `max_tokens` ceiling on the one `messages.parse` call per audit.
 *
 * ⚠️ **On Opus 5 this bounds thinking *and* response text together**, and
 * thinking is on by default — omitting the `thinking` parameter runs adaptive,
 * unlike Opus 4.8 where omitting it meant none. A ceiling sized to the visible
 * verdict alone truncates mid-ruling and surfaces as
 * `stop_reason: 'max_tokens'`, which `ClaudeAuditor` correctly treats as a
 * failed audit — so the symptom of setting this too low is not a short verdict,
 * it is a dispute that never gets decided.
 *
 * 16384 leaves room for the model to reason across a case file containing a
 * system prompt, a full run trace and an arbitrary seller-shaped output, and
 * still return a tier, prose, and a handful of citations.
 */
export const GUARDIAN_MAX_OUTPUT_TOKENS = 16_384;

/**
 * How many times a failed audit is retried before the order is marked as one
 * that could not be decided (FR-043, research R14).
 *
 * ⚠️ **A constant rather than an environment key, and that is the point.** The
 * bound exists to make an undecidable dispute *visible*; a deployment that could
 * set it to a large number would reintroduce exactly the failure it was added to
 * remove — an order resting in `disputed` forever, rendering as "Guardian is
 * reviewing…" with nothing behind it.
 *
 * Three is enough that a transient refusal or a rate limit does not terminate a
 * dispute, and few enough that a deterministically-failing case becomes visible
 * in well under a minute at the default poll interval.
 *
 * **Retrying is not re-auditing.** A failed audit persists no verdict, so
 * nothing was decided and nothing is being reopened; `verdicts.order_id UNIQUE`
 * remains the guarantee that a *decided* order is never audited again.
 */
export const GUARDIAN_MAX_AUDIT_ATTEMPTS = 3;

/**
 * The length, in consecutive normalised words, of a run from the seller's
 * `system_prompt` that must not appear in a ruling's `reasoning` (FR-042,
 * research R13).
 *
 * ⚠️ **This is the containment for showing Guardian the seller's prompt.**
 * `docs/agent-definition.md` §4 puts the prompt in the case file — the auditor
 * needs it to tell "tried hard, task was impossible" from "returned a stub
 * without trying" — and states the rule as an instruction: *"Guardian's
 * reasoning may describe execution behaviour … but must never quote the
 * prompt."* An instruction is the wrong enforcement mechanism when the text it
 * governs is model output that reaches the buyer with no serialiser in between,
 * so `verdict-validation.ts` turns it into a check.
 *
 * **Eight** is long enough that ordinary overlap between a prompt and a
 * description of what the agent did — *"extract the line items from the
 * receipt"* appearing in both — does not trip it, and short enough that a
 * sentence lifted from the prompt does.
 *
 * ⚠️ **Tune it downward, never upward.** The failure modes are asymmetric: too
 * low rejects legitimate rulings, which a rehearsal surfaces immediately; too
 * high leaks the seller's words, which it does not. Raising this to make a
 * rejection go away is how the check stops working.
 */
export const LEAK_RUN_WORDS = 8;

/**
 * The five refund tiers in basis points — the contract's own `_refundBps`
 * values, restated here because `verdicts.refund_minor` is NOT NULL and
 * something has to compute it.
 *
 * ⚠️ **This table does not move money.** The escrow computes and pays the real
 * split on-chain from these same basis points; what `refund.ts` derives from
 * this is a *record of the ruling* for the verdict screen (research R9). Note
 * that `src/chain/tier.ts` explicitly declines to own this — *"What this file is
 * NOT: it does not compute refund amounts"* — which is why the arithmetic lands
 * here.
 *
 * **`Record<VerdictTier, number>` rather than a switch or an array**, for the
 * reason `tier.ts` spends forty lines on: `Record<K, V>` requires every member
 * of `K`, so a sixth tier fails to compile here rather than yielding `undefined`
 * and then `NaN` cents. `GuardianEscrow.sol` carries the warning that applies
 * equally to this line: *"An off-by-one here would be invisible until a live
 * demo and is the exact number an audience watches."*
 */
export const REFUND_BPS: Record<VerdictTier, number> = {
  [VerdictTier.None]: 0,
  [VerdictTier.Quarter]: 2_500,
  [VerdictTier.Half]: 5_000,
  [VerdictTier.ThreeQuarter]: 7_500,
  [VerdictTier.Full]: 10_000,
};

/** Basis-point denominator. One place, so `10_000` is never a bare literal. */
export const BPS_DENOMINATOR = 10_000;
