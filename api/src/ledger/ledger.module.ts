import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { LedgerEntry } from '../entities/ledger-entry.entity';
import { BalanceRepository } from './balance.repository';

/**
 * The ledger. Currently one read; API-05 (accounts · ledger · funding) builds
 * the writes on top of it, which is why `BalanceRepository` is exported rather
 * than kept private.
 */
@Module({
  imports: [TypeOrmModule.forFeature([LedgerEntry])],
  providers: [BalanceRepository],
  exports: [BalanceRepository],
})
export class LedgerModule {}
