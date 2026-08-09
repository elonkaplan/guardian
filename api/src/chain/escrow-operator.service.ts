import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  parseEventLogs,
  type Account,
  type Address,
  type Chain,
  type Hex,
  type PublicClient,
  type TransactionReceipt,
  type Transport,
  type WalletClient,
} from 'viem';

import type { AppConfig } from '../config/env.schema';
import { erc20Abi } from './abi/erc20.abi';
import { escrowOperatorAbi } from './abi/escrow-operator.abi';
import { ALLOWANCE_TOPUP_CENTS } from './chain.constants';
import { OPERATOR_CLIENT, PUBLIC_CLIENT } from './chain.tokens';
import { executeWrite } from './execute-write';
import type { TxResult } from './types';
import { fromBaseUnits, toBaseUnits } from './units';

/**
 * Every escrow operation the operator is entitled to perform, in the
 * platform's own vocabulary: cents rather than base units, `bigint` ids rather
 * than encoded calldata, and a confirmed transaction reference or a named
 * failure rather than a raw viem error.
 *
 * ⚠️ **`withdraw()` is deliberately not wrapped here.**
 *
 * The contract exposes both `withdraw()` and `withdrawFor(account)`. The first
 * pays `msg.sender` — so the operator calling it would send *every user's*
 * payout to the operator, which is precisely the bug `withdrawFor` was added to
 * prevent (`docs/smart-contract.md` §4.5). It is also absent from
 * `escrowOperatorAbi`, so this is not merely a missing method: calling it
 * through this client is a compile error. That is the one place this module
 * knowingly does not wrap "every escrow function", and it is a decision.
 */
@Injectable()
export class EscrowOperatorService {
  private readonly logger = new Logger(EscrowOperatorService.name);
  private readonly escrow: Hex;
  private readonly usdc: Hex;

  constructor(
    @Inject(PUBLIC_CLIENT) private readonly publicClient: PublicClient,
    @Inject(OPERATOR_CLIENT)
    private readonly operatorClient: WalletClient<Transport, Chain, Account>,
    config: ConfigService<AppConfig, true>,
  ) {
    this.escrow = config.get('ESCROW_CONTRACT_ADDRESS', { infer: true }) as Hex;
    this.usdc = config.get('USDC_ADDRESS', { infer: true }) as Hex;
  }

  // -------------------------------------------------------------------
  // Registry
  // -------------------------------------------------------------------

  /**
   * Register a purchasable agent. Returns the new on-chain agent id.
   *
   * See `recoverId` for why the id comes from a log rather than from the
   * function's declared return value.
   */
  async registerAgent(
    owner: Address,
    priceCents: number,
    defHash: Hex,
  ): Promise<TxResult<bigint>> {
    const result = await executeWrite({
      publicClient: this.publicClient,
      walletClient: this.operatorClient,
      address: this.escrow,
      abi: escrowOperatorAbi,
      functionName: 'registerAgent',
      args: [owner, toBaseUnits(priceCents), defHash],
      operation: 'registerAgent',
    });

    return this.withId(result, 'AgentRegistered', 'agentId');
  }

  /** Replace an agent's price and definition hash; the contract bumps `version`. */
  async updateAgent(
    agentId: bigint,
    priceCents: number,
    defHash: Hex,
  ): Promise<TxResult> {
    return this.voidResult(
      await executeWrite({
        publicClient: this.publicClient,
        walletClient: this.operatorClient,
        address: this.escrow,
        abi: escrowOperatorAbi,
        functionName: 'updateAgent',
        args: [agentId, toBaseUnits(priceCents), defHash],
        operation: 'updateAgent',
      }),
    );
  }

  /** Gate whether NEW deals may be opened. Running deals are unaffected. */
  async setAgentActive(agentId: bigint, active: boolean): Promise<TxResult> {
    return this.voidResult(
      await executeWrite({
        publicClient: this.publicClient,
        walletClient: this.operatorClient,
        address: this.escrow,
        abi: escrowOperatorAbi,
        functionName: 'setAgentActive',
        args: [agentId, active],
        operation: 'setAgentActive',
      }),
    );
  }

  // -------------------------------------------------------------------
  // Allowance
  // -------------------------------------------------------------------

