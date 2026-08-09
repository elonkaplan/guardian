/**
 * The one chain definition, and the one explorer host.
 *
 * Everything on-chain in this app runs on Monad Testnet, and every link out to a
 * block explorer goes through the two helpers below. UI-05 renders transaction
 * hashes as links; a hardcoded explorer URL anywhere else in src/ is precisely
 * the drift this module exists to prevent.
 *
 * The definition is viem's, with one field replaced. viem 2.55.11 points
 * `blockExplorers.default` at https://testnet.monadexplorer.com (named "Monad
 * Testnet explorer"), which 301-redirects to testnet.monadvision.com — and
 * MonadVision is both the current brand and the name our own docs use
 * (docs/project-structure.md §5.1). Spreading viem's definition rather than
 * hand-rolling one keeps the chain id, native currency, RPC URLs, multicall3
 * address, and any future upstream corrections flowing through untouched.
 */

import { defineChain } from 'viem';
import { monadTestnet as viemMonadTestnet } from 'viem/chains';
import type { Address, Hex } from 'viem';

export const monadTestnet = defineChain({
  ...viemMonadTestnet,
  blockExplorers: {
    default: { name: 'MonadVision', url: 'https://testnet.monadvision.com' },
  },
});

export function explorerTxUrl(hash: Hex): string {
  return `${monadTestnet.blockExplorers.default.url}/tx/${hash}`;
}

export function explorerAddressUrl(address: Address): string {
  return `${monadTestnet.blockExplorers.default.url}/address/${address}`;
}
