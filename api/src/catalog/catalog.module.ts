import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ChainModule } from '../chain/chain.module';
import { AgentVersion } from '../entities/agent-version.entity';
import { Agent } from '../entities/agent.entity';
import { AgentRepository } from './agent.repository';
import { AgentVersionsService } from './agent-versions.service';
import { AgentWritesService } from './agent-writes.service';
import { AgentsController } from './agents.controller';
import { AgentsService } from './agents.service';

/**
 * The catalogue: agents, versions, definition hashing, and the serialisation
 * boundary (`docs/CONTEXT.md` §3).
 *
 * **The module is `catalog`, the routes are `/agents`, and the mismatch is
 * deliberate.** The module map in `docs/CONTEXT.md` §3 and `api-design.md` §2
 * both name it for what it owns; the routes are named for what they address.
 * API-07 does the same thing in the other direction, adding `GET /sales` to
 * `orders`.
 *
 * ⚠️ **`ChainModule` is imported for `EscrowOperatorService`, never for a
 * client.** That module exports services and deliberately not the viem clients
 * behind them, and that export list is what makes the narrowed ABIs mean
 * something: with no client in reach, the only calls this module can make are
 * the ones the operator is entitled to. Registration, version updates and the
 * availability toggle all go through it, and the single cents-to-base-units
 * conversion stays on its far side (invariant #2).
 *
 * **Two exports, added by API-11 for the demo seed — and this is the moment the
 * original note anticipated.** It said nothing was exported *yet*, and that the
 * moment to add one was when a module genuinely needed it rather than
 * pre-emptively. `DemoModule` needs both:
 *
 * - `AgentWritesService` because the seed must publish its three listings
 *   through the **real seller path**. Anything else — a direct insert, a
 *   demo-only creation helper — produces rows with no `registerAgent` behind
 *   them, and `GET /agents` filters those out precisely because they cannot be
 *   bought. A duplicate of this path inside `demo/` would also duplicate the
 *   hashing, the transaction, and the unknown-outcome branch, and the copy that
 *   drifts is always the one nobody is looking at.
 * - `AgentRepository` for the seed's idempotency check: "does this agent already
 *   exist, and does its active version still hash to what the code says?" is a
 *   read, and it is the read that keeps a second seed from creating a second
 *   listing.
 *
 * ⚠️ **`AgentsService` and `AgentVersionsService` stay unexported.** They are the
 * buyer-facing and owner-facing serialisers, and the demo has no business
 * reaching them — the exports above are writes and one lookup, not a way to read
 * the catalogue past its boundary.
 */
@Module({
  imports: [TypeOrmModule.forFeature([Agent, AgentVersion]), ChainModule],
  controllers: [AgentsController],
  providers: [AgentRepository, AgentsService, AgentVersionsService, AgentWritesService],
  exports: [AgentWritesService, AgentRepository],
})
export class CatalogModule {}
