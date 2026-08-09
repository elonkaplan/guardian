import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { type EntityManager, Repository, type SelectQueryBuilder } from 'typeorm';

import { AgentVersion } from '../entities/agent-version.entity';
import { Agent } from '../entities/agent.entity';
import type { CanonicalDefinition } from './definition-hash';

/**
 * Everything written into an `agent_versions` row, in one argument.
 *
 * It is exactly `CanonicalDefinition` — the ten fields that are hashed — which
 * is the point rather than a coincidence: **anything stored on a version that
 * is not in this type is not in the commitment**, and would be a field a seller
 * could change without changing what they signed up to. The only columns
 * outside it are the ones the platform owns (`id`, `agent_id`, `version`,
 * `definition_hash`, `created_at`), and none of those describe the product.
 */
export type VersionDefinition = CanonicalDefinition;

/** What `insertAgentWithFirstVersion` hands back to the caller. */
export interface NewAgentRows {
  agent: Agent;
  version: AgentVersion;
}

/**
 * All Postgres access for the catalogue.
 *
 * **There is no update path and no delete path against `agent_versions`, and
 * that is the design.** Versions are immutable once written (spec FR-032): an
 * order pins `agent_version_id` rather than `agent_id` (`docs/CONTEXT.md`
 * invariant #6), so a row that changed after the fact would silently rewrite
 * the definition a dispute is being judged against — the one thing the whole
 * versioning story exists to prevent. A corrected definition is a new version.
 * If a future task appears to need an `UPDATE` here, what it needs is a row.
 *
 * The only mutations in this class are on `agents`: `onchain_agent_id` once,
 * when registration confirms, and `active` when the owner toggles it.
 *
 * **Every write method takes an `EntityManager` and none of them opens a
 * transaction.** That is deliberate and it is not the usual "compose if you
 * like" optional-manager pattern used elsewhere in this codebase. Each of the
 * three catalogue writes wraps a *chain call* in its transaction so a failed
 * call rolls the Postgres side back (`specs/006-agent-catalogue/research.md`
 * R8) — the transaction boundary belongs to the service that knows what the
 * chain said, and a repository method that could quietly commit on its own
 * would be a way to opt out of that guarantee by accident.
 */
@Injectable()
export class AgentRepository {
  constructor(
    @InjectRepository(Agent)
    private readonly agents: Repository<Agent>,
    @InjectRepository(AgentVersion)
    private readonly versions: Repository<AgentVersion>,
  ) {}

  /**
   * Create an agent and its version 1 together.
   *
   * `onchain_agent_id` is left NULL: the escrow contract has not been called
   * yet, and it is the contract that assigns the id. The caller writes it back
   * with `setOnchainAgentId` once the receipt confirms, inside this same
   * transaction.
   *
   * ⚠️ **A row that reaches `COMMIT` with a NULL `onchain_agent_id` means the
   * registration outcome is *unknown*, never that it is pending.** Only a
   * receipt timeout can produce one — every knowable failure rolls this insert
   * back — and such an agent is filtered out of every buyer-facing query below.
   * See `agent.entity.ts` for why it must never be "retried".
   *
   * `active` is not a parameter. The column defaults to `true`, and accepting a
   * value here would make this the second authority on whether a brand-new
   * listing is live; `PATCH /agents/:id/active` is the first and only one.
   */
  async insertAgentWithFirstVersion(
    ownerAccountId: string,
    definition: VersionDefinition,
    definitionHash: Buffer,
    manager: EntityManager,
  ): Promise<NewAgentRows> {
    const agentRepo = manager.getRepository(Agent);
    const versionRepo = manager.getRepository(AgentVersion);

    const agent = await agentRepo.save(
      agentRepo.create({ ownerAccountId, onchainAgentId: null }),
    );

    const version = await versionRepo.save(
      versionRepo.create({ ...definition, agentId: agent.id, version: 1, definitionHash }),
    );

    return { agent, version };
  }

  /**
   * The agent row, locked for the duration of the caller's transaction, or
   * `null` if no such agent exists.
   *
   * `SELECT … FOR UPDATE` over one row of `agents`. Every write that is not a
   * creation passes through here first, and it buys two different things at
   * once:
   *
   *  1. **Version numbering.** `MAX(version) + 1` is a read-then-write race
   *     (spec FR-036). `UNIQUE (agent_id, version)` catches the collision, but
   *     it catches it *after* the loser has already called `updateAgent` — so
   *     the contract ends up holding the hash of a version that was never
   *     stored, and the failure surfaces as a constraint violation to a seller
   *     who did nothing wrong. The constraint is the backstop; this is the
   *     mechanism.
   *  2. **Toggle and publish serialisation.** Two `PATCH …/active` calls racing
   *     to opposite values would otherwise interleave their chain calls, and
   *     the last write to Postgres need not be the last write to the chain.
   *
   * ⚠️ The lock is held across a chain RPC — up to `RECEIPT_TIMEOUT_MS` (30 s).
   * That is deliberate and scale-bounded (R8): it is what makes "a failed chain
   * call records nothing" true without a compensation path. Contention is per
   * agent, so two sellers never block each other and one seller double-clicking
   * is exactly the case that must serialise. At real scale this would be an
   * outbox instead; at three agents it is free.
   */
  async findByIdWithLock(agentId: string, manager: EntityManager): Promise<Agent | null> {
    return manager.getRepository(Agent).findOne({
      where: { id: agentId },
      lock: { mode: 'pessimistic_write' },
    });
  }

