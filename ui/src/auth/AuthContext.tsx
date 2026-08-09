import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useConnection, useConnectionEffect, useDisconnect } from 'wagmi';
import type { Address } from 'viem';

import { UNAUTHENTICATED_EVENT, clearSession, readSession, writeSession } from '../api/session';
import type { StoredSession } from '../api/session';

/**
 * The app's one answer to "who is signed in?".
 *
 * Identity is the stored credential — never wagmi's connection state. Two
 * things persist across a reload and they are not the same thing: our token
 * (synchronous, in localStorage) and wagmi's wallet connection (asynchronous,
 * restored by `reconnectOnMount`). Deriving identity from the wallet would sign
 * the user out every time the extension happened to be locked or slow, which is
 * exactly the stumble a mid-demo page refresh must not produce.
 *
 * Nothing after sign-in needs the wallet. This app requests one signature, ever.
 *
 * No component may read localStorage to decide what to render — storage is not
 * reactive, so a component that reads it directly will not re-render on sign-out.
 * Everything goes through `useAuth`.
 */

export type AuthState =
  | { status: 'resolving' }
  | { status: 'signed-out' }
  | { status: 'signed-in'; address: Address };

export interface AuthContextValue {
  state: AuthState;
  isSignedIn: boolean;
  /** Called by useSignIn after a successful verify: persists, then transitions. */
  onSignedIn: (session: StoredSession) => void;
  /** The only way to end a session from the UI. Clears the credential *and* releases the wallet. */
  signOut: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  // Resolved synchronously, in the initialiser, so the very first render is
  // already correct. An effect would render signed-out once and then correct
  // itself — a visible flash of the connect screen on every reload, and a
  // guarded route would have redirected before the correction arrived.
  //
  // 'resolving' is therefore unreachable today. It stays in the union because
  // RequireAuth has to handle it, and the moment anyone validates the token
  // against the backend on boot, the redirect race comes back.
  const [state, setState] = useState<AuthState>(() => {
    const stored = readSession();
    return stored === null
      ? { status: 'signed-out' }
      : { status: 'signed-in', address: stored.address };
  });
  const { disconnect } = useDisconnect();

  const onSignedIn = useCallback((session: StoredSession) => {
    writeSession(session);
    setState({ status: 'signed-in', address: session.address });
  }, []);

  /**
   * End the session without touching the wallet.
   *
   * Used by the involuntary paths — the backend rejected us, the account
   * changed, the wallet let go — where the connection is already gone or is not
   * ours to close. Separate from `signOut` so that calling wagmi's `disconnect`
   * can't loop back through the disconnect handler into itself.
   *
   * Idempotent by way of the functional update: repeated calls, including the
   * one our own `signOut` provokes, settle on the same state.
   */
  const endSession = useCallback(() => {
    clearSession();
    setState((previous) =>
      previous.status === 'signed-out' ? previous : { status: 'signed-out' },
    );
  }, []);

  const signOut = useCallback(() => {
    // Both halves, always. Clearing the credential without releasing the wallet
    // leaves the extension still attached to a site it is no longer signed in
    // to — and the next connect attempt then skips the prompt the user expects.
    clearSession();
    disconnect();
    setState({ status: 'signed-out' });
  }, [disconnect]);

  // The backend rejected our credential. `client.ts` has already cleared the
  // token and AppShell already handles the navigation — this is the state half
  // only, so there is exactly one mechanism and no second redirect racing it.
  //
  // clearSession() rather than nothing: the client clears `guardian.jwt` but
  // knows nothing about `guardian.address`, and leaving a stale address behind
  // is untidy at best.
  useEffect(() => {
    window.addEventListener(UNAUTHENTICATED_EVENT, endSession);
    return () => window.removeEventListener(UNAUTHENTICATED_EVENT, endSession);
  }, [endSession]);

  /**
   * The wallet switched to a different account.
   *
   * End the session — do not re-sign. Signing the new address automatically
   * would throw an unrequested wallet prompt at someone who only wanted to look
   * at another account, and continuing with the old session while showing the
   * new address would misrepresent whose money is on screen.
   *
   * Compared case-insensitively: wallets differ on whether they return
   * checksummed hex, and a case mismatch here would sign the user out on every
   * render.
   */
  const walletAddress = useConnection().address;
  useEffect(() => {
    if (state.status !== 'signed-in' || walletAddress === undefined) return;
    if (walletAddress.toLowerCase() !== state.address.toLowerCase()) {
      endSession();
    }
  }, [walletAddress, state, endSession]);

  /**
   * The site was disconnected from inside the wallet.
   *
   * This is `useConnectionEffect` rather than a check on connection status
   * because it must fire on the *transition* only. Status is 'disconnected'
   * during the async reconnect on every page load, and treating that as a
   * sign-out would undo the whole point of persisting the credential — a locked
   * or slow-to-reconnect wallet is not a signed-out user.
   */
  useConnectionEffect({ onDisconnect: endSession });

  const value = useMemo<AuthContextValue>(
    () => ({ state, isSignedIn: state.status === 'signed-in', onSignedIn, signOut }),
    [state, onSignedIn, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (value === null) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return value;
}
