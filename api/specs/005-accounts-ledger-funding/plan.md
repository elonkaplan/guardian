# Implementation Plan: Accounts, Ledger & Funding

**Branch**: `005-accounts-ledger-funding` | **Date**: 2026-08-09 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/005-accounts-ledger-funding/spec.md`

## Summary

Seven endpoints across three new modules — `accounts` gains a controller, `funding` and
`rain` are new — plus a fourth viem client and one ERC-20 function the chain adapter does
not yet have.

**More of this feature already exists than is obvious.** `EscrowReadService.balanceOfCents`
(settled funds, already in cents), `EscrowOperatorService.withdrawFor`,
`BalanceRepository.getAvailableBalanceMinor`, `AccountRepository`, the global fail-closed
guard with `@CurrentAccount()`, `ZodValidationPipe`, the `LedgerEntry` entity and
`LedgerKind` enum, and `FUNDER_ADDRESS`/`FUNDER_PRIVATE_KEY` in `env.schema.ts` are all
in place. API-02 and API-04 built `LedgerModule` and `AccountsModule` with one method each
and documented that they were waiting for this feature.

**No migration.** Every table, column, index and enum comes from
`1786238842921-InitialSchema`. This feature is the first thing that writes a
`ledger_entries` row.

**Two real gaps in `chain/`**, both small and both easy to miss until compile time:

- **`transfer` is not in `erc20Abi`.** Neither funding leg touches the escrow — top-up is
  `USDC.transfer` signed by the funder, cash-out is `USDC.transfer` signed by the
  operator. `executeWrite` types `functionName` against the ABI's literal type, so this
  is a compile error, not a runtime surprise. It also needs a `GAS_LIMITS.transfer` entry,
  and Monad charges the **limit** (R4).
- **There is no funder client.** The env schema anticipated one; the client does not
  exist. It needs `nonceManager` for the same reason the operator's has it — two
  simultaneous top-ups from one key would otherwise fetch the same nonce and one would
  silently vanish from the mempool (R5).

Five decisions carry the feature, all settled in [research.md](./research.md):

- **The settled-funds read is bounded at 2 s by a `Promise.race`, not by transport
  config** (R1). viem's defaults are `timeout: 10_000 × retryCount: 3` — up to 40 s
  against a black-holed host, on an endpoint polled every 5 s. The budget has to be
  enforced on our side of the call.
- **`settledFundsMinor` is an explicit `null` that is always present in the JSON** (R2).
  `JSON.stringify` drops `undefined` keys, which would silently change the wire contract
  the UI was built against.
- **`ChainOutcomeUnknownError` must not trigger the cash-out compensation** (R6). This is
  the most dangerous branch in the feature — compensating a transfer that later confirms
  means the user cashed out *and* kept the balance, breaking `pool >= Σ ledger` in the
  unsafe direction.
- **Write order follows the direction rule** (R7): whichever write increases what the
  platform owes goes second. Top-up transfers then credits; cash-out debits then
  transfers.
- **Cash-out serialises on a `FOR UPDATE` lock over the account row** (R8). The constraint
  is over an aggregate — there is no balance column by design — so Postgres cannot enforce
  it declaratively.

**No external blockers.** No new npm dependency. Nothing here needs the LLM, and Rain is
stubbed by construction.

### A note on scope creep this plan deliberately refuses

`inEscrowMinor` needs `SUM(price_minor)` over the caller's open orders, and no orders
module exists. This plan creates `src/orders/` holding exactly one repository method and
one constant, following the pattern API-02 used twice (R11) — **not** an `Order` import
into `accounts/`, and **not** the beginnings of API-06.

## Technical Context

**Language/Version**: TypeScript 6.0.3 on Node ≥22, NestJS 11. No `tsconfig.json` change.

**Primary Dependencies**: **None added.** viem 2.55.11, TypeORM 1.1.0, zod 4.4.3,
`@nestjs/*` 11 — all already present.

**Storage**: PostgreSQL via TypeORM. Tables `accounts` (read + row lock),
`ledger_entries` (read + insert), `orders` (read). No schema change.

**Testing**: **None.** Automated tests are out of scope for `api/` (`docs/CONTEXT.md`).
[quickstart.md](./quickstart.md) is the verification procedure and is written to be run by
hand before every rehearsal.

**Target Platform**: Linux container, Docker Compose, against Monad testnet.

**Project Type**: Web service (NestJS REST API).

**Performance Goals**: `GET /me` must answer within the balance widget's 5 s poll interval
under every chain condition, including unreachable. Budget: 2 s hard ceiling on the chain
read, Postgres figures unaffected.

**Constraints**: `pool >= Σ ledger` at every intermediate point, including after a crash
mid-flow. Cents everywhere outside `chain/`. Ledger append-only. Settlement writes no
ledger entry.

**Scale/Scope**: Demo scale — tens of accounts, tens of ledger rows each. No pagination,
no rate limiting, no caching.

## Constitution Check

`.specify/memory/constitution.md` is an **unfilled template** — every principle is still
a `[PRINCIPLE_N_NAME]` placeholder. There are no ratified gates to evaluate, so this
section cannot pass or fail on its own terms.

The project's real governing document is `api/docs/CONTEXT.md` §2, and this plan is
checked against its nine invariants instead:

| # | Invariant | Status |
| --- | --- | --- |
| 1 | Two-phase flows ordered so a crash leaves the pool over-funded | ✅ R7 — per-flow table, both directions |
| 2 | One money unit: cents outside `chain/` | ✅ `balanceOfCents` and `toBaseUnits` are the only conversions; no new one added |
| 3 | `system_prompt` never reaches a buyer | ➖ not touched |
| 4 | Ledger append-only | ✅ inserts only; corrections are `adjustment` rows; quickstart §4 greps for `.update(`/`.delete(` |
| 5 | Settlement writes no ledger entry | ✅ `POST /withdraw` touches no table; quickstart §6 verifies the row count is unchanged |
| 6 | Orders point at `agent_version_id` | ➖ orders read by state only |
| 7 | `runs.output IS NULL` is evidence | ➖ not touched |
| 8 | Verdict persisted before the chain call | ✅ respected indirectly — `adjudicated` counts as escrowed precisely because `resolve` may not have landed (R3) |
| 9 | `orders.state` is the queue | ✅ read, never written |

**Module boundaries** (`docs/CONTEXT.md` §3) hold: `accounts` owns `/me`, `funding` owns
the money movements, `rain` owns the stubs, `orders` owns the order query, and `chain`
remains the only module that talks to Monad. No viem client is exported (R5), preserving
the guarantee `chain.tokens.ts` documents.

**One gate genuinely fails, and it is the project's own choice**: no automated tests. That
is a recorded, time-boxed MVP decision in `docs/CONTEXT.md`, not a gap this plan
introduces. See Complexity Tracking.

## Project Structure

### Documentation (this feature)

```text
specs/005-accounts-ledger-funding/
├── plan.md              # This file
├── research.md          # Phase 0 — 15 decisions
├── data-model.md        # Phase 1 — no migration; derived figures
├── quickstart.md        # Phase 1 — the manual test suite
├── contracts/
│   └── internal-api.md  # Phase 1 — literal paths and field names
├── checklists/
│   └── requirements.md
├── spec.md
└── tasks.md             # /speckit-tasks — NOT created here
```

### Source Code (repository root)

```text
api/src/
├── accounts/
│   ├── accounts.module.ts            # MODIFIED — controller, service, imports
│   ├── account.repository.ts         # unchanged
│   ├── accounts.controller.ts        # NEW — GET /me, GET /me/ledger
│   ├── accounts.service.ts           # NEW — assembles three figures; owns the 2s race
│   ├── accounts.constants.ts         # NEW — SETTLED_FUNDS_TIMEOUT_MS
│   └── dto/
│       ├── account-summary.dto.ts    # NEW — the literal field names
│       └── ledger-entry.dto.ts       # NEW
│
├── funding/                          # NEW MODULE
│   ├── funding.module.ts
│   ├── funding.controller.ts         # POST /topup, /withdraw, /offramp
│   ├── funding.service.ts            # ordering (R7), compensation (R6), lock (R8)
│   └── dto/
│       ├── topup.dto.ts
│       ├── offramp.dto.ts
│       └── withdraw.dto.ts
│
├── rain/                             # NEW MODULE
│   ├── rain.module.ts
│   ├── rain.controller.ts            # POST /onramp/routes, /offramp/routes
│   ├── rain-stub.service.ts          # builds the payload, logs at warn, calls nothing
│   └── rain-payloads.ts              # the request bodies Rain would receive
│
├── orders/                           # NEW MODULE — one read (R11)
│   ├── orders.module.ts
│   ├── escrow-exposure.repository.ts # sumOpenOrderValueMinor(accountId)
│   └── order-states.ts               # ESCROWED_ORDER_STATES
│
├── ledger/
│   ├── ledger.module.ts              # MODIFIED — export the writer
│   ├── balance.repository.ts         # unchanged
│   ├── ledger.repository.ts          # NEW — insert, statement, locked debit
│   └── ledger.errors.ts              # NEW — InsufficientBalanceError
│
├── chain/
│   ├── abi/erc20.abi.ts              # MODIFIED — add `transfer` (R4)
│   ├── chain.constants.ts            # MODIFIED — GAS_LIMITS.transfer (R4)
│   ├── chain.tokens.ts               # MODIFIED — FUNDER_CLIENT (R5)
│   ├── chain.module.ts               # MODIFIED — provide client + service
│   ├── chain-preflight.service.ts    # MODIFIED — sixth check: funder balances (R15)
│   ├── clients/funder.client.ts      # NEW
│   └── token-transfer.service.ts     # NEW — the two USDC transfers
│
├── common/
│   ├── zod-validation.pipe.ts        # unchanged
│   └── amount.schema.ts              # NEW — amountMinorSchema (R14)
│
└── app.module.ts                     # MODIFIED — register Funding, Rain, Orders

api/scripts/
└── measure-transfer-gas.ts           # NEW — free eth_estimateGas, both directions (R4)
```

**Structure Decision**: single NestJS project, one module per `docs/CONTEXT.md` §3
responsibility. `funding`, `rain` and `orders` are new modules rather than folders inside
`accounts` because the module map assigns them separately, and because API-06 extends
`orders` in place rather than relocating it.

The one structural judgement worth flagging: `token-transfer.service.ts` lives in
`chain/`, not `funding/`. `funding` owns *when* money moves and what it means; `chain`
owns *how* a transfer is signed and converted. Putting the viem call in `funding` would
make it the second module that knows base units exist, which breaks invariant #2's
containment argument.

## Phase 0 — Research

Complete. 15 decisions in [research.md](./research.md). No `NEEDS CLARIFICATION` markers
survived; the spec's Assumptions section resolved the open questions at spec time and this
phase resolved the implementation-level ones.

## Phase 1 — Design & Contracts

Complete:

- **[data-model.md](./data-model.md)** — no migration; the three derived figures and their
  sources; the six order states that count as escrowed; the compensation row's shape.
- **[contracts/internal-api.md](./contracts/internal-api.md)** — all seven endpoints with
  **literal** paths, field names and status codes, plus the failure matrix per endpoint.
- **[quickstart.md](./quickstart.md)** — the manual verification procedure, including the
  black-holed-host test that the `Promise.race` budget exists to pass and the concurrency
  test that the row lock exists to pass.

### Post-design constitution re-check

No change. No new dependency, no new module boundary crossed, no invariant weakened. The
design added one thing worth re-checking against invariant #2 — `GAS_LIMITS.transfer` and
the `transfer` ABI entry both live inside `chain/`, and `token-transfer.service.ts`
returns cents, so no unit conversion escaped the boundary.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| No automated tests | Time-boxed MVP decision recorded in `docs/CONTEXT.md`; only `sc/` keeps a suite, because a contract bug costs a redeploy | Not this feature's call to reverse. Mitigated by [quickstart.md](./quickstart.md) being written as a runnable procedure with explicit pass criteria, and by the rehearsal checklist in §10 |
| A fourth module (`orders/`) for one query | `docs/CONTEXT.md` §3 assigns orders to `orders`; API-06 extends it in place | Importing `Order` into `accounts/` works today and gets moved in three weeks with every import rewritten — the exact cost API-02 avoided by creating `LedgerModule` for one method |
| A fourth viem client | Top-up moves the funder's own tokens, so the funder must sign | Reusing the operator client and pre-funding the pool by hand deletes the funder wallet as "the outside world", and with it the health signal that its balance should fall on top-ups and rise on cash-outs |
| `GAS_LIMITS.transfer` seeded at an estimate | `executeWrite` requires an entry before the code compiles | Leaving it estimated is rejected: `measureGas()` is free and needs no special chain state for a transfer, so this ceiling must be MEASURED before the first top-up (R4). Reasoning from storage costs has already been wrong twice in that table — `openDeal` (estimate *below* the measurement) and `approve` (1.13× margin on a fresh deploy) |
