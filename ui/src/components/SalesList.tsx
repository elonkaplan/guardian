import type { JSX } from 'react';
import { Link } from 'react-router-dom';

import type { ApiError } from '../api/errors';
import type { Sale } from '../api/types';
import { formatEntryTime } from '../lib/ledger';
import { formatUsd } from '../lib/money';
import { stateLabel } from '../lib/orderState';
import { paths } from '../routes/paths';
import { LoadState } from './LoadState';

interface SalesListProps {
  /** `GET /sales`, once it has answered. `undefined` while the first read is
   *  still in flight — which is not the same thing as an empty array, and the
   *  two say opposite things to a seller. */
  sales: Sale[] | undefined;
  /** The last fetch failure, if the fetch failed. `null` otherwise. */
  error: ApiError | null;
  /** True only while a read is in flight with nothing to show behind it. */
  loading: boolean;
  /** Refetch this list, and only this list. A failed read of the sales must
   *  not reach for the page or for the agent list beside it. */
  onRetry(): void;
}

/**
 * Every order placed against an agent this account owns — the same trades the
 * buyers see, from the other side (User Story 2, FR-004, FR-005, FR-007,
 * FR-009, FR-010).
 *
 * **A disputed sale is marked from `disputedAt`, never from `state`.** This is
 * the reasoning `OrderDetailPage`'s `ConcludedFace` already uses and it is
 * worth restating because the tempting shortcut is wrong in a way that only
 * shows up on stage: `disputedAt` is true from the moment a complaint is filed
 * and stays true through every state after it, whereas testing
 * `state === 'settled'` misses a dispute that is still in flight — precisely
 * the sale a seller has opened this screen to find — and a state inserted
 * later in the lifecycle would silently strip the mark off rows that carry it
 * today. The marker is a word, not a colour, for the same projector-and-
 * greyscale reason `LedgerTable` gives, and it duplicates `stateLabel` in the
 * single state where the order is literally `disputed`. That redundancy is the
 * price of a mark keyed on the fact rather than on the label, and it is worth
 * paying: one row that says "Disputed" twice is a far cheaper outcome than a
 * settled dispute that says it nowhere.
 *
 * FR-005 also asks for a way to reach the dispute, and the whole row is it —
 * `/sell/sales/:id` is the seller's dispute screen, and `Sale.id` is the order
 * id it is keyed on. The link wraps the row rather than the agent name for the
 * reason `AgentCard` gives: a row is one proposition, so all of it should
 * behave like one target.
 *
 * **A state this build has never heard of still gets its row**, with its agent,
 * its amount and its time (FR-009). Nothing in this file arranges that, and
 * that is the point: `stateLabel` is exhaustively switched over `OrderState`
 * with no `default` clause, so a ninth backend state is a compile error in
 * `lib/orderState.ts` rather than a row that quietly vanishes from a seller's
 * takings. The guarantee is structural — held by the shape of that switch, not
 * by a fallback here that someone has to remember to keep working.
 *
 * **This section owns its empty and error branches** (FR-007). The agent list
 * beside it is a separate read, and either one failing must leave the other
 * standing; handling it here rather than in the page is what makes that true
 * by construction.
 *
 * Rows are keyed by `sale.id` — the order id — and never by array index. This
 * screen polls at 5s and a new sale lands at the top, which under an index key
 * would look to React like every row below it changing identity at once,
 * throwing away the seller's scroll position on a list they were reading.
 */
export function SalesList({ sales, error, loading, onRetry }: SalesListProps): JSX.Element {
  return (
    // Busy for the first read only. The 5s poll that follows refreshes these
    // rows in place and must not announce itself, which is the same thing
    // FR-006 asks for when it forbids reverting the list to a placeholder.
    <section className="sales" aria-label="Your sales" aria-busy={loading}>
      <h2 className="sales__heading">Sales</h2>
      {renderBody(sales, error, onRetry)}
    </section>
  );
}

function renderBody(
  sales: Sale[] | undefined,
  error: ApiError | null,
  onRetry: () => void,
): JSX.Element {
  // Nothing has arrived yet. `error` decides which placeholder this is, not
  // whether a request is in flight: the poll behind a failed first read fires
  // again every five seconds, and letting that flip the panel back to
  // "Loading…" would blink the retry button out from under the person trying
  // to press it. Once `sales` exists, even empty, a later failure is a failed
  // refresh and the rows already on screen stay on screen.
  if (sales === undefined) {
    if (error !== null) {
      return (
        <LoadState status="error" message="Your sales could not be loaded." onRetry={onRetry} />
      );
    }
    return <LoadState status="loading" message="Loading your sales…" />;
  }

  if (sales.length === 0) {
    // Worded as a fact about a new account, not as a shortfall, and with no
    // retry button — nothing failed here. "No sales yet" reads as the system
    // answering correctly; anything apologetic would teach a seller to suspect
    // the backend every time they open a screen that is working perfectly.
    return <LoadState status="empty" message="No sales yet." />;
  }

  const sorted = sortSalesNewestFirst(sales);

  return (
    // The scroll region, so that a long sales history stays inside its own box
    // instead of pushing the agent list out of reach (FR-010).
    <div className="sales__scroll">
      <ul className="sales__list">
        {sorted.map((sale) => (
          <SaleRow key={sale.id} sale={sale} />
        ))}
      </ul>
    </div>
  );
}

/**
 * Newest first (data-model §3), on a copy.
 *
 * The copy is not defensive habit: `sales` belongs to the hook that fetched it
 * and sorting in place would reorder an array another reader may hold. Stable
 * sort — guaranteed since ES2019 — keeps two sales made in the same second in
 * the order the server sent them rather than swapping them on every poll tick,
 * which would read as the list shuffling itself for no reason. `LedgerTable`
 * sorts its rows the same way and for the same two reasons.
 */
function sortSalesNewestFirst(sales: Sale[]): Sale[] {
  return [...sales].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

function SaleRow({ sale }: { sale: Sale }): JSX.Element {
  const disputed = sale.disputedAt !== null;

  return (
    <li className={`sales__row${disputed ? ' sales__row--disputed' : ''}`}>
      <Link className="sales__link" to={paths.sellerSale(sale.id)}>
        <span className="sales__agent">{sale.agentName}</span>
        {/* Integer cents through `formatUsd`, like every amount in this app. */}
        <span className="sales__amount">{formatUsd(sale.priceMinor)}</span>
        {/* `stateLabel`, never a second vocabulary invented here: the words a
            state is given have to match the ones the sale's own screen uses,
            or a seller following a row into its detail page is told two
            different things about one order. */}
        <span className="sales__state">{stateLabel(sale.state)}</span>
        {/* `formatEntryTime` reads as a ledger name and is in fact the app's
            one ISO-to-local-time formatter — absolute, never relative, so a
            screenshot still means the same thing tomorrow. Reusing it beats a
            second `Intl.DateTimeFormat` here that would drift into a second
            answer to what a timestamp looks like on this product. */}
        <span className="sales__time">{formatEntryTime(sale.createdAt)}</span>
        {disputed ? <span className="sales__dispute-flag">Disputed</span> : null}
      </Link>
    </li>
  );
}
