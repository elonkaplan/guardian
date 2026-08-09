/**
 * Throwaway acceptance script for the chain adapter.
 *
 * Runs a real registration against the deployed escrow and prints the explorer
 * link, then reads back what it wrote plus the fixtures the deployment runbook
 * left behind. This is the manual verification for SC-001 and SC-002; there are
 * no automated tests in this component by design (`docs/CONTEXT.md`).
 *
 *   npx ts-node scripts/chain-smoke.ts
 *
 * It lives outside `src/` on purpose: `tsconfig.json` sets `rootDir: "./src"`,
 * so a script placed inside would ship in `dist/`. ts-node does not care.
 *
 * ⚠️ This SPENDS REAL TESTNET FUNDS and writes to the live escrow — each run
 * registers one more agent. That is harmless (agents are cheap and inert until
 * a deal is opened) but it is not a read-only script.
 */
import { NestFactory } from '@nestjs/core';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { keccak256, toHex, type Address, type PublicClient } from 'viem';

import { ChainModule } from '../src/chain/chain.module';
import { PUBLIC_CLIENT } from '../src/chain/chain.tokens';
import { escrowOperatorAbi } from '../src/chain/abi/escrow-operator.abi';
import { EscrowOperatorService } from '../src/chain/escrow-operator.service';
import { EscrowReadService } from '../src/chain/escrow-read.service';
import { GAS_LIMITS } from '../src/chain/chain.constants';
import { AgentNotFoundError, DealNotFoundError } from '../src/chain/errors';
import { AppConfigModule } from '../src/config/config.module';
import type { AppConfig } from '../src/config/env.schema';

@Module({ imports: [AppConfigModule, ChainModule] })
class SmokeModule {}

const PRICE_CENTS = 200; // $2.00 — must read back as 200, not 2000000

/**
 * ⚠️ Never print `gasUsed / limit` as a percentage here.
 *
 * On Monad `receipt.gasUsed` reports the **limit charged**, not execution cost,
 * so that ratio reads 100% for every transaction regardless of how oversized
 * the ceiling is — which is precisely the opposite of what a reader would
 * conclude from it. Real cost comes from `measureGas` (`eth_estimateGas`).
 */
function gasLine(charged: bigint, ceiling: bigint, estimated: bigint): string {
  const headroom = ((Number(ceiling) / Number(estimated) - 1) * 100).toFixed(0);
  return `charged ${charged} (the ceiling) · actually needs ~${estimated} · ${headroom}% headroom`;
}

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(SmokeModule, {
    logger: ['error', 'warn'],
  });

  const operator = app.get(EscrowOperatorService);
  const reads = app.get(EscrowReadService);
  const config = app.get(ConfigService<AppConfig, true>);
  const operatorAddress = config.get('OPERATOR_ADDRESS', {
    infer: true,
  }) as Address;

  // ---- write path (SC-001) ----------------------------------------
  console.log('\n=== write path ===');

  const allowance = await operator.ensureAllowance(PRICE_CENTS);
  console.log(
    allowance
      ? `allowance:      approved, tx ${allowance.hash} gas ${allowance.gasUsed}/${GAS_LIMITS.approve}`
      : 'allowance:      already sufficient (unbounded, set at deploy)',
  );

  const defHash = keccak256(toHex(`smoke-${Date.now()}`));
  // Real execution cost, measured BEFORE the write — receipts cannot tell us.
  const publicClient = app.get<PublicClient>(PUBLIC_CLIENT);
  const estimated = await publicClient.estimateContractGas({
    address: config.get('ESCROW_CONTRACT_ADDRESS', { infer: true }) as `0x${string}`,
    abi: escrowOperatorAbi,
    functionName: 'registerAgent',
    args: [operatorAddress, 2_000_000n, defHash],
    account: operatorAddress,
  });

  const reg = await operator.registerAgent(
    operatorAddress,
    PRICE_CENTS,
    defHash,
  );
  console.log(
    `registerAgent:  agentId ${reg.value}, tx ${reg.hash}\n` +
      `  gas:          ${gasLine(reg.gasUsed, GAS_LIMITS.registerAgent, estimated)}`,
  );
  console.log(`  ${reads.explorerTxUrl(reg.hash)}`);

  // ---- read path (SC-002) -----------------------------------------
  console.log('\n=== read path ===');

  const agent = await reads.getAgent(reg.value);
  console.log(
    `getAgent(${reg.value}):    owner ${agent.owner}  price ${agent.priceCents}¢  ` +
      `version ${agent.version}  active ${agent.active}`,
  );
  console.log(
    `  conversion:   ${agent.priceCents === PRICE_CENTS ? `✅ ${agent.priceCents}¢ (not 2000000)` : `❌ got ${agent.priceCents}`}`,
  );

  console.log(`totalEscrowed:  ${await reads.totalEscrowedCents()}¢`);
  console.log(`balanceOf(op):  ${await reads.balanceOfCents(operatorAddress)}¢`);

  // ---- pre-existing fixtures from the deployment runbook -----------
  // These exercise paths a fresh registration cannot: a settled deal, and the
  // zero-timestamp -> null rule on a real record.
  console.log('\n=== runbook fixtures ===');
  try {
    const a1 = await reads.getAgent(1n);
    console.log(
      `getAgent(1):     owner ${a1.owner}  price ${a1.priceCents}¢  v${a1.version}  active ${a1.active}`,
    );
    const d1 = await reads.getDeal(1n);
    console.log(
      `getDeal(1):      state ${d1.state}  amount ${d1.amountCents}¢  window ${d1.reviewWindowSeconds}s`,
    );
    console.log(
      `  openedAt:     ${d1.openedAt.toISOString()}\n` +
        `  deliveredAt:  ${d1.deliveredAt ? d1.deliveredAt.toISOString() : 'null'}\n` +
        `  disputedAt:   ${d1.disputedAt === null ? '✅ null (never disputed)' : d1.disputedAt.toISOString()}`,
    );
  } catch (e) {
    console.log(`  fixtures unavailable: ${(e as Error).message}`);
  }

  // ---- not-found (FR-020) -----------------------------------------
  console.log('\n=== not-found handling ===');
  for (const [label, fn] of [
    ['getDeal(999999)', () => reads.getDeal(999_999n)],
    ['getAgent(999999)', () => reads.getAgent(999_999n)],
  ] as const) {
    try {
      await fn();
      console.log(`  ${label}: ❌ returned a record instead of throwing`);
    } catch (e) {
      const ok = e instanceof DealNotFoundError || e instanceof AgentNotFoundError;
      console.log(`  ${label}: ${ok ? '✅' : '❌'} ${(e as Error).name}`);
    }
  }

  await app.close();
}

main().catch((err: unknown) => {
  console.error('\nSMOKE FAILED:', err);
  process.exit(1);
});
