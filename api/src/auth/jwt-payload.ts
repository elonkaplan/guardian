/**
 * What is inside a session token, and — more usefully — what is not.
 *
 * The payload is `sub` and nothing else. No wallet address, no role, no
 * permissions, no email.
 *
 * NO ROLE, because the system has none to name. The same account both buys and
 * sells (see `account.entity.ts`, which has no role column either), and every
 * authorisation decision here is a question about owning one specific row —
 * `agents.owner_account_id` for an agent, `orders.buyer_account_id` for an
 * order. That question is answered by a WHERE clause against the resource
 * actually being touched, never by a claim the bearer handed us.
 *
 * NO ADDRESS, because the guard loads the account from Postgres on every
 * protected request regardless: a token naming an account that no longer exists
 * must be refused, and only the database can say whether it exists. Once that
 * read is happening anyway, any additional claim is a second copy of a fact
 * we are about to look up authoritatively — and a second copy is how a token
 * comes to disagree with the database. The disagreement is silent, arrives days
 * after issuance, and is resolved in favour of whichever copy the reader
 * happened to reach for.
 *
 * ⚠️ Resist widening this later "to save a query". The query is the thing that
 * keeps the token honest. A payload that carries the wallet address stops
 * being a name for an account and starts being a stale cache of one, and a
 * seven-day token (`JWT_TTL`) is seven days of staleness with no revocation
 * path to cut it short.
 */

/**
 * The verified contents of a bearer token.
 *
 * `sub` is an `accounts.id` UUID. `iat` and `exp` are seconds-since-epoch,
 * written by `@nestjs/jwt` at sign time rather than by us — they are declared
 * here so callers can read them, not so anyone can set them.
 */
export interface JwtPayload {
  sub: string;
  iat: number;
  exp: number;
}

/**
 * Proves the shape of a decoded token before anything reads `sub` off it.
 *
 * This exists rather than a cast because `jwtService.verifyAsync` is typed to
 * return `any`/`object` — the signature check tells us the token came from us,
 * and says nothing whatsoever about what is in it. A forged-but-correctly-
 * signed token is not the threat; without `JWT_SECRET` nobody can produce one.
 * The realistic case is a token this very server signed under an older payload
 * shape, still inside its seven-day life, arriving after the shape changed. A
 * cast would hand that token straight through and let `sub` be `undefined`
 * somewhere deeper, where it reads as a database miss instead of a bad token.
 *
 * Only `sub` is checked. `iat` and `exp` are the JWT library's own business —
 * `verifyAsync` has already rejected anything expired or malformed in those
 * fields by the time we are called, and re-checking them here would be a
 * second implementation of a rule we do not own.
 */
export function isJwtPayload(value: unknown): value is JwtPayload {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  // Non-empty, not merely present: an empty `sub` is a string that passes a
  // typeof check and then silently matches no account row, turning a broken
  // token into what looks like a deleted one.
  const { sub } = value as { sub?: unknown };
  return typeof sub === 'string' && sub.length > 0;
}
