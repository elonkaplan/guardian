# Contract: Configuration Schema

**Source**: one file, `guardian/.env`, at the repository root — shared by `api/`,
`ui/`, and `sc/`. Gitignored; [`guardian/.env.example`](../../../../.env.example) is
the committed template.

**Reading rule**: every row below is **enforced at boot by API-01** (FR-010). Missing or
malformed → boot aborts, key named on stderr, non-zero exit. `src/config/env.schema.ts`
matches this file row for row; no later spec adds configuration plumbing.

---

## Core

| Key | Type / format | Default | Secret | Notes |
| --- | --- | --- | --- | --- |
| `DATABASE_URL` | non-empty string, `postgresql://` URL | — required | ✅ | Overridden in Compose to host `postgres`; the `.env` value targets `localhost` for host runs |
| `PORT` | integer, 1–65535 | `3000` | — | Coerced to `number` at the boundary |
| `NODE_ENV` | enum: `development` \| `production` \| `test` | `development` | — | — |

## Chain

| Key | Type / format | Secret | Notes |
| --- | --- | --- | --- |
| `MONAD_RPC_URL` | URL | — | Monad testnet RPC |
| `MONAD_CHAIN_ID` | positive integer | — | `10143` for testnet |
| `MONAD_EXPLORER_URL` | URL | — | Used to build verdict-card transaction links |
| `USDC_ADDRESS` | `/^0x[a-fA-F0-9]{40}$/` | — | 6 decimals — the `× 10⁴` boundary lives only in `chain/` |
| `ESCROW_CONTRACT_ADDRESS` | `/^0x[a-fA-F0-9]{40}$/` | — | 🔶 placeholder until `sc/` deploys |
| `OPERATOR_ADDRESS` | `/^0x[a-fA-F0-9]{40}$/` | — | 🔶 placeholder |
| `OPERATOR_PRIVATE_KEY` | `/^0x[a-fA-F0-9]{64}$/` | ✅ | 🔶 placeholder. Signs everything except `resolve` |
| `GUARDIAN_ADDRESS` | `/^0x[a-fA-F0-9]{40}$/` | — | 🔶 placeholder |
| `GUARDIAN_PRIVATE_KEY` | `/^0x[a-fA-F0-9]{64}$/` | ✅ | 🔶 placeholder. **`resolve` only** — its client gets a single-function ABI |
| `FUNDER_ADDRESS` | `/^0x[a-fA-F0-9]{40}$/` | — | 🔶 placeholder. Source of all test money |
| `FUNDER_PRIVATE_KEY` | `/^0x[a-fA-F0-9]{64}$/` | ✅ | 🔶 placeholder |

**`DEPLOYER_PRIVATE_KEY` is deliberately NOT in this schema.** It is used once by
`forge script`; nothing in the running system reads it. Validating it would make it
injectable, and an API that can sign a deployment is the opposite of the role
separation in [`docs/CONTEXT.md`](../../../../docs/CONTEXT.md) §5. It stays in `.env`
for `sc/` alone.

## LLM

| Key | Type / format | Secret | Notes |
| --- | --- | --- | --- |
| `ANTHROPIC_API_KEY` | non-empty string | ✅ | 🔶 placeholder. Both LLM roles share one key |

## Rain — stubbed

| Key | Type / format | Secret | Notes |
| --- | --- | --- | --- |
| `RAIN_ENABLED` | boolean, coerced from `'true'`/`'false'` | — | `false` — the stub logs the call it would make |
| `RAIN_BASE_URL` | URL | — | — |
| `RAIN_API_KEY` | non-empty string | ✅ | — |
| `RAIN_TEAM_ID` | non-empty string | — | One team for the whole platform, not per end-user |
| `RAIN_USER_ID` | non-empty string | — | Likewise |
| `RAIN_COLLATERAL_CONTRACT_ID` | non-empty string | — | — |

## Product tuning

| Key | Type / format | Secret | Notes |
| --- | --- | --- | --- |
| `REVIEW_WINDOW_SECONDS` | integer **≥ 1** | — | Never `0` — see [`docs/smart-contract.md`](../../../../docs/smart-contract.md) §11.3. Demo value is `30`; production default `86400` |
| `SWEEPER_INTERVAL_MS` | positive integer | — | Auto-release poll cadence |

---

## Placeholders

Rows marked 🔶 currently hold **format-valid fakes** — the `sc/` deploy and the wallet
funding haven't happened yet. The convention, documented at the top of `.env`:

| Kind | Shape | Role tag |
| --- | --- | --- |
| Address | `0xDEAD` + zeros + 4 digits | `1111` escrow · `2222` funder · `3333` operator · `4444` guardian |
| Private key | same, 64 hex | same |
| Anthropic key | `sk-ant-placeholder-…` | — |

**Boot-time detection is part of this contract.** After validation succeeds, the config
layer matches values against `/^0xDEAD0+\d{4}$/` and the `sk-ant-placeholder` prefix,
and emits one `WARN` naming every key still holding a fake — names only, never values.
It does not block boot. Rationale in
[research.md R9](../research.md#r9--placeholder-detection-at-boot).

**Done when**: `grep -n 'TODO(placeholder)' .env` is empty and the boot warning is
silent.

---

## Behavioral contract

| Rule | Requirement |
| --- | --- |
| **Parsed once** | At boot, before the first request. Never re-read; the result is immutable. |
| **All errors at once** | A failure lists every offending key, not the first. |
| **Names, never values** | Error output prints the key and its expected form. It never prints the received value — several of these keys *are* private keys. |
| **No optional members** | An activated key is required and non-empty, so `AppConfig` has no `string \| undefined` members and no consumer null-checks at point of use. |
| **Unknown keys ignored** | The schema is not `.strict()` — the OS environment always carries unrelated variables. |
| **Secrets never logged** | Not at boot, not on failure, not in `/health`, not in TypeORM query logs (which is why query logging is limited to `error` and `warn`). |
