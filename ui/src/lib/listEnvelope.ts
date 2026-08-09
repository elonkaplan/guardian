/**
 * A list endpoint answered with an array, or with an array in a box.
 *
 * Four fetchers in this app read a collection — `GET /agents`,
 * `GET /agents?owner=me`, `GET /me/ledger`, and `GET /sales` — and none of the
 * API design documents commits to whether the response is a bare array or an
 * envelope around one. So each of them accepts either. This module is that
 * tolerance, defined once.
 *
 * **Why the tolerance exists at all**, since `api/orders.ts` argues at length
 * that the API layer has none: the asymmetry of the failure. A wrong *field*
 * name inside a row renders as a blank cell — loud, immediate, and fixed in one
 * file. An envelope misread as an array yields `[]`, which every screen here
 * faithfully reports as "there is nothing yet": a plausible, silent, wrong
 * success. An empty marketplace with no error to point at, or a statement that
 * claims to explain a balance and lists no movements. Only the failure that
 * lies convincingly earns a defensive branch.
 *
 * **Why it lives in `lib/` and not in `client.ts`.** Both of the private copies
 * this replaces carried the same warning, and it survives the move intact: put
 * in `client.ts`, every future endpoint would inherit this branch by accident,
 * including the single-object reads where an unexpected shape *should* fail
 * loudly. A named function that each fetcher imports and calls with its own
 * keys is an opt-in, one line long, at four sites that each still decide for
 * themselves that they want it.
 *
 * **Why `keys` is a parameter rather than one shared union.** A shared list
 * would mean `GET /sales` silently accepting an `agents` envelope, which is
 * tolerance quietly widening into wrongness. Each caller names the key its own
 * endpoint might plausibly use, and no caller can absorb another's mistake.
 *
 * Pure. No React, no fetch, no module-level state, and it never throws.
 */

/** Shape a list response might plausibly take. */
type ListEnvelope = Record<string, unknown>;

export function unwrapList<T>(payload: unknown, keys: readonly string[]): T[] {
  if (Array.isArray(payload)) {
    return payload as T[];
  }

  if (payload !== null && typeof payload === 'object') {
    const envelope = payload as ListEnvelope;
    for (const key of keys) {
      const inner = envelope[key];
      if (Array.isArray(inner)) {
        return inner as T[];
      }
    }
  }

  // Neither shape. Empty rather than a throw: the caller's own empty state is a
  // better outcome than a blank screen, and the network tab still holds the
  // truth for whoever is debugging it.
  return [];
}
