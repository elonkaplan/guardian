# Phase 1 Data Model: Wallet Auth

**Feature**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md) · **Date**: 2026-08-08

Three entities. **One is persisted and already exists**, one lives in process memory and
is never written down, one exists only inside a signed string. No migration is part of
this feature.

---

## 1. `Account` — persisted, unchanged

**Table**: `accounts` · **Entity**: `src/entities/account.entity.ts` · **Created by**:
API-02

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` PK, `gen_random_uuid()` | The `sub` claim of every token |
| `wallet_address` | `text NOT NULL` | **EIP-55 checksummed.** Identity *and* payout address |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` | Set by the database |

**Uniqueness**: `CREATE UNIQUE INDEX accounts_wallet_lower_idx ON accounts (lower(wallet_address))`
— a **functional** index, created in the migration, not expressible as a TypeORM
decorator. The entity file carries a long comment explaining why, and a warning that
`migration:generate` may propose dropping it. That output must not be applied.

**No role column, and none is added.** `docs/api-design.md` §7: the same account both
buys and sells; permission comes from owning the specific resource
(`agents.owner_account_id`, `orders.buyer_account_id`). FR-018 is satisfied by there
being nothing to check.

### What this feature adds

Nothing structural. It supplies the **first writer** of the table, and with it two rules
the schema alone cannot express:

- **Write rule**: `wallet_address` is always the output of viem's `getAddress()`. No
  other casing is ever stored.
- **Read rule**: every lookup by address compares `lower(wallet_address)` against a
  lowered input, so the query matches the functional index (R6). A
  `findOne({ where: { walletAddress } })` would be case-sensitive *and* would not use the
  index — wrong result, sequential scan.

### Access

`AccountRepository` in `src/accounts/`, exported by `AccountsModule`:

| Method | Contract |
| --- | --- |
| `findOrCreateByAddress(address: Address): Promise<Account>` | Canonicalises, looks up by lowered address, inserts if absent. Returns the account either way — the caller cannot tell, and does not need to (FR-007, FR-008) |
| `findById(id: string): Promise<Account \| null>` | Used by the guard on every protected request. `null`, not a throw — "no such account" is the guard's business to interpret (FR-017) |

`findOrCreateByAddress` is one method rather than a `find` plus a `create` because a
caller able to invoke them separately is a caller able to invoke them in the wrong order.
No retry-on-unique-violation is written: at most one verify per address can be in flight
past the signature check, since an address has one outstanding challenge and consuming it
is atomic (R11).

---

## 2. `StoredNonce` — in memory, never persisted

**Location**: `src/auth/nonce.store.ts` · **Lifetime**: 5 minutes or one use, whichever
comes first · **Survives restart**: no, deliberately (R1)

```text
Map<string, StoredNonce>          key: address.toLowerCase()
  nonce      string               64 hex chars — 32 random bytes (R2)
  address    Address              the checksummed address it was issued for
  expiresAt  number               epoch ms; issuedAt + NONCE_TTL_MS
```

**Keyed by lowered address, holding at most one entry per address.** Issuing a new
challenge overwrites any earlier one, so "at most one outstanding challenge per address"
is a property of the data structure rather than a rule someone has to enforce. That is
what makes US4 scenario 6 — an older challenge used after a newer one was issued —
deterministic: the older value is simply gone.

### Operations

| Method | Contract |
| --- | --- |
| `issue(address: Address): string` | Generates, stores (replacing any existing entry), returns the nonce |
| `consume(address: Address): StoredNonce \| null` | **Reads and deletes in one step.** Returns `null` if absent or expired; an expired entry is deleted on the way out |
| `sweep(): void` | Interval-driven removal of expired entries; cleared in `onModuleDestroy` |

`consume` is the whole security story of the store, and it is safe for a reason specific
to the runtime: Node executes it on one thread with no `await` inside, so no other
request can observe the entry between the read and the delete. Single-use (FR-004) needs
no lock and no transaction.

**Expiry is checked on read, not only by the sweep** — the sweep is for bounding memory,
not for correctness. A boundary comparison uses `now >= expiresAt`, so an entry at
exactly its expiry instant is expired. Erring toward refusal is the spec's stated
preference for clock-skew edges.

### Why it is not a table

Persisting a challenge buys survival across a restart; what it preserves is one click.
Against that it costs a migration, an entity, a cleanup job, and — the real cost — a
concurrent-consumption problem that the in-memory version does not have. Full comparison,
including why a stateless HMAC challenge is *unsafe* rather than merely different, in R1.

---

## 3. `JwtPayload` — inside the token

**Location**: `src/auth/jwt-payload.ts` · **Algorithm**: HS256 · **Lifetime**: 7 days
(`JWT_TTL`, a code constant)

```text
sub  string   the account's uuid
iat  number   issued at, seconds — set by @nestjs/jwt
exp  number   expires at, seconds — set by @nestjs/jwt
```

**That is the entire payload.** No wallet address, no role (FR-018 — there are none), no
email, no permissions. The guard loads the account from Postgres on every protected
request to satisfy FR-017, so any additional claim would be a second copy of a fact about
to be read authoritatively — and a second copy is how a token comes to disagree with the
database.

**Signing key**: `JWT_SECRET`, a **new** required key in `src/config/env.schema.ts`,
minimum 32 characters, also added to the repository-root `.env` and `.env.example`. The
two durations are *not* environment keys: they are neither secret nor per-deployment, and
`env.schema.ts`'s own header explains why every key there is required — so that nothing
downstream null-checks.

**Not revocable.** There is no session table and no denylist, so a token is valid until
`exp`. Accepted for the MVP and flagged in R13 as the first thing to change for real
users.

---

## Relationships

```text
wallet address ──issue──▶ StoredNonce ──consume + recover──▶ Account ──sign──▶ JwtPayload
   (client)                (memory, 1 use)                    (postgres)        (bearer)
                                                                  ▲                 │
                                                                  └──── sub ────────┘
                                                                    (guard, per request)
```

The loop at the right is FR-017: the token names an account, and the guard resolves that
name against the database rather than trusting the claim. A token whose `sub` no longer
exists is refused.

---

## Validation rules, and where each is enforced

| Rule | Enforced at | Requirement |
| --- | --- | --- |
| Address is `0x` + 40 hex | `ZodValidationPipe` on both endpoints — handler never runs | FR-002 |
| Address is stored checksummed | `getAddress()` in `AccountRepository`, on the write path | FR-009 |
| Two casings are one account | `lower(wallet_address) = :lower` lookup **and** `accounts_wallet_lower_idx` | FR-010 |
| Challenge is bound to its address | Map key is the address; a challenge cannot be looked up under another | FR-001 |
| Challenge expires | `consume()` compares against `expiresAt` | FR-003 |
| Challenge is single-use | `consume()` deletes before returning; failure does not restore it | FR-004 |
| Signer matches the claimed address | `recoverMessageAddress(...) === stored.address` | FR-005 |
| Signed message contains the nonce | `buildSignInMessage()` composes it; the server rebuilds it to verify | FR-006 |
| Token is tamper-evident | HS256 signature, checked by `jwtService.verifyAsync` | FR-012 |
| Token expires | `exp`, set from `JWT_TTL`, checked by `verifyAsync` | FR-013 |
| Unmarked routes are protected | Global `APP_GUARD`; `@Public()` is the only exit | FR-016 |
| A token's account still exists | `findById` in the guard | FR-017 |
| Failures reveal nothing about registration | One 401 message for every verify failure; cause to the log only | FR-019 |
