import {
  Column,
  Entity,
  JoinColumn,
  OneToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Order } from './order.entity';

/**
 * The evidence. Exactly one row per order.
 */
@Entity('runs')
export class Run {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /**
   * UNIQUE: exactly one execution per purchase. The constraint exists
   * precisely so that a well-meaning retry cannot destroy the
   * non-delivery evidence described on `output` below. No retries in the
   * MVP, so the database makes that a guarantee rather than a convention.
   */
  @Column({ type: 'uuid', name: 'order_id', unique: true })
  orderId!: string;

  @OneToOne(() => Order)
  @JoinColumn({
    name: 'order_id',
    foreignKeyConstraintName: 'runs_order_id_fkey',
  })
  order!: Order;

  /** What the buyer supplied. */
  @Column({ type: 'jsonb', name: 'input' })
  input!: Record<string, unknown>;

  /**
   * ⚠️ NULL IS THE NON-DELIVERY EVIDENCE, not an error. It is how
   * non-delivery is proven to Guardian. Never retry over it, never clean
   * it up, and never default it to `{}`.
   */
  @Column({ type: 'jsonb', name: 'output', nullable: true })
  output!: Record<string, unknown> | null;

  /**
   * Reasoning turns, tool calls, retries. This is what lets Guardian
   * distinguish "genuinely tried" from "returned a stub". It can be
   * large; Postgres TOASTs it automatically and the schema imposes no
   * ceiling.
   */
  @Column({
    type: 'jsonb',
    name: 'steps',
    default: () => "'[]'",
  })
  steps!: unknown[];

  @Column({ type: 'text', name: 'error', nullable: true })
  error!: string | null;

  /** NULL means not yet checked. */
  @Column({ type: 'boolean', name: 'output_valid', nullable: true })
  outputValid!: boolean | null;

  @Column({ type: 'timestamptz', name: 'started_at', default: () => 'now()' })
  startedAt!: Date;

  @Column({ type: 'timestamptz', name: 'finished_at', nullable: true })
  finishedAt!: Date | null;

  /** Supports "delivered late" shortfalls. */
  @Column({ type: 'int', name: 'duration_ms', nullable: true })
  durationMs!: number | null;
}
