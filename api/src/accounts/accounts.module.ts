import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ChainModule } from '../chain/chain.module';
import { Account } from '../entities/account.entity';
import { LedgerModule } from '../ledger/ledger.module';
import { OrdersModule } from '../orders/orders.module';
import { AccountRepository } from './account.repository';
import { AccountsController } from './accounts.controller';
import { AccountsService } from './accounts.service';

/**
 * The account, and the money model on top of it. API-02 built the repository
 * and noted that API-05 would build `/me`, the balance view and the statement
 * on these methods; it now does — `AccountsController` serves `GET /me` and
 * `GET /me/ledger`, and `AccountsService` assembles the three figures behind
 * them.
 *
 * `AccountRepository` stays exported. `auth` depends on it to resolve an
 * address to an account on sign-in and to load the account behind a token's
 * `sub` on every guarded request; un-exporting it breaks authentication for the
 * whole product, which is not obvious from this file.
 *
 * `AccountsService` is exported for `FundingModule`, and for one method:
 * `/topup` and `/offramp` answer with the updated summary
 * (`contracts/internal-api.md` §3, §5) and must return the *same* object
 * `GET /me` does. Re-assembling those three figures in `funding/` would be a
 * second implementation of the money model in a second module, and the symptom
 * of the two drifting apart is a balance that changes when the page refreshes.
 * Exporting the service is what makes "the body of a mutation equals the body
 * of `GET /me`" true by construction rather than by two people remembering.
 *
 * The three imports are the three sources the summary reads, one per place
 * money can be — and each stays in the module that owns it (`docs/CONTEXT.md`
 * §3) rather than being reached for directly here:
 *
 * - `LedgerModule` → `BalanceRepository` (available balance) and
 *   `LedgerRepository` (the statement)
 * - `OrdersModule` → `EscrowExposureRepository` (escrow exposure). Registering
 *   `TypeOrmModule.forFeature([Order])` here instead would work today and would
 *   claim this module owns the order table; API-06 would then move the query
 *   and rewrite every import (research R11).
 * - `ChainModule` → `EscrowReadService` (settled funds). It exports services
 *   and never its viem clients, so the only chain access this module has is the
 *   one typed read it needs.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([Account]),
    LedgerModule,
    OrdersModule,
    ChainModule,
  ],
  controllers: [AccountsController],
  providers: [AccountRepository, AccountsService],
  exports: [AccountRepository, AccountsService],
})
export class AccountsModule {}
