import { apiGet, apiPost } from './client';
import type { LedgerEntry, WithdrawResponse } from './types';
import type { Cents } from '../lib/money';

/**
 * The statement, and the three ways money moves for a signed-in account.
 *
 * ---
 *
 * **None of these three POSTs is idempotent, and none of them may be retried
 * automatically.** Not through react-query's `retry` (already `false` app-wide,
 * and it must stay that way for these), not through a helpful "try again"
 * button on a timeout, not through a resubmit on a back navigation. Each one
 * commits a movement of real money — a ledger credit, a ledger debit, or an
 * on-chain transfer — and answers only afterwards, so a client timeout tells us
 * nothing about whether it happened. A refusal is the opposite case: a 4xx
 * means the backend understood us and definitively did nothing, which is safe
 * to correct and submit again.
 *
 * ---
 *
 * **What silence means here, and why it is not what it means in `./orders.ts`.**
 *
 * That file's rule for `POST /orders` is to offer no retry and send the buyer
 * away to look at their orders, because a purchase debits a ledger with no
 * screen watching the outcome. It also warns, in writing, against copying that
 * rule onto neighbouring POSTs without re-deriving it. Re-deriving it:
 *
 * The wallet screen **is** the thing that watches. It re-reads the account
 * figures and the statement every five seconds for as long as it is open, so a
 * call that got no answer is resolved by the next poll rather than by a button.
 * The honest copy is therefore wait-and-see — "we did not hear back; do not
 * submit again; this page will show it if it landed" — which is the same shape
 * `OrderActions` uses for accept and complain.
 *
 * But the three actions do **not** share a resolving signal, and that is the
 * part that would be wrong if it were copied carelessly:
 *
 * - `topUp` and `cashOut` write ledger entries, so the **statement** is what
 *   confirms them.
 * - `withdraw` writes **no ledger entry, ever**. Settlement and withdrawal are
 *   on-chain facts under the user's own address (database-schema §3.3), so
 *   telling someone to watch their statement for a withdrawal is advice that
 *   can never come true. Its signal is the **settled-funds figure falling**,
 *   which is on the same screen and refreshes on the same cadence.
 *
 * If API-07 ever accepts a client-supplied idempotency key, this comment and
 * the ambiguous branches in `WalletActions` can both be deleted.
 */

/** Shape a list response might plausibly take. See `unwrapEntries`. */
type ListEnvelope = Record<string, unknown>;

/**
 * Accept either a bare array or a single-key envelope around one.
 *
 * The second use of this pattern in the app, and it earns it on exactly the
 * grounds `fetchAgents` sets out in `./agents.ts`: the asymmetry of the
 * failure. An envelope misread as an array yields `[]`, which this screen
 * faithfully renders as "no activity yet" — a plausible, silent, wrong success,
 * on the one screen whose entire job is to account for where the money went.
 * A wrong *field* name inside an entry renders as a blank cell, which is loud
 * and gets fixed.
 *
 * Still not generalised into `client.ts`, for the reason given there: it should
 * not be reachable by accident from a future endpoint.
 */
function unwrapEntries(payload: unknown): LedgerEntry[] {
  if (Array.isArray(payload)) {
    return payload as LedgerEntry[];
  }

  if (payload !== null && typeof payload === 'object') {
    const envelope = payload as ListEnvelope;
    for (const key of ['entries', 'items', 'data'] as const) {
      const inner = envelope[key];
      if (Array.isArray(inner)) {
        return inner as LedgerEntry[];
      }
    }
  }

  // Neither shape. Empty rather than a throw: the statement's own empty state
  // is a better outcome than a blank screen, and the network tab still holds
  // the truth for whoever is debugging it.
  return [];
}

/** `GET /me/ledger` — every movement of the available balance, newest first. */
export async function fetchLedger(): Promise<LedgerEntry[]> {
  const payload = await apiGet<unknown>('/me/ledger');
  return unwrapEntries(payload);
}

/**
 * `POST /topup` — the demo treasury credits the platform balance.
 *
 * Credited and committed before it answers, so there is no pending state and
 * nothing to poll for (api-design §4). See the non-idempotency note above.
 */
export function topUp(amountMinor: Cents): Promise<unknown> {
  return apiPost<unknown>('/topup', { amountMinor });
}

/**
 * `POST /offramp` — unspent platform balance returns to the treasury it came
 * from.
 *
 * This is the exit that stops the demo having a one-way door: without it a user
 * who tops up $100 and spends $2 can only ever spend the remaining $98, because
 * `withdraw` pulls *settled* funds from the contract and never touches the
 * ledger (rain-integration §0.3).
 */
export function cashOut(amountMinor: Cents): Promise<unknown> {
  return apiPost<unknown>('/offramp', { amountMinor });
}

/**
 * `POST /withdraw` — settled funds leave the contract for the user's own
 * address.
 *
 * No argument, because there is nothing to choose: `withdrawFor(wallet)` moves
 * the whole balance to the address it belongs to. The operator sends the
 * transaction, so the browser signs nothing — this is a request that money the
 * user already owns be forwarded, not an authorisation to move it.
 */
export function withdraw(): Promise<WithdrawResponse> {
  return apiPost<WithdrawResponse>('/withdraw');
}
