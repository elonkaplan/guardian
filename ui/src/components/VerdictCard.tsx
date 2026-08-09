import type { JSX } from 'react';

import type { ApiError } from '../api/errors';
import type { Order, Verdict } from '../api/types';
import { formatUsd } from '../lib/money';
import { splitFor, tierDisplay } from '../lib/verdict';
import { CitationChecklist } from './CitationChecklist';
import { TxHashLink } from './TxHashLink';

interface VerdictCardProps {
  /** The order the ruling is about — the source of the price the split reconciles to. */
  order: Order;
  /** Undefined until the ruling has been read. */
  verdict: Verdict | undefined;
  error: ApiError | null;
  /** A ruling exists but the escrow split has not executed yet. */
  settlementPending: boolean;
  onRetry: () => void;
}

/**
 * The component that decides whether this product's arbitration reads as
 * credible or as "the AI decided something".
 *
 * Everything else in the app is a way of getting a buyer to this card. It is
 * also the place where the argument is most easily lost, because the losing
 * version is the one that looks finished: a tier, two figures, and a
 * well-written paragraph. That card is *correct* and it is worth nothing — it
 * asks the reader to believe a model. The card below spends its layout budget
 * on the clause checklist instead, and treats the reasoning as the paragraph
 * that supports it.
 *
 * Hence the ordering, which is a deliberate departure from the sketch in
 * `docs/ui-design.md` §2.2: the mockup there shows the reasoning above the
 * citations, and this renders the checklist first with the reasoning beneath
 * (FR-005, US1 scenario 6). The sketch predates the requirement and the
 * requirement is the sharper statement of the same intent — whichever comes
 * first is what the room reads as the ruling's basis, and the whole point is
 * that the basis is a set of quoted clauses rather than a summary of them.
 *
 * Three failure surfaces are load-bearing here rather than defensive polish:
 *
 * **It can never be blank.** This card occupies the region UI-04 reserved with a
 * placeholder specifically so that a rehearsal reaching `settled` would not find
 * a hole where the outcome belongs (FR-034, inherited from the deleted
 * `VerdictSlot`'s FR-007). A failed read renders a labelled region with a retry;
 * a pending read says it is reading. Neither renders nothing.
 *
 * **The split comes from the settled amount.** `splitFor` is handed the price
 * and the recorded refund, never the tier's percentage (FR-004) — see
 * `lib/verdict.ts` for why the arithmetic is not allowed to happen twice.
 *
 * **The transaction is a separate claim from the ruling.** A verdict can exist
 * with no transaction (the escrow has not split yet), so `TxHashLink` gets the
 * order's state and decides for itself; this component never fabricates a
 * pending link.
 */
export function VerdictCard({
  order,
  verdict,
  error,
  settlementPending,
  onRetry,
}: VerdictCardProps): JSX.Element {
  if (verdict === undefined) {
    return (
      <section className="verdict-card verdict-card--unread" aria-label="Verdict">
        <h2 className="verdict-card__heading">Outcome</h2>
        {error === null ? (
          <p className="verdict-card__note">Reading the ruling on this order…</p>
        ) : (
          <>
            {/*
              The conclusion of the record could not be read. Said plainly, with a
              way to try again, and with the case file below still rendering from
              its own request (FR-035) — one panel's failure does not get to blank
              the other.
            */}
            <p className="verdict-card__error">
              Guardian&rsquo;s ruling could not be loaded just now. The order is settled
              and the ruling exists; this is a problem reading it, not a missing verdict.
            </p>
            <p className="verdict-card__error-detail">{error.message}</p>
            <button type="button" className="verdict-card__retry" onClick={onRetry}>
              Try again
            </button>
          </>
        )}
      </section>
    );
  }

  const tier = tierDisplay(verdict.tier);
  const split = splitFor(order.priceMinor, verdict.refundMinor);

  return (
    <section className="verdict-card" aria-label="Verdict">
      <header className="verdict-card__header">
        <h2 className="verdict-card__heading">Verdict</h2>
        <p className="verdict-card__badge">
          {/*
            The percentage and the phrase are one claim, not two. "50%" alone
            does not say of what or to whom, and the two money figures below
            answer both — but a room remembers the badge, so it carries the
            proportion in the form people repeat.
          */}
          {tier.percent !== null && (
            <span className="verdict-card__badge-percent">{tier.percent}%</span>
          )}
          <span className="verdict-card__badge-phrase">{tier.phrase}</span>
        </p>
      </header>

      <Split split={split} />

      {/*
        The checklist leads. This is the feature.
      */}
      <CitationChecklist
        citations={verdict.citations}
        unreadableCount={verdict.unreadableCitations}
      />

      {verdict.reasoning.trim() !== '' && (
        <div className="verdict-card__reasoning">
          <h3 className="verdict-card__reasoning-heading">How Guardian read it</h3>
          {/*
            Pre-wrapped through the class so the ruling's own paragraph breaks
            survive. This is a quotation of a decision, and reflowing it would be
            editing the record.
          */}
          <p className="verdict-card__reasoning-text">{verdict.reasoning}</p>
        </div>
      )}

      <footer className="verdict-card__footer">
        <TxHashLink txHash={verdict.txHash} state={order.state} />
        {settlementPending && (
          <p className="verdict-card__settling" role="status">
            The ruling is final. The escrow is being split now — this page is following
            the order and will show the transaction as soon as it lands.
          </p>
        )}
      </footer>
    </section>
  );
}

/**
 * The two money figures, and the one case where there are not two.
 *
 * Both are always labelled by who receives them, and they always sum to what was
 * paid (FR-003) — including at the extremes, where a `none` verdict still shows
 * the buyer's zero and a `full` verdict still shows the seller's. Dropping the
 * zero side would turn a settlement into an announcement.
 *
 * The `ok: false` branch is what a reconciliation failure looks like on screen:
 * the refund as recorded, a dash where the seller's share would be, and a line
 * saying the figures do not add up. It is deliberately ugly. The alternative —
 * clamping into two figures that sum neatly and quietly disagree with the chain
 * — would be the one lie this screen cannot afford, because every other claim
 * here is offered as checkable.
 */
function Split({ split }: { split: ReturnType<typeof splitFor> }): JSX.Element {
  return (
    <div className="verdict-card__split">
      <p className="verdict-card__figure">
        <span className="verdict-card__figure-label">You get back</span>
        <span className="verdict-card__figure-value">{formatUsd(split.buyerMinor)}</span>
      </p>
      <p className="verdict-card__figure">
        <span className="verdict-card__figure-label">The seller keeps</span>
        <span className="verdict-card__figure-value">
          {split.ok ? (
            formatUsd(split.sellerMinor)
          ) : (
            <span className="verdict-card__figure-unknown">—</span>
          )}
        </span>
      </p>
      {!split.ok && (
        <p className="verdict-card__reconcile">
          The refund recorded with this ruling does not reconcile with the price paid, so
          the seller&rsquo;s share is not shown. The transaction below is the record of
          what actually moved.
        </p>
      )}
    </div>
  );
}
