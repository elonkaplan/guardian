# Implementation Plan: Deployment Runbook

**Branch**: `003-deployment-runbook` | **Date**: 2026-08-08 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/003-deployment-runbook/spec.md`

## Summary

Two deliverables: `script/Deploy.s.sol`, which deploys `GuardianEscrow` with both roles
wired from the repository-root `.env` and prints the new address as a paste-ready
configuration line; and `README.md`, a numbered runbook that carries a cold reader from
no toolchain to a first purchase that actually works.

Phase 0 measured the toolchain rather than assuming it, and three findings reshaped the
plan. They are the reason this feature is not simply a transcription of
`docs/project-structure.md` §4:

- **`forge` cannot see the repository-root `.env` at all.** Foundry's dotenv reads the
  project root and does not walk up to parents; Guardian's single `.env` lives one level
  above `sc/`, and there is no `--env-file` flag in this version. The obvious invocation
  — `cd sc && forge script … --broadcast` — reads none of the configuration and dies on
  the first `vm.env*` call. The runbook therefore opens with an explicit
  `set -a; . ../.env; set +a`, which also puts the values in reach of `cast` for the
  approval step. Without this the runbook does not work at all, for anyone, on the first
  try. ([research R2](./research.md#r2--the-repository-root-env-is-not-visible-to-forge-the-blocking-one))
- **The draft's print statement is not paste-safe.** `console2.log("KEY=", addr)` joins
  arguments with a space and emits `KEY= 0x…`. `string.concat` emits `KEY=0x…`. The
  entire value of US2 lives in that one character. ([R3](./research.md#r3--printing-the-address-so-it-is-genuinely-paste-safe))
- **`vm.envAddress` aborts on the first bad value and says nothing about the rest**,
  which cannot satisfy FR-004's "name every value that failed". `vm.envOr` returns its
  default for both missing *and* malformed values, so validation reads all four inputs
  through sentinels, accumulates, and reverts once with the full list.
  ([R4](./research.md#r4--naming-every-bad-configuration-value-not-just-the-first))

One deliberate widening beyond the spec: the deploy script **rejects `0xDEAD`-prefixed
placeholder addresses**, not just absent ones. FR-015 asks only for a runbook warning,
but `.env.example` ships format-valid fakes by design — they pass every format check by
construction — and granting `GUARDIAN_ROLE` to one is unrecoverable without a full
redeploy, discovered at the first dispute. The convention is machine-checkable in four
lines. ([R6](./research.md#r6--rejecting-the-shipped-placeholder-values))

Every number in the runbook's funding table is derived from `forge test --gas-report`
against the real contract, converted at the live gas price under Monad's charge-the-limit
rule — not estimated. ([R9](./research.md#r9--funding-amounts-derived-rather-than-guessed))

**No open inputs.** The one that was open — where test USDC comes from, which no
document in the repository recorded — resolved to **two** faucets: MON from
`faucet.monad.xyz`, test USDC from `faucet.circle.com` (what Monad's hackathon
documentation recommends, and consistent with R7's finding that the token is a Circle
FiatToken). Confirmed by a completed funding run rather than assumed. Two domains rather
than one sharpens FR-009's job: the funder's second trip has to be its own action, or a
reader finishes the MON round and stops.
([R13](./research.md#r13--resolved-two-faucets-one-per-asset))

## Technical Context

**Language/Version**: Solidity `0.8.24`, pinned in `foundry.toml`; `evm_version =
"shanghai"`. The deploy script compiles under the same pin as `src/`. The runbook is
Markdown.

**Primary Dependencies**: `forge-std` (`Script`, `console2`, `vm` cheatcodes) and
OpenZeppelin Contracts v5.1.0 (`IERC20` for the constructor argument). Both submodules
are already under `lib/`. **No new dependencies.**

**Storage**: None of its own. The feature reads the repository-root `.env` and the
reader writes exactly one value — `ESCROW_CONTRACT_ADDRESS` — back into it by hand.

**Testing**: This feature is validated by execution against the live testnet, not by
`forge test`. The failure paths (missing value, malformed value, placeholder value) are
verifiable locally without broadcasting, because `forge script` simulates before it
sends. See [quickstart.md](./quickstart.md).

**Target Platform**: **Monad Testnet, chain ID `10143`** — verified live this session
(`cast chain-id` → `10143`). RPC `https://testnet-rpc.monad.xyz`. Settlement token
`0x534b2f3A21130d7a60830c2Df862319e593943A3`, confirmed on-chain as a Circle FiatToken
proxy, `decimals()` → `6`, `symbol()` → `"USDC"`. This is the first feature in `sc/`
that touches a real network; SC-01 and SC-02 are local-EVM only.

**Project Type**: A Foundry deployment script plus its operator documentation.

**Performance Goals**: Not a runtime concern. The one budgeted figure is human:
**under 45 minutes** from cold machine to working deployment (SC-001), which is what
sets the runbook's length and its refusal to send the reader elsewhere.

**Constraints**:

