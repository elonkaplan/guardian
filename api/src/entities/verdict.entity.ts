import {
  Check,
  Column,
  Entity,
  JoinColumn,
  OneToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';

import { Order } from './order.entity';
import { bigintTransformer } from './transformers';
import { VerdictTier } from './enums';

/**
 * Guardian's ruling on a disputed order.
 *
 * Persisting the verdict is what makes the demo replayable — a re-run
 * displays the stored verdict rather than re-auditing, which removes
 * live-model variance from the stage. This matters because Opus 5 exposes
 * no `temperature` parameter, so verdicts cannot be made reproducible by
 * sampling control; they are reproducible by being stored.
 */
@Entity('verdicts')
@Check('verdicts_refund_minor_check', '"refund_minor" >= 0')
export class Verdict {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /**
   * One verdict per order — there are NO appeals.
   */
  @Column({ type: 'uuid', name: 'order_id', unique: true })
  orderId!: string;

  @OneToOne(() => Order)
  @JoinColumn({
    name: 'order_id',
    foreignKeyConstraintName: 'verdicts_order_id_fkey',
  })
  order!: Order;

  @Column({
    type: 'enum',
    name: 'tier',
    enum: VerdictTier,
    enumName: 'verdict_tier',
  })
  tier!: VerdictTier;

  /**
   * Whole USD cents, computed from tier × price. The migration enforces
   * CHECK (refund_minor >= 0) — note >= and not >, because a `none` verdict
   * legitimately refunds nothing.
   */
  @Column({
    type: 'bigint',
    name: 'refund_minor',
    transformer: bigintTransformer,
  })
  refundMinor!: number;

  /** Human-readable reasoning. */
  @Column({ type: 'text', name: 'reasoning' })
  reasoning!: string;

  /** Which promise / exclusion / criterion, and whether it was met. */
  @Column({
    type: 'jsonb',
    name: 'citations',
    default: () => "'[]'",
  })
  citations!: unknown[];

  /**
   * Raw bytes, not a hex string — anchored on-chain by the escrow
   * contract's resolve(). Hex conversion belongs in the chain adapter.
   */
  @Column({ type: 'bytea', name: 'verdict_hash' })
  verdictHash!: Buffer;

  /** e.g. 'claude-opus-5'. Recorded for reproducibility. */
  @Column({ type: 'text', name: 'model' })
  model!: string;

  /** The demo's clickable proof. */
  @Column({ type: 'text', name: 'onchain_tx_hash', nullable: true })
  onchainTxHash!: string | null;

  @Column({ type: 'timestamptz', name: 'created_at', default: () => 'now()' })
  createdAt!: Date;
}
