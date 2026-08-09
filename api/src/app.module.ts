import { Module } from '@nestjs/common';

import { AppConfigModule } from './config/config.module';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './health/health.module';
import { LedgerModule } from './ledger/ledger.module';

@Module({
  imports: [AppConfigModule, DatabaseModule, HealthModule, LedgerModule],
})
export class AppModule {}
