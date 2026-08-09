import type { Address } from 'viem';

/**
 * Abstract root of every error this module can throw.
 *
 * Every concrete subclass extends this one class, so a caller that only needs
 * to know "did something go wrong inside auth" can write a single
 * `catch (e) { if (e instanceof AuthError) }` and be done, without enumerating
 * eight class names. Anything finer than that — which specific failure, and
 * therefore what to log — requires checking the concrete subclass, which is
 * why the per-class fields below exist rather than being flattened into a
 * message string a caller would have to parse.
 *
 * THE CENTRAL DESIGN FACT OF THIS FILE: these eight classes exist to be
 * distinguished in the LOG, and they deliberately collapse to just two
 * messages on the wire. The log gets the truth; the caller gets as little as
 * is useful. The classes are the mechanism that keeps those two audiences
 * apart — the same reason they are plain errors rather than
 * `HttpException` subclasses (see the note at the bottom of this comment).
 *
 * Why the four sign-in failures produce one identical response: accounts here
 * ARE wallet addresses. A response that said "no challenge outstanding for
 * this address" where another said "signature did not match" would answer,
 * for any address a script cares to try, the question "does this wallet have
 * an account here?" — i.e. which wallets hold money on this platform. That is
 * a financial privacy leak assembled by anyone with a for-loop, not a
 * cosmetic inconsistency. So `NonceNotFoundError`, `NonceExpiredError`,
 * `SignatureMalformedError` and `SignerMismatchError` all surface as
 * `401 "Signature verification failed"` — same status, same string, same
 * shape — while each logs its own distinct cause.
 *
 * Distinguishing failures on the guard side is safe and intended. A guard
 * failure describes a token the caller is already holding: "your session
 * expired" and "your token is invalid" tell them nothing they did not
 * themselves supply, and the difference is what lets a UI silently prompt a
 * re-sign instead of showing a generic error. Hence
 * `SessionExpiredError` → `401 "Session expired"` while the other three
 * guard errors → `401 "Authentication required"`. `UnknownAccountError` shares
 * the generic message on purpose: "the account this token names no longer
 * exists" is a fact about the platform's state rather than about the caller's
 * token, and it is the one guard failure whose specific cause could be
 * informative to someone probing.
 *
 * ⚠️ WARNING TO FUTURE MAINTAINERS: do not "helpfully" give the four sign-in
 * errors distinct HTTP messages later. Splitting "no challenge for this
 * address" out from "signature did not match" reintroduces exactly the
 * account-enumeration oracle this design exists to remove, and it will look
 * like a small usability improvement when it is made. Better error messages
 * belong in the log, which already has them.
 *
 * These classes are thrown internally and mapped to `UnauthorizedException`
 * by the service and the guard; they are NOT HTTP exceptions themselves. That
 * split is what keeps the mapping — the place where eight causes become two
 * messages — in one reviewable location instead of scattered across every
 * throw site.
 */
export abstract class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/**
 * No challenge is outstanding for this address: either one was never
 * requested, or one was requested and has already been spent.
 *
 * Those two causes are deliberately NOT distinguished, and not only for the
 * privacy reason above — after the challenge is consumed the entry is gone,
 * so there is genuinely nothing left in the store to tell "never requested"
 * from "already used". The information does not exist to be leaked.
 *
 * Caller action: request a fresh challenge and sign that one. Retrying the
 * same signature will fail identically, since single-use consumption is the
 * replay defence and a spent nonce never comes back.
 *
 * External response: `401 "Signature verification failed"` — identical to the
 * other three sign-in failures.
 */
export class NonceNotFoundError extends AuthError {
  constructor(message: string) {
    super(message);
  }
}

/**
 * A challenge was found for this address, but it is past its five-minute life
 * (`NONCE_TTL_MS`) and was refused on read.
 *
 * This is the backstop for challenges nobody ever spends; the real replay
 * defence is single-use consumption. Distinct from `NonceNotFoundError` in
 * the log because the two say very different things about what went wrong —
 * an expired nonce means the user took too long at their wallet, a missing
 * one means the flow was never started or was already completed.
 *
 * Caller action: request a fresh challenge and sign it promptly.
 *
 * External response: `401 "Signature verification failed"` — identical to the
 * other three sign-in failures.
 */
export class NonceExpiredError extends AuthError {
  constructor(message: string) {
    super(message);
  }
}

