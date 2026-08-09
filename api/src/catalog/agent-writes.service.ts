import { Injectable, Logger } from '@nestjs/common';
import { DataSource, type EntityManager } from 'typeorm';
import type { Address } from 'viem';

import { ChainOutcomeUnknownError } from '../chain/errors';
import { EscrowOperatorService } from '../chain/escrow-operator.service';
import type { Account } from '../entities/account.entity';
import type { Agent } from '../entities/agent.entity';
import { AgentRepository } from './agent.repository';
import {
  AgentNotFoundError,
  AgentNotRegisteredError,
  NotAgentOwnerError,
} from './catalog.errors';
import { definitionHash, type CanonicalDefinition } from './definition-hash';
import type { CreateAgentDto } from './dto/create-agent.dto';
import type {
  CreateAgentResponse,
  CreateVersionResponse,
  SetActiveResponse,
} from './dto/agent-listing.dto';
import { assertValidJsonSchema } from './schema-validation';

/**
 * The three catalogue writes, and the transaction discipline they share.
 *
 * Every one of them pairs a Postgres change with an escrow call, and the rule
 * is the same in all three: **the chain call happens inside the uncommitted
 * transaction, and the commit only follows if the chain agreed**
 * (`specs/006-agent-catalogue/research.md` R8).
 *
 * ```text
 * BEGIN
 *   SELECT … FOR UPDATE      -- serialise concurrent writers on this agent
 *   write the Postgres change -- not visible to anyone yet
 *   call the escrow           -- up to RECEIPT_TIMEOUT_MS
 * COMMIT                       -- only if the chain agreed; ROLLBACK otherwise
 * ```
 *
 * The alternative — write, then call, then compensate on failure — needs a
 * compensation path that is correct for every failure mode, including the one
 * where the outcome is unknown. This shape deletes that path instead of getting
 * it right. Its cost is a database transaction held open across an RPC, which
 * at demo scale is free and at real scale would be an outbox.
 *
 * Reads deliberately live in `agents.service.ts`. Keeping them apart means a
 * `FOR UPDATE` lock is never one careless edit away from the hottest query in
 * the module.
 */
@Injectable()
export class AgentWritesService {
  private readonly logger = new Logger(AgentWritesService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly agents: AgentRepository,
    private readonly escrow: EscrowOperatorService,
  ) {}

  /**
   * List a new agent: agent row, version 1, and the on-chain registration —
   * and do not answer until the receipt confirms.
   *
   * ## ⚠️ Why this cannot return early
   *
   * The escrow contract **assigns** the agent id; we do not choose it. `openDeal`
   * needs that id, so an agent without one cannot be bought. Answering `201`
   * before the receipt lands would hand the seller a listing that fails at
   * purchase time — on a buyer's screen, which is the worst place to discover
   * it. `executeWrite` already awaits one confirmation and checks
   * `receipt.status`, so "awaits the receipt" costs nothing here beyond not
   * working around it.
   *
   * ## The three outcomes, and why only one of them leaves a row
   *
   * | Chain result | Postgres | Response |
   * | --- | --- | --- |
   * | Success | commit agent + version 1 + `onchain_agent_id` | `201` with the id |
   * | Clean failure — revert, out of funds, gas | **rollback** | `502`, nothing recorded |
   * | **`ChainOutcomeUnknownError`** | **commit with a NULL id**, logged | `502`, "did not complete" |
   *
   * A receipt timeout does not mean the transaction failed — it means we stopped
   * waiting, and it may confirm a second later. Rolling back there would delete
   * the only record of an agent that is about to exist on-chain, leaving a live
   * registration with no row anywhere and no way to find it except by scanning
   * logs. So the rows are kept, the agent is invisible to every buyer (the
   * public queries require a non-NULL id), and its owner sees it flagged
   * `listed: false`.
   *
   * That is the **only** way a NULL `onchain_agent_id` is produced, which is
   * what makes the flag mean something specific rather than "something went
   * wrong at some point".
   *
   * ⚠️ **Such an agent must never be retried by calling `registerAgent` again.**
   * The contract would mint a *second* on-chain agent and the seller would own
   * two, one of them unreachable. Both the tx hash and the definition hash are
   * logged at `error` precisely so the pair can be reconciled by hand against
   * `AgentRegistered` logs instead.
   */
  async createAgent(account: Account, dto: CreateAgentDto): Promise<CreateAgentResponse> {
    // Before the transaction and before the chain: a bad schema is a `400` the
    // caller can fix, and there is no reason for it to cost a row lock or a
    // gas-priced revert. `assertValidJsonSchema` names which of the two fields
    // was at fault (FR-008), which a database constraint never could.
    assertValidJsonSchema(dto.inputSchema, 'inputSchema');
    assertValidJsonSchema(dto.outputSchema, 'outputSchema');

    const definition = toCanonicalDefinition(dto);
    const hash = definitionHash(definition);

    const outcome = await this.dataSource.transaction(async (manager) => {
      // The owner comes from the authenticated session and never from the
      // request body — there is no field for it to arrive in (FR-010).
      const { agent, version } = await this.agents.insertAgentWithFirstVersion(
        account.id,
        definition,
        hash.bytes,
        manager,
      );

      try {
        // The owner argument is the seller's PAYOUT address, so it is the
        // account's own wallet — never anything from the request body. It is
        // also priced in cents: the single conversion to base units lives
        // inside this call (invariant #2).
        const tx = await this.escrow.registerAgent(
          account.walletAddress as Address,
          definition.priceMinor,
          hash.hex,
        );

        // Sequential `uint256` ids from a fresh contract; `Number` is exact far
        // beyond any id this platform will ever see, and the column's
        // transformer speaks `number` on both sides.
        const onchainAgentId = Number(tx.value);

        await this.agents.setOnchainAgentId(agent.id, onchainAgentId, manager);

        this.logger.log(
          `registered agent ${agent.id} as on-chain #${onchainAgentId} ` +
            `defHash=${hash.hex} tx=${tx.hash}`,
        );

        return { committed: true, agent, version, onchainAgentId } as const;
      } catch (err) {
        // ⚠️ Returning rather than throwing is what COMMITS the rows. It is the
        // whole of the unknown-outcome branch and it is easy to "tidy" into a
        // rethrow, which would silently delete the record of an agent that is
        // about to exist on-chain.
        if (err instanceof ChainOutcomeUnknownError) {
          return { committed: false, agentId: agent.id, cause: err } as const;
        }

        // Every knowable failure. Throwing rolls the whole transaction back, so
        // no agent and no version survive it.
        throw err;
      }
    });

    if (!outcome.committed) {
      // Logged at `error` with BOTH hashes: the tx hash finds the transaction,
      // the definition hash identifies which `AgentRegistered` log belongs to
      // this row if it did land. Reconciliation is by hand and out of scope —
      // this line is what makes it possible at all.
      this.logger.error(
        `registerAgent outcome unknown for agent ${outcome.agentId}; ` +
          `row kept with NULL onchain_agent_id, NOT purchasable, NOT retryable. ` +
          `tx=${outcome.cause.hash} defHash=${hash.hex}`,
      );

      throw outcome.cause;
    }

    return {
      id: outcome.agent.id,
      version: outcome.version.version,
      onchainAgentId: outcome.onchainAgentId,
      definitionHash: hash.hex,
      active: outcome.agent.active,
    };
  }

