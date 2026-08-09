/**
 * The app's one wagmi config.
 *
 * `multiInjectedProviderDiscovery: true` is wagmi's default, stated here because
 * it is load-bearing: it turns on EIP-6963 discovery, where each installed wallet
 * extension announces itself and becomes its own connector carrying its own name
 * and icon. That is what lets the connect screen offer a real choice instead of
 * silently picking whichever wallet won the race for `window.ethereum`. The
 * explicit `injected()` entry is the fallback for a wallet that never announces.
 * The consequence is that a wallet doing both — announcing and injecting — shows
 * up twice, so the connect screen de-duplicates connectors by `id`.
 *
 * `transports` is required by `createConfig`'s types even though this app performs
 * no chain reads; one `http()` satisfies it. It must not grow into a read path.
 * The frontend never calls the escrow contract — every chain write goes through
 * the operator, server-side — and a configured transport is the most natural place
 * for that rule to start eroding.
 *
 * The wallet signs exactly one thing: the auth nonce.
 */

import { createConfig, http } from 'wagmi';
import { injected } from 'wagmi/connectors';
import { monadTestnet } from './chains';

export const wagmiConfig = createConfig({
  chains: [monadTestnet],
  transports: { [monadTestnet.id]: http() },
  connectors: [injected()],
  multiInjectedProviderDiscovery: true,
});

declare module 'wagmi' {
  interface Register {
    config: typeof wagmiConfig;
  }
}
