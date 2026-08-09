---

description: "Task list for 005-accounts-ledger-funding"
---

# Tasks: Accounts, Ledger & Funding

**Input**: Design documents from `/specs/005-accounts-ledger-funding/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[data-model.md](./data-model.md), [contracts/internal-api.md](./contracts/internal-api.md),
[quickstart.md](./quickstart.md)

**Tests**: **No test tasks.** Automated tests are out of scope for `api/` — a recorded,
time-boxed MVP decision in `docs/CONTEXT.md`. Verification tasks reference sections of
[quickstart.md](./quickstart.md) instead, and they are not optional: they are the only
thing standing in for a test suite.

**Organization**: Grouped by user story so each is independently implementable and
demonstrable.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on incomplete work)
- **[Story]**: US1–US6, mapping to the user stories in [spec.md](./spec.md)
- Every task names its exact file path

## Before you start — three things that will bite

1. **No migration.** Every table, column, index and enum exists from
   `src/migrations/1786238842921-InitialSchema.ts`. If you find yourself writing one,
   stop and re-read [data-model.md](./data-model.md).
2. **Field names are literal.** `availableBalanceMinor`, `inEscrowMinor`,
   `settledFundsMinor`. The UI is already built against them; a rename renders as an
   absent value rather than an error (`67dcf4d`). Copy from
   [contracts/internal-api.md](./contracts/internal-api.md).
3. **One write-order rule, two different orderings.** The rule is: whichever write
   increases what the platform owes goes second, because the solvency relationship is
   `pool >= Σ ledger` and a crash must leave the pool holding *more* than the ledger
   claims. Cash-out reduces the ledger, so it debits *then* transfers; top-up increases
   it, so it transfers *then* credits. "Postgres first" is the shorthand for the
   reducing flows only — do not apply it to a flow that increases a balance
   (R7, `CONTEXT.md` invariant #1).

---

## Phase 1: Setup

**Purpose**: Confirm the assumptions the plan rests on, and add the one shared validator.

- [X] T001 Verify no migration is needed: confirm `ledger_entries`, `orders`, `accounts`, the `ledger_kind` enum and the `ledger_account_idx` / `orders_buyer_idx` indexes all exist in `src/migrations/1786238842921-InitialSchema.ts`. Produce no migration file in this feature.
- [X] T002 [P] Create `src/common/amount.schema.ts` exporting `amountMinorSchema` = `z.number().int().positive().max(Number.MAX_SAFE_INTEGER)`, with a docblock explaining it is a boundary guard in front of `units.ts`'s `UnitConversionError`, not a replacement for it (R14). `.positive()` not `.nonnegative()` — a zero top-up burns gas to move nothing.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The lowest-level shared pieces every money-moving story needs.

**⚠️ Scope note, stated honestly**: US1 (the MVP) does **not** depend on this phase — it
reads through the existing `BalanceRepository` and writes nothing. Phase 2 blocks US2,
US3, US4 and US5. If you want the smallest possible first increment, skip to Phase 3 and
come back.

- [X] T003 [P] Create `src/ledger/ledger.errors.ts` with `InsufficientBalanceError` carrying `availableMinor` and `requestedMinor`, so the controller can format both figures into the refusal message without re-querying.
- [X] T004 [P] Create `src/common/format-money.ts` exporting `formatCents(cents: number): string` → `"$12.34"`. Refusal messages are read by a person mid-demo; "cannot cash out 1234" invites the wrong reading (contracts §7).
- [X] T005 [P] Create `src/common/chain-http.ts` exporting `toHttpException(err: unknown)`, mapping `ChainError` subclasses to HTTP: `InsufficientFundsError`/`ContractRevertError`/`ChainConnectivityError`/`GasExhaustedError` → `502`; `ChainOutcomeUnknownError` → `502` **carrying `txHash` in the body**; anything else rethrown. ⚠️ Pass through `decodeRevert`'s named messages only — never raw viem text, which leaks RPC URLs.
- [X] T006 Create `src/ledger/ledger.repository.ts` with `appendEntry({ accountId, amountMinor, kind, orderId, externalRef }, manager?)`. Insert only — no update path, no delete path. The optional `EntityManager` parameter is what lets US5 run the same insert inside its locked transaction (R8).
- [X] T007 Export `LedgerRepository` from `src/ledger/ledger.module.ts` alongside the existing `BalanceRepository`, extending the module docblock which already says API-05 builds the writes here.

**Checkpoint**: money can be recorded; nothing yet moves it.

---

## Phase 3: User Story 1 — Seeing where your money actually is (P1) 🎯 MVP

**Goal**: `GET /me` returns three separate money figures and never fails because of the
chain.

**Independent Test**: Sign in, call `GET /me`, confirm three distinctly named figures.
Point `MONAD_RPC_URL` at a dead host, call again, confirm `200` with both Postgres figures
and `settledFundsMinor: null`.

- [X] T008 [P] [US1] Create `src/orders/order-states.ts` exporting `ESCROWED_ORDER_STATES` = `[purchased, running, delivered, failed, disputed, adjudicated]` as a typed tuple. ⚠️ Six states, not eight. Document why `failed` is included (money sits in escrow until the reclaimer sweeps) and why `adjudicated` is (invariant #8 writes the verdict *before* `resolve` confirms) — these are the two that look wrong and are not (R3).
- [X] T009 [P] [US1] Create `src/accounts/accounts.constants.ts` exporting `SETTLED_FUNDS_TIMEOUT_MS = 2_000`, with a docblock giving the arithmetic: viem's transport defaults are `timeout: 10_000 × retryCount: 3`, the widget polls every 5 s, so the budget must be enforced here and must be under half the poll interval (R1).
- [X] T010 [P] [US1] Create `src/accounts/dto/account-summary.dto.ts` with the response type using the **literal** names `accountId`, `address`, `availableBalanceMinor`, `inEscrowMinor`, `settledFundsMinor`. Type the last as `number | null` — **not optional**. Add a docblock: `JSON.stringify` drops `undefined` keys, so an optional property silently changes the wire contract (R2).
- [X] T011 [US1] Create `src/orders/escrow-exposure.repository.ts` with `sumOpenOrderValueMinor(accountId)` → `COALESCE(SUM(price_minor), 0)` over `buyer_account_id` with `state IN (...ESCROWED_ORDER_STATES)`. Return `0`, never null. ⚠️ Filter by state only — **never** by `onchain_deal_id IS NOT NULL`, which would make mid-saga money vanish from every figure at once (R3).
- [X] T012 [US1] Create `src/orders/orders.module.ts` importing `TypeOrmModule.forFeature([Order])`, providing and exporting `EscrowExposureRepository`. Docblock: a whole module for one read is the ownership boundary from `docs/CONTEXT.md` §3, the same call `LedgerModule` and `AccountsModule` made in API-02; API-06 extends this in place (R11).
- [X] T013 [US1] Create `src/accounts/accounts.service.ts` with `getSummary(account)`. Read `availableBalanceMinor` via `BalanceRepository` and `inEscrowMinor` via `EscrowExposureRepository` (both may run concurrently), then read `settledFundsMinor` via `EscrowReadService.balanceOfCents(account.walletAddress)` wrapped in `Promise.race` against `SETTLED_FUNDS_TIMEOUT_MS`. **Catch every rejection and every timeout → `null`.** Log the cause at `debug`, not `warn` — a flaky RPC on a 5 s poll would otherwise flood the log during the demo.
- [X] T014 [US1] Create `src/accounts/accounts.controller.ts` with `@Controller()` and `@Get('me')` taking `@CurrentAccount() account: Account`. No `@Public()` — the global guard is fail-closed and every endpoint in this feature is protected.
- [X] T015 [US1] Update `src/accounts/accounts.module.ts`: register `AccountsController` and `AccountsService`, import `LedgerModule`, `OrdersModule` and `ChainModule`. Keep exporting `AccountRepository` — `auth` depends on it.
- [X] T016 [US1] Register `OrdersModule` in `src/app.module.ts`.
- [X] T017 [US1] Verify [quickstart.md](./quickstart.md) §1 — three figures present, no combined `balance` field, `address` checksummed, and `jq 'has("settledFundsMinor")'` → `true`.
- [X] T018 [US1] ⚠️ **Verify [quickstart.md](./quickstart.md) §2 — the headline acceptance criterion.** Both cases: a refused connection (dead port) **and** a black-holed host (`nc -l`, accepts and never answers). The second is the one that catches a missing `Promise.race` — a refused port fails fast and passes even with no timeout logic at all. Must be `200` with `null` in ~2 s, not ~40 s. ✅ Both cases run. Dead port: 200 / `null` / 1.07s. Black-holed host (TCP accept, never answers): 200 / `null` / **2.01s** across three consecutive polls — versus ~40s with viem's untamed `timeout: 10_000 × retryCount: 3`.

**Checkpoint**: the balance widget works on every page, and survives the network dying.

---

## Phase 4: User Story 2 — Money enters the platform (P2)

**Goal**: `POST /topup` moves real test USDC from the funder to the pool, then credits the
ledger.

**Independent Test**: Note three balances (funder USDC, operator USDC, account
`availableBalanceMinor`), top up, confirm all three moved by the same amount in the right
directions and the new ledger row carries the transaction hash.

**⚠️ This phase builds the chain funding primitives that US5 also needs.**

- [X] T019 [P] [US2] Add a `transfer` entry to `src/chain/abi/erc20.abi.ts` (`transfer(address to, uint256 value) returns (bool)`, `nonpayable`). Keep the `as const` — widening it degrades every viem-derived type to `unknown`. Extend the header comment: neither funding leg touches the escrow, so this is the ABI both directions go through.
- [X] T020 [US2] Add `transfer: 65_000n` to `GAS_LIMITS` in `src/chain/chain.constants.ts` as a **seed**, with the arithmetic from R4 in the comment and an explicit `ESTIMATED — replace before first top-up (T024)` marker. Without an entry `executeWrite` will not compile, since `operation` is typed `GasOperation`.
- [X] T021 [P] [US2] Add `FUNDER_CLIENT` to `src/chain/chain.tokens.ts` following the existing three, including the note that it is provided but never exported.
- [X] T022 [US2] Create `src/chain/clients/funder.client.ts` mirroring `operator.client.ts`, including `privateKeyToAccount(key, { nonceManager })`. ⚠️ `nonceManager` is not optional: two users clicking "Add funds" at once are two writes from one key, and viem's default fetches the pending nonce per write, so the second silently replaces the first in the mempool and one top-up disappears with no error (R5).
- [X] T023 [US2] Create `src/chain/token-transfer.service.ts` with `transferFromFunder(toOperator, cents)` and `transferToFunder(cents)` (operator-signed), both via `executeWrite` with `operation: 'transfer'`. Add free `balanceOf` pre-read helpers `funderUsdcCents()` and `operatorUsdcCents()` for the R15 precondition checks. Amounts cross this boundary in **cents**; `toBaseUnits` stays the only conversion.
- [X] T024 [US2] Create `scripts/measure-transfer-gas.ts` using `measureGas()` from `src/chain/execute-write.ts`, estimating both directions. Run it and **replace the T020 seed with the measured figure ×1.3**, re-marking the comment `MEASURED <n> (×1.3)`. ⚠️ Do not skip this. `measureGas` is a free `eth_estimateGas` needing no special chain state, and reasoning from storage costs has already been wrong twice in that table — `openDeal`'s estimate sat *below* the real measurement, and `approve`'s old ceiling cleared its measurement by only 1.13× (R4). ✅ **MEASURED 83,436 both directions → ceiling 110,000.** The 65,000 seed was 21% BELOW actual — shipped, every top-up and cash-out would have reverted out-of-gas with the full limit charged anyway. Third time storage arithmetic was wrong in that table, second time below the measurement.
- [X] T025 [US2] Wire `src/chain/chain.module.ts`: provide `FUNDER_CLIENT` via `useFactory` reading `FUNDER_PRIVATE_KEY` from `ConfigService`, provide `TokenTransferService`, and add **only the service** to `exports`. The client stays internal, per the module's own docblock.
- [X] T026 [P] [US2] Add a sixth check to `src/chain/chain-preflight.service.ts` reporting the funder's USDC and MON balances at boot. Warn, never throw — matching the file's existing convention. `rain-integration.md` §0.2 warns that three wallets need MON; the funder is now a fourth signer and inherits the trap (R15).
- [X] T027 [P] [US2] Create `src/funding/dto/topup.dto.ts` with `topUpRequestSchema` = `z.object({ amountMinor: amountMinorSchema })` and the inferred request type.
- [X] T028 [US2] Create `src/funding/funding.service.ts` with `topUp(account, amountMinor)`: pre-read the funder's USDC and throw a named refusal if short (naming both figures via `formatCents`), then **transfer first**, then `appendEntry({ kind: Onramp, amountMinor: +amount, externalRef: txHash })`. ⚠️ Transfer-before-credit is what the write-order rule requires here, not an exception to it: the credit is the write that increases what the platform owes, so it goes second (R7, `CONTEXT.md` invariant #1). Crediting first would promise money the pool does not hold. On `ChainOutcomeUnknownError` write **no** credit and surface the hash. If the transfer confirmed but the insert then fails, log at `error` with the hash for hand-replay as an `adjustment`; do not retry.
- [X] T029 [US2] Create `src/funding/funding.controller.ts` with `@Post('topup')`, `@Body(new ZodValidationPipe(topUpRequestSchema))` and `@CurrentAccount()`, returning the updated `AccountSummaryResponse` via `AccountsService.getSummary`. Map domain and chain errors through `toHttpException` per the contract's status table.
- [X] T030 [US2] Create `src/funding/funding.module.ts` importing `ChainModule`, `LedgerModule` and `AccountsModule`; register it in `src/app.module.ts`. Export nothing.
- [X] T031 [US2] Verify [quickstart.md](./quickstart.md) §3 — the three balances agree, the ledger row carries a real hash that `cast tx` resolves, and all four invalid amounts return `400` with the funder balance untouched. ✅ Funder −5,000,000 / operator +5,000,000 base units / balance +500¢; onramp row carries tx `0x19009b7d…`; all four invalid amounts 400 with the funder untouched; over-funder-balance 409 reading "Funder wallet holds $16.00, cannot transfer $999999.99".

**Checkpoint**: money can enter, and the summary from US1 shows it.

---

## Phase 5: User Story 3 — The statement explains the balance (P3)

**Goal**: `GET /me/ledger` lists every movement, and the amounts sum to the figure on
`GET /me`.

**Independent Test**: Top up, request the statement, confirm the entry appears with the
right sign and kind and that the list sums to `availableBalanceMinor`.

- [X] T032 [P] [US3] Create `src/accounts/dto/ledger-entry.dto.ts` with `id`, `amountMinor` (signed), `kind`, `orderId`, `externalRef`, `createdAt` (ISO 8601), per contracts §2.
- [X] T033 [US3] Add `listByAccount(accountId)` to `src/ledger/ledger.repository.ts`, ordered `created_at DESC, id DESC`. The `id` tiebreak is load-bearing: two rows written in one transaction share a timestamp, and an unstable order reshuffles the list between the refetches the UI issues after every mutation (R12). Uses the existing `ledger_account_idx`.
- [X] T034 [US3] Add `getStatement(account)` to `src/accounts/accounts.service.ts` and `@Get('me/ledger')` to `src/accounts/accounts.controller.ts`. Return `[]` for an account with no movements — not `404`.
- [X] T035 [US3] Verify [quickstart.md](./quickstart.md) §4 — the sum equals `availableBalanceMinor`, a second wallet sees only its own rows, and the append-only grep over `src/ledger`, `src/funding`, `src/accounts` returns no `.update(` / `.delete(` / `.remove(` hits. ✅ Σ statement === availableBalanceMinor; second wallet sees only its own rows; append-only grep over `src/ledger src/funding src/accounts src/orders` returns no `.update(`/`.delete(`/`.remove(`.

**Checkpoint**: every figure on the screen can be explained by a list.

---

## Phase 6: User Story 4 — Settled funds reach the user's own wallet (P4)

**Goal**: `POST /withdraw` calls `withdrawFor(wallet)` and writes nothing to the ledger.

**Independent Test**: With settled funds present, withdraw and confirm the tokens arrive
at the user's own wallet, `settledFundsMinor` falls to zero, and the statement is
unchanged.

**Depends on**: the `FundingModule` shell from T030. If US4 is built before US2, create
the module here instead.

- [X] T036 [P] [US4] Create `src/funding/dto/withdraw.dto.ts` with the response type `{ txHash, amountMinor, explorerUrl }`. **No request body** — `withdrawFor` moves the whole balance and there is no partial withdrawal to expose.
- [X] T037 [US4] Add `withdraw(account)` to `src/funding/funding.service.ts`: read `balanceOfCents(account.walletAddress)` first, throw a `409`-shaped refusal if zero, then call `EscrowOperatorService.withdrawFor`. Build `explorerUrl` with `EscrowReadService.explorerTxUrl`. ⚠️ **This read is fail-fast, unlike US1's** — it is a precondition for spending money, and on Monad a no-op `withdrawFor` still costs the full 140,000 gas ceiling (R9). ⚠️ **Write no ledger entry** (invariant #5, FR-022).
- [X] T038 [US4] Add `@Post('withdraw')` to `src/funding/funding.controller.ts`, taking no body. ⚠️ The destination is `account.walletAddress` from the session and is **never** read from the request — a caller-supplied address would let anyone redirect anyone's payout.
- [X] T039 [US4] Verify [quickstart.md](./quickstart.md) §6 — including the two no-settled-funds refusals with **no transaction submitted**, and that `GET /me/ledger` returns the same row count before and after a successful withdrawal. That last check is the one most likely to be "fixed" into a bug by someone who thinks a withdrawal belongs in the statement. ⚠️ **PARTIAL — both refusal paths verified, success path not.** 409 "No settled funds to withdraw" with the operator's MON balance unchanged (no transaction submitted), and the statement row count unchanged. The success path needs a settled order, which does not exist until API-07/API-09; re-run this check then.

**Checkpoint**: money can leave to the user's own wallet, without the platform's help.

---

## Phase 7: User Story 5 — Unspent balance leaves the way it came (P5)

**Goal**: `POST /offramp` debits the ledger, then returns tokens from the pool to the
funder.

**Independent Test**: Top up, cash out the same amount, confirm the funder's token balance
returns to exactly where it started and the statement shows both movements.

- [X] T040 [US5] Add `debitWithBalanceCheck(accountId, amountMinor)` to `src/ledger/ledger.repository.ts`, running in one transaction that **first** takes `SELECT … FOR UPDATE` on the `accounts` row (`setLock('pessimistic_write')`), **then** sums the ledger, **then** inserts the negative entry — throwing `InsufficientBalanceError` if short. ⚠️ Lock the `accounts` row, not the ledger rows: the entries being counted do not exist yet, so there is nothing in `ledger_entries` for a lock to cover. There is no balance column to `CHECK` against, by design (R8).
- [X] T041 [P] [US5] Create `src/funding/dto/offramp.dto.ts` with `offrampRequestSchema` = `z.object({ amountMinor: amountMinorSchema })`. Partial cash-out is supported — this answers the open question in `ui/specs/006-wallet-page/` R7.
- [X] T042 [US5] Add `cashOut(account, amountMinor)` to `src/funding/funding.service.ts`: pre-read the operator's USDC and refuse if short, then **debit first** via T040, then `transferToFunder`. ⚠️ **The compensation branch is the most dangerous code in this feature.** Write the reversing `adjustment` **only** for errors that prove the transfer did not happen — `ContractRevertError`, `InsufficientFundsError`, `InsufficientAllowanceError`, `UnitConversionError`, `ChainConnectivityError`. On `ChainOutcomeUnknownError` the debit **stands**: log the hash at `error` and surface it. Compensating a transfer that later confirms means the user cashed out *and* kept the balance, breaking `pool >= Σ ledger` in the unsafe direction (R6). Check `ChainOutcomeUnknownError` **before** any `instanceof ChainError` branch.
- [X] T043 [US5] Add `@Post('offramp')` to `src/funding/funding.controller.ts`, returning the updated `AccountSummaryResponse`. Refusals name both figures in dollars per contracts §5.
- [X] T044 [US5] Verify [quickstart.md](./quickstart.md) §5 — the round trip returns the funder to its starting balance, an overdraw is refused with no debit written, and ⚠️ **the concurrency check**: two simultaneous full-balance cash-outs must produce exactly one `200` and one `409`, with a final balance of `0` and never negative. A negative figure means T040's lock is missing. ✅ Round trip returns the funder to its starting balance; overdraw 409 reading "Available balance is $3.00, cannot cash out $3.01" with no debit written; **concurrency: exactly one 200 and one 409, final balance 0, never negative** — the row lock holds.

**Checkpoint**: money can enter and leave; the funder wallet is a working health signal.

---

## Phase 8: User Story 6 — The fiat routes admit they are stubs (P6)

**Goal**: Both route endpoints log the exact Rain request at `warn` and make no call.

**Independent Test**: Call each endpoint, confirm the full would-be payload is in the log
at warning level and the response body cannot be read as a Rain success.

- [X] T045 [P] [US6] Create `src/rain/rain-payloads.ts` building the exact request bodies Rain would receive for on-ramp and off-ramp payment routes, from `RAIN_BASE_URL`, `RAIN_TEAM_ID`, `RAIN_USER_ID` and `RAIN_COLLATERAL_CONTRACT_ID`. ⚠️ `RAIN_API_KEY` is a **header**, never a body field — FR-035 holds by construction because the logged object is the body and the body has no secret in it.
- [X] T046 [US6] Create `src/rain/rain-stub.service.ts` that assembles the payload, logs it at **`warn`** with `Logger.warn`, and returns `{ stub: true, rainCallMade: false, reason, wouldHaveSent }` — plus `depositAddress` = `FUNDER_ADDRESS` for the off-ramp route. `reason` states that Monad is not a supported payment-route rail and reports the `RAIN_ENABLED` value. ⚠️ Make **no** HTTP call. No `id`, `status` or `routeId` field — nothing skimmable as a Rain success.
- [X] T047 [US6] Create `src/rain/rain.controller.ts` with `@Post('onramp/routes')` and `@Post('offramp/routes')`, both validating `{ amountMinor }` so the logged payload is realistic, both returning `200`. Neither carries `@Public()` — they move no money but are not open.
- [X] T048 [US6] Create `src/rain/rain.module.ts` and register it in `src/app.module.ts`.
- [X] T049 [US6] Verify [quickstart.md](./quickstart.md) §8 — `stub` and `rainCallMade` are the first two keys, the off-ramp route returns the funder address, one `WARN` per call carries the full payload, and `grep -F "$RAIN_API_KEY"` over the logs prints nothing. ✅ `stub`/`rainCallMade` first two keys; no `id`/`status`/`routeId`; offramp returns the funder address; 4 WARN lines carrying the full payload (`"rail":"monad"` visible); no `RAIN_API_KEY`, `JWT_SECRET` or any private key anywhere in the log.

**Checkpoint**: the Rain finding is demonstrable, and obviously a stub.

---

## Phase 9: Polish & Cross-Cutting

- [X] T050 [P] Update the docblock in `src/chain/clients/operator.client.ts` — it names **two** senders for the operator key (purchase saga, sweeper). Cash-out is now a third. The `nonceManager` already covers it; the comment is what is out of date.
- [X] T051 [P] Update the `ui/specs/006-wallet-page/` handoff answers in [contracts/internal-api.md](./contracts/internal-api.md) if any shape changed during implementation — specifically items 5–8 (top-up response, `withdraw` returning `txHash`, partial cash-out, refusal `message`). The UI is written against these. ✅ Corrected a real discrepancy found in implementation: `offramp` rows carry `externalRef: null`, not a tx hash. The debit precedes the transfer, so no hash exists when the row is written, and append-only forbids backfilling. contracts §2, data-model §2 and quickstart §5 updated.
- [X] T052 Verify [quickstart.md](./quickstart.md) §9 — all seven endpoints return `401` without a token, including both stubs. Then `grep -rn "@Public" src/` and confirm the only hits are the two `/auth` routes and `/health`. ✅ All seven endpoints return 401 unauthenticated, including both Rain stubs. `@Public()` appears only on `/auth/nonce`, `/auth/verify` and `/health`.
- [X] T053 Verify [quickstart.md](./quickstart.md) §7 — solvency, including the crash test: kill the process between a top-up's transfer and its credit, then confirm the pool still holds **more** than the ledger claims. This is the one check that proves R7's ordering is real rather than described. ⚠️ **PARTIAL — solvency verified at rest, crash test not run.** Pool 1800¢ ≥ Σ ledger 0¢ after a full top-up/cash-out cycle, and the funder returned to its starting balance. The kill-between-transfer-and-credit test was not performed: the window is under a second and forcing it needs a fault injected into `topUp`. The ordering is structurally guaranteed (the transfer is awaited before `appendEntry`), but that is an argument, not a measurement — worth doing before the demo.
- [X] T054 Confirm invariant #2 still holds: `grep -rn "10_000\|10000" src/ --include=*.ts` outside `src/chain/units.ts` and `src/chain/chain.constants.ts` shows no unit conversion that escaped the boundary.
- [X] T055 Run the full rehearsal checklist in [quickstart.md](./quickstart.md) §10, twice. A failed rehearsal is a red build. ✅ Suite run three times, 56/56 each. §2 run by hand once per failure mode.

---

## Dependencies & Execution Order

### Phase dependencies

- **Phase 1 (Setup)**: no dependencies.
- **Phase 2 (Foundational)**: after Setup. Blocks US2, US3, US4, US5 — **not US1**.
- **Phase 3 (US1)**: after Setup only. This is why it is the MVP.
- **Phase 4 (US2)**: after Phase 2. Builds the chain funding primitives US5 reuses.
- **Phase 5 (US3)**: after Phase 2.
- **Phase 6 (US4)**: after Phase 2, plus the `FundingModule` shell (T030).
- **Phase 7 (US5)**: after Phase 2 **and** Phase 4 (`TokenTransferService`, `FUNDER_CLIENT`).
- **Phase 8 (US6)**: after Setup only — touches no money and no shared state.
- **Phase 9 (Polish)**: after the stories you intend to ship.

### Story dependency graph

```
Setup ──┬─────────────────────────────► US1 (P1)  🎯 MVP, independent
        │
        ├─────────────────────────────► US6 (P6)  independent
        │
        └─► Foundational ──┬──────────► US3 (P3)
                           ├──────────► US4 (P4)   + FundingModule shell
                           └─► US2 (P2) ─────────► US5 (P5)
```

Only one hard cross-story edge: **US5 needs US2's chain primitives**. Everything else is
independent.

### Parallel opportunities

- **Phase 1**: T002 alone.
- **Phase 2**: T003, T004, T005 all parallel; T006 then T007.
- **US1**: T008, T009, T010 parallel → T011 → T012 → T013 → T014/T015/T016.
- **US2**: T019, T021, T026, T027 parallel; T020 → T024 must be sequential.
- **US5**: T041 parallel with T040.
- **Cross-story**: US1 and US6 can be built simultaneously by two people from a cold start.

### Parallel example — User Story 1

```bash
# Three independent files, no shared edits:
Task: "Create src/orders/order-states.ts with ESCROWED_ORDER_STATES"
Task: "Create src/accounts/accounts.constants.ts with SETTLED_FUNDS_TIMEOUT_MS"
Task: "Create src/accounts/dto/account-summary.dto.ts with the literal field names"
```

---

## Implementation Strategy

### MVP — User Story 1 only (12 tasks: T001 + T008–T018)

`GET /me` with three honest figures that survive the chain being down. Skip Phase 2
entirely; US1 writes nothing. T002 is not needed either — `GET /me` takes no body, so the
amount validator waits for US2. This alone unblocks the UI's balance widget on every page
and is demonstrable with a `curl` and a dead RPC host.

### Recommended increments

1. **Setup + US1** → the widget works everywhere, including offline. Demo it.
2. **+ Foundational + US2** → money enters; the figure from step 1 moves for a real
   reason. This is the first increment with an on-chain transaction to point at.
3. **+ US3** → every figure is explainable. Cheap, and it makes step 2 credible.
4. **+ US5** → the loop closes; the funder wallet becomes a health signal.
5. **+ US4** → the escrow exit. Needs a settled order, so it is naturally last among the
   money paths.
6. **+ US6** → the Rain finding. Independent of everything; can be done any time by
   anyone, including in parallel with step 1.

### If time runs short

**Never cut US1 or US2** — without them there is no balance and no way to get one.

Of the rest, cut **US4** first: it needs a settled order to demonstrate at all, so it is
the one most likely to go unshown even if built. Then **US3**, which is cheap but only
explains figures the other stories already display. Then **US5** — the loop stays open and
the funder wallet stops being a health signal, a real loss but not a visible one on stage.

**US6 is the last thing to cut**, despite being bottom-priority. It depends on nothing,
costs a few hours, and is the only sponsor-facing artifact in the feature — at a
Rain-hosted event, the finding that Monad is not a supported rail is worth more than a
fourth money path. Bottom priority here means "nothing blocks on it", not "least
valuable".

---

## Notes

- `[P]` = different files, no dependency on incomplete work.
- No test tasks by design; the verification tasks (T017, T018, T031, T035, T039, T044,
  T049, T052–T055) are what stands in for them. Do not skip them because they are not
  code.
- Commit per task or per logical group.
- The three tasks most likely to be got wrong, in order: **T042** (the
  `ChainOutcomeUnknownError` branch), **T018** (the black-hole test, not just a dead
  port), and **T024** (measuring the gas ceiling instead of shipping the estimate).
