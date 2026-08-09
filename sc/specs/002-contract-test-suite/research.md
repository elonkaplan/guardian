# Phase 0 Research: Contract Test Suite

**Feature**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md) · **Date**: 2026-08-08

The spec carried **zero** `[NEEDS CLARIFICATION]` markers. What follows are the
technical decisions it deliberately left to this phase — the ones that determine
whether the suite actually catches a bug or merely agrees with it.

Ten decisions. Three of them (R-002, R-004, R-005) are the difference between a suite
that proves something and a suite that passes.

---

## R-001 — Write a minimal `MockUSDC`; do not use OpenZeppelin's mocks

**Decision**: A ~20-line `test/helpers/MockUSDC.sol` extending OpenZeppelin's `ERC20`,
overriding `decimals()` to return `6`, and exposing a public unguarded `mint`.

**Rationale**: The production settlement token is test USDC on Monad — six decimals, no
transfer fee, no rebasing, no hooks. The mock's only job is to be exactly that, so that
an amount like `2_000_000` in a test reads as "2 USDC" the same way it will on chain.
Extending the real `ERC20` (rather than hand-rolling one) means allowance and balance
semantics — including the exact `ERC20InsufficientAllowance` error that the
missing-approval test asserts on — are the same implementation the contract will meet in
production.

**Alternatives considered**:
- *`lib/openzeppelin-contracts/contracts/mocks/token/ERC20DecimalsMock.sol`* — exists in
  the submodule and does the decimals part, but OZ treats `contracts/mocks/` as internal
  test scaffolding with no compatibility promise, and it still needs a mint wrapper.
  Twenty lines of our own beats a dependency on someone else's test fixture.
- *`solmate`/`forge-std`'s `MockERC20`* — would add a third submodule for one file.
- *A fee-on-transfer or rebasing mock* — deliberately not built. The settlement token is
  fixed at deployment to a known, well-behaved contract; hostile-token coverage would be
  testing a scenario the deployment makes impossible. Recorded in the spec's Assumptions.

**Consequences to carry**: `MockUSDC` must be minted to the operator in `setUp`, and the
operator must `approve` the escrow — without the approval every `openDeal` reverts inside
the token, which is exactly the failure mode SC-01's plan warns will look like a logic
bug long after deployment looked successful.

---

## R-002 — Solvency is a modifier, not a trailing call

**Decision**: The base contract exposes `modifier solvent()` whose body is `_;` followed
by the assertion. Every test that changes state carries it in its signature.

**Rationale**: FR-017 requires the check "after every state-changing test, not once at
the end". A helper called on the last line of each test satisfies that on the day it is
written and quietly stops satisfying it the first time someone adds a test and forgets
the line — and a forgotten call looks identical to a passing one. In the modifier form,
the requirement is visible in the signature, greppable
(`grep -c "solvent" test/*.t.sol`), and reviewable at a glance in a diff.

The assertion itself is **exact accounting, not the bare inequality**:

```
token.balanceOf(escrow) == totalEscrowed + Σ balances + donated
```

where `donated` is a base-contract counter, zero except in the one test that sends
tokens in directly. The contract's stated invariant is `>=`, because an outsider can
always raise the left side. But inside the suite every unit of the left side has a known
origin, so equality is checkable — and equality catches a whole class the inequality
does not: funds that get **stranded** (debited from `totalEscrowed` without being
credited to anyone) leave the left side too high, which `>=` happily accepts. The
`donated` offset preserves the contract's actual `>=` semantics for the one case that
exercises them.

**Alternatives considered**:
- *`assertGe` only, matching the contract's stated invariant literally* — weaker in
  exactly the direction where a settlement bug would hide.
- *Foundry's `invariant_`/`afterInvariant` machinery* — that is the invariant-campaign
  feature, which the spec puts out of scope, and it does not run against unit tests.
- *A `setUp`/`tearDown` pair* — Foundry has no `tearDown` hook. The modifier is the
  idiomatic substitute.

**Consequences to carry**: modifier order matters — `solvent` must run its assertion
after the body, so the assertion goes after `_;`. Tests that expect a revert still carry
it; the state simply should not have changed.

---

## R-003 — Sum `balances` over an explicit participant registry

**Decision**: The base contract keeps `address[] internal participants`, populated in
`setUp` with all seven actors, plus `_track(address)` for any address a test introduces.
`_sumBalances()` iterates it.

**Rationale**: Solidity cannot iterate a mapping, so the sum has to come from a list the
test side maintains. This is the same reason `totalEscrowed` exists in the contract at
all.

The failure mode is worth naming: if a test credits an address that is not in the
registry, the sum is too small, the equality in R-002 fails loudly rather than passing
silently. That is the right direction for the mistake to break — an unregistered payee
is caught, not ignored. This is a direct consequence of choosing equality over `>=` in
R-002; under `>=` the same mistake would pass.

