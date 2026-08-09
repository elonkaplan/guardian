// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {GuardianEscrow} from "../src/GuardianEscrow.sol";

/// @title Deploy
/// @notice Deploys `GuardianEscrow` from four values in the repository-root `.env` and
///         prints the resulting address as a line that can be pasted back into that
///         file unedited.
///
/// @dev Run from `sc/`, in a shell where the repo-root `.env` has been exported
///      (`set -a; . ../.env; set +a`) — `forge` does not walk up to parent directories
///      to find it. Omitting `--broadcast` runs the identical validation and simulation
///      without sending anything.
///
///      Two choices here look like style and are not:
///
///      1. **Every input is read with `vm.envOr`, never `vm.envAddress` / `vm.envUint`.**
///         The direct accessors abort on the first bad value and can say nothing about
///         the rest, so a reader with three blank fields discovers them one deploy
///         attempt at a time. `vm.envOr` returns its default for both missing and
///         malformed values, which is what lets validation see all four at once and
///         name every offender in a single message.
///      2. **The address is printed with `string.concat`, not the comma form.**
///         `console2.log("KEY=", addr)` joins its arguments with a space and emits
///         `KEY= 0x…`, which is not valid `.env` syntax and defeats the point of the
///         line. The concat form produces the exact bytes the file needs.
///
///      All validation completes before `vm.startBroadcast`, so a misconfigured run
///      creates nothing on the network even under `--broadcast`.
contract Deploy is Script {
    /// @dev Placeholder addresses in `.env.example` are format-valid fakes beginning
    ///      `0xDEAD` — they pass parsing by construction, so they need their own check.
    uint160 private constant PLACEHOLDER_PREFIX = 0xDEAD;

    /// @notice Validate the configuration, deploy, and print the paste-ready line.
    /// @return escrow The newly deployed contract.
    function run() external returns (GuardianEscrow escrow) {
        // --------------------------------------------------------------- inputs
        uint256 deployerKey = vm.envOr("DEPLOYER_PRIVATE_KEY", uint256(0));
        address token = vm.envOr("USDC_ADDRESS", address(0));
        address operator = vm.envOr("OPERATOR_ADDRESS", address(0));
        address guardian = vm.envOr("GUARDIAN_ADDRESS", address(0));

        // ----------------------------------------------------------- validation
        _validate(deployerKey, token, operator, guardian);

        // --------------------------------------------------------------- deploy
        // The admin is the deployer's own derived address: the key is single-use and
        // discardable, and no runbook step needs the admin role afterwards.
        vm.startBroadcast(deployerKey);
        escrow = new GuardianEscrow(IERC20(token), vm.addr(deployerKey), operator, guardian);
        vm.stopBroadcast();

        // --------------------------------------------------------------- output
        console2.log(string.concat("ESCROW_CONTRACT_ADDRESS=", vm.toString(address(escrow))));
    }

    /// @dev Accumulates every failure and reverts once. Reverting on the first would
    ///      turn a three-field mistake into three round trips.
    function _validate(uint256 deployerKey, address token, address operator, address guardian)
        private
        pure
    {
        // V1 — unset or unparseable. `vm.envOr` collapses the two cases into the
        // sentinel, so the message honestly says "missing or malformed"; the reader's
        // fix (look at that line in `.env`) is the same either way.
        string memory unset = "";
        if (deployerKey == 0) unset = _append(unset, "DEPLOYER_PRIVATE_KEY");
        if (token == address(0)) unset = _append(unset, "USDC_ADDRESS");
        if (operator == address(0)) unset = _append(unset, "OPERATOR_ADDRESS");
        if (guardian == address(0)) unset = _append(unset, "GUARDIAN_ADDRESS");

        // V2 — the shipped fakes. Deploying one grants a role to an address nobody
        // holds a key for, discovered at the first dispute and recoverable only by
        // redeploying, re-pasting and re-approving.
        string memory placeholders = "";
        if (_isPlaceholder(token)) placeholders = _append(placeholders, "USDC_ADDRESS");
        if (_isPlaceholder(operator)) placeholders = _append(placeholders, "OPERATOR_ADDRESS");
        if (_isPlaceholder(guardian)) placeholders = _append(placeholders, "GUARDIAN_ADDRESS");

        string memory problems = "";
        if (bytes(unset).length != 0) {
            problems = string.concat("missing or malformed: ", unset);
            // V1b — a bare-hex private key and a blank one are indistinguishable here,
            // and `cast --private-key` accepts bare hex, so a reader who tests the key
            // with `cast` sees it work and concludes the script is broken.
            //
            // Withheld when all four are unset, because that is the export-skipped case
            // (`set -a; . ../.env; set +a`) rather than a formatting one — and pointing
            // at the 0x prefix there sends the reader to the one file that is fine.
            bool everythingUnset =
                deployerKey == 0 && token == address(0) && operator == address(0) && guardian == address(0);
            if (deployerKey == 0 && !everythingUnset) {
                problems = string.concat(
                    problems,
                    " | DEPLOYER_PRIVATE_KEY must carry the 0x prefix in .env"
                    " (cast accepts bare hex, forge does not)"
                );
            }
        }

        if (bytes(placeholders).length != 0) {
            problems =
                _appendProblem(problems, string.concat("placeholder value still in .env: ", placeholders));
        }

        // V3 — one address holding both roles silently voids the two-role separation
        // the contract's security rests on. Skipped when both are already unset above.
        if (operator != address(0) && operator == guardian) {
            problems = _appendProblem(
                problems, "OPERATOR_ADDRESS and GUARDIAN_ADDRESS must be different addresses"
            );
        }

        if (bytes(problems).length != 0) {
            revert(string.concat("Deploy aborted -- ", problems));
        }
    }

    /// @dev Top 2 bytes of the address, i.e. the documented `0xDEAD` fake prefix.
    function _isPlaceholder(address a) private pure returns (bool) {
        return uint160(a) >> 144 == PLACEHOLDER_PREFIX;
    }

    function _append(string memory list, string memory name) private pure returns (string memory) {
        return bytes(list).length == 0 ? name : string.concat(list, ", ", name);
    }

    function _appendProblem(string memory problems, string memory next)
        private
        pure
        returns (string memory)
    {
        return bytes(problems).length == 0 ? next : string.concat(problems, " | ", next);
    }
}
