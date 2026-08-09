# Implementation Plan: Wallet Auth

**Branch**: `004-wallet-auth` | **Date**: 2026-08-08 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/004-wallet-auth/spec.md`

## Summary

`src/auth/` — two public endpoints, an in-memory single-use challenge store, one
signature recovery, and a global guard that every later module inherits. Plus
`src/accounts/`, holding the one repository method that turns a verified wallet into an
account.

A third endpoint, `GET /auth/session`, is protected and exists so the guard has something
to guard: without it, FR-014 and FR-015 stay undemonstrable until API-05 ships. It is two
lines over `@CurrentAccount()` and answers the question the UI asks on load — *is my
stored token still good, and whose is it?* It does not overlap `/me`, which arrives in
API-05 carrying balance and escrow.

**No migration.** The `accounts` table and its case-insensitive unique index already
exist from API-02; this feature is the first thing that writes a row into them.

Four decisions carry the feature, and all four are settled in
[research.md](./research.md):

- **The challenge lives in process memory, and is consumed before the signature is
  checked.** Node's single thread makes read-and-delete atomic, so single-use is free of
  locks (R1); consuming first is what makes a captured message worth exactly one guess
  rather than five minutes of them (R4).
- **The guard is global and fails closed.** Every route is protected unless marked
  `@Public()`. This **reverses FR-016 as originally written** — see the deviation note
  below and R8.
- **`/auth/nonce` returns the composed message, not just the nonce.** The server owns the
  exact bytes the user signs, so the format cannot drift between UI and API (R3). A
  small, additive extension of the shape in `docs/api-design.md` §3.1.
- **Every verification failure looks identical from outside.** One 401, one message. The
  cause goes to the log, because a response that distinguished "no challenge for this
  address" would let anyone enumerate which wallets hold accounts (R12).

Verified against the installed toolchain before planning finished: viem 2.55.11's
`recoverMessageAddress` returns a checksummed address and round-trips a multi-line
message, and Foundry's `cast wallet sign` interoperates with it — which is what makes the
manual verification in [quickstart.md](./quickstart.md) runnable today, without the UI
(R5, R15).

**No external blockers.** Nothing here touches the chain, the LLM, or Rain; the feature
runs against Postgres alone and works with the Monad RPC endpoint down.

### Deviation from the spec, recorded

FR-016 originally read *"endpoints MUST be public unless explicitly marked as
protected."* The plan does the opposite and the spec has been updated to match.

The reason is in this codebase, not in general security advice.
`src/health/health.controller.ts` already says *"Unauthenticated by design, and it must
stay that way once auth lands — a health check behind a guard is a health check nothing
can call"* — a warning that only needs writing if a global guard is expected to sweep it
up. And `src/chain/chain.module.ts` states the house rule outright: a separation is *"only
real if [violating it] is a compile error rather than a code-review question."*

The two defaults differ only in the failure mode of forgetting. Opt-in leaves
`POST /withdraw` open; opt-out leaves `GET /agents` returning 401 until the first page
load. One is found by an attacker, the other by a developer. Full argument in R8.

## Technical Context

**Language/Version**: TypeScript on Node 24 (container) / 26 (host), compiled by
TypeScript 6.0.3 — pinned in API-01. No `tsconfig.json` change.

**Primary Dependencies**: **`@nestjs/jwt` ^11.0.2** — the one new dependency (peer range
covers `@nestjs/common` ^11; it wraps `jsonwebtoken` 9.0.3). Everything else is already
present: **viem ^2.55.11** for signature recovery and address checksumming, **zod ^4.4.3**
for request validation, NestJS 11, TypeORM 1.1.0.

**Storage**: Postgres, `accounts` only — one `SELECT`, one `INSERT`, and one `SELECT` per
protected request. **No new table and no migration**: the schema from API-02 already has
`accounts` and `accounts_wallet_lower_idx`. Challenges are held in process memory and
never persisted (R1).

**Testing**: None. Automated tests are out of scope for this component per
[`docs/CONTEXT.md`](../../docs/CONTEXT.md); verification is the manual pass in
[quickstart.md](./quickstart.md), driven from a shell with `cast` and `curl`.

**Target Platform**: Linux container via Compose; also runs on the host. No network
dependency beyond Postgres.

**Performance Goals**: Not a throughput feature. The relevant costs are one Postgres
primary-key lookup per protected request (FR-017 requires it — a token naming a deleted
account must fail) and one secp256k1 recovery per sign-in, which is sub-millisecond and
happens twice per demo.

**Constraints**:
- One challenge outstanding per address; issuing a new one supersedes the old.
- A challenge is single-use and consumed **before** the signature is examined.
- Stored addresses are EIP-55 checksummed; every lookup compares on `lower(...)` so the
  functional unique index is used (R6).
- No route reachable without a credential unless it carries `@Public()`.
- No roles anywhere — the account model has no field to check (FR-018).
- Verification responses never reveal whether an address is registered (FR-019).
- No viem import outside `src/chain/`, **`src/auth/` and `src/accounts/`** — this feature
  widens that API-03 rule by two directories, for pure address and signature helpers only
  (`getAddress`, `recoverMessageAddress`, and the `Address`/`Hex` types). Neither new
  directory imports a client, sends a transaction, or reads chain state.
  *`src/accounts/` was added to this list during implementation: the T048 boundary check
  caught `account.repository.ts` importing `getAddress`, and the right fix was the rule,
  not the code — canonicalising at the point of write is what makes "every stored address
  is checksummed" an invariant of the row rather than a promise each caller keeps.*

**Scale/Scope**: Demo scale — a handful of accounts, tens of sign-ins per rehearsal.
About 16 new source files, one new dependency, one new environment key, no migration.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

`.specify/memory/constitution.md` is still the unmodified Spec Kit template — all
`[PRINCIPLE_N_NAME]` placeholders, no ratified principles. **Result: PASS (vacuous)**,
recorded as a known gap rather than an oversight, exactly as in API-01, API-02 and
API-03.

The governance that actually binds is `docs/CONTEXT.md` §2 (nine invariants) and
`docs/api-design.md` §7. This feature touches **none of the nine invariants directly** —
it moves no money, writes no ledger entry, opens no deal, and makes no contract call. The
rule it does enforce is §7's **"seller and buyer are the same account; ownership is
checked per resource, not by role"**, and it enforces it structurally: there is no role
column, no role claim in the token, and nothing for a later module to branch on.

**Post-Phase-1 re-check: PASS.** The design adds no persistent state beyond a row in an
existing table, introduces no second money unit, and creates no import edge between
`execution` and `guardian`. The one deliberate widening — viem in `src/auth/` — is
recorded under Complexity Tracking below.

## Project Structure

### Documentation (this feature)

```text
specs/004-wallet-auth/
├── plan.md              # This file
├── research.md          # Phase 0 — R1–R15
├── data-model.md        # Phase 1
├── quickstart.md        # Phase 1 — the manual verification pass
├── contracts/
│   ├── auth-api.md      # The two HTTP endpoints
│   ├── guard-contract.md# What other modules consume: @Public, @CurrentAccount
│   └── errors.md        # Failure taxonomy and what each one may reveal
├── checklists/
│   └── requirements.md  # From /speckit-specify
└── tasks.md             # NOT created by /speckit-plan
```

### Source Code (repository root)

```text
api/src/
├── auth/                          # NEW — sign-in and the guard
│   ├── auth.module.ts             # Wires JwtModule, registers the global APP_GUARD
│   ├── auth.controller.ts         # POST /auth/nonce, POST /auth/verify (@Public),
│   │                              #   GET /auth/session (protected — the guard's witness)
│   ├── auth.service.ts            # issueNonce / verifySignature — the whole flow
│   ├── auth.constants.ts          # NONCE_TTL_MS (5 min), JWT_TTL ('7d'), sweep interval
│   ├── nonce.store.ts             # In-memory single-use challenge store (R1)
│   ├── sign-in-message.ts         # buildSignInMessage(address, nonce) — the exact bytes
│   ├── jwt-payload.ts             # { sub } + iat/exp, and its type guard
│   ├── jwt-auth.guard.ts          # Global, fail-closed; loads the account (R8)
│   ├── public.decorator.ts        # @Public() — the only way out of the guard
│   ├── current-account.decorator.ts # @CurrentAccount() — what handlers use (R9)
│   ├── request-with-account.ts    # Express Request augmentation, so it is typed
│   ├── errors.ts                  # AuthError hierarchy, mirroring chain/errors.ts
│   └── dto/
│       ├── nonce.dto.ts           # Zod schema + inferred request/response types
│       └── verify.dto.ts
├── accounts/                      # NEW — owns the account row (CONTEXT §3)
│   ├── accounts.module.ts         # Exports AccountRepository for auth and for API-05
│   └── account.repository.ts      # findOrCreateByAddress, findById (R11)
├── common/
│   └── zod-validation.pipe.ts     # NEW — reusable, Zod-backed (R10)
├── config/
│   └── env.schema.ts              # MODIFIED — adds JWT_SECRET
├── health/
│   └── health.controller.ts       # MODIFIED — gains @Public()
├── app.module.ts                  # MODIFIED — imports AuthModule, AccountsModule
├── chain/                         # untouched
├── entities/                      # untouched — Account already exists
├── ledger/                        # untouched
└── migrations/                    # untouched — no migration in this feature

