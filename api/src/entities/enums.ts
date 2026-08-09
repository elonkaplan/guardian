/**
 * The three enumerated types, mirroring the Postgres types created by the
 * initial migration.
 *
 * ⚠️ MEMBER ORDER IS SIGNIFICANT. Postgres sorts enum values by their declared
 * order, not alphabetically, so reordering any of these silently changes the
 * meaning of `ORDER BY state` and friends. Keep them in lockstep with the
 * CREATE TYPE statements in the migration.
 */

/**
 * Postgres type: `ledger_kind`.
 *
 * There is deliberately NO `settlement` member. Settled funds land on-chain
 * under the user's own address and cannot be recaptured by the platform, so
 * settlement writes no ledger entry at all.
 *
 * `Adjustment` exists because at some point something will need correcting by
 * hand, and doing that as a new entry keeps the history honest — the ledger is
 * append-only and corrections are never edits.
 */
export enum LedgerKind {
  Onramp = 'onramp',
  Purchase = 'purchase',
  Offramp = 'offramp',
  Adjustment = 'adjustment',
}

/**
 * Postgres type: `order_state`.
 *
 * The product state machine, which is finer than the smart contract's:
 *
 *   purchased → running → delivered → released              (uncontested)
 *                      ↘ failed                             (produced nothing)
 *                        delivered → disputed → adjudicated → settled
 *
 * This column is also the work queue — no Redis, no BullMQ; a cron reaper
 * catches anything stuck.
 */
export enum OrderState {
  Purchased = 'purchased',
  Running = 'running',
  Delivered = 'delivered',
  Failed = 'failed',
  Released = 'released',
  Disputed = 'disputed',
  Adjudicated = 'adjudicated',
  Settled = 'settled',
}

/** Postgres type: `verdict_tier`. The five refund outcomes Guardian may award. */
export enum VerdictTier {
  None = 'none',
  Quarter = 'quarter',
  Half = 'half',
  ThreeQuarter = 'three_quarter',
  Full = 'full',
}
