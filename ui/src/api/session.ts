/**
 * The session credential: read, written, and cleared in exactly one place.
 *
 * The token is deliberately opaque here — never decoded, never checked for
 * expiry. Expiry is discovered by the backend rejecting a request, which keeps
 * one source of truth and avoids a clock-skew bug on a demo laptop.
 *
 * UI-01 reads and clears. UI-02 (wallet connect) is the only caller of
 * writeToken, after signature verification.
 */

const STORAGE_KEY = 'guardian.jwt';

/**
 * Dispatched on `window` when the backend rejects our credential.
 *
 * An event rather than a navigation because the API client must not import the
 * router — and `window.location.href` would throw away the SPA. The app shell
 * listens and turns this into a route change.
 */
export const UNAUTHENTICATED_EVENT = 'guardian:unauthenticated';

export function readToken(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    // Storage can throw in private browsing modes. A missing token is the
    // correct degraded answer.
    return null;
  }
}

export function writeToken(token: string): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, token);
  } catch {
    // Non-fatal: the session simply won't survive a reload.
  }
}

export function clearToken(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing useful to do.
  }
}
