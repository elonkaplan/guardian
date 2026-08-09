import {
  createWalletClient,
  http,
  type Account,
  type Chain,
  type Transport,
  type WalletClient,
} from 'viem';
import { nonceManager, privateKeyToAccount } from 'viem/accounts';

import { buildMonadChain, type ChainConfig } from '../monad-chain';

/**
 * The guardian's signing client, in a file of its own.
 *
 * Its own module because `docs/project-structure.md` §5.2 asks for exactly
 * that, and the reason is worth stating: "which key signed this?" should be
 * answerable by looking at one import, not by tracing a shared client through
 * three layers of indirection.
 *
 * ⚠️ **This client is only ever used with `escrowResolveAbi`** — the one-entry
 * ABI. That pairing is the whole role separation: viem infers the permitted
 * `functionName` from the ABI's literal type, so an `openDeal` signed with the
 * guardian key is a compile error rather than a code-review question. The
 * client is held privately by `EscrowGuardianService` and never exported, so
 * there is no way to reach it with a wider ABI (FR-005).
 *
 * `nonceManager` is attached for the same reason the operator's is: without
 * it, two writes that overlap in time fetch the same pending nonce and one
 * silently replaces the other in the mempool. The guardian writes far less
 * often than the operator, but a dropped `resolve` is a dispute that never
 * settles — a worse failure than a dropped read, and the guard costs nothing.
 */
export function buildGuardianClient(
  config: ChainConfig & { GUARDIAN_PRIVATE_KEY: string },
): WalletClient<Transport, Chain, Account> {
  const account = privateKeyToAccount(
    config.GUARDIAN_PRIVATE_KEY as `0x${string}`,
    { nonceManager },
  );

  return createWalletClient({
    account,
    chain: buildMonadChain(config),
    transport: http(config.MONAD_RPC_URL),
  });
}
