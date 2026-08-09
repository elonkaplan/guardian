import type { JSX } from 'react';

import type { Order } from '../api/types';
import { formatUsd } from '../lib/money';
import { stateLabel } from '../lib/orderState';

interface OrderSummaryHeaderProps {
  /** The order as the backend last reported it — the whole record, not a face-specific slice. */
  order: Order;
}

/**
 * The band that does not move.
 *
 * The order screen is one page wearing five faces, and the body underneath this
 * component is replaced outright as the order travels: the agent is working, then
 * a result is under review, then a complaint is being arbitrated, then it is over.
 * What was ordered, what it cost, and which order this is are true in all five of
 * those moments, so they are rendered once, above the switch, and left alone
 * (FR-003). The alternative — each face composing its own heading — is how the
 * price ends up in a different place on the delivered face than on the working
 * one, and a buyer watching the page change under them reads that shift as the
 * page having navigated somewhere else.
 *
 * Which is what makes the fixed position the point rather than a layout detail.
 * Someone reloading mid-flight, or landing cold on an order that settled an hour
 * ago, must find the same identity in the same spot; that is the difference
 * between a page that is following one order and five pages that happen to share
 * a URL.
 *
 * The state chip carries a `--{state}` modifier so CSS can give arbitration a
 * different colour from a clean release. It is the raw backend state in the class
 * name and `stateLabel` in the text on purpose: the words are a vocabulary owned
 * by `lib/orderState` and shared with anything else that names a state, while the
 * class is a stable hook that does not churn when the copy is reworded.
 *
 * Presentational and nothing else. No links, no actions, no polling, no reading
 * of the clock — the page owns the live order and hands it down. A component that
 * fetched on its own would be a second reader of the same order, free to disagree
 * with the face rendered beneath it.
 */
export function OrderSummaryHeader({ order }: OrderSummaryHeaderProps): JSX.Element {
  return (
    <header className="order-summary">
      <div className="order-summary__identity">
        <h1 className="order-summary__agent">{order.agentName}</h1>
        {/*
          The id is a 36-character uuid: at full length it is the widest thing in
          the band and reads as noise, so the first segment is shown and the whole
          value hangs off `title` for the moment someone actually needs it — quoting
          the order in a support message, or checking two tabs are on the same one.
          The full string stays in the DOM's title attribute rather than being
          discarded, so it remains copyable and findable.
        */}
        <p className="order-summary__id" title={order.id}>
          <span className="order-summary__id-label">Order</span>
          <span className="order-summary__id-value">{shortenId(order.id)}</span>
        </p>
      </div>

      <div className="order-summary__meta">
        {/*
          The price is labelled because an unlabelled currency figure next to an
          agent's name is ambiguous in exactly the wrong direction — it could be
          read as the agent's rate, a balance, or an amount owed. This is what this
          order cost, fixed at purchase.
        */}
        <p className="order-summary__figure">
          <span className="order-summary__figure-label">Price</span>
          <span className="order-summary__figure-value">{formatUsd(order.priceMinor)}</span>
        </p>
        <span className={`order-summary__chip order-summary__chip--${order.state}`}>
          {stateLabel(order.state)}
        </span>
      </div>
    </header>
  );
}

/**
 * First uuid segment. Deliberately not a general-purpose truncator: ids in this
 * app are uuids, whose first group is eight hex characters and enough to tell two
 * open orders apart at a glance. Anything shorter stays whole rather than being
 * cut into something that looks broken.
 */
function shortenId(id: string): string {
  const firstSegment = id.split('-')[0] ?? '';
  return firstSegment.length >= 8 ? firstSegment : id;
}
