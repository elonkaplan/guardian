# Phase 1 Data Model: Contract Test Suite

**Feature**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md) · **Research**: [research.md](./research.md)

A test suite's "data model" is its fixture world: who exists, what things cost, what
state a purchase can be in, and what each outcome is supposed to produce. Every number
below is a value some test asserts on — this document is where they are fixed once so
six test files cannot drift apart.

The contract's own storage model lives in
[SC-01's data-model](../001-guardian-escrow-contract/data-model.md) and is not repeated
here.

---

## 1. Actors

Seven addresses, created with `makeAddr` so failures print names rather than hex.

| Name | Roles held | Purpose |
| --- | --- | --- |
| `admin` | `DEFAULT_ADMIN_ROLE` | Proves the admin can grant/revoke and **nothing else** — no admin path touches a deal. |
| `operator` | `OPERATOR_ROLE` | The backend. Holds the entire token supply and has approved the escrow. Drives every lifecycle call. |
| `guardian` | `GUARDIAN_ROLE` | The arbitrator's key. Its only legitimate call is `resolve`. |
| `buyer` | — | Refund recipient on the deals under test. |
| `seller` | — | Agent owner and payout recipient. |
| `seller2` | — | Second agent owner; exists solely so balance accumulation across agents is testable (US2 §6). |
| `stranger` | — | No role, no relationship to any deal. The address that must **succeed** at `release`/`reclaim`/`forceResolve` and **fail** at everything else. |

`stranger` is the load-bearing actor of the suite. Three functions are permissionless
by design and ten are not; every one of those thirteen has a test whose caller is
`stranger`.

### Participant registry

`address[] participants` holds all seven, plus anything a test adds via `_track`.
`_sumBalances()` iterates it. Rationale and the failure mode in
[research R-003](./research.md#r-003--sum-balances-over-an-explicit-participant-registry).

---

## 2. Amounts and timings

All amounts are base units of a six-decimal token — `2_000_000` is 2.000000 USDC.

| Constant | Value | Why this value |
| --- | --- | --- |
| `PRICE` | `2_000_000` | Divides by four, so all five tier splits are round numbers a reader verifies by eye. |
| `ODD_PRICE` | `1_000_003` | Does **not** divide by four. Forces truncation and pins the remainder to the seller. |
| `PRICE_2` | `3_000_000` | `seller2`'s agent. Distinct from `PRICE` so an accumulation test cannot pass by coincidence. |
| `REVIEW` | `1 hours` | The default review window. Short enough to warp around, long enough to have an inside. |
| `ZERO_REVIEW` | `0` | The accepted-risk case: instantly releasable, never disputable. |
| `MINT` | `1_000_000_000` | Minted to `operator` in `setUp` — 1000 USDC, far more than any test spends. |

Contract constants the suite reads rather than redefines: `DELIVERY_DEADLINE` (24 h) and
`DISPUTE_DEADLINE` (72 h). Tests reference `escrow.DELIVERY_DEADLINE()` so a change in
the contract surfaces as a failing boundary test, not as two numbers silently agreeing.

---

## 3. The tier table — the assertion targets

This is the table the suite exists to protect. Both columns are asserted separately for
every row (FR-001); the sum column is asserted as its own property (FR-003).

### At `PRICE = 2_000_000`

| Tier | Refund | `balances[buyer]` | `balances[seller]` | Sum |
| --- | --- | ---: | ---: | ---: |
| `NoRefund` | 0% | `0` | `2_000_000` | `2_000_000` |
| `Quarter` | 25% | `500_000` | `1_500_000` | `2_000_000` |
| `Half` | 50% | `1_000_000` | `1_000_000` | `2_000_000` |
| `ThreeQuarter` | 75% | `1_500_000` | `500_000` | `2_000_000` |
| `Full` | 100% | `2_000_000` | `0` | `2_000_000` |

### At `ODD_PRICE = 1_000_003` — the truncation cases

| Tier | Exact quarter share | `balances[buyer]` (truncated) | `balances[seller]` (by subtraction) | Sum |
| --- | --- | ---: | ---: | ---: |
| `Quarter` | `250_000.75` | `250_000` | `750_003` | `1_000_003` |
| `Half` | `500_001.5` | `500_001` | `500_002` | `1_000_003` |
| `ThreeQuarter` | `750_002.25` | `750_002` | `250_001` | `1_000_003` |

Every remainder lands on the seller, because the contract computes `toSeller` as
`amount - toBuyer` rather than independently. No dust is created at any tier.

**The two zero-share rows are not merely "balance is zero".** At `NoRefund` the buyer
must have *no withdrawable entry at all* — the suite asserts `balances[buyer] == 0` and
that `withdrawFor(buyer)` reverts `"nothing to withdraw"`, which is what proves the
contract's `if (toBuyer > 0)` guard is doing its job rather than creating an empty claim.

`forceResolve` produces the `Quarter` row and a `verdictHash` of `bytes32(0)` — that zero
hash is the only on-chain difference between a real verdict and a timeout.

---

## 4. Deal state machine — what each state must reject

`DealState` is `None → Open → Delivered → {Settled | Disputed → Settled}`. `Settled` is
terminal. The suite asserts the **rejection** half of this table exhaustively (FR-015),
because a missing state guard is invisible on the happy path.

| Prior state | Permitted | Every other entry point reverts with |
| --- | --- | --- |
| `None` (unknown id — `0`, `999`, never issued) | *nothing* | `"not open"` · `"not delivered"` · `"not disputed"` |
| `Open` | `markDelivered`, `reclaim` (after deadline) | `accept`/`release`/`dispute` → `"not delivered"` · `resolve`/`forceResolve` → `"not disputed"` |
| `Delivered` | `accept`, `dispute` (in window), `release` (after window) | `markDelivered`/`reclaim` → `"not open"` · `resolve`/`forceResolve` → `"not disputed"` |
| `Disputed` | `resolve`, `forceResolve` (after deadline) | `markDelivered`/`reclaim` → `"not open"` · `accept`/`release`/`dispute` → `"not delivered"` |
| `Settled` | *nothing, ever* | `markDelivered`/`reclaim` → `"not open"` · `accept`/`release`/`dispute` → `"not delivered"` · `resolve`/`forceResolve` → `"not disputed"` |

**The `Settled` row is swept from all five settlement routes** (FR-014): a deal settled
by `accept`, by `release`, by `reclaim`, by `resolve`, and by `forceResolve` each face
the same seven rejections. Five sweeps, not one, because each route reaches `Settled`
through different code and a route that forgot to write the state would only fail its own
sweep.

Unknown ids need no dedicated guard in the contract — an unset id returns a zero-filled
struct whose state is `None` — but they get their own test because that reasoning is a
property of the storage layout, not a written check, and would break silently if ids ever
started at `0`.

---

## 5. Time model

Four gates, each tested from both sides at the exact boundary
([research R-006](./research.md#r-006--every-deadline-is-tested-as-a-boundary--1-boundary-pair)).

| Gate | Anchor field | Offset | Rejected at | Permitted at | Revert |
| --- | --- | --- | --- | --- | --- |
| `release` | `deliveredAt` | `reviewWindow` | `T − 1` | `T` | `"window open"` |
| `dispute` | `deliveredAt` | `reviewWindow` | `T` | `T − 1` | `"window closed"` |
| `reclaim` | `openedAt` | `DELIVERY_DEADLINE` (24 h) | `T − 1` | `T` | `"too early"` |
| `forceResolve` | `disputedAt` | `DISPUTE_DEADLINE` (72 h) | `T − 1` | `T` | `"too early"` |

Rows 1 and 2 share an anchor and an offset and are deliberately opposite. At the instant
`T` exactly one is available — `release` succeeds, `dispute` reverts. One test asserts
both at that single instant (FR-008), which is the only form that proves there is neither
an overlap nor a gap.

`ZERO_REVIEW` collapses row 1 and row 2 onto the delivery instant itself: releasable
immediately, never disputable. That is an accepted product risk, recorded as intended
behaviour rather than treated as a defect.

---

## 6. Solvency model

The assertion run after every state-changing test:

```
token.balanceOf(escrow)  ==  totalEscrowed  +  Σ balances[participants]  +  donated
```

| Term | Source | Changes when |
| --- | --- | --- |
| `token.balanceOf(escrow)` | the token | `openDeal` (in) · `withdrawFor` (out) · a direct transfer in |
| `totalEscrowed` | contract storage | `+amount` on `openDeal`; `−amount` on every settlement |
| `Σ balances` | contract storage, summed over the registry | `+share` on settlement; `−all` on withdrawal |
| `donated` | test-side counter, normally `0` | only the direct-transfer test sets it |

Equality rather than the contract's stated `>=`, for the reason in
[research R-002](./research.md#r-002--solvency-is-a-modifier-not-a-trailing-call): inside
the suite every unit has a known origin, and equality additionally catches funds that get
stranded — debited from `totalEscrowed` without being credited to anybody — which `>=`
would accept silently.

Settlement moves **no tokens**. Every settlement path leaves `balanceOf(escrow)`
unchanged and merely converts escrowed value into claimable value; the only outward
transfer in the entire contract is inside `withdrawFor`. Several tests assert that
directly, because "settlement is bookkeeping" is what removes reentrancy from four of the
five settlement paths.

---

## 7. Fixture ladder

Each rung builds on the one above, so a test states only what is distinctive about it.

| Fixture | Leaves the deal in | Used by |
| --- | --- | --- |
| `_registerAgent(owner, price)` | *(no deal yet)* — returns `agentId` | agent-level tests |
| `_openDeal(agentId, buyer, window)` | `Open` — returns `dealId` | reclaim, delivery-deadline, wrong-state |
| `_delivered(window)` | `Delivered` | accept, release, dispute, review-window boundaries |
| `_disputed()` | `Disputed` | **all five tier tests**, `forceResolve`, dispute-deadline |
| `_settledBy(route)` | `Settled` via one of five routes | the double-settle sweeps |

`_delivered` and `_disputed` register an agent at `PRICE` owned by `seller`, open a deal
for `buyer`, and advance the lifecycle — the common case in one call. Variants taking an
explicit price exist for `ODD_PRICE`.

Full signatures in [contracts/test-harness.md](./contracts/test-harness.md).

---

## 8. Entities created by this feature

| Entity | File | What it is |
| --- | --- | --- |
| `MockUSDC` | `test/helpers/MockUSDC.sol` | OZ `ERC20`, `decimals() = 6`, public `mint`. No fees, no hooks, no rebasing. |
| `EscrowTestBase` | `test/helpers/EscrowTestBase.sol` | `abstract contract … is Test`. Deploys the token and escrow, mints and approves, names the actors, registers participants, and provides the fixtures, the `solvent` modifier, and the two revert helpers. |
| Six test contracts | `test/*.t.sol` | One per protection group; each inherits `EscrowTestBase` and adds nothing to the shared world. |

Nothing under `src/` is created or modified. `GuardianEscrow` is the subject, not a
participant in the design.
