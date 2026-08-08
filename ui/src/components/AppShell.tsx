import { useEffect } from 'react';
import { Link, Outlet, useNavigate } from 'react-router-dom';

import { UNAUTHENTICATED_EVENT } from '../api/session';
import { paths } from '../routes/paths';
import { BalanceWidget } from './BalanceWidget';

/**
 * The layout route every screen renders inside.
 *
 * The header lives here rather than in each page, so navigation never remounts
 * it — which is what lets the balance widget keep polling across page changes
 * instead of restarting on every click.
 */
export function AppShell() {
  const navigate = useNavigate();

  // One listener for the whole app: when the API rejects our credential, the
  // client clears it and fires this event. Handling it here rather than in each
  // screen is what stops eight pages from each having their own 401 branch.
  useEffect(() => {
    const onUnauthenticated = () => {
      navigate(paths.connect(), { replace: true });
    };
    window.addEventListener(UNAUTHENTICATED_EVENT, onUnauthenticated);
    return () => window.removeEventListener(UNAUTHENTICATED_EVENT, onUnauthenticated);
  }, [navigate]);

  return (
    <div className="shell">
      <header className="shell__header">
        <Link to={paths.connect()} className="shell__brand">
          Guardian
        </Link>
        <nav className="shell__nav">
          <Link to={paths.marketplace()}>Marketplace</Link>
          <Link to={paths.orders()}>My Orders</Link>
          <Link to={paths.sell()}>Sell</Link>
        </nav>
        <BalanceWidget />
      </header>
      <main className="shell__main">
        <Outlet />
      </main>
    </div>
  );
}
