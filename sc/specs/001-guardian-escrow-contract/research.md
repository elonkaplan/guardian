# Phase 0 Research: Guardian Escrow Contract

**Feature**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md) · **Date**: 2026-08-08

The spec carried **zero** `[NEEDS CLARIFICATION]` markers — the source design doc had
already resolved every product-level question. What follows are the *technical*
decisions the spec deliberately left to this phase: toolchain pinning, library
versions, and the handful of Solidity-level choices that would be expensive to reverse
after the tests in SC-02 are written against them.

Eight decisions. One of them (R-002) is a genuine total-failure risk if guessed wrong;
the rest are ordinary.

---

## R-001 — OpenZeppelin v5.x, not v4.x

**Decision**: Depend on `openzeppelin-contracts` **v5.x**, installed as a git submodule
under `lib/`, with a `remappings.txt` entry mapping `@openzeppelin/contracts/` to
`lib/openzeppelin-contracts/contracts/`.

**Rationale**: v5 is the current line and requires Solidity `^0.8.20`, which the pinned
`0.8.24` satisfies. Only three imports are needed — `IERC20`, `SafeERC20`,
`AccessControl` — and all three are stable across the v4→v5 boundary in the ways this
contract uses them. Critically, the design's constructor calls `_grantRole(...)`
directly, which is the **correct** v5 idiom: v5 removed `_setupRole` entirely. A v4.x
tutorial pattern (`_setupRole`) would not compile, and a v4.x installation would let
that mistake through.

**Alternatives considered**:
- *v4.9.x* — works, but pins the project to a maintenance line for no benefit, and
  invites `_setupRole` to creep in from copy-pasted examples.
- *npm/pnpm install instead of a submodule* — Foundry's convention is submodules under
  `lib/`, and the Monad Foundry fork inherits it. Mixing a node-based dependency into a
  project with no `package.json` adds a toolchain for one directory.

**Consequences to carry**: `AccessControl` in v5 is `abstract` with no constructor
arguments, so `GuardianEscrow` inherits it plainly and grants roles in its own
constructor. `SafeERC20` in v5 has no `safeApprove` — irrelevant, this contract never
approves anything.

---

## R-002 — Pin `evm_version = "shanghai"` explicitly

**Decision**: Set `evm_version = "shanghai"` in `foundry.toml` rather than accepting
solc 0.8.24's default.

**Rationale**: This is the one decision here that can fail catastrophically and
silently. Solidity 0.8.24 defaults to the **Cancun** EVM version, which permits the
compiler to emit `MCOPY` (EIP-5656) for memory copies and `TSTORE`/`TLOAD` (EIP-1153).
If the target chain does not implement those opcodes, the contract deploys fine and
then reverts at runtime in a way that looks like a logic bug, not a toolchain bug.

Monad is documented as EVM-equivalent, and the project's own notes record that EIP-4844
blob transactions are unsupported — which is enough to establish that "EVM-equivalent"
here is not a blanket guarantee of every Cancun EIP. Rather than depend on resolving
exactly which Cancun opcodes Monad implements, compile down to **Shanghai**, which every
Cancun-or-later chain executes. Bytecode compiled for Shanghai runs on a Cancun chain;
the reverse is not true. The cost of the conservative choice is zero here: this contract
uses no transient storage and copies no large memory buffers, so `MCOPY` and `TSTORE`
would save nothing worth measuring.

**Alternatives considered**:
- *Leave it unset (Cancun default)* — the cheapest thing to write and the most expensive
  thing to be wrong about. Rejected on asymmetry alone.
- *`evm_version = "paris"`* — even more conservative, but gives up `PUSH0` (Shanghai) for
  no reason; `PUSH0` is broadly supported and slightly smaller.

**Verification**: Cheap to confirm empirically once SC-03 deploys — if a Shanghai build
works and a Cancun build also works, the pin cost nothing. Do not remove the pin on the
strength of one successful transaction.

---

## R-003 — Keep short `require` strings; do not switch to custom errors

**Decision**: Use `require(condition, "short reason")` with the exact reason strings from
the design draft (`"bad owner"`, `"no agent"`, `"agent inactive"`, `"bad buyer"`,
`"not open"`, `"not delivered"`, `"not buyer"`, `"window open"`, `"window closed"`,
`"too early"`, `"not disputed"`, `"nothing to withdraw"`).

**Rationale**: Custom errors are cheaper and are the modern idiom — and that is not the
deciding factor here. **SC-02 will be written against these strings**, and SC-03's
runbook debugging depends on a revert message a human can read from a failed
transaction. Stable, documented revert reasons are worth more to this project than the
gas they cost, especially given that on Monad the *limit* is charged rather than the
usage, which mutes the saving. Changing this later means rewriting every
`vm.expectRevert` in the test suite.

**Alternatives considered**:
- *Custom errors (`error NotDisputed();`)* — objectively better for a production
  contract, and the right call if this were long-lived. Rejected for an MVP whose test
  suite and runbook are being written in parallel by other features.

**Consequence**: [access-control.md](./contracts/access-control.md) is the authority on
these strings. Treat that table as an interface, not documentation.

---

## R-004 — No `ReentrancyGuard`

**Decision**: Do not inherit or add a reentrancy guard anywhere.

**Rationale**: There is nothing to guard. All four settlement paths move **zero tokens** —
they only decrement `totalEscrowed` and increment `balances`, so no external call
happens during settlement at all. The single external call in the contract is
`token.safeTransfer(account, amount)` inside `withdrawFor`, which zeroes
`balances[account]` **before** the transfer (checks-effects-interactions). A standard
ERC-20 `transfer` does not call back into the recipient, and the settlement token is
fixed at deployment and immutable, so a malicious token cannot be introduced after the
fact.

