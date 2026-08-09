/**
 * Decisions with reasoning attached — not deployment knobs.
 *
 * Everything here is code rather than environment configuration on purpose.
 * A gas ceiling is a judgement about what an operation should be allowed to
 * cost, backed by a measurement; moving it to `.env` would turn a reviewed
 * decision into an unreviewed one that varies per machine.
 */

/**
 * Explicit gas ceilings, one per operation.
 *
 * ⚠️ **Monad charges the gas LIMIT, not the usage** — the deduction is
 * `value + gas_price * gas_limit`. That inverts the usual advice: on Ethereum
 * a generous limit is free headroom, here it is money spent on every single
 * transaction. It also means an under-sized limit is worse than it looks: the
 * transaction reverts out-of-gas AND the full limit is charged.
 *
 * viem calls `eth_estimateGas` whenever `gas` is omitted, and that RPC returns
 * a binary-searched **upper bound** rather than the actual usage — so letting
 * it estimate spends the difference on every call. `executeWrite` therefore
 * always passes a value from this table.
 *
 * MEASURED entries come from real receipts on Monad testnet (the deployment
 * runbook's own lifecycle transactions), with a ~1.3x margin. ESTIMATED entries
 * are reasoned from the storage each function touches and are to be replaced
 * with measurements once a rehearsal exercises them.
 */
export const GAS_LIMITS = {
  // ---- MEASURED against the deployed escrow ----

  /** MEASURED 158,189 (×1.33). 5 cold SSTOREs + event. */
  registerAgent: 210_000n,

  /**
   * MEASURED 408,072 (×1.30). ERC-20 `transferFrom` + 11-field struct + event.
   *
   * ⚠️ Do not lower this on intuition. The pre-deployment estimate for this
   * entry was 400,000 — reasoned from storage costs, and **below the measured
   * 408,072**. Shipping it would have made every purchase in the product
   * revert out-of-gas, charged in full, in the single most important operation
   * we have. Reasoning about storage was not good enough; the measurement was.
   *
   * The cost depends on whether the escrow's token balance slot is zero at the
   * time. The measured run started from zero (the expensive case), so this is
   * a high-water mark rather than a lucky low reading.
   */
  openDeal: 530_000n,

  /** MEASURED 54,549 (×1.37). 2 SSTOREs + event. */
  markDelivered: 75_000n,

  /** MEASURED 99,904 (×1.30). state + counter + balance + event. */
  accept: 130_000n,

  /** MEASURED 99,904 (×1.30). Same `_payout` path as `accept`. */
  release: 130_000n,

  /** MEASURED 106,935 (×1.31). balance zeroed + ERC-20 transfer + event. */
  withdrawFor: 140_000n,

  /** MEASURED 72,351 via `measureGas` (×1.31). 3 SSTOREs + event. */
  updateAgent: 95_000n,

  /** MEASURED 48,963 via `measureGas` (×1.31). 1 SSTORE, no event. */
  setAgentActive: 64_000n,

  /**
   * MEASURED 70,688 via `measureGas`, but the ceiling is deliberately ~1.6×
   * rather than the usual 1.3×.
   *
   * ⚠️ That measurement was taken against the CURRENT allowance, which is
   * non-zero — so it prices a non-zero→non-zero SSTORE (~5,000 gas). A **fresh
   * deployment** starts at zero allowance, making the first approve a
   * zero→non-zero write (~20,000 gas), roughly 15,000 more. The earlier
   * 80,000 ceiling cleared the measured case by only 1.13× and would very
   * likely have failed the fresh-deploy case — which is exactly the path that
   * runs once, on a new environment, with nobody watching.
   *
   * This is the same shape as the `openDeal` mistake below: a ceiling that
   * looks fine against the state you happen to be in.
   */
  approve: 110_000n,

  // ---- ESTIMATED — need a live deal in the right state to measure ----

  /** ESTIMATED: 2 SSTOREs + event, same shape as `markDelivered`. */
  dispute: 100_000n,

  /** ESTIMATED: same shape as `release`. */
  reclaim: 130_000n,

  /** ESTIMATED: `release` plus a second balance credit. */
  resolve: 180_000n,

  /** ESTIMATED: same path as `resolve`. */
  forceResolve: 180_000n,
} as const satisfies Record<string, bigint>;

/** Operation names that carry a gas ceiling. */
export type GasOperation = keyof typeof GAS_LIMITS;

/**
 * How long to wait for a receipt before giving up.
 *
 * Monad produces ~300ms blocks, so 30s is roughly 100 blocks — long enough
 * that a timeout means something is genuinely wrong, short enough not to hang
 * a request. Note what a timeout is NOT: it is not a failure. See
 * `ChainOutcomeUnknownError`.
 */
export const RECEIPT_TIMEOUT_MS = 30_000;

/**
 * One confirmation is treated as settled — Monad finalises in well under a
 * second, which is the sub-second finality the product design already assumes.
 */
export const RECEIPT_CONFIRMATIONS = 1;

/**
 * The USDC allowance `ensureAllowance` grants the escrow when it finds the
 * current allowance short, in cents. $10,000 — deals are $1–2, so one approval
 * outlasts any rehearsal.
 *
 * ⚠️ This does NOT describe the live allowance. The deployment runbook already
 * granted the escrow an effectively unbounded approval from the operator, and
 * that was accepted rather than revoked. Against the current deployment
 * `ensureAllowance` short-circuits and this value is never used.
 *
 * It is kept because it is what a **fresh** deployment needs: a redeploy starts
 * at zero allowance, and without the top-up the first purchase fails with an
 * ERC-20 error nobody was expecting. Unexercised, not dead.
 */
export const ALLOWANCE_TOPUP_CENTS = 1_000_000;
