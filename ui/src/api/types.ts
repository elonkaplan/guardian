import type { Address, Hex } from 'viem';

import type { Cents } from '../lib/money';

/**
 * Payload types, hand-written until the API publishes a schema.
 *
 * If API-01 emits an OpenAPI document, generated types replace this module and
 * nothing else changes.
 */

/**
 * `GET /me` (api-design §3.2): account, available balance, and the amount
 * currently in escrow.
 *
 * Two figures, never summed. They are different money in different places with
 * different exits — available balance lives in the Postgres ledger and leaves
 * via cash-out; escrowed money is locked on-chain until an order settles.
 * A single combined number would be wrong in both directions.
 *
 * Not here: *settled* funds (the on-chain `balances[]` a user withdraws to
 * their own wallet). Those are the Wallet page's concern in UI-06, read from a
 * different source.
 *
 * NOTE: field names are provisional — api-design documents the meanings but not
 * the exact JSON casing. If API-01 lands different names, this file is the only
 * thing that changes.
 */
export interface AccountSummary {
  address: string;
  availableBalanceMinor: Cents;
  inEscrowMinor: Cents;
}

/**
 * `POST /auth/nonce` then `POST /auth/verify` (api-design §3.1).
 *
 * The message signed is the `nonce` value verbatim, as a personal message. Note
 * what the verify payload does not carry: a message field. The backend has to
 * reconstruct what it issued, which is why a structured sign-in message
 * (SIWE-style, with domain and statement) is not used here — it would have
 * nowhere to travel.
 *
 * The first successful verify creates the account. Connecting a wallet is the
 * whole of registration: no password, no email.
 *
 * NOTE: field names are provisional, for the same reason as `AccountSummary`
 * above.
 */
export interface NonceRequest {
  address: Address;
}

export interface NonceResponse {
  nonce: string;
}

export interface VerifyRequest {
  address: Address;
  signature: Hex;
}

export interface VerifyResponse {
  token: string;
}
