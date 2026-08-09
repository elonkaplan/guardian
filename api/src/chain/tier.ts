import { Tier } from './types';
import { VerdictTier } from '../entities/enums';

/**
 * The bidirectional, exhaustive mapping between the escrow contract's `Tier`
 * (a `uint8`, `src/chain/types.ts`) and the database's `VerdictTier` (a
 * string enum, `src/entities/enums.ts`).
 *
 * WHY A TABLE AND NOT A NUMERIC CAST: the two enums agree in ORDER but NOT in
 * NAME. The contract's zero value is `Tier.NoRefund`; the database's zero
 * value is `VerdictTier.None = 'none'`. Because both are declared 0..4 in the
 * same order, `verdictTiers[tierValue]` or `tierValue as unknown as
 * VerdictTier` would happen to produce the right string TODAY. It would also
 * silently keep "working" — producing a wrong-but-plausible tier — the moment
 * either enum gains a member, drops one, or is reordered, because a cast has
 * no way to notice a mismatch; it just relabels a number. A table is the only
 * form where the correspondence is a value you can read, diff, and be forced
 * to update.
 *
 * WHY EXHAUSTIVENESS IS ENFORCED BY THE TYPE, NOT A COMMENT: both maps below
 * are typed as `Record<VerdictTier, Tier>` / `Record<Tier, VerdictTier>`
 * rather than `Partial<...>` or a plain object literal. `Record<K, V>`
 * requires every member of `K` to be present as a key, so adding a member to
 * either enum makes these two object literals fail to compile until the new
 * member is added here too. A comment asking future authors to "remember to
 * update the tier map" relies on someone reading it at the moment they touch
 * an unrelated enum; the compiler doesn't need to be read to notice.
 *
 * WHY THIS MATTERS THIS MUCH: both orderings are already documented
 * elsewhere as significant, for the same underlying reason — Postgres and the
 * EVM both read meaning off of position. `src/entities/enums.ts` warns that
 * "Postgres sorts enum values by their declared order, not alphabetically",
 * and `src/chain/types.ts` warns that the contract's `Tier` order "is
 * significant and must track the Solidity source exactly". The contract
 * itself (`GuardianEscrow.sol`, `_refundBps`) carries this comment on the
 * function that turns a `Tier` into a payout:
 *
 *   "The five tiers in basis points. An off-by-one here would be invisible
 *   until a live demo and is the exact number an audience watches."
 *
 * That sentence is about `_refundBps`, not this file, but the stakes are
 * identical: a tier silently shifted by one produces a real, wrong refund
 * percentage, and nothing about the mistake looks wrong until someone is
 * watching the number land.
 *
 * WHAT THIS FILE IS NOT: it does not compute refund amounts. The percentages
 * in the table below (0% / 25% / 50% / 75% / 100%) are restated here only as
 * documentation — they are the contract's own `_refundBps` basis-point values
 * (0 / 2500 / 5000 / 7500 / 10000), which the contract computes and pays out
 * on-chain. This module's only job is translating a tier's NAME between the
 * chain's numeric encoding and the database's string encoding.
 *
 * | uint8 | contract `Tier` | db `VerdictTier` | refund to buyer |
 * |-------|-----------------|------------------|-----------------|
 * | 0     | `NoRefund`      | `none`           | 0%              |
 * | 1     | `Quarter`       | `quarter`        | 25%             |
 * | 2     | `Half`          | `half`           | 50%             |
 * | 3     | `ThreeQuarter`  | `three_quarter`  | 75%             |
 * | 4     | `Full`          | `full`           | 100%            |
 */
export const TIER_BY_VERDICT: Record<VerdictTier, Tier> = {
  [VerdictTier.None]: Tier.NoRefund,
  [VerdictTier.Quarter]: Tier.Quarter,
  [VerdictTier.Half]: Tier.Half,
  [VerdictTier.ThreeQuarter]: Tier.ThreeQuarter,
  [VerdictTier.Full]: Tier.Full,
};

/** The reverse of {@link TIER_BY_VERDICT}. See that constant's comment for why. */
export const VERDICT_BY_TIER: Record<Tier, VerdictTier> = {
  [Tier.NoRefund]: VerdictTier.None,
  [Tier.Quarter]: VerdictTier.Quarter,
  [Tier.Half]: VerdictTier.Half,
  [Tier.ThreeQuarter]: VerdictTier.ThreeQuarter,
  [Tier.Full]: VerdictTier.Full,
};

/** Database `VerdictTier` -> contract `Tier`, e.g. when submitting a verdict on-chain. */
export function toTier(verdict: VerdictTier): Tier {
  return TIER_BY_VERDICT[verdict];
}

/**
 * Contract `Tier` -> database `VerdictTier`, e.g. when persisting a verdict
 * read off the chain.
 *
 * `tier` is typed as `Tier`, but an on-chain read is really just a `uint8` —
 * nothing at the type level stops a contract upgrade, a decoding bug, or a
 * stray raw value from handing this function a number outside 0-4. Returning
 * `undefined` typed as `VerdictTier` in that case would hand callers a value
 * that type-checks but panics somewhere downstream with no clue why, so this
 * throws immediately with the offending value instead.
 */
export function toVerdictTier(tier: Tier): VerdictTier {
  const verdict = VERDICT_BY_TIER[tier];
  if (verdict === undefined) {
    throw new Error(`toVerdictTier: unrecognized on-chain Tier value ${tier}`);
  }
  return verdict;
}
