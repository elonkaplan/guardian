// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {EscrowTestBase} from "./helpers/EscrowTestBase.sol";
import {GuardianEscrow} from "../src/GuardianEscrow.sol";

/// @title TierSplitsTest
/// @notice The five verdicts and the money each one produces.
///
/// @dev The five percentage tests are written longhand — five functions, two decimal
///      literals each — on purpose. A loop over `[0, 2500, 5000, 7500, 10000]` would be
///      the same table as `_refundBps`, restated; it would agree with an off-by-one
///      instead of catching it. `500_000` next to `PRICE = 2_000_000` is checkable by
///      eye, and that is the whole assertion. Only the sum test loops, because it
///      asserts an identity rather than the percentages.
contract TierSplitsTest is EscrowTestBase {
    // ------------------------------------------------------ the tier table, longhand

    function test_Resolve_NoRefund_PaysSellerEverything() public solvent {
        uint256 dealId = _disputed();

        vm.prank(guardian);
        escrow.resolve(dealId, GuardianEscrow.Tier.NoRefund, VERDICT_HASH);

        assertEq(escrow.balances(buyer), 0, "buyer: 0% of 2 USDC");
        assertEq(escrow.balances(seller), 2_000_000, "seller: 100% of 2 USDC");
    }

    function test_Resolve_Quarter_Splits500kTo1500k() public solvent {
        uint256 dealId = _disputed();

        vm.prank(guardian);
        escrow.resolve(dealId, GuardianEscrow.Tier.Quarter, VERDICT_HASH);

        assertEq(escrow.balances(buyer), 500_000, "buyer: 25% of 2 USDC");
        assertEq(escrow.balances(seller), 1_500_000, "seller: 75% of 2 USDC");
    }

    function test_Resolve_Half_SplitsEvenly() public solvent {
        uint256 dealId = _disputed();

        vm.prank(guardian);
        escrow.resolve(dealId, GuardianEscrow.Tier.Half, VERDICT_HASH);

        assertEq(escrow.balances(buyer), 1_000_000, "buyer: 50% of 2 USDC");
        assertEq(escrow.balances(seller), 1_000_000, "seller: 50% of 2 USDC");
    }

    function test_Resolve_ThreeQuarter_Splits1500kTo500k() public solvent {
        uint256 dealId = _disputed();

        vm.prank(guardian);
        escrow.resolve(dealId, GuardianEscrow.Tier.ThreeQuarter, VERDICT_HASH);

        assertEq(escrow.balances(buyer), 1_500_000, "buyer: 75% of 2 USDC");
        assertEq(escrow.balances(seller), 500_000, "seller: 25% of 2 USDC");
    }

    function test_Resolve_Full_PaysBuyerEverything() public solvent {
        uint256 dealId = _disputed();

        vm.prank(guardian);
        escrow.resolve(dealId, GuardianEscrow.Tier.Full, VERDICT_HASH);

        assertEq(escrow.balances(buyer), 2_000_000, "buyer: 100% of 2 USDC");
        assertEq(escrow.balances(seller), 0, "seller: 0% of 2 USDC");
    }

    // ------------------------------------------------------------- the sum identity

    /// @dev The one test allowed to loop: it names no percentage, so there is no table
    ///      to duplicate. Deltas rather than absolutes because balances accumulate
    ///      across the five deals — an absolute read would drift by design.
    function test_Resolve_EveryTier_SharesSumToAmount() public solvent {
        for (uint8 t; t <= uint8(GuardianEscrow.Tier.Full); ++t) {
            uint256 dealId = _disputed();
            uint256 amount = _amountOf(dealId);
            uint256 buyerBefore = escrow.balances(buyer);
            uint256 sellerBefore = escrow.balances(seller);

            vm.prank(guardian);
            escrow.resolve(dealId, GuardianEscrow.Tier(t), VERDICT_HASH);

            uint256 toBuyer = escrow.balances(buyer) - buyerBefore;
            uint256 toSeller = escrow.balances(seller) - sellerBefore;
            assertEq(toBuyer + toSeller, amount, "tier creates or destroys value");
        }
    }

    // ---------------------------------------------------------------- truncation

    /// @dev 1_000_003 / 4 = 250_000.75. The quarter cent cannot exist, and the contract
    ///      derives the seller's share by subtraction, so it lands there.

    function test_Resolve_OddAmount_Quarter_RemainderToSeller() public solvent {
        uint256 dealId = _disputedAt(ODD_PRICE);

        vm.prank(guardian);
        escrow.resolve(dealId, GuardianEscrow.Tier.Quarter, VERDICT_HASH);

        assertEq(escrow.balances(buyer), 250_000, "buyer: 250_000.75 truncated down");
        assertEq(escrow.balances(seller), 750_003, "seller: keeps the remainder");
    }

    function test_Resolve_OddAmount_Half_RemainderToSeller() public solvent {
        uint256 dealId = _disputedAt(ODD_PRICE);

        vm.prank(guardian);
        escrow.resolve(dealId, GuardianEscrow.Tier.Half, VERDICT_HASH);

        assertEq(escrow.balances(buyer), 500_001, "buyer: 500_001.5 truncated down");
        assertEq(escrow.balances(seller), 500_002, "seller: keeps the remainder");
    }

    function test_Resolve_OddAmount_ThreeQuarter_RemainderToSeller() public solvent {
        uint256 dealId = _disputedAt(ODD_PRICE);

        vm.prank(guardian);
        escrow.resolve(dealId, GuardianEscrow.Tier.ThreeQuarter, VERDICT_HASH);

        assertEq(escrow.balances(buyer), 750_002, "buyer: 750_002.25 truncated down");
        assertEq(escrow.balances(seller), 250_001, "seller: keeps the remainder");
    }

    // ------------------------------------------------------------- the zero shares

    /// @dev A zero balance alone would also be produced by a contract that credited an
    ///      empty entry. The revert is what proves `if (toBuyer > 0)` created no claim.
    function test_Resolve_NoRefund_BuyerHasNoClaim() public solvent {
        uint256 dealId = _disputed();

        vm.prank(guardian);
        escrow.resolve(dealId, GuardianEscrow.Tier.NoRefund, VERDICT_HASH);

        assertEq(escrow.balances(buyer), 0, "buyer is owed nothing");
        _expectRevertReason("nothing to withdraw");
        escrow.withdrawFor(buyer);
    }

    function test_Resolve_Full_SellerHasNoClaim() public solvent {
        uint256 dealId = _disputed();

        vm.prank(guardian);
        escrow.resolve(dealId, GuardianEscrow.Tier.Full, VERDICT_HASH);

        assertEq(escrow.balances(seller), 0, "seller is owed nothing");
        _expectRevertReason("nothing to withdraw");
        escrow.withdrawFor(seller);
    }

    // ------------------------------------------------------------------- the log

    /// @dev All four flags: `Resolved` indexes only `dealId`, so checking topics alone
    ///      would assert nothing about the two amounts the whole file is about.
    function test_Resolve_EmitsResolvedWithBothShares() public solvent {
        uint256 dealId = _disputed();

        vm.expectEmit(true, true, true, true);
        emit GuardianEscrow.Resolved(
            dealId, GuardianEscrow.Tier.ThreeQuarter, 1_500_000, 500_000, VERDICT_HASH
        );

        vm.prank(guardian);
        escrow.resolve(dealId, GuardianEscrow.Tier.ThreeQuarter, VERDICT_HASH);
    }

    // ---------------------------------------------------------------- no transfer

    /// @dev Settlement converts a locked claim into a withdrawable one and nothing else.
    ///      This is what removes reentrancy from the settlement paths.
    function test_Resolve_MovesNoTokens() public solvent {
        uint256 dealId = _disputed();
        uint256 held = usdc.balanceOf(address(escrow));

        vm.prank(guardian);
        escrow.resolve(dealId, GuardianEscrow.Tier.Half, VERDICT_HASH);

        assertEq(usdc.balanceOf(address(escrow)), held, "resolve must not transfer");
    }

    // -------------------------------------------------------------- forceResolve

    /// @dev The timeout default is the inconclusive-evidence tier, not a fresh number.
    function test_ForceResolve_AfterDeadline_AppliesQuarterTier() public solvent {
        uint256 dealId = _disputed();
        vm.warp(_disputeDeadline(dealId));

        vm.prank(stranger);
        escrow.forceResolve(dealId);

        assertEq(escrow.balances(buyer), 500_000, "buyer: 25% of 2 USDC");
        assertEq(escrow.balances(seller), 1_500_000, "seller: 75% of 2 USDC");
    }

    /// @dev The zero hash is the only on-chain trace distinguishing a timeout from a
    ///      verdict Guardian actually signed.
    function test_ForceResolve_EmitsZeroVerdictHash() public solvent {
        uint256 dealId = _disputed();
        vm.warp(_disputeDeadline(dealId));

        vm.expectEmit(true, true, true, true);
        emit GuardianEscrow.Resolved(
            dealId, GuardianEscrow.Tier.Quarter, 500_000, 1_500_000, bytes32(0)
        );

        vm.prank(stranger);
        escrow.forceResolve(dealId);
    }
}
