import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  formatEther,
  getAddress,
  keccak256,
  parseEther,
  toHex,
  type Hex,
  type PublicClient,
} from 'viem';

import type { AppConfig } from '../config/env.schema';
import { erc20Abi } from './abi/erc20.abi';
import { escrowAbi } from './abi/escrow.abi';
import { GAS_LIMITS } from './chain.constants';
import { PUBLIC_CLIENT } from './chain.tokens';
import { CENTS_TO_BASE_SCALE, fromBaseUnits } from './units';

/** The token decimals every conversion in `units.ts` assumes. */
const EXPECTED_TOKEN_DECIMALS = 6;

/**
 * The gas price Monad testnet quoted when the transfer ceiling was measured:
 * 102 gwei. Used ONLY to turn a MON balance into "roughly N more top-ups" in a
 * warning message — never to price or send anything, which is why a stale
 * reading here is a slightly wrong diagnostic rather than a wrong transaction.
 */
const OBSERVED_GAS_PRICE_WEI = 102_000_000_000n;

/** What one top-up costs in MON: the LIMIT, charged in full, times the price. */
const TRANSFER_COST_WEI = GAS_LIMITS.transfer * OBSERVED_GAS_PRICE_WEI;

/**
 * Below this much native MON, the funder wallet gets a warning rather than a
 * clean line.
 *
 * Sized from the measurement above rather than picked as a round number:
 * 110,000 gas × 102 gwei ≈ 0.0112 MON per top-up — *exactly*, not "up to",
 * because Monad charges the limit. So 0.5 MON is roughly 44 top-ups: enough
 * that the warning fires with a demo's worth of runway still in the tank,
 * rather than at the moment the next user's "Add funds" already fails.
 */
const MIN_FUNDER_MON = parseEther('0.5');

const OPERATOR_ROLE = keccak256(toHex('OPERATOR_ROLE'));
const GUARDIAN_ROLE = keccak256(toHex('GUARDIAN_ROLE'));

export interface PreflightCheck {
  name: string;
  ok: boolean;
  detail: string;
}

/**
 * Six free reads at boot, to move a diagnosis earlier.
 *
 * ⚠️ **This warns; it never throws and never blocks startup.** That is the
 * existing convention rather than a new one: `config/detect-placeholders.ts`
 * exists precisely so the service can start before the contract is deployed,
 * and a blocking preflight would have prevented the API from booting at all
 * during the window when `ESCROW_CONTRACT_ADDRESS` was still a placeholder.
 *
 * Every check here fails loudly at the first real chain call anyway. The
 * preflight's only job is to say so at boot, with a message that names the
 * cause — rather than at 2am mid-demo, as a revert.
 *
 * The role checks double as a drift detector for the copied ABI: an
 * `escrow.abi.ts` transcribed from a stale artifact generally fails to decode
 * `hasRole` against the deployed bytecode.
 */
@Injectable()
export class ChainPreflightService implements OnModuleInit {
  private readonly logger = new Logger('ChainPreflight');

