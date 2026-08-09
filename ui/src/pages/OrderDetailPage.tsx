import { Link, useParams } from 'react-router-dom';

import type { Order } from '../api/types';
import { CaseFilePanel } from '../components/CaseFilePanel';
import { CriteriaPanel } from '../components/CriteriaPanel';
import { LoadState } from '../components/LoadState';
import { OrderActions } from '../components/OrderActions';
import { OrderSummaryHeader } from '../components/OrderSummaryHeader';
import { OutputPanel } from '../components/OutputPanel';
import { ReviewCountdown } from '../components/ReviewCountdown';
import { SubmittedInput } from '../components/SubmittedInput';
import { VerdictCard } from '../components/VerdictCard';
import { useCaseFile } from '../hooks/useCaseFile';
import { useCountdown } from '../hooks/useCountdown';
import { useNow } from '../hooks/useNow';
import { useOrder } from '../hooks/useOrder';
import { useVerdict } from '../hooks/useVerdict';
import { formatElapsed } from '../lib/duration';
import type { OrderFace } from '../lib/orderState';
import { faceFor } from '../lib/orderState';
import { paths } from '../routes/paths';

/**
 * One page, five faces, and the demo happens on all of them.
 *
 * This is the only screen in the product that changes while nobody is touching it,
 * and that is not a flourish — it is the argument. An order moves from "the agent is
 * working" to a delivered result, through a review window that runs down in front of
 * the buyer, and out to either a release or a verdict, without a navigation and
 * without a refresh. A buyer who has to press anything to find out what happened is
 * being told that the escrow is a database column.
 *
 * So the structure here is deliberately flat: `useOrder` yields a face, and the face
 * picks a body. What stays put across all five — what was bought, what it cost, what
 * state it is in — lives in `OrderSummaryHeader` above the switch, so reloading
 * mid-flight or landing on a settled order puts the same identity band in the same
 * place. Nothing in this file decides *when* to update; that is the hook's job.
 */
export function OrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { order, error, notFound, stale, refetch } = useOrder(id as string);

  // An unknown id and someone else's order are the same dead end from here, and
  // neither improves by asking again — the poll has already stopped. The only useful
  // move is back to the list of orders that *are* ours.
  if (notFound) {
    return (
      <section className="order order--missing">
        <h1 className="order__missing-title">No such order</h1>
        <p className="order__missing-note">
          This order does not exist, or it belongs to a different account.
        </p>
        <Link to={paths.orders()}>Back to your orders</Link>
      </section>
    );
  }

  // A failure with nothing behind it is the whole screen. A failure with an order
  // behind it is not: that case falls through to the normal render and shows the
  // quiet notice below, because wiping out a delivered output the buyer is reading
  // in order to report a blip is a worse outcome than the blip.
  if (order === undefined) {
    if (error !== null) {
      return (
        <section className="order order--missing">
          <LoadState status="error" message={error.message} onRetry={refetch} />
          <Link to={paths.orders()}>Back to your orders</Link>
        </section>
      );
    }
    return <LoadState status="loading" message="Loading this order…" />;
  }

  return (
    <section className="order">
      <p className="order__breadcrumb">
        <Link to={paths.orders()}>← Your orders</Link>
      </p>

      <OrderSummaryHeader order={order} />

      {stale ? (
        <p className="order__stale" role="status">
          Live updates are not getting through just now. What you see below is the last
          state we were able to read; it will catch up on its own.
        </p>
      ) : null}

      <OrderBody order={order} />
    </section>
  );
}

function OrderBody({ order }: { order: Order }) {
  // Derived here rather than threaded down from the hook: `useOrder` reports the face
  // as possibly-undefined because it may have no order yet, and by this point we
  // demonstrably do. Re-deriving is cheaper than a cast that claims what the type
  // system can already see.
  const face: OrderFace = faceFor(order.state);

  switch (face) {
    case 'working':
      return <WorkingFace order={order} />;
    case 'review':
      return <ReviewFace order={order} />;
    case 'concluded':
      return <ConcludedFace order={order} />;
    case 'nothing-came-back':
      return <NothingCameBackFace order={order} />;
    case 'arbitration':
      return <ArbitrationFace order={order} />;
  }
}

