import { Route, Routes } from 'react-router-dom';

import { AppShell } from '../components/AppShell';
import { AgentDetailPage } from '../pages/AgentDetailPage';
import { ConnectPage } from '../pages/ConnectPage';
import { CreateAgentPage } from '../pages/CreateAgentPage';
import { MarketplacePage } from '../pages/MarketplacePage';
import { MyAgentsPage } from '../pages/MyAgentsPage';
import { MyOrdersPage } from '../pages/MyOrdersPage';
import { NotFoundPage } from '../pages/NotFoundPage';
import { OrderDetailPage } from '../pages/OrderDetailPage';
import { PollTestPage } from '../pages/PollTestPage';
import { WalletPage } from '../pages/WalletPage';
import { routePatterns } from './paths';

/**
 * The eight product screens plus a catch-all, all inside the shell layout.
 *
 * React Router v7 ranks static segments above dynamic ones, so `/sell/new`
 * beats a future `/sell/:id` and `/orders` beats `/orders/:id` regardless of
 * declaration order. Worth knowing before UI-07 adds to this file.
 */
export function AppRoutes() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route path={routePatterns.connect} element={<ConnectPage />} />
        <Route path={routePatterns.marketplace} element={<MarketplacePage />} />
        <Route path={routePatterns.agentDetail} element={<AgentDetailPage />} />
        <Route path={routePatterns.orders} element={<MyOrdersPage />} />
        <Route path={routePatterns.orderDetail} element={<OrderDetailPage />} />
        <Route path={routePatterns.wallet} element={<WalletPage />} />
        <Route path={routePatterns.sell} element={<MyAgentsPage />} />
        <Route path={routePatterns.createAgent} element={<CreateAgentPage />} />
        {/* Dev-only harness for quickstart Part C. Absent from production builds. */}
        {import.meta.env.DEV ? <Route path="/__poll-test" element={<PollTestPage />} /> : null}
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
