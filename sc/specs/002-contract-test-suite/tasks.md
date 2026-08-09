---

description: "Task list for the GuardianEscrow contract test suite"
---

# Tasks: Contract Test Suite

**Input**: Design documents from `/specs/002-contract-test-suite/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/](./contracts/)

**Tests**: This feature **is** the test suite. Every task in Phases 3–7 writes tests —
there is no separate "tests optional" tier here. The thing under test,
`src/GuardianEscrow.sol`, is **not modified by any task in this file**; if a test reveals
a defect, that is a change to SC-01.

**Organization**: Grouped by user story so each protection group can be written and run
independently. Every test file maps one-to-one onto a story, so
`forge test --match-path` is the per-story validation command.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: US1–US5 from [spec.md](./spec.md)
- Paths are relative to the Foundry project root, `sc/`

## Path Conventions

Single Foundry project. Production code in `sc/src/`, tests in `sc/test/`, shared
fixtures in `sc/test/helpers/`. `forge` is at `~/.foundry/bin/forge` — not on a
non-interactive `PATH`.

**Every test that changes state carries the `solvent` modifier (FR-017).** This is not a
per-task reminder; it is a standing rule for every task below.

**Every revert assertion names its reason (FR-021).** No bare `vm.expectRevert()`
anywhere in the suite. Strings via `_expectRevertReason`, role failures via
`_expectUnauthorized`.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Confirm the toolchain and create the directory the suite lives in

- [X] T001 Verify toolchain: `~/.foundry/bin/forge --version` reports `1.7.1-monad-v1.0.0` or later, and `git submodule update --init --recursive` leaves `lib/forge-std` and `lib/openzeppelin-contracts` (v5.1.0) populated
- [X] T002 Create `sc/test/` and `sc/test/helpers/` directories
- [X] T003 Establish the baseline: `~/.foundry/bin/forge build` succeeds against the existing `sc/src/GuardianEscrow.sol` with no test files present

**Checkpoint**: Toolchain proven, empty test tree ready

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The mock token and the shared base contract. Every test file inherits from
`EscrowTestBase`, so nothing in Phases 3–7 can start until this compiles.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

**Contract**: [contracts/test-harness.md](./contracts/test-harness.md) is the authority
for every name and signature below. Deviating from it breaks all six test files.

- [X] T004 [P] Create `MockUSDC` in `sc/test/helpers/MockUSDC.sol` — extends OpenZeppelin `ERC20("Mock USDC", "mUSDC")`, overrides `decimals()` to return `6`, exposes unguarded `mint(address,uint256)`. No fees, no hooks, no rebasing (research R-001)
- [X] T005 Create `EscrowTestBase` skeleton in `sc/test/helpers/EscrowTestBase.sol` — `abstract contract EscrowTestBase is Test`, the seven `makeAddr` actors, the constants block (`PRICE = 2_000_000`, `ODD_PRICE = 1_000_003`, `PRICE_2 = 3_000_000`, `MINT = 1_000_000_000`, `REVIEW = 1 hours`, `ZERO_REVIEW = 0`), and `setUp() public virtual` deploying `MockUSDC` then `new GuardianEscrow(usdc, admin, operator, guardian)` (depends on T004)
- [X] T006 Complete `setUp` funding in `sc/test/helpers/EscrowTestBase.sol` — mint `MINT` to `operator`, then `vm.prank(operator); usdc.approve(address(escrow), type(uint256).max)`, and populate `participants` with all seven actors. Omitting the approval makes every `openDeal` in the suite revert inside the token
- [X] T007 Add the solvency machinery to `sc/test/helpers/EscrowTestBase.sol` — `uint256 internal donated`, `_sumBalances()` iterating `participants`, `_assertSolvent()` asserting `usdc.balanceOf(address(escrow)) == escrow.totalEscrowed() + _sumBalances() + donated`, and `modifier solvent() { _; _assertSolvent(); }` with the body **before** the assertion (research R-002)
- [X] T008 Add the revert helpers to `sc/test/helpers/EscrowTestBase.sol` — `_expectRevertReason(string)` and `_expectUnauthorized(address caller, bytes32 role)` building `abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, caller, role)` (research R-005)
- [X] T009 Add the fixture ladder to `sc/test/helpers/EscrowTestBase.sol` — `_registerAgent`, `_openDeal`, `_delivered(uint32)`, `_deliveredAt(uint256,uint32)`, `_disputed()`, `_disputedAt(uint256)`, `_track(address)`. Use `vm.prank` per call, never `startPrank`, so no fixture leaks an active prank into the line under test
- [X] T010 Read `DELIVERY_DEADLINE` and `DISPUTE_DEADLINE` from the contract in fixtures and tests (`escrow.DELIVERY_DEADLINE()`), never as redeclared constants in `sc/test/helpers/EscrowTestBase.sol` — a local copy would agree with a changed contract instead of catching it
- [X] T011 `~/.foundry/bin/forge build` compiles `test/helpers/` clean under solc 0.8.24 / shanghai

**Checkpoint**: Harness ready — all five user stories can now proceed in parallel

---

## Phase 3: User Story 1 - Verdict splits (Priority: P1) 🎯 MVP

**Goal**: Prove all five refund tiers pay exactly the advertised percentages, including
both zero-share edges and the truncation case.

**Independent Test**: `forge test --match-path test/TierSplits.t.sol` — 15 passing tests
whose names state the five splits. This is the MVP: it is the evidence the product's
headline promise is honoured, and it is the file the demo audience's number comes from.

**Rule for this phase**: the five tier assertions are **longhand**. No loop, no
`[0, 2500, 5000, 7500, 10000]` table — a table in the test is the same table as
`_refundBps`, and would agree with a bug rather than catch it (research R-004). Amounts
come from the [tier table in data-model.md §3](./data-model.md#3-the-tier-table--the-assertion-targets).

- [X] T012 [P] [US1] Create `sc/test/TierSplits.t.sol` — `contract TierSplitsTest is EscrowTestBase`, imports, no tests yet
- [X] T013 [US1] Write the five longhand tier tests in `sc/test/TierSplits.t.sol`: `test_Resolve_NoRefund_PaysSellerEverything` (0 / 2_000_000), `test_Resolve_Quarter_Splits500kTo1500k`, `test_Resolve_Half_SplitsEvenly`, `test_Resolve_ThreeQuarter_Splits1500kTo500k`, `test_Resolve_Full_PaysBuyerEverything` (2_000_000 / 0) — each asserting both `balances[buyer]` and `balances[seller]` as decimal literals
- [X] T014 [US1] Write `test_Resolve_EveryTier_SharesSumToAmount` in `sc/test/TierSplits.t.sol` — for all five tiers, `toBuyer + toSeller == amount` exactly (FR-003)
- [X] T015 [US1] Write the three truncation tests in `sc/test/TierSplits.t.sol` using `ODD_PRICE = 1_000_003`: `test_Resolve_OddAmount_Quarter_RemainderToSeller` (250_000 / 750_003), `..._Half_...` (500_001 / 500_002), `..._ThreeQuarter_...` (750_002 / 250_001) — remainder always to the seller, sum always exact (FR-004)
- [X] T016 [US1] Write the zero-share tests in `sc/test/TierSplits.t.sol`: `test_Resolve_NoRefund_BuyerHasNoClaim` and `test_Resolve_Full_SellerHasNoClaim` — balance is `0` **and** `withdrawFor(that address)` reverts `"nothing to withdraw"`, proving the `if (share > 0)` guards create no empty claim (FR-002)
- [X] T017 [US1] Write `test_Resolve_EmitsResolvedWithBothShares` and `test_Resolve_MovesNoTokens` in `sc/test/TierSplits.t.sol` — `vm.expectEmit(true, true, true, true)` so the non-indexed amounts are actually checked, and `balanceOf(escrow)` unchanged across the resolve (FR-022, research R-009)
- [X] T018 [US1] Write the force-settle tests in `sc/test/TierSplits.t.sol`: `test_ForceResolve_AfterDeadline_AppliesQuarterTier` and `test_ForceResolve_EmitsZeroVerdictHash` — the quarter split reached without the arbitrator, with `verdictHash == bytes32(0)` as the only on-chain tell (FR-006)
- [X] T019 [US1] Run `~/.foundry/bin/forge test --match-path test/TierSplits.t.sol` — 15 passing, every state-changing test carrying `solvent`

**Checkpoint**: The five percentages are proven. This alone is a deliverable.

---

## Phase 4: User Story 2 - Undisputed lifecycles (Priority: P2)

**Goal**: Prove the three non-dispute endings each credit the full amount to exactly one
party, and that the payout can actually be taken out.

**Independent Test**: `forge test --match-path test/HappyPath.t.sol` — 18 passing tests
covering register → open → deliver → {accept | release | reclaim} → withdraw.

- [X] T020 [P] [US2] Create `sc/test/HappyPath.t.sol` — `contract HappyPathTest is EscrowTestBase`
- [X] T021 [US2] Write the `openDeal` tests in `sc/test/HappyPath.t.sol`: `test_OpenDeal_EscrowsPriceFromOperator`, `test_OpenDeal_PinsSellerAmountAndDefinition`, `test_OpenDeal_EmitsDealOpened`, `test_OpenDeal_WithoutAllowance_RevertsInToken` (expect `ERC20InsufficientAllowance`, **not** `SafeERC20FailedOperation` — SafeERC20 v5.1 bubbles the token's error), `test_OpenDeal_InactiveAgent_Reverts` (`"agent inactive"`)
- [X] T022 [US2] Write `test_MarkDelivered_StartsReviewWindow` in `sc/test/HappyPath.t.sol` — state becomes `Delivered`, `deliveredAt == block.timestamp`, `Delivered` event emitted
- [X] T023 [US2] Write the accept tests in `sc/test/HappyPath.t.sol`: `test_Accept_ByBuyer_CreditsSellerFullAmount`, `test_Accept_MovesNoTokens`, `test_Accept_EmitsReleased` — settlement is bookkeeping; `balanceOf(escrow)` must not change
- [X] T024 [US2] Write the lapse and reclaim tests in `sc/test/HappyPath.t.sol`: `test_Release_AfterWindow_CreditsSellerFullAmount`, `test_Reclaim_AfterDeadline_CreditsBuyerFullAmount`, `test_Reclaim_EmitsReclaimed`
- [X] T025 [US2] Write the withdrawal tests in `sc/test/HappyPath.t.sol`: `test_Withdraw_PaysCallerAndZeroesBalance`, `test_Withdraw_Twice_Reverts` (`"nothing to withdraw"`), `test_Withdraw_EmitsWithdrawn`
- [X] T026 [US2] Write the agent-lifecycle tests in `sc/test/HappyPath.t.sol`: `test_Seller_BalancesAccumulateAcrossTwoAgents` (uses `seller2`/`PRICE_2`), `test_UpdateAgent_DoesNotAffectRunningDeal` (FR-016 — the running deal keeps its pinned hash, version and amount), `test_SetAgentActive_False_BlocksNewDealsOnly`
- [X] T027 [US2] Run `~/.foundry/bin/forge test --match-path test/HappyPath.t.sol` — 18 passing

**Checkpoint**: US1 and US2 both pass independently

---

## Phase 5: User Story 3 - Deadline boundaries (Priority: P3)

**Goal**: Prove each of the four time gates rejects on one side and permits on the other,
with no instant where a purchase is stuck between them.

**Independent Test**: `forge test --match-path test/Timers.t.sol` — 12 passing tests,
eight of them boundary pairs.

**Rule for this phase**: warp to **absolute** instants computed from the deal's own
`deliveredAt` / `openedAt` / `disputedAt`, never relative `block.timestamp + N` jumps —
fixtures already move time, and a relative jump makes the instant under test depend on
fixture internals (research R-006). Boundaries are in
[data-model.md §5](./data-model.md#5-time-model).

- [X] T028 [P] [US3] Create `sc/test/Timers.t.sol` — `contract TimersTest is EscrowTestBase`
- [X] T029 [US3] Write the review-window pair in `sc/test/Timers.t.sol`: `test_Release_OneSecondBeforeWindowEnd_Reverts` (`"window open"`), `test_Release_AtExactWindowEnd_Succeeds`, `test_Dispute_OneSecondBeforeWindowEnd_Succeeds`, `test_Dispute_AtExactWindowEnd_Reverts` (`"window closed"`)
- [X] T030 [US3] Write `test_AtWindowEnd_ReleaseAvailable_DisputeNot` in `sc/test/Timers.t.sol` — both checked at the single instant `deliveredAt + reviewWindow`, proving the `>=` / `<` pair leaves neither overlap nor gap (FR-008)
- [X] T031 [US3] Write the delivery-deadline pair in `sc/test/Timers.t.sol`: `test_Reclaim_OneSecondBeforeDeadline_Reverts` (`"too early"`) and `test_Reclaim_AtExactDeadline_Succeeds`, anchored on `openedAt + escrow.DELIVERY_DEADLINE()`
- [X] T032 [US3] Write the dispute-deadline pair in `sc/test/Timers.t.sol`: `test_ForceResolve_OneSecondBeforeDeadline_Reverts` (`"too early"`) and `test_ForceResolve_AtExactDeadline_Succeeds`, anchored on `disputedAt + escrow.DISPUTE_DEADLINE()`
- [X] T033 [US3] Write the degenerate-window and not-gated tests in `sc/test/Timers.t.sol`: `test_ZeroReviewWindow_ReleasableAtDelivery`, `test_ZeroReviewWindow_NeverDisputable` (`"window closed"` at the delivery instant — accepted product risk, asserted as intended behaviour), `test_Accept_NotWindowGated_SucceedsAfterWindowLapses`
- [X] T034 [US3] Run `~/.foundry/bin/forge test --match-path test/Timers.t.sol` — 12 passing

**Checkpoint**: US1–US3 pass independently

---

## Phase 6: User Story 4 - Authority and payees (Priority: P4)

**Goal**: Prove every restricted action rejects the wrong caller, the three
permissionless actions succeed for a stranger, and a payout always reaches the party
owed rather than the caller.

**Independent Test**: `forge test --match-path test/AccessControl.t.sol` and
`--match-path test/Withdrawals.t.sol` — 19 + 6 passing tests.

Two files, so T035 and T041 are parallel with each other.

- [X] T035 [P] [US4] Create `sc/test/AccessControl.t.sol` — `contract AccessControlTest is EscrowTestBase`
- [X] T036 [US4] Write the operator-gated rejection tests in `sc/test/AccessControl.t.sol`: `test_RegisterAgent_RevertsForStranger`, `test_RegisterAgent_RevertsForGuardian`, `test_UpdateAgent_RevertsForStranger`, `test_SetAgentActive_RevertsForStranger`, `test_OpenDeal_RevertsForStranger`, `test_OpenDeal_RevertsForGuardian`, `test_MarkDelivered_RevertsForStranger` — all via `_expectUnauthorized(caller, escrow.OPERATOR_ROLE())`
- [X] T037 [US4] Write the guardian-gated rejection tests in `sc/test/AccessControl.t.sol`: `test_Resolve_RevertsForOperator`, `test_Resolve_RevertsForStranger`, `test_Resolve_RevertsForAdmin` — the backend holding `OPERATOR_ROLE` must **not** be able to rule (FR-010)
- [X] T038 [US4] Write the buyer-gated tests in `sc/test/AccessControl.t.sol`: `test_Accept_RevertsForThirdParty` and `test_Dispute_RevertsForThirdParty` (`"not buyer"`, a string not a custom error), plus `test_Accept_AllowedForOperator` and `test_Dispute_AllowedForOperator` (FR-013)
- [X] T039 [US4] Write the permissionless-success tests in `sc/test/AccessControl.t.sol`: `test_Release_SucceedsForStranger`, `test_Reclaim_SucceedsForStranger`, `test_ForceResolve_SucceedsForStranger` — each called by `stranger` past the relevant deadline, asserting both that it succeeds and that the caller is credited nothing (FR-011)
- [X] T040 [US4] Write the admin-boundary tests in `sc/test/AccessControl.t.sol`: `test_Admin_CannotDriveLifecycle` (every operator function reverts for `admin`) and `test_Admin_CanGrantAndRevokeRoles`
- [X] T041 [P] [US4] Create `sc/test/Withdrawals.t.sol` — `contract WithdrawalsTest is EscrowTestBase`
- [X] T042 [US4] Write the payee tests in `sc/test/Withdrawals.t.sol`: `test_WithdrawFor_ThirdPartyCaller_PaysNamedAccount` and `test_WithdrawFor_ThirdPartyCaller_ReceivesNothing` — `stranger` calls, `seller` receives, `stranger`'s token balance unchanged. **This pair is why the file exists**: a test that only calls `withdrawFor` as the owner would not have caught the bug it was written for (FR-012)
- [X] T043 [US4] Write the remaining withdrawal tests in `sc/test/Withdrawals.t.sol`: `test_WithdrawFor_ZeroBalance_Reverts`, `test_Withdraw_DelegatesToWithdrawFor_SameEffect`, `test_WithdrawFor_ZeroesBalanceBeforeTransfer`, `test_WithdrawFor_EmitsWithdrawnForAccount` (the event names the account, not the caller)
- [X] T044 [US4] Run `~/.foundry/bin/forge test --match-path test/AccessControl.t.sol` and `--match-path test/Withdrawals.t.sol` — 19 + 6 passing

**Checkpoint**: US1–US4 pass independently

---

## Phase 7: User Story 5 - Finality and solvency (Priority: P5)

**Goal**: Prove no purchase settles twice from any entry point, every action rejects a
wrong prior state, and the funds held always cover the claims.

**Independent Test**: `forge test --match-path test/StateMachine.t.sol` — 11 passing
tests, five of them full rejection sweeps.

Rejection targets are the [state matrix in data-model.md §4](./data-model.md#4-deal-state-machine--what-each-state-must-reject).

- [X] T045 [P] [US5] Create `sc/test/StateMachine.t.sol` — `contract StateMachineTest is EscrowTestBase`, plus a file-local `_expectEveryRouteRejected(uint256 dealId)` helper asserting all seven wrong-state reverts against one deal
- [X] T046 [US5] Write the five double-settle sweeps in `sc/test/StateMachine.t.sol`: `test_SettledByAccept_RejectsAllOtherRoutes`, `test_SettledByRelease_...`, `test_SettledByReclaim_...`, `test_SettledByResolve_...`, `test_SettledByForceResolve_...` — five separate sweeps, not one, because each route reaches `Settled` through different code (FR-014)
- [X] T047 [US5] Write the wrong-prior-state tests in `sc/test/StateMachine.t.sol`: `test_Open_RejectsAcceptReleaseDisputeResolve`, `test_Delivered_RejectsMarkDeliveredReclaimResolveForce`, `test_Disputed_RejectsAcceptReleaseDisputeMarkDelivered`
- [X] T048 [US5] Write the unknown-id tests in `sc/test/StateMachine.t.sol`: `test_UnknownDealId_RejectsEveryEntryPoint` (id `999`) and `test_DealIdZero_RejectsEveryEntryPoint` (id `0` — ids start at 1, so a zero-filled struct reads as `None`) (FR-015)
- [X] T049 [US5] Write `test_DirectTokenDonation_KeepsInvariantAndOutcomes` in `sc/test/StateMachine.t.sol` — transfer tokens straight to the escrow, set `donated` in the same step, assert the invariant still holds and that no deal's settlement changes (FR-018)
- [X] T050 [US5] Run `~/.foundry/bin/forge test --match-path test/StateMachine.t.sol` — 11 passing

**Checkpoint**: All five user stories pass independently

---

## Phase 8: Polish & Cross-Cutting Validation

**Purpose**: Verify the success criteria that no individual test can prove on its own.
Procedures are in [quickstart.md §3](./quickstart.md#3-validate-the-success-criteria).

- [X] T051 Run the full suite: `~/.foundry/bin/forge test` — expect `81 tests passed, 0 failed, 0 skipped` across 6 suites (SC-001)
- [X] T052 Audit SC-003: `grep -rn "function test_" test/ | grep -v solvent` — every line it prints must be a genuinely read-only test. Add the missing modifier anywhere it is not
- [X] T053 Audit SC-001 and FR-021: `grep -rn "vm.skip\|vm.expectRevert()" test/` returns nothing — no skipped tests, no bare revert expectations
- [X] T054 Run the SC-010 mutation procedure: change `Tier.Quarter` to `2_501` in `src/GuardianEscrow.sol`, confirm `test_Resolve_Quarter_Splits500kTo1500k`, `test_Resolve_OddAmount_Quarter_RemainderToSeller` and `test_ForceResolve_AfterDeadline_AppliesQuarterTier` fail, then `git checkout src/GuardianEscrow.sol`. Repeat for one other tier. **A green run at this step means the tier tests prove nothing**
- [X] T055 [P] Verify SC-009: `forge test && forge test` gives identical output, and `forge test --match-test test_Resolve_Quarter_Splits500kTo1500k` passes in isolation
- [X] T056 [P] Verify SC-008: the suite's reported runtime is under 60 seconds
- [X] T057 Confirm `git diff src/` is empty — this feature tests `GuardianEscrow`, it does not change it
- [X] T058 Reconcile [contracts/coverage-matrix.md](./contracts/coverage-matrix.md) with the delivered files: every matrix row names a test function that exists, and the totals in [plan.md](./plan.md) and [quickstart.md](./quickstart.md) match the real count if it drifted from 81

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: no dependencies
- **Foundational (Phase 2)**: depends on Setup — **blocks every user story**. `MockUSDC` (T004) blocks the base contract (T005), which blocks everything else
- **User Stories (Phases 3–7)**: all depend only on Phase 2. Different files, no shared mutable state, so they can be written in any order or simultaneously
- **Polish (Phase 8)**: depends on all five stories

### User Story Dependencies

None between stories. Each writes one file (US4 writes two) inheriting the same base
contract, and Foundry re-runs `setUp()` per test function, so cross-story contamination
is structurally impossible.

Priority order is US1 → US2 → US3 → US4 → US5 by value, not by dependency. US1 is first
because a wrong refund percentage is silent until a live verdict; everything else fails
loudly.

### Within Each Story

Tasks within one story touch **the same file** and are therefore sequential. Only the
first task of each story (the file scaffold) is marked `[P]`.

### Parallel Opportunities

- T004 is `[P]` — the mock is independent of everything
- Once Phase 2 completes: T012, T020, T028, T035, T041, T045 can all start at once — six files, six workers
- T055 and T056 are read-only verifications and can run alongside each other

---

## Parallel Example: after the harness lands

```bash
# Six independent files, one per protection group:
Task: "Create sc/test/TierSplits.t.sol and write the five longhand tier tests"     # US1
Task: "Create sc/test/HappyPath.t.sol and write the undisputed lifecycle tests"    # US2
Task: "Create sc/test/Timers.t.sol and write the four deadline boundary pairs"     # US3
Task: "Create sc/test/AccessControl.t.sol and write the caller-authority tests"    # US4
Task: "Create sc/test/Withdrawals.t.sol and write the payee tests"                 # US4
Task: "Create sc/test/StateMachine.t.sol and write the double-settle sweeps"       # US5
```

---

## Implementation Strategy

### MVP First (User Story 1 only)

1. Phase 1: Setup — T001–T003
2. Phase 2: Foundational — T004–T011 (**blocks everything**)
3. Phase 3: User Story 1 — T012–T019
4. **STOP and VALIDATE**: `forge test --match-path test/TierSplits.t.sol`, then run the
   T054 mutation procedure against `Quarter`
5. At this point the project's highest-risk behaviour is proven and demonstrable

Running the mutation check at the MVP boundary rather than only at the end is
deliberate: it is the step that distinguishes a tier suite that works from one that
agrees with the bug, and finding that out early is worth the sixty seconds.

### Incremental Delivery

Each phase adds one runnable group and breaks nothing before it:
Setup + Foundational → US1 (MVP) → US2 → US3 → US4 → US5 → Polish.

### Parallel Team Strategy

One person does Phases 1–2 alone — it is one file and everything downstream binds to it.
After that, six files can be split across as many people as are available, since none of
them import each other.

---

## Notes

- **`src/` is out of bounds.** The only task permitted to touch `src/GuardianEscrow.sol`
  is T054, which reverts its own edit. A test that fails is evidence of an SC-01 defect;
  fix it there, in its own change
- Revert strings are an interface fixed by
  [SC-01's access-control contract](../001-guardian-escrow-contract/contracts/access-control.md)
  §3 — assert the exact strings, do not invent variants
- Role failures are OZ v5's `AccessControlUnauthorizedAccount` custom error; everything
  else in the contract is a short `require` string. The two are not interchangeable
- Commit per task or per logical group; each checkpoint is a safe stopping point

---

## Implementation Record

**Completed 2026-08-08. All 58 tasks done. `forge test`: 81 passed, 0 failed, 0 skipped
across 6 suites in ~26 ms.**

Phases 1–2 and 8 were run directly; Phases 3–7 were written by six agents in parallel,
one per file, each in an isolated sandbox (project copy with a symlinked `lib`) so a
half-written file in one could not break another's `forge test`.

### Success criteria, as measured

| SC | Result |
| --- | --- |
| SC-001 suite passes, nothing skipped | 81/81, no `vm.skip`, no commented-out tests |
| SC-002 five findable tier checks | present, longhand, decimal literals |
| SC-003 solvency after every state-changing test | `solvent` count equals test count in all six files (19/19, 18/18, 15/15, 12/12, 11/11, 6/6) |
| SC-004 restricted actions guarded, open ones proven open | 19 access-control tests |
| SC-005 boundary coverage | 8 boundary tests across 4 gates, plus the single-instant exclusion test |
| SC-006 third-party payout reaches the payee | proven, and mutation-checked by the agent |
| SC-007 every settlement route sealed | 5 sweeps × 7 rejections |
| SC-008 under 60 s | ~26 ms |
| SC-009 reproducible and isolated | two consecutive runs identical; single test passes alone |
| SC-010 mutation sensitivity | **three tiers perturbed, all caught** (below) |

### SC-010 results

| Mutation | Tests that failed |
| --- | --- |
| `Quarter` 2_500 → 2_501 | 4 — `Quarter_Splits500kTo1500k`, `OddAmount_Quarter_RemainderToSeller`, `ForceResolve_AppliesQuarterTier`, `ForceResolve_EmitsZeroVerdictHash` |
| `Half` 5_000 → 5_001 | 2 — `Half_SplitsEvenly`, `OddAmount_Half_RemainderToSeller` |
| `Full` 10_000 → 9_999 | 2 — `Full_PaysBuyerEverything`, `Full_SellerHasNoClaim` (the zero-share guard) |

`src/GuardianEscrow.sol` was restored with `git checkout` after each; `git diff src/` is
empty and `git status --porcelain src/` reports no changes.

### Deviations from the plan

- **The harness grew deal accessors and boundary helpers** (`_state`, `_amountOf`,
  `_windowEnd`, `_deliveryDeadline`, `_disputeDeadline`, and siblings). `deals(id)`
  returns an 11-element tuple, and six files each destructuring it by hand was the
  obvious way to get a silently wrong index. [contracts/test-harness.md](./contracts/test-harness.md)
  §2.3.1 was updated to match.
- **Three file-local helpers** were added by the agents where a shared fixture would have
  been over-general: `_expectEveryRouteRejected` (StateMachine), `_owedToSeller`
  (Withdrawals), and a caller-gains-nothing pair (AccessControl).
- **`forge fmt` was not run.** `src/GuardianEscrow.sol` is hand-wrapped at ~97 characters
  and does not satisfy `forge fmt --check` either; the test files match the repo's actual
  style, and reformatting would have touched the contract.

### Contract defects found

**None.** All six agents reported the contract matching its spec on the first run — every
tier, both truncation directions, all four deadline boundaries, every role restriction,
every state guard, and the `withdrawFor` payee behaviour. No test was weakened to pass.
