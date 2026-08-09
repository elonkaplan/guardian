# Contract: Coverage Matrix

**Feature**: [../spec.md](../spec.md) · **Harness**: [test-harness.md](./test-harness.md)

The planned test inventory, and the two mappings that make the spec auditable:
requirement → test, and entry point → test. `/speckit-tasks` turns the inventory into
tasks; a reviewer uses the mappings to check nothing was quietly dropped.

**81 test functions across six files.** Every one that changes state carries the
`solvent` modifier.

---

## 1. `test/TierSplits.t.sol` — US1 (P1)

The file the whole suite exists for. Five longhand assertions, no table
([research R-004](../research.md#r-004--the-five-tier-assertions-are-longhand-not-table-driven)).

| # | Test | Asserts |
| --- | --- | --- |
| 1 | `test_Resolve_NoRefund_PaysSellerEverything` | buyer `0`, seller `2_000_000` |
| 2 | `test_Resolve_Quarter_Splits500kTo1500k` | buyer `500_000`, seller `1_500_000` |
| 3 | `test_Resolve_Half_SplitsEvenly` | buyer `1_000_000`, seller `1_000_000` |
| 4 | `test_Resolve_ThreeQuarter_Splits1500kTo500k` | buyer `1_500_000`, seller `500_000` |
| 5 | `test_Resolve_Full_PaysBuyerEverything` | buyer `2_000_000`, seller `0` |
| 6 | `test_Resolve_EveryTier_SharesSumToAmount` | all five tiers: `toBuyer + toSeller == amount` |
| 7 | `test_Resolve_OddAmount_Quarter_RemainderToSeller` | `1_000_003` → `250_000` / `750_003` |
| 8 | `test_Resolve_OddAmount_Half_RemainderToSeller` | `1_000_003` → `500_001` / `500_002` |
| 9 | `test_Resolve_OddAmount_ThreeQuarter_RemainderToSeller` | `1_000_003` → `750_002` / `250_001` |
| 10 | `test_Resolve_NoRefund_BuyerHasNoClaim` | buyer balance `0` **and** `withdrawFor(buyer)` reverts `"nothing to withdraw"` |
| 11 | `test_Resolve_Full_SellerHasNoClaim` | mirror of 10 for the seller |
| 12 | `test_Resolve_EmitsResolvedWithBothShares` | `Resolved(dealId, tier, toBuyer, toSeller, verdictHash)`, all four `expectEmit` flags |
| 13 | `test_Resolve_MovesNoTokens` | `balanceOf(escrow)` unchanged across the resolve |
| 14 | `test_ForceResolve_AfterDeadline_AppliesQuarterTier` | the `Quarter` row, reached without the arbitrator |
| 15 | `test_ForceResolve_EmitsZeroVerdictHash` | `verdictHash == bytes32(0)` — the only on-chain tell |

---

## 2. `test/HappyPath.t.sol` — US2 (P2)

| # | Test | Asserts |
| --- | --- | --- |
| 1 | `test_OpenDeal_EscrowsPriceFromOperator` | operator `−price`, escrow `+price`, `totalEscrowed +price` |
| 2 | `test_OpenDeal_PinsSellerAmountAndDefinition` | deal snapshots `seller`, `amount`, `defHash`, `defVersion` |
| 3 | `test_OpenDeal_EmitsDealOpened` | full event payload |
| 4 | `test_OpenDeal_WithoutAllowance_RevertsInToken` | `ERC20InsufficientAllowance`, no deal created |
| 5 | `test_OpenDeal_InactiveAgent_Reverts` | `"agent inactive"` |
| 6 | `test_MarkDelivered_StartsReviewWindow` | state `Delivered`, `deliveredAt == block.timestamp`, `Delivered` event |
| 7 | `test_Accept_ByBuyer_CreditsSellerFullAmount` | seller `+amount`, buyer `0`, `totalEscrowed −amount` |
| 8 | `test_Accept_MovesNoTokens` | `balanceOf(escrow)` unchanged |
| 9 | `test_Accept_EmitsReleased` | `Released(dealId, seller, amount)` |
| 10 | `test_Release_AfterWindow_CreditsSellerFullAmount` | same effects as 7, reached by lapse |
| 11 | `test_Reclaim_AfterDeadline_CreditsBuyerFullAmount` | buyer `+amount`, seller `0` |
| 12 | `test_Reclaim_EmitsReclaimed` | `Reclaimed(dealId, buyer, amount)` |
| 13 | `test_Withdraw_PaysCallerAndZeroesBalance` | tokens leave escrow, balance `0` |
| 14 | `test_Withdraw_Twice_Reverts` | second call `"nothing to withdraw"` |
| 15 | `test_Withdraw_EmitsWithdrawn` | `Withdrawn(account, amount)` |
| 16 | `test_Seller_BalancesAccumulateAcrossTwoAgents` | one seller, two agents, single accumulated balance |
| 17 | `test_UpdateAgent_DoesNotAffectRunningDeal` | running deal keeps its pinned hash/version/amount |
| 18 | `test_SetAgentActive_False_BlocksNewDealsOnly` | new `openDeal` reverts; the running deal still settles |

---

## 3. `test/Timers.t.sol` — US3 (P3)

| # | Test | Instant | Expected |
| --- | --- | --- | --- |
| 1 | `test_Release_OneSecondBeforeWindowEnd_Reverts` | `T−1` | `"window open"` |
| 2 | `test_Release_AtExactWindowEnd_Succeeds` | `T` | settles |
| 3 | `test_Dispute_OneSecondBeforeWindowEnd_Succeeds` | `T−1` | `Disputed` |
| 4 | `test_Dispute_AtExactWindowEnd_Reverts` | `T` | `"window closed"` |
| 5 | `test_AtWindowEnd_ReleaseAvailable_DisputeNot` | `T` | both checked at one instant — **FR-008** |
| 6 | `test_Reclaim_OneSecondBeforeDeadline_Reverts` | `openedAt+24h−1` | `"too early"` |
| 7 | `test_Reclaim_AtExactDeadline_Succeeds` | `openedAt+24h` | buyer refunded |
| 8 | `test_ForceResolve_OneSecondBeforeDeadline_Reverts` | `disputedAt+72h−1` | `"too early"` |
| 9 | `test_ForceResolve_AtExactDeadline_Succeeds` | `disputedAt+72h` | quarter split |
| 10 | `test_ZeroReviewWindow_ReleasableAtDelivery` | delivery instant | settles immediately |
| 11 | `test_ZeroReviewWindow_NeverDisputable` | delivery instant | `"window closed"` |
| 12 | `test_Accept_NotWindowGated_SucceedsAfterWindowLapses` | `T+1000` | accept still works — it is deliberately *not* time-gated |

---

## 4. `test/AccessControl.t.sol` — US4 (P4)

| # | Test | Caller | Expected |
| --- | --- | --- | --- |
| 1 | `test_RegisterAgent_RevertsForStranger` | `stranger` | `AccessControlUnauthorizedAccount` |
| 2 | `test_RegisterAgent_RevertsForGuardian` | `guardian` | same — the arbitrator holds no lifecycle power |
| 3 | `test_UpdateAgent_RevertsForStranger` | `stranger` | same |
| 4 | `test_SetAgentActive_RevertsForStranger` | `stranger` | same |
| 5 | `test_OpenDeal_RevertsForStranger` | `stranger` | same |
| 6 | `test_OpenDeal_RevertsForGuardian` | `guardian` | same |
| 7 | `test_MarkDelivered_RevertsForStranger` | `stranger` | same |
| 8 | `test_Resolve_RevertsForOperator` | `operator` | same — **the backend cannot rule** |
| 9 | `test_Resolve_RevertsForStranger` | `stranger` | same |
| 10 | `test_Resolve_RevertsForAdmin` | `admin` | same |
| 11 | `test_Accept_RevertsForThirdParty` | `stranger` | `"not buyer"` |
| 12 | `test_Accept_AllowedForOperator` | `operator` | settles — acting for the buyer |
| 13 | `test_Dispute_RevertsForThirdParty` | `stranger` | `"not buyer"` |
| 14 | `test_Dispute_AllowedForOperator` | `operator` | `Disputed` |
| 15 | `test_Release_SucceedsForStranger` | `stranger` | **permissionless by design** |
| 16 | `test_Reclaim_SucceedsForStranger` | `stranger` | permissionless by design |
| 17 | `test_ForceResolve_SucceedsForStranger` | `stranger` | permissionless by design |
| 18 | `test_Admin_CannotDriveLifecycle` | `admin` | every operator function reverts |
| 19 | `test_Admin_CanGrantAndRevokeRoles` | `admin` | the one thing admin *can* do |

---

## 5. `test/Withdrawals.t.sol` — US4 (P4), the payee bug

Split out of access control so it is findable by name. The function exists because of a
real bug; a test that only calls it as the owner would not have caught it.

| # | Test | Asserts |
| --- | --- | --- |
| 1 | `test_WithdrawFor_ThirdPartyCaller_PaysNamedAccount` | `stranger` calls, **`seller`** receives |
| 2 | `test_WithdrawFor_ThirdPartyCaller_ReceivesNothing` | `stranger`'s token balance unchanged |
| 3 | `test_WithdrawFor_ZeroBalance_Reverts` | `"nothing to withdraw"` |
| 4 | `test_Withdraw_DelegatesToWithdrawFor_SameEffect` | both entry points produce identical state |
| 5 | `test_WithdrawFor_ZeroesBalanceBeforeTransfer` | balance is `0` after; effects precede interaction |
| 6 | `test_WithdrawFor_EmitsWithdrawnForAccount` | event names the **account**, not the caller |

---

## 6. `test/StateMachine.t.sol` — US5 (P5)

| # | Test | Asserts |
| --- | --- | --- |
| 1 | `test_SettledByAccept_RejectsAllOtherRoutes` | 7 rejections against the settled deal |
| 2 | `test_SettledByRelease_RejectsAllOtherRoutes` | same sweep |
| 3 | `test_SettledByReclaim_RejectsAllOtherRoutes` | same sweep |
| 4 | `test_SettledByResolve_RejectsAllOtherRoutes` | same sweep |
| 5 | `test_SettledByForceResolve_RejectsAllOtherRoutes` | same sweep |
| 6 | `test_Open_RejectsAcceptReleaseDisputeResolve` | wrong-state guards from `Open` |
| 7 | `test_Delivered_RejectsMarkDeliveredReclaimResolveForce` | wrong-state guards from `Delivered` |
| 8 | `test_Disputed_RejectsAcceptReleaseDisputeMarkDelivered` | wrong-state guards from `Disputed` |
| 9 | `test_UnknownDealId_RejectsEveryEntryPoint` | id `999` |
| 10 | `test_DealIdZero_RejectsEveryEntryPoint` | id `0` — ids start at 1 |
| 11 | `test_DirectTokenDonation_KeepsInvariantAndOutcomes` | donated tokens strand harmlessly; settlement unchanged |

---

## 7. Requirement → test

| Req | Covered by |
| --- | --- |
| FR-001 five explicit tier assertions | TierSplits 1–5 |
| FR-002 both zero-share edges | TierSplits 1, 5, 10, 11 |
| FR-003 shares sum to amount | TierSplits 6, 7, 8, 9 |
| FR-004 non-divisible amount, remainder to seller | TierSplits 7, 8, 9 |
| FR-005 all three undisputed endings | HappyPath 7, 10, 11 |
| FR-006 force-settle → quarter, no verdict hash | TierSplits 14, 15 |
| FR-007 three deadlines, both sides | Timers 1–9 |
| FR-008 exact-instant mutual exclusion | Timers 5 |
| FR-009 deterministic time control | Timers, all — `vm.warp` to absolute instants |
| FR-010 wrong-caller rejection, incl. cross-role | AccessControl 1–11, 13, 18 |
| FR-011 three permissionless functions succeed for a stranger | AccessControl 15, 16, 17 |
| FR-012 third-party payout reaches the payee | Withdrawals 1, 2, 6 |
| FR-013 buyer actions also available to the operator | AccessControl 12, 14 |
| FR-014 double-settle sweep from all five routes | StateMachine 1–5 |
| FR-015 wrong prior state, incl. unknown ids | StateMachine 6–10 |
| FR-016 pinned definition survives an agent update | HappyPath 17 |
| FR-017 solvency after every state-changing test | the `solvent` modifier, all six files |
| FR-018 direct donation preserves the invariant | StateMachine 11 |
| FR-019 six-decimal mock token | `test/helpers/MockUSDC.sol` |
| FR-020 per-test independence | Foundry re-runs `setUp` per test; no shared mutable state |
| FR-021 assert the specific revert reason | `_expectRevertReason` / `_expectUnauthorized`; no bare `vm.expectRevert()` |
| FR-022 settlement events carry the right payload | TierSplits 12, 15; HappyPath 3, 9, 12, 15; Withdrawals 6 |

## 8. Success criterion → evidence

| SC | Evidence |
| --- | --- |
| SC-001 suite passes, nothing skipped | `forge test` output; no `vm.skip`, no commented tests |
| SC-002 five findable tier checks | TierSplits 1–5, names contain the split |
| SC-003 solvency after 100% of state-changing tests | `grep -c solvent test/*.t.sol` equals the state-changing test count |
| SC-004 every restricted action guarded; three open ones proven open | AccessControl 1–19 |
| SC-005 six-plus boundary checks | Timers 1–9 — eight boundary tests across four gates |
| SC-006 third-party payout provably reaches the payee | Withdrawals 1, 2 |
| SC-007 every settlement route sealed | StateMachine 1–5 |
| SC-008 under 60 seconds | `forge test` timing line |
| SC-009 reproducible, isolated | rerun + `--match-test` single-test run, per quickstart |
| SC-010 one-basis-point mutation fails a test | manual procedure in [quickstart](../quickstart.md) |

## 9. Entry point → coverage

All 13 external functions, each with a success path and a rejection path.

| Function | Success | Wrong caller | Wrong state | Wrong time |
| --- | --- | --- | --- | --- |
| `registerAgent` | HappyPath 1 | AC 1, 2 | — | — |
| `updateAgent` | HappyPath 17 | AC 3 | — | — |
| `setAgentActive` | HappyPath 18 | AC 4 | — | — |
| `openDeal` | HappyPath 1 | AC 5, 6 | HappyPath 5 | — |
| `markDelivered` | HappyPath 6 | AC 7 | SM 1–5, 7, 8 | — |
| `accept` | HappyPath 7 | AC 11 | SM 1–6, 8 | Timers 12 (not gated) |
| `release` | HappyPath 10 | AC 15 (open) | SM 1–6, 8 | Timers 1, 2 |
| `reclaim` | HappyPath 11 | AC 16 (open) | SM 1–5, 7, 8 | Timers 6, 7 |
| `dispute` | Timers 3 | AC 13 | SM 1–6, 8 | Timers 4, 5, 11 |
| `resolve` | TierSplits 1–5 | AC 8, 9, 10 | SM 1–7 | — |
| `forceResolve` | TierSplits 14 | AC 17 (open) | SM 1–7 | Timers 8, 9 |
| `withdraw` | HappyPath 13 | — (pays caller only) | HappyPath 14 | — |
| `withdrawFor` | Withdrawals 1 | AC — (open by design) | Withdrawals 3 | — |
