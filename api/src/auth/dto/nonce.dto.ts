import type { Address } from 'viem';
import { z } from 'zod';

/**
 * What a valid wallet address looks like, defined once for the whole auth
 * module.
 *
 * The regex is deliberately the same one `src/config/env.schema.ts` uses for
 * `OPERATOR_ADDRESS`, `GUARDIAN_ADDRESS` and `FUNDER_ADDRESS`. Two definitions
 * of "valid address" in one backend is two chances to disagree about it, and
 * the one that disagrees is always the one guarding money.
 *
 * Case is not constrained here on purpose — a user may paste any casing, and
 * canonicalisation to EIP-55 happens once, in `AccountRepository`. This rule
 * answers "is this shaped like an address", not "is this the canonical form".
 *
 * `verify.dto.ts` imports this rather than restating it.
 */
export const addressSchema = z
  .string()
  .regex(/^0x[a-fA-F0-9]{40}$/, 'expected 0x-prefixed 40-hex-char address')
  // The cast is safe because the regex above is exactly viem's `Address`
  // contract, and it happens here so that no handler downstream has to write
  // `as Address` on a value whose shape has already been proven. A cast in a
  // controller is a claim; a cast one line below the rule that justifies it is
  // a conversion.
  .transform((value) => value as Address);

/**
 * `POST /auth/nonce` request body.
 *
 * Requesting a challenge is not a claim to own the address and reveals
 * nothing: one is issued for any well-formed address, registered or not.
 * Refusing unregistered addresses here would turn this endpoint into a way to
 * enumerate which wallets hold accounts.
 */
export const nonceRequestSchema = z.object({
  address: addressSchema,
});

export type NonceRequest = z.infer<typeof nonceRequestSchema>;

/**
 * `POST /auth/nonce` response.
 *
 * `message` is an addition to the `{ nonce }` shape in `docs/api-design.md`
 * §3.1, and it is the difference between a signature scheme that works and one
 * that breaks on a trailing newline. If the client composed the message from a
 * format both sides had memorised, any drift would surface as "signature does
 * not match your address" with no hint that formatting was the cause. Returning
 * the exact bytes makes the format server-owned; `nonce` stays present, so the
 * documented shape is a subset of this one.
 */
export interface NonceResponse {
  /** 32 random bytes, hex. Valid for one use or five minutes, whichever first. */
  nonce: string;
  /** The exact string to sign — byte for byte, newlines included. */
  message: string;
}
