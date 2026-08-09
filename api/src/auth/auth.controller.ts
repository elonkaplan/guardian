import { Body, Controller, Get, Post } from '@nestjs/common';

import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { Account } from '../entities/account.entity';
import { AuthService } from './auth.service';
import { CurrentAccount } from './current-account.decorator';
import { Public } from './public.decorator';
import {
  nonceRequestSchema,
  type NonceRequest,
  type NonceResponse,
} from './dto/nonce.dto';
import {
  verifyRequestSchema,
  type VerifyRequest,
  type VerifyResponse,
} from './dto/verify.dto';

/**
 * The two calls that turn a wallet into an account.
 *
 * Both are unauthenticated, necessarily — you cannot present a credential you
 * do not have yet. Once the global guard lands they carry `@Public()`, and that
 * marker is load-bearing rather than decorative: without it the platform has no
 * reachable way to sign anyone in.
 *
 * The pipes are attached per-parameter rather than through a global
 * `ValidationPipe` so the schema governing a body is visible at the handler
 * that receives it. They also do real work for this feature specifically: a
 * malformed address is rejected here, which means no challenge is ever issued
 * for one.
 */
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /**
   * Issue a single-use challenge and the exact message to sign.
   *
   * Issuing a second challenge for an address invalidates the first, so at most
   * one is ever outstanding.
   */
  @Post('nonce')
  @Public()
  issueNonce(
    @Body(new ZodValidationPipe(nonceRequestSchema)) body: NonceRequest,
  ): NonceResponse {
    return this.auth.issueNonce(body.address);
  }

  /**
   * Exchange a signature for a session token, creating the account on a first
   * successful sign-in.
   *
   * Returns the token and nothing else — not the account id, not the address,
   * and no hint as to whether this call created an account or found one.
   */
  @Post('verify')
  @Public()
  verify(
    @Body(new ZodValidationPipe(verifyRequestSchema)) body: VerifyRequest,
  ): Promise<VerifyResponse> {
    return this.auth.verifySignature(body.address, body.signature);
  }

  /**
   * Who the presented token belongs to — the guard's own witness.
   *
   * It exists because without one protected route the guard and
   * `@CurrentAccount()` would go unexercised until API-05 ships, and an
   * untested guard is a guard nobody should trust. It is two lines over
   * machinery that already ran.
   *
   * **Not `/me`.** API-05's `/me` returns available balance and the amount
   * currently in escrow alongside the account, and belongs to the `accounts`
   * module. This answers the narrower question a UI asks on load — is my stored
   * token still good, and whose is it — without pulling in the money model.
   */
  @Get('session')
  session(@CurrentAccount() account: Account): {
    accountId: string;
    address: string;
  } {
    return { accountId: account.id, address: account.walletAddress };
  }
}
