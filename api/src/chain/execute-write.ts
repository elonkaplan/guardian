import { Logger } from '@nestjs/common';
import type {
  Abi,
  Account,
  Chain,
  ContractFunctionArgs,
  ContractFunctionName,
  PublicClient,
  TransactionReceipt,
  Transport,
  WalletClient,
} from 'viem';

import {
  GAS_LIMITS,
  RECEIPT_CONFIRMATIONS,
  RECEIPT_TIMEOUT_MS,
  type GasOperation,
} from './chain.constants';
import { decodeRevert } from './decode-revert';
import { ChainError, ContractRevertError, GasExhaustedError } from './errors';
import type { TxResult } from './types';

const logger = new Logger('ChainWrite');

/**
 * ⚠️ **`receipt.gasUsed` does not mean what it means on Ethereum.**
 *
 * Verified against the deployed escrow: a `registerAgent` sent with an explicit
 * 210,000 limit came back with `receipt.gasUsed === 210000`, while
 * `eth_estimateGas` for the identical call returns 158,189. Monad charges the
 * **limit**, and the receipt reports what was charged — not what execution
 * cost.
 *
 * Two things follow, both of which bit an earlier version of this file:
 *
 *  1. **You cannot detect out-of-gas by comparing `gasUsed` to the limit.**
 *     They are always equal, so a ratio test classifies *every* revert as gas
 *     exhaustion. The check below uses a different signal entirely — see
 *     `simulateContract` in the pipeline.
 *
 *  2. **Logging `gasUsed` measures nothing.** It will report 100% of the
 *     ceiling forever, whatever the ceiling is. Real execution cost has to come
 *     from `eth_estimateGas`, which is why the log line below reports the
 *     charge rather than pretending to report usage.
 */

/** Only state-changing functions are writable; `view`/`pure` have no business here. */
type WritableName<TAbi extends Abi> = ContractFunctionName<
  TAbi,
  'nonpayable' | 'payable'
>;

/**
 * ⚠️ `functionName` is deliberately typed as the union of names in `TAbi`,
 * NOT as `string`.
 *
 * This is what carries the guardian's role separation through the shared write
 * path. `escrowResolveAbi` contains exactly one entry, so a call routed through
 * here with the guardian's ABI can only ever name `'resolve'` — anything else
 * is a compile error at the call site.
 *
 * Widening this to `string` would silently reopen the hole: the narrow ABI
 * would still *look* right in its own file while `executeWrite` happily
 * accepted `'openDeal'` alongside it. The one-entry ABI and this type
 * parameter are two halves of the same guarantee; neither works alone.
 */
export interface ExecuteWriteParams<
  TAbi extends Abi,
  TName extends WritableName<TAbi>,
> {
  publicClient: PublicClient;
  walletClient: WalletClient<Transport, Chain, Account>;
  address: `0x${string}`;
  abi: TAbi;
  functionName: TName;
  args: ContractFunctionArgs<TAbi, 'nonpayable' | 'payable', TName>;
  /** Selects the ceiling from `GAS_LIMITS`. Also the name used in errors and logs. */
  operation: GasOperation;
}

/**
 * The single path every signing service takes to write to the chain.
 *
 * Four steps, in this order, each earning its place:
 *
 *  1. **`simulateContract`** — a free `eth_call`. It reverts with exactly the
 *     data the real transaction would, so every precondition failure ("agent
 *     inactive", "not delivered", a wrong-key role check) is caught before a
 *     transaction is paid for. On a chain that charges the gas limit, a revert
 *     caught for free instead of on-chain is a direct saving on top of the
 *     better error message.
 *
 *  2. **`writeContract` with an explicit `gas`** — see the warning below.
 *
 *  3. **`waitForTransactionReceipt`** — one confirmation. A timeout here is
 *     NOT a failure; `decodeRevert` maps it to `ChainOutcomeUnknownError`.
 *
 *  4. **Check `receipt.status`** — a mined-but-reverted transaction is a
 *     failure even though it was included, and its gas was charged in full.
 *     Treating "it was included" as success is the classic version of this bug.
 *
 * ⚠️ **Why `gas` is always passed, and never taken from the simulation.**
 * viem issues an `eth_estimateGas` call whenever `gas` is absent, and that RPC
 * returns a binary-searched UPPER BOUND rather than actual usage. On Ethereum
 * the unused headroom is refunded; on Monad the deduction is
 * `value + gas_price * gas_limit`, so the headroom is simply spent — on every
 * transaction, forever. Passing our own constant removes the extra round-trip
 * AND makes the figure a reviewed decision rather than whatever the node
 * happened to return that second.
 */
