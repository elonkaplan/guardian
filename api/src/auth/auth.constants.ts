/**
 * The two lifetimes in this feature, plus the sweep that keeps the challenge
 * store bounded.
 *
 * These are constants rather than environment keys on purpose. They are not
 * secrets and they are not per-deployment, and `env.schema.ts` requires every
 * key it declares precisely so nothing downstream has to null-check — adding
 * optional tuning keys erodes that. `JWT_SECRET` is in the environment because
 * it is a secret; these are not.
 *
 * ⚠️ `quickstart.md` Step 13 temporarily shortens NONCE_TTL_MS and JWT_TTL to
 * a few seconds to verify both expiry paths, and MUST restore them afterwards.
 * A 3-second token lifetime left in by accident is discovered on stage.
 */

/**
 * How long an unused sign-in challenge stays valid.
 *
 * Long enough to open a wallet and read the message without hurrying, short
 * enough that a challenge captured in transit and never used is worthless in
 * practice. Single-use consumption is the real replay defence (see
 * `nonce.store.ts`); this is the backstop for challenges nobody ever spends.
 */
export const NONCE_TTL_MS = 5 * 60_000;

/**
 * Session token lifetime, in the string form `@nestjs/jwt` expects.
 *
 * There is no refresh, no sign-out, and no revocation list, so a token is
 * valid until it lapses and nothing can shorten that. Acceptable for a
 * disposable demo environment where every token names an account that controls
 * only its own funds; the first thing to change for real users.
 */
export const JWT_TTL = '7d';

/**
 * How often expired challenges are swept out of the in-memory store.
 *
 * This is for bounding memory, not for correctness — `consume()` already
 * refuses anything past its expiry on read. The sweep exists because an
 * unbounded map with no eviction is trivially correct to write now and awkward
 * to retrofit later.
 */
export const NONCE_SWEEP_INTERVAL_MS = 60_000;
