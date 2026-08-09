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

/**
 * `GET /agents` (api-design §3.3): one card in the catalogue.
 *
 * The list is deliberately thinner than the detail response rather than being
 * the same object with fields left out. A card has to answer one question —
 * "is this the agent I want, and can I afford it?" — and everything beyond
 * name, description, and price is weight the marketplace grid does not carry.
 *
 * `priceMinor` is integer USD cents, per `lib/money`. The `Minor` suffix is
 * kept from `AccountSummary` so that no reader has to guess whether a number
 * on this type is dollars.
 *
 * NOTE: field names are provisional, for the same reason as `AccountSummary`
 * above — API-06 is unbuilt and no OpenAPI document exists yet. camelCase is
 * chosen because api-design §3.4 spells the purchase body that way.
 */
export interface AgentSummary {
  id: string;
  name: string;
  description: string;
  priceMinor: Cents;
}

/**
 * `GET /agents/:id` (api-design §3.3): everything the detail screen is allowed
 * to know about an agent.
 *
 * `capabilities` and `exclusions` are required arrays, not optional ones. The
 * backend column is `text[] NOT NULL` — they may be empty, but they are never
 * absent. Typing them as optional would be a lie about the wire format with a
 * cost: it invites `?.map()` at every call site and lets a seller who declared
 * nothing disappear behind a section that simply fails to render, which is
 * exactly the silence the screen is supposed to break. An empty array is a
 * statement the buyer should see; `undefined` is not.
 *
 * What is missing from this type is the point of it. There is no
 * `systemPrompt`, no `model`, no `timeoutSeconds`, and adding one would be a
 * defect rather than an enhancement. The absent property *is* the guarantee:
 * the screen cannot render seller IP because the type gives it nowhere to put
 * it, so no component can leak the prompt even if the serialiser upstream were
 * to regress and start sending it. That is requirement FR-011, enforced by the
 * shape of the data rather than by everyone remembering.
 *
 * There is likewise no separate human-readable description of the input. The
 * prose a buyer reads is derived from the schema's own `title` and
 * `description` keywords, because the database carries only the schema and a
 * second field would immediately be free to contradict it.
 */
export interface AgentListing extends AgentSummary {
  capabilities: string[];
  exclusions: string[];
  inputSchema: JsonSchema;
  outputSchema: JsonSchema;
}

/**
 * The slice of JSON Schema this app reads — not an implementation of it.
 *
 * These are the keywords the form builder consults when it turns a seller's
 * declared input contract into controls. Anything outside this list is passed
 * over rather than rejected; a schema this app cannot lay out as fields is
 * shown to the buyer as raw JSON instead, which means an unknown keyword costs
 * a fallback rather than an error.
 *
 * Every keyword is optional, including `type`, because a seller's schema is
 * arbitrary JSON that arrived through a raw textarea. Nothing upstream
 * validates that it is a schema at all, so a type that promised any required
 * key would be describing a document that may never have existed.
 */
export interface JsonSchema {
  type?: string | string[];
  title?: string;
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  enum?: unknown[];
  format?: string;
  maxLength?: number;
  default?: unknown;
}

/**
 * `POST /orders` (api-design §3.4): the whole of a purchase.
 *
 * Note what a buyer cannot send. There is no price, because the order's price
 * is a snapshot the backend takes from the listing it is charging against — a
 * client-supplied figure would be an invitation to pay a number of one's own
 * choosing. There is no `reviewWindowSeconds` either; it comes from backend
 * configuration and never from the client (api-design §4), so that the window
 * is the same length for everyone regardless of who is asking.
 *
 * Both omissions are requirement FR-021, and this type is where it is
 * enforced: the request has nowhere to put them, so no form and no handler can
 * develop the habit of sending them.
 *
 * `input` is `Record<string, unknown>` rather than a generic parameter because
 * its shape is the seller's `inputSchema`, which is only known at runtime.
 * `acceptanceCriteria` is the buyer's own prose — it is what Guardian later
 * checks the output against, and it has no schema.
 *
 * NOTE: field names are provisional, for the same reason as `AccountSummary`
 * above.
 */
export interface CreateOrderRequest {
  agentId: string;
  input: Record<string, unknown>;
  acceptanceCriteria: string;
}

/**
 * The response to `POST /orders` (api-design §3.4), as far as this feature is
 * concerned: an id to navigate to.
 *
 * Deliberately not the created order. State, output, countdown, and verdict
 * are the order screen's subject in UI-04, and modelling them here would mean
 * two type definitions racing to describe the same resource. Whatever else the
 * backend returns is ignored until there is a screen that reads it.
 */
export interface CreateOrderResponse {
  id: string;
}
