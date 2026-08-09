import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Order } from '../entities/order.entity';
import { EscrowExposureRepository } from './escrow-exposure.repository';

/**
 * Orders. Currently one read — the per-buyer escrow exposure `GET /me` needs —
 * which is why `EscrowExposureRepository` is exported rather than kept private.
 * API-06 (the purchase saga) extends this module **in place**; it does not
 * relocate it.
 *
 * A whole module for a single query looks like ceremony, and it is the same
 * call `LedgerModule` and `AccountsModule` both made in API-02, for the same
 * reason: `docs/CONTEXT.md` §3 assigns orders to `orders`. Putting this query
 * in `accounts/` is the option that looks cheapest today — the entity is
 * already registered next door, it is fifteen lines — and it states something
 * untrue about which module owns the order table. API-06 would then move the
 * file and rewrite every import that grew against the wrong home in the
 * meantime.
 *
 * (research R11)
 */
@Module({
  imports: [TypeOrmModule.forFeature([Order])],
  providers: [EscrowExposureRepository],
  exports: [EscrowExposureRepository],
})
export class OrdersModule {}