guardian/
├── .env                           # MODIFIED — JWT_SECRET
└── .env.example                   # MODIFIED — JWT_SECRET with a placeholder
```

**Structure Decision**: Two new modules, split along the boundary
`docs/CONTEXT.md` §3 already draws — `auth` owns sign-in, `accounts` owns the account
row. Putting `AccountRepository` in `src/accounts/` rather than inside `src/auth/`
follows the precedent `LedgerModule` set in API-02: created early with a single method
and exported specifically so API-05 can build the rest of the module on it.
`ZodValidationPipe` goes in a new `src/common/` because it is not an auth concept and
every later module will want it.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| viem imported outside `src/chain/` — in `src/auth/` **and `src/accounts/`** (API-03 constrained it to one directory) | Signature recovery and EIP-55 checksumming are pure functions with no client, no RPC, and no unit conversion — the three things the original rule exists to contain. `src/accounts/` needs `getAddress` because canonicalisation belongs at the write point: enforced in the repository it is an invariant of the row, enforced in a caller it is a convention every future writer must remember | Re-exporting the helpers through `ChainModule` would make `auth` depend on the chain adapter to do arithmetic-free string work, and would put a service boundary between a caller and `getAddress()`. Writing the recovery by hand is strictly worse. The rule's intent — no unit conversion and no unmediated chain access outside `chain/` — is unaffected |
| A second module (`accounts/`) created for one repository | `docs/CONTEXT.md` §3 assigns the account to `accounts`, not `auth`; API-05 builds `/me`, balance and ledger on exactly this repository | Keeping it in `src/auth/` would mean API-05 either imports from `auth` to read an account, or moves the file and rewrites the imports. `LedgerModule` set this precedent in API-02 for the same reason |
| Global guard reverses FR-016's stated default | Fail-closed: forgetting to mark an endpoint leaves it protected rather than open, and `POST /withdraw` is among the endpoints in question | Opt-in protection, as first specified — rejected in R8. The codebase's existing comments in `health.controller.ts` and `chain.module.ts` both anticipate this default |
