import type { Address, Hex } from 'viem';

/**
 * Abstract root of every error this module can throw.
 *
 * Every concrete subclass — including `ChainOutcomeUnknownError`, see the
 * note on that class below — extends this one class. That is deliberate:
 * a caller that only needs to know "did something go wrong inside the
 * chain adapter" can write one `catch (e) { if (e instanceof ChainError) }`
 * and be done, without enumerating nine class names. Anything finer than
 * that (failure vs. unknown, which specific failure) requires checking the
 * concrete subclass, which is why `operation` and the per-class fields
 * exist below rather than being flattened into a message string a caller
 * would have to parse.
 *
 * `operation` names the adapter function that was attempting to run
 * (`"openDeal"`, `"getDeal"`, ...) so a log line or Sentry breadcrumb
 * identifies the failing call without the site that catches the error
 * having to thread that name through by hand.
 */
export abstract class ChainError extends Error {
  constructor(
    message: string,
    public readonly operation: string,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

/**
 * The transport itself failed before any response — the RPC endpoint was
 * unreachable, DNS resolution failed, or it answered with a 5xx. Nothing on
 * chain was touched: no simulation ran, no transaction was broadcast.
 *
 * Caller action: safe to retry (with backoff) or fail the request outward;
 * no on-chain state exists yet for this attempt, so retrying cannot create
 * a duplicate deal the way retrying after `ChainOutcomeUnknownError` can.
 */
export class ChainConnectivityError extends ChainError {
  constructor(message: string, operation: string) {
    super(message, operation);
  }
}

/**
 * THE MOST IMPORTANT ERROR IN THIS MODULE.
 *
 * Raised when a transaction was broadcast but its receipt did not arrive
 * within the configured timeout. This is NOT a failure and must not be
 * treated as one — the transaction may still confirm later. It sits
 * outside the failure branch of the hierarchy for exactly that reason:
 * every other class in this file represents something that DID go wrong
 * (a revert, a connectivity break, an insufficient balance); this one
 * represents something whose outcome is simply not yet known.
 *
 * Why this distinction is load-bearing rather than pedantic: a caller that
 * catches a generic failure and retries an `openDeal` on timeout will, if
 * the original transaction later confirms, have opened a SECOND on-chain
 * deal for the same order. Preventing exactly that duplication is
 * invariant #1 in `docs/CONTEXT.md` ("Postgres first, chain second") — the
 * whole point of writing to Postgres before the chain is to have a place
 * to record "this order's chain write is in an unknown state" so a retry
 * can reconcile against the recorded `hash` instead of blindly resubmitting.
 * That is why `hash` is carried here: it is the caller's only way to look
 * the attempt up later (via `getTransactionReceipt` or a block explorer)
 * and find out what actually happened, rather than guessing.
 *
 * It still extends `ChainError` — a `catch (e) { if (e instanceof
 * ChainError) }` at a top-level handler should see this alongside every
 * other adapter failure so nothing here is silently swallowed. But it does
 * NOT extend any "this operation failed" type, so a narrower
 * `catch (e) { if (e instanceof ContractRevertError) }` cannot accidentally
 * lump "unknown" in with "failed" and retry when it should instead
 * reconcile. Do not "fix" this hierarchy later by moving this class under
 * a failure supertype — that would silently reintroduce the double-deal bug
 * this comment exists to prevent.
 */
export class ChainOutcomeUnknownError extends ChainError {
  constructor(
    message: string,
    operation: string,
    public readonly hash: Hex,
  ) {
    super(message, operation);
  }
}

/**
 * The escrow contract itself rejected the call — a `require` string, or a
 * custom error decoded from `escrowAbi` (including OpenZeppelin
 * AccessControl/SafeERC20 errors bubbled through it). `reason` carries the
 * decoded string (e.g. `"agent inactive"`, `"window open"`) because every
 * one of these is a legitimate contract-state outcome, not a bug — the
 * caller needs the specific reason to decide what to do next (e.g. show
 * "review window still open" vs. a generic failure message).
 *
 * Caller action: do not retry as-is; the same call will revert again until
 * whatever state `reason` describes changes.
 */
export class ContractRevertError extends ChainError {
  constructor(
    message: string,
    operation: string,
    public readonly reason: string,
  ) {
    super(message, operation);
  }
}

/**
 * `openDeal` reverted because the operator has not approved the escrow to
 * pull USDC on its behalf. This is split out from `ContractRevertError`
 * rather than left as a generic revert because it arrives disguised: per
 * `SafeERC20._callOptionalReturn`, a missing allowance re-reverts with the
 * TOKEN's own `ERC20InsufficientAllowance` custom error, not one defined in
 * `escrowAbi` — so it requires the ERC-20 error ABI to decode at all, and
 * once decoded deserves its own type because the fix is specific
 * (call `approve` on the USDC contract) rather than "something in the
 * escrow's preconditions was not met".
 *
 * Caller action: do not retry the deal open; first submit an `approve` for
 * the escrow, then retry.
 */
export class InsufficientAllowanceError extends ChainError {
  constructor(message: string, operation: string) {
    super(message, operation);
  }
}

/**
 * The signing identity (operator, guardian, or funder key) does not hold
 * enough native MON to pay for the gas of this transaction. Detected from
 * the RPC's own "insufficient funds for gas" error rather than from a
 * mined receipt, since a transaction in this state is never broadcast.
 *
 * `address` names which signer was short, since the three roles
 * (operator/guardian/funder) are funded and topped up independently and
 * the caller needs to know which wallet to refill.
 *
 * Caller action: do not retry until `address` has been topped up with MON.
 */
export class InsufficientFundsError extends ChainError {
  constructor(
    message: string,
    operation: string,
    public readonly address: Address,
  ) {
    super(message, operation);
  }
}

/**
 * The transaction was mined but reverted, and `gasUsed` on the receipt sat
 * at or very near the declared gas ceiling for this operation — the
 * signature of "ran out of gas" rather than "a precondition failed". Split
 * out from `ContractRevertError` because the fix is different: the R5 gas
 * limit table for this operation is too low, not a contract-state problem.
 * It cannot be perfectly distinguished from a revert that simply happened
 * to consume everything available, but it is the right first thing to
 * check, and the full gas ceiling was charged to the signer either way.
 *
 * Caller action: do not retry with the same limit; raise the configured
 * gas ceiling for this operation and retry.
 */
export class GasExhaustedError extends ChainError {
  constructor(message: string, operation: string) {
    super(message, operation);
  }
}

/**
 * A `units.ts` guard rejected a value before it ever reached the chain —
 * e.g. `toBaseUnits(1.5)` on a token whose base unit cannot represent a
 * fractional amount at that precision. `value` carries whatever was
 * rejected (typed `unknown` because the guard may reject values of more
 * than one shape) so the caller can log or surface exactly what failed to
 * convert without the message string being the only record of it.
 *
 * Caller action: this is a caller bug, not a transient condition — fix the
 * value being passed in; retrying unchanged will fail identically.
 */
export class UnitConversionError extends ChainError {
  constructor(
    message: string,
    operation: string,
    public readonly value: unknown,
  ) {
    super(message, operation);
  }
}

/**
 * A read (e.g. `getDeal`) asked the escrow about a `dealId` that does not
 * exist on chain. `dealId` is carried so the caller can log which id was
 * missing without re-deriving it from context.
 *
 * Caller action: treat as "not found", not as a transient failure —
 * retrying the same id will not succeed.
 */
export class DealNotFoundError extends ChainError {
  constructor(
    message: string,
    operation: string,
    public readonly dealId: bigint,
  ) {
    super(message, operation);
  }
}

/**
 * A read (e.g. `getAgent`) asked the escrow about an `agentId` that does
 * not exist on chain. `agentId` is carried so the caller can log which id
 * was missing without re-deriving it from context.
 *
 * Caller action: treat as "not found", not as a transient failure —
 * retrying the same id will not succeed.
 */
export class AgentNotFoundError extends ChainError {
  constructor(
    message: string,
    operation: string,
    public readonly agentId: bigint,
  ) {
    super(message, operation);
  }
}