  constructor(
    @Inject(PUBLIC_CLIENT) private readonly publicClient: PublicClient,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      const results = await this.check();
      for (const r of results) {
        if (r.ok) this.logger.log(`${r.name} — OK (${r.detail})`);
        else this.logger.warn(`${r.name} — ${r.detail}`);
      }
    } catch (err) {
      // Even the preflight failing must not stop the app. If the RPC is
      // unreachable at boot, that is worth one warning, not a dead service.
      this.logger.warn(
        `preflight could not complete: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async check(): Promise<PreflightCheck[]> {
    const escrow = this.config.get('ESCROW_CONTRACT_ADDRESS', {
      infer: true,
    }) as Hex;
    const usdc = this.config.get('USDC_ADDRESS', { infer: true }) as Hex;
    const expectedChainId = this.config.get('MONAD_CHAIN_ID', { infer: true });
    const operator = this.config.get('OPERATOR_ADDRESS', { infer: true }) as Hex;
    const guardian = this.config.get('GUARDIAN_ADDRESS', { infer: true }) as Hex;
    const funder = this.config.get('FUNDER_ADDRESS', { infer: true }) as Hex;

    const out: PreflightCheck[] = [];

    const chainId = await this.publicClient.getChainId();
    out.push({
      name: 'chain id',
      ok: chainId === expectedChainId,
      detail:
        chainId === expectedChainId
          ? String(chainId)
          : `endpoint serves ${chainId}, config says ${expectedChainId} — transactions would be signed for the wrong network`,
    });

    out.push(await this.funderCheck(funder, usdc));

    // Everything below reads the escrow, which is pointless if it is not there.
    const code = await this.publicClient.getCode({ address: escrow });
    if (!code || code === '0x') {
      out.push({
        name: 'escrow contract',
        ok: false,
        detail: `no bytecode at ${escrow} — not deployed, or the address is a placeholder`,
      });
      return out;
    }

    const token = await this.publicClient.readContract({
      address: escrow,
      abi: escrowAbi,
      functionName: 'token',
    });
    const tokenMatches = getAddress(token) === getAddress(usdc);
    out.push({
      name: 'settlement token',
      ok: tokenMatches,
      detail: tokenMatches
        ? token
        : `escrow settles in ${token}, config names ${usdc}`,
    });

    const decimals = await this.publicClient.readContract({
      address: usdc,
      abi: erc20Abi,
      functionName: 'decimals',
    });
    out.push({
      name: 'token decimals',
      ok: decimals === EXPECTED_TOKEN_DECIMALS,
      detail:
        decimals === EXPECTED_TOKEN_DECIMALS
          ? String(decimals)
          : `token reports ${decimals}, units.ts assumes ${EXPECTED_TOKEN_DECIMALS} — every conversion would be wrong by a power of ten`,
    });

    for (const [label, role, holder] of [
      ['OPERATOR_ROLE', OPERATOR_ROLE, operator],
      ['GUARDIAN_ROLE', GUARDIAN_ROLE, guardian],
    ] as const) {
      const has = await this.publicClient.readContract({
        address: escrow,
        abi: escrowAbi,
        functionName: 'hasRole',
        args: [role, holder],
      });
      out.push({
        name: `${label} held by ${holder}`,
        ok: has,
        detail: has
          ? 'granted'
          : `NOT granted — every write with this key will revert with AccessControlUnauthorizedAccount`,
      });
    }

    return out;
  }

  /**
   * The funder wallet's two balances: test USDC (what it hands out) and native
   * MON (what it pays gas with).
   *
   * ⚠️ **The funder is a FOURTH signer that inherits a trap already documented
   * for the other three.** `docs/rain-integration.md` §0.2 warns that *three*
   * wallets need MON for gas and that it is "easy to forget the guardian one
   * until the first verdict fails to settle". The funder was added after that
   * sentence was written and is exactly the same shape of mistake, one step
   * earlier in the flow: a funder with plenty of test USDC and no MON cannot
   * sign anything, so the very first "Add funds" click of a demo fails — with a
   * transport-level `InsufficientFundsError` that reads like an outage rather
   * than like an empty tank. Nobody funds a wallet they only remembered
   * existed because it broke.
   *
   * ⚠️ **The USDC figure is also the system's health signal** (§0.3). The funder
   * is "the outside world": the only source of money in the platform, and the
   * only place it returns to. Its balance should FALL as users top up and RISE
   * as they cash out. Drift in one direction only means something is wrong —
   * either a leg that never runs, or a ledger that disagrees with the chain.
   * Printing it once at boot gives that reading a baseline to be compared
   * against; without one, "the funder is low" is unfalsifiable.
   *
   * Placed BEFORE the escrow-bytecode early return on purpose. Nothing here
   * touches the escrow, and the window where the escrow is absent — a fresh
   * environment, `ESCROW_CONTRACT_ADDRESS` still a placeholder, which
   * `config/detect-placeholders.ts` exists to survive — is precisely the window
   * where an unfunded funder is most likely and least expected.
   *
   * Like every other check in this file: it WARNS, it never throws, and it never
   * blocks startup. A low balance is a thing to fix, not a reason for the API to
   * refuse to exist.
   */
  private async funderCheck(
    funder: Hex,
    usdc: Hex,
  ): Promise<PreflightCheck> {
    const name = `funder wallet ${funder}`;

    const [rawUsdc, mon] = await Promise.all([
      this.publicClient.readContract({
        address: usdc,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [funder],
      }),
      this.publicClient.getBalance({ address: funder }),
    ]);

    // `fromBaseUnits` THROWS on an amount that is not a whole number of cents,
    // which is the right behaviour everywhere money is being moved — but this
    // is a diagnostic, and a preflight that throws is a preflight that hides
    // the five checks after it. A faucet mint is not obliged to land on a whole
    // cent. So the odd amount is reported in base units instead, the same way
    // `ensureAllowance` logs the unbounded allowance rather than converting it.
    const usdcLabel =
      rawUsdc % CENTS_TO_BASE_SCALE === 0n
        ? `${fromBaseUnits(rawUsdc)}¢ USDC`
        : `${rawUsdc} base units of USDC (not a whole number of cents)`;

    const monLabel = `${formatEther(mon)} MON`;

    if (mon < MIN_FUNDER_MON) {
      // Gas, not tokens, is the failure that reads as an outage — so it leads.
      return {
        name,
        ok: false,
        detail:
          `${monLabel} — below ${formatEther(MIN_FUNDER_MON)} MON, roughly ` +
          `${mon / TRANSFER_COST_WEI} more top-ups at the ${GAS_LIMITS.transfer} ` +
          `gas ceiling Monad charges in full. Top up the funder with MON, or ` +
          `"Add funds" stops working mid-demo. (holding ${usdcLabel})`,
      };
    }

    if (rawUsdc === 0n) {
      return {
        name,
        ok: false,
        detail:
          `holds no USDC — every top-up will be refused by the balance ` +
          `precondition, or revert with ERC20InsufficientBalance if it is ` +
          `skipped. The funder is the only source of money in the system. ` +
          `(gas: ${monLabel})`,
      };
    }

    return { name, ok: true, detail: `${usdcLabel}, gas ${monLabel}` };
  }
}
