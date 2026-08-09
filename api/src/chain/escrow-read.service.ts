import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Address, Hex, PublicClient } from 'viem';

import type { AppConfig } from '../config/env.schema';
import { escrowAbi } from './abi/escrow.abi';
import { PUBLIC_CLIENT } from './chain.tokens';
import {
  agentExists,
  dealExists,
  mapAgent,
  mapDeal,
  type RawAgentTuple,
  type RawDealTuple,
} from './deal-mapper';
import { decodeRevert } from './decode-revert';
import { AgentNotFoundError, ChainError, DealNotFoundError } from './errors';
import type { OnChainAgent, OnChainDeal } from './types';
import { fromBaseUnits } from './units';

/**
 * Everything the platform reads from the escrow. **No signing key is involved
 * anywhere in this file** — every method here is a free `eth_call`.
 *
 * Amounts cross this boundary in whole cents, never base units. The full
 * `escrowAbi` is used rather than a narrowed one because reads carry no
 * authority: there is nothing to narrow against.
 */
@Injectable()
export class EscrowReadService {
  private readonly escrow: Hex;
  private readonly explorerUrl: string;

  constructor(
    @Inject(PUBLIC_CLIENT) private readonly publicClient: PublicClient,
    config: ConfigService<AppConfig, true>,
  ) {
    this.escrow = config.get('ESCROW_CONTRACT_ADDRESS', { infer: true }) as Hex;
    this.explorerUrl = config.get('MONAD_EXPLORER_URL', { infer: true });
  }

  /**
   * Total currently held across all unsettled deals, in cents.
   *
   * The number the demo screen shows — "$X currently held in escrow" — and the
   * left half of the contract's solvency invariant.
   */
  async totalEscrowedCents(): Promise<number> {
    return this.read('totalEscrowed', async () => {
      const raw = await this.publicClient.readContract({
        address: this.escrow,
        abi: escrowAbi,
        functionName: 'totalEscrowed',
      });
      return fromBaseUnits(raw);
    });
  }

  /**
   * What `account` may withdraw, in cents.
   *
   * Returns `0` for an address that is owed nothing rather than throwing — an
   * empty balance is a perfectly ordinary state, not an error (FR-018).
   */
  async balanceOfCents(account: Address): Promise<number> {
    return this.read('balances', async () => {
      const raw = await this.publicClient.readContract({
        address: this.escrow,
        abi: escrowAbi,
        functionName: 'balances',
        args: [account],
      });
      return fromBaseUnits(raw);
    });
  }

  /**
   * One deal's full recorded state.
   *
   * @throws {DealNotFoundError} for an id the escrow has never issued. See
   * `dealExists` — the contract returns a zero-filled struct rather than
   * reverting, so without this check a nonexistent deal reads as a real one.
   */
  async getDeal(dealId: bigint): Promise<OnChainDeal> {
    return this.read('getDeal', async () => {
      const raw = (await this.publicClient.readContract({
        address: this.escrow,
        abi: escrowAbi,
        functionName: 'deals',
        args: [dealId],
      })) as unknown as RawDealTuple;

      if (!dealExists(raw)) {
        throw new DealNotFoundError(
          `deal ${dealId} does not exist on the escrow`,
          'getDeal',
          dealId,
        );
      }
      return mapDeal(raw);
    });
  }

  /**
   * One agent's registry entry.
   *
   * @throws {AgentNotFoundError} for an id the escrow has never issued.
   */
  async getAgent(agentId: bigint): Promise<OnChainAgent> {
    return this.read('getAgent', async () => {
      const raw = (await this.publicClient.readContract({
        address: this.escrow,
        abi: escrowAbi,
        functionName: 'agents',
        args: [agentId],
      })) as unknown as RawAgentTuple;

      if (!agentExists(raw)) {
        throw new AgentNotFoundError(
          `agent ${agentId} does not exist on the escrow`,
          'getAgent',
          agentId,
        );
      }
      return mapAgent(raw);
    });
  }

  /**
   * The public explorer link for a transaction. No chain access — string
   * assembly over the configured explorer, so the UI and the demo have one
   * place to get it right.
   */
  explorerTxUrl(hash: Hex): string {
    return `${this.explorerUrl.replace(/\/$/, '')}/tx/${hash}`;
  }

  /**
   * Routes read failures through the same decoder the write path uses.
   *
   * Without this, reads leak raw viem errors — an unreachable RPC surfaces as
   * `ContractFunctionExecutionError` rather than `ChainConnectivityError`, and
   * a caller doing `catch (e) { if (e instanceof ChainError) … }` silently
   * misses every read failure. FR-010's named-failure requirement is not
   * limited to writes.
   *
   * `ChainError` instances pass through untouched so the two not-found errors
   * raised above are not re-wrapped into something less specific.
   */
  private async read<T>(operation: string, fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof ChainError) throw err;
      throw decodeRevert(err, operation);
    }
  }
}
