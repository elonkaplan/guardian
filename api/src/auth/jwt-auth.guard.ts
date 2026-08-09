import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService, TokenExpiredError } from '@nestjs/jwt';
import type { Request } from 'express';

import { AccountRepository } from '../accounts/account.repository';
import {
  AuthError,
  InvalidTokenError,
  MissingCredentialError,
  SessionExpiredError,
  UnknownAccountError,
} from './errors';
import { isJwtPayload } from './jwt-payload';
import { IS_OPTIONAL_AUTH_KEY } from './optional-auth.decorator';
import { IS_PUBLIC_KEY } from './public.decorator';

/**
 * Registered globally, so **every route is protected unless it says otherwise**.
 *
 * The default is the design. Opt-in protection and opt-out protection differ
 * only in what happens when someone forgets to classify an endpoint: opt-in
 * leaves `POST /withdraw` open to the internet, opt-out leaves `GET /agents`
 * returning 401 until the first page load. One of those is found by an
 * attacker, the other by a developer on the way to lunch. Roughly fifteen of
 * this backend's endpoints are protected and about seven are public, so the
 * safe default is also the quieter one.
 *
 * Unlike the sign-in path, this guard's failures ARE distinguishable from the
 * outside — expired reads differently from malformed. That is safe: both
 * statements describe a token the caller already holds, so neither tells them
 * anything they did not supply. It is also the difference between a UI that
 * silently re-prompts for a signature and one that shows "something went wrong".
 *
 * There are three states, not two. `@Public()` skips the credential entirely;
 * the unannotated default requires one; `@OptionalAuth()` sits between them and
 * means "a credential is not required, but if one is offered it must be good".
 * The middle state is not a weaker version of the default — the only thing it
 * relaxes is the *absence* of a header. Every other failure below is reached and
 * refused exactly as it would be on a protected route.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  private readonly logger = new Logger(JwtAuthGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly accounts: AccountRepository,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Handler first, then class: a @Public() controller can hold a route that
    // is itself protected, and the nearer declaration should win.
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic === true) {
      return true;
    }

    // Same handler-then-class order, and read only after @Public() has already
    // declined to return: if both somehow land on one target, @Public() wins.
    // Ordering them this way means @OptionalAuth() can never be mistaken for a
    // way to tighten a route that @Public() has already opened.
    const isOptional = this.reflector.getAllAndOverride<boolean>(
      IS_OPTIONAL_AUTH_KEY,
      [context.getHandler(), context.getClass()],
    );

    const request = context.switchToHttp().getRequest<Request>();

    // ⚠️ The header is inspected HERE, before extractBearerToken, rather than by
    // catching what it throws — and that is not a stylistic preference.
    // `extractBearerToken` raises the same `MissingCredentialError` for two
    // situations this state must hold apart: no `Authorization` header at all
    // (no credential was offered, which on an optional route is allowed) and
    // `Authorization: Bananas` (a credential was offered and it is rubbish,
    // which is a 401 anywhere). The thrown errors differ only in their message
    // string, so telling them apart after the fact would mean matching on prose
    // — a check that keeps compiling and silently stops working the day someone
    // rewords the message, and whose failure mode is admitting bad credentials.
    // A direct `=== undefined` on the header cannot rot that way.
    //
    // Deliberately narrow: only a wholly absent header short-circuits. An empty
    // string, a lone `Bearer`, or any other scheme all fall through to the
    // normal path and are refused, because each of those is a client that tried
    // to authenticate and got it wrong — exactly the case a lapsed session
    // produces, and exactly the case that must not be served an anonymous
    // response.
    if (isOptional === true && request.headers.authorization === undefined) {
      return true;
    }

    try {
      const token = this.extractBearerToken(request);
      const payload = await this.verify(token);
      const account = await this.accounts.findById(payload.sub);

      if (account === null) {
        // The token is cryptographically fine and unexpired; the account it
        // names is gone. Refusing here is the whole reason this guard touches
        // the database at all — without it a deleted account keeps working for
        // up to seven days, because there is no revocation.
        throw new UnknownAccountError(
          'token names an account that no longer exists',
          payload.sub,
        );
      }

      request.account = account;

      return true;
    } catch (error) {
      if (error instanceof AuthError) {
        throw this.refuse(error);
      }
      throw error;
    }
  }

  private extractBearerToken(request: Request): string {
    const header = request.headers.authorization;

    if (header === undefined) {
      throw new MissingCredentialError('no Authorization header');
    }

    const [scheme, token] = header.split(' ');

    if (scheme !== 'Bearer' || token === undefined || token.length === 0) {
      throw new MissingCredentialError(
        'Authorization header is not a Bearer credential',
      );
    }

    return token;
  }

  private async verify(token: string) {
    let payload: unknown;

    try {
      payload = await this.jwt.verifyAsync(token);
    } catch (cause) {
      // Expiry is the one failure worth telling the caller about specifically,
      // because it is the one with an obvious remedy.
      if (cause instanceof TokenExpiredError) {
        throw new SessionExpiredError('session token has expired');
      }
      throw new InvalidTokenError(
        `token failed verification: ${String(cause)}`,
      );
    }

    // verifyAsync resolves to `any`. A forged token is impossible without the
    // secret, but a token this server signed under an older payload shape and
    // still inside its seven-day life is not, so the shape is checked.
    if (!isJwtPayload(payload)) {
      throw new InvalidTokenError('token payload is not the expected shape');
    }

    return payload;
  }

  /**
   * Log the real cause; return the response the caller is allowed to see.
   *
   * ⚠️ The token is never logged, in whole or in part. A logged token is a live
   * credential sitting in a file with different access controls than the
   * database it opens.
   */
  private refuse(error: AuthError): UnauthorizedException {
    this.logger.warn(
      error instanceof UnknownAccountError
        ? `${error.name}: account ${error.accountId}`
        : `${error.name}: ${error.message}`,
    );

    if (error instanceof SessionExpiredError) {
      return new UnauthorizedException('Session expired');
    }

    // UnknownAccountError deliberately shares the generic message: "the account
    // this token names was deleted" is a fact about the platform's state, not
    // about the caller's token.
    return new UnauthorizedException('Authentication required');
  }
}
