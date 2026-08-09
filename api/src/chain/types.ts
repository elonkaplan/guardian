import type { Address, Hex } from 'viem';

/**
 * The contract's `Deal.state` enum, verbatim. These are `uint8` VALUES read
 * off the chain, not labels we chose — order is significant and must track
 * the Solidity source exactly, not alphabetical or "logical" ordering.
 *
 * `None = 0` is the zero value returned for any id that was never opened
 * (deal ids start at 1), which is how "does not exist" reads without a
 * separate existence check. `Settled` is terminal: once reached, no other
 * transition is possible.
 *
 * Deliberately DISTINCT from the database's `OrderState`
 * (`src/entities/enums.ts`), which is a finer, product-level state machine
 * tracking things the chain has no notion of (`running`, `failed`). Nothing
 * in this module converts between the two — that mapping is the orders
 * module's job, because it requires product context this module doesn't have.
 */
export enum DealState {
  None = 0,
  Open = 1,
  Delivered = 2,
  Disputed = 3,
  Settled = 4,
}

/**
 * The contract's `Verdict.tier` enum, verbatim — the five refund outcomes a
 * guardian may award. Same "values not labels" rule as `DealState`: order is
 * fixed by the Solidity source. The bidirectional mapping to the database's
 * `VerdictTier` (`src/entities/enums.ts`) is intentionally NOT here — the two
 * enums diverge in naming at index 0 (`NoRefund` vs `none`), so collapsing
 * them into a cast would silently hide that mismatch instead of forcing every
 * call site to look at a table.
 */
export enum Tier {
  NoRefund = 0,
  Quarter = 1,
  Half = 2,
  ThreeQuarter = 3,
  Full = 4,
}

/**
 * The mapped form of the `agents(uint256)` getter's 5-element tuple. The
 * mapping (tuple index -> field, base units -> cents) happens in exactly one
 * function elsewhere in this module — this type only names the result.
 *
 * `owner` doubles as the existence check: `0x0…0` means the id was never
 * registered, the same "zero reads as absent" convention `DealState.None`
 * uses for deals.
 */
export interface OnChainAgent {
  owner: Address;
  priceCents: number;
  defHash: Hex;
  version: number;
  active: boolean;
}

/**
 * The mapped form of the `deals(uint256)` getter's 11-element positional
 * tuple. Field order here follows the table in data-model.md §4, not the
 * tuple's index order, so this type is read alongside that table rather than
 * treated as self-describing.
 *
 * `seller` and `amountCents` are SNAPSHOTS taken when the deal was opened,
 * not live lookups against the current agent — an agent's owner or price can
 * change after a deal exists, and the deal must keep paying out under the
 * terms it was opened with.
 *
 * `deliveredAt` and `disputedAt` are `null` when the raw on-chain `uint64` is
 * `0` (i.e. that event hasn't happened yet), converted by the mapper — never
 * treat `0` as a valid epoch timestamp for these two fields.
 */
export interface OnChainDeal {
  agentId: bigint;
  buyer: Address;
  seller: Address;
  amountCents: number;
  defHash: Hex;
  defVersion: number;
  openedAt: Date;
  deliveredAt: Date | null;
  disputedAt: Date | null;
  reviewWindowSeconds: number;
  state: DealState;
}

/**
 * What every state-changing chain call resolves to. A `TxResult` is ONLY ever
 * constructed from a receipt with `status === 'success'` — the other two
 * possible outcomes of a write are a thrown `ContractRevertError` (mined but
 * reverted) and a thrown `ChainOutcomeUnknownError` carrying the hash (no
 * receipt arrived in time). There is no fourth outcome, so no caller should
 * add a branch for one.
 *
 * `value` is recovered from the receipt's EVENT LOGS, never from the
 * transaction's return data: a transaction sent from an off-chain caller
 * returns nothing, even when the Solidity signature declares
 * `returns (uint256)` — that return value is only visible to another
 * contract calling in the same transaction.
 */
export type TxResult<T = void> = {
  hash: Hex;
  blockNumber: bigint;
  gasUsed: bigint;
  value: T;
};
