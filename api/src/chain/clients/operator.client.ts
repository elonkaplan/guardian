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
 * The operator's signing client — the identity that drives the whole deal
 * lifecycle.
 *
 * ⚠️ **`nonceManager` is not optional here.**
 *
 * The operator has three independent senders: the purchase saga, which writes
 * when a buyer acts; the sweeper cron, which polls every few seconds and writes
 * whenever a review window has lapsed; and — since 005 — the cash-out leg
 * (`TokenTransferService.transferToFunder`), which writes whenever a user moves
 * money back out. That third one is user-triggered rather than ours, so the
 * overlap it creates is not something we schedule. With viem's default
 * behaviour each write independently fetches the pending nonce, so two writes
 * that overlap in time fetch the *same* nonce — and the second replaces the
 * first in the mempool. One transaction silently disappears, and at this layer
 * every transaction moves money.
 *
 * `nonceManager` keeps an in-process counter per account and hands out distinct
 * nonces. Note what this does and does not buy: it makes overlap harmless
 * *within this process*, which is the only concurrency this deployment has. It
 * would not survive a second API instance sharing the operator key — that would
 * need on-chain nonce coordination, and is out of scope here.
 *
 * This is the mechanism behind the spec's assumption that "the operator submits
 * transactions one at a time": rather than relying on that being true, overlap
 * is made safe.
 */
export function buildOperatorClient(
  config: ChainConfig & { OPERATOR_PRIVATE_KEY: string },
): WalletClient<Transport, Chain, Account> {
  const account = privateKeyToAccount(
    config.OPERATOR_PRIVATE_KEY as `0x${string}`,
    { nonceManager },
  );

  return createWalletClient({
    account,
    chain: buildMonadChain(config),
    transport: http(config.MONAD_RPC_URL),
  });
}
