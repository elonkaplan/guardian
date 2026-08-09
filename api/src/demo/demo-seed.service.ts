import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Address } from 'viem';

import { AccountRepository } from '../accounts/account.repository';
import { AgentRepository } from '../catalog/agent.repository';
import { AgentWritesService } from '../catalog/agent-writes.service';
import { definitionHash } from '../catalog/definition-hash';
import type { AppConfig } from '../config/env.schema';
import type { Account } from '../entities/account.entity';
import { DemoAgentUnregisteredError } from './demo.errors';
import type {
  SeedResponse,
  SeededAgentResponse,
  SeededFixtureResponse,
} from './dto/seed-response.dto';
import { DEMO_FIXTURES } from './fixtures';
import { SEEDED_AGENTS, type SeededAgent } from './seeded-agents';
import { assertStructuredOutputCompatible } from './structured-output-guard';

/**
 * `POST /demo/seed` — publish the three agents the demo runs on.
 *
 * ## It publishes through the real seller path, and that is the point
 *
 * Every listing is created by `AgentWritesService.createAgent`, the same method
 * `POST /agents` calls. That means each one is hashed, inserted with its version
 * 1, registered on-chain with `registerAgent`, and has its `onchain_agent_id`
 * written back from the receipt — because `GET /agents` filters out anything
 * with a NULL id, "the seed succeeded" and "all three are buyable" are the same
 * statement rather than two things to check separately.
 *
 * A demo-only insert path would have produced rows that look right in psql and
 * fail at `openDeal`, on a buyer's screen, which is the worst place to find out.
 *
 * ## ⚠️ Slow and sequential, deliberately
 *
 * Three on-chain registrations, each awaiting a receipt. They are **not**
 * parallelised: `registerAgent` is signed by the operator key, and three
 * concurrent transactions from one key is a nonce race. Seconds on Monad, and
 * the seed is run between rehearsals rather than on a request path.
 *
 * ## Idempotent, and self-healing
 *
 * Re-running is the normal case — it is how an operator gets the fixtures back
 * after a reset, and how an edited definition reaches the database. The decision
 * per agent (`specs/011-demo-seed-fixtures/research.md` R3):
 *
 * | State found | Action |
 * | --- | --- |
 * | No agent with that name | `createAgent` — full path, on-chain registration |
 * | Active version's hash **matches** the code | nothing; return the existing ids |
 * | Active version's hash **differs** | `publishVersion` — new immutable version + `updateAgent` |
 * | `onchain_agent_id IS NULL` | **refuse**, naming the agent |
 *
 * The third row respects invariant #6: a new version never edits the old one, so
 * an order already judged keeps the text it was judged against.
 */
@Injectable()
export class DemoSeedService {
  private readonly logger = new Logger(DemoSeedService.name);
  private readonly sellerAddress: Address;

  constructor(
    config: ConfigService<AppConfig, true>,
    private readonly accounts: AccountRepository,
    private readonly agents: AgentRepository,
    private readonly writes: AgentWritesService,
  ) {
    // Read once at construction. The key is required by the config schema, so
    // an absent value is a boot failure named in the preflight report rather
    // than a seed that fails halfway — which matters because the address is
    // fixed at registration and a wrong one cannot be amended afterwards.
    this.sellerAddress = config.get('DEMO_SELLER_ADDRESS', {
      infer: true,
    }) as Address;
  }

  async seed(): Promise<SeedResponse> {
    // ⚠️ Before anything is written and before any gas is spent. A seeded output
    // schema that omits `additionalProperties: false` on any object passes the
    // catalogue's Ajv validation and is then refused by the model service at run
    // time — the failure that took out all thirteen orders in the execution
    // engine's verification run. Catching it here costs nothing; catching it
    // during an act costs the act.
    for (const agent of SEEDED_AGENTS) {
      assertStructuredOutputCompatible(
        agent.definition.inputSchema,
        `${agent.key}.inputSchema`,
      );
      assertStructuredOutputCompatible(
        agent.definition.outputSchema,
        `${agent.key}.outputSchema`,
      );
    }

    const seller = await this.accounts.findOrCreateByAddress(
      this.sellerAddress,
    );

    const published: SeededAgentResponse[] = [];

    // Sequential — see the class docblock. `for…of` with `await` rather than
    // `Promise.all`, and it is not an oversight to "optimise" later.
    for (const agent of SEEDED_AGENTS) {
      published.push(await this.publishOne(seller, agent));
    }

    const fixtures = this.publishedFixtures(published);

    this.logger.log(
      `demo seed complete: ${published.filter((a) => a.created).length} created, ` +
        `${published.filter((a) => !a.created).length} already present; ` +
        `seller=${seller.walletAddress}`,
    );

    return {
      seller: {
        accountId: seller.id,
        walletAddress: seller.walletAddress,
      },
      agents: published,
      fixtures,
    };
  }

