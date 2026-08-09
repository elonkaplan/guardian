import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ChainModule } from '../chain/chain.module';
import { Run } from '../entities/run.entity';
import { AgentRunner } from './agent-runner';
import { ClaudeAgentRunner } from './claude-agent-runner';
import { DemoScriptRegistry } from './demo-script.registry';
import { ExecutionPoller } from './execution.poller';
import { ExecutionRepository } from './execution.repository';
import { ExecutionService } from './execution.service';
import { ScriptedAgentRunner } from './scripted-agent-runner';

/**
 * `execution/` — the wrapped workspace. The platform runs the seller's agent
 * and keeps the receipts.
 *
 * ## ⚠️ This module registers no controller, and that is the design
 *
 * Nothing calls execution over HTTP. Its only input is `orders.state`: an order
 * sitting in `purchased` with a confirmed `onchain_deal_id` **is** the queue
 * entry (`docs/CONTEXT.md` invariant #9), and API-07 deliberately left it that
 * way — `POST /orders` calls nothing and defines no dispatcher interface
 * (`specs/007-orders-purchase-saga/research.md` R13). So the trigger lives here,
 * as a poller, and the move to `running` belongs to the worker that performs it.
 *
 * ## Why the evidence is trustworthy
 *
 * The platform executes the seller's definition; the seller hosts nothing and
 * reports nothing (`docs/product-workflow.md` §6.2). The party that might one
 * day be the defendant never authors the court record. Every design choice in
 * this module protects that: one run row per order enforced by a UNIQUE, no
 * retry path anywhere, and `runs.output IS NULL` left standing as the proof of
 * non-delivery (invariant #7).
 *
 * ## ⚠️ Must not import `guardian/`
 *
 * `docs/CONTEXT.md` §3: *"Keep `execution` and `guardian` from importing each
 * other. Execution produces evidence; Guardian consumes it."* That separation is
 * what makes "the platform produced the evidence, not the audited party" true in
 * code rather than only in prose. `guardian/` does not exist yet, which is
 * exactly when the rule is cheap to keep and easy to break — the audit reads the
 * `runs` table and nothing else.
 */
@Module({
  // `forFeature([Run])` only. `orders` and `agent_versions` are read through the
  // repository's `EntityManager`, which resolves entity metadata from the root
  // DataSource — the same call `LedgerModule` documents for `Account`. Listing
  // them here would advertise a wiring path this module does not use and imply
  // an ownership it does not have (`docs/CONTEXT.md` §3).
  imports: [TypeOrmModule.forFeature([Run]), ChainModule],
  providers: [
    ExecutionRepository,
    ExecutionService,
    ExecutionPoller,
    DemoScriptRegistry,
    ClaudeAgentRunner,
    // The port, not the implementation. `ExecutionService` depends on
    // `AgentRunner` and must stay unable to tell which runner it got — that is
    // what keeps the deterministic demo mode a substitute for the *model call*
    // rather than a shortcut around the run record (research R4).
    //
    // ⚠️ `ScriptedAgentRunner` is registered even though the registry ships
    // empty, and that is deliberate: with no entries it is a pass-through, so
    // there is no "demo mode" to switch on and no deployment in which the
    // scripted path is a different code path. `ClaudeAgentRunner` is provided
    // alongside because the scripted runner delegates to it on a miss — which
    // is every real purchase.
    { provide: AgentRunner, useClass: ScriptedAgentRunner },
  ],
  // The seam API-11 fills. It imports this module and calls `register` three
  // times, once per act, after the seeded versions exist and their
  // `definition_hash` values are known.
  exports: [DemoScriptRegistry],
})
export class ExecutionModule {}
