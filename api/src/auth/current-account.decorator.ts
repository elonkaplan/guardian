import {
  createParamDecorator,
  InternalServerErrorException,
  type ExecutionContext,
} from '@nestjs/common';
import type { Request } from 'express';

import { Account } from '../entities/account.entity';

/**
 * The calling account, as a full entity — the one way a handler learns who is
 * on the other end of the request.
 *
 * The guard has already loaded this row to check that the token names an
 * account that still exists, so reading it here costs nothing extra. Returning
 * the entity rather than a bare id is what lets ownership checks in later
 * modules read plainly:
 *
 * ```ts
 * if (agent.ownerAccountId !== account.id) throw new ForbiddenException();
 * ```
 *
 * Nothing outside `auth/` should ever read the `Authorization` header, decode a
 * token, or inject `JwtService`. This decorator and `@Public()` are the whole
 * contract.
 */
export const CurrentAccount = createParamDecorator(
  (_data: unknown, context: ExecutionContext): Account => {
    const request = context.switchToHttp().getRequest<Request>();

    if (request.account === undefined) {
      // Unreachable on a guarded route, which is exactly why it throws rather
      // than returning undefined: getting here means the decorator was used on
      // a route marked @Public(), and the next line of that handler is
      // typically an ownership comparison. Failing loudly at the parameter
      // beats `Cannot read properties of undefined` three lines in, and beats
      // an ownership check quietly comparing against nothing at all.
      //
      // A 500 rather than a 401 on purpose: this is a wiring mistake in our
      // code, not a bad credential from the caller, and labelling it 401 would
      // send whoever debugs it looking at the token.
      throw new InternalServerErrorException(
        '@CurrentAccount() used on a route the auth guard did not protect',
      );
    }

    return request.account;
  },
);
