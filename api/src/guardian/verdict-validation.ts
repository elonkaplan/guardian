import { VerdictTier } from '../entities/enums';
import type { AuditOutcome, Citation } from './auditor';
import type { GuardianCaseFile } from './case-file-assembler';
import { LEAK_RUN_WORDS } from './guardian.constants';
import {
  NonDeliveryFloorError,
  PromptLeakError,
  UntraceableCitationError,
} from './guardian.errors';

/**
 * The three checks that stand between a model's answer and a stored ruling.
 *
 * Each one **fails the whole audit** rather than repairing the verdict. That is
 * deliberate and it is the same rule three times: silently editing a ruling
 * makes the stored verdict differ from the one that was made, which breaks the
 * replay property invariant #8 exists to provide, and can leave `reasoning`
 * arguing from a citation that is no longer there. A failed audit writes
 * nothing, increments `orders.audit_attempts`, and is retried — up to the bound.
 *
 * | Check | Requirement | Why it cannot be a prompt instruction |
 * | --- | --- | --- |
 * | Citation traceability | FR-012 | A fabricated quote renders in the seller's voice as a quotation from their listing. Worse than no citation, because it is confidently wrong |
 * | Non-delivery floor | FR-014 | `temperature` does not exist on Opus 5, so there is no sampling control to lean on for a MUST |
 * | Prompt-leak containment | FR-042 | The text it governs is model output that reaches the buyer through no serialiser |
 *
 * ## ⚠️ One normaliser, shared
 *
 * The traceability check and the leak check must normalise text identically. If
 * they drift, a quote that traces successfully could contain a prompt run the
 * leak check fails to see, or vice versa. {@link normalise} is not exported for
 * convenience — it is exported so both call sites provably use the same one.
 */

/**
 * Trim, collapse internal whitespace runs to a single space, and casefold.
 * Nothing else — no punctuation stripping, no unicode folding, no stemming.
 *
 * **Why normalise at all**: a model reproducing a clause across a line wrap, or
 * with a different run of spaces, is quoting faithfully. Rejecting that would
 * fail honest audits constantly, which is the failure direction that matters —
 * a model *inventing* a clause does not accidentally land inside the real text.
 *
 * **Why casefold is safe**: it changes which clause a quote traces to not at
 * all, and the UI renders the quote from the response rather than from the
 * clause, so the displayed text is still the model's.
 *
 * ⚠️ **Used for comparison only. Never stored.** `reasoning` and `citations` are
 * persisted exactly as the model returned them.
 */
