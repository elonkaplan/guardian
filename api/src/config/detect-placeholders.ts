import { Logger } from '@nestjs/common';

import { type AppConfig } from './env.schema';

/**
 * The repository-root .env ships with format-valid fakes for everything that
 * depends on the `sc/` deploy and the wallet funding. They pass validation on
 * purpose — that is what lets the whole platform schema be enforced before the
 * contract exists.
 *
 * The cost is that a placeholder defers its failure and moves it far from its
 * cause. A fake private key is a perfectly good secp256k1 scalar, so viem will
 * derive an address, sign a transaction, and fail on-chain against an unfunded
 * account — an error that reads as a funding problem or an RPC problem, and
 * absolutely not as "you forgot to fill the .env".
 *
 * So we say it out loud at boot. Names only, never values. Non-blocking: the
 * entire point of the placeholders is that the service must start before the
 * contract is deployed.
 */

/** Matches the `0xDEAD…<role digits>` convention documented at the top of .env. */
const HEX_PLACEHOLDER = /^0xDEAD0+\d{4}$/i;
const ANTHROPIC_PLACEHOLDER = 'sk-ant-placeholder';

export function detectPlaceholders(config: AppConfig): readonly string[] {
  const suspects: Array<keyof AppConfig> = [
    'ESCROW_CONTRACT_ADDRESS',
    'USDC_ADDRESS',
    'OPERATOR_ADDRESS',
    'OPERATOR_PRIVATE_KEY',
    'GUARDIAN_ADDRESS',
    'GUARDIAN_PRIVATE_KEY',
    'FUNDER_ADDRESS',
    'FUNDER_PRIVATE_KEY',
    'ANTHROPIC_API_KEY',
  ];

  return suspects.filter((key) => {
    const value = config[key];
    if (typeof value !== 'string') return false;

    return (
      HEX_PLACEHOLDER.test(value) || value.startsWith(ANTHROPIC_PLACEHOLDER)
    );
  });
}

export function warnAboutPlaceholders(config: AppConfig): void {
  const found = detectPlaceholders(config);
  if (found.length === 0) return;

  new Logger('Config').warn(
    `${found.length} configuration ${found.length === 1 ? 'value is' : 'values are'} still placeholders — ` +
      `no chain or LLM path will work until they are replaced: ${found.join(', ')}`,
  );
}
