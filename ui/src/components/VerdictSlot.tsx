import type { JSX } from 'react';

import type { OrderState } from '../api/types';

interface VerdictSlotProps {
  /** The order's backend state. Only `adjudicated` and `settled` render anything. */
  state: OrderState;
}

/**
 * The region the verdict card will occupy, on a page that ships before it exists.
 *
 * The verdict card (`docs/ui-design.md` §2.2 — the tier, Guardian's reasoning, the
 * clause checklist, the split figures, the transaction hash) is UI-05's whole job.
 * This feature ends one step short of it, and the honest options at that boundary
 * were to omit the region until UI-05 lands or to reserve it. Omitting it is the
 * worse failure: a rehearsal that walks an order all the way to `settled` before the
 * card is built would arrive at a page that has stopped moving, offers no actions,
 * and has nothing where the outcome belongs — a hole, read as a bug, in the one
 * moment of the demo that is supposed to feel conclusive. Reserving it gives the
 * same walk a page that reads finished-but-pending, which is what it actually is.
 *
 * So the emptiness here is a scope boundary and not an oversight (FR-036). The
 * component is a container: it renders a heading and one line about where the order
 * stands, and deliberately renders no verdict content at all — no tier, no
 * reasoning, no citations, no split, no transaction hash. It is also not a reader:
 * this feature never fetches the verdict, and a region that hinted at figures it
 * does not have would be claiming otherwise.
 *
 * The two lines it can say are different claims, not two phrasings of one. At
 * `adjudicated` a ruling exists but the split has not executed and the money has not
 * landed, so the copy is present continuous and the page is still polling; at
 * `settled` the order is over and the line says what is missing from the view rather
 * than what is missing from the world. Conflating them would announce an outcome
 * before it happened, which is the same mistake `faceFor` exists to prevent.
 *
 * The one hard constraint, whatever the copy becomes: it must never render a blank
 * gap (FR-007). Hence a heading that stands on its own and a note that always has
 * text, rather than a labelled empty box waiting to be filled.
 */
export function VerdictSlot({ state }: VerdictSlotProps): JSX.Element | null {
  if (state === 'adjudicated') {
    return (
      <section className="verdict-slot verdict-slot--adjudicated">
        <h2 className="verdict-slot__heading">Settling the escrow</h2>
        <p className="verdict-slot__note">
          Guardian has ruled on this dispute and the escrow is being settled now. This page is
          following the order and will show the concluded record once the funds have moved.
        </p>
      </section>
    );
  }

  if (state === 'settled') {
    return (
      <section className="verdict-slot verdict-slot--settled">
        <h2 className="verdict-slot__heading">Outcome</h2>
        <p className="verdict-slot__note">
          Guardian&rsquo;s ruling is final and the escrow has been settled. The full verdict &mdash;
          the refund tier, the reasoning behind it, the contract clauses it cited, and the
          transaction that moved the funds &mdash; is not yet displayed here.
        </p>
      </section>
    );
  }

  /*
   * Every other state belongs to a face that does not compose this region, so the
   * page should never reach here. Returning null rather than inventing a third line
   * keeps that true: a mistake in the face switch shows up as a missing section that
   * the switch's own tests catch, not as copy about a verdict for an order that has
   * not been disputed — `released`, in particular, is a concluded order with no
   * ruling to report at all.
   */
  return null;
}