- **Charge-the-limit gas.** `value + gas_price * gas_limit`. The Monad fork submits the
  simulated gas as the limit with **no padding** — confirmed on the live deploy, where
  limit and usage matched to the unit and 2,406,060 gas at 107.8 gwei cost exactly
  0.2594 MON. Upstream Foundry's 130% pad would have burned ~30% more, which is a
  measured price tag on the "use the fork" constraint below.
  ([R8](./research.md#r8--gas-the-fork-already-removes-the-pad-corrected-post-deploy))
- **The Monad Foundry fork installs to the same path as upstream** (`~/.foundry/bin`),
  with no distinct binary name. The only reliable check is that `forge --version`
  contains `-monad-`; installed here as `1.7.1-monad-v1.0.0`.
  ([R1](./research.md#r1--toolchain-the-monad-fork-and-how-to-prove-you-have-it))
- **`forge` is not on `PATH` in a non-interactive shell** on this machine; the binaries
  are at `~/.foundry/bin/`. The runbook must say so, or step 1 appears to fail.
- **Private keys need the `0x` prefix.** `vm.envUint` rejects bare hex; `cast
  --private-key` accepts it. The same `.env` value passes step 5 and fails step 3 — the
  worst shape a config bug can take. ([R5](./research.md#r5--the-0x-prefix-asymmetry-between-forge-and-cast))
- **`GuardianEscrow` is not modified by this feature.** If deployment reveals a contract
  defect, the fix belongs to SC-01.
- **Single shell session.** The `set -a` export does not survive a new terminal, and the
  runbook says so at the point it matters.

**Scale/Scope**: 2 new files (~90 lines of Solidity, one README). 4 configuration inputs
validated, 1 value written back, 4 wallets funded, 6 numbered steps, 3 failure paths
exercised locally.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

`.specify/memory/constitution.md` is **still an unedited template** — every principle
and governance rule remains a `[PLACEHOLDER]`. There are no ratified principles to gate
against.

**Result: PASS by vacancy, not by compliance.** No gates evaluated, no violations
possible, Complexity Tracking left empty.

Recorded so the omission reads as a finding rather than an oversight, and noting the one
place it would bite if a constitution were adopted: this feature ships a deployment path
with **no automated test of the success path**. The failure paths are locally
verifiable, but "the contract deploys correctly to Monad Testnet" is proven by doing it,
once, by hand. That is the right call for a single-environment hackathon deliverable —
the assertion is the deployment itself — but a Test-First or CI principle would want it
justified rather than assumed.

**Post-Phase 1 re-check: PASS**, unchanged. The design adds no dependency beyond the two
submodules already present, no new configuration keys, and no production contract code.
The one scope widening (R6's placeholder guard) is documented in Complexity Tracking
below rather than left implicit.

## Project Structure

### Documentation (this feature)

```text
specs/003-deployment-runbook/
├── plan.md              # This file
├── spec.md              # Feature specification
├── research.md          # Phase 0 output — 14 decisions, 12 measured
├── data-model.md        # Phase 1 output — inputs, output, wallet roster, authorisation
├── quickstart.md        # Phase 1 output — how to validate, including the failure paths
├── checklists/
│   └── requirements.md  # Spec quality checklist (all items pass)
├── contracts/
│   ├── deploy-script.md     # Deploy.s.sol's contract — inputs, validation, output, exits
│   └── runbook-outline.md   # README.md's step contract, mapped to FRs
└── tasks.md             # Phase 2 output (/speckit-tasks — NOT created here)
```

### Source Code (repository root)

The Foundry project root is `sc/`. **Only `script/Deploy.s.sol` and `README.md` are
created by this feature**; everything else already exists and is unchanged.

```text
guardian/
├── .env                             # repo root — read by all three components
├── .env.example                     # template; keys need the 0x prefix (R5)
└── sc/
    ├── script/
    │   └── Deploy.s.sol             # ← NEW: validate → deploy → print paste-ready line
    ├── README.md                    # ← NEW: the six-step runbook
    ├── src/
    │   └── GuardianEscrow.sol       # SC-01 — deployed by this feature, NOT modified
    ├── test/                        # SC-02 — untouched
    ├── foundry.toml                 # already pinned; no change needed
    ├── remappings.txt               # already maps @openzeppelin/ and forge-std/
    └── lib/{forge-std,openzeppelin-contracts}
```

**Structure Decision**: `script/` alongside `src/` and `test/` is the Foundry
convention and what `foundry.toml`'s existing layout implies. `Deploy.s.sol` is the only
script; there is one environment and one thing to deploy, so a `script/helpers/` split
would be structure without content.

**The runbook lives at `sc/README.md`, not in `docs/`.** `api/README.md` and
`ui/README.md` already exist and carry their component's quick-start; `sc/` is the only
component without one. Co-location is what makes FR-007's "without depending on any
other document" true rather than aspirational — a reader who has the contract has the
instructions for deploying it. `docs/project-structure.md` §4 remains the *design*
record and will be corrected against Phase 0's findings; it is not the runbook.

**Validation lives in the script, not in a shell wrapper.** A `deploy.sh` that
pre-checked `.env` before calling `forge` would work, but it puts the rules in a second
place that can drift from the script that enforces them, and it adds a file to the
runbook's surface. `Deploy.s.sol` already has to read all four values; checking them
where they are read keeps one source of truth and means a direct `forge script`
invocation is as safe as the documented one.

## Complexity Tracking

> No Constitution Check violations. One deliberate scope widening beyond the written
> requirements, recorded here so it is reviewable rather than silent.

| Addition | Why Needed | Simpler Alternative Rejected Because |
|----------|------------|--------------------------------------|
| Placeholder (`0xDEAD…`) rejection in `Deploy.s.sol`, beyond FR-015's runbook warning | `.env.example` ships format-valid fakes by design, so FR-004's format check passes them by construction. Granting `GUARDIAN_ROLE` to a placeholder is unrecoverable without redeploy + re-paste + re-approve, and surfaces only at the first dispute. | A warning alone (FR-015 as written) relies on the reader having read it at the moment they were filling in a different file. The convention is documented and machine-checkable; the guard is four lines against an unrecoverable, late-surfacing failure. |