  /**
   * Ensure the escrow may pull `requiredCents` of USDC from the operator.
   *
   * Returns `null` when the current allowance already covers it — a free read,
   * no transaction.
   *
   * **Why this lives in the module rather than in a caller**: `openDeal` does
   * `safeTransferFrom(operator, escrow, price)`. With no allowance every
   * purchase reverts, and as the contract's own comment warns, it does so "long
   * after deployment looked successful". An operation that cannot succeed
   * without a companion call has not really been wrapped.
   *
   * ⚠️ **Against the current deployment this always returns `null`.** The deploy
   * runbook granted the escrow an effectively unbounded approval and that was
   * accepted rather than revoked, so the top-up branch below will not fire here.
   * It exists for a *fresh* deployment, which starts at zero allowance.
   * Unexercised, not dead.
   *
   * Note also that allowance and balance are **independent** preconditions: a
   * generous allowance says nothing about whether the operator actually holds
   * the tokens, and the two fail with different ERC-20 errors.
   */
  async ensureAllowance(requiredCents: number): Promise<TxResult | null> {
    const operator = this.operatorClient.account.address;
    const required = toBaseUnits(requiredCents);

    const current = await this.publicClient.readContract({
      address: this.usdc,
      abi: erc20Abi,
      functionName: 'allowance',
      args: [operator, this.escrow],
    });

    if (current >= required) {
      // Logged in base units deliberately: the live allowance is unbounded and
      // does not divide into whole cents, so `fromBaseUnits` would (correctly)
      // reject it. Converting here would also put the scale outside units.ts,
      // which is the one thing this module must never do.
      this.logger.debug(
        `allowance already sufficient (${current} base units ≥ ${required} needed)`,
      );
      return null;
    }

    this.logger.log(
      `allowance ${current} < ${required}; approving ${ALLOWANCE_TOPUP_CENTS}¢`,
    );

    return this.voidResult(
      await executeWrite({
        publicClient: this.publicClient,
        walletClient: this.operatorClient,
        address: this.usdc,
        abi: erc20Abi,
        functionName: 'approve',
        args: [this.escrow, toBaseUnits(ALLOWANCE_TOPUP_CENTS)],
        operation: 'approve',
      }),
    );
  }

  // -------------------------------------------------------------------
  // Deal lifecycle
  // -------------------------------------------------------------------

  /**
   * Capture the agent's price into escrow and open a deal. Returns the new
   * on-chain deal id.
   *
   * **Takes no amount.** The contract charges `agent.price` from its own
   * storage, which is what makes the deal's amount a snapshot rather than a
   * parameter — the price a buyer was shown cannot drift from the price
   * escrowed.
   *
   * `requiredCents` for the allowance check is read from the agent on chain
   * rather than passed in, so a caller cannot under-declare it.
   */
  async openDeal(
    agentId: bigint,
    buyer: Address,
    reviewWindowSeconds: number,
  ): Promise<TxResult<bigint>> {
    const priceCents = await this.readAgentPriceCents(agentId);
    await this.ensureAllowance(priceCents);

    const result = await executeWrite({
      publicClient: this.publicClient,
      walletClient: this.operatorClient,
      address: this.escrow,
      abi: escrowOperatorAbi,
      functionName: 'openDeal',
      args: [agentId, buyer, reviewWindowSeconds],
      operation: 'openDeal',
    });

    return this.withId(result, 'DealOpened', 'dealId');
  }

  /** Record delivery, which starts the review window. */
  async markDelivered(dealId: bigint): Promise<TxResult> {
    return this.lifecycleWrite('markDelivered', dealId);
  }

  /** The buyer accepting early — credits the seller the full amount. */
  async accept(dealId: bigint): Promise<TxResult> {
    return this.lifecycleWrite('accept', dealId);
  }

  /** Settle a delivered deal whose review window has lapsed. */
  async release(dealId: bigint): Promise<TxResult> {
    return this.lifecycleWrite('release', dealId);
  }

  /** Return the full amount to the buyer when nothing was ever delivered. */
  async reclaim(dealId: bigint): Promise<TxResult> {
    return this.lifecycleWrite('reclaim', dealId);
  }

  // -------------------------------------------------------------------
  // Dispute
  // -------------------------------------------------------------------

  /** Freeze a delivered deal pending arbitration. No value moves. */
  async dispute(dealId: bigint): Promise<TxResult> {
    return this.lifecycleWrite('dispute', dealId);
  }

