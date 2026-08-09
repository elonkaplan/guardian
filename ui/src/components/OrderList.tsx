import type { JSX } from 'react';
import { Link } from 'react-router-dom';

import type { ApiError } from '../api/errors';
import type { BuyerOrderSummary } from '../api/types';
import { formatEntryTime } from '../lib/ledger';
import { formatUsd } from '../lib/money';
import { stateLabel } from '../lib/orderState';
import { paths } from '../routes/paths';
import { LoadState } from './LoadState';

interface OrderListProps {
  /** `GET /orders`, once it has answered. `undefined` while the first read is
   *  still in flight — which is not the same thing as an empty array, and the
   *  two say opposite things to a buyer. */
  orders: BuyerOrderSummary[] | undefined;
  /** The last fetch failure, if the fetch failed. `null` otherwise. */
  error: ApiError | null;
  /** True only while a read is in flight with nothing to show behind it. */
  loading: boolean;
  /** Refetch this list. */
  onRetry(): void;
}

/**
 * Every order this account has bought — the buyer's side of `SalesList`, and
 * the only screen in the product that shows more than one trade at a time.
 *
 * **Its own component rather than a shared one parameterised by perspective,**
 * and the contract is explicit about why: `SaleResponse` is *"deliberately
 * narrower than `BuyerOrderSummary`: there is no `deliveredAt` field here at
 * all, not merely a null one. A seller list must not be rendered with buyer-list
 * code that reads it."* A generic row reading `deliveredAt` off a `Sale` would
 * type-check the moment someone widened the prop to a union, and would then
 * render an always-empty column on the seller's screen that nobody would think
 * to question. Two components duplicate about thirty lines of markup and make
 * that mistake impossible to commit.
 *
 * **Two marks, and they are keyed on opposite things on purpose.** This is the
 * part of the file most likely to be "made consistent" by someone reading half
 * of it, so both halves are written down:
 *
 * - *Disputed* is keyed on `disputedAt`, never on `state === 'disputed'`, on the
 *   reasoning `SalesList` and `ConcludedFace` both give: the timestamp stays
 *   true through `adjudicated` and `settled`, whereas the state test loses the
 *   mark the moment Guardian rules, and would silently drop it off every row
 *   that carries it today if a state were inserted later in the lifecycle. The
 *   question it answers is *did this ever go wrong*, and that is a fact about
 *   the past which no later state can un-make.
 * - *Needs your review* is keyed on `state === 'delivered'`, and must **not** be
 *   rewritten as `deliveredAt !== null` to match the line above. The question it
 *   answers is *is this waiting on you right now*, which is a fact about the
 *   present. `deliveredAt` is set at delivery and stays set through `released`
 *   and `settled`, so keying on it would flag every order the buyer has ever
 *   accepted as still owing them a decision — the page's one urgent signal,
 *   attached permanently to rows where nothing is owed, which is the same as
 *   having no signal. `delivered` is precisely the state where the money has not
 *   moved and the buyer is the one holding it up.
 *
 * That asymmetry is why `deliveredAt` is declared on the type and read by
 * nothing here. It is the contract's field and the type is a transcription of
 * the contract; the row's use for it is the state that follows from it.
 *
 * Both marks are words, not colours, for the projector-and-greyscale reason
 * `LedgerTable` gives; the rules beside them are reinforcement.
 *
 * **No countdown here, and that is the contract's doing.**
 * `BuyerOrderSummary` carries no `reviewWindowSeconds`, so there is no honest
 * way to say how long is left — the window is snapshotted per order at purchase
 * and reading a default from anywhere else would retime orders that were sold
 * under a different one. The row says review is owed; the order's own screen,
 * one click away, has the field and runs the clock. A list that quietly counted
 * down from an assumed 120 seconds would be worse than one that does not count
 * at all.
 *
 * **A state this build has never heard of still gets its row.** Nothing in this
 * file arranges that: `stateLabel` is exhaustively switched over `OrderState`
 * with no `default`, so a ninth backend state is a compile error in
 * `lib/orderState.ts` rather than an order that vanishes from a buyer's history.
 * The vocabulary is that function's and never a second one invented here, or a
 * buyer following a row into its detail page would be told two different things
 * about one order.
 *
 * The whole row is the link, on `AgentCard`'s reasoning: a row is one
 * proposition, so all of it should behave like one target.
 *
 * Rows are keyed by `order.id`, never by array index. This list polls at 5s and
 * a new order lands at the top, which under an index key would look to React
 * like every row beneath it changing identity at once — throwing away the scroll
 * position of someone reading their own history.
 */