  /**
   * Publish a new version of an existing agent.
   *
   * The previous version is not edited and not removed — `agent_versions` has
   * no update path at all (`agent.repository.ts`). A seller who wants to soften
   * their `capabilities` after a bad delivery gets a *new* version, and the
   * order that already ran keeps pointing at the one it was opened against, so
   * the dispute is still judged against what was actually promised
   * (`docs/CONTEXT.md` invariant #6). Nothing in this method reads or writes
   * `orders`, which is what makes "publishing leaves running orders untouched"
   * true by having no code that could do otherwise.
   *
   * ⚠️ **`updateAgent` is called even when the price is unchanged.** The hash
   * changed, and the hash is the commitment — skipping the call because the
   * price matched would leave the chain holding a fingerprint for a definition
   * that is no longer current, which is precisely the swap the commitment
   * exists to prevent (FR-034).
   *
   * ⚠️ **An identical resubmission produces a new version with the SAME
   * `definitionHash`**, and that is correct rather than a duplicate to reject.
   * The fingerprint covers the definition and not the version number
   * (`definition-hash.ts`), and nothing anywhere resolves a version *from* a
   * hash — an order pins `agent_version_id`. Refusing it would be inventing a
   * uniqueness rule the product does not have.
   *
   * The insert happens inside the transaction and *before* the chain call, so a
   * chain failure rolls it back: at no point is a version row visible carrying
   * a price the escrow will not honour.
   */
  async publishVersion(
    account: Account,
    agentId: string,
    dto: CreateAgentDto,
  ): Promise<CreateVersionResponse> {
    assertValidJsonSchema(dto.inputSchema, 'inputSchema');
    assertValidJsonSchema(dto.outputSchema, 'outputSchema');

    const definition = toCanonicalDefinition(dto);
    const hash = definitionHash(definition);

    return this.dataSource.transaction(async (manager) => {
      const agent = await this.assertOwnedAndRegistered(agentId, account, manager);

      // Inside the lock: two concurrent publishes cannot both claim N+1, and
      // the loser waits here rather than discovering the collision after its
      // chain call has already landed.
      const version = await this.agents.nextVersionNumber(agentId, manager);
      const row = await this.agents.insertVersion(
        agentId,
        version,
        definition,
        hash.bytes,
        manager,
      );

      // `agent.onchainAgentId` is non-null — `assertOwnedAndRegistered` checked
      // it — and the contract takes the on-chain id, not our uuid.
      await this.escrow.updateAgent(
        BigInt(agent.onchainAgentId as number),
        definition.priceMinor,
        hash.hex,
      );

      this.logger.log(
        `agent ${agentId} published version ${version} ` +
          `defHash=${hash.hex} priceMinor=${definition.priceMinor}`,
      );

      return {
        id: row.id,
        agentId,
        version,
        definitionHash: hash.hex,
      };
    });
  }

