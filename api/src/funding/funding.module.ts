import { Module } from '@nestjs/common';

import { AccountsModule } from '../accounts/accounts.module';
import { ChainModule } from '../chain/chain.module';
import { LedgerModule } from '../ledger/ledger.module';
import { FundingController } from './funding.controller';
import { FundingService } from './funding.service';

/**
 * `POST /topup`, `POST /withdraw`, `POST /offramp` — the three flows that move
 * money across the platform's edge.
 *
 * The three imports are the three collaborators, one per thing this module
 * cannot do itself, and each stays in the module that owns it
 * (`docs/CONTEXT.md` §3):
 *
 * - `ChainModule` → `TokenTransferService` (funder ⇄ pool),
 *   `EscrowOperatorService.withdrawFor`, and `EscrowReadService` for the settled
 *   balance and the explorer link. ⚠️ It exports **services and never its viem
 *   clients** — the funder key is reachable only through two named methods, and
 *   `FUNDER_CLIENT` is deliberately absent from that export list so this module
 *   cannot name `approve`, or anything on any other ABI. Importing this module
 *   buys typed access to four operations, not a signing key.
 * - `LedgerModule` → `LedgerRepository` for the `onramp` credit, the `offramp`
 *   debit and the compensating `adjustment`. The writes live there rather than
 *   here because the ledger is not this feature's private table — API-06's
 *   `purchase` debit goes through the same `appendEntry`, and the append-only
 *   invariant (#4) is only enforceable while every writer passes through one
 *   class that has no `UPDATE` in it.
 * - `AccountsModule` → `AccountsService.getSummary`, so `/topup` and `/offramp`
 *   answer with the *same* object `GET /me` returns. Re-assembling those three
 *   figures here would be a second implementation of the money model, and the
 *   symptom of the two disagreeing is a balance that changes when the page
 *   refreshes.
 *
 * **Nothing is exported, and nothing should be.** `FundingService` has exactly
 * one caller — the controller in this folder. A module that exports its service
 * invites another feature to move money without going through the route that
 * validates the amount and maps the refusals; if a future flow needs to top an
 * account up, the thing to share is `LedgerRepository`, which is already shared.
 *
 * No `TypeOrmModule.forFeature` either: this module owns no table. Every row it
 * writes belongs to `ledger_entries`, and `ledger/` owns that.
 */
@Module({
  imports: [ChainModule, LedgerModule, AccountsModule],
  controllers: [FundingController],
  providers: [FundingService],
})
export class FundingModule {}
