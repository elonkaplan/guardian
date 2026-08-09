import { Module } from '@nestjs/common';

import { AccountsModule } from './accounts/accounts.module';
import { AuthModule } from './auth/auth.module';
import { ChainModule } from './chain/chain.module';
import { AppConfigModule } from './config/config.module';
import { DatabaseModule } from './database/database.module';
import { FundingModule } from './funding/funding.module';
import { HealthModule } from './health/health.module';
import { LedgerModule } from './ledger/ledger.module';
import { OrdersModule } from './orders/orders.module';
import { RainModule } from './rain/rain.module';

/**
 * Import order is roughly dependency order, which is documentation rather than
 * a requirement — Nest resolves the graph regardless.
 *
 * `OrdersModule` currently owns exactly one read: the `SUM(price_minor)` over a
 * buyer's unsettled orders that `GET /me` reports as `inEscrowMinor`. A whole
 * module for one query is the ownership boundary from `docs/CONTEXT.md` §3, not
 * ceremony — API-06 extends it in place rather than relocating it, which is the
 * same call `LedgerModule` and `AccountsModule` made in API-02.
 *
 * `RainModule` is registered even though it makes no Rain call and no screen
 * calls it. That is the point: the stub logs the exact payload Rain would have
 * received, which is the deliverable (`docs/rain-integration.md` §0.1). A module
 * left unregistered would be a stub of a stub.
 */
@Module({
  imports: [
    AppConfigModule,
    DatabaseModule,
    HealthModule,
    LedgerModule,
    ChainModule,
    OrdersModule,
    AccountsModule,
    FundingModule,
    RainModule,
    AuthModule,
  ],
})
export class AppModule {}
