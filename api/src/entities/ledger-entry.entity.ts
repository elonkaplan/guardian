import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Account } from './account.entity';
import { Order } from './order.entity';
import { LedgerKind } from './enums';
import { bigintTransformer } from './transformers';

/**
 * One row per movement of platform balance. This table is APPEND-ONLY.
 *
 * A balance is `SUM(amount_minor)` — there is no cached balance column on
 * this or any other table, deliberately, because a cached total that drifts
 * from its history is a brutal thing to debug. Corrections are new rows of
 * kind `adjustment`, never edits.
 */
@Entity('ledger_entries')
@Index('ledger_account_idx', ['accountId', 'createdAt'])
export class LedgerEntry {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', name: 'account_id' })
  accountId!: string;

  @ManyToOne(() => Account)
  @JoinColumn({
    name: 'account_id',
    foreignKeyConstraintName: 'ledger_entries_account_id_fkey',
  })
  account!: Account;

  /** SIGNED — credits positive, debits negative. Whole USD cents. */
  @Column({
    type: 'bigint',
    name: 'amount_minor',
    transformer: bigintTransformer,
  })
  amountMinor!: number;

  @Column({
    type: 'enum',
    enum: LedgerKind,
    enumName: 'ledger_kind',
    name: 'kind',
  })
  kind!: LedgerKind;

  /** Set on 'purchase'. */
  @Column({ type: 'uuid', name: 'order_id', nullable: true })
  orderId!: string | null;

  @ManyToOne(() => Order)
  @JoinColumn({
    name: 'order_id',
    foreignKeyConstraintName: 'ledger_entries_order_id_fkey',
  })
  order!: Order | null;

  /** A transfer id or an on-chain tx hash. */
  @Column({ type: 'text', name: 'external_ref', nullable: true })
  externalRef!: string | null;

  @Column({ type: 'timestamptz', name: 'created_at', default: () => 'now()' })
  createdAt!: Date;
}
