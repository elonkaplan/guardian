// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";

import {GuardianEscrow} from "../../src/GuardianEscrow.sol";
import {MockUSDC} from "./MockUSDC.sol";

/// @title EscrowTestBase
/// @notice The shared world every test file inherits: seven named actors, a funded and
///         approved operator, the fixture ladder, the solvency assertion, and the two
///         revert helpers.
///
/// @dev Three things in here are load-bearing, and each looks like it could be
///      simplified until you know what it prevents:
///
///      1. **`modifier solvent()` runs its assertion AFTER the body.** Every
///         state-changing test carries it. A trailing `_assertSolvent()` call on the
///         last line of each test would satisfy the requirement the day it was written
///         and stop satisfying it the first time someone forgets — and a forgotten call
///         is indistinguishable from a passing one.
///      2. **The solvency check is equality, not the contract's `>=`.** Inside the
///         suite every unit of the escrow's balance has a known origin, so equality is
///         checkable — and equality also catches funds that get *stranded* (debited
///         from `totalEscrowed` without being credited to anyone), which `>=` accepts
///         silently. The `donated` term preserves the contract's real `>=` semantics
///         for the one test that transfers tokens in directly.
///      3. **Fixtures use `vm.prank` per call, never `startPrank`.** A leaked active
///         prank would silently change the caller of the line under test — which, in a
///         suite whose whole point is who-may-call-what, is the worst possible bug to
///         have in the harness itself.
abstract contract EscrowTestBase is Test {
    // ------------------------------------------------------------------- world

    MockUSDC internal usdc;
    GuardianEscrow internal escrow;

    address internal admin;
    address internal operator;
    address internal guardian;
    address internal buyer;
    address internal seller;
    address internal seller2;
    address internal stranger;

    /// @dev Solidity cannot iterate a mapping, so `Σ balances` has to come from a list
    ///      the test side maintains — the same reason `totalEscrowed` exists in the
    ///      contract. An address credited but not tracked makes the sum too small and
    ///      breaks the equality loudly, which is the right direction for that mistake.
    address[] internal participants;

    /// @dev Tokens sent to the escrow with no matching claim. Non-zero in exactly one
    ///      test.
    uint256 internal donated;

    // --------------------------------------------------------------- constants

    uint256 internal constant PRICE = 2_000_000; // 2.000000 USDC, divisible by 4
    uint256 internal constant ODD_PRICE = 1_000_003; // forces truncation
    uint256 internal constant PRICE_2 = 3_000_000; // seller2's agent
    uint256 internal constant MINT = 1_000_000_000; // 1000 USDC to the operator

    uint32 internal constant REVIEW = 1 hours;
    uint32 internal constant ZERO_REVIEW = 0;

    bytes32 internal constant DEF_HASH = keccak256("agent-definition-v1");
    bytes32 internal constant DEF_HASH_2 = keccak256("agent-definition-v2");
    bytes32 internal constant VERDICT_HASH = keccak256("verdict");

    // ------------------------------------------------------------------- setup

    function setUp() public virtual {
        admin = makeAddr("admin");
        operator = makeAddr("operator");
        guardian = makeAddr("guardian");
        buyer = makeAddr("buyer");
        seller = makeAddr("seller");
        seller2 = makeAddr("seller2");
        stranger = makeAddr("stranger");

        usdc = new MockUSDC();
        escrow = new GuardianEscrow(IERC20(address(usdc)), admin, operator, guardian);

        // Without this approval every openDeal in the suite reverts inside the token —
        // the same failure that bites in production long after deployment looked fine.
        usdc.mint(operator, MINT);
        vm.prank(operator);
        usdc.approve(address(escrow), type(uint256).max);

        participants.push(admin);
        participants.push(operator);
        participants.push(guardian);
        participants.push(buyer);
        participants.push(seller);
        participants.push(seller2);
        participants.push(stranger);
    }

    // ------------------------------------------------------------------ solvency

    /// @dev Body first, assertion second. Carried by EVERY state-changing test.
    modifier solvent() {
        _;
        _assertSolvent();
    }

    function _assertSolvent() internal view {
        assertEq(
            usdc.balanceOf(address(escrow)),
            escrow.totalEscrowed() + _sumBalances() + donated,
            "solvency: escrow balance must equal escrowed + owed (+ donated)"
        );
    }

    function _sumBalances() internal view returns (uint256 total) {
        for (uint256 i; i < participants.length; ++i) {
            total += escrow.balances(participants[i]);
        }
    }

    /// @notice Count `a`'s balance toward the solvency sum. Idempotent.
    function _track(address a) internal {
        for (uint256 i; i < participants.length; ++i) {
            if (participants[i] == a) return;
        }
        participants.push(a);
    }

    // ------------------------------------------------------------------ fixtures

    function _registerAgent(address owner_, uint256 price) internal returns (uint256 agentId) {
        vm.prank(operator);
        agentId = escrow.registerAgent(owner_, price, DEF_HASH);
    }

    function _openDeal(uint256 agentId, address buyer_, uint32 window)
        internal
        returns (uint256 dealId)
    {
        vm.prank(operator);
        dealId = escrow.openDeal(agentId, buyer_, window);
    }

    /// @notice Agent owned by `seller` at PRICE → deal for `buyer` → markDelivered.
    function _delivered(uint32 window) internal returns (uint256 dealId) {
        dealId = _deliveredAt(PRICE, window);
    }

    function _deliveredAt(uint256 price, uint32 window) internal returns (uint256 dealId) {
        uint256 agentId = _registerAgent(seller, price);
        dealId = _openDeal(agentId, buyer, window);
        vm.prank(operator);
        escrow.markDelivered(dealId);
    }

    /// @notice As `_delivered(REVIEW)`, then the buyer disputes inside the window.
    function _disputed() internal returns (uint256 dealId) {
        dealId = _disputedAt(PRICE);
    }

    function _disputedAt(uint256 price) internal returns (uint256 dealId) {
        dealId = _deliveredAt(price, REVIEW);
        vm.prank(buyer);
        escrow.dispute(dealId);
    }

    /// @notice An `Open` deal that was never delivered.
    function _opened() internal returns (uint256 dealId) {
        uint256 agentId = _registerAgent(seller, PRICE);
        dealId = _openDeal(agentId, buyer, REVIEW);
    }

    // ------------------------------------------------------------ deal accessors

    /// @dev `deals(id)` returns an 11-element tuple; these keep that destructuring in
    ///      one place instead of six.

    function _state(uint256 dealId) internal view returns (GuardianEscrow.DealState state) {
        (,,,,,,,,,, state) = escrow.deals(dealId);
    }

    function _amountOf(uint256 dealId) internal view returns (uint256 amount) {
        (,,, amount,,,,,,,) = escrow.deals(dealId);
    }

    function _sellerOf(uint256 dealId) internal view returns (address seller_) {
        (,, seller_,,,,,,,,) = escrow.deals(dealId);
    }

    function _defOf(uint256 dealId) internal view returns (bytes32 defHash, uint32 defVersion) {
        (,,,, defHash, defVersion,,,,,) = escrow.deals(dealId);
    }

    function _openedAtOf(uint256 dealId) internal view returns (uint64 openedAt) {
        (,,,,,, openedAt,,,,) = escrow.deals(dealId);
    }

    function _deliveredAtOf(uint256 dealId) internal view returns (uint64 deliveredAt) {
        (,,,,,,, deliveredAt,,,) = escrow.deals(dealId);
    }

    function _disputedAtOf(uint256 dealId) internal view returns (uint64 disputedAt) {
        (,,,,,,,, disputedAt,,) = escrow.deals(dealId);
    }

    function _reviewWindowOf(uint256 dealId) internal view returns (uint32 reviewWindow) {
        (,,,,,,,,, reviewWindow,) = escrow.deals(dealId);
    }

    /// @notice The instant the review window closes — `release` opens here, `dispute` shuts.
    function _windowEnd(uint256 dealId) internal view returns (uint256) {
        return uint256(_deliveredAtOf(dealId)) + uint256(_reviewWindowOf(dealId));
    }

    function _deliveryDeadline(uint256 dealId) internal view returns (uint256) {
        return uint256(_openedAtOf(dealId)) + escrow.DELIVERY_DEADLINE();
    }

    function _disputeDeadline(uint256 dealId) internal view returns (uint256) {
        return uint256(_disputedAtOf(dealId)) + escrow.DISPUTE_DEADLINE();
    }

    // -------------------------------------------------------------- revert helpers

    /// @notice For the contract's own short `require` strings.
    function _expectRevertReason(string memory reason) internal {
        vm.expectRevert(bytes(reason));
    }

    /// @notice For OZ v5 `onlyRole` failures — a custom error, NOT a string. Asserting a
    ///         string here would simply not match, and a bare `vm.expectRevert()` would
    ///         pass for the wrong reason.
    function _expectUnauthorized(address caller, bytes32 role) internal {
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, caller, role
            )
        );
    }
}
