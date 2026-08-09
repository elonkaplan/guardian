import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ChainModule } from '../chain/chain.module';
import { Complaint } from '../entities/complaint.entity';
import { Order } from '../entities/order.entity';
import { LedgerModule } from '../ledger/ledger.module';
import { CaseFileService } from './case-file.service';
import { EscrowExposureRepository } from './escrow-exposure.repository';
import { OrderRepository } from './order.repository';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { PurchaseService } from './purchase.service';
import { SalesController } from './sales.controller';
import { SettlementService } from './settlement.service';

/**
 * Orders: the purchase saga, the two settling actions, the case file, and the
 * two lists.
 *
 * API-05 created this module with a single query and a note that the saga would
 * extend it **in place** rather than relocate it. This is that extension.
 *
 * ## What is exported, and why only one thing
 *
 * `EscrowExposureRepository` is exported because `AccountsModule` reads it for
 * `GET /me`'s `inEscrowMinor`. Everything else is private: the services here own
 * transactions, and a transaction boundary that other modules can reach into is
 * not a boundary. A module that needs an order should ask over HTTP or be given
 * a read method here on purpose.
 *
 * ## ⚠️ `forFeature` registers two entities, and the omissions are deliberate
 *
 * `Order` and `Complaint` are the two tables this module writes. `AgentVersion`,
 * `Agent` and `Run` are **read** here — joined by `OrderRepository` to resolve
 * the pinned listing, the agent's owner and the execution evidence — but they
 * are not listed, for the reason `LedgerModule` gives for omitting `Account`:
 * `forFeature` exists to provide injectable `Repository<T>` tokens, nothing here
 * injects one for those three, and the query builder resolves entity metadata
 * from the root DataSource where `src/data-source.ts` has already registered
 * every entity. Listing them would advertise a wiring path this module does not
 * use, and `catalog/` and `execution/` own those tables (`docs/CONTEXT.md` §3).
 *
 * ## ⚠️ No viem client is imported
 *
 * `ChainModule` gives this module `EscrowOperatorService` and
 * `EscrowReadService` and nothing lower. `chain/` stays the only module that
 * talks to Monad, and the only place a cent is converted to a base unit
 * (invariant #2).
 *
 * `LedgerModule` supplies `LedgerRepository`, whose `debitWithinTransaction`
 * lets the purchase's debit share the transaction that inserts the order — the
 * single indivisible write that makes a double-spend impossible.
 */
@Module({
  imports: [TypeOrmModule.forFeature([Order, Complaint]), ChainModule, LedgerModule],
  controllers: [OrdersController, SalesController],
  providers: [
    EscrowExposureRepository,
    OrderRepository,
    PurchaseService,
    SettlementService,
    OrdersService,
    CaseFileService,
  ],
  exports: [EscrowExposureRepository],
})
export class OrdersModule {}
