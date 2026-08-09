import { useState } from 'react';
import { useConnection, useSwitchChain } from 'wagmi';

import { monadTestnet } from '../chain/chains';
import { classifyWalletError, walletErrorMessage } from '../chain/walletErrors';

/**
 * A wallet pointed at the wrong chain, said out loud.
 *
 * It warns; it never gates. Signing a message is a local operation and this app
 * sends no transactions, so blocking sign-in on the selected network would buy
 * nothing and cost the demo a failure mode. The banner exists because balances
 * and explorer links assume Monad, and a silent mismatch is worse than a visible
 * one.
 *
 * Nothing here is an overlay and nothing disables the page beneath it.
 */
export function NetworkBanner() {
  const { chain, isConnected } = useConnection();
  const { switchChainAsync } = useSwitchChain();
  const [error, setError] = useState<string | null>(null);
  const [switching, setSwitching] = useState(false);

  // No wallet attached means no network to be wrong about. A banner there would
  // be noise on the connect screen, which is where signed-out visitors live.
  if (!isConnected || chain === undefined || chain.id === monadTestnet.id) {
    return null;
  }

  async function onSwitch() {
    setSwitching(true);
    setError(null);
    try {
      // wagmi's injected connector falls back to wallet_addEthereumChain when
      // the wallet does not recognise the chain, building the request from the
      // chain object in our config — which is why there is exactly one chain
      // definition and no hand-rolled add call here.
      await switchChainAsync({ chainId: monadTestnet.id });
    } catch (cause) {
      // Declining is a normal answer. The banner stays, the page keeps working.
      setError(walletErrorMessage(classifyWalletError(cause), 'switch'));
    } finally {
      setSwitching(false);
    }
  }

  return (
    <div className="network-banner" role="status">
      <span className="network-banner__text">
        Your wallet is on <strong>{chain.name}</strong>. Guardian runs on{' '}
        <strong>{monadTestnet.name}</strong>.
      </span>
      <button
        type="button"
        className="network-banner__switch"
        disabled={switching}
        onClick={() => void onSwitch()}
      >
        {switching ? 'Switching…' : `Switch to ${monadTestnet.name}`}
      </button>
      {error !== null ? <span className="network-banner__error">{error}</span> : null}
    </div>
  );
}
