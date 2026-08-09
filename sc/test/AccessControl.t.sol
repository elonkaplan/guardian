// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {GuardianEscrow} from "../src/GuardianEscrow.sol";
import {EscrowTestBase} from "./helpers/EscrowTestBase.sol";

/// @title AccessControlTest
/// @notice Who may call what. The contract's central claim is that no single key can
///         both drive the lifecycle and decide an outcome, and that no key at all is
///         needed to push a deal past a deadline that has already passed. Both halves
///         are asserted here.
///
/// @dev Role failures are OZ v5's `AccessControlUnauthorizedAccount` custom error;
///      every other revert in the contract is a short string. Asserting the wrong kind
///      is the one mistake this file is most exposed to, so the two cases go through
///      two differently-named helpers and never through a bare `vm.expectRevert()`.
contract AccessControlTest is EscrowTestBase {
    // -------------------------------------------------- operator-gated: agents

    function test_RegisterAgent_RevertsForStranger() public solvent {
        _expectUnauthorized(stranger, escrow.OPERATOR_ROLE());
        vm.prank(stranger);
        escrow.registerAgent(seller, PRICE, DEF_HASH);
    }

    /// @dev Guardian holds the narrowest authority in the system: arbitration only. A
    ///      key that could also list agents could manufacture the deals it then rules on.
    function test_RegisterAgent_RevertsForGuardian() public solvent {
        _expectUnauthorized(guardian, escrow.OPERATOR_ROLE());
        vm.prank(guardian);
        escrow.registerAgent(seller, PRICE, DEF_HASH);
    }

    function test_UpdateAgent_RevertsForStranger() public solvent {
        uint256 agentId = _registerAgent(seller, PRICE);

        _expectUnauthorized(stranger, escrow.OPERATOR_ROLE());
        vm.prank(stranger);
        escrow.updateAgent(agentId, PRICE_2, DEF_HASH_2);
    }

    function test_SetAgentActive_RevertsForStranger() public solvent {
        uint256 agentId = _registerAgent(seller, PRICE);

        _expectUnauthorized(stranger, escrow.OPERATOR_ROLE());
        vm.prank(stranger);
        escrow.setAgentActive(agentId, false);
    }

    // --------------------------------------------------- operator-gated: deals

    function test_OpenDeal_RevertsForStranger() public solvent {
        uint256 agentId = _registerAgent(seller, PRICE);

        _expectUnauthorized(stranger, escrow.OPERATOR_ROLE());
        vm.prank(stranger);
        escrow.openDeal(agentId, buyer, REVIEW);
    }

    /// @dev The arbitrator must not be able to originate the disputes it settles.
    function test_OpenDeal_RevertsForGuardian() public solvent {
        uint256 agentId = _registerAgent(seller, PRICE);

        _expectUnauthorized(guardian, escrow.OPERATOR_ROLE());
        vm.prank(guardian);
        escrow.openDeal(agentId, buyer, REVIEW);
    }

    /// @dev Delivery starts the review window, so a stranger who could mark it could
    ///      run the clock out on a buyer who received nothing.
    function test_MarkDelivered_RevertsForStranger() public solvent {
        uint256 dealId = _opened();

        _expectUnauthorized(stranger, escrow.OPERATOR_ROLE());
        vm.prank(stranger);
        escrow.markDelivered(dealId);
    }

    // ------------------------------------------------------- guardian-gated

    /// @dev The backend drives every other transition in the system. If it could also
    ///      rule on a dispute it would be judge in its own cause — this single
    ///      rejection is the separation the product sells.
    function test_Resolve_RevertsForOperator() public solvent {
        uint256 dealId = _disputed();

        _expectUnauthorized(operator, escrow.GUARDIAN_ROLE());
        vm.prank(operator);
        escrow.resolve(dealId, GuardianEscrow.Tier.Full, VERDICT_HASH);
    }

    function test_Resolve_RevertsForStranger() public solvent {
        uint256 dealId = _disputed();

        _expectUnauthorized(stranger, escrow.GUARDIAN_ROLE());
        vm.prank(stranger);
        escrow.resolve(dealId, GuardianEscrow.Tier.Full, VERDICT_HASH);
    }

    /// @dev Admin can grant itself GUARDIAN_ROLE, but must not arbitrate without doing
    ///      so — role administration leaves a trace, a silent override would not.
    function test_Resolve_RevertsForAdmin() public solvent {
        uint256 dealId = _disputed();

        _expectUnauthorized(admin, escrow.GUARDIAN_ROLE());
        vm.prank(admin);
        escrow.resolve(dealId, GuardianEscrow.Tier.Full, VERDICT_HASH);
    }

    // ---------------------------------------------------------- buyer-gated

    /// @dev `"not buyer"` is a string, not a role error — `accept` carries no
    ///      `onlyRole`, it checks the deal's own buyer field.
    function test_Accept_RevertsForThirdParty() public solvent {
        uint256 dealId = _delivered(REVIEW);

        _expectRevertReason("not buyer");
        vm.prank(seller);
        escrow.accept(dealId);
    }

    /// @dev The seller is the party with the motive to fake a complaint away, or to
    ///      raise one; neither is theirs to do.
    function test_Dispute_RevertsForThirdParty() public solvent {
        uint256 dealId = _delivered(REVIEW);

        _expectRevertReason("not buyer");
        vm.prank(seller);
        escrow.dispute(dealId);
    }

    /// @dev Buyers pay by card and may hold no tokens or wallet at all, so the operator
    ///      relays their decision. Blocking it here would break the product's only
    ///      buyer-facing path.
    function test_Accept_AllowedForOperator() public solvent {
        uint256 dealId = _delivered(REVIEW);

        vm.prank(operator);
        escrow.accept(dealId);

        assertEq(uint8(_state(dealId)), uint8(GuardianEscrow.DealState.Settled));
        // Relaying the buyer's choice must not make the relayer the payee.
        assertEq(escrow.balances(seller), PRICE);
        assertEq(escrow.balances(operator), 0);
    }

    function test_Dispute_AllowedForOperator() public solvent {
        uint256 dealId = _delivered(REVIEW);

        vm.prank(operator);
        escrow.dispute(dealId);

        assertEq(uint8(_state(dealId)), uint8(GuardianEscrow.DealState.Disputed));
    }

    // -------------------------------------------- permissionless on purpose

    /// @dev A seller must never depend on the platform to get paid, so the caller here
    ///      is nobody: no role, no relationship to the deal.
    function test_Release_SucceedsForStranger() public solvent {
        uint256 dealId = _delivered(REVIEW);
        vm.warp(_windowEnd(dealId));
        (uint256 claimBefore, uint256 tokensBefore) = _strangerHoldings();

        vm.prank(stranger);
        escrow.release(dealId);

        assertEq(uint8(_state(dealId)), uint8(GuardianEscrow.DealState.Settled));
        assertEq(escrow.balances(seller), PRICE);
        _assertCallerGainedNothing(claimBefore, tokensBefore);
    }

    /// @dev A buyer's money must never be strandable by a platform that goes quiet.
    function test_Reclaim_SucceedsForStranger() public solvent {
        uint256 dealId = _opened();
        vm.warp(_deliveryDeadline(dealId));
        (uint256 claimBefore, uint256 tokensBefore) = _strangerHoldings();

        vm.prank(stranger);
        escrow.reclaim(dealId);

        assertEq(uint8(_state(dealId)), uint8(GuardianEscrow.DealState.Settled));
        assertEq(escrow.balances(buyer), PRICE);
        _assertCallerGainedNothing(claimBefore, tokensBefore);
    }

    /// @dev `Disputed` would otherwise be the one state with no exit if the Guardian
    ///      key were lost. The forced outcome is fixed at 25/75 — the caller picks
    ///      neither tier nor recipient.
    function test_ForceResolve_SucceedsForStranger() public solvent {
        uint256 dealId = _disputed();
        vm.warp(_disputeDeadline(dealId));
        (uint256 claimBefore, uint256 tokensBefore) = _strangerHoldings();

        vm.prank(stranger);
        escrow.forceResolve(dealId);

        assertEq(uint8(_state(dealId)), uint8(GuardianEscrow.DealState.Settled));
        assertEq(escrow.balances(buyer), PRICE / 4);
        assertEq(escrow.balances(seller), PRICE - PRICE / 4);
        _assertCallerGainedNothing(claimBefore, tokensBefore);
    }

    // -------------------------------------------------------- admin boundary

    /// @dev Admin's power is over the role table, not over deals. If it leaked into the
    ///      lifecycle the "deployer key is throwaway" claim in the deploy runbook would
    ///      be false.
    function test_Admin_CannotDriveLifecycle() public solvent {
        uint256 agentId = _registerAgent(seller, PRICE);
        uint256 dealId = _opened();
        bytes32 role = escrow.OPERATOR_ROLE();

        _expectUnauthorized(admin, role);
        vm.prank(admin);
        escrow.registerAgent(seller, PRICE, DEF_HASH);

        _expectUnauthorized(admin, role);
        vm.prank(admin);
        escrow.updateAgent(agentId, PRICE_2, DEF_HASH_2);

        _expectUnauthorized(admin, role);
        vm.prank(admin);
        escrow.setAgentActive(agentId, false);

        _expectUnauthorized(admin, role);
        vm.prank(admin);
        escrow.openDeal(agentId, buyer, REVIEW);

        _expectUnauthorized(admin, role);
        vm.prank(admin);
        escrow.markDelivered(dealId);
    }

    /// @dev Key rotation is the whole reason the admin role exists — a compromised
    ///      operator or guardian key has to be replaceable without redeploying.
    function test_Admin_CanGrantAndRevokeRoles() public solvent {
        address newOperator = makeAddr("newOperator");
        bytes32 role = escrow.OPERATOR_ROLE();
        _track(newOperator);

        vm.prank(admin);
        escrow.grantRole(role, newOperator);
        assertTrue(escrow.hasRole(role, newOperator));

        vm.prank(admin);
        escrow.revokeRole(role, newOperator);
        assertFalse(escrow.hasRole(role, newOperator));
    }

    // --------------------------------------------------------------- helpers

    function _strangerHoldings() private view returns (uint256 claim, uint256 tokens) {
        claim = escrow.balances(stranger);
        tokens = usdc.balanceOf(stranger);
    }

    /// @dev The line between escrow and custody: a permissionless caller settles a deal
    ///      into the outcome the rules already dictate and takes nothing for it. Both
    ///      ledgers are checked — a claim credited is as much a gain as a token moved.
    function _assertCallerGainedNothing(uint256 claimBefore, uint256 tokensBefore) private view {
        assertEq(escrow.balances(stranger), claimBefore, "permissionless caller gained a claim");
        assertEq(usdc.balanceOf(stranger), tokensBefore, "permissionless caller gained tokens");
    }
}