Adding a guard would suggest the pull-payment structure is not itself the defence, which
is precisely the property the design is built on.

**Alternatives considered**:
- *`nonReentrant` on `withdrawFor`* — belt-and-braces, costs a storage slot and a
  warm/cold SSTORE per withdrawal. Rejected: it would be protecting against a callback
  that ERC-20 `transfer` does not make, from a token address that cannot change.

**Boundary noted**: this reasoning depends on the token being a standard, non-callback
ERC-20. Test USDC is. An ERC-777-style token with transfer hooks would change the
analysis — and is already listed as an accepted MVP risk in the spec alongside
fee-on-transfer and rebasing tokens.

---

## R-005 — Preserve the documented struct field order; do not repack for gas

**Decision**: Declare `Agent` and `Deal` with fields in exactly the order the spec's data
model lists them, accepting the resulting slot layout.

**Rationale**: `Deal` as specified occupies 7 storage slots — `agentId`, `buyer`,
`seller`, `amount`, `defHash` take one each (two `address` fields cannot share a slot),
and the tail (`defVersion` u32, `openedAt` u64, `deliveredAt` u64, `disputedAt` u64,
`reviewWindow` u32, `state` u8 = 33 bytes) spills into two. Moving `defVersion` up beside
`buyer` would pack the tail into a single slot and save one `SSTORE` on `openDeal`.

Not worth it. The saving is one cold `SSTORE` on a call the operator makes a few dozen
times across a demo, on a chain that charges the gas limit rather than the usage — so the
saving does not even reach the wallet unless the limit is lowered to match, which is a
separate measurement exercise. Against that: the field order in the design doc, the
spec's data model, and the storage layout would diverge, and every reader would have to
hold the mapping in their head. Fidelity wins.

**Alternatives considered**:
- *Repack `Deal` into 6 slots* — real, small, and measurable. Revisit only if gas becomes
  a live constraint, which the plan's Performance Goals say it is not.

---

## R-006 — Basis-point split, integer division, remainder to the seller

**Decision**: Compute `toBuyer = amount * refundBps(tier) / 10_000` and
`toSeller = amount - toBuyer`. Never compute `toSeller` independently.

**Rationale**: Deriving the second number by subtraction makes
`toBuyer + toSeller == amount` **structurally true** rather than arithmetically hoped
for — which is exactly FR-019, and the thing SC-02 asserts for all five tiers. Any
truncation from the integer division lands on the seller's side by construction, and
there is no path where dust is created or stranded.

For the tiers in use the division is exact anyway at realistic amounts: the four non-zero
tiers are 2500 / 5000 / 7500 / 10000 bps, so any amount divisible by 4 splits cleanly,
and USDC's 6 decimals make sub-4-unit amounts (< $0.000004) irrelevant. But the
subtraction is what guarantees the invariant, not the arithmetic happening to be clean.

**Alternatives considered**:
- *Percentage rather than basis points* — 0/25/50/75/100 divides evenly too. Basis points
  are the ecosystem convention and leave room for finer tiers without a storage change.
- *Compute both sides from the tier* — introduces a real possibility of the two not
  summing to `amount`. Rejected outright.

---

## R-007 — `withdraw()` delegates to `withdrawFor(msg.sender)`; `withdrawFor` is `public`

**Decision**: `withdrawFor(address account)` is `public` and holds the entire
implementation; `withdraw()` is `external` and its whole body is
`withdrawFor(msg.sender)`.

**Rationale**: One implementation, so the two entry points cannot drift — and the
delegation direction is the one that matters. The inverse (`withdrawFor` calling
`withdraw`) is impossible, and a duplicated body invites the exact bug this function
exists to prevent: a `msg.sender`-only withdrawal sends every operator-driven payout to
the operator. `withdrawFor` must be `public` rather than `external` for `withdraw()` to
call it internally.

Leaving `withdrawFor` permissionless is safe by construction: it can only move
`account`'s balance **to `account`**. A stranger calling it achieves nothing except
paying the gas on someone else's behalf.

**Alternatives considered**:
- *`withdrawFor` restricted to `OPERATOR_ROLE`* — would break the "a user can always
  self-serve without the platform" property for no security gain, since the function
  cannot misdirect funds.
- *Only `withdrawFor`, drop `withdraw()`* — smaller surface, but users interacting
  directly with the contract from a wallet UI would have to type their own address as an
  argument. Keep both.

---

## R-008 — Foundry project layout and pinned toolchain

**Decision**: Standard flat Foundry layout. `foundry.toml`:

```toml
[profile.default]
src = "src"
out = "out"
libs = ["lib"]
solc = "0.8.24"
evm_version = "shanghai"    # R-002
optimizer = true
optimizer_runs = 200

[rpc_endpoints]
monad_testnet = "${MONAD_RPC_URL}"
```

Built with the **Monad Foundry fork**, installed per Monad's docs — not upstream Foundry.

**Rationale**: `solc = "0.8.24"` pins the exact compiler rather than letting `^0.8.24`
float, so the bytecode is reproducible across machines — which matters because the
deployed address goes into `.env` and the API is built against that ABI.
`optimizer_runs = 200` is the conventional default and appropriate for a contract whose
functions are each called a modest number of times. The `rpc_endpoints` entry reads from
the environment so no chain configuration is hardcoded, per the project's standing rule.

The Monad fork is non-negotiable: upstream Foundry mis-prices gas locally, and on a chain
that charges the gas limit rather than the usage, a locally mis-measured limit is
directly money.

**Alternatives considered**:
- *Hardhat* — absent from Monad's tooling docs entirely. Foundry it is, even though the
  rest of the stack is TypeScript.
- *Higher `optimizer_runs`* — optimises for call frequency this contract will never see;
  costs deploy size for nothing.
