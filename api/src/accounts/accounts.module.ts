import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Account } from '../entities/account.entity';
import { AccountRepository } from './account.repository';

/**
 * The account. Currently one write and two reads; API-05 (accounts · ledger ·
 * funding) builds `/me`, the balance view, and the statement on top of them,
 * which is why `AccountRepository` is exported rather than kept private.
 *
 * A whole module for one class looks like ceremony, and it is the same call
 * `LedgerModule` made in API-02 for the same reason: `docs/CONTEXT.md` §3
 * assigns the account to `accounts`, not to `auth`. Putting the repository
 * inside `auth/` would mean API-05 either imports from `auth` to read an
 * account — an import edge that says something untrue about which module owns
 * what — or moves the file later and rewrites every import.
 */
@Module({
  imports: [TypeOrmModule.forFeature([Account])],
  providers: [AccountRepository],
  exports: [AccountRepository],
})
export class AccountsModule {}
