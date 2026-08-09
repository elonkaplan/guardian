import type { JSX } from 'react';

import { useAuth } from '../auth/AuthContext';

/**
 * Who is signed in, and the way out.
 *
 * Renders nothing at all when signed out. BalanceWidget already owns the
 * sign-in affordance in the header, and two prompts sitting side by side read
 * as a bug rather than a choice.
 *
 * The address is abbreviated because a full one is unreadable at header size
 * and would push the nav around; `title` keeps the whole thing one hover away,
 * which is what someone actually needs when checking which account is active.
 *
 * Disconnect goes through `signOut` — the only way to end a session from the
 * UI, because it clears the credential *and* releases the wallet. Doing either
 * half alone leaves the app and the extension disagreeing about who is here.
 */
export function WalletMenu(): JSX.Element | null {
  const { state, signOut } = useAuth();

  if (state.status !== 'signed-in') {
    return null;
  }

  return (
    <div className="wallet-menu">
      <span className="wallet-menu__address" title={state.address}>
        {abbreviate(state.address)}
      </span>
      <button type="button" className="wallet-menu__disconnect" onClick={signOut}>
        Disconnect
      </button>
    </div>
  );
}

function abbreviate(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}