export function OrderList({ orders, error, loading, onRetry }: OrderListProps): JSX.Element {
  return (
    // Busy for the first read only. The 5s poll refreshes these rows in place
    // and must not announce itself.
    <section className="orders-list" aria-label="Your orders" aria-busy={loading}>
      {renderBody(orders, error, onRetry)}
    </section>
  );
}

function renderBody(
  orders: BuyerOrderSummary[] | undefined,
  error: ApiError | null,
  onRetry: () => void,
): JSX.Element {
  // Nothing has arrived yet. `error` decides which placeholder this is, not
  // whether a request is in flight: the poll behind a failed first read fires
  // again every five seconds, and letting that flip the panel back to
  // "Loading…" would blink the retry button out from under the person trying to
  // press it. Once `orders` exists, even empty, a later failure is a failed
  // refresh and the rows already on screen stay on screen.
  if (orders === undefined) {
    if (error !== null) {
      return (
        <LoadState status="error" message="Your orders could not be loaded." onRetry={onRetry} />
      );
    }
    return <LoadState status="loading" message="Loading your orders…" />;
  }

  if (orders.length === 0) {
    return (
      // No retry button — an account that has never bought anything is the
      // system answering correctly, and an apologetic empty state would teach a
      // buyer to suspect the backend every time they open a screen that works.
      // The way out of the emptiness sits inside it, as it does on the seller's
      // side: the marketplace is the only thing that turns this page into a
      // list.
      <div className="orders-list__empty">
        <LoadState status="empty" message="You have not bought anything yet." />
        <Link className="orders-list__empty-link" to={paths.marketplace()}>
          Browse the marketplace
        </Link>
      </div>
    );
  }

  const sorted = sortOrdersNewestFirst(orders);

  return (
    <div className="orders-list__scroll">
      <ul className="orders-list__list">
        {sorted.map((order) => (
          <OrderRow key={order.id} order={order} />
        ))}
      </ul>
    </div>
  );
}

/**
 * Newest first, on a copy.
 *
 * The contract already promises this ordering, so the sort is belt-and-braces —
 * but it is cheap, and the alternative is a list whose ordering silently depends
 * on a backend detail no screen would report if it changed. The copy is not
 * defensive habit: `orders` belongs to the hook that fetched it, and sorting in
 * place would reorder an array another reader may hold. The stable sort —
 * guaranteed since ES2019 — keeps two orders placed in the same second in the
 * order the server sent them rather than swapping them on every poll tick, which
 * would read as the list shuffling itself for no reason. `SalesList` and
 * `LedgerTable` sort the same way, for the same reasons.
 */
function sortOrdersNewestFirst(orders: BuyerOrderSummary[]): BuyerOrderSummary[] {
  return [...orders].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

function OrderRow({ order }: { order: BuyerOrderSummary }): JSX.Element {
  // The buyer is the one holding this order up: it was delivered, the review
  // window is running, and nothing moves until they accept or complain. `state`
  // and not `deliveredAt !== null` — see the docblock; the timestamp survives
  // acceptance and would mark every finished order as still owing a decision.
  const needsReview = order.state === 'delivered';
  const disputed = order.disputedAt !== null;

  const rowClass = [
    'orders-list__row',
    needsReview ? 'orders-list__row--review' : '',
    disputed ? 'orders-list__row--disputed' : '',
  ]
    .filter((token) => token !== '')
    .join(' ');

  return (
    <li className={rowClass}>
      <Link className="orders-list__link" to={paths.orderDetail(order.id)}>
        <span className="orders-list__agent">{order.agentName}</span>
        {/* Integer cents through `formatUsd`, like every amount in this app. */}
        <span className="orders-list__amount">{formatUsd(order.priceMinor)}</span>
        <span className="orders-list__state">{stateLabel(order.state)}</span>
        {/* `formatEntryTime` reads as a ledger name and is in fact this app's one
            ISO-to-local-time formatter — absolute, never relative, so a
            screenshot still means the same thing tomorrow. Reusing it beats a
            second `Intl.DateTimeFormat` here that would drift into a second
            answer to what a timestamp looks like on this product. */}
        <span className="orders-list__time">{formatEntryTime(order.createdAt)}</span>
        {/* Mutually exclusive in practice — a disputed order is no longer
            `delivered` — but written as two independent tests rather than an
            if/else, because each is keyed on its own fact and neither should
            start depending on the other's absence to be correct. */}
        {needsReview ? <span className="orders-list__flag-review">Needs your review</span> : null}
        {disputed ? <span className="orders-list__flag-disputed">Disputed</span> : null}
      </Link>
    </li>
  );
}
