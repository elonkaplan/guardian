---
description: "Task list for Chain Adapter implementation"
---

# Tasks: Chain Adapter

**Input**: Design documents from `/specs/003-chain-adapter/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/](./contracts/)

**Tests**: **No test tasks.** Automated tests remain out of scope for this component
per [`docs/CONTEXT.md`](../../docs/CONTEXT.md). Verification tasks run the
corresponding step from [quickstart.md](./quickstart.md) by hand.

**Organization**: Grouped by user story. Two things about the shape of this feature
are worth knowing before reading:

**Story phases are not in priority order, and that is deliberate.** Priority describes
value; these phases are ordered by dependency. US2 (unit conversion) is built first
because every other story converts money, and US3 (the guardian narrowing) comes
before US1 because it is verifiable with `tsc` alone — no funded wallet, no network.
Front-loading the two stories that need nothing external keeps them independent of
the one remaining wallet-funding dependency below.

**✅ The escrow is deployed** at `0xe1b74F8dB511247786Ef61bde9330198a1929d53`, and the
plan's assumptions have been verified against it ([research R16](./research.md)). The
old blanket deployment blocker is gone.

**✅ No external blockers.** The operator holds $20.00 USDC and an unbounded escrow
allowance, so both `openDeal` preconditions pass — 20 deals at $1.00. Every task below
can be completed now.

**⚠️ The chain is not fresh.** `nextAgentId = 2`, `nextDealId = 2`; agent 1 and a
settled deal 1 already exist from the runbook's smoke test. A newly registered agent
is **id 2**. Those records are fixtures the read tasks now assert against.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1–US5)
- Include exact file paths in descriptions

## Path Conventions

All paths are relative to `guardian/api/` unless prefixed `../` (repository root).

---

## Phase 1: Setup

**Purpose**: The dependency and the decision constants. Both are leaves — nothing
imports anything yet.

- [X] T001 Add `"viem": "^2.55.11"` to the `dependencies` block of `api/package.json` and run `npm install`. Confirm `node -e "console.log(require('viem/package.json').version)"` prints `2.55.11` or higher. **Do not change `tsconfig.json`** — [research R14](./research.md) verified that viem's legacy directory stubs resolve correctly under the existing `node10` default, so the change an earlier draft anticipated is not needed
- [X] T002 [P] Create `api/src/chain/chain.constants.ts` — export `GAS_LIMITS` (the twelve-entry table from [research R5](./research.md)), `RECEIPT_TIMEOUT_MS = 30_000`, `RECEIPT_CONFIRMATIONS = 1`, and `ALLOWANCE_TOPUP_CENTS = 1_000_000` ($10,000). **Five `GAS_LIMITS` entries are measured against the deployed escrow and must be copied exactly** — `registerAgent: 210_000`, `openDeal: 530_000`, `markDelivered: 75_000`, `accept`/`release`: `130_000`, `withdrawFor: 140_000` — each commented with its measured figure. The other seven stay estimates, commented as such. **Comment the `openDeal` entry with a warning**: the pre-deployment estimate was 400,000 against a measured 408,072, so shipping it would have made every purchase revert out-of-gas. Comment `ALLOWANCE_TOPUP_CENTS` to say it does **not** describe the live allowance, which is effectively unbounded and accepted as-is — the constant is what a fresh deployment would use ([research R10](./research.md))

**Checkpoint**: `npm run build` passes.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The chain definition, the ABIs, the types, the error taxonomy, and the
one write pipeline every signing service shares.

**⚠️ CRITICAL**: No user story can begin until this phase is complete. T009's
`executeWrite` is used by both US1 and US3, which is why it lives here rather than in
either story — putting it in US1 would make US3 depend on US1 and destroy the
independence that lets the guardian narrowing be verified without a deployed contract.

- [X] T003 [P] Create `api/src/chain/monad-chain.ts` — export a factory that builds the chain with viem's `defineChain` from **config values**, not literals: `id` from `MONAD_CHAIN_ID`, `rpcUrls.default.http` from `MONAD_RPC_URL`, `blockExplorers.default.url` from `MONAD_EXPLORER_URL`, `nativeCurrency` as `{ name: 'MON', symbol: 'MON', decimals: 18 }`. Comment why it reads config rather than hardcoding 10143: the values are already validated at boot by `env.schema.ts`, and two sources for one RPC URL is how a demo ends up pointed at two different nodes ([research R11](./research.md))
- [X] T004 [P] Create `api/src/chain/abi/escrow.abi.ts` — transcribe the `abi` array from `../sc/out/GuardianEscrow.sol/GuardianEscrow.json` as `export const escrowAbi = [...] as const`. **The `as const` is load-bearing** — without it viem widens every type to `string` and all downstream inference silently degrades to `unknown`. Header comment must name the source artifact path and the regeneration command (`cd ../sc && forge build`), and explain why it is copied rather than imported: `sc/out/` is gitignored and `tsconfig.json` sets `rootDir: ./src`, so a cross-package import does not build ([research R2](./research.md))
- [X] T005 [P] Create `api/src/chain/abi/erc20.abi.ts` — `as const` array with `allowance(address,address)`, `approve(address,uint256)`, `balanceOf(address)`, `decimals()`, **and the error entries `ERC20InsufficientAllowance(address,uint256,uint256)` and `ERC20InsufficientBalance(address,uint256,uint256)`**. Comment that the error entries are not optional: `SafeERC20._callOptionalReturn` re-reverts with the token's own return data, so an `openDeal` with no allowance surfaces an `ERC20…` error that `escrowAbi` cannot decode ([research R6](./research.md))
- [X] T006 [P] Create `api/src/chain/types.ts` — `DealState` numeric enum (`None = 0`, `Open`, `Delivered`, `Disputed`, `Settled`) with a comment that these are the contract's `uint8` values and the order is therefore significant; `Tier` numeric enum (`NoRefund = 0` … `Full = 4`); `OnChainDeal` and `OnChainAgent` interfaces exactly as tabulated in [data-model.md §4–5](./data-model.md); and `TxResult<T = void>` (`hash`, `blockNumber`, `gasUsed`, `value`). Comment on `DealState` that it is deliberately distinct from the database's `OrderState`, which is finer — nothing in this module converts between them
- [X] T007 [P] Create `api/src/chain/errors.ts` — the nine typed errors from [contracts/errors.md](./contracts/errors.md), all extending an abstract `ChainError` carrying `operation`. Extra fields per the hierarchy: `hash` on `ChainOutcomeUnknownError`, `reason` on `ContractRevertError`, `address` on `InsufficientFundsError`, `value` on `UnitConversionError`, `dealId`/`agentId` on the two not-found errors. **`ChainOutcomeUnknownError` must not extend any failure type** — add a comment explaining that a caller catching a generic failure and retrying an `openDeal` opens a second on-chain deal for one order, which is exactly what invariant #1 in [`docs/CONTEXT.md`](../../docs/CONTEXT.md) forbids
- [X] T008 Create `api/src/chain/decode-revert.ts` — one `decodeRevert(err, operation)` that walks the viem error with `err.walk((e) => e instanceof ContractFunctionRevertedError)` and handles all **three** encodings from [research R6](./research.md): `require` strings via `revert.reason`, custom errors in `escrowAbi` via `revert.data.errorName`, and token errors decoded against `erc20Abi`. Map `ERC20InsufficientAllowance` to `InsufficientAllowanceError` and everything else per the tables in [contracts/errors.md](./contracts/errors.md). Also map the non-revert cases: viem transport errors to `ChainConnectivityError`, `WaitForTransactionReceiptTimeoutError` to `ChainOutcomeUnknownError`, and insufficient-gas-funds RPC errors to `InsufficientFundsError` (depends on T005, T007)
- [X] T009 Create `api/src/chain/execute-write.ts` — the shared pipeline every signing service uses, in this exact order: `simulateContract` (free `eth_call`, catches precondition failures before anything is paid for) → `writeContract` **with an explicit `gas` from `GAS_LIMITS`, never the simulation's estimate** → `waitForTransactionReceipt({ confirmations: RECEIPT_CONFIRMATIONS, timeout: RECEIPT_TIMEOUT_MS })` → return a `TxResult` only if `receipt.status === 'success'`. A `reverted` status throws `ContractRevertError`; a `gasUsed` at or near the declared limit on a reverted receipt throws `GasExhaustedError`; every viem error goes through `decodeRevert`. Comment the `gas` override prominently: viem calls `eth_estimateGas` whenever `gas` is absent, and `eth_estimateGas` returns a binary-searched **upper bound** that Monad charges in full ([research R4](./research.md)) (depends on T002, T006, T007, T008)
- [X] T010 [P] Create `api/src/chain/clients/public.client.ts` — a `createPublicClient` over the chain from T003 with an `http` transport. **No key, no account.** Comment that this client serves reads, receipt waiting, and the preflight, and that it is `private` to the services that hold it — never exported (FR-005) (depends on T003)
- [X] T011 Create `api/src/chain/chain.module.ts` — a Nest module providing the clients and services, and modify `api/src/app.module.ts` to import it. At this stage it provides only the public client; each story phase adds its own service to the providers and exports arrays
- [X] T012 Run `npm run build` and confirm it passes, then start the stack and confirm `/health` still returns 200 — the module is instantiated at boot, so a bad provider surfaces here rather than at first use

**Checkpoint**: The module loads. No story work has begun.

---

## Phase 3: User Story 2 — Money crosses the unit boundary exactly once (Priority: P2)

**Goal**: One pair of functions, the only place in the backend that knows the
settlement token counts in base units.

**Independent Test**: Convert a set of known amounts both ways and confirm each
round-trips exactly; then grep the backend outside this module for the scale and
confirm there is nothing.

**Why this phase is first**: US1, US4, and US5 all convert money. This is a leaf with
no dependencies and no network, so it is both the cheapest thing to build and the
thing everything else waits on.

- [X] T013 [US2] Create `api/src/chain/units.ts` — export `toBaseUnits(cents: number): bigint` (`BigInt(cents) * CENTS_TO_BASE_SCALE`) and `fromBaseUnits(base: bigint): number`, plus the `CENTS_TO_BASE_SCALE = 10_000n` constant. **This file must contain the only occurrence of that scale, and of the token's decimal count, in the whole backend.** File-level comment: the scale is `10^(tokenDecimals − centDecimals)` = `10^(6 − 2)`; verified on both sides, since `MockUSDC.decimals()` returns 6 and every money column in the database is `BIGINT` cents. Do **not** use viem's `parseUnits`/`formatUnits` — they work in decimal strings, which reintroduces a text representation of money inside the one function that exists to keep it exact ([research R9](./research.md))
- [X] T014 [US2] Add the six guards from [data-model.md §1](./data-model.md) to `api/src/chain/units.ts`, each throwing `UnitConversionError`: `cents` is an integer, `cents >= 0`, `cents <= Number.MAX_SAFE_INTEGER`, `base >= 0n`, `base % 10_000n === 0n`, and `base / 10_000n` within `MAX_SAFE_INTEGER`. **The non-whole-cent guard must throw, never round** — comment that a base amount which does not divide evenly means value entered the escrow through a path that bypassed this module, and rounding destroys the only evidence that such a path exists
- [X] T015 [US2] Verify the round-trip per [quickstart.md](./quickstart.md) Step 1: every amount in the test set round-trips with zero loss (`200 → 2000000 → 200`), and every guard rejects its bad input. This is **SC-005**
- [X] T016 [US2] Verify **SC-004** — run `grep -rn "10_000n\|10000n\|10n \*\* 4n\|decimals" src/ --include=*.ts | grep -v "src/chain/units.ts"` and confirm zero results

**Checkpoint**: Money can cross the boundary correctly. Nothing else works yet.

---

## Phase 4: User Story 3 — The guardian identity cannot do anything but rule (Priority: P3)

**Goal**: A signing identity whose declared interface contains one operation, so that
signing an `openDeal` with the guardian key is a compile error.

**Independent Test**: `grep` the resolve ABI for its entry count, then write an
`openDeal` call through the guardian client and confirm `tsc` rejects it.

**Why this phase is second**: it is verifiable with `tsc` alone — no deployed
contract, no funded wallet, no network. It is the most valuable thing that can be
completed while the deployment is pending.

- [X] T017 [P] [US3] Create `api/src/chain/abi/escrow-resolve.abi.ts` — `export const escrowResolveAbi = [...] as const` containing **exactly one entry**: `resolve(uint256 dealId, uint8 tier, bytes32 verdictHash)`. Comment that the one-entry-ness *is* the security property and that the `as const` is what makes it real — without it the ABI widens to `string[]` and the guarantee silently disappears while the file still looks correct
- [X] T018 [P] [US3] Create `api/src/chain/abi/escrow-operator.abi.ts` — `as const` array containing every escrow function the operator is entitled to call **except `resolve`**: `registerAgent`, `updateAgent`, `setAgentActive`, `openDeal`, `markDelivered`, `accept`, `release`, `reclaim`, `dispute`, `forceResolve`, `withdrawFor`. Derive it by hand from `escrowAbi` rather than by a runtime `.filter()` — a filtered array's *type* is still the full union, which loses the entire property ([research R15](./research.md)). Note in a comment that `withdraw()` is deliberately absent; T035 explains why
- [X] T019 [P] [US3] Create `api/src/chain/tier.ts` — the bidirectional, exhaustive mapping between the contract's `Tier` (`uint8`) and the database's `VerdictTier` (from `src/entities/enums.ts`), typed as `Record<VerdictTier, Tier>` so adding a tier to either side fails to compile until both are updated. Comment that the two orderings agree but the **names do not** — the contract's zero value is `NoRefund`, the database's is `none` — which is why this is a table and not a cast, and that the contract's own `_refundBps` comment warns an off-by-one here "would be invisible until a live demo" ([research R13](./research.md))
- [X] T020 [US3] Create `api/src/chain/clients/guardian.client.ts` — a `createWalletClient` with an account from `privateKeyToAccount(GUARDIAN_PRIVATE_KEY, { nonceManager })`, imported from `viem/accounts` ([research R8](./research.md), verified). Its own file per `project-structure.md` §5.2. Comment that this client is only ever used with `escrowResolveAbi` (depends on T003, T017)
- [X] T021 [US3] Create `api/src/chain/escrow-guardian.service.ts` — **one method**: `resolve(dealId: bigint, tier: VerdictTier, verdictHash: Hex): Promise<TxResult>`. It takes the **database's** string tier and maps it through T019 internally, so no caller ever handles the numeric index. The client is a `private readonly` field, never exported and never returned (FR-005). Route the write through `executeWrite` with `GAS_LIMITS.resolve`. Register it in `chain.module.ts` (depends on T009, T019, T020)
- [X] T022 [US3] Verify the narrowing per [quickstart.md](./quickstart.md) Step 2: confirm `escrow-resolve.abi.ts` has one entry, then temporarily add a `writeContract` call naming `functionName: 'openDeal'` inside the guardian service and run `npx tsc --noEmit`. **Expected verbatim**: `error TS2322: Type '"openDeal"' is not assignable to type '"resolve"'.` — this exact error was reproduced against viem 2.55.11 during planning, so anything else means the narrowing is not working. Remove the line. This is **SC-003**
- [X] T023 [US3] Verify **SC-008** — run `grep -rn "viem" src/ --include=*.ts | grep -v "^src/chain/"` and confirm zero results

**Checkpoint**: The role separation is structural and provable, with no chain access.

---

## Phase 5: User Story 1 — A backend action becomes a confirmed transaction (Priority: P1) 🎯 MVP

**Goal**: Every escrow operation the operator is entitled to perform, wrapped in the
platform's own types, returning a confirmed transaction reference or a named failure.

**Independent Test**: Run a throwaway script that registers an agent and confirm the
transaction appears on MonadVision with the expected effect.

- [X] T024 [US1] Create `api/src/chain/clients/operator.client.ts` — a `createWalletClient` with an account from `privateKeyToAccount(OPERATOR_PRIVATE_KEY, { nonceManager })`. **`nonceManager` is not optional here**: the operator has two independent senders — the purchase saga and the sweeper cron, which fires every 3 seconds — and without it two overlapping writes fetch the same pending nonce and one silently replaces the other in the mempool. Comment that this is the mechanism behind the spec's "operator submits one at a time" assumption: rather than relying on it, overlap is made harmless ([research R8](./research.md)) (depends on T003)
- [X] T025 [US1] Create `api/src/chain/escrow-operator.service.ts` with the client as a `private readonly` field and the three **registry** writes: `registerAgent(owner, priceCents, defHash)`, `updateAgent(agentId, priceCents, defHash)`, `setAgentActive(agentId, active)`. Each converts `priceCents` through `toBaseUnits` and routes through `executeWrite` with its own `GAS_LIMITS` entry (depends on T009, T013, T018, T024)
- [X] T026 [US1] Add event-log recovery to `escrow-operator.service.ts` for the two writes that produce ids. `registerAgent` returns `TxResult<bigint>` whose `value` comes from `parseEventLogs({ abi: escrowAbi, eventName: 'AgentRegistered', logs: receipt.logs })`. **Comment this heavily.** Both functions declare `returns (uint256)` in Solidity, which reads as though the transaction hands the id back — it does not; a transaction returns nothing to an off-chain caller, and the value exists only because the function also emits it. Explicitly reject the alternative: reading `nextAgentId() - 1` is racy against any concurrent write, and the race resolves as *the wrong agent id attached to the wrong seller* ([research R3](./research.md))
- [X] T027 [US1] Add `ensureAllowance(requiredCents): Promise<TxResult | null>` to `escrow-operator.service.ts` — read `allowance(operator, escrow)` (free), return `null` when already sufficient, otherwise `approve` for `ALLOWANCE_TOPUP_CENTS`. Idempotent. Comment why the module owns this rather than a caller: `openDeal` does `safeTransferFrom` from the operator, so with no allowance **every purchase reverts** — and, as the contract's own comment warns, "long after deployment looked successful". **Also comment that against the current deployment this always returns `null`** — the runbook granted an unbounded allowance and that was accepted ([research R10](./research.md)) — so the top-up branch will not fire here; it exists for a fresh redeploy, which starts at zero. Unexercised, not dead (depends on T005)
- [X] T028 [US1] **Done — no action needed.** The operator must hold USDC for `openDeal` to succeed at all, since the contract does `safeTransferFrom(operator, escrow, price)`. $20.00 was minted to `OPERATOR_ADDRESS` and confirmed by a `balanceOf` read; with the unbounded allowance already in place, both preconditions pass. Kept as a task rather than deleted because it is a real prerequisite that a fresh environment will need again — and because balance and allowance are **independent** preconditions, which is the part that is easy to miss
- [X] T029 [US1] Add the **deal lifecycle** writes to `escrow-operator.service.ts`: `openDeal(agentId, buyer, reviewWindowSeconds)` — calls `ensureAllowance` first, then returns `TxResult<bigint>` with the deal id parsed from the `DealOpened` log; plus `markDelivered`, `accept`, `release`, and `reclaim`. Note in a comment that `openDeal` takes **no amount**: the contract charges `agent.price` from its own storage, which is what makes the price a snapshot rather than a parameter (depends on T026, T027)
- [X] T030 [US1] Add the **dispute** writes to `escrow-operator.service.ts`: `dispute(dealId)` and `forceResolve(dealId)`. Comment why `forceResolve` sits here rather than on the guardian service — it is permissionless and chooses nothing, and giving the guardian key a second callable function would weaken the property T017 buys
- [X] T031 [US1] Add `withdrawFor(account)` to `escrow-operator.service.ts`, and add a comment recording that **`withdraw()` is deliberately not wrapped**: it pays `msg.sender`, so an operator calling it would send every user's payout to the operator — the exact bug `withdrawFor` was added to prevent (smart-contract §4.5). Its absence is the mechanism, not an oversight ([research R15](./research.md)). Register the service in `chain.module.ts`
- [X] T032 [US1] Create `api/scripts/chain-smoke.ts` — the throwaway acceptance script, **write path only**: `ensureAllowance`, then `registerAgent(operatorAddress, 200, keccak256("smoke"))`, printing each transaction's explorer URL, the recovered agent id, and its `gasUsed` against the declared limit. The read assertions are deliberately left to T040 so this story stays verifiable without US4 — the explorer is what proves the write landed. **Place it in `api/scripts/`, not `src/`** — `tsconfig.json` sets `rootDir: ./src`, so a script inside would ship in `dist/`; it is run with `ts-node`, which does not care (depends on T029)
- [X] T033 [US1] Run `npx ts-node api/scripts/chain-smoke.ts`. Open the `registerAgent` transaction on MonadVision and confirm it is present, successful, and that its `AgentRegistered` log carries the agent id the script printed — which also confirms T026's event-log recovery against a real receipt. This is **SC-001**
- [X] T034 [US1] Verify **R3's failure mode** directly, since it is silent: run `grep -n "parseEventLogs" src/chain/escrow-operator.service.ts` and confirm two occurrences (`AgentRegistered` and `DealOpened`). Any other source for those ids is the bug R3 describes
- [X] T035 [US1] Record the `gasUsed` figures printed by `api/scripts/chain-smoke.ts` against the declared limits. They are the first real measurements feeding T045's revision of `api/src/chain/chain.constants.ts`

**Checkpoint**: The platform can put verifiable transactions on the chain. **This is the MVP.**

---

## Phase 6: User Story 4 — Reading the escrow's live state (Priority: P4)

**Goal**: The escrow total the demo screen shows, what an address is owed, and the
full recorded state of any single purchase.

**Independent Test**: Read the escrow total, one address's balance, and one purchase's
state, and confirm each matches what the transactions so far imply.

- [X] T036 [P] [US4] Create `api/src/chain/deal-mapper.ts` — map the `deals(uint256)` getter's **11-element positional tuple** into a named `OnChainDeal`, and the `agents(uint256)` 5-element tuple into `OnChainAgent`, applying the conversions from [data-model.md §4](./data-model.md): base units → cents, `uint64` seconds → `Date`, and `0` timestamps → `null`. Comment why this is its own file: indices 6 and 7 are `openedAt` and `deliveredAt`, two same-typed `uint64` timestamps whose transposition type-checks and produces a plausible wrong answer ([research R12](./research.md)) (depends on T006, T013)
- [X] T037 [US4] Create `api/src/chain/escrow-read.service.ts` with `totalEscrowedCents()` and `balanceOfCents(account)`, both returning whole cents via `fromBaseUnits`. `balanceOfCents` must return `0` for an address that is owed nothing rather than throwing (FR-018). No signing key is involved anywhere in this file (depends on T010, T013)
- [X] T038 [US4] Add `getDeal(dealId)` and `getAgent(agentId)` to `escrow-read.service.ts`, throwing `DealNotFoundError` when `state === DealState.None` and `AgentNotFoundError` when `owner` is the zero address. Comment that this check is not defensive padding: ids start at 1 precisely so an unknown id returns a zero-filled struct, so without it `getDeal(99999n)` returns a real-looking record with zero parties and zero amount — which FR-020 requires be distinguishable (depends on T036)
- [X] T039 [US4] Add `explorerTxUrl(hash)` to `escrow-read.service.ts`, built from `MONAD_EXPLORER_URL`. No chain access. Register the service in `chain.module.ts`
- [X] T040 [US4] Extend `api/scripts/chain-smoke.ts` with the read leg, bringing it to the full shape shown in [quickstart.md](./quickstart.md) Step 4: `getAgent(newId)`, `totalEscrowedCents()`, and `balanceOfCents(operator)` after the registration (depends on T032, T038)
- [X] T041 [US4] Run the extended `api/scripts/chain-smoke.ts` and confirm the reads are consistent with the transactions performed, and that both not-found errors fire for id `999999n` (verified on chain to return `state = 0`). Confirm `getAgent` returned `200`, **not `2000000`** — the conversion holding across a real round trip. Then assert against the runbook's **pre-existing fixtures**, which exercise what a fresh registration cannot: `getAgent(1n)` → owner is the funder, price `100`¢, v1, active; `getDeal(1n)` → state `Settled`, amount `100`¢, `reviewWindowSeconds` 30, `deliveredAt` a real `Date`, and **`disputedAt` `null`** — that last one is T036's zero-timestamp rule proven on real data rather than asserted. A write and a read succeeding in one session is **SC-002**

**Checkpoint**: The demo screen has its numbers, and the backend can reconcile against the chain.

---

## Phase 7: User Story 5 — Repeated operator transactions cost a known amount (Priority: P5)

**Goal**: Every repeated operation declares its spending ceiling in advance, and the
figures become measurements rather than guesses after the first rehearsal.

**Independent Test**: Confirm each repeated operation declares an explicit ceiling and
that nothing asks the chain to estimate one.

**Note**: the ceilings themselves were built in T002 and applied in T009 — a gas limit
that is not passed at the moment of writing is not a gas limit. This phase is the
logging that turns them into measurements, plus the verification that they are
actually being used.

- [X] T042 [US5] Add gas logging to `api/src/chain/execute-write.ts`. **⚠️ Corrected during implementation.** `receipt.gasUsed` on Monad reports the gas **limit charged**, not execution cost — verified: a `registerAgent` sent with a 210,000 ceiling reports `gasUsed = 210000` while `estimateGas` for the identical call returns 158,189. Two consequences were handled: (a) the log states the charge and says explicitly that it is not usage, rather than a "% used" figure that would read 100% forever and imply the ceilings are perfectly sized; (b) the original `GasExhaustedError` heuristic (`gasUsed` within 98% of the ceiling) was **broken** — since the two are always equal it matched *every* revert — so exhaustion is now inferred from step 1's free simulation having passed. A separate `measureGas()` helper wraps `eth_estimateGas` for real measurement
- [X] T043 [US5] Verify **SC-006** — confirm no gas estimation on the **write path**: `grep -n "estimateContractGas\|estimateGas" src/chain/execute-write.ts` must show hits only inside the `measureGas` helper, never inside `executeWrite`, and every write must pass an explicit `gas` (structurally guaranteed — `executeWrite` has no code path that omits it). **The original literal check ("zero results anywhere") is obsolete**: since `receipt.gasUsed` cannot reveal execution cost on this chain (T042), `eth_estimateGas` is the *only* way to measure, so a deliberate, explicitly-excluded measurement helper is required rather than forbidden
- [X] T044 [US5] Confirm every `GAS_LIMITS` entry in `api/src/chain/chain.constants.ts` is a named constant carrying a comment that records where the figure came from and that it is to be revised once measured (FR-024)
- [ ] T045 [US5] **Partially done — 3 of the 7 remaining ceilings are now measured** via `measureGas()` (never receipts; T042 explains why): `updateAgent` 72,351 → 95,000, `setAgentActive` 48,963 → 64,000, `approve` 70,688 → 110,000. ⚠️ The `approve` change fixed a latent failure: the old 80,000 ceiling cleared the measured value by only 1.13×, and that measurement prices a *non-zero* allowance write — a **fresh deployment**'s first approve is zero→non-zero (~15,000 more) and would very likely have exceeded it, on the one path that runs once on a new environment with nobody watching. Still estimated: `dispute`, `reclaim`, `resolve`, `forceResolve` — these need a live deal in the right state, so measuring them requires a full dispute cycle (API-06/API-08 territory)

**Checkpoint**: Gas spend is predictable and the figures are grounded in measurement.

---

## Phase 8: Polish & Cross-Cutting Concerns

- [X] T046 Create `api/src/chain/chain-preflight.service.ts` — four free reads at boot per [research R11](./research.md): `getChainId()` against `MONAD_CHAIN_ID`, the escrow's `token()` against `USDC_ADDRESS`, the token's `decimals() === 6`, and `hasRole` for both the operator and guardian addresses. **It logs warnings and never throws or blocks startup** — comment that this is the existing convention, not a new one: `detect-placeholders.ts` exists precisely so the service boots before the contract is deployed, and a blocking preflight would stop the API from starting today. Every check fails loudly at the first real call anyway; the preflight only moves the diagnosis earlier. Register it in `chain.module.ts` with an `OnModuleInit` hook (depends on T037)
- [X] T047 Verify **SC-007** — **9 of 10 error kinds verified against the live escrow.** On-chain: `ContractRevertError` (require-string `"not open"`, caught free at simulation), `DealNotFoundError`, `AgentNotFoundError`, `ChainConnectivityError` (unroutable RPC), `GasExhaustedError` (ceiling forced to 30,000 — confirms the *rewritten* simulation-based heuristic, since the original `gasUsed`-ratio test was broken by T042's finding). Local: `UnitConversionError`. Offline decode: `ERC20InsufficientAllowance` and `ERC20InsufficientBalance` against `erc20Abi` (R6 encoding 3; not provokable on-chain now that the allowance is unbounded and the operator is funded). **`ChainOutcomeUnknownError` verified end to end**: forced timeout returned the right class carrying a real hash, and that transaction was later confirmed SUCCESSFUL — the call failed, the transaction did not, which is the whole point. ⚠️ **Not verified: `InsufficientFundsError`** — provoking it needs a signing key with no MON in config; it is a message-regex mapping in `decode-revert.ts` and is the one untested branch
- [X] T048 Verify **SC-007** — work through the provocation table in [contracts/errors.md](./contracts/errors.md) and confirm each of the nine error kinds is reachable and reports distinguishably. The two worth doing carefully: `ChainOutcomeUnknownError` (set `RECEIPT_TIMEOUT_MS` to `1`, then confirm the hash it carries later shows a **successful** transaction on MonadVision — the call failed, the transaction did not), and the **bubbled ERC-20 error** — R6's third encoding, the one most likely to decode badly. Neither ERC-20 case can be provoked on-chain any more: the allowance is unbounded and the operator is funded. Verify that branch **offline instead**, by decoding known `ERC20InsufficientAllowance` and `ERC20InsufficientBalance` payloads directly against `erc20Abi` and confirming each maps to its typed error rather than falling through to "execution reverted". Cheaper than the on-chain route and repeatable
- [X] T049 Confirm the module's boundary is intact per [contracts/chain-api.md](./contracts/chain-api.md) — no viem client, account, or transport is exported; no ABI is exported; no `bigint` base-unit amount appears in any exported signature; and no file under `src/chain/` imports an entity, a repository, or the `DataSource`
- [X] T050 Run the full seven-step pass in [quickstart.md](./quickstart.md) end to end and confirm every SC from SC-001 to SC-009 is satisfied. Treat a failed step the way you would treat a red build

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: no dependencies
- **Foundational (Phase 2)**: depends on Setup — **blocks every story**
- **US2 (Phase 3)**: depends on Foundational. **Blocks US1, US4, US5** — they all convert money
- **US3 (Phase 4)**: depends on Foundational only. Independent of every other story
- **US1 (Phase 5)**: depends on Foundational + US2
- **US4 (Phase 6)**: depends on Foundational + US2. Independent of US1, though T032's smoke script reads through it
- **US5 (Phase 7)**: depends on US1 (there must be writes before their cost can be measured)
- **Polish (Phase 8)**: depends on US4 for the preflight's reads

### External dependencies: none

Both are resolved. The escrow is deployed and verified against this plan
([research R16](./research.md)), and the operator is funded with $20.00 USDC against an
unbounded allowance (T028). Nothing in this list is waiting on another component,
another person, or another feature.

### Parallel Opportunities

- T002 alongside T001's install
- **T003, T004, T005, T006, T007** — five foundational files, no shared imports
- **T010** alongside T008/T009
- **T017, T018, T019** — the two narrow ABIs and the tier map
- **T036** alongside the US1 tasks, once US2 is done
- US3 (Phase 4) can run entirely in parallel with US2 (Phase 3) if two people are working

---

## Parallel Example: Phase 2 Foundational

```bash
# Five independent files, no shared imports:
Task: "Create api/src/chain/monad-chain.ts"
Task: "Create api/src/chain/abi/escrow.abi.ts"
Task: "Create api/src/chain/abi/erc20.abi.ts"
Task: "Create api/src/chain/types.ts"
Task: "Create api/src/chain/errors.ts"
```

## Parallel Example: User Story 3

```bash
Task: "Create api/src/chain/abi/escrow-resolve.abi.ts"
Task: "Create api/src/chain/abi/escrow-operator.abi.ts"
Task: "Create api/src/chain/tier.ts"
```

---

## Implementation Strategy

### While the deployment is pending

Build Phases 1–4 in order. That delivers correct money conversion and a provably
narrowed guardian identity, both fully verified, with no contract deployed and no
wallet funded. It is roughly half the feature and none of it is speculative.

### MVP (User Story 1)

1. Phase 1: Setup
2. Phase 2: Foundational
3. Phase 3: US2 — required by US1
4. Phase 5: US1
5. **STOP and VALIDATE** — run the smoke script, open the transaction on MonadVision

At that point the platform can put verifiable transactions on the chain, which is what
every later feature needs and what the demo shows.

### Incremental delivery

1. Setup + Foundational → the module loads
2. + US2 → money converts correctly, verified
3. + US3 → the guardian narrowing is provable, verified
4. + US1 → **MVP**: confirmed transactions on the explorer
5. + US4 → the escrow total for the demo screen
6. + US5 → gas ceilings become measurements
7. + Polish → boot diagnostics and the full verification pass

---

## Notes

- **49 tasks**: 33 implementation, 16 verification. No test tasks by design
- [P] = different files, no dependencies
- Every verification task names the SC it discharges, so the checklist and the tasks
  cannot drift apart
- Commit after each task or logical group
- The three tasks carrying the most risk are **T026** (ids from event logs),
  **T009** (the explicit `gas` override), and **T008** (three revert encodings). Each
  fails silently or expensively rather than loudly
