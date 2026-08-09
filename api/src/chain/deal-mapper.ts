import { zeroAddress, type Address, type Hex } from 'viem';

import { DealState, type OnChainAgent, type OnChainDeal } from './types';
import { fromBaseUnits } from './units';

/**
 * The escrow's public getters return **positional tuples**, not named structs.
 *
 * Solidity's auto-generated getter for a public mapping-of-struct hands back
 * the members in declaration order, so viem types `deals(id)` as an
 * eleven-element tuple and every field is addressed by index at the call site.
 *
 * That is the whole reason this mapping lives in one file: **indices 6 and 7
 * are `openedAt` and `deliveredAt`** — two same-typed `uint64` timestamps whose
 * transposition type-checks perfectly and produces a plausible wrong answer
 * (a review window that started at purchase rather than at delivery). Doing the
 * mapping once, here, means that bug has exactly one place to live rather than
 * one per call site.
 */

/** The raw shape of the escrow's `deals(uint256)` getter. */
export type RawDealTuple = readonly [
  agentId: bigint,
  buyer: Address,
  seller: Address,
  amount: bigint,
  defHash: Hex,
  defVersion: number,
  openedAt: bigint,
  deliveredAt: bigint,
  disputedAt: bigint,
  reviewWindow: number,
  state: number,
];

/** The raw shape of the escrow's `agents(uint256)` getter. */
export type RawAgentTuple = readonly [
  owner: Address,
  price: bigint,
  defHash: Hex,
  version: number,
  active: boolean,
];

/**
 * A `uint64` unix-seconds timestamp, or `null` when the contract's zero value
 * means "this has not happened yet".
 *
 * `0` is genuinely absence here, not the epoch: `deliveredAt` stays 0 until
 * delivery and `disputedAt` until a dispute. Mapping it to `new Date(0)` would
 * produce a record claiming delivery occurred in 1970 — wrong in a way that
 * reads as a real value.
 */
function toDateOrNull(seconds: bigint): Date | null {
  return seconds === 0n ? null : new Date(Number(seconds) * 1000);
}

export function mapDeal(raw: RawDealTuple): OnChainDeal {
  return {
    agentId: raw[0],
    buyer: raw[1],
    seller: raw[2],
    amountCents: fromBaseUnits(raw[3]),
    defHash: raw[4],
    defVersion: raw[5],
    openedAt: new Date(Number(raw[6]) * 1000),
    deliveredAt: toDateOrNull(raw[7]),
    disputedAt: toDateOrNull(raw[8]),
    reviewWindowSeconds: raw[9],
    state: raw[10] as DealState,
  };
}

export function mapAgent(raw: RawAgentTuple): OnChainAgent {
  return {
    owner: raw[0],
    priceCents: fromBaseUnits(raw[1]),
    defHash: raw[2],
    version: raw[3],
    active: raw[4],
  };
}

/**
 * Not-found detection, which the contract's own design makes necessary.
 *
 * Ids start at 1 precisely so that `0` means "not found" — a mapping lookup on
 * an unknown id returns a zero-filled struct rather than reverting. Without an
 * explicit check, `deals(99999)` yields a real-looking record with zero
 * parties, a zero amount, and `state = None`, which a caller has no way to
 * distinguish from a genuine record whose fields happen to be zero.
 */
export function dealExists(raw: RawDealTuple): boolean {
  return raw[10] !== DealState.None;
}

export function agentExists(raw: RawAgentTuple): boolean {
  return raw[0] !== zeroAddress;
}
