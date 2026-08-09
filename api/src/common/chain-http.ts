import { BadGatewayException, type HttpException } from '@nestjs/common';

import {
  ChainConnectivityError,
  ChainError,
  ChainOutcomeUnknownError,
  ContractRevertError,
  GasExhaustedError,
  InsufficientAllowanceError,
  InsufficientFundsError,
  UnitConversionError,
} from '../chain/errors';

/**
 * The single place a `ChainError` becomes an HTTP response.
 *
 * `src/chain/errors.ts` deliberately throws plain errors rather than
 * `HttpException`s so that the mapping from cause to status code lives in one
 * reviewable location instead of at every throw site. This file is that
 * location for the funding routes. Every chain failure surfaced by
 * `/topup`, `/withdraw` and `/offramp` passes through here, which is what makes
 * "no chain error leaks raw viem text to a client" a property that can be
 * checked by reading one function rather than audited across a module.
 *
 * ---
 *
 * ## ⚠️ `ChainOutcomeUnknownError` is checked FIRST, and that ordering is the
 * most important thing in this file.
 *
 * Every other class below means the money did **not** move. This one means we
 * do not know. The transaction was broadcast and signed and is sitting in a
 * mempool or already in a block; the receipt simply did not arrive inside the
 * timeout. It may confirm a second after this function returns.
 *
 * `ChainOutcomeUnknownError extends ChainError`, on purpose, so that a
 * top-level `catch (e) { if (e instanceof ChainError) }` cannot silently
 * swallow it. The cost of that decision is exactly the trap this ordering
 * exists to disarm: a generic `instanceof ChainError` branch placed above the
 * specific check will match "unknown" and report it as a plain failure. What a
 * caller does with a plain failure is retry — and retrying a transfer that is
 * still in flight sends the money twice. `src/chain/errors.ts` spells out the
 * same trap for `openDeal` ("do not 'fix' this hierarchy later by moving this
 * class under a failure supertype"); `decode-revert.ts` disarms it the same way
 * by checking the receipt timeout before the connectivity branch. Same class,
 * same trap, third flow.
 *
 * The consequence is visible in the response body: this branch, and only this
 * branch, carries `txHash`. That hash is the caller's sole route to finding out
 * what actually happened — a `getTransactionReceipt` later, or a block explorer
 * — instead of guessing. Dropping it from the body would make the distinction
 * between "failed" and "unknown" purely academic, because the client would have
 * no way to act on it.
 *
 * ⚠️ Note what this function does **not** do: it does not decide whether a
 * compensating ledger entry gets written. That decision belongs to the cash-out
 * service (R6) and it is the opposite of this one — an unknown outcome must
 * leave the debit standing while a definite failure reverses it. Formatting a
 * response and repairing the ledger are two different questions about the same
 * error, and collapsing them into one helper is how the wrong one gets answered
 * by accident.
 *
 * ---
 *
 * ## Why every chain failure is `502` and not `500` or `409`
 *
 * `502 Bad Gateway` says "an upstream I depend on did not give me a usable
 * answer", which is literally true of every branch here — the upstream is the
 * Monad RPC and the escrow. A `500` would claim the bug is ours and would fire
 * whatever alerting watches for that; a `409` would claim a precondition failed
 * that the caller could fix and retry into, which is what the *pre-reads* are
 * for (R15/R9) — by the time a transaction has been attempted, the preconditions
 * were already checked and passed. Contracts §8 fixes this: `409` means nothing
 * was attempted, `502` means the chain leg failed or is unknown.
 *
 * ## ⚠️ Only `decodeRevert`'s already-named messages go on the wire
 *
 * The `err.message` passed through below is not raw viem text — it is the
 * message `decodeRevert` constructed after decoding the revert into a named
 * cause ("agent inactive", `ERC20InsufficientAllowance`, …). That distinction is
 * a security boundary, not a quality preference: viem's own error strings embed
 * the full request context, which on this platform includes the **RPC URL** —
 * and `MONAD_RPC_URL` carries an API key in every provider's hosted form. A
 * handler that helpfully surfaced `err.cause.message` or the viem
 * `shortMessage` would publish that key to any client that can trigger a chain
 * failure. Contracts §7 states the rule directly: pass through the named
 * message, log the raw error.
 *
 * By the same rule, nothing here interpolates a `ChainError`'s side fields into
 * the response. `InsufficientFundsError.address` names which of our signers is
 * out of MON — an operational fact about our wallets, useful in a log, nobody's
 * business over the wire.
 *
 * ---
 *
 * ## Non-chain errors are rethrown, never wrapped
 *
 * If `err` is not a `ChainError`, this function **throws it unchanged** rather
 * than returning anything. A `TypeError` from our own code, a TypeORM failure,
 * an `HttpException` a service already constructed deliberately — none of those
 * are gateway problems, and reporting them as `502` would both mislabel a bug
 * as an upstream outage and destroy the stack trace that identifies it. Nest's
 * default filter turns an unrecognised throw into a `500` with the stack
 * logged, which is the correct handling for "we broke".
 *
 * The signature therefore reads: this function either returns an
 * `HttpException` describing a chain failure, or it does not return at all.
 * Call it as `throw toHttpException(err)` — written that way the rethrow is
 * invisible at the call site and both paths end in a throw regardless.
 */
export function toHttpException(err: unknown): HttpException {
  // ⚠️ FIRST. See the long note above. Not a failure — an unknown outcome.
  if (err instanceof ChainOutcomeUnknownError) {
    return new BadGatewayException({
      message: err.message,
      txHash: err.hash,
    });
  }

  // The definite failures. They are enumerated rather than collapsed into the
  // `ChainError` catch-all below so that adding a class to `chain/errors.ts`
  // forces a decision here about whether its message is safe to surface,
  // instead of it silently inheriting one.
  if (
    err instanceof InsufficientFundsError ||
    err instanceof ContractRevertError ||
    err instanceof ChainConnectivityError ||
    err instanceof GasExhaustedError ||
    err instanceof InsufficientAllowanceError ||
    err instanceof UnitConversionError
  ) {
    return new BadGatewayException(err.message);
  }

  // Any other `ChainError` — the read-side `DealNotFoundError` and
  // `AgentNotFoundError` today, whatever is added tomorrow. Still `502`,
  // because it still came from the chain adapter, and still `err.message`
  // because every message in that module is one the module wrote itself.
  if (err instanceof ChainError) {
    return new BadGatewayException(err.message);
  }

  // Not ours to translate. Rethrow with the stack intact.
  throw err;
}
