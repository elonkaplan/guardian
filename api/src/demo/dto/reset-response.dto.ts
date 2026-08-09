/**
 * What `POST /demo/reset` answers with
 * (`specs/011-demo-seed-fixtures/contracts/demo-api.md` §2.1).
 *
 * A reset is destructive and unauthenticated, so its response is the only
 * account anyone gets of what just happened. It is written for the person
 * reading it at 3am between rehearsals, which is why it reports what was *kept*
 * as well as what was cleared: the two questions that person actually has are
 * "did it wipe my agents?" and "where did my balance go?", and both are answered
 * here rather than by opening psql.
 */
export interface ResetClearedCounts {
  /** Orders deleted, all states. */
  orders: number;

  /**
   * Of those, how many were still in flight — `purchased`, `running`,
   * `delivered`, `disputed` or `adjudicated`.
   *
   * ⚠️ **The number that matters.** Each of these had money in escrow on-chain,
   * and deleting the platform's record of the order does not recall it: the
   * escrow's own deadline and its permissionless force-settlement are the only
   * things that can. A non-zero value here means the operator reset mid-act and
   * left funds behind, which is recoverable but must not be silent.
   */
  ordersInFlight: number;

  runs: number;
  complaints: number;
  verdicts: number;

  /**
   * Ledger entries whose `order_id` was cleared — **not** deleted.
   *
   * The count is here so the two numbers can be read against each other: this
   * should track `orders`, and every one of those rows is still in the table
   * with its amount untouched.
   */
  ledgerEntriesUnlinked: number;
}

/** What survived, counted after the transaction committed. */
export interface ResetKeptCounts {
  accounts: number;
  agents: number;
  /** ⚠️ Compare with `cleared.ledgerEntriesUnlinked`: unlinked, never removed. */
  ledgerEntries: number;
}

export interface ResetResponse {
  cleared: ResetClearedCounts;
  kept: ResetKeptCounts;
  /**
   * A constant sentence, returned every time.
   *
   * It is in the response body rather than in the README because the person who
   * needs it is the one who just ran the command, and a README they have not
   * opened is not where a surprise about money belongs.
   */
  note: string;
}

/**
 * ⚠️ Do not soften this wording. Both halves are load-bearing: balances are
 * unchanged **because** the ledger is untouched (invariant #4), and money that
 * has escrowed or settled does not come back **because** it is on-chain under an
 * address the platform cannot spend from (invariant #5).
 */
export const RESET_NOTE =
  'Ledger entries are preserved and balances are unchanged. ' +
  'Money already escrowed or settled on-chain is not returned by a reset.';
