/**
 * Abstract root of every error the ledger can throw.
 *
 * One class at the root, for the same reason `auth/errors.ts` and
 * `chain/errors.ts` each have one: a caller that only needs to know "something
 * in the ledger refused" writes a single
 * `catch (e) { if (e instanceof LedgerError) }` instead of enumerating class
 * names it will forget to extend when the next one is added. Anything finer —
 * *which* refusal, and therefore what to say to the caller — means checking the
 * concrete subclass, which is why the per-class fields below exist rather than
 * being flattened into a message string somebody would have to parse back out.
 *
 * ⚠️ These are plain `Error`s and NOT `HttpException` subclasses, and that is
 * the same deliberate split `auth/errors.ts` documents at length. The
 * repository's job is to state what happened; deciding that "not enough
 * balance" is a `409` rather than a `400` or a `402` is a policy question with
 * exactly one right answer per API surface, and it belongs in the controller
 * where the whole mapping can be read at once. Throwing an
 * `HttpException` from a repository scatters that decision across throw sites,
 * and — worse here — silently commits every future non-HTTP caller (a cron
 * reaper, a reconciliation script) to a status code that means nothing to it.
 */
export abstract class LedgerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/**
 * A debit was refused because the account's ledger does not sum to enough to
 * cover it. **Nothing was written** — this is thrown from inside
 * `debitWithBalanceCheck`'s transaction, before the insert and while the
 * `accounts` row lock is still held, so the transaction rolls back and the
 * ledger is exactly as it was (R8).
 *
 * **Why both figures ride along.** The refusal the person sees is
 * `"Available balance is $100.00, cannot cash out $123.45"` (contracts §5), and
 * both halves of that sentence are known at the moment of the throw — the sum
 * was just computed under the lock. Carrying them means the controller formats
 * the message with `formatCents` and nothing else. The alternative, re-querying
 * the balance in the catch block, is worse in three separate ways: it is a
 * second round trip for a number already in hand; it reads *outside* the
 * transaction, so a concurrent top-up can make the reported figure differ from
 * the one the refusal was actually based on; and it turns a message into a
 * database dependency, so a message-only change touches a query.
 *
 * Both fields are **positive** cents. `requestedMinor` is the amount asked for,
 * not the negative row that would have been written — the caller's language,
 * not the ledger's. `availableMinor` is the signed sum as
 * `BalanceRepository` reports it, so it *can* be negative if hand-written
 * `adjustment` rows put it there; `formatCents` renders that as `-$12.34`
 * rather than hiding it.
 *
 * External response: `409`, not `400`. The payload was well-formed — the amount
 * passed `amountMinorSchema` — and it is the *state* that conflicts, which is
 * the distinction contracts §8 makes load-bearing for the UI: a `409` is worth
 * retrying after the balance changes, a `400` never is.
 */
export class InsufficientBalanceError extends LedgerError {
  constructor(
    message: string,
    public readonly availableMinor: number,
    public readonly requestedMinor: number,
  ) {
    super(message);
  }
}