export function normalise(text: string): string {
  return text.trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * Run every gate. Throws the first failure; returns nothing on success.
 *
 * Ordered cheapest-first only incidentally — the real ordering constraint is
 * that all three must run before anything is written, and the caller
 * (`GuardianService`) invokes this before opening transaction A.
 */
export function validateVerdict(
  orderId: string,
  outcome: AuditOutcome,
  caseFile: GuardianCaseFile,
): void {
  assertCitationsTraceable(orderId, outcome.citations, caseFile);
  assertNonDeliveryFloor(orderId, outcome.tier, caseFile);
  assertNoPromptLeak(orderId, outcome.reasoning, caseFile.systemPrompt);
}

/**
 * FR-012 — every citation's quote must be findable in the clause it names.
 *
 * ## Why this is the check that makes citations worth anything
 *
 * The product's sharpest claim is that *"a tier alone is an assertion; a tier
 * plus 'this clause, unmet, here is the quote' is an audit."* That is only true
 * if a **fabricated** quote fails. Without this, a model that paraphrases a
 * capability into something plausible produces a verdict indistinguishable from
 * a real one — and the UI renders the paraphrase as a quotation from the
 * seller's listing, in the seller's voice.
 *
 * ## The corpus per source
 *
 * | `source` | Searched against |
 * | --- | --- |
 * | `capability` | each element of `capabilities[]` |
 * | `exclusion` | each element of `exclusions[]` |
 * | `criterion` | `acceptanceCriteria` — **one prose string**, not an array |
 *
 * **Substring rather than equality**, because a citation legitimately quotes the
 * relevant sentence of a multi-sentence criterion.
 *
 * ⚠️ **The system prompt and the execution steps are NOT in this corpus, and
 * that is a second containment.** A citation's `source` is an enum of three
 * values enforced on the wire, so the prompt is not a citable source — and a
 * quote that did carry prompt text would fail here, because it would not be
 * found in any capability, exclusion, or criterion. The leak risk is therefore
 * entirely in free-text `reasoning`, which {@link assertNoPromptLeak} covers.
 */
export function assertCitationsTraceable(
  orderId: string,
  citations: readonly Citation[],
  caseFile: GuardianCaseFile,
): void {
  citations.forEach((citation, index) => {
    const clauses = clausesFor(citation.source, caseFile);
    const needle = normalise(citation.quote);

    // An empty quote traces to nothing. Guarding explicitly because
    // `''` is a substring of every string, so without this an empty quote
    // would pass against any non-empty clause list.
    const traceable =
      needle.length > 0 &&
      clauses.some((clause) => normalise(clause).includes(needle));

    if (!traceable) {
      throw new UntraceableCitationError(
        `citation ${index} claims a ${citation.source} that does not contain its quote`,
        orderId,
        citation.source,
        index,
      );
    }
  });
}

/** The clause corpus a citation of the given `source` may be traced against. */
function clausesFor(
  source: Citation['source'],
  caseFile: GuardianCaseFile,
): readonly string[] {
  switch (source) {
    case 'capability':
      return caseFile.capabilities;
    case 'exclusion':
      return caseFile.exclusions;
    case 'criterion':
      // One string, deliberately wrapped rather than split on sentences: a
      // citation may span a clause boundary the splitter would have invented.
      return [caseFile.acceptanceCriteria];
  }
}

/**
 * FR-014 — an order that produced nothing must reach the full-refund tier.
 *
 * ## ⚠️ Assert, never override
 *
 * Overriding the tier to `full` while keeping the model's reasoning would ship a
 * verdict whose stated reasoning argues for something else — a ruling that
 * contradicts itself on screen, permanently, because `verdicts.order_id` is
 * UNIQUE. A failed audit is retried and stays visible; a self-contradicting
 * verdict looks like a bug in the product's core claim.
 *
 * ## ⚠️ Why there is no code short-circuit for non-delivery
 *
 * The obvious alternative is to skip the model entirely when
 * `delivered === false` and write `tier: full` directly. It would produce a
 * verdict with **no reasoning and no citations** — the bare, uncited tier that
 * FR-011 forbids and that this whole feature exists to avoid. It would also make
 * the demo's non-delivery act the one act where Guardian does not explain
 * itself, which is the act where the explanation is most persuasive: *"nothing
 * was produced; the listing promised X; here is the clause, unmet."*
 *
 * This assertion is expected never to fire. `runs.output IS NULL` is unambiguous
 * evidence and the rubric states the rule; `docs/tech-stack.md` §5's mitigation
 * is precisely to make the demo case files unambiguous, because *"ambiguity is
 * where non-determinism bites."* It is a floor under a case that should not need
 * one — which is the right amount of belt-and-braces for the number an audience
 * watches.
 */
export function assertNonDeliveryFloor(
  orderId: string,
  tier: VerdictTier,
  caseFile: GuardianCaseFile,
): void {
  if (!caseFile.delivered && tier !== VerdictTier.Full) {
    throw new NonDeliveryFloorError(
      `case file reports nothing was delivered, but the ruling was not a full refund`,
      orderId,
      tier,
    );
  }
}

/**
 * FR-042 — the ruling must not reproduce the seller's instructions verbatim.
 *
 * ## ⚠️ This is the containment for showing Guardian the prompt
 *
 * `docs/agent-definition.md` §4 puts the seller's `system_prompt` in the case
 * file — the auditor needs it to tell *"tried hard, task was impossible"* from
 * *"returned a stub without trying"* — and states the rule as an instruction:
 * *"Guardian's reasoning may describe execution behaviour … but must never quote
 * the prompt."*
 *
 * An instruction is the right product rule and the wrong enforcement mechanism,
 * for the reason `docs/CONTEXT.md` invariant #3 gives about itself: *"One
 * serialiser, not a rule to remember."* Here there is no serialiser to put the
 * rule in — a verdict's `reasoning` is model output that reaches the buyer with
 * nothing in between, the only buyer-facing text in the product with that
 * property. So the rule becomes a check on the way to storage.
 *
 * ## ⚠️ Paraphrase is deliberately NOT detected
 *
 * §4 explicitly *permits* reasoning that describes execution behaviour, and the
 * sentence it offers as a good example — *"the agent made one extraction attempt
 * and stopped"* — is itself a paraphrase of what the prompt instructed. A
 * detector that caught paraphrase would reject the rulings the product doc calls
 * correct.
 *
 * The residual risk is an auditor that closely restates the instructions without
 * quoting them. That is the same risk the product doc accepted when it wrote the
 * rule as an instruction. What this closes is the **verbatim** path — the one
 * that leaks the seller's actual words, and the one a seller would recognise on
 * sight.
 *
 * ## Why a word-run rather than a similarity score
 *
 * A threshold on a similarity metric is a number nobody can defend, and a
 * near-miss under it is exactly the leak this exists to catch. A run of
 * {@link LEAK_RUN_WORDS} consecutive normalised words is a yes/no question with
 * a quotable answer: *"this ruling reproduced eight consecutive words of the
 * seller's instructions, so it was rejected."*
 *
 * ⚠️ **Neither the thrown error nor any log line carries the matched text.**
 * Reporting a prompt leak by quoting the leak would be the same disclosure with
 * an error message in front of it.
 */
export function assertNoPromptLeak(
  orderId: string,
  reasoning: string,
  systemPrompt: string,
): void {
  const promptWords = normalise(systemPrompt).split(' ').filter(Boolean);
  if (promptWords.length < LEAK_RUN_WORDS) {
    // A prompt shorter than one run cannot be leaked a run at a time. Nothing
    // to check — and no reason to fabricate a shorter window, which would start
    // matching ordinary English.
    return;
  }

  const haystack = normalise(reasoning);

  for (let i = 0; i + LEAK_RUN_WORDS <= promptWords.length; i += 1) {
    const run = promptWords.slice(i, i + LEAK_RUN_WORDS).join(' ');
    if (haystack.includes(run)) {
      throw new PromptLeakError(
        `ruling reproduced a verbatim run of the seller's instructions`,
        orderId,
        LEAK_RUN_WORDS,
      );
    }
  }
}
