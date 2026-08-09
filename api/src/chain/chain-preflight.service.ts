import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getAddress, keccak256, toHex, type Hex, type PublicClient } from 'viem';

import type { AppConfig } from '../config/env.schema';
import { erc20Abi } from './abi/erc20.abi';
import { escrowAbi } from './abi/escrow.abi';
import { PUBLIC_CLIENT } from './chain.tokens';

/** The token decimals every conversion in `units.ts` assumes. */
const EXPECTED_TOKEN_DECIMALS = 6;

const OPERATOR_ROLE = keccak256(toHex('OPERATOR_ROLE'));
const GUARDIAN_ROLE = keccak256(toHex('GUARDIAN_ROLE'));

export interface PreflightCheck {
  name: string;
  ok: boolean;
  detail: string;
}

/**
 * Five free reads at boot, to move a diagnosis earlier.
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
}
