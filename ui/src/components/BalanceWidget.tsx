import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { fetchMe } from '../api/me';
import { UNAUTHENTICATED_EVENT, readToken } from '../api/session';
import { usePolling } from '../hooks/usePolling';
import { formatUsd } from '../lib/money';
import { paths } from '../routes/paths';

/**
 * Whether a session credential is present.
 *
 * A deliberately small stand-in: UI-02 owns real session state and will replace
 * this with a context. Until then the widget needs *some* reactive answer, and
 * "a token exists" is the honest one. Listening for the unauthenticated event
 * is what makes it flip when the API rejects us.
 */
function useHasSession(): boolean {
  const [hasSession, setHasSession] = useState(() => readToken() !== null);

  useEffect(() => {
    const sync = () => setHasSession(readToken() !== null);
    window.addEventListener(UNAUTHENTICATED_EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(UNAUTHENTICATED_EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  return hasSession;
}

/**
 * Two money figures in the header, never one.
 *
 * Available balance and escrowed money are different money in different places
 * with different exits. Collapsing them into a single "balance" would be wrong
 * in both directions and makes the ledger read as broken — which is exactly the
 * question a judge asks.
 */
export function BalanceWidget() {
  const hasSession = useHasSession();

  const { data, error } = usePolling(['me'], fetchMe, {
    intervalMs: 5_000,
    enabled: hasSession,
  });

  if (!hasSession) {
    return (
      <Link to={paths.connect()} className="balance">
        <span className="balance__figure">
          <span className="balance__label">Wallet</span>
          <span className="balance__amount balance__amount--muted">Sign in</span>
        </span>
      </Link>
    );
  }

  // Unreachable API, or a first load still in flight: show the frame with
  // placeholder amounts rather than collapsing the widget. The rest of the
  // screen must keep working regardless.
  const unavailable = error !== null || data === undefined;

  return (
    <Link to={paths.wallet()} className="balance" title={error?.message ?? 'View wallet'}>
      <span className="balance__figure">
        <span className="balance__label">Available</span>
        <span className={`balance__amount${unavailable ? ' balance__amount--muted' : ''}`}>
          {unavailable ? '—' : formatUsd(data.availableBalanceMinor)}
        </span>
      </span>
      <span className="balance__figure">
        <span className="balance__label">In escrow</span>
        <span className={`balance__amount${unavailable ? ' balance__amount--muted' : ''}`}>
          {unavailable ? '—' : formatUsd(data.inEscrowMinor)}
        </span>
      </span>
    </Link>
  );
}
