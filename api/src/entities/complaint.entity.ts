import { Column, Entity, JoinColumn, OneToOne, PrimaryGeneratedColumn } from 'typeorm';

import { Order } from './order.entity';

/**
 * The buyer's stated reason for disputing an order.
 *
 * `order_id` is UNIQUE: one complaint per order. "No amendments, no
 * re-filing" becomes a database guarantee rather than an API check that
 * someone eventually forgets.
 */
@Entity('complaints')
export class Complaint {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', name: 'order_id', unique: true })
  orderId!: string;

  @OneToOne(() => Order)
  @JoinColumn({
    name: 'order_id',
    foreignKeyConstraintName: 'complaints_order_id_fkey',
  })
  order!: Order;

  /** The buyer's stated reason. */
  @Column({ type: 'text', name: 'reason' })
  reason!: string;

  @Column({ type: 'timestamptz', name: 'created_at', default: () => 'now()' })
  createdAt!: Date;
}
