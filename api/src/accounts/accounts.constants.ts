/**
 * How long `GET /me` will wait for the chain before giving up on the settled
 * figure and reporting `null`.
 *
 * The arithmetic behind the number, because it is not a round guess:
 *
 * **Why a budget on our side at all.** viem's `http` transport defaults to
 * `timeout: 10_000` **and** `retryCount: 3` with exponential backoff (verified
 * in `node_modules/viem`). Against a black-holed RPC host — one that accepts
 * the connection and never answers, which is what flaky conference wifi
 * actually produces — that is up to four attempts of ten seconds each before
 * the promise settles either way. `GET /me` is polled every 5 s by the balance
 * widget on *every* page, so a transport-level stall would stack requests
 * faster than they drain and freeze the balance widget product-wide. The budget
 * therefore lives on our side of the call, where a retry policy set three files
 * away in `chain/` cannot lengthen it.
 *
 * **Why 2000 ms.** Monad blocks are ~300 ms and a healthy `eth_call` round trip
 * is tens of milliseconds, so 2 s is roughly 50× the happy path — it fires on a
 * genuinely broken read, not a slow one, and a user on a bad connection still
 * gets their real number rather than a dash. It is also under half the 5 s poll
 * interval, so a timing-out read never overlaps its own next request.
 *
 * ⚠️ Raising this past ~2500 ms breaks the second property: polls begin to
 * overlap, and the abandoned-socket note in `AccountsService`'s timeout helper
 * stops being bounded by "they all expire within 10 s".
 *
 * (research R1)
 */
export const SETTLED_FUNDS_TIMEOUT_MS = 2_000;
