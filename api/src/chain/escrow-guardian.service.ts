import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  Account,
  Chain,
  Hex,
  PublicClient,
  Transport,
  WalletClient,
} from 'viem';

import type { VerdictTier } from '../entities/enums';
import type { AppConfig } from '../config/env.schema';
import { escrowResolveAbi } from './abi/escrow-resolve.abi';
import { GUARDIAN_CLIENT, PUBLIC_CLIENT } from './chain.tokens';
import { executeWrite } from './execute-write';
import { toTier } from './tier';
import type { TxResult } from './types';

/**
 * The guardian identity's entire capability: rule on a disputed deal.
 *
 * **One method. There is no second one, and there cannot be** — the client is
 * paired exclusively with `escrowResolveAbi`, which contains a single entry, so
 * any other `functionName` fails to type-check. That is what makes the claim
 * "the judge cannot also be the trader" structural rather than aspirational.
 *
 * Note what is NOT here:
 *
 * - **`forceResolve`** lives on the operator service instead, even though it
 *   also settles a dispute. It is permissionless, it chooses nothing (the
 *   outcome is fixed at `Tier.Quarter` by the contract), and giving the
 *   guardian key a second callable function would weaken the property above
 *   for no gain.
 * - **The client itself.** It is `private readonly` and never exported,
 *   injected, or returned (FR-005). A narrowed ABI means nothing if a caller
 *   can obtain the raw client and bring its own.
 */
@Injectable()
export class EscrowGuardianService {
  private readonly escrow: Hex;

  constructor(
    @Inject(PUBLIC_CLIENT) private readonly publicClient: PublicClient,
    @Inject(GUARDIAN_CLIENT)
    private readonly guardianClient: WalletClient<Transport, Chain, Account>,
    config: ConfigService<AppConfig, true>,
  ) {
    this.escrow = config.get('ESCROW_CONTRACT_ADDRESS', { infer: true }) as Hex;
  }

  /**
   * Settle a disputed deal by selecting one of the five refund tiers.
   *
   * Takes the **database's** `VerdictTier` string and maps it to the contract's
   * `uint8` internally, so no caller ever handles the numeric index — the two
   * enums agree in order but not in name, and an off-by-one here is the exact
   * number an audience watches.
   *
   * `verdictHash` is supplied by the caller and never computed here. That is
   * deliberate: it anchors an off-chain verdict that must already exist and be
   * persisted before this runs (invariant #8 — "the verdict is persisted before
   * the chain call", which is what makes the demo replayable). A service that
   * computed the hash itself could be called before anything was written down.
   */
  async resolve(
    dealId: bigint,
    tier: VerdictTier,
    verdictHash: Hex,
  ): Promise<TxResult> {
    const result = await executeWrite({
      publicClient: this.publicClient,
      walletClient: this.guardianClient,
      address: this.escrow,
      abi: escrowResolveAbi,
      functionName: 'resolve',
      args: [dealId, toTier(tier), verdictHash],
      operation: 'resolve',
    });

    return {
      hash: result.hash,
      blockNumber: result.blockNumber,
      gasUsed: result.gasUsed,
      value: undefined,
    };
  }
}
