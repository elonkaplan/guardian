// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {EscrowTestBase} from "./helpers/EscrowTestBase.sol";
import {GuardianEscrow} from "../src/GuardianEscrow.sol";

/// @title WithdrawalsTest
/// @notice `withdrawFor` is the only function in the contract that moves tokens out, and
///         it pays the NAMED ACCOUNT rather than the caller.
///
/// @dev The first two tests are the reason this file exists. The operator signs every
///      transaction on the user's behalf, so a `msg.sender`-only withdrawal would have
///      routed every payout to the operator — and a suite that only ever withdrew as the
///      owed account would have passed against exactly that bug. Both tests therefore
///      call as `stranger`: not the owed account, not the operator, nobody with a role.
contract WithdrawalsTest is EscrowTestBase {
    /// @dev The base has no fixture that reaches a *settled* deal, and every test here
    ///      needs one — a credited `balances` entry with the tokens still sitting in the
    ///      escrow. `release` is permissionless, so the caller is irrelevant.
    function _owedToSeller() private returns (uint256 amount) {
        uint256 dealId = _delivered(REVIEW);
        vm.warp(_windowEnd(dealId));
        escrow.release(dealId);
        amount = escrow.balances(seller);
    }

    // ------------------------------------------------------- pays the named account

    function test_WithdrawFor_ThirdPartyCaller_PaysNamedAccount() public solvent {
        uint256 owed = _owedToSeller();
        assertEq(usdc.balanceOf(seller), 0, "fixture must leave the payout unwithdrawn");

        vm.prank(stranger);
        escrow.withdrawFor(seller);

        assertEq(usdc.balanceOf(seller), owed, "tokens must land on the named account");
    }

    function test_WithdrawFor_ThirdPartyCaller_ReceivesNothing() public solvent {
        _owedToSeller();
        uint256 before = usdc.balanceOf(stranger);

        vm.prank(stranger);
        escrow.withdrawFor(seller);

        // The caller pays gas and gains nothing — what makes permissionless safe here.
        assertEq(usdc.balanceOf(stranger), before, "caller must not be paid");
    }

    // -------------------------------------------------------------- nothing to pay

    function test_WithdrawFor_ZeroBalance_Reverts() public solvent {
        _expectRevertReason("nothing to withdraw");
        vm.prank(stranger);
        escrow.withdrawFor(seller);
    }

    // ------------------------------------------------------------ the two entry points

    /// @dev `withdraw()`'s whole body is `withdrawFor(msg.sender)`, so equivalence is
    ///      asserted rather than assumed: run the identical starting state through both
    ///      entry points and compare the results.
    function test_Withdraw_DelegatesToWithdrawFor_SameEffect() public solvent {
        uint256 owed = _owedToSeller();
        uint256 snap = vm.snapshotState();

        vm.prank(seller);
        escrow.withdraw();
        uint256 paid = usdc.balanceOf(seller);
        uint256 escrowLeft = usdc.balanceOf(address(escrow));
        uint256 ledger = escrow.balances(seller);

        vm.revertToState(snap);
        assertEq(escrow.balances(seller), owed, "snapshot must restore the pre-withdrawal ledger");

        vm.prank(seller);
        escrow.withdrawFor(seller);

        assertEq(usdc.balanceOf(seller), paid, "recipient must be paid the same");
        assertEq(usdc.balanceOf(address(escrow)), escrowLeft, "escrow must be drained the same");
        assertEq(escrow.balances(seller), ledger, "ledger must be left the same");
    }

    // -------------------------------------------------------- effects before interaction

    function test_WithdrawFor_ZeroesBalanceBeforeTransfer() public solvent {
        _owedToSeller();

        vm.prank(stranger);
        escrow.withdrawFor(seller);

        assertEq(escrow.balances(seller), 0, "the claim must be consumed, not merely paid");

        // The zeroing is what makes the single outward transfer safe: a second call finds
        // nothing, so a re-entrant one would too.
        _expectRevertReason("nothing to withdraw");
        vm.prank(stranger);
        escrow.withdrawFor(seller);
    }

    // ---------------------------------------------------------------------- event

    function test_WithdrawFor_EmitsWithdrawnForAccount() public solvent {
        uint256 owed = _owedToSeller();

        // Indexed account and data both checked — off-chain accounting reads the payee
        // from this log, so naming the caller here would misattribute every payout.
        vm.expectEmit(true, true, true, true);
        emit GuardianEscrow.Withdrawn(seller, owed);

        vm.prank(stranger);
        escrow.withdrawFor(seller);
    }
}
