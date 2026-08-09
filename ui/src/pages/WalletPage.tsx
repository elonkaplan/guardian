import { useQueryClient } from '@tanstack/react-query';
import type { JSX } from 'react';

import { LedgerTable } from '../components/LedgerTable';
import { LoadState } from '../components/LoadState';
import { MoneyFigures } from '../components/MoneyFigures';
import { WalletActions } from '../components/WalletActions';
import { useAccountSummary } from '../hooks/useAccountSummary';
import { useLedger } from '../hooks/useLedger';

/**
 * Money in, money out, and the two kinds of money kept apart.
 *
 * Composition only — every rule this screen enforces lives in the components
 * below it. Three things about the wiring are worth knowing, though, because
 * each of them is a decision rather than an accident.
 *
 * **This page does not poll `/me`.** It subscribes. `useAccountSummary` is a
 * passive reader of the `['me']` cache entry that `BalanceWidget` — mounted in
 * the shell, one element above this content — already refreshes every five
 * seconds. Query-key deduplication shares the *data* but not the *schedule*, so
 * a `usePolling(['me'])` here would quietly double the request rate against the
 * most-polled endpoint in the product, and put two independent reads of the
 * same number a couple of inches apart on the one screen whose entire promise
 * is that the money figures can be trusted. The statement is this page's own
 * poll, and the only one it owns (research R4).
 *
 * **The two panels fail independently.** A statement that will not load must
 * not blank the figures, and figures that will not load must not blank the
 * statement — the same rule the order screen applies to the verdict card and
 * the case file. That is why `LedgerTable` takes its own error and its own
 * retry rather than being gated on the account read.
 *
 * **A failed refresh is not the same as no data.** Once figures have been read
 * successfully, a later failure leaves them on screen marked stale rather than
 * emptying the page: three money figures vanishing because one poll blipped is
 * the screen breaking itself in front of an audience (FR-007). Only a first
 * read that has never succeeded gets the load-and-retry treatment.
 *
 * No auth branch here. `/wallet` is wrapped in `RequireAuth` in the router, so
 * a signed-out visitor never reaches this component (FR-036).
 */
export function WalletPage(): JSX.Element {
  const queryClient = useQueryClient();
  const { data: account, error: accountError } = useAccountSummary();
  const ledger = useLedger();

  /*
   * Retry by invalidating the shared key, never by reloading the page.
   * `LoadState`'s own comment argues this: a reload throws away the wallet
   * session and everything else on screen to fix one failed request, which is a
   * worse outcome than the failure. The shell's widget owns this query's
   * schedule, so nudging the key is the whole of a retry from here.
   */
  const retryAccount = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['me'] });
  };

  // Never read successfully: there is nothing to show and nothing to mark stale.
  if (account === undefined) {
    return (
      <section className="wallet">
        <h1 className="wallet__heading">Wallet</h1>
        {accountError !== null ? (
          <LoadState
            status="error"
            message="Your balances could not be loaded."
            onRetry={retryAccount}
          />
        ) : (
          <LoadState status="loading" message="Loading your balances…" />
        )}
      </section>
    );
  }

  return (
    <section className="wallet">
      <h1 className="wallet__heading">Wallet</h1>

      <MoneyFigures account={account} stale={accountError !== null} />

      <WalletActions account={account} />

      <LedgerTable
        entries={ledger.data}
        error={ledger.error}
        onRetry={ledger.refetch}
      />
    </section>
  );
}
