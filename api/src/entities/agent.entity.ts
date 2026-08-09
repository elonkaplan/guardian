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
   * NULL means "submitted, not yet confirmed" — an honest state, not an
   * error. A row exists BEFORE its on-chain `registerAgent` transaction
   * lands, and NULL is what makes the retry query
   * `WHERE onchain_agent_id IS NULL` trivial.
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
