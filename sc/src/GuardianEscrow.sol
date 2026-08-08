// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

/// @title GuardianEscrow
/// @notice Holds a buyer's payment for an agent service until the buyer accepts, the
///         review window expires, or Guardian rules on a dispute — then splits the
///         money accordingly.
///
/// @dev The property this contract sells is that **the platform cannot override the
///      outcome**. Three structural choices carry that weight, and each looks like it
///      could be simplified until you know what it prevents:
///
///      1. **Pull payments.** Settlement credits `balances` and moves no tokens. The
///         only `safeTransfer` out lives in `withdrawFor`. This is why no settlement
///         path needs a reentrancy guard — not an oversight.
///      2. **Guardian picks a tier, never an amount.** `resolve` takes a `Tier` enum
///         and the contract computes the split between two addresses fixed at
///         purchase, so the worst case from a fully compromised Guardian key is a
///         wrong verdict rather than a drained contract.
///      3. **`release`, `reclaim`, and `forceResolve` are permissionless.** Each can
///         only push a deal past a deadline that has already passed, into the outcome
///         the rules already dictate. Restricting them would let the platform strand
///         funds by going quiet — the line between escrow and custody.
///
///      Deliberately absent: upgradeability, pausing, fees, reputation, appeals, and
///      any bounds check on `reviewWindow`. All are recorded decisions.
contract GuardianEscrow is AccessControl {
    using SafeERC20 for IERC20;

    // ------------------------------------------------------------------- types

    /// @notice Where a deal is in its life.
    /// @dev `None` is the zero value so a lookup on an unknown id returns a
    ///      zero-filled struct that reads as "does not exist" — every entry point's
    ///      state precondition then rejects it with no separate existence check.
    ///      `Settled` is terminal and is never left, which is what makes "verdicts are
    ///      final, no appeals" true by construction rather than by policy.
    enum DealState {
        None,
        Open,
        Delivered,
        Disputed,
        Settled
    }

    /// @notice The five permitted verdicts — 0 / 25 / 50 / 75 / 100 percent refund.
    /// @dev `Quarter` doubles as the inconclusive-evidence default and therefore as
    ///      the `forceResolve` outcome.
    enum Tier {
        NoRefund,
        Quarter,
        Half,
        ThreeQuarter,
        Full
    }

    struct Agent {
        address owner; // payout address, immutable for the agent's life
        uint256 price; // base units of the settlement token, never dollars
        bytes32 defHash; // keccak256 of the canonical agent definition
        uint32 version; // starts at 1, +1 on every updateAgent
        bool active; // gates NEW deals only; running deals are unaffected
    }

    struct Deal {
        uint256 agentId;
        address buyer; // refund recipient
        address seller; // SNAPSHOT of agent.owner at purchase — never a lookup
        uint256 amount; // SNAPSHOT of agent.price at purchase
        bytes32 defHash; // PINNED — the definition that actually ran
        uint32 defVersion; // PINNED
        uint64 openedAt; // starts DELIVERY_DEADLINE
        uint64 deliveredAt; // 0 until delivered; starts reviewWindow
        uint64 disputedAt; // 0 until disputed; starts DISPUTE_DEADLINE
        uint32 reviewWindow; // per-deal seconds; deliberately NOT a constant
        DealState state;
    }

    // --------------------------------------------------------------- constants

    /// @notice The backend. Drives the lifecycle; can never move escrowed funds.
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");

    /// @notice The audit agent's key. Can only split an already-disputed deal between
    ///         two addresses fixed at purchase, by choosing one of five tiers.
    bytes32 public constant GUARDIAN_ROLE = keccak256("GUARDIAN_ROLE");

    /// @notice After this, an undelivered deal is reclaimable by anyone.
    uint32 public constant DELIVERY_DEADLINE = 24 hours;

    /// @notice After this, an unresolved dispute is force-settleable by anyone.
    uint32 public constant DISPUTE_DEADLINE = 72 hours;

    // ----------------------------------------------------------------- storage

    /// @notice The settlement token. Fixed at deployment — cannot be swapped.
    IERC20 public immutable token;

    mapping(uint256 => Agent) public agents;
    mapping(uint256 => Deal) public deals;

    /// @notice The pull-payment ledger. Withdrawable funds per address.
    /// @dev Keyed by address rather than by agent or deal, so a seller owning several
    ///      agents accumulates into one balance and an address that both buys and
    ///      sells uses the same entry.
    mapping(address => uint256) public balances;

    /// @notice Sum of all live (unsettled) deal amounts.
    /// @dev Exists so solvency is checkable on-chain — Solidity cannot iterate a
    ///      mapping, so without a running counter there is no way to sum live deals.
    ///      The invariant, which must hold at every moment:
    ///
    ///          token.balanceOf(address(this)) >= totalEscrowed + Σ balances
    ///
    ///      `>=` not `==`: anyone can send tokens directly to this address, raising
    ///      `balanceOf` with no matching claim. Such tokens are stranded, which is
    ///      harmless. A balance *below* the right-hand side is a genuine bug.
    uint256 public totalEscrowed;

    /// @dev Counters start at 1 so that id `0` unambiguously means "not found".
    uint256 public nextAgentId = 1;
    uint256 public nextDealId = 1;

    // ------------------------------------------------------------------ events

    event AgentRegistered(
        uint256 indexed agentId, address indexed owner, uint256 price, bytes32 defHash
    );
    event AgentUpdated(uint256 indexed agentId, uint32 version, uint256 price, bytes32 defHash);
    event DealOpened(
        uint256 indexed dealId,
        uint256 indexed agentId,
        address indexed buyer,
        uint256 amount,
        bytes32 defHash,
        uint32 defVersion
    );
    event Delivered(uint256 indexed dealId, uint64 at);
    /// @notice Emitted by both `accept` and `release` — the two full-payout paths.
    event Released(uint256 indexed dealId, address indexed seller, uint256 amount);
    event Disputed(uint256 indexed dealId, uint64 at);
    /// @notice Emitted by both `resolve` and `forceResolve`. `verdictHash` is zero for
    ///         the force path — that is how the two are told apart off-chain.
    event Resolved(
        uint256 indexed dealId, Tier tier, uint256 toBuyer, uint256 toSeller, bytes32 verdictHash
    );
    event Reclaimed(uint256 indexed dealId, address indexed buyer, uint256 amount);
    event Withdrawn(address indexed account, uint256 amount);

    // ------------------------------------------------------------- constructor

    /// @param _token The settlement token. Immutable thereafter.
    /// @param admin Can grant and revoke the two roles below, and nothing else — no
    ///              admin function reads or writes a deal.
    /// @param operator The backend.
    /// @param guardian The audit agent's key.
    constructor(IERC20 _token, address admin, address operator, address guardian) {
        token = _token;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(OPERATOR_ROLE, operator);
        _grantRole(GUARDIAN_ROLE, guardian);
    }

    // ------------------------------------------------------------------ agents

    /// @notice Register a purchasable agent.
    /// @dev Operator-registered rather than seller-self-registered so sellers need no
    ///      wallet interaction or gas.
    function registerAgent(address owner, uint256 price, bytes32 defHash)
        external
        onlyRole(OPERATOR_ROLE)
        returns (uint256 agentId)
    {
        require(owner != address(0), "bad owner");
        agentId = nextAgentId++;
        agents[agentId] = Agent(owner, price, defHash, 1, true);
        emit AgentRegistered(agentId, owner, price, defHash);
    }

    /// @notice Replace price and definition hash; increments `version`.
    /// @dev Deals already open are unaffected — they carry their own pinned hash and
    ///      version, which is what stops a seller softening their declared
    ///      capabilities after a bad delivery and winning the dispute retroactively.
    function updateAgent(uint256 agentId, uint256 price, bytes32 defHash)
        external
        onlyRole(OPERATOR_ROLE)
    {
        Agent storage a = agents[agentId];
        require(a.owner != address(0), "no agent");
        a.price = price;
        a.defHash = defHash;
        a.version += 1;
        emit AgentUpdated(agentId, a.version, price, defHash);
    }

    /// @notice Toggle whether NEW deals may be opened. Running deals continue.
    /// @dev Emits no event by design — the frontend learns about delisting from the
    ///      API, not from a log.
    function setAgentActive(uint256 agentId, bool active) external onlyRole(OPERATOR_ROLE) {
        require(agents[agentId].owner != address(0), "no agent");
        agents[agentId].active = active;
    }

    // ------------------------------------------------------------------- deals

    /// @notice Capture `agent.price` into escrow and open a deal.
    /// @dev Tokens come **from the operator**, not the buyer — the buyer paid by card
    ///      and may hold no tokens at all. The operator must have approved this
    ///      contract first; without an allowance the first purchase reverts long after
    ///      deployment looked successful.
    ///
    ///      `reviewWindow` is deliberately not bounds-checked. Passing `0` closes the
    ///      complaint window instantly — an accepted MVP risk, guarded backend-side.
    function openDeal(uint256 agentId, address buyer, uint32 reviewWindow)
        external
        onlyRole(OPERATOR_ROLE)
        returns (uint256 dealId)
    {
        Agent memory a = agents[agentId];
        require(a.active, "agent inactive");
        require(buyer != address(0), "bad buyer");

        // The tokens now live at address(this) — this is the escrow. Our storage holds
        // no money; it holds claims on money.
        token.safeTransferFrom(msg.sender, address(this), a.price);
        totalEscrowed += a.price;

        dealId = nextDealId++;
        deals[dealId] = Deal({
            agentId: agentId,
            buyer: buyer,
            seller: a.owner,
            amount: a.price,
            defHash: a.defHash,
            defVersion: a.version,
            openedAt: uint64(block.timestamp),
            deliveredAt: 0,
            disputedAt: 0,
            reviewWindow: reviewWindow,
            state: DealState.Open
        });

        emit DealOpened(dealId, agentId, buyer, a.price, a.defHash, a.version);
    }

    /// @notice Record delivery and start the review window.
    function markDelivered(uint256 dealId) external onlyRole(OPERATOR_ROLE) {
        Deal storage d = deals[dealId];
        require(d.state == DealState.Open, "not open");
        d.state = DealState.Delivered;
        d.deliveredAt = uint64(block.timestamp);
        emit Delivered(dealId, d.deliveredAt);
    }

    /// @notice The buyer accepting early — seller is credited the full amount.
    /// @dev Deliberately not window-gated, unlike `dispute`: accepting only ever does
    ///      what the lapse would have done anyway.
    function accept(uint256 dealId) external {
        Deal storage d = deals[dealId];
        require(d.state == DealState.Delivered, "not delivered");
        require(msg.sender == d.buyer || hasRole(OPERATOR_ROLE, msg.sender), "not buyer");
        _payout(dealId, d);
    }

    /// @notice Settle a delivered deal whose review window has lapsed.
    /// @dev **Permissionless on purpose.** A seller must never depend on the platform
    ///      to get paid. The caller chooses nothing and gains nothing.
    function release(uint256 dealId) external {
        Deal storage d = deals[dealId];
        require(d.state == DealState.Delivered, "not delivered");
        require(block.timestamp >= d.deliveredAt + d.reviewWindow, "window open");
        _payout(dealId, d);
    }

    /// @notice Return the full amount to the buyer when nothing was ever delivered.
    /// @dev **Permissionless on purpose.** A buyer's money can never be stranded by a
    ///      silent platform.
    function reclaim(uint256 dealId) external {
        Deal storage d = deals[dealId];
        require(d.state == DealState.Open, "not open");
        require(block.timestamp >= d.openedAt + DELIVERY_DEADLINE, "too early");
        d.state = DealState.Settled;
        totalEscrowed -= d.amount;
        balances[d.buyer] += d.amount;
        emit Reclaimed(dealId, d.buyer, d.amount);
    }

    /// @dev Shared by `accept` and `release` so the two full-payout paths cannot
    ///      drift. Moves no tokens — settlement is pure bookkeeping, converting a
    ///      locked claim into a withdrawable one.
    function _payout(uint256 dealId, Deal storage d) private {
        d.state = DealState.Settled;
        totalEscrowed -= d.amount; // leaves escrow, becomes a claim
        balances[d.seller] += d.amount;
        emit Released(dealId, d.seller, d.amount);
    }

    // ----------------------------------------------------------------- dispute

    /// @notice Freeze the deal pending arbitration.
    /// @dev **No value moves** — the funds are already escrowed; this only stops the
    ///      window from lapsing into a release. The strict `<` is complementary to
    ///      `release`'s `>=` on the same expression, so there is no instant where both
    ///      complaint and release are available, and none where neither is.
    function dispute(uint256 dealId) external {
        Deal storage d = deals[dealId];
        require(d.state == DealState.Delivered, "not delivered");
        require(msg.sender == d.buyer || hasRole(OPERATOR_ROLE, msg.sender), "not buyer");
        require(block.timestamp < d.deliveredAt + d.reviewWindow, "window closed");
        d.state = DealState.Disputed;
        d.disputedAt = uint64(block.timestamp);
        emit Disputed(dealId, d.disputedAt);
    }

    /// @notice Rule on a disputed deal by selecting one of the five tiers.
    /// @param verdictHash Anchors the off-chain verdict text on-chain. Tamper-evidence
    ///                    only; the contract never reads it.
    /// @dev Takes a `Tier`, never an amount and never an address. That is what caps a
    ///      fully compromised Guardian key at "wrong verdict".
    function resolve(uint256 dealId, Tier tier, bytes32 verdictHash)
        external
        onlyRole(GUARDIAN_ROLE)
    {
        _settleDispute(dealId, tier, verdictHash);
    }

    /// @notice Force-settle a dispute Guardian never ruled on.
    /// @dev **Permissionless on purpose.** Without this, a lost Guardian key would
    ///      freeze disputed funds forever — `Disputed` was the one state in the
    ///      original design with no exit. The 25% default is not arbitrary: the
    ///      product's inconclusive-evidence rule already resolves there, and a timeout
    ///      is the ultimate unproven case.
    function forceResolve(uint256 dealId) external {
        Deal storage d = deals[dealId];
        require(d.state == DealState.Disputed, "not disputed");
        require(block.timestamp >= d.disputedAt + DISPUTE_DEADLINE, "too early");
        _settleDispute(dealId, Tier.Quarter, bytes32(0));
    }

    /// @dev Re-asserts the required state even though both callers already checked it.
    ///      One redundant SLOAD buys the guarantee that neither public entry point can
    ///      be edited into a hole.
    function _settleDispute(uint256 dealId, Tier tier, bytes32 verdictHash) private {
        Deal storage d = deals[dealId];
        require(d.state == DealState.Disputed, "not disputed");

        uint256 toBuyer = (d.amount * _refundBps(tier)) / 10_000;
        // Derived by subtraction, never computed independently — this is what makes
        // toBuyer + toSeller == amount structurally true for every tier and every
        // amount. Any truncation lands on the seller's side; no dust is created.
        uint256 toSeller = d.amount - toBuyer;

        d.state = DealState.Settled;
        totalEscrowed -= d.amount;
        if (toBuyer > 0) balances[d.buyer] += toBuyer;
        if (toSeller > 0) balances[d.seller] += toSeller;

        emit Resolved(dealId, tier, toBuyer, toSeller, verdictHash);
    }

    // ---------------------------------------------------------------- withdraw

    /// @notice Pay the caller's own balance to the caller.
    /// @dev Its entire body is `withdrawFor(msg.sender)` — one implementation, so the
    ///      two entry points cannot drift.
    function withdraw() external {
        withdrawFor(msg.sender);
    }

    /// @notice Pays `account`'s balance **to `account`**, whoever calls.
    /// @dev This function exists because the operator drives every transaction on the
    ///      user's behalf: a `msg.sender`-only withdrawal would send every payout to
    ///      the operator. Safe to leave permissionless — a caller can only move
    ///      `account`'s balance to `account`, so there is nothing to gain beyond
    ///      paying someone else's gas.
    ///
    ///      This is the **only** function in the contract that moves tokens out.
    ///      Effects before interaction: the balance is zeroed before the transfer.
    function withdrawFor(address account) public {
        uint256 amount = balances[account];
        require(amount > 0, "nothing to withdraw");
        balances[account] = 0;
        token.safeTransfer(account, amount);
        emit Withdrawn(account, amount);
    }

    /// @dev The five tiers in basis points. An off-by-one here would be invisible
    ///      until a live demo and is the exact number an audience watches.
    function _refundBps(Tier t) private pure returns (uint256) {
        if (t == Tier.NoRefund) return 0;
        if (t == Tier.Quarter) return 2_500;
        if (t == Tier.Half) return 5_000;
        if (t == Tier.ThreeQuarter) return 7_500;
        return 10_000; // Full
    }
}
