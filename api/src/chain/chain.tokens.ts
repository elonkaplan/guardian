/**
 * Injection tokens for the three viem clients.
 *
 * In their own file rather than in `chain.module.ts` to break a real import
 * cycle: the module imports each service so it can provide it, and each service
 * needs the token to declare what it injects. Importing the tokens from the
 * module would make that cycle — which Node resolves by handing one side a
 * partially-initialised module, and the symptom is an `undefined` token at
 * decoration time rather than an error naming the cycle.
 *
 * Tokens rather than classes because a viem client is a plain object we do not
 * own, so there is no class to use as the token.
 *
 * ⚠️ These identify providers that are deliberately **never exported** from
 * `ChainModule`. A consumer that could inject a raw `WalletClient` could name
 * any function on any ABI, which would reduce the guardian's one-entry ABI to
 * decoration (FR-005).
 */

/** Read-only client: reads, receipts, preflight. Holds no key. */
export const PUBLIC_CLIENT = Symbol('PUBLIC_CLIENT');

/** Signs with `OPERATOR_PRIVATE_KEY`. Paired with `escrowOperatorAbi`. */
export const OPERATOR_CLIENT = Symbol('OPERATOR_CLIENT');

/** Signs with `GUARDIAN_PRIVATE_KEY`. Paired with `escrowResolveAbi` — one function. */
export const GUARDIAN_CLIENT = Symbol('GUARDIAN_CLIENT');
