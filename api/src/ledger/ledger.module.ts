import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { LedgerEntry } from '../entities/ledger-entry.entity';
import { BalanceRepository } from './balance.repository';
import { LedgerRepository } from './ledger.repository';

/**
 * The ledger — the append-only record every balance in the platform is derived
 * from. API-02 created this module with a single read and a note that API-05
 * would build the writes on top of it; API-05 has, and they are
 * `LedgerRepository`.
 *
 * Both repositories are exported because both have callers outside this module
 * and neither has any business existing privately: `AccountsModule` reads the
 * balance and the statement for `GET /me` and `GET /me/ledger`, `FundingModule`
 * writes the `onramp` credit, the `offramp` debit and the compensating
 * `adjustment`, and API-06 will add the `purchase` debit through the same
 * `appendEntry`. That last point is why the writes live here rather than in
 * `funding/`: the ledger is not the funding feature's private table, and the
 * append-only invariant (#4 in `docs/CONTEXT.md`) is only enforceable while
 * every writer goes through one class that has no `UPDATE` in it.
 *
 * ⚠️ `forFeature` registers `LedgerEntry` only, and the omission of `Account` is
 * deliberate rather than an oversight. `LedgerRepository.debitWithBalanceCheck`
 * does reference the `Account` *entity class* — it takes a `SELECT … FOR UPDATE`
 * on the accounts row to serialise concurrent cash-outs (R8) — but it does so
 * through the `EntityManager` of a transaction, which resolves entity metadata
 * from the root DataSource, where `src/data-source.ts` has already registered
 * every entity. `forFeature` exists to provide injectable `Repository<T>`
 * tokens, and nothing here injects a `Repository<Account>`; listing it would
 * advertise a wiring path this module does not use, and `accounts/` owns that
 * table (docs/CONTEXT.md §3).
 */
@Module({
  imports: [TypeOrmModule.forFeature([LedgerEntry])],
  providers: [BalanceRepository, LedgerRepository],
  exports: [BalanceRepository, LedgerRepository],
})
export class LedgerModule {}
