// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {EscrowTestBase} from "./helpers/EscrowTestBase.sol";
import {GuardianEscrow} from "../src/GuardianEscrow.sol";

/// @title StateMachineTest
/// @notice The rejection half of the deal state machine, swept exhaustively.
///
/// @dev A missing state guard is invisible on the happy path: the route that forgot to
///      check produces a *second* payout from a deal that was already paid, and every
///      test that only walks the intended sequence still passes. So the assertions here
///      are all negative, and they are deliberately redundant — the `Settled` row is
///      swept five times, once per settlement route, because each route reaches `Settled`
///      through different code and a route that never wrote the state would only ever
///      fail its own sweep.
contract StateMachineTest is EscrowTestBase {
    // ------------------------------------------------------------------- the sweep

    /// @dev Every call is made by an address that PASSES the role check, so the revert
    ///      that comes back is the state guard rather than `onlyRole` — a sweep run from
    ///      `stranger` would pass identically against a contract with no state guards at
    ///      all. The warp is there for the same reason: `reclaim` and `forceResolve` also
    ///      carry a deadline, and a sweep run at `t0` could be rejected by `"too early"`
    ///      while the state check was missing entirely.
    function _expectEveryRouteRejected(uint256 dealId) internal {
        vm.warp(block.timestamp + 3650 days);

        _expectRevertReason("not open");
        vm.prank(operator);
        escrow.markDelivered(dealId);

        _expectRevertReason("not open");
        vm.prank(stranger);
        escrow.reclaim(dealId);

        _expectRevertReason("not delivered");
        vm.prank(buyer);
        escrow.accept(dealId);

        _expectRevertReason("not delivered");
        vm.prank(stranger);
        escrow.release(dealId);

        _expectRevertReason("not delivered");
        vm.prank(buyer);
        escrow.dispute(dealId);

        _expectRevertReason("not disputed");
        vm.prank(guardian);
        escrow.resolve(dealId, GuardianEscrow.Tier.Half, VERDICT_HASH);

        _expectRevertReason("not disputed");
        vm.prank(stranger);
        escrow.forceResolve(dealId);
    }

    // ------------------------------------------------- Settled is terminal: 5 routes

    function test_SettledByAccept_RejectsAllOtherRoutes() public solvent {
        uint256 dealId = _delivered(REVIEW);
        vm.prank(buyer);
        escrow.accept(dealId);

        assertEq(uint8(_state(dealId)), uint8(GuardianEscrow.DealState.Settled));
        _expectEveryRouteRejected(dealId);

        // The credit from the single settlement, unchanged by seven attempts to re-run it.
        assertEq(escrow.balances(seller), PRICE);
        assertEq(escrow.totalEscrowed(), 0);
    }

    function test_SettledByRelease_RejectsAllOtherRoutes() public solvent {
        uint256 dealId = _delivered(REVIEW);
        vm.warp(_windowEnd(dealId));
        vm.prank(stranger);
        escrow.release(dealId);

        assertEq(uint8(_state(dealId)), uint8(GuardianEscrow.DealState.Settled));
        _expectEveryRouteRejected(dealId);

        assertEq(escrow.balances(seller), PRICE);
        assertEq(escrow.totalEscrowed(), 0);
    }

    function test_SettledByReclaim_RejectsAllOtherRoutes() public solvent {
        uint256 dealId = _opened();
        vm.warp(_deliveryDeadline(dealId));
        vm.prank(stranger);
        escrow.reclaim(dealId);

        assertEq(uint8(_state(dealId)), uint8(GuardianEscrow.DealState.Settled));
        _expectEveryRouteRejected(dealId);

        // A reclaimed deal was never delivered; a leaked `markDelivered` here would hand
        // the seller a claim on money already returned to the buyer.
        assertEq(escrow.balances(buyer), PRICE);
        assertEq(escrow.balances(seller), 0);
        assertEq(escrow.totalEscrowed(), 0);
    }

    function test_SettledByResolve_RejectsAllOtherRoutes() public solvent {
        uint256 dealId = _disputed();
        vm.prank(guardian);
        escrow.resolve(dealId, GuardianEscrow.Tier.Half, VERDICT_HASH);

        assertEq(uint8(_state(dealId)), uint8(GuardianEscrow.DealState.Settled));
        _expectEveryRouteRejected(dealId);

        // Includes a second `resolve` — this is where "verdicts are final, no appeals"
        // stops being policy and becomes a property of the state machine.
        assertEq(escrow.balances(buyer), PRICE / 2);
        assertEq(escrow.balances(seller), PRICE / 2);
        assertEq(escrow.totalEscrowed(), 0);
    }

    function test_SettledByForceResolve_RejectsAllOtherRoutes() public solvent {
        uint256 dealId = _disputed();
        vm.warp(_disputeDeadline(dealId));
        vm.prank(stranger);
        escrow.forceResolve(dealId);

        assertEq(uint8(_state(dealId)), uint8(GuardianEscrow.DealState.Settled));
        _expectEveryRouteRejected(dealId);

        // The force path is permissionless; if it also failed to close the deal, anyone
        // could call it repeatedly and mint a quarter refund each time.
        assertEq(escrow.balances(buyer), PRICE / 4);
        assertEq(escrow.balances(seller), PRICE - PRICE / 4);
        assertEq(escrow.totalEscrowed(), 0);
    }

    // ----------------------------------------------------------- wrong prior state

    function test_Open_RejectsAcceptReleaseDisputeResolve() public solvent {
        uint256 dealId = _opened();

        // Nothing has been delivered, so no payout route may open — including `accept`,
        // whose caller is the buyer and would otherwise be paying for work never done.
        _expectRevertReason("not delivered");
        vm.prank(buyer);
        escrow.accept(dealId);

        _expectRevertReason("not delivered");
        vm.prank(stranger);
        escrow.release(dealId);

        _expectRevertReason("not delivered");
        vm.prank(buyer);
        escrow.dispute(dealId);

        // Arbitration cannot be reached without a complaint first — Guardian may not
        // rule on a deal the buyer never contested.
        _expectRevertReason("not disputed");
        vm.prank(guardian);
        escrow.resolve(dealId, GuardianEscrow.Tier.Half, VERDICT_HASH);

        _expectRevertReason("not disputed");
        vm.prank(stranger);
        escrow.forceResolve(dealId);

        assertEq(uint8(_state(dealId)), uint8(GuardianEscrow.DealState.Open));
    }

    function test_Delivered_RejectsMarkDeliveredReclaimResolveForce() public solvent {
        uint256 dealId = _delivered(REVIEW);

        // A second `markDelivered` would reset `deliveredAt` and hand the operator a way
        // to extend the review window indefinitely.
        _expectRevertReason("not open");
        vm.prank(operator);
        escrow.markDelivered(dealId);

        // `reclaim` is the never-delivered refund; delivered work must go through the
        // review window, not back to the buyer wholesale.
        vm.warp(_deliveryDeadline(dealId));
        _expectRevertReason("not open");
        vm.prank(stranger);
        escrow.reclaim(dealId);

        _expectRevertReason("not disputed");
        vm.prank(guardian);
        escrow.resolve(dealId, GuardianEscrow.Tier.Half, VERDICT_HASH);

        _expectRevertReason("not disputed");
        vm.prank(stranger);
        escrow.forceResolve(dealId);

        assertEq(uint8(_state(dealId)), uint8(GuardianEscrow.DealState.Delivered));
    }

    function test_Disputed_RejectsAcceptReleaseDisputeMarkDelivered() public solvent {
        uint256 dealId = _disputed();

        _expectRevertReason("not open");
        vm.prank(operator);
        escrow.markDelivered(dealId);

        _expectRevertReason("not open");
        vm.prank(stranger);
        escrow.reclaim(dealId);

        // The whole point of `Disputed` is that the funds stop moving on their own: the
        // lapsing window must no longer release, and re-disputing must not restart the
        // 72h clock the force path depends on.
        _expectRevertReason("not delivered");
        vm.prank(buyer);
        escrow.accept(dealId);

        vm.warp(_windowEnd(dealId) + 1);
        _expectRevertReason("not delivered");
        vm.prank(stranger);
        escrow.release(dealId);

        _expectRevertReason("not delivered");
        vm.prank(buyer);
        escrow.dispute(dealId);

        assertEq(uint8(_state(dealId)), uint8(GuardianEscrow.DealState.Disputed));
    }

    // -------------------------------------------------------------- unknown deal ids

    /// @dev There is no existence check anywhere in the contract — an id that was never
    ///      issued reads back a zero-filled struct whose state is `None`, and the state
    ///      preconditions do the rejecting. That is a property of the storage layout
    ///      rather than a written guard, so it gets its own test or it breaks silently.
    function test_UnknownDealId_RejectsEveryEntryPoint() public solvent {
        assertEq(uint8(_state(999)), uint8(GuardianEscrow.DealState.None));
        _expectEveryRouteRejected(999);
    }

    /// @dev Id `0` is the one that would stop being safe: counters start at `1` precisely
    ///      so `0` is unambiguously "not found", and an id space starting at `0` would
    ///      turn every uninitialised lookup into a live deal.
    function test_DealIdZero_RejectsEveryEntryPoint() public solvent {
        assertEq(escrow.nextDealId(), 1);
        assertEq(uint8(_state(0)), uint8(GuardianEscrow.DealState.None));
        _expectEveryRouteRejected(0);
    }

    // --------------------------------------------------------------- interference

    /// @dev Anyone can push tokens at the escrow address; nothing can stop them. The
    ///      contract's invariant is `>=` for exactly this reason, and the `donated`
    ///      counter restores that slack on the suite's `==` form. What must NOT happen is
    ///      a settlement that reads the token balance and pays out more than the deal was
    ///      worth — so the outcome is asserted against the same numbers the deal would
    ///      have produced with no donation at all. Stranded tokens are harmless; a
    ///      settlement moved by them is not.
    function test_DirectTokenDonation_KeepsInvariantAndOutcomes() public solvent {
        uint256 gift = 500_000_000;
        usdc.mint(stranger, gift);
        vm.prank(stranger);
        usdc.transfer(address(escrow), gift);
        donated = gift;

        uint256 dealId = _disputed();
        assertEq(usdc.balanceOf(address(escrow)), gift + PRICE);

        vm.prank(guardian);
        escrow.resolve(dealId, GuardianEscrow.Tier.ThreeQuarter, VERDICT_HASH);

        assertEq(escrow.balances(buyer), 1_500_000);
        assertEq(escrow.balances(seller), 500_000);
        assertEq(escrow.totalEscrowed(), 0);

        // Withdrawal is the only path that moves tokens out, and it too must be sized by
        // the ledger rather than by the balance sitting in the contract.
        vm.prank(buyer);
        escrow.withdraw();
        assertEq(usdc.balanceOf(buyer), 1_500_000);
        assertEq(usdc.balanceOf(address(escrow)), gift + 500_000);
    }
}
