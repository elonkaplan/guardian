import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Account } from './account.entity';
import { bigintTransformer } from './transformers';

/**
 * One row per listed agent.
 *
 * Holds NOTHING a buyer sees — all presentation (name, description,
 * capabilities, pricing, prompts, schemas, ...) lives on `AgentVersion`, so
 * nothing shown to a buyer can change without producing a new version.
 *
 * There is deliberately no `current_version` column: it is `MAX(version)`
 * over `agent_versions`, and a denormalisation that can drift is not worth
 * the read it saves.
 */
@Entity('agents')
@Index('agents_owner_idx', ['ownerAccountId'])
export class Agent {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** The seller. */
  @Column({ type: 'uuid', name: 'owner_account_id' })
  ownerAccountId!: string;

  @ManyToOne(() => Account)
  @JoinColumn({
    name: 'owner_account_id',
    foreignKeyConstraintName: 'agents_owner_account_id_fkey',
  })
  ownerAccount!: Account;

  /**
   * Assigned by the contract, recovered from the `AgentRegistered` log.
   *
   * ⚠️ **NULL means the outcome is UNKNOWN, not pending.** `POST /agents` is
   * synchronous: it awaits the receipt and returns with this set. Every
   * registration failure that is *knowable* — a revert, insufficient funds, an
   * exhausted gas ceiling — rolls the whole insert back, so no row survives it.
   * The one thing that leaves a row here is `ChainOutcomeUnknownError`, a
   * receipt timeout, where the transaction may still confirm afterwards and
   * deleting the row would orphan a live on-chain agent with no record of it
   * anywhere.
   *
   * An agent in this state is **not purchasable** and is filtered out of every
   * buyer-facing view — `GET /agents` and `GET /agents/:id` both require this
   * column to be non-NULL. It is visible only to its owner, via
   * `GET /agents?owner=me`, flagged `listed: false`.
   *
   * ⚠️ **Never "retry" one of these by calling `registerAgent` again.** It is
   * not a retry: the contract assigns a NEW id, and the seller ends up owning
   * two on-chain agents, one of them unreachable and one attached to a row that
   * may now disagree with it. Reconciliation means matching `AgentRegistered`
   * logs against the stored `definition_hash`, which is why both hashes are
   * logged at error level when this state is written.
   *
   * (`specs/006-agent-catalogue/research.md` R8)
   */
  @Column({
    type: 'bigint',
    name: 'onchain_agent_id',
    nullable: true,
    unique: true,
    transformer: bigintTransformer,
  })
  onchainAgentId!: number | null;

  /** Mirrors the contract's `setAgentActive`. */
  @Column({ type: 'boolean', name: 'active', default: true })
  active!: boolean;

  @Column({ type: 'timestamptz', name: 'created_at', default: () => 'now()' })
  createdAt!: Date;
}
