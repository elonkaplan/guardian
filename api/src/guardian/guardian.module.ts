import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ChainModule } from '../chain/chain.module';
import { Verdict } from '../entities/verdict.entity';
import { OrdersModule } from '../orders/orders.module';
import { Auditor } from './auditor';
import { ClaudeAuditor } from './claude-auditor';
import { GuardianPoller } from './guardian.poller';
import { GuardianRepository } from './guardian.repository';
import { GuardianService } from './guardian.service';
import { VerdictController } from './verdict.controller';
import { VerdictService } from './verdict.service';

/**
 * The audit engine: case-file assembly, the audit, the ruling, and the on-chain
 * `resolve` — the scope `docs/CONTEXT.md`'s module map assigns to `guardian`.
 *
 * ## ⚠️ Must not import `execution/`
 *
 * `docs/CONTEXT.md` §3: *"Keep `execution` and `guardian` from importing each
 * other. Execution produces evidence; Guardian consumes it."* This module
 * **reads the `runs` table** — that is the whole point — but it never imports
 * `ExecutionModule`, and `GuardianRepository` owns its own query rather than
 * borrowing `ExecutionRepository`'s. That is what keeps the direction one-way by
 * construction rather than by convention, and it is what makes *"the platform
 * produced the evidence, not the audited party"* true in code.
 *
 * `ExecutionModule`'s own header states the same rule from the other side, and
 * notes it was written when `guardian/` did not yet exist — *"exactly when the
 * rule is cheap to keep and easy to break."* This is the moment it would have
 * been broken.
 *
 * ## Why the controller lives here rather than in `orders/`
 *
 * `GET /orders/:id/verdict` is on the `orders` path, and Nest permits two
 * controllers on one prefix. Putting the route in `orders.controller.ts` would
 * make `OrdersModule` import `GuardianModule` and place the verdict's shape two
 * modules from the code that writes it. The module map is explicit that the
 * verdict is Guardian's.
 *
 * `guardian → orders` is the safe direction and creates no cycle: `orders/` has
 * no knowledge of this module.
 */
@Module({
  imports: [
    // `forFeature([Verdict])` only. `orders`, `agent_versions`, `agents`,
    // `runs` and `complaints` are read through the repository's
    // `EntityManager`, which resolves metadata from the root DataSource — the
    // same arrangement `ExecutionModule` documents. Listing them here would
    // advertise an ownership this module does not have.
    TypeOrmModule.forFeature([Verdict]),
    // `EscrowGuardianService` — whose entire capability is `resolve`, paired
    // with a one-entry ABI so that signing anything else is a compile error.
    ChainModule,
    // `OrderRepository.findVisibleToAccount` — the buyer-or-agent-owner
    // authorisation query, reused rather than reimplemented. Writing a second
    // one here would put the rule at a sixth call site instead of in the query
    // that fetched the row anyway (contracts/verdict-api.md §3).
    OrdersModule,
  ],
  controllers: [VerdictController],
  providers: [
    GuardianRepository,
    GuardianService,
    GuardianPoller,
    VerdictService,
    // The port, not the implementation — `GuardianService` depends on `Auditor`.
    //
    // ⚠️ Unlike `ExecutionModule`, there is exactly ONE implementation and there
    // must never be a second. FR-041: no configuration, seeded fixture, or
    // environment mode may supply a pre-determined ruling. The execution layer's
    // scripted runner is safe because it substitutes the thing being *judged*; a
    // scripted auditor would substitute the *judgment*, which is the single
    // claim this product makes. The port is here for dependency inversion, not
    // to admit an alternative.
    { provide: Auditor, useClass: ClaudeAuditor },
  ],
})
export class GuardianModule {}
