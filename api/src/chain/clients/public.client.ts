import { createPublicClient, http, type PublicClient } from 'viem';

import { buildMonadChain, type ChainConfig } from '../monad-chain';

/**
 * The read-only view of the chain. **No key, no account, nothing to sign with.**
 *
 * Three jobs: contract reads (`totalEscrowed`, `balances`, `deals`, `agents`),
 * waiting for receipts on behalf of the two signing clients, and the boot
 * preflight. All of them are `eth_call` or `eth_getTransactionReceipt`, which
 * cost nothing and change nothing.
 *
 * ⚠️ This client — like the operator's and the guardian's — is held as a
 * `private readonly` field by the services that use it and is never exported,
 * injected, or returned (FR-005). The narrowed ABIs elsewhere in this module
 * only mean something if a caller cannot reach past them to a raw client and
 * name whatever function it likes.
 */
export function buildPublicClient(config: ChainConfig): PublicClient {
  return createPublicClient({
    chain: buildMonadChain(config),
    transport: http(config.MONAD_RPC_URL),
  });
}