  /**
   * Record the id the contract assigned.
   *
   * Written as a targeted `UPDATE … SET onchain_agent_id` rather than by
   * mutating and re-saving the entity, so this cannot become a path that
   * rewrites `active` or `created_at` as a side effect of whatever the caller
   * happened to be holding.
   *
   * The column carries a `UNIQUE` constraint, so writing an id that some other
   * row already claims fails loudly here rather than producing two database
   * agents pointing at one on-chain agent.
   */
  async setOnchainAgentId(
    agentId: string,
    onchainAgentId: number,
    manager: EntityManager,
  ): Promise<void> {
    await manager.getRepository(Agent).update({ id: agentId }, { onchainAgentId });
  }

  /** Flip availability. The chain has already agreed by the time this runs. */
  async setActive(agentId: string, active: boolean, manager: EntityManager): Promise<void> {
    await manager.getRepository(Agent).update({ id: agentId }, { active });
  }

  /**
   * The next version number for an agent.
   *
   * ⚠️ **Only meaningful inside `findByIdWithLock`'s transaction.** On its own
   * this is a read-then-write race: two concurrent publishes both see the same
   * `MAX(version)` and both try to write N+1. `UNIQUE (agent_id, version)`
   * catches that, but only after the loser has already sent `updateAgent` — see
   * the note on `findByIdWithLock`.
   *
   * `MAX` over an empty set is NULL, which cannot happen here (an agent always
   * has version 1) but is handled anyway rather than producing `NaN + 1`.
   */
  async nextVersionNumber(agentId: string, manager: EntityManager): Promise<number> {
    const row = await manager
      .createQueryBuilder(AgentVersion, 'v')
      .select('MAX(v.version)', 'max')
      .where('v.agent_id = :agentId', { agentId })
      .getRawOne<{ max: number | null }>();

    return (row?.max ?? 0) + 1;
  }

  /** Append a version. Insert only — `agent_versions` is never updated. */
  async insertVersion(
    agentId: string,
    version: number,
    definition: VersionDefinition,
    definitionHash: Buffer,
    manager: EntityManager,
  ): Promise<AgentVersion> {
    const repo = manager.getRepository(AgentVersion);

    return repo.save(repo.create({ ...definition, agentId, version, definitionHash }));
  }

  /**
   * The public catalogue: every buyable agent, as its latest version.
   *
   * ## The two filters are one clause, and it must never be applied by halves
   *
   * `a.active = true AND a.onchain_agent_id IS NOT NULL`. The first is the
   * seller's choice; the second is whether the agent exists on-chain at all.
   * Dropping the second parks an agent nobody can buy in the marketplace, where
   * it fails at `openDeal` — on a buyer's screen, after they have committed to
   * paying. Spec FR-021 is this line.
   *
   * ## Why `DISTINCT ON` rather than a join and a loop
   *
   * "Each agent's latest version" is a greatest-per-group problem, and
   * `DISTINCT ON` is Postgres's direct answer: it keeps the first row per
   * `agent_id` under the given `ORDER BY`, so ordering by `version DESC` inside
   * each group yields the current definition in one round trip. Fetching agents
   * and then their versions is the N+1 that looks fine with three rows and is a
   * habit worth not forming.
   *
   * ⚠️ **`DISTINCT ON`'s leading `ORDER BY` expressions must match its
   * argument**, which is why the sort starts with `v.agent_id` even though
   * nothing wants that ordering. Any presentation ordering has to be applied
   * after the fact — which is why there is none here; the catalogue is three
   * cards and `docs/CONTEXT.md` §6 puts sorting out of scope.
   *
   * ## The column list is a security control, not tidiness
   *
   * `system_prompt`, `model` and `timeout_seconds` are absent, so on a public
   * read the prompt never enters the process. This is layer 1 of the boundary
   * (`agent-serialiser.ts`) — the only layer that also covers a log line or a
   * stack trace, neither of which passes through a serialiser.
   */
  async findPublicListings(): Promise<PublicListingRow[]> {
    return this.selectListings()
      .where('a.active = true')
      .andWhere('a.onchain_agent_id IS NOT NULL')
      .getRawMany<PublicListingRow>();
  }

