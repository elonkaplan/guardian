import type { Hex } from 'viem';
import { z } from 'zod';

import { addressSchema } from './nonce.dto';

/**
 * `POST /auth/verify` request body — the second and last step of registration.
 *
 * The signature rule checks shape only: 0x-prefixed hex, non-empty. It
 * deliberately does not pin a length. A 65-byte EOA signature is the common
 * case, but pinning 130 hex characters would make this schema the thing that
 * rejects a smart-account signature later, and it would reject it with a `400`
 * that says "malformed" rather than a `401` that says "we could not verify
 * you" — a misleading answer to a question we may one day want to answer
 * properly.
 *
 * Anything that gets past this shape check and still cannot be recovered is
 * handled where recovery happens, as an authentication failure.
 */
export const verifyRequestSchema = z.object({
  address: addressSchema,
  signature: z
    .string()
    .regex(/^0x[a-fA-F0-9]+$/, 'expected a 0x-prefixed hex signature')
    .min(3, 'expected a non-empty hex signature')
    // Same reasoning as `addressSchema`: the regex is viem's `Hex` contract, so
    // the conversion belongs next to the rule that proves it.
    .transform((value) => value as Hex),
});

export type VerifyRequest = z.infer<typeof verifyRequestSchema>;

/**
 * `POST /auth/verify` response.
 *
 * The token and nothing else — no account id, no address, and no indication of
 * whether this sign-in created an account or reused one. That last omission is
 * deliberate: "was this address already registered" is exactly the fact
 * FR-019 keeps off the wire. A client that wants its own account reads
 * `GET /auth/session`, with the token it just received.
 */
export interface VerifyResponse {
  /** Bearer token. Valid for 7 days; no refresh, no revocation. */
  token: string;
}
