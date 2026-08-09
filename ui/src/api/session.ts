/**
 * The session credential: read, written, and cleared in exactly one place.
 *
 * The token is deliberately opaque here — never decoded, never checked for
 * expiry. Expiry is discovered by the backend rejecting a request, which keeps
 * one source of truth and avoids a clock-skew bug on a demo laptop.
 *
 * `writeSession` has exactly one caller — the auth context, after a signature
 * has been verified. Everything else in the app reads.
 */

import type { Address } from 'viem';

const STORAGE_KEY = 'guardian.jwt';

/**
 * The address that signed, stored alongside the token.
 *
 * Two things need it: the session must end when the wallet switches to a
 * different account, which means knowing which address the session belongs to;
 * and the header shows the abbreviated address. Decoding it out of the JWT
 * would break the "never decoded" rule above, and `GET /me` is async — the
 * header would flicker on every load. A second key is synchronous and survives
 * a reload.
 */
const ADDRESS_KEY = 'guardian.address';

export interface StoredSession {
  token: string;
  address: Address;
}

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

export function readSession(): StoredSession | null {
  try {
    const token = window.localStorage.getItem(STORAGE_KEY);
    const address = window.localStorage.getItem(ADDRESS_KEY);
    // Both keys or nothing. A half-written pair — storage evicted one, or a
    // write interrupted between the two setItem calls — is a session we cannot
    // reason about: a token with no owner can't be invalidated on account
    // switch, and an address with no token can't authenticate. Treating it as
    // no session sends the user back through connect, which repairs both keys.
    if (token === null || address === null) return null;
    return { token, address: address as Address };
  } catch {
    // Storage can throw in private browsing modes. A missing session is the
    // correct degraded answer.
    return null;
  }
}

export function writeSession(session: StoredSession): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, session.token);
    window.localStorage.setItem(ADDRESS_KEY, session.address);
  } catch {
    // Non-fatal: the session simply won't survive a reload.
  }
}

export function clearSession(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
    window.localStorage.removeItem(ADDRESS_KEY);
  } catch {
    // Nothing useful to do.
  }
}
