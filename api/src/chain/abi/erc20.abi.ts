/**
 * The settlement token's ERC-20 surface — functions the operator calls
 * directly, plus error entries the operator never calls but must be able to
 * DECODE.
 *
 * Transcribed from `sc/out/ERC20.sol/ERC20.json` (OpenZeppelin's `ERC20`,
 * which `MockUSDC` extends). Regenerate by re-reading that artifact's `abi`
 * array after `forge build` if the token implementation ever changes.
 *
 * `as const` is not optional: viem derives every argument and return type
 * from the ABI's *literal* type (see R2 in
 * specs/003-chain-adapter/research.md). Widen it and every wrapper here
 * silently degrades to `unknown`.
 *
 * ---
 *
 * Why the two ERC20…Error entries are here at all — they look like dead
 * weight on a token ABI that's otherwise just four read/write functions:
 *
 * `openDeal` calls `token.safeTransferFrom(msg.sender, address(this), a.price)`
 * via OpenZeppelin's `SafeERC20`. When that inner call fails, `SafeERC20`'s
 * `_callOptionalReturn` does not raise its own generic error — it re-reverts
 * with the **token's own return data**, verbatim. So the revert that reaches
 * us for a missing allowance or an empty balance is `ERC20InsufficientAllowance`
 * / `ERC20InsufficientBalance` — errors that belong to the TOKEN contract, not
 * the escrow.
 *
 * The escrow's own ABI cannot decode them. Verified against the compiled
 * escrow artifact (`sc/out/GuardianEscrow.sol/GuardianEscrow.json`): its error
 * entries are exactly `AccessControlBadConfirmation`,
 * `AccessControlUnauthorizedAccount`, and `SafeERC20FailedOperation` — no
 * `ERC20…` entries anywhere in it. Decode an `openDeal` revert against
 * `escrowAbi` alone and a missing allowance or balance comes back as raw,
 * unnamed data, which surfaces to the user as a generic "execution reverted"
 * instead of the specific, actionable `InsufficientAllowanceError` /
 * `ContractRevertError` that contracts/errors.md's decoder (R6) depends on
 * being able to name. These two entries are what make that naming possible —
 * they are the fix, not decoration.
 *
 * One more thing this ABI cannot tell you, and that the decoder must not
 * assume: allowance and balance are INDEPENDENT preconditions for `openDeal`.
 * `ensureAllowance` (R10) only ever checks and tops up the allowance side —
 * an unbounded approval says nothing about whether the operator's account
 * actually holds enough of the token to move. Either one can be short while
 * the other is fine, and each fails with its own distinct error above.
 *
 * ---
 *
 * Why `transfer` is here, and why that is a bigger deal than one more entry:
 *
 * **Neither funding leg touches the escrow contract at all.** A top-up is
 * `USDC.transfer(operator, amount)` signed by the FUNDER — the funder wallet is
 * "the outside world", the only source of money in the system
 * (`docs/rain-integration.md` §0.2). A cash-out is the mirror image,
 * `USDC.transfer(funder, amount)` signed by the OPERATOR (§0.3). The escrow has
 * no function for either, and adding one would be an `sc/` redeploy
 * (specs/005-accounts-ledger-funding/research.md R4).
 *
 * So this file — not `escrow-operator.abi.ts` — is what both directions of the
 * platform's money movement go through. Both directions are the *same* call
 * with the same shape and the same cost; only the signing client and the
 * recipient differ, which is why `TokenTransferService` has two methods over
 * one ABI entry and one `GAS_LIMITS.transfer` ceiling.
 *
 * `transferFrom` is deliberately absent: the sender is the signer in both
 * directions, so an allowance step would be a second transaction for no
 * benefit. If it is ever added, it needs its own measured gas ceiling — it is
 * a different cost, not the same one.
 */
export const erc20Abi = [
  {
    type: 'function',
    name: 'allowance',
    inputs: [
      { name: 'owner', type: 'address', internalType: 'address' },
      { name: 'spender', type: 'address', internalType: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256', internalType: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'approve',
    inputs: [
      { name: 'spender', type: 'address', internalType: 'address' },
      { name: 'value', type: 'uint256', internalType: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool', internalType: 'bool' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'balanceOf',
    inputs: [{ name: 'account', type: 'address', internalType: 'address' }],
    outputs: [{ name: '', type: 'uint256', internalType: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'decimals',
    inputs: [],
    outputs: [{ name: '', type: 'uint8', internalType: 'uint8' }],
    stateMutability: 'view',
  },
  // -- The only write the funding flows make. Signed by the funder on a --
  // -- top-up and by the operator on a cash-out; one entry, two callers. --
  {
    type: 'function',
    name: 'transfer',
    inputs: [
      { name: 'to', type: 'address', internalType: 'address' },
      { name: 'value', type: 'uint256', internalType: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool', internalType: 'bool' }],
    stateMutability: 'nonpayable',
  },
  // -- Errors bubbled through SafeERC20 from the token, not the escrow. --
  // -- See the header comment: these are load-bearing, not optional. --
  {
    type: 'error',
    name: 'ERC20InsufficientAllowance',
    inputs: [
      { name: 'spender', type: 'address', internalType: 'address' },
      { name: 'allowance', type: 'uint256', internalType: 'uint256' },
      { name: 'needed', type: 'uint256', internalType: 'uint256' },
    ],
  },
  {
    type: 'error',
    name: 'ERC20InsufficientBalance',
    inputs: [
      { name: 'sender', type: 'address', internalType: 'address' },
      { name: 'balance', type: 'uint256', internalType: 'uint256' },
      { name: 'needed', type: 'uint256', internalType: 'uint256' },
    ],
  },
] as const;
