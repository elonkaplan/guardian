import { VerdictTier } from '../entities/enums';
import { BPS_DENOMINATOR, REFUND_BPS } from './guardian.constants';

/**
 * The one tier→amount function in the codebase (research R9).
 *
 * ⚠️ **This is a RECORD of the ruling, not the instrument of payment.** The
 * escrow computes and pays the actual split on-chain, from the same basis
 * points this function reads. The number returned here exists so that
 * `verdicts.refund_minor` — which is `NOT NULL` — has a value, and so that the
 * verdict screen and the order screen agree on what the buyer gets back without
 * either of them re-deriving it. **Nothing downstream of this function moves
 * money.** If this returned a wrong number, the buyer would still be paid
 * correctly by the contract and would still be shown the wrong figure, which is
 * why the basis points live in one audited table rather than at call sites.
 *
 * **USD cents in, USD cents out** — invariant #2, one money unit in the
 * database. `priceMinor` is a `price_minor` read off an order and the result is
 * a `refund_minor` written to a verdict; both are integer US cents. Token base
 * units (6 decimals) are a chain-boundary concern and exist only inside
 * `src/chain/`, so no value in this file is ever a token amount.
 *
 * **Why `Math.floor`.** A partial cent cannot be a stored amount, and `verdicts`
 * carries `CHECK (refund_minor >= 0)`, which wants an integer. The rounding
 * *direction* is a display-only concern precisely because the chain's payout is
 * computed on-chain from basis points over the escrowed token amount and is not
 * derived from this number — flooring can never short-change a buyer, because
 * this is not what pays them.
 *
 * **Why this file exists at all.** `src/chain/tier.ts` explicitly declines to
 * own the arithmetic: *"WHAT THIS FILE IS NOT: it does not compute refund
 * amounts. The percentages in the table below … are restated here only as
 * documentation."* That module's one conversion is token base units ↔ cents. A
 * tier percentage is a **product rule**, not a unit conversion, so it does not
 * belong in the chain adapter — and until this feature it therefore had no home.
 *
 * A `none` verdict legitimately returns `0`: Guardian ruled for the seller, the
 * buyer is refunded nothing, and the row is still written. That is why the
 * column's constraint is `CHECK (refund_minor >= 0)` and not `> 0` — zero is a
 * decided outcome, not a missing one.
 */
export function refundMinorFor(tier: VerdictTier, priceMinor: number): number {
  return Math.floor((priceMinor * REFUND_BPS[tier]) / BPS_DENOMINATOR);
}
