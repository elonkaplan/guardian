# Implementation Plan: Contract Test Suite

**Branch**: `002-contract-test-suite` | **Date**: 2026-08-08 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/002-contract-test-suite/spec.md`

## Summary

Build the Foundry test suite for `GuardianEscrow` (SC-01): a six-decimal mock ERC-20, a
shared base test contract carrying the actors, fixtures and the solvency assertion, and
six test files grouped by what each protects — tier splits, undisputed lifecycles,
deadlines, access control, withdrawal payees, and the state machine.

The technical approach is shaped by three decisions that are easy to get wrong and
expensive to reverse:

- **The solvency check is a modifier, not a call at the end of each test.** A trailing
  call is silently forgettable, and a forgotten one is indistinguishable from a passing
  one. `modifier solvent()` runs the test body then asserts, so the requirement "after
  every state-changing test" is visible in the function signature and auditable by
  grepping for the modifier.
- **The five tier assertions are written out longhand, not driven from a table.** A
  table of `{tier → bps}` in the test would be the same table as `_refundBps` in the
  contract; if one is wrong the test agrees with the bug. Five separate tests each
  naming both resulting amounts in decimal is the only form that actually checks the
  percentages.
- **Role failures and everything else revert differently.** `GuardianEscrow` uses short
  `require` strings, but role failures come from OpenZeppelin v5 as the custom error
  `AccessControlUnauthorizedAccount(address,bytes32)`. A test that asserts a string
  where a custom error is thrown fails confusingly; one that asserts nothing at all
  passes for the wrong reason. Both revert shapes get their own helper.

The suite is enumerated-case only. Fuzzing, invariant campaigns, gas benchmarking, and
formal verification are out of scope per the source spec.

## Technical Context

**Language/Version**: Solidity `0.8.24`, pinned exactly in `foundry.toml`. Test contracts
compile under the same pin as `src/`.

**Primary Dependencies**: `forge-std` (the `Test` base contract, `vm` cheatcodes,
assertions) and OpenZeppelin Contracts v5.1.0 — `ERC20` as the base for the mock,
`IAccessControl` for the role-failure error selector. No new dependencies; both
submodules are already installed under `lib/`.

**Storage**: None. Every test runs against fresh in-memory EVM state; Foundry re-runs
`setUp()` per test function, so there is no shared state to reset.

**Testing**: `forge test`. This feature *is* the test layer — the thing under test is
`src/GuardianEscrow.sol`, which this feature does not modify.

**Target Platform**: Local EVM simulation only (Foundry's in-process EVM at
`evm_version = "shanghai"`, matching the deployed target). No RPC, no fork, no Monad
testnet interaction — that belongs to SC-03.

**Project Type**: Foundry test suite for a single-contract project.

**Performance Goals**: Whole suite under 60 seconds on a developer machine (SC-008).
With no fuzzing and no forking this is a wide margin — the realistic figure is a couple
of seconds — but it is the number that keeps the suite runnable before every change.

**Constraints**:
- **Determinism.** No dependence on wall-clock time, on test ordering, or on execution
  speed. All time movement is explicit `vm.warp`.
- **Revert reasons are an interface.** The exact strings in
  [`../001-guardian-escrow-contract/contracts/access-control.md`](../001-guardian-escrow-contract/contracts/access-control.md)
  §3 are what this suite asserts on. Changing one in the contract is a breaking change
  here.
- **The contract is not modified by this feature.** If a test reveals a defect, the fix
  is a change to SC-01.
- **`forge` is not on the default `PATH` in a non-interactive shell** on the current
  machine; it lives at `~/.foundry/bin/forge`. Any scripted invocation must use the
  absolute path or source the shell profile.

**Scale/Scope**: 8 files (1 mock, 1 base, 6 test files), **81 test functions** enumerated
in [contracts/coverage-matrix.md](./contracts/coverage-matrix.md), 13 entry points
covered, 5 tier assertions, 4 deadline gates tested from both sides, 5 settlement routes
swept against each other.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

`.specify/memory/constitution.md` is **still an unedited template** — every principle
and governance rule remains a `[PLACEHOLDER]`. There are no ratified principles to gate
against.

**Result: PASS by vacancy, not by compliance.** No gates evaluated, no violations
possible, Complexity Tracking left empty.

Recorded so the omission reads as a finding rather than an oversight: were a
constitution adopted with a Test-First principle, this feature would sit awkwardly with
it — the contract was written first (SC-01) and the tests follow (SC-02). That ordering
is a deliberate, documented project decision driven by the hackathon timeline, not an
accident, and it is worth re-examining rather than silently inheriting if this codebase
outlives the demo.

**Post-Phase 1 re-check: PASS**, unchanged. The design adds no dependency beyond the two
submodules already present and no production code of any kind.

## Project Structure

### Documentation (this feature)

```text
specs/002-contract-test-suite/
├── plan.md              # This file
├── spec.md              # Feature specification
├── research.md          # Phase 0 output — 10 resolved decisions
├── data-model.md        # Phase 1 output — actors, fixtures, amounts, matrices
├── quickstart.md        # Phase 1 output — how to run and how to prove it works
├── checklists/
│   └── requirements.md  # Spec quality checklist (all items pass)
├── contracts/           # Phase 1 output
│   ├── test-harness.md      # The base contract's API — actors, fixtures, modifier
│   └── coverage-matrix.md   # FR/SC → file → test function, both directions
└── tasks.md             # Phase 2 output (/speckit-tasks — NOT created here)
```

### Source Code (repository root)

The Foundry project root is `sc/`. Paths below are relative to it. **Only files under
`test/` are created by this feature**; everything else already exists.

```text
sc/
├── src/
│   └── GuardianEscrow.sol          # SC-01 — under test, NOT modified here
├── test/                           # ← everything this feature creates
│   ├── helpers/
│   │   ├── MockUSDC.sol            # 6-decimal ERC-20, public mint, nothing clever
│   │   └── EscrowTestBase.sol      # actors, fixtures, `solvent` modifier, revert helpers
│   ├── TierSplits.t.sol            # US1 — the five percentages, longhand
│   ├── HappyPath.t.sol             # US2 — accept / release / reclaim / withdraw
│   ├── Timers.t.sol                # US3 — four deadlines, both sides of each
│   ├── AccessControl.t.sol         # US4 — wrong-caller reverts, stranger successes
│   ├── Withdrawals.t.sol           # US4 — withdrawFor pays the payee, not the caller
│   └── StateMachine.t.sol          # US5 — no double-settle, wrong-state rejection
├── foundry.toml                    # already pinned; no change needed
├── remappings.txt                  # already maps @openzeppelin/ and forge-std/
└── lib/{forge-std,openzeppelin-contracts}
```

**Structure Decision**: Flat `test/` with a `helpers/` subdirectory, which is the
Foundry convention and what the Monad fork's own tooling assumes. Foundry compiles every
`.sol` under `test/` and discovers test functions in contracts whose files match
`*.t.sol`, so naming the mock and base contract without the `.t.sol` suffix keeps them
out of the run summary while still compiling.

**One file per protection group, not one giant file.** The spec's scope table is already
grouped by what each group protects, and `forge test --match-path` then maps one-to-one
onto those groups — useful when iterating on the tier splits alone. The cost is a shared
base contract, which is needed regardless because the solvency modifier and the fixtures
must be identical everywhere.

**`Withdrawals.t.sol` is split out of `AccessControl.t.sol`** despite both serving US4,
because `withdrawFor`'s payee behaviour exists in response to a real bug and deserves to
be findable by name rather than buried among role assertions.

## Complexity Tracking

> No Constitution Check violations. Nothing to justify.
