import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, type EntityManager, Repository } from 'typeorm';

import { Account } from '../entities/account.entity';
import { LedgerKind } from '../entities/enums';
import { LedgerEntry } from '../entities/ledger-entry.entity';
import { InsufficientBalanceError } from './ledger.errors';

/**
 * The input to `appendEntry`, spelled out rather than inferred.
 *
 * `orderId` and `externalRef` are optional here and nullable in the column, and
 * the difference is deliberate: omitting them means "this kind of entry has no
 * such link", which is the normal case for both funding kinds (data-model §2).
 * `createdAt` is absent on purpose — the database default (`now()`) is the only
 * clock the ledger trusts, so no caller can backdate a row.
 */
export interface AppendEntryInput {
  accountId: string;
  /** SIGNED whole USD cents — credits positive, debits negative. */
  amountMinor: number;
  kind: LedgerKind;
  orderId?: string | null;
  externalRef?: string | null;
}

/**
 * Writes to the append-only ledger.
 *
 * **This class has no update path and no delete path, and that is the design
 * rather than an unfinished sketch.** `ledger_entries` is append-only
 * (invariant #4 in `docs/CONTEXT.md`); a balance is `SUM(amount_minor)` and
 * nothing else, so a row that changes after the fact silently rewrites history
 * that a person has already been shown. Corrections are new rows of kind
 * `adjustment` — including the cash-out compensation, which leaves the failed
 * debit standing and adds a reversing credit beside it precisely so the
 * statement shows what was attempted (data-model §2). If a future task seems to
 * need an `UPDATE` here, the thing it actually needs is another row.
 *
 * Reads split across two classes on purpose: `BalanceRepository` owns the
 * balance sum, this class owns the writes and the statement. The one read that
 * lives here — the sum inside `debitWithBalanceCheck` — is not a duplicate of
 * `getAvailableBalanceMinor` looking for a home, it is a different query with a
 * different guarantee: it runs inside the locked transaction that is about to
 * write, which is the entire point (R8).
 */
