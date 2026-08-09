import {
  Check,
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Account } from './account.entity';
import { AgentVersion } from './agent-version.entity';
import { OrderState } from './enums';
import { bigintTransformer } from './transformers';

/**
 * One row per purchase.
 *
 * `orders.state` is also the work queue — no Redis, no BullMQ; a cron
 * reaper catches anything stuck.
 */
@Entity('orders')
@Index('orders_sweeper_idx', ['state', 'deliveredAt'])
@Index('orders_undelivered_idx', ['state', 'createdAt'])
@Index('orders_buyer_idx', ['buyerAccountId', 'createdAt'])
@Check('orders_price_minor_check', '"price_minor" > 0')
@Check('orders_review_window_seconds_check', '"review_window_seconds" > 0')
export class Order {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /**
   * NULL = submitted, not yet confirmed on-chain. Set once `openDeal`
   * confirms.
   */
  @Column({
    type: 'bigint',
    name: 'onchain_deal_id',
    unique: true,
    nullable: true,
    transformer: bigintTransformer,
  })
  onchainDealId!: number | null;

  @Column({ type: 'uuid', name: 'buyer_account_id' })
  buyerAccountId!: string;

  @ManyToOne(() => Account)
  @JoinColumn({
    name: 'buyer_account_id',
    foreignKeyConstraintName: 'orders_buyer_account_id_fkey',
  })
  buyerAccount!: Account;

  /**
   * ⚠️ Points at a specific VERSION, never at an agent. There is
   * deliberately NO `agentId` column here, and adding one would be a
   * defect rather than a convenience — pinning to the version is what
   * makes "judged against the definition that actually ran" true by
   * construction rather than by discipline. Reaching the agent is
   * `order → agentVersion → agent`.
   */
  @Column({ type: 'uuid', name: 'agent_version_id' })
  agentVersionId!: string;

  @ManyToOne(() => AgentVersion)
  @JoinColumn({
    name: 'agent_version_id',
    foreignKeyConstraintName: 'orders_agent_version_id_fkey',
  })
  agentVersion!: AgentVersion;

  /**
   * SNAPSHOT taken at purchase, not a live read — a seller editing their
   * listing after a sale cannot change what the sale was for. The
   * migration enforces `CHECK (price_minor > 0)`.
   */
  @Column({
    type: 'bigint',
    name: 'price_minor',
    transformer: bigintTransformer,
  })
  priceMinor!: number;

  /** Free text supplied by the buyer. */
  @Column({ type: 'text', name: 'acceptance_criteria' })
  acceptanceCriteria!: string;

  /**
   * This column is also the work queue — no Redis, no BullMQ; a cron
   * reaper catches anything stuck.
   */
  @Column({
    type: 'enum',
    enum: OrderState,
    enumName: 'order_state',
    name: 'state',
    default: OrderState.Purchased,
  })
  state!: OrderState;

  /**
   * SNAPSHOT taken at purchase, not a live read — a seller editing their
   * listing after a sale cannot change what the sale was for. The
   * migration enforces `CHECK (review_window_seconds > 0)`; a zero review
   * window would collapse the dispute window entirely.
   */
  @Column({ type: 'int', name: 'review_window_seconds' })
  reviewWindowSeconds!: number;

  @Column({ type: 'timestamptz', name: 'created_at', default: () => 'now()' })
  createdAt!: Date;

  @Column({ type: 'timestamptz', name: 'delivered_at', nullable: true })
  deliveredAt!: Date | null;

  @Column({ type: 'timestamptz', name: 'disputed_at', nullable: true })
  disputedAt!: Date | null;

  @Column({ type: 'timestamptz', name: 'settled_at', nullable: true })
  settledAt!: Date | null;
}
