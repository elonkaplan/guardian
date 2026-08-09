import { SetMetadata } from '@nestjs/common';

/** Metadata key the guard reads. Not part of the public surface. */
export const IS_PUBLIC_KEY = 'auth:isPublic';

/**
 * Marks a route — or a whole controller — as reachable without a credential.
 *
 * **This is the only way out of the guard**, because the guard is registered
 * globally and every route is protected by default. That default is the
 * feature: an endpoint nobody classified is closed, so the cost of forgetting
 * is a 401 a developer hits on the first page load, not `POST /withdraw`
 * standing open to the internet.
 *
 * The set of routes that legitimately carry this is small and unlikely to grow
 * much:
 *
 * - `GET /health` — a health check behind a guard is a health check nothing can
 *   call, and Compose's dependency graph fails for a reason that looks like a
 *   database problem
 * - `POST /auth/nonce`, `POST /auth/verify` — you cannot present a credential
 *   you do not have yet
 * - the public catalogue reads — the marketplace is browsable before sign-in
 * - `/demo/*` — rehearsal tooling, deliberately unguarded
 *
 * ⚠️ Adding it anywhere else deserves the same scrutiny as deleting an
 * authorisation check, because that is what it is. In particular, never put it
 * on a controller that also has money-moving or ownership-scoped routes: on a
 * class it applies to every handler inside, including ones added later by
 * someone who never read this comment.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