  /**
   * Switch an agent's availability on or off.
   *
   * ## Why the chain call is inside the transaction rather than ordered around it
   *
   * Taken as a strict before/after, the safe order is asymmetric — deactivating
   * wants Postgres first (hidden but still buyable is inert; visible but
   * unbuyable is the defect the catalogue filter exists to prevent), while
   * activating wants the chain first, for the mirror reason. Which reads as
   * *whichever write increases the agent's exposure goes second*, the same
   * shape as `docs/CONTEXT.md` invariant #1.
   *
   * Wrapping both in one transaction subsumes that rule: the Postgres change is
   * invisible until commit, so there is no window in which the two disagree in
   * either direction. A chain failure rolls back and the toggle simply did not
   * happen (R8).
   *
   * ## Idempotent by construction
   *
   * `active` is an absolute value supplied by the caller, never a toggle
   * instruction, so applying it twice leaves the world as applying it once did.
   * Setting the value the agent already holds succeeds with no error and no
   * special case — `ui/specs/007-seller-pages` R9 depends on this in writing,
   * and it is why that call is exempt from the app's non-idempotency doctrine.
   * The redundant `setAgentActive` costs one transaction's gas; branching to
   * avoid it would introduce a read-then-decide race for a saving that is
   * measured in cents.
   *
   * **Running orders are never affected.** `setAgentActive` gates `openDeal`
   * only; deals already open carry their own pinned `defHash` and `defVersion`
   * (`docs/smart-contract.md` §4.2).
   */
  async setActive(
    account: Account,
    agentId: string,
    active: boolean,
  ): Promise<SetActiveResponse> {
    return this.dataSource.transaction(async (manager) => {
      const agent = await this.assertOwnedAndRegistered(agentId, account, manager);

      await this.agents.setActive(agentId, active, manager);
      await this.escrow.setAgentActive(BigInt(agent.onchainAgentId as number), active);

      this.logger.log(`agent ${agentId} set active=${String(active)}`);

      return { id: agentId, active };
    });
  }

  /**
   * The ownership and registration gate both mutating routes pass through,
   * holding the agent's row lock for the rest of the caller's transaction.
   *
   * ⚠️ The two refusals are different HTTP answers and the difference matters:
   * `NotAgentOwnerError` renders as `403` on these write routes because the
   * caller already holds the id from their own list, while
   * `AgentNotRegisteredError` renders as `409` because nothing was attempted
   * and the chain is not at fault. `GET /agents/:id/versions` deliberately does
   * NOT use this helper — it must answer `404` for a non-owner so it cannot be
   * used to discover which uuids are real (FR-029).
   */
  private async assertOwnedAndRegistered(
    agentId: string,
    account: Account,
    manager: EntityManager,
  ): Promise<Agent> {
    const agent = await this.agents.findByIdWithLock(agentId, manager);

    if (agent === null) {
      throw new AgentNotFoundError(`agent ${agentId} does not exist`, agentId);
    }

    if (agent.ownerAccountId !== account.id) {
      throw new NotAgentOwnerError(`agent ${agentId} belongs to another account`, agentId);
    }

    if (agent.onchainAgentId === null) {
      // Its registration outcome is unknown, so there is no on-chain agent to
      // update. ⚠️ Not recoverable by calling `registerAgent` again — that
      // would mint a second one. See `agent.entity.ts`.
      throw new AgentNotRegisteredError(
        `agent ${agentId} has no on-chain id; its registration did not complete`,
        agentId,
      );
    }

    return agent;
  }
}

/**
 * The validated request body, narrowed to exactly the ten fields that are
 * hashed.
 *
 * Written out field by field rather than spread, for the same reason
 * `canonicalise` builds its payload explicitly: a spread would carry whatever
 * else the DTO grows into the commitment, and the only symptom would be a
 * fingerprint that stops reproducing on a machine that is not this one.
 */
function toCanonicalDefinition(dto: CreateAgentDto): CanonicalDefinition {
  return {
    name: dto.name,
    description: dto.description,
    capabilities: dto.capabilities,
    exclusions: dto.exclusions,
    priceMinor: dto.priceMinor,
    inputSchema: dto.inputSchema,
    outputSchema: dto.outputSchema,
    systemPrompt: dto.systemPrompt,
    model: dto.model,
    timeoutSeconds: dto.timeoutSeconds,
  };
}