  /**
   * One agent's public listing, or `null`.
   *
   * Carries the identical filter to `findPublicListings`, which is what makes
   * an inactive or unregistered agent a `404` rather than a visible-but-broken
   * listing — a listing that can be seen is a listing that can be bought
   * (FR-022). The two conditions are repeated rather than shared through a
   * helper so that a future edit to one is visibly not an edit to the other.
   */
  async findPublicListing(agentId: string): Promise<PublicListingRow | null> {
    const row = await this.selectListings()
      .where('a.id = :agentId', { agentId })
      .andWhere('a.active = true')
      .andWhere('a.onchain_agent_id IS NOT NULL')
      .getRawOne<PublicListingRow>();

    return row ?? null;
  }

  /**
   * The seller's own agents — **all of them**.
   *
   * ⚠️ **Both public filters are deliberately absent, and reusing them here is
   * the one-way-toggle bug.** The public list is active-only; applying that to
   * an owner's list means switching an agent off removes it from the only
   * screen that could switch it back on, and the availability toggle becomes a
   * one-way door (spec FR-039; `ui/specs/007-seller-pages` quickstart D8 checks
   * this from the other side). The `onchain_agent_id` filter is absent for the
   * matching reason: this list is the only place a failed registration is
   * visible to anyone (FR-026).
   *
   * Scoped by `owner_account_id` in the SQL rather than filtered afterwards, so
   * there is no code path in which an unscoped result exists in memory. The
   * parameter is required, so this method cannot accidentally run unscoped.
   */
  async findOwnedListings(ownerAccountId: string): Promise<OwnedListingRow[]> {
    return this.selectListings()
      .addSelect('a.active', 'active')
      .addSelect('a.onchain_agent_id', 'onchainAgentId')
      .where('a.owner_account_id = :ownerAccountId', { ownerAccountId })
      .getRawMany<OwnedListingRow>();
  }

  /**
   * Every version of an agent the caller owns, newest first, in full.
   *
   * **The one query in this class that selects `system_prompt`**, serving the
   * one route that may return it. Ownership is in the `WHERE` rather than
   * checked afterwards, so "not yours" and "does not exist" both come back as
   * `[]` and the caller cannot accidentally render one as the other — which is
   * what stops the route becoming an existence oracle (FR-029).
   *
   * Returns entities rather than raw rows, because the caller needs the
   * `bigintTransformer` on `price_minor` and the `Buffer` on `definition_hash`
   * that TypeORM applies on hydration.
   */
  async findVersionsForOwner(
    agentId: string,
    ownerAccountId: string,
  ): Promise<AgentVersion[]> {
    return this.versions
      .createQueryBuilder('v')
      .innerJoin(Agent, 'a', 'a.id = v.agent_id')
      .where('v.agent_id = :agentId', { agentId })
      .andWhere('a.owner_account_id = :ownerAccountId', { ownerAccountId })
      .orderBy('v.version', 'DESC')
      .getMany();
  }

  /**
   * The shared `DISTINCT ON` skeleton behind the three listing queries.
   *
   * Raw selection rather than entity hydration, because the result is one row
   * spanning two tables and TypeORM's `getMany` would want a relation to hang
   * the agent columns off. `price_minor` therefore arrives as a string from the
   * `pg` driver — `bigint` exceeds `Number.MAX_SAFE_INTEGER` so the driver will
   * not guess — and is converted once, in `agents.service.ts`, at the boundary.
   * ⚠️ Skipping that conversion makes arithmetic on a price string-concatenate.
   */
  private selectListings(): SelectQueryBuilder<AgentVersion> {
    return this.versions
      .createQueryBuilder('v')
      .innerJoin(Agent, 'a', 'a.id = v.agent_id')
      .distinctOn(['v.agent_id'])
      // The column list IS the boundary's first layer. Nothing from the
      // execution spec appears here.
      .select('a.id', 'agentId')
      .addSelect('v.name', 'name')
      .addSelect('v.description', 'description')
      .addSelect('v.price_minor', 'priceMinor')
      .addSelect('v.capabilities', 'capabilities')
      .addSelect('v.exclusions', 'exclusions')
      .addSelect('v.input_schema', 'inputSchema')
      .addSelect('v.output_schema', 'outputSchema')
      .addSelect('v.version', 'version')
      // Must lead with the DISTINCT ON expression; `version DESC` picks the
      // current definition within each agent.
      .orderBy('v.agent_id')
      .addOrderBy('v.version', 'DESC');
  }
}

/**
 * One raw row from the listing queries.
 *
 * ⚠️ `priceMinor` is a **string** — `SELECT` on a `bigint` column comes back
 * from the `pg` driver unconverted, because the driver cannot know the value
 * fits in a JS number. Typed honestly here so the conversion cannot be
 * forgotten silently; `agents.service.ts` performs it once.
 */
export interface PublicListingRow {
  agentId: string;
  name: string;
  description: string;
  priceMinor: string;
  capabilities: string[];
  exclusions: string[];
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  version: number;
}

/** A listing row plus the two availability facts only its owner sees. */
export interface OwnedListingRow extends PublicListingRow {
  active: boolean;
  /** `null` means the registration outcome is unknown — see `agent.entity.ts`. */
  onchainAgentId: string | null;
}
