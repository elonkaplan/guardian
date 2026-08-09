import { Link, useParams } from 'react-router-dom';

import type { Order } from '../api/types';
import { CaseFilePanel } from '../components/CaseFilePanel';
import { LoadState } from '../components/LoadState';
import { OrderSummaryHeader } from '../components/OrderSummaryHeader';
import { VerdictCard } from '../components/VerdictCard';
import { useCaseFile } from '../hooks/useCaseFile';
import { useOrder } from '../hooks/useOrder';
import { useVerdict } from '../hooks/useVerdict';
import { paths } from '../routes/paths';

/**
 * The seller's side of a dispute — and the deliberate absence at the bottom of
 * it.
 *
 * A seller whose work has been complained about receives the full case file and
 * Guardian's reasoning: the buyer's input, the buyer's criteria, the listing
 * text their order pinned, what the agent returned, what it did along the way,
 * the tier, the citations, and the split. What they do not receive is a reply
 * box.
 *
 * **That absence is the product decision this screen exists to make legible**
 * (`docs/product-workflow.md` §7.5, §4.4). Notification is not appeal, and the
 * two are easy to confuse in the wrong direction: a page that shows a ruling and
 * offers nothing looks like a form somebody never got round to building, and a
 * seller reading it concludes the product is unfinished rather than that it made
 * a choice. So the screen says so, in words, beneath the ruling — which is also
 * why the sentence sits *after* the verdict rather than before it. Read first it
 * is a disclaimer; read last it is an explanation.
 *
 * There is correspondingly **no control here to reply, appeal, respond, contest,
 * or comment — not disabled, not behind a menu, absent** (FR-032). A disabled
 * button would be a promise that this arrives one day, which is a different
 * product from the one that was decided on.
 *
 * ---
 *
 * **The data is the buyer's data, read by the other party.** api-design §3.4
 * authorises `GET /orders/:id`, the case file, and the verdict for the buyer *or*
 * the agent's owner, so this screen follows the order through the same `useOrder`
 * the buyer's screen uses and inherits four behaviours it would otherwise have
 * had to reinvent: a one-second poll while the order can still change, stopping
 * dead on a terminal state; 404 and 403 as an end rather than a question asked
 * once a second forever; the monotonic guard that stops a page which has shown a
 * verdict from dropping back to "the agent is working"; and a stale notice over
 * a screen that still reads correctly rather than a blanked ruling.
 *
 * That last set is not incidental. This is a screen where a ruling lands while
 * somebody is watching it, so it wants every one of them. An earlier plan had it
 * polling the whole `GET /sales` list every five seconds and picking its row out
 * of the result, because the order read was assumed to be the buyer's alone
 * (research R7); everything above is what that substitute could not have done.
 *
 * The three panels fail independently and none can blank another — the summary
 * band comes from the order, the ruling from `useVerdict`, the evidence from
 * `useCaseFile` (FR-035).
 */
export function SellerSalePage() {
  const { id } = useParams<{ id: string }>();
  const { order, error, notFound, stale, refetch } = useOrder(id as string);

  // A bad id and somebody else's sale are the same dead end from here, and the
  // poll has already stopped for both. `useOrder` treats 403 as fatal, which is
  // what an order placed against another seller's agent returns — so this branch
  // is reached without the screen ever having to reason about ownership itself.
  if (notFound) {
    return (
      <section className="seller-sale seller-sale--missing">
        <h1 className="seller-sale__missing-title">No such sale</h1>
        <p className="seller-sale__missing-note">
          This order does not exist, or it was not placed against one of your agents.
        </p>
        <Link to={paths.sell()}>Back to your sales</Link>
      </section>
    );
  }

  if (order === undefined) {
    if (error !== null) {
      return (
        <section className="seller-sale seller-sale--missing">
          <LoadState status="error" message={error.message} onRetry={refetch} />
          <Link to={paths.sell()}>Back to your sales</Link>
        </section>
      );
    }
    return <LoadState status="loading" message="Loading this sale…" />;
  }

  return (
    <section className="seller-sale">
      <p className="seller-sale__breadcrumb">
        <Link to={paths.sell()}>← Your sales</Link>
      </p>

      {/*
        The buyer's summary band, unchanged and unedited. "Order", "Price", and
        the state chip are true from either side of a trade — the seller really
        is looking at an order, the one placed against their agent — so forking
        the vocabulary here would be inventing a disagreement rather than
        avoiding one.
      */}
      <OrderSummaryHeader order={order} />

      {stale ? (
        <p className="seller-sale__stale" role="status">
          Live updates are not getting through just now. What you see below is the last
          state we were able to read; it will catch up on its own.
        </p>
      ) : null}

      <SaleBody order={order} />
    </section>
  );
}