/**
 * Real execution cost for a call, via `eth_estimateGas`.
 *
 * The only way to measure gas on this chain — receipts report the charge, not
 * the usage. Free (`eth_call`-class), and used by the smoke script to right-size
 * the `GAS_LIMITS` table. Deliberately NOT called on the write path: doing so
 * would add a round-trip to every transaction to produce a number that changes
 * nothing about what is charged.
 */
export async function measureGas<TAbi extends Abi, TName extends WritableName<TAbi>>(
  params: Omit<ExecuteWriteParams<TAbi, TName>, 'operation'> & {
    operation?: GasOperation;
  },
): Promise<bigint> {
  return params.publicClient.estimateContractGas({
    address: params.address,
    abi: params.abi,
    functionName: params.functionName,
    args: params.args,
    account: params.walletClient.account,
  } as never);
}

export async function executeWrite<
  TAbi extends Abi,
  TName extends WritableName<TAbi>,
>(
  params: ExecuteWriteParams<TAbi, TName>,
): Promise<TxResult<TransactionReceipt>> {
  const { publicClient, walletClient, address, abi, functionName, args, operation } =
    params;
  const gas = GAS_LIMITS[operation];

  // The two `as never` casts below are confined to this function body on
  // purpose. viem's own generic inference cannot flow through a wrapper that
  // is itself generic over the ABI, so the internal calls need the escape
  // hatch — but the PUBLIC signature above is fully typed, which is where the
  // guarantee has to live. Verified: routing an `openDeal` through here with
  // the guardian's one-entry ABI fails to compile at the call site with
  // `Type '"openDeal"' is not assignable to type '"resolve"'`.
  try {
    // 1. Free dry run. Catches every precondition failure before paying.
    await publicClient.simulateContract({
      address,
      abi,
      functionName,
      args,
      account: walletClient.account,
    } as never);

    // 2. The real transaction. `gas` is ours, deliberately — never the
    //    simulation's estimate, never viem's implicit estimate.
    const hash = await walletClient.writeContract({
      address,
      abi,
      functionName,
      args,
      gas,
    } as never);

    // 3. One confirmation, bounded. A timeout lands in the catch below and
    //    becomes ChainOutcomeUnknownError, carrying this hash.
    const receipt = await publicClient.waitForTransactionReceipt({
      hash,
      confirmations: RECEIPT_CONFIRMATIONS,
      timeout: RECEIPT_TIMEOUT_MS,
    });

    // 4. Included is not the same as succeeded.
    if (receipt.status === 'reverted') {
      // Why gas exhaustion is inferred from the SIMULATION rather than from
      // gas figures: `gasUsed` always equals the limit here (see the note at
      // the top), so it carries no signal. What does carry signal is that step
      // 1 already ran this exact call as an `eth_call` and it did NOT revert.
      // A precondition failure would have been caught there. So a revert that
      // only appears once the transaction is mined is most likely the one
      // thing simulation cannot see — the declared ceiling being too low.
      //
      // Not airtight: state can change between the simulation and the write
      // (another deal settles, an agent is delisted), which produces the same
      // shape. The message says so rather than asserting a single cause.
      throw new GasExhaustedError(
        `${operation} simulated cleanly but reverted once mined (tx ${hash}). ` +
          `The most likely cause is the ${gas} gas ceiling in GAS_LIMITS being too low — ` +
          `the full limit was charged regardless. ` +
          `Less likely: on-chain state changed between the simulation and the write.`,
        operation,
      );
    }

    // Reports what was CHARGED, which on this chain is the ceiling — not what
    // execution cost. Deliberately not phrased as "% used": that number would
    // read 100% forever and invite someone to conclude the ceilings are
    // perfectly sized. To measure real cost, call `eth_estimateGas`.
    logger.log(
      `${operation}: charged ${gas} gas (the declared ceiling; Monad bills the ` +
        `limit, so receipt.gasUsed=${receipt.gasUsed} is the charge, not the usage) tx ${hash}`,
    );

    return {
      hash,
      blockNumber: receipt.blockNumber,
      gasUsed: receipt.gasUsed,
      value: receipt,
    };
  } catch (err) {
    // Already typed (the two throws above) — do not re-wrap and lose the class.
    if (err instanceof ChainError) throw err;
    throw decodeRevert(err, operation);
  }
}
