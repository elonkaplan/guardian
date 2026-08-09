# Implementation Plan: Chain Adapter

**Branch**: `003-chain-adapter` | **Date**: 2026-08-08 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/003-chain-adapter/spec.md`

## Summary

`src/chain/` — three viem clients, three ABIs of deliberately different widths, typed
wrappers for every escrow function, and one pair of conversion functions that are the
only place in the backend where token base units exist.

Three decisions carry most of the feature's risk, and all three are settled in
[research.md](./research.md) rather than left to implementation:

- **The ids come from event logs.** `registerAgent` and `openDeal` both declare
  `returns (uint256)`, but a transaction returns nothing to an off-chain caller. Both
  ids are recovered from the receipt's `AgentRegistered` / `DealOpened` logs (R3).
- **Simulate free, then write with an explicit `gas`.** `simulateContract` is an
  `eth_call` that costs nothing and catches every precondition failure before a
  transaction is paid for; `writeContract` then carries a ceiling from a named
  constant, never an estimate, because Monad charges the limit (R4, R5).
- **The guardian's ABI has one entry.** viem infers `functionName` from the ABI
  literal, so `openDeal` through the guardian client is a type error — the property
  the spec asks for, produced by the shape of the code rather than by review (R15).
  Verified against viem 2.55.11 before planning finished, since the whole role-separation
  claim rests on it.

**The escrow is now deployed** at `0xe1b74F8dB511247786Ef61bde9330198a1929d53`, and
every assumption in this plan that could be checked against it has been — chain id,
settlement token, decimals, both role grants, and the not-found read rule all verified
by read-only calls ([research R16](./research.md)). The ABI transcribed in R2 decodes
correctly against the deployed bytecode, which is the best available evidence that the
copy is faithful.

That verification changed one number that mattered: **R5's estimated `openDeal` gas
ceiling of 400,000 was below the measured 408,072**, so shipping it would have made
every purchase revert out-of-gas — charged in full — in the product's most important
operation. Five of the twelve ceilings are now measured rather than reasoned about.

**No external blockers remain.** The operator holds $20.00 USDC against an unbounded
escrow allowance, so both of `openDeal`'s preconditions pass — worth stating separately
because they are independent, and an unbounded allowance says nothing about whether the
transfer can actually succeed.

## Technical Context

**Language/Version**: TypeScript on Node 24 (container) / 26 (host), compiled by
TypeScript 6.0.3 — pinned in API-01.

**Primary Dependencies**: **viem `^2.55.11`** — the one new dependency this feature
adds. Monad's docs name ≥ 2.40.0 as the floor (research R1). NestJS 11 and the
existing config module are already present.

**Storage**: None. This module reads and writes no rows and imports no entity. Its
only persistence is the chain's.

**Testing**: None. Automated tests are out of scope for this component per
[`docs/CONTEXT.md`](../../docs/CONTEXT.md); verification is the seven-step manual pass
in [quickstart.md](./quickstart.md), centred on a throwaway smoke script and a look at
MonadVision.

**Target Platform**: Linux container via Compose; also runs on the host. Talks to
Monad Testnet (chain id 10143) over HTTP JSON-RPC.

**Performance Goals**: Not a throughput feature. The figure that matters is **gas
spend per transaction**, because Monad charges the declared limit rather than the
usage. Measured against the deployment, a full purchase cycle costs ≈ 0.059 MON
(`openDeal` 0.0426 + `markDelivered` 0.0057 + `release` 0.0104), and the operator holds
4.9 MON — roughly 80 cycles, comfortably more than a rehearsal needs.

Correcting an overstatement in this plan's first draft: the sweeper's 3-second tick
(`SWEEPER_INTERVAL_MS=3000`) is a **database poll**, not a transaction — it only
writes to the chain when a deal is actually due for release. Gas waste was never going
to drain the funder at this scale. The real risk was always an under-sized ceiling
losing a transaction outright, which is what the measurements in
[research R5](./research.md) closed.

**Constraints**:
- Token base units and the `10_000` scale appear in `src/chain/units.ts` and nowhere
  else (invariant #2).
- The guardian client can express `resolve` and nothing else.
- No viem import outside `src/chain/`.
- No business logic, no order state, no database access.
- A confirmation timeout is an *unknown* outcome, never a failure (invariant #1).

**Scale/Scope**: Demo scale — tens of transactions per rehearsal. About 18 source
files, one new dependency, one throwaway script. **No `tsconfig.json` change** —
research R14 investigated the resolution risk and verified it does not apply.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

`.specify/memory/constitution.md` is still the unmodified Spec Kit template — all
`[PRINCIPLE_N_NAME]` placeholders, no ratified principles. **Result: PASS (vacuous)**,
recorded as a known gap rather than an oversight, exactly as in API-01 and API-02.

The governance that actually binds here is the nine invariants in
[`docs/CONTEXT.md`](../../docs/CONTEXT.md) §2. This feature is where two of them
either become true or quietly stop being true:

| Invariant | How this feature satisfies it |
| --- | --- |
| #1 Postgres first, chain second | This module never writes a row, so the ordering is the caller's to keep — but it supplies the thing the caller needs to keep it: a **third outcome**. `ChainOutcomeUnknownError` does not extend any failure type, so a timed-out `openDeal` cannot be caught by a generic handler and retried into a second on-chain deal ([contracts/errors.md](./contracts/errors.md)) |
| #2 One money unit: USD cents | `units.ts` holds the only occurrence of the scale; every signature on the module's boundary takes and returns `number` cents ([contracts/chain-api.md](./contracts/chain-api.md)); SC-004 greps for violations |
| #8 The verdict is persisted before the chain call | `EscrowGuardianService.resolve` takes a `verdictHash` it does not compute — it cannot be called before something else has produced and stored the verdict |

And the role separation from `docs/smart-contract.md` §3.5, which this module is the
sole enforcement point for: `escrowResolveAbi` has one entry, `escrowOperatorAbi`
omits `resolve`, and no client is exported (R15).

**Post-Phase-1 re-check: PASS.** No new project, no queue, no cache, no ORM
abstraction. Three services rather than one is the narrowing mechanism itself, not
layering — collapsing them would put a `writeContract` with the guardian key one
property access from any caller. Complexity Tracking is empty.

## Project Structure

### Documentation (this feature)

```text
specs/003-chain-adapter/
├── plan.md              # This file
├── research.md          # Phase 0 — 15 decisions; R2, R3, R14 are the expensive ones
├── data-model.md        # Phase 1 — the types crossing the boundary; no entities
├── quickstart.md        # Phase 1 — the 7-step manual verification
├── contracts/
│   ├── chain-api.md          # The exported surface, method by method
│   └── errors.md             # 9 typed errors, 3 revert encodings, provocation table
├── checklists/
│   └── requirements.md  # Spec quality checklist (16/16 pass)
└── tasks.md             # Phase 2 (/speckit-tasks — NOT created here)
```

### Source Code (repository root)

```text
api/src/chain/                       # NEW — the entire feature
├── chain.module.ts                  # Nest module; exports the three services
├── chain.constants.ts               # GAS_LIMITS, timeouts, allowance budget
├── monad-chain.ts                   # defineChain, built from config (R11)
├── units.ts                         # toBaseUnits / fromBaseUnits — THE conversion
├── tier.ts                          # Tier (uint8) ⇄ VerdictTier (string)
├── types.ts                         # OnChainDeal, OnChainAgent, TxResult, DealState
├── errors.ts                        # the 9 typed errors
├── decode-revert.ts                 # viem error → typed error (3 encodings)
├── abi/
│   ├── escrow.abi.ts                # full, transcribed from sc/out artifact (R2)
│   ├── escrow-operator.abi.ts       # everything except resolve
│   ├── escrow-resolve.abi.ts        # resolve, and ONLY resolve
│   └── erc20.abi.ts                 # allowance/approve/decimals + ERC20 errors (R6)
├── clients/
│   ├── public.client.ts             # no key
│   ├── operator.client.ts           # OPERATOR_PRIVATE_KEY + nonceManager (R8)
│   └── guardian.client.ts           # GUARDIAN_PRIVATE_KEY, narrow ABI
├── escrow-read.service.ts           # totalEscrowed, balances, deals, agents
├── escrow-operator.service.ts       # every operator write + ensureAllowance
├── escrow-guardian.service.ts       # resolve. one method.
└── chain-preflight.service.ts       # 4 free boot checks; warns, never blocks

api/scripts/
└── chain-smoke.ts                   # NEW — the throwaway acceptance script

api/src/app.module.ts                # MODIFIED — import ChainModule
api/package.json                     # MODIFIED — add viem ^2.55.11
                                     # tsconfig.json: unchanged (R14 verified)
```

**Structure Decision**: `chain/` is a real Nest module from the start, unlike 002's
flat `entities/` — it has behaviour, dependents (`orders`, `guardian`, `jobs`, and
`funding` all consume it), and a boundary that is the feature's entire point.

Two subdirectories rather than a flat module, for one reason each. `abi/` because the
three files must be visibly different widths — the narrowing is the security property,
and a reviewer should be able to see all three next to each other and count the
entries. `clients/` because `project-structure.md` §5.2 asks for the guardian client
in its own module, and a file per key makes "which key signs this" answerable by
looking at one import.

`scripts/` sits outside `src/` deliberately: `tsconfig.json` sets `"rootDir": "./src"`,
so a throwaway script placed inside would ship in `dist/`. It is run with `ts-node`,
which does not care.

## Complexity Tracking

> No Constitution Check violations. Table intentionally empty.
