import { z } from 'zod';
import { VerdictTier } from '../entities/enums';

/**
 * The contract between the model and the database: the shape a Guardian
 * ruling must have before it is allowed to become a row.
 *
 * This module declares the schema in Zod (v4), and `claude-auditor.ts` hands
 * it to `zodOutputFormat(...)` so the API enforces it as a structured output.
 * What follows is the part worth being precise about — WHICH of these
 * constraints is actually enforced on the wire, and which is only enforced
 * locally after the response comes back.
 *
 * ⚠️ THE WIRE SCHEMA IS BUILT BY WHITELIST. `zodOutputFormat` runs
 * `z.toJSONSchema()` and then `transformJSONSchema()`, and that transform
 * copies only the keys structured outputs support into the schema it sends.
 * Everything else is silently dropped from the schema proper and folded into
 * a `description` string, which is documentation to the model, not a
 * constraint on it. `minLength`, `maximum`, `pattern` and friends therefore
 * NEVER reach the API. A `.min(12)` on a string in this file would look like
 * a guarantee and be a suggestion.
 *
 * ⚠️ `enum` IS ALSO NOT ON THE WHITELIST, as of `@anthropic-ai/sdk@0.116.0`.
 * Verified by running `zodOutputFormat(VerdictSchema)` against the installed
 * SDK: both `tier` and `source` arrive as a bare `{"type": "string"}` whose
 * permitted values survive only inside the description, as the literal text
 * `{enum: ["0","25","50","75","100"]}`. So "the tier is one of five" is a
 * strong instruction to the model, NOT something the API makes unrepresentable
 * — contrary to what an earlier draft of the contract document claimed. The
 * backstop is real but local: Zod re-validates the decoded payload, an
 * off-menu `'37'` fails that check, and `claude-auditor.ts` turns it into an
 * `AuditFailedError` (gate 3) rather than a row. Nothing here needs changing
 * because of that; it is recorded so nobody later removes the client-side
 * parse on the belief that the wire already covered it. Recheck this on an
 * SDK upgrade — the whitelist is the SDK's, not ours.
 *
 * ⚠️ BUT `minItems` HAS AN EXPLICIT CARVE-OUT, and it is the reason
 * `.min(1)` below is load-bearing rather than decorative.
 * `@anthropic-ai/sdk/lib/transform-json-schema.js:94-100`:
 *
 *     const minItems = pop(jsonSchema, 'minItems');
 *     if (minItems !== undefined && (minItems === 0 || minItems === 1)) {
 *         strictSchema['minItems'] = minItems;
 *     }
 *     else if (minItems !== undefined) {
 *         jsonSchema['minItems'] = minItems;
 *     }
 *
 * `minItems` survives the transform when — and only when — its value is `0`
 * or `1`. `.min(1)` emits `minItems: 1`, which is exactly the surviving case.
 * So **FR-011 ("every ruling cites at least one clause") is an API-level
 * guarantee, not a client-side check**: a zero-citation ruling is not
 * representable and cannot come back over the wire at all.
 *
 * ⚠️ THIS WAS GOT WRONG ONCE, AND THE CORRECTION IS RECORDED HERE ON
 * PURPOSE. An earlier draft of the contract asserted the opposite — that
 * `.min(1)` is stripped like every other refinement and that a zero-citation
 * response is a reachable runtime failure to be caught downstream. That draft
 * very nearly led to `.min(1)` being deleted as dead weight. It is not dead
 * weight. Note also that the mistake was only half wrong in a way that makes
 * it worse: `.min(2)` WOULD have been dropped, so the general rule and the
 * specific behaviour disagree precisely at the value we use. The lesson is
 * the general one — read the transform, do not reason from the general rule.
 *
 * The same transform also FORCES `additionalProperties: false` onto every
 * object it emits (`transform-json-schema.js:73-74`), unconditionally
 * discarding whatever the source schema said. That is worth naming because
 * the execution engine's verification run found every seeded agent schema
 * refused at run time for omitting exactly that key — that path hands the
 * SELLER's hand-written schema to `messages.create` untransformed, so nothing
 * ever adds it. Generating this feature's schema through the helper means
 * Guardian cannot hit that defect: the helper adds the key for us. That is an
 * unplanned second justification for `messages.parse()` over a hand-rolled
 * JSON Schema.
 *
 * Two things the wire schema still does NOT do for us, both handled in
 * `claude-auditor.ts`: `parsed_output` may be `null`, and a client-side
 * validation failure surfaces as the SDK's own error type rather than a
 * `ZodError`. Neither is a crash; both are `AuditFailedError`.
 */