**Alternatives considered**:
- *Recording every address the suite touches via a cheatcode-based accessor* — Foundry
  can read arbitrary storage slots (`vm.load`), so a mapping walk is theoretically
  possible, but it means computing slot hashes in test code and would be far more
  fragile than a seven-element array.
- *Asserting per-address balances only, with no global sum* — that is what most of the
  individual tests already do; the sum is what turns them into a solvency check.

---

## R-004 — The five tier assertions are longhand, not table-driven

**Decision**: Five separate test functions, each named for its tier, each asserting two
literal amounts. No loop over a `[0, 2500, 5000, 7500, 10000]` array.

**Rationale**: This is the single most important decision in the suite. A table-driven
test would import the same basis-point table the contract uses — and if `_refundBps`
returns `2_600` for `Quarter`, a table-driven test built from the same understanding
returns `2_600` too and passes. The only construction that actually tests the percentages
is one where a human wrote `500_000` and `1_500_000` in decimal and a reader can check
them by eye against "25% of 2 USDC".

The source spec is explicit that this is the number the demo audience watches and that an
off-by-one here is invisible until then. SC-010 makes the property testable: perturb one
tier by one basis point and at least one test must fail.

**Alternatives considered**:
- *One parameterised test over a fixture table* — fewer lines, and it would have caught
  nothing.
- *Fuzzing the amount across tiers* — out of scope, and it tests the arithmetic identity
  (shares sum to the amount) rather than the percentages themselves. The identity gets
  its own explicit assertion instead, plus the odd-amount case in R-007.

---

## R-005 — Two revert shapes, two helpers; never a bare `vm.expectRevert()`

**Decision**: The base contract provides `_expectRevertReason(string)` for the
contract's own `require` strings and `_expectUnauthorized(address caller, bytes32 role)`
for OpenZeppelin's role error. No test uses the no-argument `vm.expectRevert()`.

**Rationale**: `GuardianEscrow` reverts two ways and the difference is easy to get wrong:

| Source | Shape |
| --- | --- |
| The contract's own preconditions | Short `require` string — `"not open"`, `"window closed"`, `"nothing to withdraw"` |
| `onlyRole` failures | OZ v5 custom error `AccessControlUnauthorizedAccount(address account, bytes32 neededRole)` |
| Inside the token (e.g. missing approval) | The token's own error, **bubbled unchanged** by `SafeERC20` — for OZ v5.1 that is `ERC20InsufficientAllowance(spender, allowance, needed)` |

The third row was verified in the installed submodule rather than assumed:
`SafeERC20._callOptionalReturn` in v5.1 does `returndatacopy` + `revert` on failure, so
the token's error reaches the test intact — it is *not* wrapped in
`SafeERC20FailedOperation`. A test asserting the wrapper would fail; one asserting
nothing would pass for the wrong reason.

