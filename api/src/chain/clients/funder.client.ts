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
 * The funder's signing client — the identity that money enters the system
 * through.
 *
 * **What this key is for.** The funder wallet is "the outside world"
 * (`docs/rain-integration.md` §0.2): the only source of money in the platform,
 * holding faucet-minted test USDC and MON, standing in for the bank now that
 * Rain's onramp is stubbed. It signs exactly one kind of call —
 * `USDC.transfer(operator, amount)` when a user tops up. It never touches the
 * escrow contract, holds no role on it, and would revert if it tried.
 *
 * The reverse leg (cash-out, pool → funder) is signed by the OPERATOR, not by
 * this key: the tokens being returned are the pool's. So this client is the
 * *entrance* only, which is also why the funder's balance falling on top-ups
 * and rising on cash-outs is the system's health signal (§0.3).
 *
 * ⚠️ **`nonceManager` is not optional here either — and it is newly
 * load-bearing.**
 *
 * The operator's version of this warning names two independent senders. The
 * funder's case is worse, because the concurrency is driven by *users* rather
 * than by our own two code paths: two people clicking "Add funds" at the same
 * moment are two independent writes from one key. With viem's default
 * behaviour each write fetches the pending nonce independently, so both fetch
 * the **same** nonce and the second replaces the first in the mempool. One
 * top-up silently disappears — no revert, no error anywhere, no failed
 * request; the transfer simply never happened and the user is short by the
 * amount they were told was credited. A demo with two laptops is exactly this
 * scenario, and it is the one failure here that produces no log line to find
 * afterwards (specs/005-accounts-ledger-funding/research.md R5).
 *
 * `nonceManager` keeps an in-process counter per account and hands out distinct
 * nonces. The same caveat the operator's client documents applies unchanged: it
 * makes overlap harmless **within this process**, which is the only concurrency
 * this deployment has. A second API instance sharing the funder key would need
 * on-chain nonce coordination and is out of scope.
 */
export function buildFunderClient(
  config: ChainConfig & { FUNDER_PRIVATE_KEY: string },
): WalletClient<Transport, Chain, Account> {
  const account = privateKeyToAccount(
    config.FUNDER_PRIVATE_KEY as `0x${string}`,
    { nonceManager },
  );

  return createWalletClient({
    account,
    chain: buildMonadChain(config),
    transport: http(config.MONAD_RPC_URL),
  });
}