  /**
   * Force-settle a dispute the guardian never ruled on, at `Tier.Quarter`.
   *
   * On the OPERATOR service rather than the guardian's, deliberately: it is
   * permissionless, and it chooses nothing — the outcome is fixed by the
   * contract. Putting it on the guardian would give that key a second callable
   * function and weaken the one-entry-ABI guarantee for no benefit.
   */
  async forceResolve(dealId: bigint): Promise<TxResult> {
    return this.lifecycleWrite('forceResolve', dealId);
  }

  // -------------------------------------------------------------------
  // Money out
  // -------------------------------------------------------------------

  /** Pay `account`'s escrow balance to `account`, whoever calls. */
  async withdrawFor(account: Address): Promise<TxResult> {
    return this.voidResult(
      await executeWrite({
        publicClient: this.publicClient,
        walletClient: this.operatorClient,
        address: this.escrow,
        abi: escrowOperatorAbi,
        functionName: 'withdrawFor',
        args: [account],
        operation: 'withdrawFor',
      }),
    );
  }

  // -------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------

  /** The six single-`dealId` lifecycle writes differ only in name and ceiling. */
  private async lifecycleWrite(
    functionName:
      | 'markDelivered'
      | 'accept'
      | 'release'
      | 'reclaim'
      | 'dispute'
      | 'forceResolve',
    dealId: bigint,
  ): Promise<TxResult> {
    return this.voidResult(
      await executeWrite({
        publicClient: this.publicClient,
        walletClient: this.operatorClient,
        address: this.escrow,
        abi: escrowOperatorAbi,
        functionName,
        args: [dealId],
        operation: functionName,
      }),
    );
  }

  /** The agent's escrowed price, in cents — used to size the allowance check. */
  private async readAgentPriceCents(agentId: bigint): Promise<number> {
    const [, price] = await this.publicClient.readContract({
      address: this.escrow,
      abi: [
        {
          type: 'function',
          name: 'agents',
          stateMutability: 'view',
          inputs: [{ name: '', type: 'uint256' }],
          outputs: [
            { name: 'owner', type: 'address' },
            { name: 'price', type: 'uint256' },
            { name: 'defHash', type: 'bytes32' },
            { name: 'version', type: 'uint32' },
            { name: 'active', type: 'bool' },
          ],
        },
      ] as const,
      functionName: 'agents',
      args: [agentId],
    });

    return fromBaseUnits(price);
  }

  /**
   * ⚠️ **Recovers a new id from the receipt's event log — never from the
   * function's return value.**
   *
   * This is the single easiest thing to get wrong here, because the Solidity
   * reads as though it works:
   *
   * ```solidity
   * function registerAgent(...) external returns (uint256 agentId)
   * function openDeal(...)      external returns (uint256 dealId)
   * ```
   *
   * A return value only exists for an `eth_call`. A **transaction** returns
   * nothing to an off-chain caller — the value is discarded once mined. The id
   * survives only because both functions also emit it.
   *
   * `parseEventLogs` filters by ABI *and* event name, so the ERC-20 `Transfer`
   * that `openDeal` also produces cannot be mistaken for ours.
   *
   * Rejected alternative: reading `nextAgentId() - 1` after the transaction. It
   * races any concurrent write, and the race resolves as *the wrong agent id
   * attached to the wrong seller* — silent, and about money.
   */
  private withId(
    result: TxResult<TransactionReceipt>,
    eventName: 'AgentRegistered' | 'DealOpened',
    field: 'agentId' | 'dealId',
  ): TxResult<bigint> {
    const logs = parseEventLogs({
      abi: escrowOperatorAbi,
      eventName,
      logs: result.value.logs,
    });

    const first = logs[0];
    if (!first) {
      throw new Error(
        `${eventName} was not emitted by transaction ${result.hash}; cannot recover ${field}`,
      );
    }

    const args = first.args as Record<string, unknown>;
    const id = args[field];
    if (typeof id !== 'bigint') {
      throw new Error(
        `${eventName}.${field} was ${typeof id}, expected bigint (tx ${result.hash})`,
      );
    }

    return {
      hash: result.hash,
      blockNumber: result.blockNumber,
      gasUsed: result.gasUsed,
      value: id,
    };
  }

  /** Drops the receipt from the result for writes that produce no value. */
  private voidResult(result: TxResult<TransactionReceipt>): TxResult {
    return {
      hash: result.hash,
      blockNumber: result.blockNumber,
      gasUsed: result.gasUsed,
      value: undefined,
    };
  }
}