  /**
   * Create, reconcile, or leave alone — one seeded agent.
   */
  private async publishOne(
    seller: Account,
    agent: SeededAgent,
  ): Promise<SeededAgentResponse> {
    const hash = definitionHash(agent.definition);
    const existing = (await this.agents.findOwnedListings(seller.id)).find(
      (row) => row.name === agent.definition.name,
    );

    if (existing === undefined) {
      const created = await this.writes.createAgent(seller, agent.definition);

      this.logger.log(
        `seeded ${agent.definition.name} as agent ${created.id} ` +
          `(on-chain #${created.onchainAgentId})`,
      );

      return {
        key: agent.key,
        agentId: created.id,
        onchainAgentId: created.onchainAgentId,
        name: agent.definition.name,
        priceMinor: agent.definition.priceMinor,
        version: created.version,
        definitionHash: created.definitionHash,
        created: true,
      };
    }

    // ⚠️ A NULL on-chain id means a `registerAgent` whose outcome was never
    // determined — the row was kept precisely so the transaction can be
    // reconciled by hand against the contract's `AgentRegistered` logs. Seeding
    // over it would call `registerAgent` a second time, and the contract mints a
    // NEW id on every call: the seller would own two on-chain agents, one of
    // them permanently unreachable. This refuses instead, and says so.
    if (existing.onchainAgentId === null) {
      throw new DemoAgentUnregisteredError(
        `seeded agent "${agent.definition.name}" (${existing.agentId}) has no ` +
          `on-chain id: a previous registerAgent's outcome is unknown. Reconcile ` +
          `it by hand against the contract's AgentRegistered logs — do NOT re-seed ` +
          `or re-register, which would mint a second on-chain agent the seller ` +
          `owns and cannot reach.`,
        existing.agentId,
        agent.definition.name,
      );
    }

    // The definition in code is the authority. If the stored active version no
    // longer hashes to it, someone edited a fixture's definition — publish a new
    // version so the database catches up. The old version is untouched, so any
    // order pinned to it is still judged against what it actually bought
    // (invariant #6).
    const active = (
      await this.agents.findVersionsForOwner(existing.agentId, seller.id)
    )[0];

    if (active !== undefined && !active.definitionHash.equals(hash.bytes)) {
      const version = await this.writes.publishVersion(
        seller,
        existing.agentId,
        agent.definition,
      );

      this.logger.log(
        `seeded definition for ${agent.definition.name} changed; ` +
          `published version ${version.version} (${version.definitionHash})`,
      );

      return {
        key: agent.key,
        agentId: existing.agentId,
        onchainAgentId: Number(existing.onchainAgentId),
        name: agent.definition.name,
        priceMinor: agent.definition.priceMinor,
        version: version.version,
        definitionHash: version.definitionHash,
        created: false,
      };
    }

    return {
      key: agent.key,
      agentId: existing.agentId,
      onchainAgentId: Number(existing.onchainAgentId),
      name: agent.definition.name,
      priceMinor: agent.definition.priceMinor,
      version: active?.version ?? existing.version,
      definitionHash: hash.hex,
      created: false,
    };
  }

  /**
   * The three acts, resolved to the agent ids that were just seeded.
   *
   * ⚠️ Served from the **same** `DEMO_FIXTURES` objects the module registered at
   * bootstrap, never from a copy. That is what makes "what was published" and
   * "what will match" the same thing: a second literal here would be a second
   * place for the input to drift, and the drift would show up as an act quietly
   * running live.
   */
  private publishedFixtures(
    published: readonly SeededAgentResponse[],
  ): SeededFixtureResponse[] {
    return DEMO_FIXTURES.map((fixture) => {
      const agent = published.find((a) => a.key === fixture.agentKey);

      // Cannot happen — every fixture's `agentKey` is a `SeededAgentKey` and
      // every seeded agent was just published. Stated rather than asserted so a
      // future fourth agent cannot make this silently emit an empty id.
      if (agent === undefined) {
        throw new Error(
          `fixture for act ${fixture.act} names agent "${fixture.agentKey}", ` +
            `which was not seeded`,
        );
      }

      return {
        act: fixture.act,
        agentKey: fixture.agentKey,
        agentId: agent.agentId,
        input: fixture.input,
        acceptanceCriteria: fixture.acceptanceCriteria,
        complaint: fixture.complaint,
        expectedTier: fixture.expectedTier,
      };
    });
  }
}
