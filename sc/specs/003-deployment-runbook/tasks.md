---
description: "Task list for 003-deployment-runbook"
---

# Tasks: Deployment Runbook

**Input**: Design documents from `/specs/003-deployment-runbook/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md)

**Tests**: No automated test tasks. The spec requests none, and this feature ships no
testable unit — its verification is [quickstart.md](./quickstart.md)'s three gates, which
appear below as explicit execution tasks rather than as a test suite.

**Organization**: Grouped by user story so each is independently completable and testable.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1–US4)
- Include exact file paths in descriptions

## Path Conventions

Foundry project root is `sc/`. Paths below are repository-relative from
`rain-hackathon/guardian/`. This feature creates exactly **two** files:
`sc/script/Deploy.s.sol` and `sc/README.md`.

> **A note on parallelism.** With only two deliverable files, most tasks in the same phase
> edit the same file and are therefore **not** parallel. `[P]` is used only where files are
> genuinely disjoint. The real concurrency here is the **two-track structure** — the script
> track and the README track never touch each other — described under
> [Parallel Opportunities](#parallel-opportunities).

---

## Phase 1: Setup

**Purpose**: Toolchain confirmation and empty scaffolds. The external lookup that used to
live here (T004) is already resolved.

- [x] T001 Confirm the active toolchain is the Monad fork before writing `sc/script/Deploy.s.sol`: `forge --version` must contain `-monad-` (expected `1.7.1-monad-v1.0.0`), and `~/.foundry/bin` must be on `PATH`. Rationale and the upstream-collision trap in [research.md R1](./research.md#r1--toolchain-the-monad-fork-and-how-to-prove-you-have-it), R14.
- [x] T002 [P] Create `sc/script/Deploy.s.sol` skeleton: SPDX header, `pragma solidity ^0.8.24`, imports for `Script`/`console2` (forge-std), `IERC20` (OpenZeppelin), `GuardianEscrow` (`../src/GuardianEscrow.sol`), and an empty `contract Deploy is Script { function run() external {} }`. Confirm `forge build` succeeds.
- [x] T003 [P] Create `sc/README.md` skeleton with the six numbered step headings plus a Troubleshooting heading, exactly as fixed in [contracts/runbook-outline.md §1](./contracts/runbook-outline.md). Headings only — content arrives per story.
- [x] T004 ✅ **DONE** — Resolved to **two** faucets: MON from `https://faucet.monad.xyz/`, test USDC from `https://faucet.circle.com/` (recommended by Monad's hackathon documentation, and consistent with R7's finding that the token is a Circle FiatToken). Recorded in [research.md R13](./research.md#r13--resolved-two-faucets-one-per-asset); confirmed by a completed funding run, not assumed. This was the only task with external lead time; T022, T027, T028 and T029 are no longer gated.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The two things every story needs — real configuration values to validate
against, and the input-reading block the whole script is built on.

**Status**: T005 is already done, so the only remaining item here is T006 — which nothing
in the script track can be built without.

