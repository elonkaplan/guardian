import { Module } from "@nestjs/common";

import { AccountsModule } from "./accounts/accounts.module";
import { AuthModule } from "./auth/auth.module";
import { CatalogModule } from "./catalog/catalog.module";
import { ChainModule } from "./chain/chain.module";
import { AppConfigModule } from "./config/config.module";
import { DatabaseModule } from "./database/database.module";
import { DemoModule } from "./demo/demo.module";
import { ExecutionModule } from "./execution/execution.module";
import { GuardianModule } from "./guardian/guardian.module";
import { FundingModule } from "./funding/funding.module";
import { HealthModule } from "./health/health.module";
import { JobsModule } from "./jobs/jobs.module";
import { LedgerModule } from "./ledger/ledger.module";
import { OrdersModule } from "./orders/orders.module";
import { RainModule } from "./rain/rain.module";

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
 *
 * `ExecutionModule` registers no controller for the opposite reason: nothing
 * calls it. Registering it is what starts its poller, and the poller is the only
 * thing that turns a purchased order into a run — so an unregistered module here
 * would leave every purchase parked in `purchased` with the money escrowed and
 * no worker coming.
 *
 * `JobsModule` is the same argument at the other end of the lifecycle, and it is
 * the strongest instance of it in this file. It has no controller, no export,
 * and nothing anywhere imports it; this line is the whole trigger, because its
 * three jobs start themselves on application bootstrap. Leaving it unregistered
 * would leave every delivered order parked in `delivered` with the seller unpaid
 * — the escrow will permit `release` after the review window and will never do
 * it unprompted — every abandoned run stuck in `running` forever, and every
 * undelivered deal holding a buyer's money past its deadline.
 *
 * `DemoModule` is registered for a version of the same reason, and its failure
 * mode is quieter than either. Its two routes are the visible part; its
 * `onModuleInit` is the load-bearing part, because that is what registers the
 * three demo fixtures into the (otherwise empty) script registry. Drop this
 * import and the endpoints 404 — but the seeded agents still exist and still
 * run, live, producing plausible output nobody asked for. Last in the list
 * because it depends on `CatalogModule`, `AccountsModule` and `ExecutionModule`
 * and is depended on by nothing.
 */
@Module({
  imports: [
    AppConfigModule,
    DatabaseModule,
    HealthModule,
    LedgerModule,
    ChainModule,
    OrdersModule,
    CatalogModule,
    ExecutionModule,
    GuardianModule,
    JobsModule,
    AccountsModule,
    FundingModule,
    RainModule,
    AuthModule,
    DemoModule,
  ],
})
export class AppModule {}