/**
 * The deadline the countdown runs to, or null when there is nothing to count.
 *
 * Composed from the order's own `reviewWindowSeconds` — a snapshot taken at purchase,
 * never a live read of backend configuration — so an order always displays the window
 * it was actually sold under, even if the operator turns the default down mid-demo.
 *
 * An unparseable `deliveredAt` yields null rather than NaN. A NaN deadline would
 * propagate into the countdown and surface as an em dash where the demo's most
 * important number belongs, which is a worse failure than showing no clock at all.
 */
function reviewDeadline(order: Order): number | null {
  if (order.deliveredAt === null) {
    return null;
  }
  const deliveredAt = Date.parse(order.deliveredAt);
  if (!Number.isFinite(deliveredAt)) {
    return null;
  }
  return deliveredAt + order.reviewWindowSeconds * 1000;
}

/**
 * `purchased` and `running`: the agent has the job and has not answered yet.
 *
 * There is nothing to judge here, so the face does the one useful thing available —
 * it shows the buyer what they actually submitted, which is the only question they
 * can answer while waiting ("did I paste the right receipt?"), and it shows that time
 * is passing. The elapsed line matters more than it looks: without it, a slow
 * execution and a hung one are the same screen.
 */
function WorkingFace({ order }: { order: Order }) {
  const now = useNow(1000);
  const elapsed = formatElapsed(now - Date.parse(order.createdAt));

  return (
    <div className="order__face order__face--working">
      <h2 className="order__face-title">The agent is working…</h2>
      <p className="order__elapsed">
        <span className="order__elapsed-label">Elapsed</span>
        <span className="order__elapsed-value">{elapsed}</span>
      </p>
      <SubmittedInput run={order.run} />
    </div>
  );
}

/**
 * `delivered`: the work is back and the clock is running.
 *
 * This is the face the demo is built around. The countdown leads, because it is the
 * visible proof that the escrow is time-locked and Act 1 ends with it reaching zero
 * unattended. The output and the buyer's own criteria sit side by side beneath it,
 * and the two actions come last.
 */
function ReviewFace({ order }: { order: Order }) {
  const { remainingMs, expired } = useCountdown(reviewDeadline(order));

  return (
    <div className="order__face order__face--review">
      <ReviewCountdown remainingMs={remainingMs} expired={expired} />

      {/*
        Side by side, and the order matters: the result on the left, the words the
        buyer wrote before any work existed on the right. Stacked vertically the
        comparison evaporates and the audience is asked to take the verdict on
        trust, which is the one thing this screen exists not to do.
      */}
      <div className="order__review-columns">
        <OutputPanel output={order.run?.output ?? null} />
        <CriteriaPanel criteria={order.acceptanceCriteria} />
      </div>

      {/*
        Withdrawn once the window has run out. Both actions would be refused by the
        backend at that point, and offering a button whose only possible outcome is
        an error is worse than offering none — the countdown has already said why.
      */}
      {expired ? null : <OrderActions order={order} />}

      <SubmittedInput run={order.run} />
    </div>
  );
}

/**
 * `failed`: execution produced nothing.
 *
 * The whole of this face is refusing to be ambiguous about that. An empty output
 * panel and a spinner that never resolves are both available failure modes here, and
 * both read as the interface being broken rather than the agent. So it says the thing
 * in plain words, offers no countdown — there was no delivery for a window to run
 * from — and offers the one action that makes sense. Non-delivery is explicitly in
 * scope for arbitration (`docs/product-workflow.md` §4.3); this is not a dead end.
 *
 * Note the page is still polling here. `failed` is not terminal precisely because the
 * complaint transition has to appear on screen.
 */
function NothingCameBackFace({ order }: { order: Order }) {
  return (
    <div className="order__face order__face--failed">
      <h2 className="order__face-title">The agent returned nothing</h2>
      <p className="order__face-note">
        This run produced no output at all. You paid for work that was not delivered,
        which is exactly the kind of case Guardian arbitrates — file a complaint and
        it will read the listing, your criteria, and the empty result.
      </p>

      <div className="order__review-columns">
        <CriteriaPanel criteria={order.acceptanceCriteria} />
      </div>

      <OrderActions order={order} />
      <SubmittedInput run={order.run} />
    </div>
  );
}

/**
 * `disputed` and `adjudicated`: the case is with Guardian.
 *
 * Nothing to do and nothing to press — which is the point. The buyer has spent their
 * one irreversible action and the honest thing is to say what is happening and keep
 * following the order, rather than to invent a control.
 *
 * What there is to do is read. The case file opens expanded here, because during
 * arbitration it is the only thing on the page worth looking at and the face would
 * otherwise be a sentence and a spinner; on the concluded face it starts collapsed
 * beneath the ruling instead (FR-020, FR-024).
 */
