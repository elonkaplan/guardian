---

description: "Task list for the Guardian escrow contract"
---

# Tasks: Guardian Escrow Contract

**Input**: Design documents from `/specs/001-guardian-escrow-contract/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/](./contracts/)

**Tests**: **No test tasks.** The Foundry test suite is feature **SC-02**, a separate
spec that depends on this one, and the spec's Testing section says so explicitly. This
feature's acceptance gate is `forge build` plus the by-inspection checks in
[quickstart.md §4](./quickstart.md). Do not write tests here — write the contract so
SC-02 can.

**Organization**: Grouped by user story, in the order they must actually be built.

> ## Implementation status — 2026-08-08 · COMPLETE
>
> **45 of 45 tasks complete.** `src/GuardianEscrow.sol` builds under the **Monad Foundry
> fork** (`forge 1.7.1-monad-v1.0.0`, solc 0.8.24): *Compiler run successful*, zero
> errors. Runtime bytecode **7,519 bytes**, initcode **8,042** — nowhere near any limit.
>
> Conformance verified against [contracts/IGuardianEscrow.sol](./contracts/IGuardianEscrow.sol)
> via `forge inspect`: **13/13** entry points, **9/9** own events,
> `resolve(uint256, uint8, bytes32)`, `Deal` = 7 slots, `Agent` = 4 slots.
>
> **`evm_version = "shanghai"` was accepted without complaint** — the conservative pin
> from [research.md R-002](./research.md) cost nothing, as predicted.
>
> ### The four remaining warnings, and why they are benign (T045)
>
> `forge lint` reports `block-timestamp` on the four deadline comparisons — `release`
> (L275), `reclaim` (L285), `dispute` (L313), `forceResolve` (L340). These are **not**
> solc warnings; solc compiles clean. They are correct in the abstract and irrelevant
> here, for two independent reasons:
>
> 1. **Scale.** Validators have seconds of latitude over the reported timestamp. The
>    gated windows are 24h and 72h. The demo's review window should not go below ~30s
>    for exactly this reason, which [data-model.md §4](./data-model.md) already states.
> 2. **No exploitable outcome.** Shifting a deadline by seconds cannot change *what*
>    happens, only *when* it becomes possible — and every deadline transition leads to
>    the single outcome the rules already dictate, to addresses fixed at purchase. There
>    is nothing to gain by being a few seconds early or late.
>
> Suppressing them would mean annotating four lines to silence a lint that is telling
> the truth about a risk we have consciously accepted. Left visible on purpose.
>
> ### Still outstanding, by design
>
> Behavioural correctness — that the five tier splits produce the right numbers, that
> the timers admit and refuse on the correct side of each boundary, that
> `withdrawFor(x)` pays `x` when a stranger calls it — is **SC-02's** scope and is
> untested here. A clean build proves the contract is well-formed, not that money lands
> in the right place.

---

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1–US4)
- Paths are relative to `sc/`, the Foundry project root

---

## ⚠️ Read this before using the phase structure

**This feature is one file.** Every task from T008 onward edits
`src/GuardianEscrow.sol`. That has three consequences the standard phase template would
otherwise paper over:

1. **There is almost no parallelism.** `[P]` appears only in Phase 1, where tasks touch
   genuinely different files. Marking contract tasks `[P]` would be false — two agents
   editing the same Solidity file collide on every write. **Do not parallelise
   Phases 2–7.**

2. **Stories are not independently deployable.** They are independently *demonstrable* —
   after Phase 3 you can drive a full purchase-to-payout cycle; after Phase 4 you can
   also settle a dispute. But "deploy US2 without US1" is meaningless: the enum, the
   structs, and the ledger are shared by construction. The checkpoints below are honest
   about which capability exists at each stop.

3. **US4 is partially pulled forward.** `registerAgent` sits in Phase 2 (Foundational)
   even though its story is P2, because no deal can exist without a registered agent —
   US1 cannot be demonstrated otherwise. Phase 6 delivers the rest of the registry
   (`updateAgent`, `setAgentActive`). This is a genuine dependency, not a priority
   inversion.

Similarly, `release` is implemented in Phase 3 (US1 needs the window to lapse into
payment) even though its permissionlessness is a US3 property. Phase 5 verifies it
rather than re-implementing it.

---

## Phase 1: Setup (Build Configuration)

**Purpose**: A Foundry project that compiles nothing, correctly.

- [X] T001 Verify the **Monad Foundry fork** is installed by running `forge --version` in `sc/` and confirming it reports a Monad build — upstream Foundry mis-prices gas locally, and Monad charges the gas *limit* rather than the usage, so upstream numbers cannot be trusted. Stop and install the fork if it reports plain Foundry.
- [X] T002 Create `sc/foundry.toml` with `src`/`out`/`libs`, `solc = "0.8.24"` (exact pin, not a caret range, so bytecode is reproducible), `evm_version = "shanghai"`, `optimizer = true`, `optimizer_runs = 200`, and an `[rpc_endpoints]` entry `monad_testnet = "${MONAD_RPC_URL}"` — full contents in [research.md R-008](./research.md). **The `evm_version` line is the one that is easy to drop and expensive to lose**; without it solc 0.8.24 targets Cancun and may emit opcodes that deploy fine and revert at runtime ([research.md R-002](./research.md)).
- [X] T003 [P] Install OpenZeppelin Contracts **v5.x** as a git submodule into `sc/lib/openzeppelin-contracts` (`forge install OpenZeppelin/openzeppelin-contracts@v5.1.0 --no-commit`) — v5 is required because the constructor uses `_grantRole`, which v4's `_setupRole` idiom would silently invite instead ([research.md R-001](./research.md))
- [X] T004 [P] Install `forge-std` as a git submodule into `sc/lib/forge-std` — not used by this feature, but needed by SC-02 and SC-03, and installing it now avoids a second submodule commit
- [X] T005 Create `sc/remappings.txt` mapping `@openzeppelin/contracts/=lib/openzeppelin-contracts/contracts/` and `forge-std/=lib/forge-std/src/` (depends on T003, T004)
- [X] T006 [P] Create `sc/.gitignore` covering `out/`, `cache/`, `broadcast/`, and `.env` — `lib/` is **not** ignored, it is submodules
- [X] T007 Run `forge build` in `sc/` on the still-empty `src/` and confirm it succeeds, proving the toolchain and remappings resolve before any Solidity exists to blame

**Checkpoint**: Foundry compiles an empty project. Any failure from here is your code, not your setup.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The contract skeleton — types, storage, roles, events — plus the one
registry function without which no deal can exist.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [X] T008 Create `sc/src/GuardianEscrow.sol` with the MIT SPDX header, `pragma solidity 0.8.24;` (exact, matching the `foundry.toml` pin), imports of `IERC20`, `SafeERC20`, and `AccessControl` from `@openzeppelin/contracts/`, the `contract GuardianEscrow is AccessControl` declaration, and `using SafeERC20 for IERC20;`
- [X] T009 Declare the `DealState` and `Tier` enums in `sc/src/GuardianEscrow.sol` per [data-model.md §1](./data-model.md) — **member order is load-bearing**: `None` must be 0 so an unset id reads as "does not exist" without a separate check, and `NoRefund` must be 0 so a zero-value tier is the safe one
- [X] T010 Declare the `Agent` and `Deal` structs in `sc/src/GuardianEscrow.sol` in **exactly** the field order given in [data-model.md §2](./data-model.md) — do not reorder to save a storage slot; the divergence from the spec costs more than the SSTORE saves ([research.md R-005](./research.md))
- [X] T011 Declare the constants in `sc/src/GuardianEscrow.sol`: `OPERATOR_ROLE` and `GUARDIAN_ROLE` as `keccak256(...)` of their own names, and `DELIVERY_DEADLINE = 24 hours` / `DISPUTE_DEADLINE = 72 hours` as `uint32 public constant`
- [X] T012 Declare storage in `sc/src/GuardianEscrow.sol`: `IERC20 public immutable token`, the `agents` / `deals` / `balances` mappings, `uint256 public totalEscrowed`, and both id counters **initialised to 1** — initialising to 0 makes id 0 a real record and breaks every existence check in the contract
- [X] T013 Declare all **nine** events in `sc/src/GuardianEscrow.sol` with the exact names, parameter types, and `indexed` positions from [contracts/IGuardianEscrow.sol](./contracts/IGuardianEscrow.sol) — the API's log decoding is generated from these
- [X] T014 Implement `constructor(IERC20 _token, address admin, address operator, address guardian)` in `sc/src/GuardianEscrow.sol`, setting the immutable token and granting all three roles with **`_grantRole`** — `_setupRole` does not exist in OpenZeppelin v5 and is the most likely copy-paste failure here
- [X] T015 Implement `registerAgent(address owner, uint256 price, bytes32 defHash)` in `sc/src/GuardianEscrow.sol` — `onlyRole(OPERATOR_ROLE)`, reverts `"bad owner"` on the zero address, assigns the next id with `version = 1` and `active = true`, returns the id, emits `AgentRegistered`. Pulled forward from US4 because US1 cannot be demonstrated without it.
- [X] T016 Run `forge build` in `sc/` and confirm `sc/src/GuardianEscrow.sol` compiles with zero errors

**Checkpoint**: The contract exists, holds no logic, and an agent can be registered. User story work can begin.

---

## Phase 3: User Story 1 - Buyer pays, seller gets paid (Priority: P1) 🎯 MVP

**Goal**: The happy path end to end — capture payment into escrow, deliver, settle to
the seller by either acceptance or a lapsed window, and let the money out.

**Independent Test**: Register an agent, open a deal, mark it delivered, then settle it
both ways on two separate deals (buyer accepts early; the window lapses and a third
party settles). In both cases the seller's `balances` entry equals the full amount,
`totalEscrowed` returns to its prior value, and the seller can withdraw.

### Implementation for User Story 1

- [X] T017 [US1] Implement `openDeal(uint256 agentId, address buyer, uint32 reviewWindow)` in `sc/src/GuardianEscrow.sol` — `onlyRole(OPERATOR_ROLE)`; reverts `"agent inactive"` and `"bad buyer"`; calls `token.safeTransferFrom(msg.sender, address(this), a.price)` pulling from **the operator, not the buyer**; increments `totalEscrowed`; writes the `Deal` **snapshotting** `seller` from `a.owner`, `amount` from `a.price`, and pinning `defHash`/`defVersion`; sets `openedAt` and state `Open`; returns the id; emits `DealOpened`. Do **not** bounds-check `reviewWindow` — that is an accepted MVP risk guarded backend-side.
- [X] T018 [US1] Implement `markDelivered(uint256 dealId)` in `sc/src/GuardianEscrow.sol` — `onlyRole(OPERATOR_ROLE)`, requires state `Open` else `"not open"`, sets state `Delivered` and `deliveredAt = block.timestamp` (which starts the review window), emits `Delivered`
- [X] T019 [US1] Implement the private helper `_payout(uint256 dealId, Deal storage d)` in `sc/src/GuardianEscrow.sol` — sets state `Settled` **before** crediting, decrements `totalEscrowed`, credits `balances[d.seller]` the full amount, emits `Released`. **Moves no tokens.** Shared by `accept` and `release` so the two full-payout paths cannot drift.
- [X] T020 [US1] Implement `accept(uint256 dealId)` in `sc/src/GuardianEscrow.sol` — requires state `Delivered` else `"not delivered"`, requires `msg.sender == d.buyer || hasRole(OPERATOR_ROLE, msg.sender)` else `"not buyer"`, delegates to `_payout`. Deliberately **not** window-gated: accepting only ever does what the lapse would have done.
- [X] T021 [US1] Implement `release(uint256 dealId)` in `sc/src/GuardianEscrow.sol` — **no role modifier**, requires state `Delivered` else `"not delivered"` and `block.timestamp >= d.deliveredAt + d.reviewWindow` else `"window open"`, delegates to `_payout`
- [X] T022 [US1] Implement `withdrawFor(address account)` in `sc/src/GuardianEscrow.sol` as **`public`** (not `external` — `withdraw()` must call it internally): reverts `"nothing to withdraw"` on a zero balance, zeroes `balances[account]` **before** `token.safeTransfer(account, amount)`, emits `Withdrawn`. **The payee is `account`, never `msg.sender`.** This is the only function in the contract that moves tokens out.
- [X] T023 [US1] Implement `withdraw()` in `sc/src/GuardianEscrow.sol` as an `external` function whose **entire body** is `withdrawFor(msg.sender);` — do not duplicate the logic. A second copy is exactly how the every-payout-goes-to-the-operator bug gets reintroduced.
- [X] T024 [US1] Verify by inspection in `sc/src/GuardianEscrow.sol` that the file contains **exactly one** `safeTransferFrom` (in `openDeal`) and **exactly one** `safeTransfer` (in `withdrawFor`), and that neither `_payout` nor any settlement path moves tokens — this is the property that makes settlement reentrancy-free without a guard
- [X] T025 [US1] Run `forge build` and `forge inspect GuardianEscrow abi` in `sc/` against `sc/src/GuardianEscrow.sol`, and confirm `withdrawFor(address)` is present and `withdraw()` takes no arguments

**Checkpoint**: A full purchase-to-payout cycle is expressible. This is the MVP — stop here and validate before continuing.

---

## Phase 4: User Story 2 - Buyer complains and Guardian rules (Priority: P1)

**Goal**: The dispute path — freeze on complaint, then split the escrow across the five
tiers on the arbitrator's ruling.

**Independent Test**: Open and deliver a deal, complain within the window, then rule at
each of the five tiers on separate deals. Verify each split, and that the two credited
amounts sum to exactly the escrowed amount every time.

### Implementation for User Story 2

- [X] T026 [US2] Implement the private pure helper `_refundBps(Tier t)` in `sc/src/GuardianEscrow.sol` returning 0 / 2500 / 5000 / 7500 / 10000 for `NoRefund` / `Quarter` / `Half` / `ThreeQuarter` / `Full`. **This is the highest-risk function in the contract** — an off-by-one here is invisible until a live demo and is the exact number the audience is watching.
- [X] T027 [US2] Implement `dispute(uint256 dealId)` in `sc/src/GuardianEscrow.sol` — requires state `Delivered` else `"not delivered"`, requires buyer-or-operator else `"not buyer"`, requires `block.timestamp < d.deliveredAt + d.reviewWindow` else `"window closed"` (**strict `<`**, complementary to `release`'s `>=` so there is no instant where both or neither is available), sets state `Disputed` and `disputedAt`, emits `Disputed`. **Moves no value** — the funds are already escrowed.
- [X] T028 [US2] Implement the private helper `_settleDispute(uint256 dealId, Tier tier, bytes32 verdictHash)` in `sc/src/GuardianEscrow.sol` — re-asserts state `Disputed` else `"not disputed"`, computes `toBuyer = d.amount * _refundBps(tier) / 10_000` and `toSeller = d.amount - toBuyer` (**derived by subtraction, never computed independently** — this is what makes the two sum to `amount` structurally rather than arithmetically), sets `Settled`, decrements `totalEscrowed`, credits both balances skipping zero-value writes, emits `Resolved`
- [X] T029 [US2] Implement `resolve(uint256 dealId, Tier tier, bytes32 verdictHash)` in `sc/src/GuardianEscrow.sol` — `onlyRole(GUARDIAN_ROLE)`, delegates to `_settleDispute`. The signature takes a **`Tier`, never an amount and never an address**: that is what caps a fully compromised arbitrator key at "wrong verdict" rather than "drained contract".
- [X] T030 [US2] Run `forge build` in `sc/`, then verify by inspection of `sc/src/GuardianEscrow.sol` that `resolve`'s ABI signature is `(uint256, uint8, bytes32)` with no amount or recipient parameter, and that `toSeller` appears in the source only as a subtraction

**Checkpoint**: A dispute can be raised and ruled on at all five tiers. Combined with Phase 3, both demo acts are expressible.

---

## Phase 5: User Story 3 - Nobody can be stranded by a silent platform (Priority: P1)

**Goal**: Close the two remaining escape hatches, so every state has an exit that does
not require the platform's cooperation.

**Independent Test**: For each of the three timed exits, advance past the deadline and
trigger it from an address holding no role at all. Funds land with the party the rules
dictate. `release` was already built in Phase 3 — verify it here rather than rebuild it.

### Implementation for User Story 3

- [X] T031 [US3] Implement `reclaim(uint256 dealId)` in `sc/src/GuardianEscrow.sol` — **no role modifier**, requires state `Open` else `"not open"` and `block.timestamp >= d.openedAt + DELIVERY_DEADLINE` else `"too early"`, sets `Settled`, decrements `totalEscrowed`, credits the **full amount to the buyer**, emits `Reclaimed`
- [X] T032 [US3] Implement `forceResolve(uint256 dealId)` in `sc/src/GuardianEscrow.sol` — **no role modifier**, requires state `Disputed` else `"not disputed"` and `block.timestamp >= d.disputedAt + DISPUTE_DEADLINE` else `"too early"`, delegates to `_settleDispute(dealId, Tier.Quarter, bytes32(0))`. Without this, a lost arbitrator key freezes disputed funds **forever** — this was the one state in the original design with no exit. The 25% default is not arbitrary: the product's inconclusive-evidence rule already resolves there, and a timeout is the ultimate unproven case.
- [X] T033 [US3] Verify by inspection in `sc/src/GuardianEscrow.sol` that **none** of `release`, `reclaim`, or `forceResolve` carries an `onlyRole` modifier or any `msg.sender` check — a role modifier on any of the three converts escrow into custody
- [X] T034 [US3] Verify by inspection of `sc/src/GuardianEscrow.sol` that `totalEscrowed` is modified on exactly **four** lines: one `+=` in `openDeal`, and one `-=` in each of `_payout`, `reclaim`, and `_settleDispute` — three helpers covering the four settlement paths
- [X] T035 [US3] Run `forge build` in `sc/` and confirm `sc/src/GuardianEscrow.sol` compiles with zero errors

**Checkpoint**: Every deal state has a permissionless exit. The escrow-not-custody property holds.

---

## Phase 6: User Story 4 - Operator manages the agent registry (Priority: P2)

**Goal**: The rest of the registry — repricing, redefinition with a version bump, and
delisting.

**Independent Test**: Register an agent, open a deal against it, then update its price
and definition hash. The version increments, and the already-open deal still carries the
old pinned hash, version, amount, and seller. Delist it and confirm new deals are
rejected while the running deal is unaffected.

### Implementation for User Story 4

- [X] T036 [US4] Implement `updateAgent(uint256 agentId, uint256 price, bytes32 defHash)` in `sc/src/GuardianEscrow.sol` — `onlyRole(OPERATOR_ROLE)`, requires `a.owner != address(0)` else `"no agent"`, replaces `price` and `defHash`, **increments `version`**, emits `AgentUpdated`
- [X] T037 [US4] Implement `setAgentActive(uint256 agentId, bool active)` in `sc/src/GuardianEscrow.sol` — `onlyRole(OPERATOR_ROLE)`, requires the agent to exist else `"no agent"`, toggles `active`. **Emits no event** — that matches the source design's nine-event list; the frontend learns about delisting from the API, not from a log.
- [X] T038 [US4] Verify by inspection in `sc/src/GuardianEscrow.sol` that `agents[` appears **nowhere** in any settlement path — every payout reads `seller` and `amount` from the `Deal`, never from the registry. A lookup at payout time would let a mid-deal ownership transfer redirect money for work the previous owner performed.
- [X] T039 [US4] Run `forge build` in `sc/` and confirm `sc/src/GuardianEscrow.sol` compiles with zero errors

**Checkpoint**: All 13 entry points implemented. The contract is feature-complete.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Confirm the built artifact matches the design contract, and leave it
readable for SC-02 and SC-03.

- [X] T040 Add NatSpec (`@title`, `@notice`, `@dev`) to `sc/src/GuardianEscrow.sol`, porting the rationale comments from [contracts/IGuardianEscrow.sol](./contracts/IGuardianEscrow.sol) — especially the three that explain a decision a future reader would otherwise "fix": why `withdrawFor` exists, why three functions are permissionless, and why `seller` is a snapshot
- [X] T041 Run `forge inspect GuardianEscrow storageLayout` in `sc/` against `sc/src/GuardianEscrow.sol` and confirm `Deal` occupies **7 slots** and `Agent` **4** per [data-model.md §2](./data-model.md) — a different count means the field order drifted from the spec
- [X] T042 Run `forge inspect GuardianEscrow abi` in `sc/` and diff the full surface of `sc/src/GuardianEscrow.sol` against [contracts/IGuardianEscrow.sol](./contracts/IGuardianEscrow.sol): **13 external entry points, 9 events**, and the public getters. Any mismatch is a breaking change to the API's chain adapter and to SC-02.
- [X] T043 Work through all nine by-inspection checks in [quickstart.md §4](./quickstart.md) against `sc/src/GuardianEscrow.sol` as a single pass, confirming each maps to its stated requirement — several were checked in isolation above, but the point is that they still hold together
- [X] T044 Confirm the exact revert strings in `sc/src/GuardianEscrow.sol` match [contracts/access-control.md §3](./contracts/access-control.md) character for character — SC-02's `vm.expectRevert` assertions and SC-03's runbook debugging are both written against these
- [X] T045 Run a final `forge build` in `sc/` and resolve every warning in `sc/src/GuardianEscrow.sol`, or record why each remaining one is benign — unused parameters and unreachable code are always bugs at this size

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: No dependencies — start immediately
- **Phase 2 (Foundational)**: Depends on Phase 1 — **blocks every user story**
- **Phase 3 (US1)**: Depends on Phase 2
- **Phase 4 (US2)**: Depends on Phase 2. Shares `_settleDispute` with Phase 5 but is otherwise independent of Phase 3.
- **Phase 5 (US3)**: Depends on Phase 2, and on **T028** (`_settleDispute`, built in Phase 4) for `forceResolve`. `reclaim` needs neither.
- **Phase 6 (US4)**: Depends on Phase 2 only
- **Phase 7 (Polish)**: Depends on Phases 3–6

### The one cross-story dependency

`forceResolve` (T032, US3) calls `_settleDispute` (T028, US2). Either build Phase 4
first, or build Phase 5's `reclaim` alone and defer `forceResolve` until after T028.
Everything else respects story boundaries.

### Within each phase

Tasks are listed in execution order and **must be done in that order** — they edit the
same file, and later tasks reference symbols earlier ones declare. Helpers (`_payout`,
`_settleDispute`, `_refundBps`) come before the public functions that call them.

### Parallel Opportunities

- **T003, T004, T006** genuinely parallelise — three different files, no shared state
- **Nothing else does.** T008 onward all edit `src/GuardianEscrow.sol`. Two agents
  working that file in parallel will clobber each other. This is not a limitation to
  work around; it is what a single 250-line contract looks like.

---

## Parallel Example: Phase 1 only

```bash
# The only three tasks in this feature that can run concurrently:
Task: "Install OpenZeppelin v5.x into sc/lib/openzeppelin-contracts"   # T003
Task: "Install forge-std into sc/lib/forge-std"                        # T004
Task: "Create sc/.gitignore"                                           # T006

# Then, sequentially: T005 (remappings, needs both submodules), T007 (build check)
```

---

## Implementation Strategy

### MVP First (Phases 1–3)

1. Phase 1: Setup — toolchain, dependencies, build config
2. Phase 2: Foundational — types, storage, roles, events, `registerAgent`
3. Phase 3: US1 — the happy path
4. **STOP and VALIDATE**: `forge build`, then walk the story's Independent Test by
   reading the code. Escrow captures, settlement credits, withdrawal pays the right
   address.

That is a coherent stopping point: money can go in, come out, and reach the right
party. It is not yet *Guardian* — there is no dispute path — but it is a working escrow.

### Incremental Delivery

1. Phases 1–2 → the contract compiles and an agent exists
2. Phase 3 → **purchase-to-payout works** (MVP)
3. Phase 4 → dispute and tiered settlement work — this is the product's actual pitch
4. Phase 5 → the platform can no longer strand anyone's funds
5. Phase 6 → the registry is fully manageable
6. Phase 7 → the artifact provably matches the design contract

**Phases 3 and 4 together are the demo.** Phase 5 is what makes the demo's central
claim true rather than merely asserted — cut it last, if anything gets cut.

### Team Strategy

One person. The parallel-team pattern in the template does not apply to a single
Solidity file — splitting it across developers costs more in merge conflicts than it
saves. If a second person is available, point them at **SC-02** (the test suite), which
can be written against [contracts/IGuardianEscrow.sol](./contracts/IGuardianEscrow.sol)
and [contracts/access-control.md](./contracts/access-control.md) **before** the
implementation exists — that is real parallelism, across features rather than within
this one.

---

## Notes

- `[P]` = different files, no dependencies. It appears three times in this file, all in
  Phase 1, and that is correct.
- Commit after each phase checkpoint, not after each task — intermediate states of a
  single contract file rarely compile.
- **Do not write tests here.** SC-02 owns them, and it depends on the revert strings and
  ABI this feature freezes.
- The revert strings, event signatures, and field order are **interfaces**, not style
  choices. Two downstream features are written against them.
