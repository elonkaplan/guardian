import { Controller, Get } from '@nestjs/common';

import { CurrentAccount } from '../auth/current-account.decorator';
import { Account } from '../entities/account.entity';
import { AccountsService } from './accounts.service';
import type { AccountSummaryResponse } from './dto/account-summary.dto';
import type { LedgerEntryResponse } from './dto/ledger-entry.dto';

/**
 * The two reads the wallet screen is built on.
 *
 * `@Controller()` carries **no prefix** on purpose: the routes are `/me` and
 * `/me/ledger` at the root, exactly as
 * `specs/005-accounts-ledger-funding/contracts/internal-api.md` §1 and §2
 * declare them and exactly as `ui/specs/006-wallet-page/` already calls them.
 * An `accounts` prefix would be tidier and would 404 every request the UI
 * makes.
 *
 * **No `@Public()` anywhere in this file, and its absence is the security
 * control.** The global `JwtAuthGuard` is fail-closed, so a route is protected
 * by saying nothing — both of these carry an account's money and neither is
 * open. Nothing here reads the `Authorization` header or decodes a token
 * either; `@CurrentAccount()` is the whole contract with `auth/`.
 *
 * **This is the `/me` that `GET /auth/session` deliberately is not.** That
 * endpoint answers the narrow question a client asks on load — is my stored
 * token still good, and whose is it — and stops there, on purpose, so the guard
 * has a witness that does not drag in the money model. These two carry the
 * money model. Two endpoints, two questions; collapsing them would put a
 * Postgres sum and a chain read behind every "am I still signed in?".
 *
 * Neither handler takes a parameter of any kind. The account is the session's,
 * never the caller's to name — a route that accepted an account id would let
 * anyone read anyone's balance and statement.
 */
@Controller()
export class AccountsController {
  constructor(private readonly accounts: AccountsService) {}

  /**
   * The account and its three money figures.
   *
   * The hottest endpoint in the product — polled every 5 s by the balance
   * widget on every page. It returns `200` even when the chain is unreachable,
   * with `settledFundsMinor: null`; only a Postgres failure may fail it. See
   * `AccountsService.getSummary`.
   */
  @Get('me')
  getMe(@CurrentAccount() account: Account): Promise<AccountSummaryResponse> {
    return this.accounts.getSummary(account);
  }

  /**
   * The full statement, newest first. `[]` for an account with no movements —
   * not a `404`.
   *
   * The sum of `amountMinor` over this list equals `availableBalanceMinor` from
   * `GET /me`. That is the contract between the two handlers on this class; if
   * it ever fails to hold, one of them is wrong.
   */
  @Get('me/ledger')
  getLedger(
    @CurrentAccount() account: Account,
  ): Promise<LedgerEntryResponse[]> {
    return this.accounts.getStatement(account);
  }
}