FR-021 requires asserting the specific reason, and the reason is why: a bare
`vm.expectRevert()` on `release` before the window passes whether the revert was
`"window open"` (correct) or `"not delivered"` (a broken fixture). The exact strings are
fixed by
[SC-01's access-control contract](../001-guardian-escrow-contract/contracts/access-control.md) §3
and are treated here as an interface.

**Alternatives considered**:
- *Bare `vm.expectRevert()` for brevity* — rejected by FR-021, for the reason above.
- *Asserting role failures by string* — would not compile against a custom error and,
  worse, `vm.expectRevert("...")` would simply not match, producing a confusing failure
  in a test that is otherwise correct.

---

## R-006 — Every deadline is tested as a `(boundary − 1, boundary)` pair

**Decision**: For each of the four time gates, two tests: one warping to
`deadline - 1` and one to exactly `deadline`. `vm.warp` sets absolute timestamps; no test
uses `skip`/relative offsets that would compound across a fixture.

**Rationale**: `release` uses `>=` and `dispute` uses `<` on the same expression
(`deliveredAt + reviewWindow`), which is what makes the two mutually exclusive with no
gap. Testing only "long after" and "long before" would pass even if one comparison were
flipped to `>`, which would create exactly the one-second window where neither action is
available — the kind of hole that only appears with a purchase mid-flight.

The four gates and their exact boundaries:

| Gate | Boundary expression | Rejected at | Permitted at |
| --- | --- | --- | --- |
| `release` | `deliveredAt + reviewWindow` | `boundary - 1` | `boundary` |
| `dispute` | `deliveredAt + reviewWindow` | `boundary` | `boundary - 1` |
| `reclaim` | `openedAt + 24 hours` | `boundary - 1` | `boundary` |
| `forceResolve` | `disputedAt + 72 hours` | `boundary - 1` | `boundary` |

Rows 1 and 2 are deliberately opposite; one test asserts both at the same instant
(FR-008) so the mutual exclusion is stated as a property, not inferred from two files.

**Alternatives considered**:
- *`vm.warp(block.timestamp + N)` relative jumps* — fine in isolation, but fixtures
  already move time, so relative jumps make the actual instant a test runs at depend on
  the fixture's internals. Absolute warps computed from the deal's own recorded timestamp
  keep each test's boundary self-evident.
- *Testing only the permitted side* — would not detect a gate that never rejects.

---

## R-007 — Two purchase amounts: one that divides by four, one that does not

**Decision**: `PRICE = 2_000_000` (2.000000 USDC) as the default, and
`ODD_PRICE = 1_000_003` for the remainder case.

**Rationale**: `2_000_000` divides cleanly by four, so all five tier splits are exact
round numbers a reader can verify mentally — 0 / 500_000 / 1_000_000 / 1_500_000 /
2_000_000. That is what makes the longhand assertions of R-004 readable.

But clean division would hide the truncation behaviour entirely. `1_000_003` at the
quarter tier gives `1_000_003 × 2500 / 10000 = 250_000.75`, truncated to `250_000`, with
the seller taking `750_003`. The remainder lands on the seller because the contract
derives `toSeller` by subtraction rather than computing it independently — the property
FR-004 pins down, and the reason no dust is ever created. A suite using only round
amounts would pass against an implementation that computed both sides independently and
lost a unit per split.

**Alternatives considered**:
- *A single odd amount everywhere* — makes every tier assertion an unreadable
  seven-digit number, defeating R-004's whole purpose.
- *Fuzzing the amount* — out of scope, and the single enumerated odd case pins the exact
  property that matters.

---

## R-008 — Six test files by protection group; per-test isolation comes free

**Decision**: `TierSplits`, `HappyPath`, `Timers`, `AccessControl`, `Withdrawals`,
`StateMachine`, each a contract inheriting `EscrowTestBase`. Test functions named
`test_<Subject>_<Condition>_<Expectation>`.

**Rationale**: The grouping is the source spec's own scope table, so a reviewer checking
"are the tier splits covered" runs `forge test --match-path test/TierSplits.t.sol` and
reads one file. The naming convention makes SC-002 satisfiable literally — the five tier
percentages are findable by function name without reading the contract.

FR-020's independence requirement needs no mechanism: Foundry re-runs `setUp()` before
every test function against fresh EVM state, so cross-test contamination is structurally
impossible as long as no test relies on `vm.store`-style global tricks. This is worth
stating because it is the one requirement that is satisfied by the framework rather than
by the code, and it would be easy to write defensive reset code that does nothing.

**Alternatives considered**:
- *One `GuardianEscrow.t.sol`* — ~70 tests in one file, and `--match-path` stops being
  useful.
- *One file per contract function* — 13 files, and the cross-cutting checks (solvency,
  double-settle sweeps) have no natural home.

---

## R-009 — Event assertions on the four settlement events, with all topics checked

**Decision**: `vm.expectEmit(true, true, true, true)` immediately before the call, for
`DealOpened`, `Released`, `Resolved`, `Reclaimed`, and `Withdrawn`. Not asserted for
`AgentRegistered`/`AgentUpdated`/`Delivered` beyond one smoke check each.

**Rationale**: FR-022 exists because the backend learns outcomes from logs, not from
storage reads — a `Resolved` event carrying the wrong `toBuyer`/`toSeller` would
mis-report a correct on-chain split to every off-chain consumer. Checking all four
`expectEmit` flags (three indexed topics plus the data blob) is what makes the amounts
part of the assertion; the common mistake is `expectEmit(true, true, true, false)`, which
silently ignores the non-indexed data — i.e. exactly the amounts.

`Resolved` also carries the tell that distinguishes a real verdict from a force-settle:
`verdictHash` is zero for the force path. FR-006 asserts that directly.

**Alternatives considered**:
- *Asserting every event on every path* — noise; the lifecycle events carry no money.
- *Skipping event assertions entirely* — would leave the API integration's only data
  source untested anywhere in the project, since `api/` has no suite of its own.

---

## R-010 — SC-010 (mutation sensitivity) is a documented manual procedure, not tooling

**Decision**: Record the one-basis-point perturbation check as a runbook step in
[quickstart.md](./quickstart.md). Do not add a mutation-testing tool.

**Rationale**: SC-010 asks that a deliberate one-point error in any tier cause a failure.
Performed by hand it is a 60-second edit-run-revert loop over `_refundBps`, done once
when the suite is written and again if the tiers ever change. A mutation-testing
framework for Solidity would be a new dependency, a new toolchain, and minutes of runtime
per pass, to automate something checked twice in this project's life. The spec's own
Assumptions already put automated campaign tooling out of scope.

**Alternatives considered**:
- *`vertigo` / `necessist` or similar* — disproportionate for a five-line pure function.
- *Dropping SC-010* — it is the only criterion that tests the tests, and the tier splits
  are the one place worth that assurance.

**Consequences to carry**: the procedure must be written down where someone will find
it, and it must name the expected failing tests. An unreproducible criterion is not a
criterion.
