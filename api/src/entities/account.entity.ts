import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

/**
 * One row per registered wallet. No role column — the same account both buys
 * and sells.
 */
@Entity('accounts')
export class Account {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /**
   * Stored CHECKSUMMED (mixed case preserved) — this is both the account's
   * identity and its payout address.
   *
   * ⚠️ Deliberately NO unique constraint and NO @Index here. Uniqueness is
   * enforced by a FUNCTIONAL unique index created in the migration:
   *   CREATE UNIQUE INDEX accounts_wallet_lower_idx ON accounts (lower(wallet_address));
   * A plain `@Index({ unique: true })` on this column would be CASE-SENSITIVE
   * and would let 0xAbC... and 0xabc... both register as separate accounts —
   * exactly the bug the functional index exists to prevent.
   *
   * TypeORM cannot express functional indexes, so `migration:generate` may
   * propose dropping `accounts_wallet_lower_idx`. That output is expected and
   * must NOT be applied.
   */
  @Column({ type: 'text', name: 'wallet_address' })
  walletAddress!: string;

  @Column({ type: 'timestamptz', name: 'created_at', default: () => 'now()' })
  createdAt!: Date;
}
