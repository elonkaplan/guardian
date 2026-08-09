import { apiGet } from './client';
import type { AccountSummary } from './types';
import type { Cents } from '../lib/money';

/**
 * `GET /me` — the account and its money figures.
 *
 * One coercion, on one field, and it is a deliberate exception to the rule
 * `./orders.ts` states at length: the API layer has no shape tolerance.
 *
 * That rule is right for envelopes and field names generally, and the test it
 * applies is the one that matters — *what does the mistake look like on
 * screen?* For `settledFundsMinor` the answer is bad enough to earn the
 * exception. The field is documented as nullable because the backend reads it
 * from the chain and returns `null` rather than failing the whole request when
 * that read throws (api-design §3.2.1). But there is a second way it can arrive
 * as nothing: renamed upstream, or misspelled here. That case lands as
 * `undefined`, and `undefined` behaves *almost* correctly by accident —
 * `formatUsd` guards on `Number.isFinite` and renders `—` — while silently
 * failing `settled > 0`, which disables Withdraw with the **zero** wording
 * rather than the **unknown** wording. A seller is then told they have earned
 * nothing when the truth is that nobody looked.
 *
 * So the boundary reduces every unreadable value to a single `null`, and the
 * screen has exactly two cases to distinguish instead of three-and-a-half.
 * `formatUsd`'s guard stays a backstop rather than the mechanism.
 *
 * **The rule this enforces, once, here**: nothing downstream may write
 * `settledFundsMinor ?? 0`, compare it without a null check, or pass it to
 * arithmetic. `null` is an absence of knowledge, and it propagates as `—`.
 *
 * The other two figures are read strictly. They come from Postgres in the same
 * transaction as the account, they cannot fail independently, and a wrong field
 * name there renders as a blank beside two figures that are visibly fine —
 * loud, local, and fixed in a minute.
 */

/** The wire shape, before the one field is normalised. */
interface AccountSummaryPayload {
  address: string;
  availableBalanceMinor: Cents;
  inEscrowMinor: Cents;
  settledFundsMinor?: unknown;
}

/**
 * A finite number stays; everything else — `null`, `undefined`, a string,
 * `NaN`, `Infinity` — becomes `null`.
 *
 * `0` passes through as `0`, which is the whole point of writing this as a
 * type check rather than a truthiness check.
 */
function readSettledFunds(value: unknown): Cents | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export async function fetchMe(): Promise<AccountSummary> {
  const payload = await apiGet<AccountSummaryPayload>('/me');
  return {
    address: payload.address,
    availableBalanceMinor: payload.availableBalanceMinor,
    inEscrowMinor: payload.inEscrowMinor,
    settledFundsMinor: readSettledFunds(payload.settledFundsMinor),
  };
}