function ArbitrationFace({ order }: { order: Order }) {
  const { verdict, error, settlementPending, refetch } = useVerdict(order.id, order.state);
  const caseFile = useCaseFile(order.id, order.disputedAt !== null);

  return (
    <div className="order__face order__face--arbitration">
      <h2 className="order__face-title order__face-title--arbitration">
        Guardian is reviewing this order
      </h2>
      <p className="order__face-note order__face-note--arbitration">
        Your complaint has been filed and cannot be withdrawn. Guardian is weighing the
        seller&rsquo;s stated capabilities and exclusions against your acceptance
        criteria and the delivered result. The ruling appears here on its own — you do
        not need to stay on this page, and you do not need to refresh it.
      </p>

      {/*
        `adjudicated` is the half of this face where a ruling already exists and the
        escrow has not split yet, so the card renders in full — tier, split,
        checklist — with a settlement-pending line where the transaction will go. The
        hook is called unconditionally and decides for itself whether to fetch, which
        is why `disputed` costs no request.
      */}
      {order.state === 'adjudicated' ? (
        <VerdictCard
          order={order}
          verdict={verdict}
          error={error}
          settlementPending={settlementPending}
          onRetry={refetch}
          perspective="buyer"
        />
      ) : null}

      <CaseFilePanel
        caseFile={caseFile.caseFile}
        error={caseFile.error}
        loading={caseFile.loading}
        defaultOpen
        onRetry={caseFile.refetch}
        perspective="buyer"
      />

      <div className="order__review-columns">
        <OutputPanel output={order.run?.output ?? null} />
        <CriteriaPanel criteria={order.acceptanceCriteria} />
      </div>

      <SubmittedInput run={order.run} />
    </div>
  );
}

/**
 * `released` and `settled`: nothing further can happen to this order.
 *
 * The two endings are not interchangeable and the copy must not treat them as one.
 * `released` is the uncontested path — the window closed, or the buyer accepted, and
 * the seller was paid in full. There is no ruling on that path and so no verdict card;
 * conflating the two would put a refund tier on an order nobody ever disputed.
 * `settled` is the end of a dispute, and the card is the whole of what belongs here.
 */
function ConcludedFace({ order }: { order: Order }) {
  const { verdict, error, settlementPending, refetch } = useVerdict(order.id, order.state);
  // Keyed on the fact rather than the state: `disputedAt` is true of the order from the
  // moment a complaint is filed and stays true through every state after it, so a state
  // inserted later in the lifecycle cannot silently drop the evidence. A `released`
  // order has none, and asks for none (FR-025).
  const disputed = order.disputedAt !== null;
  const caseFile = useCaseFile(order.id, disputed);

  return (
    <div className="order__face order__face--concluded">
      {order.state === 'released' ? (
        <>
          <h2 className="order__face-title">Released — the seller has been paid</h2>
          <p className="order__face-note">
            The review window closed without a complaint, so the escrow paid out in
            full. Nothing further is owed and nothing can be disputed now.
          </p>
        </>
      ) : (
        <VerdictCard
          order={order}
          verdict={verdict}
          error={error}
          settlementPending={settlementPending}
          onRetry={refetch}
          perspective="buyer"
        />
      )}

      {/*
        Collapsed, and beneath the ruling. On this face the card is the answer and the
        case file is the working behind it, so it starts closed — a reader who wants the
        evidence is one click away, and one who does not is not made to scroll past it
        to reach the record below (FR-024).
      */}
      {disputed ? (
        <CaseFilePanel
          caseFile={caseFile.caseFile}
          error={caseFile.error}
          loading={caseFile.loading}
          defaultOpen={false}
          onRetry={caseFile.refetch}
          perspective="buyer"
        />
      ) : null}

      {/*
        The record stays whole. A settled order is the one a buyer comes back to
        months later to see what they bought, what they asked for, and what arrived,
        so the panels do not disappear once the outcome is known — they become the
        evidence the outcome refers to.
      */}
      <div className="order__review-columns">
        <OutputPanel output={order.run?.output ?? null} />
        <CriteriaPanel criteria={order.acceptanceCriteria} />
      </div>

      <SubmittedInput run={order.run} />
    </div>
  );
}
