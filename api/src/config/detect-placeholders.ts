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

/**
 * The shipped .env.example JWT secret. Worth naming even though a placeholder
 * secret still signs and verifies perfectly well — that is exactly the problem.
 * Every developer who copies .env.example signs with the same key, so a token
 * minted on one machine is accepted on every other one, and the key itself is
 * in git history forever. The chain placeholders at least fail loudly on-chain;
 * this one never errors at all. Auth just quietly stops being secret.
 */
const JWT_SECRET_PLACEHOLDER =
  'placeholder-jwt-secret-replace-me-before-running-0000';

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
    'JWT_SECRET',
  ];

  return suspects.filter((key) => {
    const value = config[key];
    if (typeof value !== 'string') return false;

    return (
      HEX_PLACEHOLDER.test(value) ||
      value.startsWith(ANTHROPIC_PLACEHOLDER) ||
      value.startsWith(JWT_SECRET_PLACEHOLDER)
    );
  });
}

export function warnAboutPlaceholders(config: AppConfig): void {
  const found = detectPlaceholders(config);
  if (found.length === 0) return;

  // Deliberately vague about the consequence now that JWT_SECRET is in scope.
  // The old wording — "no chain or LLM path will work" — was true of every key
  // this checked until auth arrived, and is exactly wrong for JWT_SECRET: a
  // placeholder secret works perfectly, it is just shared with everyone who
  // ever cloned the repository. Naming a consequence that does not apply to
  // every listed key teaches the reader to skim the line.
  const label = found.length === 1 ? 'value is' : 'values are';

  new Logger('Config').warn(
    `${found.length} configuration ${label} still a placeholder — ` +
      `replace before relying on: ${found.join(', ')}`,
  );
}
