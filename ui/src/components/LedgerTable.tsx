import type { JSX } from 'react';
import { Link } from 'react-router-dom';

import type { ApiError } from '../api/errors';
import type { LedgerEntry } from '../api/types';
import { entryDirection, entryLabel, formatEntryTime } from '../lib/ledger';
import { formatUsd } from '../lib/money';
import { paths } from '../routes/paths';
import { LoadState } from './LoadState';

interface LedgerTableProps {
  /** `entries` from the wallet's ledger read. `undefined` while the first read is
   *  still in flight — see `LoadState`'s note on why that is not the same thing
   *  as an empty array. */
  entries: LedgerEntry[] | undefined;
  /** The last fetch failure, if the fetch failed. `null` otherwise. */
  error: ApiError | null;
  /** Refetch the statement. Wired to the error state's retry button and to
   *  nothing else — a failed poll must not reach for anything more drastic. */
  onRetry(): void;
}

/**
 * The wallet's statement: one row per movement of the available balance
 * (User Story 3, FR-016 through FR-023).
 *
 * The figures above this component say what the balance is; this is where a
 * reader checks that the figure is telling the truth. A number with no
 * history behind it is an assertion, and the whole reason a statement exists
 * on this screen is to let someone add up the rows themselves and arrive at
 * the same total the header already claims. That is why an unfamiliar
 * `kind` or a zero-amount row is never dropped: hiding an entry to keep the
 * list tidy is exactly the move that would make the total stop adding up,
 * which is the one failure this component exists to prevent.
 *
 * The scope note beneath the heading is not decoration. Two kinds of money
 * move on this platform and only one of them leaves a row here: the
 * available balance lives in the platform's own Postgres ledger and every
 * change to it is a `ledger_entries` row, but settlement pays out to
 * `balances[buyer]` and `balances[seller]` on-chain — the users' own
 * addresses — and the platform never sees that money again
 * (`docs/database-schema.md` §3.3). So a settlement or a withdrawal never
 * appears below, by design, and a reader who does not already know that will
 * read the missing row as evidence the books are broken rather than as the
 * on-chain fact it actually is. Stating the scope in place is cheaper than
 * that misunderstanding and is what FR-020 requires.
 *
 * Rows are keyed by `entry.id`, never by array index. This screen polls, and
 * a poll that inserts a new row at the top every few seconds shifts every
 * later entry's index by one — an index key would make React believe the
 * entry that used to be at position 3 is now a different entry that merely
 * moved to position 4, tearing down and rebuilding DOM nodes a reader might
 * be mid-read of and throwing away their scroll position along with it
 * (FR-018). The id is the one thing about a row that a poll cannot change,
 * so it is the only key that keeps a reader's place.
 *
 * The incoming array is copied before it is sorted. `entries` is owned by
 * whatever hook fetched it, and a component that mutates its own props in
 * place is a bug waiting for a second reader of the same array — the sort
 * has to produce a new array rather than reorder the one it was handed.
 * `Array.prototype.sort` is a stable sort in every engine this app ships to
 * (guaranteed since ES2019), so two entries with the identical `createdAt`
 * keep the order the server sent them in rather than swapping places on
 * every poll, which would otherwise read as the list shuffling itself for
 * no reason.
 */
export function LedgerTable({ entries, error, onRetry }: LedgerTableProps): JSX.Element {
  return (
    <section className="ledger" aria-label="Statement">
      <h2 className="ledger__heading">Statement</h2>
      <p className="ledger__scope-note">
        This statement explains your available balance only. Settled funds move
        on-chain, straight to your own address, and never produce a row here.
      </p>
      {renderBody(entries, error, onRetry)}
    </section>
  );
}

function renderBody(
  entries: LedgerEntry[] | undefined,
  error: ApiError | null,
  onRetry: () => void,
): JSX.Element {
  // No result yet at all. Whether that is an ordinary first load or a load
  // that has already failed is the one distinction this branch has to make —
  // once `entries` exists, even as an empty array, a later error is a failed
  // refresh rather than a reason to blank a statement the reader already has.
  if (entries === undefined) {
    if (error !== null) {
      return (
        <LoadState
          status="error"
          message="The statement could not be loaded."
          onRetry={onRetry}
        />
      );
    }
    return <LoadState status="loading" message="Loading your statement…" />;
  }

  if (entries.length === 0) {
    // Matter-of-fact, and no retry button: an account with no activity yet is
    // the system working correctly, not a request that failed.
    return <LoadState status="empty" message="No activity yet." />;
  }

  const sorted = sortEntriesNewestFirst(entries);

  return (
    // The scroll region, and nothing above it. A statement can grow to
    // dozens of rows while this screen is open — a poll only ever adds to
    // it — and the three balance figures live outside this component
    // entirely, in the page above. Keeping the scrolling contained to this
    // element (FR-023) is what stops a long history from pushing those
    // figures off screen; the stylesheet is what actually makes this box
    // scroll, this comment is just the reason the box exists.
    <div className="ledger__scroll">
      <ul className="ledger__list">
        {sorted.map((entry) => (
          <LedgerRow key={entry.id} entry={entry} />
        ))}
      </ul>
    </div>
  );
}

function sortEntriesNewestFirst(entries: LedgerEntry[]): LedgerEntry[] {
  return [...entries].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

function LedgerRow({ entry }: { entry: LedgerEntry }): JSX.Element {
  const direction = entryDirection(entry);
  // A glyph and a word, not a glyph alone and not colour alone. The same
  // argument `CitationChecklist` makes for its met/unmet mark applies here
  // without change: a projector, a screenshot pasted into a deck, and a
  // colour-blind reader are all ordinary viewing conditions for this demo,
  // not edge cases, and none of them can be relied on to carry a red-versus-
  // green distinction. The sign is `aria-hidden` because the word beside it
  // says the same thing in a form a screen reader can pronounce; a sighted
  // reader gets both at once.
  const sign = direction === 'credit' ? '+' : '−';
  const word = direction === 'credit' ? 'Credit' : 'Debit';

  return (
    <li className="ledger__row">
      <span className={`ledger__amount ledger__amount--${direction}`}>
        <span aria-hidden="true">{sign}</span>
        {formatUsd(Math.abs(entry.amountMinor))}
      </span>
      <span className="ledger__direction-word">{word}</span>
      <span className="ledger__kind">{entryLabel(entry.kind)}</span>
      <span className="ledger__time">{formatEntryTime(entry.createdAt)}</span>
      {entry.orderId !== null ? (
        // `orderId` is only ever set on a `purchase` row (see `LedgerEntry`'s
        // own doc comment), so keying the link off the id itself rather than
        // off `entry.kind === 'purchase'` means this still links correctly if
        // a future movement kind ever carries an order too, without this file
        // needing to know that kind's name (FR-019).
        <Link className="ledger__order-link" to={paths.orderDetail(entry.orderId)}>
          View order
        </Link>
      ) : null}
    </li>
  );
}