/**
 * One clause of the case file that the ruling leans on, quoted back.
 *
 * `source` names WHICH list the quote came from, because
 * `verdict-validation.ts` (FR-012) matches the quote against that list and
 * only that list — a `capability` quote is not allowed to be satisfied by an
 * exclusion that happens to contain the same words.
 *
 * `quote` is deliberately an unconstrained string here. A length floor would
 * not survive the transform (see above), and the real defence against an
 * invented clause is not a length — it is traceability back to the case file,
 * which is a post-decode gate.
 *
 * `met` is the model's own reading of whether the clause was satisfied. It is
 * recorded, not recomputed: the row must be the ruling that was made.
 */
export const CitationSchema = z.object({
  source: z.enum(['capability', 'exclusion', 'criterion']),
  quote: z.string(),
  met: z.boolean(),
});

/**
 * The whole ruling.
 *
 * ⚠️ `.min(1)` on `citations` IS SENT TO THE API. Do not remove it, and do
 * not "tighten" it to `.min(2)` — see the module comment above. Raising the
 * floor above 1 silently converts an enforced constraint into a comment.
 *
 * WHY `tier` IS A STRING ENUM OF PERCENTAGES AND NOT THE DATABASE'S NAMES:
 * the rubric the model is asked to apply is written in percentages
 * (`docs/product-workflow.md` §4.2 — 0% / 25% / 50% / 75% / 100%), so the
 * value the model emits should be the value it was asked to choose. Asking
 * for `'three_quarter'` when the rubric says 75% inserts a translation step
 * inside the model, at the one moment we most want it doing arithmetic-free
 * matching against a table it was just shown. The translation belongs in
 * typed code, below, where it can be checked.
 */
export const VerdictSchema = z.object({
  tier: z.enum(['0', '25', '50', '75', '100']),
  reasoning: z.string(),
  citations: z.array(CitationSchema).min(1),
});

/** The decoded ruling, exactly as it came off the wire — before any mapping. */
export type AuditedVerdictRaw = z.infer<typeof VerdictSchema>;

/** The five percentage strings the model may return. */
export type WireTier = AuditedVerdictRaw['tier'];

