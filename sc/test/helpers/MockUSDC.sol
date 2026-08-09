// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title MockUSDC
/// @notice Stand-in for the Monad test USDC the escrow settles in. Six decimals, so an
///         amount like `2_000_000` reads as "2 USDC" in a test exactly as it will on
///         chain.
/// @dev Deliberately boring: no transfer fee, no rebasing, no hooks, no pausing. The
///      production settlement token is fixed at deployment to a known, well-behaved
///      contract, so hostile-token behaviour would be testing a scenario the deployment
///      makes impossible.
///
///      Built on OpenZeppelin's real `ERC20` rather than hand-rolled, so allowance and
///      balance semantics — including the exact `ERC20InsufficientAllowance` error the
///      missing-approval test asserts on — are the same implementation the contract
///      meets in production.
contract MockUSDC is ERC20 {
    constructor() ERC20("Mock USDC", "mUSDC") {}

    /// @notice Six decimals — matches the settlement token on Monad testnet.
    function decimals() public pure override returns (uint8) {
        return 6;
    }

    /// @notice Unguarded on purpose. Test scaffolding; never deployed.
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
