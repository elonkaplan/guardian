// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {EscrowTestBase} from "./helpers/EscrowTestBase.sol";
import {GuardianEscrow} from "../src/GuardianEscrow.sol";

/// @title TimersTest
/// @notice The four deadline gates, each pinned from both sides of its exact instant.
///
/// @dev Every warp in this file targets an ABSOLUTE instant derived from the deal's own
///      recorded timestamps (`_windowEnd`, `_deliveryDeadline`, `_disputeDeadline`).
///      Relative jumps — `block.timestamp + N`, `skip(N)` — would make the instant under
///      test depend on how much time the fixtures happened to consume, and a boundary
///      test that lands one second off passes from either side and proves nothing.
contract TimersTest is EscrowTestBase {
    // ------------------------------------------------------- review window: release

    function test_Release_OneSecondBeforeWindowEnd_Reverts() public solvent {
        uint256 dealId = _delivered(REVIEW);

        vm.warp(_windowEnd(dealId) - 1);
        _expectRevertReason("window open");
        vm.prank(stranger);
        escrow.release(dealId);
    }

    function test_Release_AtExactWindowEnd_Succeeds() public solvent {
        uint256 dealId = _delivered(REVIEW);

        vm.warp(_windowEnd(dealId));
        vm.prank(stranger);
        escrow.release(dealId);

        assertEq(uint8(_state(dealId)), uint8(GuardianEscrow.DealState.Settled));
        assertEq(escrow.balances(seller), PRICE);
        assertEq(escrow.totalEscrowed(), 0);
    }

    // ------------------------------------------------------- review window: dispute

    function test_Dispute_OneSecondBeforeWindowEnd_Succeeds() public solvent {
        uint256 dealId = _delivered(REVIEW);

        vm.warp(_windowEnd(dealId) - 1);
        vm.prank(buyer);
        escrow.dispute(dealId);

        assertEq(uint8(_state(dealId)), uint8(GuardianEscrow.DealState.Disputed));
        // The complaint must anchor the 72h clock at the instant it was made, not at
        // delivery — forceResolve's deadline is derived from this field.
        assertEq(_disputedAtOf(dealId), uint64(_windowEnd(dealId) - 1));
    }

    function test_Dispute_AtExactWindowEnd_Reverts() public solvent {
        uint256 dealId = _delivered(REVIEW);

        vm.warp(_windowEnd(dealId));
        _expectRevertReason("window closed");
        vm.prank(buyer);
        escrow.dispute(dealId);
    }

    /// @dev The pair test. `release` uses `>=` and `dispute` uses `<` on the SAME
    ///      expression, so the two must partition the timeline exactly: asserting them
    ///      separately at separate instants would still pass if the contract had an
    ///      overlap (both available) or a gap (neither) at this one instant. Only
    ///      exercising both without an intervening warp rules that out.
    function test_AtWindowEnd_ReleaseAvailable_DisputeNot() public solvent {
        uint256 dealId = _delivered(REVIEW);

        vm.warp(_windowEnd(dealId));

        _expectRevertReason("window closed");
        vm.prank(buyer);
        escrow.dispute(dealId);

        // Same instant, no second warp — the deal is still Delivered, and release opens
        // precisely where dispute shut.
        assertEq(uint8(_state(dealId)), uint8(GuardianEscrow.DealState.Delivered));
        vm.prank(stranger);
        escrow.release(dealId);

        assertEq(uint8(_state(dealId)), uint8(GuardianEscrow.DealState.Settled));
        assertEq(escrow.balances(seller), PRICE);
    }

    // ----------------------------------------------------------- delivery deadline

    function test_Reclaim_OneSecondBeforeDeadline_Reverts() public solvent {
        uint256 dealId = _opened();

        vm.warp(_deliveryDeadline(dealId) - 1);
        _expectRevertReason("too early");
        vm.prank(stranger);
        escrow.reclaim(dealId);
    }

    function test_Reclaim_AtExactDeadline_Succeeds() public solvent {
        uint256 dealId = _opened();

        vm.warp(_deliveryDeadline(dealId));
        vm.prank(stranger);
        escrow.reclaim(dealId);

        assertEq(uint8(_state(dealId)), uint8(GuardianEscrow.DealState.Settled));
        assertEq(escrow.balances(buyer), PRICE);
        assertEq(escrow.balances(seller), 0);
        assertEq(escrow.totalEscrowed(), 0);
    }

    // ------------------------------------------------------------ dispute deadline

    function test_ForceResolve_OneSecondBeforeDeadline_Reverts() public solvent {
        uint256 dealId = _disputed();

        vm.warp(_disputeDeadline(dealId) - 1);
        _expectRevertReason("too early");
        vm.prank(stranger);
        escrow.forceResolve(dealId);
    }

    function test_ForceResolve_AtExactDeadline_Succeeds() public solvent {
        uint256 dealId = _disputed();

        vm.warp(_disputeDeadline(dealId));
        vm.prank(stranger);
        escrow.forceResolve(dealId);

        assertEq(uint8(_state(dealId)), uint8(GuardianEscrow.DealState.Settled));
        // The timeout resolves at the Quarter tier — the inconclusive-evidence default.
        assertEq(escrow.balances(buyer), PRICE / 4);
        assertEq(escrow.balances(seller), PRICE - PRICE / 4);
        assertEq(escrow.totalEscrowed(), 0);
    }

    // ------------------------------------------------------------ degenerate window

    /// @dev No warp anywhere in this test: with `reviewWindow == 0` the boundary IS the
    ///      delivery instant, so a warp would move off the instant under test.
    function test_ZeroReviewWindow_ReleasableAtDelivery() public solvent {
        uint256 dealId = _delivered(ZERO_REVIEW);

        assertEq(_windowEnd(dealId), block.timestamp);
        vm.prank(stranger);
        escrow.release(dealId);

        assertEq(uint8(_state(dealId)), uint8(GuardianEscrow.DealState.Settled));
        assertEq(escrow.balances(seller), PRICE);
    }

    /// @dev Intended behaviour, not a defect: `reviewWindow` is deliberately unbounded,
    ///      and `0` collapses the complaint window to nothing. The risk is accepted and
    ///      guarded backend-side; this test exists so the collapse stays deliberate.
    function test_ZeroReviewWindow_NeverDisputable() public solvent {
        uint256 dealId = _delivered(ZERO_REVIEW);

        assertEq(_windowEnd(dealId), block.timestamp);
        _expectRevertReason("window closed");
        vm.prank(buyer);
        escrow.dispute(dealId);
    }

    // ------------------------------------------------------------- the ungated path

    /// @dev `accept` carries no timestamp check because accepting only ever produces the
    ///      outcome the lapse would have produced anyway — gating it would strand a
    ///      buyer who wanted to pay out early but arrived late.
    function test_Accept_NotWindowGated_SucceedsAfterWindowLapses() public solvent {
        uint256 dealId = _delivered(REVIEW);

        vm.warp(_windowEnd(dealId) + 30 days);
        vm.prank(buyer);
        escrow.accept(dealId);

        assertEq(uint8(_state(dealId)), uint8(GuardianEscrow.DealState.Settled));
        assertEq(escrow.balances(seller), PRICE);
        assertEq(escrow.totalEscrowed(), 0);
    }
}