/**
 * The exhaustive mapping from the wire's percentage string to the database's
 * `VerdictTier`.
 *
 * ⚠️ WHY A TABLE AND NOT A CAST OR AN INDEX. This is the third member of a
 * family — `src/chain/tier.ts` makes the same argument at length for the
 * contract/database hop, and it applies here verbatim. The five wire values
 * and the five `VerdictTier` members agree in ORDER but not in NAME, and both
 * orderings are already documented as significant for independent reasons:
 * `src/entities/enums.ts` warns that "Postgres sorts enum values by their
 * declared order, not alphabetically", and `src/chain/types.ts` warns that
 * the contract's `Tier` order "is significant and must track the Solidity
 * source exactly". So `Object.values(VerdictTier)[index]`, or a numeric
 * relabelling, or `raw.tier as unknown as VerdictTier`, would happen to
 * produce the right value TODAY. Each of them would also silently keep
 * "working" the moment either enumeration gains a member, loses one, or is
 * reordered — because a cast has no way to notice a mismatch. It relabels.
 * A table is the only form in which the correspondence is a value you can
 * read, diff, and be forced to update.
 *
 * ⚠️ WHY EXHAUSTIVENESS IS ENFORCED BY THE TYPE AND NOT BY THIS COMMENT.
 * `Record<K, V>` requires every member of `K` to be present as a key. A sixth
 * tier — added to the wire enum, or to `VerdictTier` — therefore makes this
 * object literal fail to COMPILE, at this line, rather than yielding
 * `undefined` at run time and a wrong-but-plausible ruling written to a row
 * that will later be replayed and settled on-chain. A comment asking a future
 * author to "remember to update the tier map" only works if they read it at
 * the moment they touch an unrelated enum; the compiler does not need to be
 * read to notice.
 *
 * WHY THIS MATTERS THIS MUCH. `GuardianEscrow.sol` carries this warning on
 * `_refundBps`, the function that turns a tier into a payout:
 *
 *   "The five tiers in basis points. An off-by-one here would be invisible
 *   until a live demo and is the exact number an audience watches."
 *
 * That sentence is about the Solidity, not about this file, but the stakes
 * are identical and the tier that reaches `_refundBps` is the one this table
 * produced. A tier shifted by one produces a real, wrong refund percentage,
 * and nothing about the mistake looks wrong until someone is watching the
 * number land.
 *
 * ⚠️ THERE ARE NOW THREE VOCABULARIES FOR THE SAME FIVE OUTCOMES:
 *
 * | Wire (`verdict.schema.ts`) | Database (`entities/enums.ts`) | Contract (`chain/types.ts`) | Refund |
 * |----------------------------|--------------------------------|-----------------------------|--------|
 * | `'0'`                      | `VerdictTier.None`             | `Tier.NoRefund`             | 0%     |
 * | `'25'`                     | `VerdictTier.Quarter`          | `Tier.Quarter`              | 25%    |
 * | `'50'`                     | `VerdictTier.Half`             | `Tier.Half`                 | 50%    |
 * | `'75'`                     | `VerdictTier.ThreeQuarter`     | `Tier.ThreeQuarter`         | 75%    |
 * | `'100'`                    | `VerdictTier.Full`             | `Tier.Full`                 | 100%   |
 *
 * Wire -> database is THIS FILE. Database -> contract is `src/chain/tier.ts`.
 * Neither hop is a cast, and **there is no direct wire -> contract path** —
 * deliberately. A shortcut from `'75'` straight to `Tier.ThreeQuarter` would
 * be a fourth correspondence to keep in step with the other two, and the
 * first one nobody would think to update.
 *
 * The percentages in the right-hand column are documentation only. This
 * module computes no refund amount; the basis points live on-chain in
 * `_refundBps`, and the minor-unit figure recorded alongside the row is
 * `refund.ts`'s job.
 */
export const VERDICT_TIER_BY_WIRE: Record<WireTier, VerdictTier> = {
  '0': VerdictTier.None,
  '25': VerdictTier.Quarter,
  '50': VerdictTier.Half,
  '75': VerdictTier.ThreeQuarter,
  '100': VerdictTier.Full,
};

/**
 * Wire `tier` -> database `VerdictTier`, for persisting a decoded ruling.
 *
 * Total by construction: `wire` is narrowed to the five members of
 * {@link WireTier} by the schema that produced it, and
 * {@link VERDICT_TIER_BY_WIRE} is a `Record` over exactly those five, so
 * there is no missing-key branch to guard. This differs from
 * `chain/tier.ts`'s `toVerdictTier`, which DOES throw: its input arrives as a
 * `uint8` read off the chain and is only typed as `Tier` by assertion, so a
 * value outside 0-4 is genuinely reachable there. Here the value can only
 * have come from a successful `VerdictSchema` parse — and since the tier enum
 * is enforced by that parse rather than by the wire (see the module comment),
 * that parse is the one gate that matters. An off-menu tier never reaches
 * this function; it has already failed the audit.
 */
export function toVerdictTier(wire: WireTier): VerdictTier {
  return VERDICT_TIER_BY_WIRE[wire];
}

/**
 * A note on what happens to the rest of the ruling, because it is a property
 * of this contract even though it is not expressed in the schema:
 *
 * `reasoning` and `citations` are stored VERBATIM — no trimming, no
 * reordering, no case or whitespace normalisation, no dropping of a citation
 * that failed a check. The normalisation used by the traceability gate exists
 * for COMPARISON and is never written back. Two reasons. The stored row is
 * replayed rather than recomputed, so it must be the ruling that was actually
 * made; and the verdict hash commits to these fields, so any tidying after
 * the fact would either invalidate the fingerprint or, worse, produce a valid
 * fingerprint over text the model never wrote. A citation that cannot be
 * traced fails the whole audit; it is never quietly removed from a ruling
 * whose `reasoning` may still argue from it.
 */
