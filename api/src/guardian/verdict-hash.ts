import { createHash } from 'node:crypto';
import { VerdictTier } from '../entities/enums';

/**
 * The projection of a ruling that gets fingerprinted — the fields, and only the
 * fields, that {@link verdictHash} commits to. See that function for why this
 * shape is what it is.
 */
export interface VerdictHashInput {
  orderId: string;
  tier: VerdictTier;
  refundMinor: number;
  reasoning: string;
  citations: ReadonlyArray<{ source: string; quote: string; met: boolean }>;
  model: string;
}

/**
 * The verdict fingerprint: SHA-256 over a canonical projection of the ruling
 * (research R5). Returns **exactly 32 bytes**, stored as-is in
 * `verdicts.verdict_hash` (`bytea`) and passed to the escrow as `0x`-prefixed
 * hex.
 *
 * **Why 32 bytes is not a choice.** The escrow's `resolve` takes a `bytes32`
 * (`src/chain/abi/escrow-resolve.abi.ts`), so the output width is fixed by the
 * contract, not by preference. SHA-256 is in the standard library and needs no
 * dependency.
 *
 * **What the hash covers, and why.** Everything a reader would call *"the
 * ruling"*: the tier **and its justification** — the reasoning prose, the
 * citation checklist, the refund figure, the order it belongs to, and the model
 * that judged it. The on-chain anchor therefore commits to the argument, not
 * merely to a number. A hash over the tier alone would let the justification be
 * rewritten afterwards without breaking the anchor, which would make the anchor
 * worth very little. Every field is reproducible from the persisted row, so
 * anyone holding the database can recompute and verify the anchor later.
 *
 * ⚠️ **Computed ONCE, at persist time, and NEVER recomputed.** The settle-retry
 * path reads the stored `bytea` from `verdicts.verdict_hash`; it does not call
 * this function again. This is load-bearing rather than stylistic: a retry that
 * recomputed the hash from the row would produce the same bytes *today* and
 * different bytes the day someone adds a field to the projection, changes the
 * citation ordering, or normalises the reasoning text — and the mismatch would
 * surface as an anchor that no longer matches the transaction already on chain.
 * Reading the stored bytes makes the anchor **a fact about what was signed**,
 * rather than a function that must keep agreeing with itself across deploys.
 * `EscrowGuardianService.resolve`'s own doc-comment anticipates exactly this: it
 * takes the hash from the caller precisely so that *"a service that computed the
 * hash itself could be called before anything was written down."*
 *
 * **Why a literal field order rather than sorted keys.** Both are deterministic,
 * so determinism is not the deciding argument. Sorting makes the projection's
 * field set invisible at the call site; a literal you can read top-to-bottom is
 * the artefact a reviewer checks against the only question that matters here —
 * *"does this cover the whole ruling?"*
 *
 * **Why citations keep the model's original order.** Their order is part of what
 * the buyer reads: the checklist is an argument, presented in sequence. A
 * verdict whose checklist reorders is a different verdict on screen, so sorting
 * them before hashing would let a visible change slip past the anchor.
 *
 * **Why not keccak256**, despite it being the EVM idiom. It would mean importing
 * viem's hashing outside `src/chain/`, or computing the hash inside the chain
 * adapter — and the second is exactly what `resolve`'s doc-comment forbids. The
 * contract stores an opaque `bytes32`; it never interprets it, so no on-chain
 * behaviour depends on the algorithm.
 *
 * **Why not hash the raw model response body.** It carries SDK-added fields,
 * usage counts, and an ordering the persisted row does not have, so the anchor
 * would commit to something that cannot be reproduced from the database — which
 * defeats the point of anchoring it.
 */
export function verdictHash(input: VerdictHashInput): Buffer {
  // ⚠️ Hand-written field order. Do NOT sort these keys, do NOT reorder them to
  // match some other type, and do NOT sort `citations`. Any edit here changes
  // the bytes for every verdict hashed afterwards; rows already anchored on
  // chain keep the bytes they were signed with, which is why nothing recomputes.
  const canonical = JSON.stringify({
    orderId: input.orderId,
    tier: input.tier,
    refundMinor: input.refundMinor,
    reasoning: input.reasoning,
    citations: input.citations.map((citation) => ({
      source: citation.source,
      quote: citation.quote,
      met: citation.met,
    })),
    model: input.model,
  });

  return createHash('sha256').update(canonical, 'utf8').digest();
}
