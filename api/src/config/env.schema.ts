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

  // The payout address every seeded demo agent is registered under, and
  // therefore where every seller payout in the demo lands — Act 1's full
  // release and Act 2's split both arrive here.
  //
  // ⚠️ REQUIRED rather than defaulted or optional, and the difference is not
  // stylistic. `registerAgent(owner, …)` fixes the payout address at
  // registration and `updateAgent` cannot change it, so a wrong value cannot be
  // corrected — only re-registered as a second agent, which is exactly the
  // "seller owns two agents, one unreachable" state agent-writes.service.ts
  // spends a paragraph forbidding. Requiring it here makes an absent value a
  // boot failure named in the preflight report, rather than a seed that
  // succeeds against an address nobody in the room controls.
  //
  // No default for the same reason: any address this file could invent is one
  // whose key nobody holds. (specs/011-demo-seed-fixtures/research.md R7)
  DEMO_SELLER_ADDRESS: z
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

  // How often the execution poller looks for an order to run. `orders.state` is
  // the queue (invariant #9), so this is the only thing that starts a run —
  // there is no dispatcher and no broker (API-07 R13, API-08 research R1).
  //
  // Tunable rather than a constant for the same reason `SWEEPER_INTERVAL_MS` is:
  // a rehearsal wants a second so a purchase visibly starts working, and a real
  // deployment does not want a query per second forever. Defaulted, unlike its
  // neighbour, because there is no value of this key that breaks a guarantee —
  // a slow poller delays a run, where a zero review window silently destroys the
  // buyer's right to complain.
  EXECUTION_POLL_INTERVAL_MS: z.coerce
    .number('expected a positive integer')
    .int('expected a positive integer')
    .positive('expected a positive integer')
    .default(1000),

  // How often the guardian poller looks for a disputed order to audit, and for
  // an adjudicated one still waiting on its `resolve` (research R1).
  //
  // Slower than `EXECUTION_POLL_INTERVAL_MS` on purpose: an audit is one long
  // model call rather than a stream of short ones, and pickup latency here is
  // bounded by "the ruling is readable within a minute of the complaint"
  // (SC-003) rather than by a screen refresh.
  GUARDIAN_POLL_INTERVAL_MS: z.coerce
    .number('expected a positive integer')
    .int('expected a positive integer')
    .positive('expected a positive integer')
    .default(2000),

  // The deadline on a single audit, enforced twice inside `ClaudeAuditor` — as
  // the SDK's own request timeout and as an `AbortController` armed for the same
  // instant (FR-038, research R14).
  //
  // Generous because thinking is on by default on Opus 5, so a real audit
  // legitimately runs for tens of seconds. Finite because one audit occupies the
  // poller's only slot: an unbounded call does not lose one dispute, it stops
  // every later dispute from being decided (SC-012).
  GUARDIAN_AUDIT_TIMEOUT_MS: z.coerce
    .number('expected a positive integer')
    .int('expected a positive integer')
    .positive('expected a positive integer')
    .default(180_000),
});

export type AppConfig = z.infer<typeof envSchema>;
