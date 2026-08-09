import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { getAddress, type Address } from 'viem';

import { Account } from '../entities/account.entity';

/**
 * The only thing in the backend that creates an account, and the only thing
 * that resolves a wallet address to one.
 *
 * Two rules live here, and both are load-bearing in a way that is invisible
 * until money moves:
 *
 * **Write canonical.** Every address stored is the output of viem's
 * `getAddress()` — EIP-55 checksummed, mixed case. That column is not just an
 * identity; it is the payout address for every refund and every sale this
 * account will ever receive. A mangled address here does not fail loudly, it
 * fails months later as "my money went nowhere".
 *
 * **Read case-insensitively.** Uniqueness is enforced by a FUNCTIONAL index,
 * `accounts_wallet_lower_idx ON accounts (lower(wallet_address))`, because a
 * plain unique index on the column would be case-sensitive and would happily
 * let 0xAbC… and 0xabc… register as two separate accounts — two balances, two
 * histories, one confused user. See the long comment in
 * `src/entities/account.entity.ts` for why the index cannot be a decorator.
 *
 * The two rules are why the queries below are written the way they are. This
 * class is also deliberately in `accounts/` rather than `auth/`: `auth` owns
 * signing in, `accounts` owns the account (docs/CONTEXT.md §3), and API-05
 * builds `/me`, balance, and the ledger on exactly these methods.
 */
@Injectable()
export class AccountRepository {
  constructor(
    @InjectRepository(Account)
    private readonly accounts: Repository<Account>,
  ) {}

  /**
   * Resolve a wallet address to its account, creating one if this is the first
   * time the platform has seen it. Connecting a wallet is the entire
   * registration flow — there is no separate sign-up to call.
   *
   * One method rather than a `find` and a `create` the caller composes: a
   * caller able to invoke them separately is a caller able to invoke them in
   * the wrong order, and the wrong order here means a duplicate account.
   *
   * The caller cannot tell whether this created or found, and does not need
   * to. `/auth/verify` deliberately returns nothing that reveals it either.
   *
   * @throws if `address` is not a valid address — `getAddress()` rejects it
   * rather than storing something unusable. Callers validate the shape at the
   * HTTP boundary, so reaching this throw means a bug, not bad input.
   */
  async findOrCreateByAddress(address: Address): Promise<Account> {
    const canonical = getAddress(address);

    const existing = await this.findByAddress(canonical);
    if (existing !== null) {
      return existing;
    }

    // No retry-on-unique-violation, and that is a decision rather than an
    // omission. Two concurrent first-time creations for one address would race
    // on `accounts_wallet_lower_idx`, but they cannot happen: an address holds
    // at most one outstanding sign-in challenge, and consuming it is atomic, so
    // at most one verify per address is ever past the signature check.
    return this.accounts.save(
      this.accounts.create({ walletAddress: canonical }),
    );
  }

  /**
   * The account for an address, or `null`. Matching ignores letter casing.
   *
   * ⚠️ The `lower(...)` on both sides is not defensive styling — it is what
   * makes this query use `accounts_wallet_lower_idx`. Rewriting it as the
   * obvious `findOne({ where: { walletAddress } })` breaks two things at once:
   * the comparison becomes case-sensitive (so a lowercased address looks like a
   * new user and gets a second account), and the query can no longer use the
   * functional index (so it sequential-scans). Neither failure is visible in a
   * passing request.
   */
  async findByAddress(address: Address): Promise<Account | null> {
    return this.accounts
      .createQueryBuilder('account')
      .where('lower(account.wallet_address) = :lower', {
        lower: address.toLowerCase(),
      })
      .getOne();
  }

  /**
   * The account behind a session token's `sub` claim, or `null`.
   *
   * Returns `null` rather than throwing because absence is not this class's
   * business to interpret. The guard treats it as "refuse the request"; a
   * future caller might treat it as "this row was cleaned up". The repository
   * reports what it found.
   *
   * The auth guard calls this on every protected request, which is the price of
   * refusing a token whose account no longer exists. It is a primary-key lookup
   * and it is deliberately not cached — a cache here would be a mechanism for
   * continuing to honour a deleted account.
   */
  async findById(id: string): Promise<Account | null> {
    return this.accounts.findOne({ where: { id } });
  }
}
