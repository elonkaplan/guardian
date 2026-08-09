import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { getAddress, recoverMessageAddress, type Address, type Hex } from 'viem';

import { AccountRepository } from '../accounts/account.repository';
import {
  AuthError,
  NonceExpiredError,
  NonceNotFoundError,
  SignatureMalformedError,
  SignerMismatchError,
} from './errors';
import { NonceStore } from './nonce.store';
import { buildSignInMessage } from './sign-in-message';
import type { NonceResponse } from './dto/nonce.dto';
import type { VerifyResponse } from './dto/verify.dto';

/**
 * Sign-in: a challenge out, a signature in, a session token back — and an
 * account created on the way through if this wallet has never been seen.
 * Connecting a wallet is the entire registration flow; there is no other way to
 * become a user of this platform.
 *
 * Two things about this class are worth reading before changing it.
 *
 * **The order of operations in `verifySignature` is the security model**, not a
 * style choice. See the comment there.
 *
 * **Every failure leaves by the same door.** Four distinct internal errors
 * collapse into one identical 401. That is not laziness — accounts here *are*
 * wallet addresses, so an endpoint that answered differently for a registered
 * address than an unregistered one would let anyone enumerate which wallets
 * hold money on this platform, one request at a time. The real cause goes to
 * the log, where it helps the operator and nobody else.
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly nonces: NonceStore,
    private readonly accounts: AccountRepository,
    private readonly jwt: JwtService,
  ) {}

  /**
   * Issue a sign-in challenge and the exact message to sign.
   *
   * Granted for any well-formed address, registered or not. Refusing unknown
   * addresses would answer the one question this module is careful never to
   * answer.
   */
  issueNonce(address: Address): NonceResponse {
    const canonical = getAddress(address);
    const stored = this.nonces.issue(canonical);

    return {
      nonce: stored.nonce,
      message: buildSignInMessage(stored.address, stored.nonce),
    };
  }

  /**
   * Exchange a signature for a session token, creating the account if this is
   * the address's first successful sign-in.
   *
   * ⚠️ **The challenge is consumed before the signature is examined**, and a
   * failed check does not put it back. Reverse those two steps and a captured
   * message becomes a five-minute window to grind signatures against a live
   * challenge; in this order it is worth exactly one attempt. Every other
   * property here is ordinary; this one is the reason replay does not work.
   *
   * The message is rebuilt from the *stored* nonce and the *stored* address,
   * never from the request. The client cannot influence what it is measured
   * against.
   */
  async verifySignature(
    address: Address,
    signature: Hex,
  ): Promise<VerifyResponse> {
    const canonical = getAddress(address);

    try {
      const result = this.nonces.consume(canonical);

      if (result.outcome === 'missing') {
        throw new NonceNotFoundError(
          `no outstanding sign-in challenge for ${canonical}`,
        );
      }
      if (result.outcome === 'expired') {
        throw new NonceExpiredError(
          `sign-in challenge for ${canonical} had expired`,
        );
      }

      const { stored } = result;
      const message = buildSignInMessage(stored.address, stored.nonce);

      // Recovery is wrapped because viem throws on a signature it cannot
      // decode, and an undecodable signature is an authentication failure, not
      // a 500. Nothing else in this block is allowed to be swallowed by the
      // catch, which is why only this call sits inside it.
      let recovered: Address;
      try {
        recovered = await recoverMessageAddress({ message, signature });
      } catch (cause) {
        throw new SignatureMalformedError(
          `signature for ${canonical} could not be decoded: ${String(cause)}`,
        );
      }

      // `recoverMessageAddress` returns an EIP-55 checksummed address and
      // `stored.address` is checksummed at issue time, so `!==` is a correct
      // comparison. Verified against viem 2.55.11 rather than assumed.
      if (recovered !== stored.address) {
        throw new SignerMismatchError(
          'recovered signer does not match the claimed address',
          stored.address,
          recovered,
        );
      }

      const account = await this.accounts.findOrCreateByAddress(recovered);

      return { token: await this.jwt.signAsync({ sub: account.id }) };
    } catch (error) {
      if (error instanceof AuthError) {
        throw this.refuse(error);
      }
      throw error;
    }
  }

  /**
   * Log what actually happened, then return the one response the caller is
   * allowed to see.
   *
   * The two addresses on a mismatch are the most useful pair of values in this
   * whole module: during a demo the likeliest cause is a wallet connected to a
   * different account than the one on screen, and seeing both turns a
   * five-minute confusion into a five-second one. Addresses are public by
   * construction, so this leaks nothing the chain does not already publish.
   *
   * ⚠️ The signature bytes and the token are never logged. Neither helps, and
   * a token in a log file is a live credential sitting under different access
   * controls than the database it grants access to.
   */
  private refuse(error: AuthError): UnauthorizedException {
    if (error instanceof SignerMismatchError) {
      this.logger.warn(
        `${error.name}: expected ${error.expected}, recovered ${error.recovered}`,
      );
    } else {
      this.logger.warn(`${error.name}: ${error.message}`);
    }

    // One message for every sign-in failure. Do not make this specific.
    return new UnauthorizedException('Signature verification failed');
  }
}
