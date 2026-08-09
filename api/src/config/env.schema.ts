import { z } from 'zod';

/**
 * Single source of configuration truth for the API.
 *
 * `envSchema` is parsed exactly once at boot (see the config module that
 * loads it). Every key declared below is REQUIRED unless a `.default(...)`
 * is shown inline, which means the inferred `AppConfig` type has no
 * optional members — consumers can read `config.WHATEVER` directly with no
 * null-checks at the point of use.
 *
 * NOTE: `DEPLOYER_PRIVATE_KEY` is intentionally NOT part of this schema.
 * That key is used exactly once, by a Foundry deploy script, to deploy the
 * escrow contract. The running API must never be able to read it — giving
 * the API process a key capable of signing a contract deployment would
 * collapse the operator/guardian/deployer role separation the system
 * relies on for its security model.
 */

export const envSchema = z.object({
  // ---------------------------------------------------------------------
  // CORE
  // ---------------------------------------------------------------------
  // One rule, not `.min(1)` plus `.regex(...)`: both would fail on an empty
  // value and the report would name the same key twice.
  DATABASE_URL: z
    .string()
    .regex(
      /^postgres(ql)?:\/\/.+/,
      'expected a connection string starting with postgresql:// or postgres://',
    ),

  PORT: z.coerce
    .number('expected an integer between 1 and 65535')
    .int('expected an integer between 1 and 65535')
    .min(1, 'expected an integer between 1 and 65535')
    .max(65535, 'expected an integer between 1 and 65535')
    .default(3000),

  NODE_ENV: z
    .enum(['development', 'production', 'test'], {
      error: "expected one of 'development' | 'production' | 'test'",
    })
    .default('development'),

  // ---------------------------------------------------------------------
  // CHAIN
  // ---------------------------------------------------------------------
  MONAD_RPC_URL: z.url('expected a valid URL'),

  MONAD_CHAIN_ID: z.coerce
    .number('expected a positive integer')
    .int('expected a positive integer')
    .positive('expected a positive integer'),

  MONAD_EXPLORER_URL: z.url('expected a valid URL'),

  USDC_ADDRESS: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/, 'expected 0x-prefixed 40-hex-char address'),

  ESCROW_CONTRACT_ADDRESS: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/, 'expected 0x-prefixed 40-hex-char address'),

  OPERATOR_ADDRESS: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/, 'expected 0x-prefixed 40-hex-char address'),

  GUARDIAN_ADDRESS: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/, 'expected 0x-prefixed 40-hex-char address'),

  FUNDER_ADDRESS: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/, 'expected 0x-prefixed 40-hex-char address'),

  OPERATOR_PRIVATE_KEY: z
    .string()
    .regex(
      /^0x[a-fA-F0-9]{64}$/,
      'expected 0x-prefixed 64-hex-char private key',
    ),

  GUARDIAN_PRIVATE_KEY: z
    .string()
    .regex(
      /^0x[a-fA-F0-9]{64}$/,
      'expected 0x-prefixed 64-hex-char private key',
    ),

  FUNDER_PRIVATE_KEY: z
    .string()
    .regex(
      /^0x[a-fA-F0-9]{64}$/,
      'expected 0x-prefixed 64-hex-char private key',
    ),

  // ---------------------------------------------------------------------
  // AUTH
  // ---------------------------------------------------------------------
  // Signs and verifies every session token (HS256, one process doing both —
  // see specs/004-wallet-auth/research.md R7).
  //
  // The two DURATIONS that go with it — the 7-day token life and the 5-minute
  // sign-in challenge — are deliberately NOT here. They are neither secret nor
  // per-deployment, so they live as constants in src/auth/auth.constants.ts.
  // Every optional environment key is one more thing that can be absent at 3am.
  //
  // 32 characters is the floor rather than `.min(1)`: this one secret forges a
  // token for every account at once, and there is no revocation to contain it.
  // One rule, not two, so the report never names the key twice.
  JWT_SECRET: z.string().min(32, 'expected at least 32 characters'),

  // ---------------------------------------------------------------------
  // LLM
  // ---------------------------------------------------------------------
  ANTHROPIC_API_KEY: z.string().min(1, 'expected a non-empty string'),

  // ---------------------------------------------------------------------
  // RAIN
  // ---------------------------------------------------------------------
  // Explicit string -> boolean mapping. z.coerce.boolean() is deliberately
  // avoided here: it coerces via `Boolean(value)`, so the non-empty string
  // "false" would coerce to `true`, which is the opposite of intent.
  RAIN_ENABLED: z
    .enum(['true', 'false'], {
      error: "expected the string 'true' or 'false'",
    })
    .transform((value) => value === 'true'),

  RAIN_BASE_URL: z.url('expected a valid URL'),

  RAIN_API_KEY: z.string().min(1, 'expected a non-empty string'),

  RAIN_TEAM_ID: z.string().min(1, 'expected a non-empty string'),

  RAIN_USER_ID: z.string().min(1, 'expected a non-empty string'),

  RAIN_COLLATERAL_CONTRACT_ID: z
    .string()
    .min(1, 'expected a non-empty string'),

  // ---------------------------------------------------------------------
  // TUNING
  // ---------------------------------------------------------------------
  REVIEW_WINDOW_SECONDS: z.coerce
    .number('expected an integer >= 1')
    .int('expected an integer >= 1')
    .min(1, 'expected an integer >= 1'),

  SWEEPER_INTERVAL_MS: z.coerce
    .number('expected a positive integer')
    .int('expected a positive integer')
    .positive('expected a positive integer'),
});

export type AppConfig = z.infer<typeof envSchema>;