/**
 * Three states, and the one that is easiest to get wrong is the first.
 *
 * A sale that was never disputed is not an error and not an empty case file — it
 * is an ordinary trade that went fine, and the screen says so (FR-036). Reaching
 * this page for such a sale is entirely normal: every row in the sales list links
 * here, because a seller clicking a sale to see what happened to it should not
 * have to learn which rows are clickable.
 */
function SaleBody({ order }: { order: Order }) {
  // Keyed on the fact rather than on the state, following `ConcludedFace`:
  // `disputedAt` is true from the moment a complaint is filed and stays true
  // through every state after it, so a state inserted later in the lifecycle
  // cannot silently drop the evidence.
  const disputed = order.disputedAt !== null;
  const { verdict, error, settlementPending, refetch } = useVerdict(order.id, order.state);
  const caseFile = useCaseFile(order.id, disputed);

  if (!disputed) {
    return (
      <div className="seller-sale__body seller-sale__body--undisputed">
        <h2 className="seller-sale__heading">No dispute on this sale</h2>
        <p className="seller-sale__note">
          Nobody complained about this order, so there is no case file and no ruling. The
          state above is the whole story.
        </p>
      </div>
    );
  }

  const ruled = order.state === 'adjudicated' || order.state === 'settled';

  return (
    <div className="seller-sale__body">
      {ruled ? (
        <>
          <VerdictCard
            order={order}
            verdict={verdict}
            error={error}
            settlementPending={settlementPending}
            onRetry={refetch}
            perspective="seller"
          />

          {/*
            FR-033. The sentence that turns an absence into a decision.
            It names what the seller *does* get, states the rule, and makes the
            symmetry explicit — neither side replies — so the screen does not
            read as the seller being the party who was shut out.
          */}
          <p className="seller-sale__finality">
            You are notified of this outcome, and Guardian&rsquo;s reasoning is above in
            full. Verdicts are final — there is no appeal, and no reply is collected from
            either side.
          </p>
        </>
      ) : (
        <>
          <h2 className="seller-sale__heading">Guardian is reviewing this sale</h2>
          <p className="seller-sale__note">
            The buyer has complained, and Guardian is weighing your stated capabilities and
            exclusions against their acceptance criteria and what your agent delivered. The
            ruling appears here on its own — you do not need to stay on this page, and you
            do not need to refresh it.
          </p>
          <p className="seller-sale__finality">
            You are notified so that you can see the case being made. There is no reply to
            file: verdicts are final, and neither side argues one.
          </p>
        </>
      )}

      {/*
        Expanded while there is no ruling, because then it is the only thing on
        the page worth reading; collapsed beneath the verdict once one exists,
        because then the card is the answer and this is the working behind it.
        The same rule the buyer's two faces use.
      */}
      <CaseFilePanel
        caseFile={caseFile.caseFile}
        error={caseFile.error}
        loading={caseFile.loading}
        defaultOpen={!ruled}
        onRetry={caseFile.refetch}
        perspective="seller"
      />
    </div>
  );
}
