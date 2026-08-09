import { Logger, Module, type OnModuleInit } from '@nestjs/common';

import { AccountsModule } from '../accounts/accounts.module';
import { CatalogModule } from '../catalog/catalog.module';
import { definitionHash } from '../catalog/definition-hash';
import { DemoScriptRegistry } from '../execution/demo-script.registry';
import { ExecutionModule } from '../execution/execution.module';
import { DemoController } from './demo.controller';
import { DemoResetService } from './demo-reset.service';
import { DemoSeedService } from './demo-seed.service';
import { DEMO_FIXTURES } from './fixtures';
import { seededAgent } from './seeded-agents';

/**
 * The demo rig: two unauthenticated routes and three fixtures.
 *
 * `POST /demo/seed` publishes the three seller agents the demo runs on, through
 * the ordinary seller path so each one is registered on-chain and buyable.
 * `POST /demo/reset` clears the transactional history between rehearsals and
 * leaves the catalogue standing.
 *
 * **This module is a leaf.** It imports three modules and exports nothing;
 * nothing imports it. That is what keeps a demo concern from becoming a
 * dependency of the product:
 *
 * - `CatalogModule` → `AgentWritesService` (publish the listings) and
 *   `AgentRepository` (has this already been seeded?).
 * - `AccountsModule` → `AccountRepository`, to resolve the demo seller from its
 *   configured address exactly the way a first sign-in would.
 * - `ExecutionModule` → `DemoScriptRegistry`, the seam API-08 built and shipped
 *   empty for this feature to fill.
 *
 * ⚠️ **Registering this module is what puts the fixtures in force**, because
 * that is what runs `onModuleInit`. An unregistered `DemoModule` is not a
 * missing endpoint — it is three seeded agents behaving live, which looks like
 * a working demo right up to the moment Act 2 returns five line items on stage.
 */
@Module({
  imports: [CatalogModule, AccountsModule, ExecutionModule],
  controllers: [DemoController],
  providers: [DemoSeedService, DemoResetService],
})
export class DemoModule implements OnModuleInit {
  private readonly logger = new Logger(DemoModule.name);

  constructor(private readonly scripts: DemoScriptRegistry) {}

  /**
   * Register the three fixtures into the script registry.
   *
   * ## ⚠️ At bootstrap, and deliberately NOT in the seed service
   *
   * The obvious place for this is `POST /demo/seed` — the registry's own
   * docblock even says "API-11 … registers them". It is the wrong place, and
   * the reason is that the two halves of a seeded demo have different
   * lifetimes: **the listings are in Postgres and the scripts are in memory**.
   * Register at seed time and the first restart leaves three seeded agents
   * standing with no fixtures behind them.
   *
   * That failure is silent. There is no error, no missing row, no log line —
   * Act 2 simply runs live and returns a competent five-item extraction, on
   * stage, in the one act whose entire point is that three of five came back.
   * Registering here means the fixtures are in force whenever the process is.
   *
   * ## Why no database read is needed for this
   *
   * `definition_hash` is a pure function of the definition
   * (`src/catalog/definition-hash.ts` hashes ten fields and excludes `id`,
   * `agentId`, `ownerAccountId`, `createdAt` and even `version`, precisely so a
   * reseeded database produces the same fingerprint). So the key for a fixture
   * is computable from `seeded-agents.ts` alone. The same hash is computed a
   * second time by `createAgent` on its way to Postgres and the chain, from the
   * same object — the two agree **by construction**, not by convention.
   *
   * A consequence worth stating: fixtures are registered even on a database
   * that was never seeded. That is harmless. No agent has those definition
   * hashes, so every lookup misses, which is exactly the empty-registry
   * behaviour `ScriptedAgentRunner` already documents as the normal case.
   *
   * (`specs/011-demo-seed-fixtures/research.md` R1.)
   */
  onModuleInit(): void {
    for (const fixture of DEMO_FIXTURES) {
      const agent = seededAgent(fixture.agentKey);

      this.scripts.register({
        // ⚠️ `.slice(2)` strips the `0x`, and it is load-bearing rather than
        // cosmetic. `definitionHash().hex` is viem's `Hex` and carries the
        // prefix; the string the runner compares against comes from
        // `execution.repository.ts` as `Buffer.toString('hex')` — **bare hex,
        // no prefix**. The registry lowercases but does not normalise the
        // prefix, so registering the prefixed form produces a key that can
        // never match. The symptom is not an error: it is Act 2 quietly
        // running live.
        definitionHash: definitionHash(agent.definition).hex.slice(2),
        input: fixture.input,
        script: fixture.script,
        label: fixture.label,
      });
    }

    // One line naming the count, so a boot log answers "are the acts armed?"
    // without reading three registration lines. The registry logs each one.
    this.logger.log(`${DEMO_FIXTURES.length} demo fixtures registered`);
  }
}
