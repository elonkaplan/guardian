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
   * The escrow contract's id for this order's deal. Set once `openDeal`
   * confirms.
   *
   * ⚠️ **NULL means two different things, and `state` is what tells them
   * apart.** Reading it as one thing is how a buyer ends up seeing the same
   * money in two figures at once.
   *
   * | `state` | NULL means | What is true of the money |
   * | --- | --- | --- |
   * | `purchased` | mid-saga, **or** the receipt never arrived | It may well be escrowed. Left alone; the confirmation-retry job (API-10) owns it |
   * | `failed` | the `openDeal` call was refused | Nothing was ever escrowed, and the compensating `adjustment` has already restored the balance |
   *
   * The second row is written **only** by the purchase saga's knowable-failure
   * branch, which is what makes `state = 'failed' AND onchain_deal_id IS NULL`
   * an exact test for "this purchase was compensated" rather than a heuristic —
   * see `orders/escrow-exposure.repository.ts`.
   *
   * Note that `failed` with the id **set** is a third, unrelated situation: the
   * agent ran and produced nothing (API-08). That money *is* in escrow.
   *
   * ⚠️ **Never retry `openDeal` against a NULL id.** The contract assigns a new
   * deal on every call, so a "retry" against a transaction that later confirms
   * leaves two deals escrowing two prices for one order. It is the same trap
   * `agent.entity.ts` documents for `registerAgent`, except this one has a
   * buyer's money in it. Recovery is by looking the logged tx hash up and
   * writing the id that transaction actually produced.
   *
   * (`specs/007-orders-purchase-saga/research.md` R3, R14)
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

  /**
   * The buyer's input, validated at purchase against the pinned version's
   * `input_schema`.
   *
   * ⚠️ **Distinct from `runs.input`, and not a duplicate of it.** This is what
   * the buyer *paid for*; `runs.input` is what was *actually sent* to the agent.
   * They will hold the same document in the MVP. They are separate because the
   * case file quotes **this** one, which is what lets an order that never ran —
   * or whose escrow call was refused — still show what was asked for.
   *
   * ⚠️ Do not "simplify" this away by writing the `runs` row at purchase time
   * instead. `runs.output IS NULL` is the non-delivery evidence (invariant #7),
   * so a run row that exists before execution starts makes every pending order
   * indistinguishable from a crashed one. See the migration
   * `1786320000000-OrderInput.ts` for the whole argument.
   */
  @Column({ type: 'jsonb', name: 'input' })
  input!: Record<string, unknown>;

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
