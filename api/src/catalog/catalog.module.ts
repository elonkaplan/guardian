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
 * Nothing is exported. No other module needs to read the catalogue yet; API-07
 * will need an agent-version lookup for the purchase saga, and that is the
 * moment to add one export rather than pre-emptively widening the surface now.
 */
@Module({
  imports: [TypeOrmModule.forFeature([Agent, AgentVersion]), ChainModule],
  controllers: [AgentsController],
  providers: [AgentRepository, AgentsService, AgentVersionsService, AgentWritesService],
})
export class CatalogModule {}
