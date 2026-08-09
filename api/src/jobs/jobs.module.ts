import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ChainModule } from '../chain/chain.module';
import { Order } from '../entities/order.entity';
import { Run } from '../entities/run.entity';
import { DealReconciler } from './deal-reconciler';
import { JobsRepository } from './jobs.repository';
import { ReaperJob } from './reaper.job';
import { ReclaimerJob } from './reclaimer.job';
import { SweeperJob } from './sweeper.job';

/**
 * The three timers that make the escrow's deadlines actually fire.
 *
 * A smart contract cannot act on its own. `release` after a review window,
 * `reclaim` after a delivery deadline — both are things the chain will happily
 * permit and will never do unprompted. This module is what prompts them, plus a
 * reaper for the one deadline that is entirely ours: an order left in `running`
 * by a process that no longer exists.
 *
 * It is the last entry in `docs/CONTEXT.md` §3's module map to be built.
 *
 * ## It exports nothing, and nothing imports it
 *
 * There is no controller here and no route anywhere downstream. The jobs are
 * started by `PollingJob.onApplicationBootstrap` the moment Nest instantiates
 * them, which means **registering this module in `AppModule` is the entire
 * trigger** — see the note this module's registration adds there.
 *
 * ## ⚠️ It imports neither `ExecutionModule` nor `GuardianModule`
 *
 * The reaper writes to a `runs` row, and `runs` is `execution/`'s table. Reaching
 * it by importing `ExecutionService` would hand a cron job a handle on the thing
 * that starts model calls, so instead the reaper's write is one guarded `UPDATE`
 * issued through this module's own `JobsRepository`. Two modules writing
 * different columns of one table under different preconditions is a smaller cost
 * than a timer holding the execution engine (research R2).
 *
 * The standing rule that `execution` and `guardian` must not import each other
 * — *"Execution produces evidence; Guardian consumes it"* — is untouched by
 * this: `jobs` imports neither, and neither imports `jobs`.
 *
 * `ChainModule` is imported for exactly three calls: `release` and `reclaim` on
 * `EscrowOperatorService`, and `getDeal` on `EscrowReadService`. The reaper uses
 * none of them — it makes no chain call at all, because nothing was delivered.
 */
@Module({
  imports: [ChainModule, TypeOrmModule.forFeature([Order, Run])],
  providers: [
    JobsRepository,
    DealReconciler,
    SweeperJob,
    ReaperJob,
    ReclaimerJob,
  ],
})
export class JobsModule {}
