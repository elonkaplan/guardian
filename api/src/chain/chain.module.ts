import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { PublicClient } from 'viem';

import type { AppConfig } from '../config/env.schema';
import { GUARDIAN_CLIENT, OPERATOR_CLIENT, PUBLIC_CLIENT } from './chain.tokens';
import { buildGuardianClient } from './clients/guardian.client';
import { buildOperatorClient } from './clients/operator.client';
import { buildPublicClient } from './clients/public.client';
import { ChainPreflightService } from './chain-preflight.service';
import { EscrowGuardianService } from './escrow-guardian.service';
import { EscrowOperatorService } from './escrow-operator.service';
import { EscrowReadService } from './escrow-read.service';

/** The three chain-config keys every client factory needs. */
const chainKeys = (config: ConfigService<AppConfig, true>) => ({
  MONAD_RPC_URL: config.get('MONAD_RPC_URL', { infer: true }),
  MONAD_CHAIN_ID: config.get('MONAD_CHAIN_ID', { infer: true }),
  MONAD_EXPLORER_URL: config.get('MONAD_EXPLORER_URL', { infer: true }),
});



/**
 * `chain/` — the only module in the backend that talks to Monad, and the only
 * place that knows the settlement token counts in base units.
 *
 * What this module exports is as much a design decision as what it contains.
 * The three viem clients are provided internally and **never exported**: a
 * consumer that could inject a raw `WalletClient` would be able to name any
 * function on any ABI, which would make the guardian's one-entry ABI
 * decorative rather than load-bearing (FR-005). Everything outside this module
 * goes through a typed service method or does not reach the chain at all.
 */
@Module({
  providers: [
    {
      provide: PUBLIC_CLIENT,
      // ConfigService here rather than reading process.env: the values were
      // parsed and validated once at boot by env.schema.ts, and a second
      // source for the RPC URL is how a demo ends up pointed at two nodes.
      useFactory: (config: ConfigService<AppConfig, true>): PublicClient =>
        buildPublicClient(chainKeys(config)),
      inject: [ConfigService],
    },
    {
      provide: OPERATOR_CLIENT,
      useFactory: (config: ConfigService<AppConfig, true>) =>
        buildOperatorClient({
          ...chainKeys(config),
          OPERATOR_PRIVATE_KEY: config.get('OPERATOR_PRIVATE_KEY', {
            infer: true,
          }),
        }),
      inject: [ConfigService],
    },
    {
      provide: GUARDIAN_CLIENT,
      useFactory: (config: ConfigService<AppConfig, true>) =>
        buildGuardianClient({
          ...chainKeys(config),
          GUARDIAN_PRIVATE_KEY: config.get('GUARDIAN_PRIVATE_KEY', {
            infer: true,
          }),
        }),
      inject: [ConfigService],
    },
    EscrowReadService,
    EscrowOperatorService,
    EscrowGuardianService,
    ChainPreflightService,
  ],
  // Services are exported; clients are not. See the note above — this list is
  // the boundary that makes the narrowed ABIs meaningful.
  exports: [EscrowReadService, EscrowOperatorService, EscrowGuardianService],
})
export class ChainModule {}
