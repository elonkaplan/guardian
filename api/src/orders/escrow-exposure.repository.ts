import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Order } from '../entities/order.entity';
import { ESCROWED_ORDER_STATES } from './order-states';

/**
 * How much of a buyer's money is currently locked in the escrow contract.
 *
 * One method, and it is a read of `orders` rather than a read of the chain on
 * purpose. Asking the escrow for `deals[].amount` per order would put N RPC
 * calls on the hottest endpoint in the product and re-introduce exactly the
 * failure mode `SETTLED_FUNDS_TIMEOUT_MS` exists to contain — for a number
 * Postgres already knows. `totalEscrowed()` is the wrong number entirely: it is
 * the platform-wide total, not this buyer's share. (research R3)
 */
@Injectable()
export class EscrowExposureRepository {
  constructor(
    @InjectRepository(Order)
    private readonly orders: Repository<Order>,
  ) {}

  /**
   * The summed `price_minor` of this buyer's open orders, in whole USD cents.
   *
   * Returns **0**, never null, for a buyer with no open orders — the COALESCE
   * is part of the contract rather than an optimisation, for the same reason
   * `BalanceRepository.getAvailableBalanceMinor` gives: "this buyer has nothing
   * escrowed" and "this buyer does not exist" are different facts, and only the
   * first one is being reported here. Callers that need existence ask
   * `accounts`.
   *
   * The price is the snapshot taken at purchase (`orders.price_minor`), which
   * is the amount that actually entered escrow — a seller who edits their
   * listing afterwards cannot move this figure.
   *
   * ⚠️ **Never add `AND onchain_deal_id IS NOT NULL`.**
   * It reads like a safety check and it is a money-losing bug. An order can
   * legitimately exist with a `purchase` ledger debit already written and a
   * null deal id — that is precisely what invariant #1's Postgres-first
   * ordering produces mid-saga, and it is the correct ordering, not a race to
   * be tightened away. The cents have already left `availableBalanceMinor`, so
   * they must appear *somewhere*; escrow is where they are going and the only
   * honest place to show them. Filtering on a confirmed deal id would make that
   * money disappear from BOTH figures for the width of the saga — the user
   * watches their balance drop and nothing rise. (research R3)
   *
   * API-07 made that row shape not merely possible but a **resting state**: an
   * `openDeal` whose receipt never arrived leaves the order in `purchased` with
   * a null deal id and no compensation, because the transaction may still
   * confirm (`specs/007-orders-purchase-saga/research.md` R3). The warning above
   * is therefore stronger now than when it was written.
   *
   * ---
   *
   * ## ⚠️ The one exclusion, and why it is NOT the predicate above
   *
   * `state = 'failed'` covers two situations that share a word and nothing else,
   * and `onchain_deal_id` is the only thing that separates them:
   *
   * | | deal id | Tokens escrowed | Ledger |
   * | --- | --- | --- | --- |
   * | The agent ran and produced nothing | **set** | ✅ yes, until the reclaimer sweeps | debit only |
   * | `openDeal` was refused (API-07) | **NULL** | ❌ no — nothing was ever locked | debit **+ compensating credit** |
   *
   * The second must not be counted. Its compensating `adjustment` has already
   * put the money back into `availableBalanceMinor`, so counting it here would
   * show the buyer the same cents in two figures at once. Hence
   * `NOT (state = 'failed' AND onchain_deal_id IS NULL)`.
   *
   * **That is a narrower predicate than the forbidden one and disagrees with it
   * on the row that matters:**
   *
   * | Row | `AND onchain_deal_id IS NOT NULL` (forbidden) | This exclusion |
   * | --- | --- | --- |
   * | `purchased`, NULL — mid-saga or unconfirmed | ❌ dropped, and the money vanishes | ✅ **kept** |
   * | `failed`, NULL — compensated | ✅ dropped | ✅ dropped |
   * | `failed`, set — produced nothing | ✅ kept | ✅ kept |
   *
   * The forbidden predicate is about *confirmation*; this one is about
   * *compensation*. They coincide on one row and differ on the one the warning
   * exists to protect. `OrderRepository.markFailed` is the only writer of
   * `failed` + NULL, which is what makes this exact rather than approximate.
   * (`specs/007-orders-purchase-saga/research.md` R14)
   *
   * Uses the existing `orders_buyer_idx ON (buyer_account_id, created_at)` for
   * the buyer predicate; the state filter is applied on top of it.
   */
  async sumOpenOrderValueMinor(accountId: string): Promise<number> {
    const row = await this.orders
      .createQueryBuilder('o')
      .select('COALESCE(SUM(o.price_minor), 0)', 'total')
      .where('o.buyer_account_id = :accountId', { accountId })
      .andWhere('o.state IN (:...states)', {
        // Spread out of the readonly tuple: TypeORM's parameter object is not
        // typed readonly, and the tuple is frozen at the type level so nothing
        // here can mutate the shared constant.
        states: [...ESCROWED_ORDER_STATES],
      })
      // ⚠️ The compensated-purchase exclusion. See the docblock — this is NOT
      // `AND onchain_deal_id IS NOT NULL`, and the difference is the mid-saga
      // row, which must keep counting.
      .andWhere("NOT (o.state = 'failed' AND o.onchain_deal_id IS NULL)")
      .getRawOne<{ total: string }>();

    // SUM(bigint) comes back as `numeric`, which the driver hands over as a
    // string. Convert once, here, at the boundary — the same reason the entity
    // columns carry bigintTransformer, and the same conversion
    // balance.repository.ts does.
    return Number(row?.total ?? 0);
  }
}
