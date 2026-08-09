import { Module } from '@nestjs/common';

import { ChainModule } from './chain/chain.module';
import { AppConfigModule } from './config/config.module';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './health/health.module';
import { LedgerModule } from './ledger/ledger.module';

@Module({
  imports: [
    AppConfigModule,
    DatabaseModule,
    HealthModule,
    LedgerModule,
    ChainModule,
  ],
})
export class AppModule {}
