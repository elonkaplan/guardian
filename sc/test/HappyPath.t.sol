// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";

import {GuardianEscrow} from "../src/GuardianEscrow.sol";
import {EscrowTestBase} from "./helpers/EscrowTestBase.sol";

/// @title HappyPathTest
/// @notice The routes money is *supposed* to take: escrow in, settle, withdraw out.
///
/// @dev Two properties in here are asserted far more often than they look like they
///      need to be, and both are load-bearing:
///
///      1. **Settlement moves no tokens.** `balanceOf(escrow)` is captured before every
///         settlement and compared after. This is what removes reentrancy from four of
///         the five settlement paths — if a settlement ever started transferring, the
///         contract's own doc comment stops being true and the guardless design becomes
///         a vulnerability rather than a simplification.
///      2. **The deal snapshot survives the agent.** A running deal is asserted against
///         its pinned `defHash`/`defVersion`/`amount` after the agent underneath it has
///         been repriced and redefined. Reading these through the agent would let a
///         seller soften their declared capabilities after a bad delivery.
contract HappyPathTest is EscrowTestBase {
    // ----------------------------------------------------------------- openDeal

    function test_OpenDeal_EscrowsPriceFromOperator() public solvent {
        uint256 agentId = _registerAgent(seller, PRICE);

        _openDeal(agentId, buyer, REVIEW);

        // The operator funds the purchase, not the buyer — the buyer paid by card and
        // may hold no tokens at all.
        assertEq(usdc.balanceOf(operator), MINT - PRICE, "operator debited");
        assertEq(usdc.balanceOf(address(escrow)), PRICE, "escrow holds the money");
        assertEq(escrow.totalEscrowed(), PRICE, "and has a matching claim against it");
    }

    function test_OpenDeal_PinsSellerAmountAndDefinition() public solvent {
        uint256 agentId = _registerAgent(seller, PRICE);

        uint256 dealId = _openDeal(agentId, buyer, REVIEW);

        // Snapshots, not lookups: nothing done to the agent afterwards can reach them.
        assertEq(_sellerOf(dealId), seller, "payout address fixed at purchase");
        assertEq(_amountOf(dealId), PRICE, "price fixed at purchase");

        (bytes32 defHash, uint32 defVersion) = _defOf(dealId);
        assertEq(defHash, DEF_HASH, "the definition that actually ran");
        assertEq(defVersion, 1, "registerAgent starts versions at 1");

        assertEq(uint8(_state(dealId)), uint8(GuardianEscrow.DealState.Open));
    }

    function test_OpenDeal_EmitsDealOpened() public solvent {
        uint256 agentId = _registerAgent(seller, PRICE);

        // All four flags: the indexed ids and the whole data payload. The backend
        // reconstructs its deal row from this log alone, so a wrong `amount` or
        // `defVersion` here is a silent accounting divergence off-chain.
        vm.expectEmit(true, true, true, true);
        emit GuardianEscrow.DealOpened(1, agentId, buyer, PRICE, DEF_HASH, 1);

        _openDeal(agentId, buyer, REVIEW);
    }

    function test_OpenDeal_WithoutAllowance_RevertsInToken() public solvent {
        uint256 agentId = _registerAgent(seller, PRICE);

        vm.prank(operator);
        usdc.approve(address(escrow), 0);

        // SafeERC20 v5.1 bubbles the token's own revert data unwrapped, so the failure
        // an operator sees names the missing allowance rather than
        // `SafeERC20FailedOperation`. Asserting the wrapper would pass on a contract
        // that had silently swallowed the reason.
        vm.expectRevert(
            abi.encodeWithSelector(
                IERC20Errors.ERC20InsufficientAllowance.selector, address(escrow), 0, PRICE
            )
        );
        _openDeal(agentId, buyer, REVIEW);

        // The escrow and the deal ledger must be untouched — a half-opened deal would be
        // a claim on money that never arrived.
        assertEq(escrow.nextDealId(), 1, "no id consumed");
        assertEq(uint8(_state(1)), uint8(GuardianEscrow.DealState.None));
        assertEq(escrow.totalEscrowed(), 0);
    }

    function test_OpenDeal_InactiveAgent_Reverts() public solvent {
        uint256 agentId = _registerAgent(seller, PRICE);

        vm.prank(operator);
        escrow.setAgentActive(agentId, false);

        _expectRevertReason("agent inactive");
        _openDeal(agentId, buyer, REVIEW);
    }

    // ---------------------------------------------------------------- lifecycle

    function test_MarkDelivered_StartsReviewWindow() public solvent {
        uint256 dealId = _opened();

        // Off the genesis timestamp, so a `deliveredAt` left at 0 cannot pass by
        // coincidence.
        vm.warp(block.timestamp + 5 minutes);

        vm.expectEmit(true, true, true, true);
        emit GuardianEscrow.Delivered(dealId, uint64(block.timestamp));

        vm.prank(operator);
        escrow.markDelivered(dealId);

        assertEq(uint8(_state(dealId)), uint8(GuardianEscrow.DealState.Delivered));
        // `deliveredAt` is the anchor for both `release` and `dispute`; a wrong value
        // shifts the complaint window rather than failing loudly.
        assertEq(_deliveredAtOf(dealId), uint64(block.timestamp), "review window anchored here");
    }

    function test_Accept_ByBuyer_CreditsSellerFullAmount() public solvent {
        uint256 dealId = _delivered(REVIEW);

        vm.prank(buyer);
        escrow.accept(dealId);

        assertEq(escrow.balances(seller), PRICE, "seller owed the whole amount");
        assertEq(escrow.balances(buyer), 0, "accepting is not a partial refund");
        assertEq(escrow.totalEscrowed(), 0, "the claim left escrow");
        assertEq(uint8(_state(dealId)), uint8(GuardianEscrow.DealState.Settled));
    }

    function test_Accept_MovesNoTokens() public solvent {
        uint256 dealId = _delivered(REVIEW);
        uint256 held = usdc.balanceOf(address(escrow));

        vm.prank(buyer);
        escrow.accept(dealId);

        // Settlement converts a locked claim into a withdrawable one and nothing else.
        // The only outward transfer in the contract lives in `withdrawFor`.
        assertEq(usdc.balanceOf(address(escrow)), held, "no tokens moved on settlement");
        assertEq(usdc.balanceOf(seller), 0, "seller must still pull");
    }

    function test_Accept_EmitsReleased() public solvent {
        uint256 dealId = _delivered(REVIEW);

        // `accept` and `release` share `_payout`, so both emit Released — off-chain the
        // two full-payout routes are deliberately indistinguishable.
        vm.expectEmit(true, true, true, true);
        emit GuardianEscrow.Released(dealId, seller, PRICE);

        vm.prank(buyer);
        escrow.accept(dealId);
    }

    function test_Release_AfterWindow_CreditsSellerFullAmount() public solvent {
        uint256 dealId = _delivered(REVIEW);
        uint256 held = usdc.balanceOf(address(escrow));

        vm.warp(_windowEnd(dealId));

        // Called by `stranger`: a seller must never depend on the platform to get paid.
        vm.prank(stranger);
        escrow.release(dealId);

        assertEq(escrow.balances(seller), PRICE, "lapse pays exactly what accept pays");
        assertEq(escrow.balances(buyer), 0);
        assertEq(escrow.balances(stranger), 0, "the caller gains nothing");
        assertEq(escrow.totalEscrowed(), 0);
        assertEq(usdc.balanceOf(address(escrow)), held, "no tokens moved on settlement");
        assertEq(uint8(_state(dealId)), uint8(GuardianEscrow.DealState.Settled));
    }

    function test_Reclaim_AfterDeadline_CreditsBuyerFullAmount() public solvent {
        uint256 dealId = _opened();
        uint256 held = usdc.balanceOf(address(escrow));

        vm.warp(_deliveryDeadline(dealId));

        vm.prank(stranger);
        escrow.reclaim(dealId);

        assertEq(escrow.balances(buyer), PRICE, "nothing was delivered, so nothing is owed");
        assertEq(escrow.balances(seller), 0, "seller gets no share of an undelivered deal");
        assertEq(escrow.totalEscrowed(), 0);
        assertEq(usdc.balanceOf(address(escrow)), held, "no tokens moved on settlement");
        assertEq(uint8(_state(dealId)), uint8(GuardianEscrow.DealState.Settled));
    }

    function test_Reclaim_EmitsReclaimed() public solvent {
        uint256 dealId = _opened();
        vm.warp(_deliveryDeadline(dealId));

        vm.expectEmit(true, true, true, true);
        emit GuardianEscrow.Reclaimed(dealId, buyer, PRICE);

        vm.prank(stranger);
        escrow.reclaim(dealId);
    }

    // --------------------------------------------------------------- withdrawal

    function test_Withdraw_PaysCallerAndZeroesBalance() public solvent {
        uint256 dealId = _delivered(REVIEW);
        vm.prank(buyer);
        escrow.accept(dealId);

        vm.prank(seller);
        escrow.withdraw();

        // The one place in the contract where value actually leaves.
        assertEq(usdc.balanceOf(seller), PRICE, "tokens arrived");
        assertEq(usdc.balanceOf(address(escrow)), 0, "and left the escrow");
        assertEq(escrow.balances(seller), 0, "claim consumed");
    }

    function test_Withdraw_Twice_Reverts() public solvent {
        uint256 dealId = _delivered(REVIEW);
        vm.prank(buyer);
        escrow.accept(dealId);

        vm.prank(seller);
        escrow.withdraw();

        // Effects-before-interaction: the balance is zeroed before the transfer, so a
        // replay finds nothing. This is the check a reentrant token would have to beat.
        _expectRevertReason("nothing to withdraw");
        vm.prank(seller);
        escrow.withdraw();
    }

    function test_Withdraw_EmitsWithdrawn() public solvent {
        uint256 dealId = _delivered(REVIEW);
        vm.prank(buyer);
        escrow.accept(dealId);

        vm.expectEmit(true, true, true, true);
        emit GuardianEscrow.Withdrawn(seller, PRICE);

        vm.prank(seller);
        escrow.withdraw();
    }

    // ----------------------------------------------------------- agent lifecycle

    function test_Seller_BalancesAccumulateAcrossTwoAgents() public solvent {
        uint256 agentA = _registerAgent(seller, PRICE);
        uint256 agentB = _registerAgent(seller, PRICE_2);

        uint256 dealA = _openDeal(agentA, buyer, REVIEW);
        uint256 dealB = _openDeal(agentB, buyer, REVIEW);

        vm.prank(operator);
        escrow.markDelivered(dealA);
        vm.prank(operator);
        escrow.markDelivered(dealB);

        vm.prank(buyer);
        escrow.accept(dealA);
        vm.prank(buyer);
        escrow.accept(dealB);

        // `balances` is keyed by address, not by agent or deal — which is the whole
        // reason a seller with a catalogue withdraws once instead of once per agent.
        assertEq(escrow.balances(seller), PRICE + PRICE_2, "one accumulated balance");
        assertEq(escrow.totalEscrowed(), 0);

        vm.prank(seller);
        escrow.withdraw();
        assertEq(usdc.balanceOf(seller), PRICE + PRICE_2, "paid out in a single transfer");
    }

    function test_UpdateAgent_DoesNotAffectRunningDeal() public solvent {
        uint256 agentId = _registerAgent(seller, PRICE);
        uint256 dealId = _openDeal(agentId, buyer, REVIEW);

        vm.prank(operator);
        escrow.updateAgent(agentId, PRICE_2, DEF_HASH_2);

        // The agent moved on; the deal did not. Without this the seller could soften the
        // declared capabilities after a bad delivery and win the dispute retroactively.
        (bytes32 defHash, uint32 defVersion) = _defOf(dealId);
        assertEq(defHash, DEF_HASH, "pinned to the definition that ran");
        assertEq(defVersion, 1, "pinned to the version that ran");
        assertEq(_amountOf(dealId), PRICE, "repricing cannot reach an open deal");

        (, uint256 agentPrice, bytes32 agentDef, uint32 agentVersion,) = escrow.agents(agentId);
        assertEq(agentPrice, PRICE_2, "the agent itself did change");
        assertEq(agentDef, DEF_HASH_2);
        assertEq(agentVersion, 2, "every update bumps the version");

        // And the deal still settles at its own pinned amount.
        vm.prank(operator);
        escrow.markDelivered(dealId);
        vm.prank(buyer);
        escrow.accept(dealId);
        assertEq(escrow.balances(seller), PRICE, "settled at the purchased price");
    }

    function test_SetAgentActive_False_BlocksNewDealsOnly() public solvent {
        uint256 agentId = _registerAgent(seller, PRICE);
        uint256 running = _openDeal(agentId, buyer, REVIEW);

        vm.prank(operator);
        escrow.setAgentActive(agentId, false);

        _expectRevertReason("agent inactive");
        _openDeal(agentId, buyer, REVIEW);

        // Delisting is a shop-window control, not a kill switch — money already taken
        // must still complete its lifecycle or the flag becomes a way to strand funds.
        vm.prank(operator);
        escrow.markDelivered(running);
        vm.prank(buyer);
        escrow.accept(running);

        assertEq(escrow.balances(seller), PRICE, "the running deal settled normally");
        assertEq(escrow.totalEscrowed(), 0);
    }
}
