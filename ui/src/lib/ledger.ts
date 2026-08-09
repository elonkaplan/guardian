/**
 * The ledger's data transformations: direction, label, and timestamp.
 *
 * Pure. No React, no fetch, no module-level mutable state — the same grounds
 * `verdict.ts` and `orderState.ts` are here on. The vocabulary has more than
 * one caller (the ledger table today, whatever reads a `LedgerEntry` next),
 * and they must not disagree about what a `purchase` row is called or
 * whether a movement is a credit.
 *
 * What this vocabulary explains is the platform's *available balance* and
 * nothing else. When an order concludes, the contract credits
 * `balances[buyer]` and `balances[seller]` — the users' own addresses — and
 * the platform never sees that money again (database-schema §3.3), so a
 * settlement and a withdrawal are on-chain facts, not ledger entries, and
 * neither one gets a row here or a label below. There is no gap in the
 * mapping; there is no entry to label.
 */

import type { LedgerEntry, LedgerKind } from '../api/types';

/**
 * `credit` or `debit`, from the SIGN of `entry.amountMinor` alone — never
 * from `kind`.
 *
 * This is load-bearing. `adjustment` goes either way by definition: it is
 * the kind for a movement none of the other three describe, and forcing it
 * to a fixed direction would just be wrong for whichever half of its cases
 * disagreed. The other three kinds happen to each have one conventional
 * sign today, but reading the amount rather than the kind means a fifth
 * kind added upstream — one this file has never heard of — still reports
 * its direction correctly, because the sign is the only fact about
 * direction that is actually recorded.
 */
export function entryDirection(entry: LedgerEntry): 'credit' | 'debit' {
  return entry.amountMinor >= 0 ? 'credit' : 'debit';
}

/**
 * The four known kinds, mapped to the words a reader sees on the wallet
 * page.
 *
 * A `Record<LedgerKind, string>` rather than a `switch`, so that a fifth
 * member added to `LedgerKind` in `api/types.ts` is a compile error here
 * rather than a silently-unlabelled row (quickstart G9) — the same
 * exhaustiveness device `tierDisplay` uses for `VerdictTier`, just enforced
 * by the object literal's own required keys instead of a fallthrough guard.
 */
const KNOWN_LABELS: Record<LedgerKind, string> = {
  onramp: 'Added funds',
  purchase: 'Purchase',
  offramp: 'Cashed out',
  adjustment: 'Adjustment',
};

/**
 * The reader-facing word for a ledger entry's kind.
 *
 * The parameter type is widened to `LedgerKind | string` on purpose: a kind
 * arrives off the wire before anything has checked it against the known
 * four, and the whole point of this function is to still say something
 * sensible about the ones it does not recognise. An unfamiliar kind returns
 * its own string rather than being dropped or blanked (FR-021) — the row
 * stays in the statement with whatever label the backend gave it, which is
 * a far better failure than a ledger entry that vanishes or reads as
 * nothing at all.
 */
export function entryLabel(kind: LedgerKind | string): string {
  if (Object.prototype.hasOwnProperty.call(KNOWN_LABELS, kind)) {
    return KNOWN_LABELS[kind as LedgerKind];
  }
  return kind;
}

const timeFormatter = new Intl.DateTimeFormat('en-US', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

/**
 * An entry's `createdAt` as an absolute local date and time.
 *
 * Absolute, not relative — a statement someone might reconcile against a
 * bank export or a screenshot taken minutes ago needs a timestamp that
 * still means the same thing tomorrow, which "3 minutes ago" does not.
 *
 * A module-level formatter instance, as `money.ts` builds its
 * `Intl.NumberFormat` once rather than per call. Returns the em dash `'—'`
 * for an empty or unparseable timestamp, matching what `formatUsd` and
 * `formatDuration` do with a value they cannot render, and never throws.
 */
export function formatEntryTime(iso: string): string {
  if (iso === '') {
    return '—';
  }
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) {
    return '—';
  }
  return timeFormatter.format(new Date(ms));
}
