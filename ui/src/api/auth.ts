import type { Address, Hex } from 'viem';

import { apiPost } from './client';
import type { NonceResponse, VerifyResponse } from './types';

/**
 * Sign-in, in two calls (api-design §3.1): ask for a nonce, return a signature
 * over it, get a token back. The first successful verify creates the account.
 *
 * Both go through `apiPost`, so they inherit the base URL, the bearer-token
 * attachment, the timeout, and `ApiError` normalisation — the point of having a
 * single client. Neither call needs a credential; the client attaches one only
 * if one already exists, which is harmless here.
 */

export function requestNonce(address: Address): Promise<NonceResponse> {
  return apiPost<NonceResponse>('/auth/nonce', { address });
}

export function verifySignature(address: Address, signature: Hex): Promise<VerifyResponse> {
  return apiPost<VerifyResponse>('/auth/verify', { address, signature });
}
