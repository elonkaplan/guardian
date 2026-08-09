import { useCallback, useMemo, useRef, useState } from 'react';
import { useConnect, useConnectors, useSignMessage } from 'wagmi';
import type { Connector } from 'wagmi';

import { requestNonce, verifySignature } from '../api/auth';
import { isConnectivityError, isApiError } from '../api/errors';
import { useAuth } from './AuthContext';
import { classifyWalletError, walletErrorMessage } from '../chain/walletErrors';

/**
 * The whole of registration: connect, sign one nonce, get a session.
 *
 * Deliberately one imperative async function rather than an effect that watches
 * `address`. The effect shape is what every wagmi tutorial shows, and it has two
 * bugs this feature cannot have: it fires a signature prompt when the user
 * switches accounts in their wallet (an account change must *end* the session,
 * not silently re-sign), and under StrictMode or a reconnect-after-reload it can
 * fire when nobody asked to sign in.
 *
 * `connectAsync` resolves with the accounts, so the address is a local value and
 * never has to be observed. Concurrency becomes one ref guarding the entry point
 * instead of a dependency-array puzzle.
 *
 * This hook contains the only `signMessage` call in the application. The wallet
 * signs the auth nonce and nothing else — every chain write goes through the
 * operator, server-side.
 */

export type SignInPhase =
  | 'idle'
  | 'connecting'
  | 'requesting-nonce'
  | 'awaiting-signature'
  | 'verifying';

export interface SignInFailure {
  kind:
    | 'wallet-rejected'
    | 'signature-refused'
    | 'no-wallet'
    | 'backend-unreachable'
    | 'wallet-error';
  message: string;
}

export interface UseSignInResult {
  phase: SignInPhase;
  failure: SignInFailure | null;
  connectors: readonly Connector[];
  signIn: (connector: Connector) => Promise<{ ok: boolean }>;
  reset: () => void;
}

/** wagmi's id for the configured `injected()` connector, as opposed to a discovered one. */
const GENERIC_INJECTED_ID = 'injected';

/** Map anything the wallet throws into a failure the connect screen can render. */
function walletFailure(error: unknown, step: 'connect' | 'sign'): SignInFailure {
  const kind = classifyWalletError(error);
  const message = walletErrorMessage(kind, step);

  if (kind === 'rejected') {
    // Two different situations that must not share copy: declining to attach a
    // wallet, and attaching one but declining to prove you own it.
    return { kind: step === 'connect' ? 'wallet-rejected' : 'signature-refused', message };
  }
  if (kind === 'no-wallet') {
    return { kind: 'no-wallet', message };
  }
  return { kind: 'wallet-error', message };
}

/** Same, for the two backend calls. */
function backendFailure(error: unknown): SignInFailure {
  if (isConnectivityError(error)) {
    return {
      kind: 'backend-unreachable',
      message: 'Could not reach Guardian. Check the API is running, then try again.',
    };
  }
  if (isApiError(error)) {
    // The backend understood us and said no — a rejected signature, a stale
    // nonce. Its own message is more useful than anything we could invent.
    return { kind: 'wallet-error', message: error.message };
  }
  return { kind: 'wallet-error', message: 'Sign-in failed unexpectedly. Try again.' };
}

export function useSignIn(): UseSignInResult {
  const { onSignedIn } = useAuth();
  const { connectAsync } = useConnect();
  const { signMessageAsync } = useSignMessage();
  const available = useConnectors();

  const [phase, setPhase] = useState<SignInPhase>('idle');
  const [failure, setFailure] = useState<SignInFailure | null>(null);

  // A ref rather than `phase`, because two clicks in the same tick both read the
  // pre-render state and both would pass a state-based guard.
  const inFlight = useRef(false);

  /**
   * One entry per wallet the user actually has.
   *
   * Two passes, because there are two ways to end up with a duplicate:
   *
   * Announced wallets arrive from EIP-6963 discovery with their real name and
   * icon; the configured `injected()` connector arrives as a generic "Injected"
   * under `window.ethereum`. With MetaMask installed you get both, and the
   * screen offers "Injected" and "MetaMask" as if they were a choice — they are
   * the same extension. The announced entry is strictly better, so the generic
   * one is only shown when nothing announced itself, which is its actual job:
   * a fallback for wallets that don't implement EIP-6963.
   *
   * The id pass is belt-and-braces for a wallet announcing twice.
   */
  const connectors = useMemo(() => {
    const seen = new Set<string>();
    const unique = available.filter((connector) => {
      if (seen.has(connector.id)) return false;
      seen.add(connector.id);
      return true;
    });

    const announced = unique.filter((connector) => connector.id !== GENERIC_INJECTED_ID);
    return announced.length > 0 ? announced : unique;
  }, [available]);

  const reset = useCallback(() => setFailure(null), []);

  const signIn = useCallback(
    async (connector: Connector): Promise<{ ok: boolean }> => {
      if (inFlight.current) return { ok: false };
      inFlight.current = true;
      setFailure(null);

      try {
        setPhase('connecting');
        let address;
        try {
          const result = await connectAsync({ connector });
          address = result.accounts[0];
        } catch (error) {
          setFailure(walletFailure(error, 'connect'));
          return { ok: false };
        }

        if (address === undefined) {
          setFailure({
            kind: 'wallet-error',
            message: 'Your wallet connected but exposed no account. Unlock it and try again.',
          });
          return { ok: false };
        }

        // A fresh nonce every attempt. One left over from an abandoned attempt
        // is already spent as far as the backend is concerned.
        setPhase('requesting-nonce');
        let nonce: string;
        try {
          nonce = (await requestNonce(address)).nonce;
        } catch (error) {
          setFailure(backendFailure(error));
          return { ok: false };
        }

        // The one signature this application ever requests. The message is the
        // nonce verbatim: `/auth/verify` carries no message field, so the
        // backend reconstructs what it issued.
        setPhase('awaiting-signature');
        let signature;
        try {
          signature = await signMessageAsync({ message: nonce, account: address });
        } catch (error) {
          setFailure(walletFailure(error, 'sign'));
          return { ok: false };
        }

        setPhase('verifying');
        let token: string;
        try {
          token = (await verifySignature(address, signature)).token;
        } catch (error) {
          setFailure(backendFailure(error));
          return { ok: false };
        }

        // Nothing is persisted until here, so every branch above leaves no
        // credential and no half-signed-in state behind.
        onSignedIn({ token, address });
        return { ok: true };
      } finally {
        setPhase('idle');
        inFlight.current = false;
      }
    },
    [connectAsync, signMessageAsync, onSignedIn],
  );

  return { phase, failure, connectors, signIn, reset };
}
