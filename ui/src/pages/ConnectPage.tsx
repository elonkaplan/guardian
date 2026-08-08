import { useEffect, useState } from 'react';

import { type HealthResult, checkHealth } from '../api/client';
import { config } from '../config';
import { PagePlaceholder } from '../components/PagePlaceholder';

/**
 * The entry screen. UI-02 turns this into wallet connect.
 *
 * Until then it carries the API reachability indicator — which exists so the
 * client's behaviour is observable in the browser rather than only in devtools.
 */
export function ConnectPage() {
  const [health, setHealth] = useState<HealthResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    void checkHealth().then((result) => {
      if (!cancelled) {
        setHealth(result);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <PagePlaceholder
      title="Connect"
      filledBy="UI-02 — connecting a wallet is the whole of registration"
    >
      <p style={{ marginTop: 'var(--space-6)' }}>
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
    </PagePlaceholder>
  );
}
