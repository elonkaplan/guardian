import { defineChain, type Chain } from 'viem';

import type { AppConfig } from '../config/env.schema';

/**
 * The chain id, RPC URL, and explorer URL below come from `AppConfig`, never
 * from a literal `10143` or a hardcoded URL — for two reasons, not one.
 *
 * First, `env.schema.ts` has already validated these values by the time
 * anything in this module runs: `MONAD_CHAIN_ID` is a positive integer,
 * `MONAD_RPC_URL` and `MONAD_EXPLORER_URL` are well-formed URLs. Re-deriving
 * or re-checking them here would duplicate work `validate()` already did at
 * boot.
 *
 * Second, and more importantly: this repo's `.env` is the single source of
 * configuration shared with `sc/` and `ui/`. If this file hardcoded the RPC
 * URL instead of reading `MONAD_RPC_URL`, there would be two places that
 * claim to say which node the API talks to — and the failure mode for "two
 * sources of truth for one URL" is a demo where the API silently signs
 * against a different node than the one `sc/` deployed the escrow to. Reading
 * config makes that impossible by construction: change the URL in one place
 * and every part of the system that reads it moves together.
 */
/**
 * Exactly the three keys this needs, drawn from `AppConfig` so they cannot
 * drift from the validated schema. Narrower than `AppConfig` on purpose: a
 * function that demands the whole config to read three fields forces every
 * caller to either hold the whole thing or fake it with a cast.
 */
export type ChainConfig = Pick<
  AppConfig,
  'MONAD_CHAIN_ID' | 'MONAD_RPC_URL' | 'MONAD_EXPLORER_URL'
>;

export function buildMonadChain(config: ChainConfig): Chain {
  return defineChain({
    id: config.MONAD_CHAIN_ID,
    name: 'Monad Testnet',
    nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
    rpcUrls: {
      default: { http: [config.MONAD_RPC_URL] },
    },
    blockExplorers: {
      default: { name: 'MonadVision', url: config.MONAD_EXPLORER_URL },
    },
  });
}