- [x] T005 ✅ **DONE** — Four keypairs generated and the eight wallet keys populated in `guardian/.env`. Verified 2026-08-08: no `0xDEAD` placeholders remain in any wallet slot, all four addresses distinct, all four private keys `0x`-prefixed (required by `vm.envUint`), and each of `FUNDER_ADDRESS`/`OPERATOR_ADDRESS`/`GUARDIAN_ADDRESS` derives from its paired private key. `ESCROW_CONTRACT_ADDRESS` correctly left at its placeholder — that is T028's output.
- [x] T006 Implement the input-reading block in `sc/script/Deploy.s.sol`: read all four inputs via `vm.envOr` with zero sentinels (`uint256(0)` for the key, `address(0)` for the three addresses). **Do not use `vm.envUint`/`vm.envAddress`** — they abort on the first failure and cannot satisfy FR-004 ([research.md R4](./research.md#r4--naming-every-bad-configuration-value-not-just-the-first)). Types and sentinels in [contracts/deploy-script.md §2](./contracts/deploy-script.md#2-inputs).

**Checkpoint**: Configuration is real, inputs are readable — both tracks can now proceed.

---

## Phase 3: User Story 1 — A cold reader reaches a live settlement contract (Priority: P1) 🎯 MVP

**Goal**: `Deploy.s.sol` validates its four inputs, refuses bad ones by name, and deploys
`GuardianEscrow` with both roles wired — plus the README steps that get a cold reader to
the point of running it.

**Independent Test**: quickstart Gate 1.2–1.6 (T015). Entirely local, costs no MON, and
proves every validation path. The live deploy is deferred to T028 because it depends on
funding, which belongs to US4.

### Script track — `sc/script/Deploy.s.sol`

- [x] T007 [US1] Implement validation V1 in `sc/script/Deploy.s.sol`: collect every input that came back as its sentinel and revert **once** with a message naming all of them (e.g. `missing or malformed: USDC_ADDRESS, GUARDIAN_ADDRESS`). Message says "missing or malformed" because `vm.envOr` cannot distinguish the two. Rules in [data-model.md §1](./data-model.md#validation-rules).
- [x] T008 [US1] Add V1b to `sc/script/Deploy.s.sol`: when `DEPLOYER_PRIVATE_KEY` fails V1, append an explicit `0x`-prefix hint. Needed because `cast --private-key` accepts bare hex while `vm.envUint` does not — a reader who verifies their key with `cast` will otherwise conclude the script is broken ([research.md R5](./research.md#r5--the-0x-prefix-asymmetry-between-forge-and-cast)).
- [x] T009 [US1] Add V2 to `sc/script/Deploy.s.sol`: reject any of the three addresses whose leading bytes are `0xDEAD`, naming each offender. These are `.env.example`'s format-valid placeholders — they pass V1 by construction, and deploying against one grants a role to an unheld address, unrecoverable without redeploy ([research.md R6](./research.md#r6--rejecting-the-shipped-placeholder-values); scope note in [plan.md Complexity Tracking](./plan.md#complexity-tracking)).
- [x] T010 [US1] Add V3 to `sc/script/Deploy.s.sol`: reject `OPERATOR_ADDRESS == GUARDIAN_ADDRESS`, naming both keys. Guards the two-role separation that is the contract's central security property.
- [x] T011 [US1] Implement the broadcast in `sc/script/Deploy.s.sol`: `vm.startBroadcast(pk)` → `new GuardianEscrow(IERC20(token), vm.addr(pk), operator, guardian)` → `vm.stopBroadcast()`. All validation must precede `startBroadcast`. Role mapping in [contracts/deploy-script.md §3](./contracts/deploy-script.md#3-behaviour).

### README track — `sc/README.md`

- [x] T012 [US1] Write step 0 of `sc/README.md` — prerequisites and what the reader ends up with. Must not send the reader to another document to proceed (FR-007, SC-010).
- [x] T013 [US1] Write step 1 of `sc/README.md` — install the Monad fork stated as a _difference_ from upstream, the `export PATH="$HOME/.foundry/bin:$PATH"` line, the new-terminal note, and the `forge --version` check showing expected output. Content list in [contracts/runbook-outline.md §2](./contracts/runbook-outline.md#step-1--toolchain).
- [x] T014 [US1] Write step 3 of `sc/README.md` — `set -a; . ../.env; set +a` **inside the command block**, then the `forge script` invocation. Include the single-shell-session note and the charge-the-limit gas note (2,406,060 gas ≈ 0.26 MON at ~108 gwei; the fork submits an unpadded limit, upstream Foundry would pad 130%) placed beside the cost figure, not in an appendix (FR-012). Export rationale in [research.md R2](./research.md#r2--the-repository-root-env-is-not-visible-to-forge-the-blocking-one).

### Validation

- [x] T015 [US1] Execute [quickstart.md](./quickstart.md) Gate 1.2 through 1.6 against `sc/script/Deploy.s.sol`. All five must fail exactly as specified: export-skipped names all four keys; two blanked keys produce **one** message naming **both**; each of the four keys blanked in turn is named (SC-008); bare-hex key mentions the `0x` prefix; `0xDEAD000000000000000000000000000000004444` is named as a placeholder (note: exactly 40 hex characters — a 42-character literal is not an address and trips V1 as malformed instead of V2 as a placeholder, testing the wrong guard); operator-equals-guardian names both. Every run without `--broadcast`, so nothing reaches the network.

**Checkpoint**: The deploy script is correct and refuses every bad input by name. US1 complete.

---

## Phase 4: User Story 2 — The deployed address is handed back ready to paste (Priority: P2)

**Goal**: The address leaves the deployment as a byte-exact `.env` line and lands in
`guardian/.env` with nothing retyped.

**Independent Test**: T018 — a `grep -qE` against the script's own output. Runs on a dry
run, no network, no MON.

- [x] T016 [US2] Add the output line to `sc/script/Deploy.s.sol`: `console2.log(string.concat("ESCROW_CONTRACT_ADDRESS=", vm.toString(address(escrow))))`. **Not** the comma form `console2.log("KEY=", addr)` — `console2.log` joins arguments with a space and emits `KEY= 0x…`, which is not the `.env` format and defeats the entire story ([research.md R3](./research.md#r3--printing-the-address-so-it-is-genuinely-paste-safe)). Key name must match `.env.example` exactly; `api/` reads that spelling.
- [x] T017 [US2] Write step 4 of `sc/README.md` — paste the line into the **repository-root** `guardian/.env`, replacing the existing `ESCROW_CONTRACT_ADDRESS=` entry. Show the expected output verbatim (including forge's two-space log indent) so there is no ambiguity about what to select. Verification: `grep ESCROW_CONTRACT_ADDRESS ../.env` shows a non-empty, non-placeholder value.
- [x] T018 [US2] Execute [quickstart.md](./quickstart.md) Gate 1.7 against `sc/script/Deploy.s.sol`: `forge script … | grep -qE '^\s*ESCROW_CONTRACT_ADDRESS=0x[0-9a-fA-F]{40}$'` must report paste-safe. A space after `=` fails the check and means T016 used the wrong form.

**Checkpoint**: US1 and US2 both complete and independently verified, still with zero MON spent.

---

## Phase 5: User Story 3 — The operator is authorised to spend before the first purchase (Priority: P3)

**Goal**: The approval is a numbered step of equal weight to the deploy, states which
wallet signs, and is verified by reading the allowance rather than by the absence of an
error.

**Independent Test**: Against any deployed contract, follow step 5 and read
`allowance(operator, escrow)` — non-zero. Skip it and the first `openDeal` reverts.
README-only; no script changes.

- [x] T019 [US3] Write step 5 of `sc/README.md` — the approval, as a **numbered step in the main sequence with the same visual weight as step 3**, never a footnote (FR-010). Must state: signed by the **operator** wallet (signing as deployer succeeds and does nothing); amount `$(cast max-uint)` so it never needs re-granting mid-session (FR-011); re-export needed because the pasted address is not yet in the shell. Verification is the `allowance(address,address)` read from [quickstart.md](./quickstart.md) Gate 2 step 5 — **not** the absence of an error, since a wrongly-signed approval also succeeds. Requirement: `openDeal` calls `token.safeTransferFrom(msg.sender, …)` at `sc/src/GuardianEscrow.sol:229`.
- [x] T020 [US3] Add the redeploy-consequences note to `sc/README.md` immediately after step 5: re-running the deploy produces a new, separate contract; the old address is stale everywhere it was recorded; funds held by the old contract stay there; **steps 4 and 5 must both be repeated**, because the allowance names the old contract address ([research.md R11](./research.md#r11--redeploy-semantics)).

**Checkpoint**: The step that bites is impossible to walk past. US1–US3 complete.

---

## Phase 6: User Story 4 — Every wallet the running system needs is funded before it is needed (Priority: P4)

**Goal**: The funding table appears _before_ the deploy step, lists all four wallets with
their asset, minimum and failure timing, and names where each asset comes from.

**Independent Test**: Read step 2 — 4 of 4 wallets present, each with asset and failure
mode, funder shown as the only one needing two assets, guardian shown as failing only at
the first dispute (SC-005).

- [x] T021 [US4] Write step 2 of `sc/README.md` — copy `.env.example` → `.env` at the **repository root** (not in `sc/`); private keys take the `0x` prefix; the placeholder warning that shipped `0xDEAD…` values are format-valid and pass every check, with `grep -n 'TODO(placeholder)' .env` to list them (FR-015); the deployer key is single-use and discardable (FR-016); and the four-wallet funding table reproduced from [data-model.md §3](./data-model.md#3-wallet-roster) — deployer 1 MON, funder 5 MON + test USDC, operator 5 MON, guardian 1 MON, each with its failure timing. The guardian row must say its failure is deferred to the first dispute.
- [x] T022 [US4] Add both faucet sources to step 2 of `sc/README.md` (FR-017): MON from `https://faucet.monad.xyz/` for all four wallets, test USDC from `https://faucet.circle.com/` for the **funder only**. Present the USDC trip as its own action rather than a note on the funder row — two domains means a reader can finish the MON round for four wallets, feel done, and never visit the second faucet, which is precisely the half-funded funder US4 exists to prevent. Ship no other faucet URLs.

**Checkpoint**: All four user stories complete. The README is written; nothing has been deployed.

---

## Phase 7: Polish, Corrections & Live Validation

**Purpose**: The cross-cutting README content, the upstream design-doc corrections Phase 0
surfaced, and the two validation gates that need real money and a real reader.

### README completion

- [x] T023 Write step 6 of `sc/README.md` — prove it works: one purchase end to end (SC-003), and what a missing approval looks like when it fails so the reader can recognise it.
- [x] T024 Add the Troubleshooting section to `sc/README.md` with at minimum the four entries in [contracts/runbook-outline.md §3](./contracts/runbook-outline.md#troubleshooting-entries-minimum-set): `missing hex prefix ("0x")` → bare-hex key; `environment variable … not found` with `.env` filled in → export skipped or new terminal; deploy succeeded but first purchase reverts → approval skipped, wrongly signed, or invalidated by redeploy; first verdict fails while everything else works → guardian wallet unfunded.

### Upstream corrections (different files — genuinely parallel)

- [x] T025 [P] Update `guardian/.env.example` to state that private keys are stored **with** the `0x` prefix, on or beside the `DEPLOYER_PRIVATE_KEY`, `OPERATOR_PRIVATE_KEY`, `FUNDER_PRIVATE_KEY` and `GUARDIAN_PRIVATE_KEY` lines ([research.md R5](./research.md#r5--the-0x-prefix-asymmetry-between-forge-and-cast)).
- [x] T026 [P] Correct `guardian/docs/project-structure.md` §4.2 and §4.3 against Phase 0's measurements: the `console2.log` comma form emits `KEY= 0x…` and must be `string.concat` (R3); the runbook is missing the env-export step, without which `forge` sees none of the configuration from `sc/` (R2); direct `vm.envAddress` cannot name more than one bad value (R4). Summary table at the end of [research.md](./research.md#summary-of-what-changed-against-the-existing-design-docs).

### Live validation

- [x] T027 ✅ **DONE** — Four wallets funded (MON from `faucet.monad.xyz`, USDC from `faucet.circle.com`) and verified on-chain 2026-08-08: 5 MON in each of deployer / funder / operator / guardian (against minimums of 1 / 5 / 5 / 1), plus 20 test USDC in the funder. The operator's 0 USDC is correct and must not be "fixed" — the funder is the only source of money, and USDC reaches the operator pool at runtime via user top-ups (`docs/rain-integration.md` §0.2), which is what `openDeal` pulls into escrow.
- [x] T028 Execute [quickstart.md](./quickstart.md) Gate 2 — the live deploy: `forge script … --rpc-url "$MONAD_RPC_URL" --broadcast`; paste the printed line into `guardian/.env`; re-export; confirm `hasRole(OPERATOR_ROLE, $OPERATOR_ADDRESS)` and `hasRole(GUARDIAN_ROLE, $GUARDIAN_ADDRESS)` are both `true`; run the operator-signed approval; read back a non-zero allowance. Also compare `gas used` against `total paid` in forge's summary to confirm the charge-the-limit note in T014 matches reality. Costs ≈0.4 MON. Depends on T027.
- [x] T029 Execute [quickstart.md](./quickstart.md) Gate 3 — hand `sc/README.md` to someone who has not seen the project, on a clean machine, with no other document and no questions, and check SC-001 (working deployment under 45 min), SC-002 (zero characters retyped), SC-003, SC-004, SC-005, SC-006 (approval step found in under 10 s), SC-007. If no cold reader is available, the honest substitute is a fresh terminal with no exported configuration, executing only what is written and adding nothing from memory — that catches R2 and R14, the two failures a familiar reader silently compensates for.
- [x] T030 Verify `sc/README.md` against the prohibitions in [contracts/runbook-outline.md §4](./contracts/runbook-outline.md#4-prohibitions): `grep -n 'docs/' sc/README.md` returns no link that is load-bearing for proceeding (SC-010); every instruction is numbered; no guessed faucet URL; and no live private key, wallet address or deployed address appears in the committed file — `$VAR` references and placeholders only.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: No dependencies. T004 done; T002/T003 are scaffolds.
- **Phase 2 (Foundational)**: T005 done. T006 needs T002, and blocks the whole script track.
- **Phase 3–6 (User Stories)**: All depend on Phase 2. Script-track work depends on T006; README-track work depends only on T003.
- **Phase 7 (Polish & Validation)**: T025/T026 depend on nothing but Phase 0's findings and can run any time. T027 is done, so the remaining chain is T028 → T029, which must come last and needs explicit sign-off (T028 spends MON; T029 needs a person).

### User Story Dependencies

- **US1 (P1)**: After Phase 2. No dependency on other stories.
- **US2 (P2)**: After Phase 2. Touches the same two files as US1 but no logical dependency — T016 appends a log line, T017 fills an empty section.
- **US3 (P3)**: After Phase 2. README-only; fully independent.
- **US4 (P4)**: After Phase 2. Fully unblocked — T022's faucet link is settled.

**One honest wrinkle in story independence**: US1's _live_ proof (T028) needs funded
wallets, which is US4's subject matter. That is why US1's independent test is Gate 1
(local, unfunded) and the live deploy lives in Phase 7 — so US1 stays verifiable on its own
without inverting the priority order.

### Within Each Story

- Validation before broadcast, always — V1→V2→V3 must all precede `vm.startBroadcast`.
- README steps in numeric order; each fills a heading created by T003.
- The story's own Gate-1 check last.

### Parallel Opportunities

**The two tracks.** The script track (`sc/script/Deploy.s.sol`) and the README track
(`sc/README.md`) share no file and no ordering constraint. With two people, one takes
T006–T011 + T016 while the other takes T012–T014 + T017 + T019–T024. This is the only
meaningful concurrency in the feature.

**Within a track, tasks are sequential** — they edit one file. `[P]` therefore appears
only on T002/T003 (two different files) and T025/T026 (two files outside `sc/`).

---

## Parallel Example: Phase 1

```bash
# Two different files, no shared state:
Task: "T002 Create sc/script/Deploy.s.sol skeleton"
Task: "T003 Create sc/README.md skeleton with six step headings"
```

## Parallel Example: two-track split for Phases 3–6

```bash
# Developer A — script track (sc/script/Deploy.s.sol), strictly in order:
T006 → T007 → T008 → T009 → T010 → T011 → T016

# Developer B — README track (sc/README.md), strictly in order:
T012 → T013 → T014 → T017 → T019 → T020 → T021 → T022 → T023 → T024

# Rejoin for validation: T015, T018, then Phase 7.
```

---

## Implementation Strategy

### MVP (User Story 1 only)

1. Phase 1 — scaffolds up (T004 already done).
2. Phase 2 — keypairs in `.env`, inputs readable.
3. Phase 3 — validation and broadcast, README steps 0/1/3.
4. **STOP and VALIDATE**: T015. Every failure path fires by name, nothing touches the chain.

At this point the script is trustworthy but the address still has to be transcribed by
hand and nothing tells the reader to approve. Useful to a developer; not yet a runbook.

### Incremental delivery

1. **+US2** → the address moves by copy-paste. Still zero MON spent; both stories proven locally.
2. **+US3** → the system actually takes a purchase. This is the first point where following the README end to end produces a _working_ deployment rather than a deployed one.
3. **+US4** → a cold reader can start from nothing. The runbook becomes self-sufficient.
4. **+Phase 7** → corrections land upstream, then the live deploy and the cold-reader test.

### Sequencing note

**The three tasks with external dependencies are already done** — T004 (faucet source),
T005 (keypairs) and T027 (funding), all verified on-chain. Nothing in this plan now waits
on a faucet, a third party, or a lookup. What remains is 27 tasks of local work plus two
that need a decision: T028 spends ~0.4 MON on a live deploy, and T029 needs a human
reader.

---

## Notes

- `[P]` = different files, no dependencies. Deliberately rare here — see the header note.
- Everything through T026 costs nothing and touches no network. Only T027–T029 spend MON.
- `guardian/.env` is gitignored (`.gitignore:2`); `sc/script/Deploy.s.sol` and `sc/README.md` are committed. Never commit a key or a deployed address.
- `sc/src/GuardianEscrow.sol` is **not modified** by this feature. If deployment reveals a contract defect, the fix belongs to SC-01.
- Commit after each task or logical group; stop at any checkpoint to validate a story independently.