/**
 * Signature recovery threw: the submitted value is not a decodable secp256k1
 * signature at all, so no address could be recovered from it and there is
 * nothing to compare against the claimed one.
 *
 * Note the status is `401`, never `400`, even though "malformed input" would
 * normally argue for `400`. The caller failed to authenticate, and putting a
 * malformed signature in a different status line would move the distinction
 * back into the response that the message body is careful not to make.
 *
 * Caller action: this is a client bug — check how the signature is being
 * encoded before retrying; the same bytes will fail identically.
 *
 * External response: `401 "Signature verification failed"` — identical to the
 * other three sign-in failures.
 */
export class SignatureMalformedError extends AuthError {
  constructor(message: string) {
    super(message);
  }
}

/**
 * Recovery succeeded and produced a valid address — just not the one the
 * request claimed. The signature is real; it was made by a different key.
 *
 * Both addresses are carried because during the demo the likeliest cause by
 * far is a wallet connected to a different account than the one on screen,
 * and having `expected` and `recovered` side by side in the log turns a
 * five-minute confusion into a five-second one. Logging them is safe:
 * addresses are public by construction, so this leaks nothing the chain does
 * not already publish. They stay in the log and never reach the response —
 * echoing `recovered` back would tell a prober which key actually signed.
 *
 * Caller action: connect the wallet that owns `expected`, request a fresh
 * challenge, and sign again.
 *
 * External response: `401 "Signature verification failed"` — identical to the
 * other three sign-in failures.
 */
export class SignerMismatchError extends AuthError {
  constructor(
    message: string,
    public readonly expected: Address,
    public readonly recovered: Address,
  ) {
    super(message);
  }
}

/**
 * The request carried no `Authorization` header, or carried one that is not a
 * `Bearer` scheme. Nothing was verified because there was nothing to verify.
 *
 * Separate from `InvalidTokenError` in the log because it points somewhere
 * completely different: a missing header is almost always a client that never
 * attached the token (an unauthenticated fetch, a proxy stripping headers),
 * not a token problem.
 *
 * Caller action: sign in and send the resulting token as
 * `Authorization: Bearer <token>`.
 *
 * External response: `401 "Authentication required"`.
 */
export class MissingCredentialError extends AuthError {
  constructor(message: string) {
    super(message);
  }
}

/**
 * A bearer token was present but did not survive verification: the signature
 * check failed, or it passed and the payload is not a well-formed `{ sub }`.
 *
 * These two are folded together because the remedy is the same and neither is
 * recoverable by the holder — a token signed with the wrong secret and a
 * token missing its subject are both simply not usable credentials.
 *
 * Caller action: discard the token and sign in again. Do not retry with it.
 *
 * External response: `401 "Authentication required"`.
 */
export class InvalidTokenError extends AuthError {
  constructor(message: string) {
    super(message);
  }
}

/**
 * The token is correctly signed and well-formed, but is past its `exp`.
 *
 * This is the one guard failure with its own external message, and that is
 * intentional: telling "expired" apart from "invalid" describes a token the
 * caller already holds, so it reveals nothing they did not supply, and it is
 * the difference between a UI that quietly prompts a re-sign and one that
 * shows "something went wrong". There is no refresh and no revocation in this
 * system, so expiry is the only way a session ends.
 *
 * Caller action: run the sign-in flow again to obtain a new token.
 *
 * External response: `401 "Session expired"`.
 */
export class SessionExpiredError extends AuthError {
  constructor(message: string) {
    super(message);
  }
}

/**
 * The token verified cleanly, but its `sub` names an account that does not
 * exist — deleted, or from a database that has since been reset (routine in a
 * demo environment where the schema is dropped between runs).
 *
 * `accountId` is carried so the log records exactly which subject went
 * missing, which is the only way to tell "stale token from a wiped database"
 * from a genuine data problem.
 *
 * This shares the generic `"Authentication required"` message rather than
 * getting one of its own, deliberately. "The account this token names has
 * been deleted" is a fact about the platform's state, not about the caller's
 * token, and of the four guard failures it is the one whose specific cause
 * could be useful to someone probing. The log records it distinctly; the
 * response does not.
 *
 * Caller action: sign in again; the old session cannot be salvaged.
 *
 * External response: `401 "Authentication required"`.
 */
export class UnknownAccountError extends AuthError {
  constructor(
    message: string,
    public readonly accountId: string,
  ) {
    super(message);
  }
}
