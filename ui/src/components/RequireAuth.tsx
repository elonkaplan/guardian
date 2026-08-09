import type { ReactElement, ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';

import { useAuth } from '../auth/AuthContext';
import { paths } from '../routes/paths';

/**
 * The gate in front of every screen that needs a session.
 *
 * "Don't know yet" is not "signed out". A guard that redirects while the auth
 * state is still resolving bounces the user to the connect screen a tick before
 * the session lands — the bug that makes a direct reload of a protected URL
 * fail. Auth resolves synchronously today, so that branch is unreachable; the
 * guard still handles it, so it is not the thing that breaks the day someone
 * validates the token against the backend on boot.
 *
 * `state={{ from: location }}` carries the destination the user actually asked
 * for, so the connect screen can send them there after sign-in rather than
 * dumping them on a generic landing page. Router state rather than a query
 * parameter keeps the URL clean during a demo.
 *
 * `replace` keeps the protected URL out of history, so back from the connect
 * screen does not bounce the user through this guard again.
 */
export function RequireAuth({ children }: { children: ReactNode }): ReactElement {
  const { state } = useAuth();
  const location = useLocation();

  if (state.status === 'resolving') {
    return <p className="resolving">Checking your session…</p>;
  }

  if (state.status === 'signed-out') {
    return <Navigate to={paths.connect()} state={{ from: location }} replace />;
  }

  return <>{children}</>;
}
