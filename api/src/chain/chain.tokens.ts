/**
 * Injection tokens for the four viem clients.
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

/**
 * Signs with `FUNDER_PRIVATE_KEY`. Paired with `erc20Abi` — it never touches
 * the escrow contract at all, only `USDC.transfer` into the operator pool.
 *
 * The funder wallet is "the outside world" (`docs/rain-integration.md` §0.2):
 * the only source of money in the system, standing in for the bank now that
 * Rain's onramp is stubbed.
 *
 * ⚠️ Like the other three, this provider is **never exported** from
 * `ChainModule`. The funding module reaches it through `TokenTransferService`'s
 * two named methods and cannot reach it any other way — which is what stops a
 * key whose whole purpose is "move USDC" from also being able to name
 * `approve` on the token, or any function on any other ABI (FR-005).
 */
export const FUNDER_CLIENT = Symbol('FUNDER_CLIENT');
