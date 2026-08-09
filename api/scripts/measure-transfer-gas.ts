/**
 * Right-sizes `GAS_LIMITS.transfer` from a real measurement instead of a guess.
 *
 *   npx ts-node scripts/measure-transfer-gas.ts
 *
 * **Why this script exists at all.** Reasoning from storage costs has been wrong
 * twice in the `GAS_LIMITS` table, both times in a way that would only have shown
 * up in production: `openDeal`'s pre-deployment estimate of 400,000 sat *below*
 * the measured 408,072, which would have made every purchase in the product
 * revert out-of-gas — charged in full — in the single most important operation
 * we have; and `approve`'s old 80,000 ceiling cleared its measurement by only
 * 1.13×, thin enough that a fresh deployment's cold allowance SSTORE would very
 * likely have blown through it. A `transfer` ceiling is paid on **every top-up
 * and every cash-out**, because Monad charges the gas LIMIT rather than the
 * usage, so it is the most frequently spent entry in that table.
 *
 * And unlike the four ceilings still marked ESTIMATED there — which need a live
 * deal in a particular state before they can be measured at all — a transfer
 * needs **no special chain state**: any amount, either direction, at any time.
 * There is no reason for this entry to stay a guess, which is the whole argument
 * for this file (specs/005-accounts-ledger-funding/research.md R4).
 *
 * ⚠️ **This script sends NOTHING.** Every reading below is `eth_estimateGas`
 * (via `measureGas`), which is free and changes no state — unlike
 * `scripts/chain-smoke.ts`, which does spend testnet funds. Two reasons it must
 * stay that way: a transfer script that "just tries it" would move real balance
 * between the funder and the pool and quietly skew the health signal
 * (`docs/rain-integration.md` §0.3), and receipts could not answer the question
 * anyway — `receipt.gasUsed` on Monad reports the limit that was CHARGED, not
 * what execution cost, so a sent transaction would only tell us the number we
 * already chose.
 *
 * It lives outside `src/` on purpose: `tsconfig.json` sets `rootDir: "./src"`,
 * so a script placed inside would ship in `dist/`. ts-node does not care.
 */
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { Address, PublicClient, WalletClient, Transport, Chain, Account } from 'viem';

import { erc20Abi } from '../src/chain/abi/erc20.abi';
import { GAS_LIMITS } from '../src/chain/chain.constants';
import {
  FUNDER_CLIENT,
  OPERATOR_CLIENT,
  PUBLIC_CLIENT,
} from '../src/chain/chain.tokens';
import { ChainModule } from '../src/chain/chain.module';
import { measureGas } from '../src/chain/execute-write';
import { TokenTransferService } from '../src/chain/token-transfer.service';
import { toBaseUnits } from '../src/chain/units';
import { AppConfigModule } from '../src/config/config.module';
import type { AppConfig } from '../src/config/env.schema';

@Module({ imports: [AppConfigModule, ChainModule] })
class MeasureModule {}

/**
 * $0.01. Deliberately tiny — but note that the AMOUNT does not change the gas.
 *
 * An ERC-20 transfer's cost is driven by which storage slots it touches, not by
 * the number written into them: the same two SSTOREs and the same event fire
 * whether the value is one cent or ten thousand dollars. What *would* change the
 * reading is the recipient's slot being zero (cold, ~20,000) rather than
 * non-zero (warm, ~2,900) — and both the funder and the operator already hold
 * USDC, so both readings below are warm. That is the steady state the ceiling is
 * paid in, but it means neither reading prices a first-ever transfer to a fresh
 * address. The 1.3× margin absorbs ordinary variance, not that ~17,000 gap; if a
 * new recipient is ever added to these flows, re-measure against it.
 */
const AMOUNT_CENTS = 1;

/** The convention already used by every MEASURED entry in `GAS_LIMITS`. */
const MARGIN = 1.3;

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(MeasureModule, {
    logger: ['error', 'warn'],
  });

  const config = app.get(ConfigService<AppConfig, true>);
  const publicClient = app.get<PublicClient>(PUBLIC_CLIENT);
  const operatorClient = app.get<WalletClient<Transport, Chain, Account>>(
    OPERATOR_CLIENT,
  );
  const funderClient = app.get<WalletClient<Transport, Chain, Account>>(
    FUNDER_CLIENT,
  );

  const usdc = config.get('USDC_ADDRESS', { infer: true }) as Address;
  const operator = config.get('OPERATOR_ADDRESS', { infer: true }) as Address;
  const funder = config.get('FUNDER_ADDRESS', { infer: true }) as Address;

  // Balances first: an estimate against a sender that cannot afford the
  // transfer reverts inside eth_estimateGas rather than returning a number, so
  // an unhelpful error here usually means "that wallet is empty", not "the
  // measurement failed". Printing them makes that diagnosis immediate — and
  // these are the same two reads the R15 preconditions use in production.
  const transfers = app.get(TokenTransferService);
  console.log('\n=== balances (the R15 precondition reads) ===');
  console.log(`funder   ${funder}  ${await transfers.funderUsdcCents()}¢ USDC`);
  console.log(`operator ${operator}  ${await transfers.operatorUsdcCents()}¢ USDC`);

  console.log(`\n=== eth_estimateGas · transfer(${AMOUNT_CENTS}¢) · NO TRANSACTION SENT ===`);

  const legs = [
    ['top-up   funder → operator', funderClient, operator],
    ['cash-out operator → funder', operatorClient, funder],
  ] as const;

  const readings: bigint[] = [];
  for (const [label, walletClient, to] of legs) {
    const gas = await measureGas({
      publicClient,
      walletClient,
      address: usdc,
      abi: erc20Abi,
      functionName: 'transfer',
      args: [to, toBaseUnits(AMOUNT_CENTS)],
    });
    readings.push(gas);
    console.log(`${label}:  ${gas}`);
  }

  const max = readings.reduce((a, b) => (b > a ? b : a));
  const recommended = BigInt(Math.ceil(Number(max) * MARGIN));
  const current = GAS_LIMITS.transfer;

  console.log('\n=== verdict ===');
  console.log(`max reading:        ${max}`);
  console.log(`recommended (×${MARGIN}): ${recommended}  ← round UP to a sensible figure`);
  console.log(
    `GAS_LIMITS.transfer: ${current}  (${(Number(current) / Number(max)).toFixed(2)}× the max reading)`,
  );
  console.log(
    current >= recommended
      ? '  ✅ the current ceiling clears the recommendation'
      : `  ❌ the current ceiling is BELOW the recommendation — every transfer risks ` +
          `reverting out-of-gas, with the full limit charged anyway`,
  );

  await app.close();
}

main().catch((err: unknown) => {
  console.error('\nMEASUREMENT FAILED:', err);
  process.exit(1);
});
