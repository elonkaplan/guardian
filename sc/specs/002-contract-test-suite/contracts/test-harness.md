# Contract: Test Harness API

**Feature**: [../spec.md](../spec.md) · **Data model**: [../data-model.md](../data-model.md)

This is an **interface, not documentation**. Six test files are written against these
exact names and signatures, and the `solvent` modifier is the mechanism by which FR-017
is satisfiable. Renaming a member here is a change to every test file.

Two files define it: `test/helpers/MockUSDC.sol` and `test/helpers/EscrowTestBase.sol`.

---

## 1. `MockUSDC`

```solidity
// test/helpers/MockUSDC.sol
contract MockUSDC is ERC20 {
    constructor() ERC20("Mock USDC", "mUSDC") {}

    /// @notice Six decimals — matches the Monad test USDC the contract settles in.
    function decimals() public pure override returns (uint8);

    /// @notice Unguarded on purpose. Test scaffolding, never deployed.
    function mint(address to, uint256 amount) external;
}
```

Nothing else. No fee on transfer, no rebasing, no transfer hooks, no pausing — the
production settlement token is a fixed, known, well-behaved contract, so a hostile-token
mock would be testing a scenario deployment makes impossible
([research R-001](../research.md#r-001--write-a-minimal-mockusdc-do-not-use-openzeppelins-mocks)).

---

## 2. `EscrowTestBase`

```solidity
// test/helpers/EscrowTestBase.sol
abstract contract EscrowTestBase is Test {
```

### 2.1 World

| Member | Type | Set in `setUp` to |
| --- | --- | --- |
| `usdc` | `MockUSDC` | freshly deployed |
| `escrow` | `GuardianEscrow` | `new GuardianEscrow(usdc, admin, operator, guardian)` |
| `admin` `operator` `guardian` `buyer` `seller` `seller2` `stranger` | `address` | `makeAddr("<name>")` |
| `participants` | `address[]` | the seven above |
| `donated` | `uint256` | `0` |

`setUp()` is `public virtual` so a test contract can extend it; any override **must**
call `super.setUp()`. Its final two acts are the ones whose absence would break every
test in a confusing way: mint `MINT` to `operator`, then `vm.prank(operator)` and
`usdc.approve(address(escrow), type(uint256).max)`.

### 2.2 Constants

```solidity
uint256 internal constant PRICE      = 2_000_000;      // 2.000000 USDC, divisible by 4
uint256 internal constant ODD_PRICE  = 1_000_003;      // forces truncation
uint256 internal constant PRICE_2    = 3_000_000;      // seller2's agent
uint256 internal constant MINT       = 1_000_000_000;  // 1000 USDC to the operator
uint32  internal constant REVIEW     = 1 hours;
uint32  internal constant ZERO_REVIEW = 0;

bytes32 internal constant DEF_HASH     = keccak256("agent-definition-v1");
bytes32 internal constant DEF_HASH_2   = keccak256("agent-definition-v2");  // updateAgent
bytes32 internal constant VERDICT_HASH = keccak256("verdict");
```

`DELIVERY_DEADLINE` and `DISPUTE_DEADLINE` are **read from the contract**
(`escrow.DELIVERY_DEADLINE()`), never redeclared — a redeclared copy would agree with a
changed contract instead of catching it.

### 2.3 Fixtures

```solidity
function _registerAgent(address owner_, uint256 price) internal returns (uint256 agentId);
function _openDeal(uint256 agentId, address buyer_, uint32 window) internal returns (uint256 dealId);

/// @notice Agent owned by `seller` at PRICE → deal for `buyer` → markDelivered.
function _delivered(uint32 window) internal returns (uint256 dealId);
function _deliveredAt(uint256 price, uint32 window) internal returns (uint256 dealId);

/// @notice As `_delivered`, then the buyer disputes inside the window.
function _disputed() internal returns (uint256 dealId);
function _disputedAt(uint256 price) internal returns (uint256 dealId);

/// @notice An `Open` deal that was never delivered.
function _opened() internal returns (uint256 dealId);

/// @notice Track an address so its balance counts toward the solvency sum.
function _track(address a) internal;
```

### 2.3.1 Deal accessors and boundary instants

`deals(id)` returns an 11-element tuple. Destructuring it lives here once rather than in
six files, and the three boundary helpers are what let the timer tests warp to **absolute**
instants derived from the deal's own recorded timestamps.

```solidity
function _state(uint256 dealId)         internal view returns (GuardianEscrow.DealState);
function _amountOf(uint256 dealId)      internal view returns (uint256);
function _sellerOf(uint256 dealId)      internal view returns (address);
function _defOf(uint256 dealId)         internal view returns (bytes32 defHash, uint32 defVersion);
function _openedAtOf(uint256 dealId)    internal view returns (uint64);
function _deliveredAtOf(uint256 dealId) internal view returns (uint64);
function _disputedAtOf(uint256 dealId)  internal view returns (uint64);
function _reviewWindowOf(uint256 dealId) internal view returns (uint32);

/// @notice deliveredAt + reviewWindow — `release` opens here, `dispute` shuts.
function _windowEnd(uint256 dealId)       internal view returns (uint256);
function _deliveryDeadline(uint256 dealId) internal view returns (uint256);  // openedAt + 24h
function _disputeDeadline(uint256 dealId)  internal view returns (uint256);  // disputedAt + 72h
```

The deadline helpers read `escrow.DELIVERY_DEADLINE()` / `escrow.DISPUTE_DEADLINE()` from
the contract rather than redeclaring the durations, so a change there surfaces as a failing
boundary test instead of two numbers silently agreeing.

All fixtures prank `operator` (or `buyer`, for `dispute`) internally and leave no active
prank behind — a leaked `startPrank` would silently change the caller of the line under
test. Fixtures use `vm.prank` per call rather than `startPrank`/`stopPrank` pairs for
exactly that reason.

### 2.4 The solvency modifier

```solidity
/// @dev Body first, assertion second. Carried by EVERY state-changing test (FR-017).
modifier solvent() {
    _;
    _assertSolvent();
}

function _assertSolvent() internal view;
function _sumBalances() internal view returns (uint256 total);
```

`_assertSolvent` asserts:

```
usdc.balanceOf(address(escrow)) == escrow.totalEscrowed() + _sumBalances() + donated
```

Equality, not the contract's `>=`, and the `donated` term is what preserves the `>=`
semantics for the one test that transfers tokens in directly — it sets `donated` at the
same moment it transfers. Reasoning in
[research R-002](../research.md#r-002--solvency-is-a-modifier-not-a-trailing-call).

**Auditable by grep.** Every test function that changes state must match
`function test_.*solvent`. A state-changing test without the modifier is a defect in this
suite, not a style preference.

### 2.5 Revert helpers

```solidity
/// @notice For the contract's own short require strings.
function _expectRevertReason(string memory reason) internal;

/// @notice For OZ v5 `onlyRole` failures — AccessControlUnauthorizedAccount(caller, role).
function _expectUnauthorized(address caller, bytes32 role) internal;
```

`_expectUnauthorized` builds
`abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, caller, role)`.
The two shapes are not interchangeable: a role failure asserted as a string will not
match, and a `require` failure asserted as the custom error will not match either.

**No test may call the no-argument `vm.expectRevert()`** (FR-021). A bare expectation on
`release` before the window passes whether the revert was `"window open"` — the thing
under test — or `"not delivered"` from a broken fixture.

A third shape appears once: the missing-allowance test asserts OZ's
`ERC20InsufficientAllowance(spender, allowance, needed)`, which `SafeERC20` bubbles
**unwrapped** in v5.1 (verified in the installed submodule, not assumed). It is not
`SafeERC20FailedOperation`.

---

## 3. Test contract shape

```solidity
// test/TierSplits.t.sol
contract TierSplitsTest is EscrowTestBase {
    function test_Resolve_Quarter_Splits25_75() public solvent { … }
}
```

| Rule | Why |
| --- | --- |
| Filename `<Group>.t.sol`, contract `<Group>Test` | `forge test --match-path test/TierSplits.t.sol` maps one-to-one onto the spec's scope groups. |
| Function `test_<Subject>_<Condition>_<Expectation>` | SC-002 requires the five percentages be findable by name without reading the contract. |
| Every state-changing test carries `solvent` | FR-017. |
| Helpers live in the base, never duplicated per file | Six copies of a fixture drift; one does not. |
| No `setUp` override unless it calls `super.setUp()` | Skipping it leaves the operator with no allowance and every test failing inside the token. |

---

## 4. Revert strings this suite asserts on

Copied from
[SC-01's access-control contract](../../001-guardian-escrow-contract/contracts/access-control.md)
§3, which is the authority. Listed here because they are this suite's assertion targets
and a change to any of them breaks tests here first.

| String | Raised by |
| --- | --- |
| `"not open"` | `markDelivered`, `reclaim` |
| `"not delivered"` | `accept`, `release`, `dispute` |
| `"not disputed"` | `resolve`, `forceResolve` |
| `"not buyer"` | `accept`, `dispute` (caller is neither buyer nor operator) |
| `"window open"` | `release` before the review window lapses |
| `"window closed"` | `dispute` after the review window lapses |
| `"too early"` | `reclaim`, `forceResolve` before their deadlines |
| `"nothing to withdraw"` | `withdraw`, `withdrawFor` with a zero balance |
| `"agent inactive"` | `openDeal` against a delisted agent |
| `"no agent"` | `updateAgent`, `setAgentActive` on an unknown id |
| `"bad owner"` / `"bad buyer"` | zero-address arguments |
| `AccessControlUnauthorizedAccount(address,bytes32)` | any `onlyRole` failure |
| `ERC20InsufficientAllowance(address,uint256,uint256)` | `openDeal` with no operator approval |
