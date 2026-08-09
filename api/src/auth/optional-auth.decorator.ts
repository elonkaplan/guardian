import { createParamDecorator, SetMetadata } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

import type { Account } from '../entities/account.entity';

/** Metadata key the guard reads. Not part of the public surface. */
export const IS_OPTIONAL_AUTH_KEY = 'auth:isOptional';

/**
 * Marks a route as readable **with or without** a credential — the guard's third
 * state, sitting between "protected" (the default) and `@Public()`.
 *
 * What it actually does, stated precisely, because the middle row is the one
 * people assume and the last row is the one they do not:
 *
 * | Request | Behaviour |
 * | --- | --- |
 * | No `Authorization` header at all | Allowed through; `request.account` stays `undefined`. |
 * | Header present and valid | Allowed through with `request.account` set — identical to a protected route. |
 * | Header present but invalid, expired, or naming a deleted account | **401**, identical to a protected route. |
 *
 * That third row is the whole reason this is a guard change rather than a
 * `try`/`catch` in a controller. A route that tolerates *no* credential must
 * still refuse a *bad* one. If an expired token were quietly ignored, a seller
 * whose session lapsed mid-session would be served the anonymous catalogue: the
 * request `GET /agents?owner=me` would succeed, return nothing, and their screen
 * would show an empty list of their own agents — indistinguishable from "you
 * have not published anything" — instead of a prompt to sign in again. Silence
 * is the worst of the three possible answers there.
 *
 * Read the result with `@OptionalAccount()` below, never with
 * `@CurrentAccount()`: the latter throws a 500 by design when the guard did not
 * populate the request, and on an `@OptionalAuth()` route that absence is the
 * expected case rather than a wiring mistake.
 *
 * **Where it belongs.** Only on reads that are legitimately browsable before
 * sign-in and that additionally want to know who is asking when someone *is*
 * signed in. Its one current use is `GET /agents` — the public catalogue, or the
 * caller's own agents when `?owner=me` is supplied. Both live on one path and
 * one method, so Nest routes them to a single handler, and that handler cannot
 * answer the owner-scoped form without knowing the caller. `@Public()` cannot
 * serve it: `@Public()` returns before the token is ever read, so on a public
 * route `request.account` is structurally unreachable. That gap is precisely why
 * this decorator exists.
 *
 * ⚠️ It must never appear on anything that writes, or that moves money. There
 * is no such thing as an optionally-authenticated purchase, withdrawal, listing
 * update or escrow call; on those routes the absence of a credential is the
 * refusal, not a branch. Adding it to a write turns a missing token from a 401
 * into an unauthenticated mutation, which is the same class of mistake as
 * deleting an authorisation check — and it will read, in a diff, like a small
 * convenience.
 *
 * ⚠️ Prefer it on the handler, not the class. Like `@Public()`, on a controller
 * it applies to every route inside, including ones added later by someone who
 * never read this comment — and the routes added later are the ones that write.
 * If both decorators somehow land on the same target, `@Public()` wins, so
 * `@OptionalAuth()` can never be relied upon to tighten a route that another
 * annotation has already opened.
 */
export const OptionalAuth = () => SetMetadata(IS_OPTIONAL_AUTH_KEY, true);

/**
 * The calling account **if there is one** — the read side of `@OptionalAuth()`.
 *
 * The only difference from `@CurrentAccount()` is what happens when the guard
 * left `request.account` unset, and that difference is the entire point.
 * `@CurrentAccount()` treats absence as impossible and throws a 500, because on
 * a protected route it genuinely is impossible and reaching it means the
 * decorator was put on a route the guard did not protect. Here absence is the
 * ordinary case — an anonymous visitor browsing the catalogue — so it is
 * returned as `undefined` and the handler decides what it means.
 *
 * The `| undefined` in the signature is doing real work and should not be
 * asserted away with `!`. It forces the handler to write the anonymous branch
 * explicitly:
 *
 * ```ts
 * if (owner === 'me') {
 *   if (account === undefined) throw new UnauthorizedException();
 *   return this.agents.listOwnedBy(account.id);
 * }
 * return this.agents.listPublic();
 * ```
 *
 * ⚠️ An owner-scoped query must never be reached with an `undefined` account.
 * A repository method that takes the account id as an optional argument, or an
 * ownership comparison against `account?.id`, does not throw and does not warn —
 * it quietly matches nothing, or, written the other way round, matches
 * everything. Refuse first, then scope; do not let the absence flow into a
 * filter.
 */
export const OptionalAccount = createParamDecorator(
  (_data: unknown, context: ExecutionContext): Account | undefined => {
    const request = context.switchToHttp().getRequest<Request>();

    return request.account;
  },
);