@Injectable()
export class LedgerRepository {
  constructor(
    @InjectRepository(LedgerEntry)
    private readonly entries: Repository<LedgerEntry>,
    /**
     * Needed only by `debitWithBalanceCheck`, which must open a transaction of
     * its own rather than borrow one. `Repository` cannot start a transaction;
     * `DataSource` can, and Nest provides it as soon as `TypeOrmModule.forRoot`
     * has run.
     */
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Append one entry. Insert only.
   *
   * **`manager` is what makes this composable with someone else's
   * transaction.** Passed a manager, the insert enlists in that transaction and
   * shares its fate; omitted, it runs on the default connection and commits on
   * its own. Both callers that need the first form need it for a reason that
   * cannot be worked around by ordering statements: `debitWithBalanceCheck`
   * must write inside the same transaction that holds the account row lock, or
   * the lock protects nothing, and the funding service's top-up needs the
   * credit to be visible atomically with whatever else it writes.
   *
   * ⚠️ `amountMinor` is SIGNED and this method does not check its sign against
   * `kind`. That looks like a missing guard and is not one — `adjustment` is
   * legitimately either direction (data-model §2), so any rule general enough
   * to cover all four kinds would have to special-case it, and a guard with a
   * hole in exactly the kind used for hand corrections is worse than none. The
   * sign is the caller's assertion about what happened; `debitWithBalanceCheck`
   * is the one path where getting it wrong is expensive, and it negates the
   * amount itself rather than trusting anyone.
   */
  async appendEntry(
    input: AppendEntryInput,
    manager?: EntityManager,
  ): Promise<LedgerEntry> {
    const repo = manager ? manager.getRepository(LedgerEntry) : this.entries;

    // `save` on a fresh entity is an INSERT with RETURNING, so the generated
    // `id` and the database-assigned `created_at` come back on the object
    // without a second round trip. Nothing here reads before writing, so there
    // is no upsert semantics to trip over: the entity has no id yet.
    return repo.save(
      repo.create({
        accountId: input.accountId,
        amountMinor: input.amountMinor,
        kind: input.kind,
        orderId: input.orderId ?? null,
        externalRef: input.externalRef ?? null,
      }),
    );
  }

  /**
   * Every entry for an account, newest first. The statement, whole — no
   * pagination and no filtering, which `docs/CONTEXT.md` §6 puts out of scope
   * and which demo scale (tens of rows per account) makes free (R12).
   *
   * ⚠️ **The `id DESC` tiebreak is load-bearing, not defensive styling.**
   * `created_at` is a `timestamptz` filled by `now()`, and `now()` in Postgres
   * is the *transaction* start time — so every row written inside one
   * transaction carries a byte-identical timestamp. Two hand-made `adjustment`
   * rows, or a debit and its compensating credit, collide exactly this way.
   * `ORDER BY created_at DESC` alone leaves their relative order unspecified,
   * which means Postgres may return them in either order on either call, and
   * the UI refetches this list after every mutation
   * (`ui/specs/006-wallet-page/data-model.md` §4). The visible symptom is a
   * statement that reshuffles between polls with no data having changed —
   * which reads to a viewer as the ledger being unreliable, at the exact moment
   * they are being asked to trust it.
   *
   * The existing `ledger_account_idx ON (account_id, created_at)` covers the
   * predicate and the leading sort key; the `id` tiebreak sorts within the
   * handful of rows that share a timestamp.
   *
   * Returns `[]` for an account with no entries — same contract as
   * `BalanceRepository.getAvailableBalanceMinor` returning `0`: "this account
   * has nothing" and "this account does not exist" are different facts, and
   * only the first is answered here.
   */
  async listByAccount(accountId: string): Promise<LedgerEntry[]> {
    return this.entries
      .createQueryBuilder('e')
      .where('e.account_id = :accountId', { accountId })
      .orderBy('e.created_at', 'DESC')
      .addOrderBy('e.id', 'DESC')
      .getMany();
  }

  /**
   * Debit an account by `amountMinor`, refusing if the ledger does not sum to
   * enough to cover it. Returns the entry that was written.
   *
   * `amountMinor` is a **positive** number — the amount being taken out, in the
   * caller's language. The row written is its negation, of kind `offramp`. The
   * negation happens here rather than at the call site so there is exactly one
   * place where a sign error is possible, and it is the same place that just
   * finished comparing the magnitude against the balance.
   *
   * ---
   *
   * ## ⚠️ Why this is one transaction with a row lock (R8)
   *
   * FR-026 requires that concurrent cash-outs cannot draw an account below
   * zero. Check-then-insert without serialisation is the textbook race, and
   * with money it is not subtle: two requests for $100 against a $100 balance
   * both read `10000`, both pass the check, both insert `-10000`, and the
   * account sums to **−$100 with $200 of tokens gone from the pool**. That
   * breaks `pool >= Σ ledger`, the solvency relationship every other guarantee
   * in this system rests on, and it breaks it in the direction that cannot be
   * fixed by writing a row — the tokens are already on chain in someone else's
   * wallet.
   *
   * Postgres cannot enforce this declaratively. A `CHECK` constraint needs a
   * column to constrain, and there is deliberately **no cached balance column**
   * anywhere in the schema (invariant #4; `database-schema.md` §3.1 records
   * `cached_balance_minor` being dropped as "a whole class of drift bug for
   * nothing"). The constraint here is over an *aggregate* of rows, which is not
   * something a table constraint can express.
   *
   * **So the lock goes on the `accounts` row, not on the ledger rows.** This is
   * the part that is easy to get backwards. The rows being counted are the ones
   * that do not exist yet — the competing debit is an `INSERT`, and `SELECT …
   * FOR UPDATE` over `ledger_entries` locks only what is already there, so two
   * concurrent transactions would each lock the same existing history, find no
   * conflict, and both insert. There is nothing in `ledger_entries` for a lock
   * to cover. The `accounts` row is the natural serialisation point instead: it
   * is one row, it certainly exists (the auth guard loaded it to authorise the
   * request), and every writer to this account must pass through it.
   *
   * Contention is therefore **per account**. Two different users cashing out
   * simultaneously never touch the same row and never block each other; the
   * same user firing two requests is exactly the case that must serialise.
   *
   * **Alternatives, and why not**: `SERIALIZABLE` isolation is correct but
   * converts the race into a retryable serialisation failure the caller has to
   * handle, and applies to the whole transaction rather than the one aggregate
   * that needs it. An advisory lock is equivalent but keyed by a hashed uuid,
   * so the relationship between the lock and the row it protects is invisible
   * to the next reader. An in-process mutex is the wrong layer entirely — it
   * does not survive a second instance, while reading as though it were
   * sufficient.
   *
   * @throws {InsufficientBalanceError} if the balance is below `amountMinor`.
   * **Nothing is written** in that case: the throw happens before the insert
   * and inside the transaction, so the rollback is total and the lock is
   * released. The error carries both figures so the controller can format the
   * refusal without re-reading (see `ledger.errors.ts`).
   */
  async debitWithBalanceCheck(
    accountId: string,
    amountMinor: number,
    externalRef?: string | null,
  ): Promise<LedgerEntry> {
    return this.dataSource.transaction(async (manager) =>
      this.debitLocked(manager, {
        accountId,
        amountMinor,
        kind: LedgerKind.Offramp,
        orderId: null,
        externalRef: externalRef ?? null,
      }),
    );
  }

  /**
   * The same guarantee as `debitWithBalanceCheck`, enlisted in a transaction the
   * caller already owns.
   *
   * ## Why this exists as a second entry point rather than a parameter
   *
   * The purchase saga has to write **two** rows that must stand or fall
   * together: the `orders` row and the `purchase` debit that pays for it. Any
   * gap between them is a window in which the same balance is spent twice
   * (`specs/007-orders-purchase-saga` FR-007), so both inserts and the
   * affordability check that guards them have to sit inside one transaction —
   * the caller's, because the order insert is the caller's.
   *
   * `debitWithBalanceCheck` cannot serve that: it opens a transaction of its
   * own, so its lock would be released at its own commit, before the order row
   * was written. Two public methods over one private core is the honest shape —
   * one for callers that have no transaction, one for callers that do.
   *
   * ⚠️ **The caller must insert the order row BEFORE calling this.**
   * `ledger_entries.order_id` carries `REFERENCES orders(id)`, so a debit
   * written first fails the foreign key. The natural reading of "take the money,
   * then record what it bought" does not compile, and this is the only place
   * that says so.
   *
   * ⚠️ `amountMinor` is **positive** — the amount being taken out, in the
   * caller's language — and the row written is its negation, exactly as
   * `debitWithBalanceCheck` does. The negation happens in `debitLocked` so there
   * is one place a sign error is possible, and it is the place that just
   * finished comparing the magnitude against the balance.
   *
   * `kind` is the caller's, because this method serves more than one flow:
   * `purchase` for the saga, `offramp` for a cash-out. It is **not** a general
   * back door — `appendEntry` is the unchecked insert, and anything that needs
   * to write without a balance check should use that and say why.
   *
   * @throws {InsufficientBalanceError} — thrown inside the caller's transaction,
   * so their rollback is total and their lock is released with it.
   */
  async debitWithinTransaction(
    manager: EntityManager,
    input: {
      accountId: string;
      /** POSITIVE whole USD cents — the amount to take out. Negated on write. */
      amountMinor: number;
      kind: LedgerKind;
      orderId?: string | null;
      externalRef?: string | null;
    },
  ): Promise<LedgerEntry> {
    return this.debitLocked(manager, {
      accountId: input.accountId,
      amountMinor: input.amountMinor,
      kind: input.kind,
      orderId: input.orderId ?? null,
      externalRef: input.externalRef ?? null,
    });
  }

  /**
   * Lock, sum, refuse, insert — the four steps, inside whatever transaction the
   * `manager` belongs to.
   *
   * ⚠️ **This method is meaningless outside a transaction.** Given a manager
   * from the default connection the `FOR UPDATE` acquires and releases
   * immediately, the sum is read outside any serialisation, and the insert
   * commits on its own — the race is back, with the lock statement still in the
   * code looking as though it prevented it. Both public callers above open or
   * receive a real transaction; nothing else may call this.
   */
  private async debitLocked(
    manager: EntityManager,
    input: {
      accountId: string;
      amountMinor: number;
      kind: LedgerKind;
      orderId: string | null;
      externalRef: string | null;
    },
  ): Promise<LedgerEntry> {
    const { accountId, amountMinor } = input;

    {
      // ─── 1. Serialise on the account row ────────────────────────────────
      // `SELECT id FROM accounts WHERE id = $1 FOR UPDATE`. The selected
      // column is irrelevant and the result is discarded — the lock is the
      // whole product of this statement, and it is held until this transaction
      // commits or rolls back.
      //
      // If the row is somehow absent this locks nothing, which is safe by
      // construction rather than by luck: an account with no row has no ledger
      // entries either, so the sum below is 0, and `amountMinor` is a positive
      // integer (`amountMinorSchema`), so the refusal fires before any write.
      await manager
        .createQueryBuilder()
        .select('a.id')
        .from(Account, 'a')
        .where('a.id = :accountId', { accountId })
        .setLock('pessimistic_write')
        .getRawOne<{ a_id: string }>();

      // ─── 2. Sum the ledger, inside the same transaction ─────────────────
      // ⚠️ Deliberately NOT `BalanceRepository.getAvailableBalanceMinor`. That
      // method runs on the default connection, i.e. outside this transaction
      // and outside the lock, so its answer would be a snapshot taken from
      // somewhere the serialisation does not reach — precisely the read this
      // whole method exists to make safe. The duplicated SQL is the price of
      // the guarantee.
      const row = await manager
        .createQueryBuilder(LedgerEntry, 'e')
        .select('COALESCE(SUM(e.amount_minor), 0)', 'total')
        .where('e.account_id = :accountId', { accountId })
        .getRawOne<{ total: string }>();

      // SUM(bigint) is `numeric`, which the pg driver hands over as a string —
      // converted once here at the boundary, exactly as `balance.repository.ts`
      // does. Skipping this makes `<` a lexicographic comparison, under which
      // "9" is greater than "10000".
      const availableMinor = Number(row?.total ?? 0);

      // ─── 3. Refuse, before anything is written ──────────────────────────
      if (availableMinor < amountMinor) {
        throw new InsufficientBalanceError(
          `Available balance is ${availableMinor} cents, ` +
            `cannot debit ${amountMinor} cents`,
          availableMinor,
          amountMinor,
        );
      }

      // ─── 4. Write the debit, in the same transaction ────────────────────
      // Passing `manager` is not an optimisation. An insert on the default
      // connection here would commit independently of the lock, so the lock
      // would be released without ever having covered the write it exists to
      // protect — the race would be back, just harder to see.
      return this.appendEntry(
        {
          accountId,
          amountMinor: -amountMinor,
          kind: input.kind,
          orderId: input.orderId,
          externalRef: input.externalRef,
        },
        manager,
      );
    }
  }
}
