# Quickstart: Build & Validate the Guardian Escrow Contract

**Feature**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md) · **Model**: [data-model.md](./data-model.md)

How to get from a cold checkout to a verified build of `GuardianEscrow`, and how to
tell whether the result actually satisfies the spec.

**Scope boundary.** This feature's acceptance gate is `forge build`. The behavioural
test suite is **SC-02** and the testnet deployment is **SC-03** — both separate specs
that depend on this one. Everything below stops at "it compiles and its surface is
correct". §5 lists what deliberately cannot be validated yet and where it gets
validated instead.

---

## 1. Prerequisites

| | |
| --- | --- |
| **Foundry** | The **Monad fork**, installed per `docs.monad.xyz`. **Not upstream Foundry** — upstream mis-prices gas locally, and Monad charges the gas *limit* rather than the usage, so a mis-measured limit is money. |
| **git** | Dependencies are submodules under `lib/`. |
| **solc 0.8.24** | Fetched automatically by Foundry from the `solc` pin in `foundry.toml`. Nothing to install by hand. |

No Node, no Docker, no database. This component shares nothing with the rest of the
stack but the `.env` file.

Confirm the fork rather than assuming it:

```bash
forge --version      # should identify a Monad build, not plain foundry
```

If it reports upstream Foundry, stop and install the fork. Everything below will
"work" on upstream and give you gas numbers you cannot trust.

---

## 2. Setup

From `sc/`:

```bash
# Dependencies — OpenZeppelin v5.x, and forge-std for the SC-02/SC-03 features
forge install OpenZeppelin/openzeppelin-contracts@v5.1.0 --no-commit
forge install foundry-rs/forge-std --no-commit
```

Then confirm `remappings.txt` maps the import path the source uses:

```
@openzeppelin/contracts/=lib/openzeppelin-contracts/contracts/
forge-std/=lib/forge-std/src/
```

And that `foundry.toml` carries all five settings that matter — the compiler pin, the
EVM version, and the optimizer:

```toml
[profile.default]
src = "src"
out = "out"
libs = ["lib"]
solc = "0.8.24"
evm_version = "shanghai"
optimizer = true
optimizer_runs = 200

[rpc_endpoints]
monad_testnet = "${MONAD_RPC_URL}"
```

`evm_version = "shanghai"` is the one line here that is easy to drop and expensive to
lose — see [research.md R-002](./research.md). Without it, solc 0.8.24 targets Cancun and
may emit opcodes that deploy fine and then revert at runtime looking like a logic bug.

---

## 3. Build

```bash
forge build
```

**Expected**: compilation succeeds with zero errors. This is the whole of FR-030 and
SC-007, and the acceptance gate for the feature.

Warnings worth reading rather than ignoring:

| Warning | Verdict |
| --- | --- |
| Unused function parameter | Investigate — probably a precondition you forgot to check |
| Function state mutability can be restricted to `view`/`pure` | Fine on `_refundBps` if it is already `pure`; otherwise fix |
| Unreachable code | Always a bug at this size |

Then confirm the surface matches the design contract:

```bash
forge inspect GuardianEscrow abi
```

Diff it mentally against [contracts/IGuardianEscrow.sol](./contracts/IGuardianEscrow.sol).
You are checking for **13 external entry points, 9 events, and the public getters**.
Two specific things to look at, because both are silent when wrong:

- `withdrawFor(address)` is present and `withdraw()` takes no arguments
- `resolve` takes `(uint256, uint8, bytes32)` — a `uint8` tier, **never** a `uint256`
  amount

```bash
forge inspect GuardianEscrow storageLayout
```

**Expected**: `Deal` occupies 7 slots, `Agent` 4 — matching
[data-model.md §2](./data-model.md). A different count means the field order drifted
from the spec.

---

## 4. Validating the design by inspection

Until SC-02 exists, these are checkable by reading the source, and each one maps to a
requirement that a wrong implementation would satisfy *superficially*. Do them in
order; they are ranked by how expensive the mistake is.

| # | Check | Requirement | How to tell |
| --- | --- | --- | --- |
| 1 | **Exactly one `safeTransfer` in the file, inside `withdrawFor`** | FR-003, FR-004 | `grep -c safeTransfer(` → the only hits are one `safeTransferFrom` in `openDeal` and one `safeTransfer` in `withdrawFor`. A `transfer` inside any settlement path destroys the reentrancy-free property. |
| 2 | **`withdraw()`'s body is a single call to `withdrawFor(msg.sender)`** | FR-005 | Read it. A duplicated body is how every operator-driven payout ends up at the operator. |
| 3 | **`toSeller` is derived by subtraction, never computed** | FR-019 | The line reads `amount - toBuyer`. Two independent computations can fail to sum to `amount`. |
| 4 | **`resolve` has no amount or address parameter** | FR-018 | Signature check. This is what caps a compromised arbitrator key at "wrong verdict". |
| 5 | **`release`, `reclaim`, `forceResolve` carry no `onlyRole`** | FR-026 | A role modifier on any of the three turns escrow into custody. |
| 6 | **`totalEscrowed` changes on exactly four lines** | FR-006 | One `+=` in `openDeal`; one `-=` in each of `_payout`, `reclaim`, `_settleDispute` — three helpers covering the four settlement paths, since `accept`/`release` share `_payout` and `resolve`/`forceResolve` share `_settleDispute`. |
| 7 | **`seller` is read from the `Deal`, never from `agents[...]`, at payout** | FR-010 | `grep` the settlement paths for `agents[` — there should be no hit outside `openDeal`. |
| 8 | **Both counters initialise to 1** | FR-027 | Declaration site. Initialising to 0 makes id 0 a real deal and breaks every existence check. |
| 9 | **`token` is `immutable`** | FR-028 | Declaration site. |

---

## 5. What this cannot validate yet

Stated explicitly so the gaps read as sequencing rather than as coverage:

| Property | Validated by |
| --- | --- |
| The five tier splits produce the right numbers | **SC-02** — an explicit split assertion per tier |
| Timers admit and refuse on the correct side of each boundary | **SC-02** — `vm.warp`, both sides of all three deadlines |
| Role-gated functions revert for the wrong caller; the three permissionless ones succeed for a stranger | **SC-02** |
| No double-settle from any entry point | **SC-02** |
| Solvency holds after every state change | **SC-02** — asserted after each state-changing test, not once at the end |
| `withdrawFor(x)` pays `x` when called by a third party | **SC-02** — must be tested with a stranger as caller, not the owner |
| It deploys, roles wire up, and a real purchase clears | **SC-03** — including the operator `approve` step, which is the one that bites |

A clean `forge build` proves the contract is well-formed. It proves nothing about
whether the money lands in the right place. Do not treat this feature as done in the
product sense until SC-02 passes.

---

## 6. Troubleshooting

**`Source file requires different compiler version`** — the editor's Solidity extension
is using its own bundled solc (0.8.36 at time of writing) rather than the project's
pin. Harmless: `forge build` uses the `solc = "0.8.24"` pin from `foundry.toml`
regardless. Point the extension at the Foundry-managed compiler if the squiggles annoy
you; do not loosen the pragma to satisfy it.

**`Error: failed to resolve file` on an `@openzeppelin/...` import** — `remappings.txt`
is missing or the submodule did not clone. `ls lib/openzeppelin-contracts/contracts` to
confirm, then `forge remappings` to see what Foundry actually resolved.

**`_setupRole is not defined`** — a v4 idiom in a v5 install. The constructor should
call `_grantRole`. See [research.md R-001](./research.md).

**Gas figures that look wrong** — you are almost certainly on upstream Foundry. Recheck
§1.
