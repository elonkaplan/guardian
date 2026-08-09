import { Route, Routes } from 'react-router-dom';

import { AppShell } from '../components/AppShell';
import { RequireAuth } from '../components/RequireAuth';
import { AgentDetailPage } from '../pages/AgentDetailPage';
import { ConnectPage } from '../pages/ConnectPage';
import { CreateAgentPage } from '../pages/CreateAgentPage';
import { MarketplacePage } from '../pages/MarketplacePage';
import { MyAgentsPage } from '../pages/MyAgentsPage';
import { MyOrdersPage } from '../pages/MyOrdersPage';
import { NotFoundPage } from '../pages/NotFoundPage';
import { OrderDetailPage } from '../pages/OrderDetailPage';
import { PollTestPage } from '../pages/PollTestPage';
import { SellerSalePage } from '../pages/SellerSalePage';
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
        {/*
          Guarded: your orders, your money, your listings. The catalogue above
          stays public because `GET /agents` and `GET /agents/:id` are public in
          api-design §3.3 — guarding them here would contradict the backend and
          make the product feel closed for no reason.
        */}
        <Route
          path={routePatterns.orders}
          element={
            <RequireAuth>
              <MyOrdersPage />
            </RequireAuth>
          }
        />
        <Route
          path={routePatterns.orderDetail}
          element={
            <RequireAuth>
              <OrderDetailPage />
            </RequireAuth>
          }
        />
        <Route
          path={routePatterns.wallet}
          element={
            <RequireAuth>
              <WalletPage />
            </RequireAuth>
          }
        />
        <Route
          path={routePatterns.sell}
          element={
            <RequireAuth>
              <MyAgentsPage />
            </RequireAuth>
          }
        />
        <Route
          path={routePatterns.createAgent}
          element={
            <RequireAuth>
              <CreateAgentPage />
            </RequireAuth>
          }
        />
        {/*
          The seller's side of one sale. Its own screen rather than an expansion
          in the sales list — a case file plus a verdict card is taller than a
          list row, and two open disputes would turn that page into a wall — and
          deliberately not a second face on the buyer's order screen, which is
          the product's hero and is judged on being one order's state machine
          for one party.
        */}
        <Route
          path={routePatterns.sellerSale}
          element={
            <RequireAuth>
              <SellerSalePage />
            </RequireAuth>
          }
        />
        {/* Dev-only harness for quickstart Part C. Absent from production builds. */}
        {import.meta.env.DEV ? <Route path="/__poll-test" element={<PollTestPage />} /> : null}
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
