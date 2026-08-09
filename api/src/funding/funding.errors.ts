/**
 * Abstract root of every refusal the funding flows can raise **before** any
 * money moves.
 *
 * One root class, for the same reason `auth/errors.ts`, `chain/errors.ts` and
 * `ledger/ledger.errors.ts` each have one: a caller that only needs to know
 * "funding refused this" writes a single
 * `catch (e) { if (e instanceof FundingError) }` rather than enumerating class
 * names it will forget to extend when the fourth one is added. Anything finer —
 * *which* refusal, and therefore what sentence the person reads — means checking
 * the concrete subclass, which is why the figures ride on the subclasses below
 * instead of being flattened into a message string somebody would have to parse
 * back out.
 *
 * ⚠️ **These are plain `Error`s, NOT `HttpException` subclasses.** Same split
 * the other three error files document at length, and it matters more here than
 * anywhere: all three of these map to `409`, and the reason they do is a single
 * argument — the payload was well-formed and it is the *state* that conflicts
 * (contracts §8) — which is only reviewable if it is written down once, in
 * `FundingController`, rather than asserted at each `throw`. Throwing an
 * `HttpException` from a service also silently commits every future non-HTTP
 * caller (a reconciliation script, a cron top-up) to a status code that means
 * nothing to it.
 *
 * ⚠️ **Every class here means NOTHING WAS ATTEMPTED.** No transaction was
 * broadcast, no ledger row was written, no gas was spent. That is the whole
 * distinction contracts §8 draws between `409` and `502`: a `409` is safe to
 * retry after the underlying state changes, a `502` describes a chain leg that
 * already failed or whose outcome is unknown. A failure discovered *after* work
 * has started is a `ChainError` and belongs in `chain/errors.ts` — nothing in
 * this file should ever be thrown from inside a compensation branch.
 *
 * ⚠️ Messages here are in **cents**, deliberately. They are log text. The
 * dollars a person reads are composed in the controller with `formatCents`
 * (contracts §7), which is the only layer that knows a human is on the other
 * end — the same division `InsufficientBalanceError` already follows.
 */
export abstract class FundingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/**
 * A top-up was refused because the **funder wallet** does not hold enough USDC
 * to send. Nothing was written and nothing was broadcast.
 *
 * **Why this is caught by a free read rather than by the transfer.** Without the
 * pre-read the identical condition surfaces as an `ERC20InsufficientBalance`
 * custom error, decoded by `decodeRevert` after a transaction was already
 * attempted — on Monad, where the gas *limit* is charged even for a revert, so
 * the diagnosis costs real money every time. It also arrives shaped like an
 * infrastructure fault (`502`) when it is in fact the plain, operator-fixable
 * "we cannot fund that right now" (FR-018, research R15).
 *
 * **Not the user's fault, and the message must not imply it is.** Every other
 * `409` in this feature describes something the caller can change; this one
 * describes *our* demo wallet running dry. The person can only wait, so the
 * sentence names the funder wallet explicitly rather than saying "insufficient
 * funds" and leaving them to conclude they are broke.
 *
 * Both figures are positive cents, known at the moment of the throw, so the
 * controller formats the refusal with `formatCents` and no second round trip.
 *
 * External response: `409` — `"Funder wallet holds $X, cannot transfer $Y"`.
 */
export class InsufficientFunderBalanceError extends FundingError {
  constructor(
    message: string,
    public readonly availableMinor: number,
    public readonly requestedMinor: number,
  ) {
    super(message);
  }
}

/**
 * A cash-out was refused because the **operator pool** does not hold enough
 * USDC to send out. Nothing was written — in particular **no debit**, which is
 * the point of checking before `debitWithBalanceCheck` rather than after: a
 * debit written here would have to be compensated by a second row for a
 * transfer that was never even attempted.
 *
 * ⚠️ **Distinct from `InsufficientBalanceError`, and confusing the two is the
 * trap this class exists to prevent.** That one means *the user* does not have
 * the money; this one means *the platform* does not, while the user's balance is
 * perfectly good. They are different sentences, different people to talk to, and
 * different fixes — and if the platform is short while the ledger says otherwise,
 * `pool >= Σ ledger` is already violated and someone needs to know tonight, not
 * from a message telling a user they are overdrawn.
 *
 * ⚠️ This is the pool's *raw token* balance, not a solvency statement. It says
 * "this one transfer can be paid", nothing about what the escrow is holding for
 * open deals, and nothing about the allowance the escrow was granted — that
 * governs what the escrow may *pull* and is independent of what the operator
 * holds (see `TokenTransferService.operatorUsdcCents`).
 *
 * External response: `409` — `"Operator pool holds $X, cannot cash out $Y"`.
 */
export class InsufficientPoolBalanceError extends FundingError {
  constructor(
    message: string,
    public readonly availableMinor: number,
    public readonly requestedMinor: number,
  ) {
    super(message);
  }
}

/**
 * `POST /withdraw` was refused because the account's settled on-chain balance is
 * zero. **No transaction was submitted**, and that is the entire reason this
 * class exists.
 *
 * ⚠️ On Monad the gas **limit** is charged whether or not the call does
 * anything, so a `withdrawFor` against an empty balance is not a harmless no-op
 * — it burns the full 140,000-gas ceiling from the operator's MON, every time
 * someone taps a button the UI should have disabled (FR-023, research R9). The
 * pre-read that produces this error is free.
 *
 * **No figures are carried, because there is exactly one:** the balance is zero
 * by definition of reaching this throw, and the requested amount does not exist
 * — `withdrawFor` takes no amount. The message is a fixed sentence, which is why
 * the controller does not reach for `formatCents` on this branch.
 *
 * ⚠️ Zero is **not** an error condition on the read itself: `balanceOfCents`
 * returns `0` for an address that is owed nothing, and a *failed* read raises a
 * `ChainError` and becomes a `502`. "Nothing to withdraw" and "cannot tell what
 * there is to withdraw" are different answers and this class is only the first.
 *
 * External response: `409` — `"No settled funds to withdraw"`.
 */
export class NoSettledFundsError extends FundingError {
  constructor(message: string) {
    super(message);
  }
}
