# Implementation Plan: Guardian Escrow Contract

**Branch**: `001-guardian-escrow-contract` | **Date**: 2026-08-08 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-guardian-escrow-contract/spec.md`

## Summary

Build `GuardianEscrow` — a single, non-upgradeable Solidity contract that captures a
buyer's payment at purchase, holds it untouchable through delivery and review, and
settles it down exactly one of four terminal paths: buyer accepts, review window
lapses, arbitrator rules on a five-tier refund scale, or the delivery deadline passes
with nothing delivered.

The technical approach is deliberately boring, because the property being sold is
*"the platform cannot override this"* — novelty in the settlement layer would be a
liability. Concretely:

- **Pull payments.** Settlement is pure bookkeeping: it credits a `balances` ledger and
  moves no tokens. The single `safeTransfer` out lives in `withdrawFor`. This removes
  the reentrancy surface from all four settlement paths without a guard.
- **Tier, never amount.** `resolve` takes a `Tier` enum; the contract computes the
  split from basis points. A compromised arbitrator key cannot invent a 37% refund.
- **Three permissionless exits.** `release`, `reclaim`, `forceResolve` are callable by
  anyone once their deadline passes, because each can only push a deal into the
  outcome the rules already dictate. This is what makes it escrow rather than custody.
- **Two narrow roles.** `OPERATOR_ROLE` drives the lifecycle but can never move
  escrowed funds; `GUARDIAN_ROLE` can only split an already-disputed deal between two
  addresses fixed at purchase.

Everything else — upgradeability, pausing, fees, reputation, appeals — is deliberately
absent. The contract is ~250 lines with no inheritance beyond OpenZeppelin
`AccessControl`.

## Technical Context

**Language/Version**: Solidity `0.8.24` (pinned exactly, not floating `^0.8.24`, so the
build is reproducible)

**Primary Dependencies**: OpenZeppelin Contracts v5.x — `AccessControl`, `SafeERC20`,
`IERC20`. No other libraries.

**Storage**: On-chain contract storage only. Two id-keyed mappings (`agents`, `deals`),
one address-keyed ledger (`balances`), one running total (`totalEscrowed`), two id
counters. No off-chain storage in this feature; agent definitions and verdict text live
in Postgres and reach the contract only as `bytes32` hashes.

**Testing**: `forge build` is this feature's acceptance gate. The full Foundry test
suite — mock ERC-20, tier-split assertions, timer boundaries, access control, solvency
after every state change — is **feature SC-02**, a separate spec that depends on this
one. This plan must therefore leave the contract *testable* (deterministic, no
constructor surprises, revert reasons stable enough to assert on) without shipping the
tests itself.

**Target Platform**: Monad Testnet, chain ID `10143`, EVM-equivalent, sub-second
finality. Built and deployed with the **Monad Foundry fork**, not upstream Foundry —
upstream mis-prices gas locally, which matters because of the constraint below.

**Project Type**: Single Solidity contract in a Foundry project (`sc/`).

**Performance Goals**: Not throughput-bound. The relevant target is *predictable* gas
per entry point, because the operator and the demo sweeper fire `openDeal`,
`markDelivered`, and `release` repeatedly during a live demo against a finite MON
balance. Optimizer on, 200 runs. Contract size is a non-issue — Monad's ceiling is
128 KB and this is a fraction of that.

**Constraints**:
- **Monad charges the gas *limit*, not the usage** (`value + gas_price * gas_limit`).
  Estimate-and-pad costs real money. This does not change the contract's design, but it
  is why gas predictability beats gas minimisation here: the callers will set explicit
  measured limits rather than estimate.
- Non-upgradeable and non-pausable by decision. A redeploy plus an `.env` update is the
  fix path, and at this size that is faster than a pause.
- Settlement token is fixed at deployment and immutable.
- Solvency must hold at every moment:
  `token.balanceOf(this) >= totalEscrowed + Σ balances`.

**Scale/Scope**: One contract. 13 external entry points, 9 events, 2 enums, 2 structs,
2 role constants, 2 timing constants. Three demo agents, a handful of live deals.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

`.specify/memory/constitution.md` is **an unedited template** — every principle,
section, and governance rule is still a `[PLACEHOLDER]`. There are no ratified
project principles to gate against.

**Result: PASS by vacancy, not by compliance.** No gates evaluated, no violations
possible, Complexity Tracking left empty.

Recorded so the omission reads as a finding rather than an oversight: if this project
later adopts a constitution, the three commitments this design would most likely be
asked to justify are already explicit and defensible in the spec — (1) a test suite
exists for this component only, and lives in a separate feature; (2) the contract is
deliberately non-upgradeable and non-pausable; (3) several known edge cases are
accepted rather than fixed, and are enumerated in the spec's Assumptions.

**Post-Phase 1 re-check: PASS**, unchanged. The design added no dependency, no
abstraction layer, and no component beyond the single contract the spec describes.

## Project Structure

### Documentation (this feature)

```text
specs/001-guardian-escrow-contract/
├── plan.md              # This file
├── spec.md              # Feature specification
├── research.md          # Phase 0 output — 8 resolved decisions
├── data-model.md        # Phase 1 output — entities, storage layout, state machine
├── quickstart.md        # Phase 1 output — build & validate guide
├── checklists/
│   └── requirements.md  # Spec quality checklist (all items pass)
├── contracts/           # Phase 1 output
│   ├── IGuardianEscrow.sol   # The external ABI surface
│   └── access-control.md     # Caller matrix, preconditions, revert reasons
└── tasks.md             # Phase 2 output (/speckit-tasks — NOT created here)
```

### Source Code (repository root)

The Foundry project root is `sc/` — the directory this plan lives under. Paths below
are relative to it.

```text
sc/
├── src/
│   └── GuardianEscrow.sol      # The whole feature. One contract, no helpers.
├── foundry.toml                # solc 0.8.24 pinned, optimizer on, evm_version set
├── remappings.txt              # @openzeppelin/contracts/ → lib/openzeppelin-contracts/contracts/
├── lib/
│   ├── openzeppelin-contracts/ # git submodule, v5.x tag
│   └── forge-std/              # git submodule (needed by SC-02 and SC-03)
├── .gitmodules
├── script/                     # SC-03 — Deploy.s.sol. Not this feature.
├── test/                       # SC-02 — the test suite. Not this feature.
└── README.md                   # SC-03 — the deploy runbook. Not this feature.
```

**Structure Decision**: A flat, single-contract Foundry project — the standard layout,
chosen because it is what the Monad Foundry fork and every Foundry tutorial assume, and
because one contract with no internal library, no proxy, and no diamond is the entire
architecture. `src/GuardianEscrow.sol` is the only file this feature creates besides
build configuration.

The empty `script/` and `test/` directories are shown because the layout must
accommodate them, but they belong to **SC-03** and **SC-02** respectively and are out of
scope here. `lib/forge-std` is installed now anyway, since both dependent features need
it and installing it later means a second submodule commit.

## Complexity Tracking

> No Constitution Check violations. Nothing to justify.
