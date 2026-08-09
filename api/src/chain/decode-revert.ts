import {
  BaseError,
  ContractFunctionRevertedError,
  HttpRequestError,
  TimeoutError,
  TransactionNotFoundError,
  WaitForTransactionReceiptTimeoutError,
  decodeErrorResult,
  type Hex,
} from 'viem';

import { erc20Abi } from './abi/erc20.abi';
import {
  ChainConnectivityError,
  ChainError,
  ChainOutcomeUnknownError,
  ContractRevertError,
  InsufficientAllowanceError,
  InsufficientFundsError,
} from './errors';

/**
 * Turns a viem error into one of this module's typed errors.
 *
 * The whole reason this file exists: **a revert reaches us in three different
 * encodings**, and a decoder that understands only one of them reports
 * "execution reverted" for the other two — throwing away the single most
 * useful piece of information at exactly the moment someone needs it.
 *
 *   1. `require` strings — the escrow's own preconditions ("not delivered",
 *      "agent inactive", "window closed"). Read from `err.reason`.
 *
 *   2. Custom errors declared in the escrow's own ABI — OpenZeppelin
 *      AccessControl v5 reverts with `AccessControlUnauthorizedAccount`
 *      rather than a string. Read from `err.data.errorName`.
 *
 *   3. Custom errors that are NOT in the escrow's ABI. This is the trap.
 *      `SafeERC20._callOptionalReturn` re-reverts with the *token's* own
 *      return data, so a purchase with no allowance surfaces
 *      `ERC20InsufficientAllowance` — an error the escrow ABI cannot decode,
 *      because it belongs to a different contract. viem leaves it as raw
 *      undecoded `data`, so we decode it again against `erc20Abi`.
 *
 * Every reason string below is a LEGITIMATE STATE rather than a bug — "not
 * delivered" means the caller raced the lifecycle, not that the code is
 * broken. That is why the string survives into `ContractRevertError.reason`
 * instead of being flattened away.
 */
export function decodeRevert(err: unknown, operation: string): ChainError {
  // Already ours (a nested call that decoded first) — do not re-wrap.
  if (err instanceof ChainError) return err;

  if (!(err instanceof BaseError)) {
    return new ChainConnectivityError(
      err instanceof Error ? err.message : String(err),
      operation,
    );
  }

  // ---------------------------------------------------------------------
  // Not a revert at all: the receipt never arrived.
  // ---------------------------------------------------------------------
  // Checked FIRST and mapped to the one error in this module that does not
  // mean failure. Ordering matters: a timeout that fell through to the
  // connectivity branch below would be indistinguishable from "nothing
  // happened", and a caller would then safely retry a transaction that is
  // still in flight — opening a second on-chain deal for one order.
  const receiptTimeout = err.walk(
    (e) => e instanceof WaitForTransactionReceiptTimeoutError,
  );
  if (receiptTimeout instanceof WaitForTransactionReceiptTimeoutError) {
    return new ChainOutcomeUnknownError(
      `${operation}: receipt did not arrive before the timeout; the transaction may still confirm`,
      operation,
      extractHash(receiptTimeout) ?? '0x',
    );
  }

  // ---------------------------------------------------------------------
  // A revert, in one of three encodings.
  // ---------------------------------------------------------------------
  const reverted = err.walk((e) => e instanceof ContractFunctionRevertedError);
  if (reverted instanceof ContractFunctionRevertedError) {
    // Encoding 1: a `require` string.
    if (reverted.reason) {
      return new ContractRevertError(
        `${operation} reverted: ${reverted.reason}`,
        operation,
        reverted.reason,
      );
    }

    // Encoding 2: a custom error viem already decoded against the escrow ABI.
    const errorName = reverted.data?.errorName;
    if (errorName) {
      return fromErrorName(errorName, reverted.data?.args, operation);
    }

    // Encoding 3: raw data the escrow ABI could not decode — try the token's.
    const raw = reverted.raw;
    if (raw && raw !== '0x') {
      const tokenError = tryDecodeTokenError(raw);
      if (tokenError) {
        return fromErrorName(tokenError.errorName, tokenError.args, operation);
      }
      return new ContractRevertError(
        `${operation} reverted with undecodable data ${raw.slice(0, 10)}…`,
        operation,
        raw,
      );
    }

    return new ContractRevertError(
      `${operation} reverted without a reason`,
      operation,
      'unknown',
    );
  }

  // ---------------------------------------------------------------------
  // Non-revert failures.
  // ---------------------------------------------------------------------
  // Matched on message text because these arrive as generic RPC errors whose
  // wording is the node's, not viem's. Deliberately checked before the
  // connectivity fallback: "insufficient funds for gas" is a funding problem
  // and reads nothing like one if it is reported as a network failure.
  const message = err.details || err.shortMessage || err.message;
  if (/insufficient funds/i.test(message)) {
    return new InsufficientFundsError(
      `${operation}: the signing account has too little MON to cover the gas limit`,
      operation,
      // The address is not in the RPC error; the caller knows which client it
      // used, and the operation name identifies it in practice.
      '0x',
    );
  }

  if (
    err instanceof HttpRequestError ||
    err instanceof TimeoutError ||
    err instanceof TransactionNotFoundError ||
    err.walk((e) => e instanceof HttpRequestError) instanceof HttpRequestError
  ) {
    return new ChainConnectivityError(`${operation}: ${message}`, operation);
  }

  return new ChainConnectivityError(`${operation}: ${message}`, operation);
}

/**
 * Maps a decoded custom-error name to a typed error.
 *
 * `ERC20InsufficientAllowance` gets its own class because it has a specific,
 * actionable cause — the operator never approved the escrow — that a generic
 * revert would bury. `ERC20InsufficientBalance` deliberately does NOT: it is
 * a different problem (the operator holds no tokens) and the reason string
 * carries that. The two are independent preconditions on `openDeal`, and
 * conflating them sends whoever is debugging to the wrong fix.
 */
function fromErrorName(
  errorName: string,
  args: readonly unknown[] | undefined,
  operation: string,
): ChainError {
  if (errorName === 'ERC20InsufficientAllowance') {
    return new InsufficientAllowanceError(
      `${operation}: the escrow is not approved to move the operator's USDC (${formatArgs(args)})`,
      operation,
    );
  }

  return new ContractRevertError(
    `${operation} reverted: ${errorName}${args?.length ? `(${formatArgs(args)})` : ''}`,
    operation,
    errorName,
  );
}

/**
 * Second decode pass against the ERC-20 ABI, for encoding 3.
 *
 * Returns `undefined` rather than throwing when the data is not a token error
 * either — at that point we genuinely do not know what it is, and saying so
 * beats guessing.
 */
function tryDecodeTokenError(
  data: Hex,
): { errorName: string; args: readonly unknown[] | undefined } | undefined {
  try {
    const decoded = decodeErrorResult({ abi: erc20Abi, data });
    return { errorName: decoded.errorName, args: decoded.args };
  } catch {
    return undefined;
  }
}

function formatArgs(args: readonly unknown[] | undefined): string {
  if (!args?.length) return '';
  return args.map((a) => (typeof a === 'bigint' ? a.toString() : String(a))).join(', ');
}

/** viem attaches the hash to the timeout error; the field is not in its public type. */
function extractHash(err: WaitForTransactionReceiptTimeoutError): Hex | undefined {
  const candidate = (err as unknown as { hash?: Hex }).hash;
  if (candidate) return candidate;
  const match = /0x[0-9a-fA-F]{64}/.exec(err.message);
  return (match?.[0] as Hex | undefined) ?? undefined;
}
