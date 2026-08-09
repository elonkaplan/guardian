import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { type HealthResult, checkHealth } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { useSignIn, type SignInPhase } from '../auth/useSignIn';
import { config } from '../config';
import { paths } from '../routes/paths';

/**
 * The entry screen — and the entire registration flow.
 *
 * No password, no email, no provisioning. Connect a wallet, sign one nonce, and
 * the first successful verify creates the account. The screen should stay as
 * simple as that fact; anything more elaborate is claiming a step exists that
 * doesn't.
 */

const PHASE_LABEL: Record<Exclude<SignInPhase, 'idle'>, string> = {
  connecting: 'Waiting for your wallet to connect…',
  'requesting-nonce': 'Requesting a one-time challenge…',
  // The one phase worth spelling out: the popup is easy to miss behind the
  // browser window, and "nothing is happening" is the usual conclusion.
  'awaiting-signature': 'Check your wallet — approve the signature to sign in.',
  verifying: 'Verifying your signature…',
};

function useApiHealth(): HealthResult | null {
  const [health, setHealth] = useState<HealthResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    void checkHealth().then((result) => {
      if (!cancelled) setHealth(result);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return health;
}

/**
 * Where to go once signed in.
 *
 * `RequireAuth` stashes the screen the user actually asked for in router state
 * before redirecting here. Honouring it is the difference between "sign in and
 * carry on" and "sign in, then find your own way back".
 *
 * The fallback is the marketplace, not this screen: returning a freshly
 * signed-in user to a connect button is a dead end.
 */
function useDestination(): string {
  const location = useLocation();
  const from = (location.state as { from?: { pathname?: string } } | null)?.from?.pathname;
  return from ?? paths.marketplace();
}

export function ConnectPage() {
  const navigate = useNavigate();
  const { isSignedIn } = useAuth();
  const { phase, failure, connectors, signIn, reset } = useSignIn();
  const health = useApiHealth();
  const destination = useDestination();

  const busy = phase !== 'idle';

  async function onConnect(connectorId: string) {
    const connector = connectors.find((c) => c.id === connectorId);
    if (connector === undefined) return;

    const { ok } = await signIn(connector);
    if (ok) {
      navigate(destination, { replace: true });
    }
  }

  // Already signed in — sending someone back through a connect button they do
  // not need is a dead end.
  if (isSignedIn) {
    return (
      <section className="connect">
        <h1 className="connect__title">You're signed in</h1>
        <p className="connect__lede">Your wallet is connected and your session is active.</p>
        <button type="button" className="connect__wallet" onClick={() => navigate(destination)}>
          Continue
        </button>
      </section>
    );
  }

  return (
    <section className="connect">
      <h1 className="connect__title">Connect your wallet</h1>
      <p className="connect__lede">
        That's the whole of it — no password, no email. Signing one message creates your
        account and signs you in.
      </p>

      {connectors.length === 0 ? (
        <p className="connect__empty">
          No browser wallet detected. Install one — <strong>MetaMask</strong> is the usual
          choice — then reload this page.
        </p>
      ) : (
        <ul className="connect__wallets">
          {connectors.map((connector) => (
            <li key={connector.id}>
              <button
                type="button"
                className="connect__wallet"
                disabled={busy}
                onClick={() => void onConnect(connector.id)}
              >
                {connector.icon !== undefined ? (
                  <img src={connector.icon} alt="" className="connect__wallet-icon" />
                ) : null}
                {connector.name}
              </button>
            </li>
          ))}
        </ul>
      )}

      {busy ? (
        <p className="connect__phase status status--pending">{PHASE_LABEL[phase]}</p>
      ) : null}

      {failure !== null ? (
        <p className="connect__failure status status--error">
          {failure.message}{' '}
          <button type="button" className="connect__dismiss" onClick={reset}>
            Dismiss
          </button>
        </p>
      ) : null}

      {/*
        Suppressed while a failure is showing. A failed sign-in against a dead
        backend would otherwise print the same fact twice, and two alerts of
        equal weight saying one thing is how a user stops reading either.
      */}
      <p className="connect__health" hidden={failure !== null}>
        {health === null ? (
          <span className="status status--pending">Checking {config.apiUrl}…</span>
        ) : health.reachable ? (
          <span className="status status--ok">
            API reachable at {config.apiUrl} (HTTP {health.status})
          </span>
        ) : (
          <span className="status status--error">API unreachable — {health.message}</span>
        )}
      </p>
    </section>
  );
}
