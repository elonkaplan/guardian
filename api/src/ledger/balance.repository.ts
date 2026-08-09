import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { LedgerEntry } from '../entities/ledger-entry.entity';

/**
 * Reads platform balances off the append-only ledger.
 *
 * There is no cached balance column anywhere in the schema, deliberately: at
 * demo scale the SUM is free, and a cached total is a whole class of drift bug
 * bought for nothing. Every cent traces back to the entry that produced it.
 */
@Injectable()
export class BalanceRepository {
  constructor(
    @InjectRepository(LedgerEntry)
    private readonly entries: Repository<LedgerEntry>,
  ) {}

  /**
   * The signed sum of an account's ledger entries, in whole USD cents.
   *
   * Returns **0**, never null, for an account with no entries — the COALESCE is
   * part of the contract rather than an optimisation. "This account has
   * nothing" and "this account does not exist" are different facts, and only
   * the first one is true here; callers that need existence ask `accounts`.
   *
   * The result may be negative if the entries say so. This method reports a
   * number; it does not judge whether that number is allowed.
   */
  async getAvailableBalanceMinor(accountId: string): Promise<number> {
    const row = await this.entries
      .createQueryBuilder('e')
      .select('COALESCE(SUM(e.amount_minor), 0)', 'total')
      .where('e.account_id = :accountId', { accountId })
      .getRawOne<{ total: string }>();

    // SUM(bigint) comes back as `numeric`, which the driver hands over as a
    // string. Convert once, here, at the boundary — the same reason the entity
    // columns carry bigintTransformer.
    return Number(row?.total ?? 0);
  }
}
