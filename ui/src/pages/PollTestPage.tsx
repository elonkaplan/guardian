import { useState } from 'react';

import { apiGet } from '../api/client';
import { usePolling } from '../hooks/usePolling';

/**
 * DEV-ONLY harness for the polling hook. Not part of the product.
 *
 * `usePolling` is the one piece of shared machinery three later features
 * inherit, and its two failure modes — a leaked interval and overlapping
 * requests — surface during a demo rather than at the desk. This page makes
 * quickstart Part C checkable in ten seconds instead of by eye.
 *
 * Mounted only when `import.meta.env.DEV`, so it is absent from production
 * builds. Delete it freely if it stops earning its keep.
 *
 * Expects the throwaway stub API's `/stub/order` endpoint, which reports
 * `state: 'settled'` after N reads.
 */

interface StubOrder {
  state: string;
  reads: number;
}

export function PollTestPage() {
  const [key] = useState(() => `k${Date.now()}`);
  const [mounted, setMounted] = useState(true);

  return (
    <section>
      <p className="placeholder__kicker">Dev only</p>
      <h1 className="placeholder__title">Polling harness</h1>
      <p className="placeholder__note">
        Watch the Network panel. Not part of the product — see quickstart Part C.
      </p>
      <p>
        <button onClick={() => setMounted((m) => !m)}>
          {mounted ? 'Unmount the poller' : 'Mount the poller'}
        </button>
      </p>
      {mounted ? <Poller pollKey={key} /> : <p>Unmounted. No further requests should appear.</p>}
    </section>
  );
}

function Poller({ pollKey }: { pollKey: string }) {
  const { data, error, isPolling } = usePolling<StubOrder>(
    ['stub-order', pollKey],
    () => apiGet<StubOrder>(`/stub/order?after=4&key=${pollKey}`),
    {
      intervalMs: 1000,
      isTerminal: (d) => d.state === 'settled',
    },
  );

  return (
    <div data-testid="poll-state">
      <p>
        polling: <strong data-field="isPolling">{String(isPolling)}</strong>
      </p>
      <p>
        state: <strong data-field="state">{data?.state ?? '—'}</strong>
      </p>
      <p>
        reads: <strong data-field="reads">{data?.reads ?? '—'}</strong>
      </p>
      <p>error: {error ? `${error.kind} ${error.code}` : 'none'}</p>
    </div>
  );
}
