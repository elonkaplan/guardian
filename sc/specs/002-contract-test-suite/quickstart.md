# Quickstart: Running & Validating the Contract Test Suite

**Feature**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md) · **Coverage**: [contracts/coverage-matrix.md](./contracts/coverage-matrix.md)

How to run the suite, and how to prove each success criterion actually holds rather than
assuming it does. Run everything from the Foundry project root, `sc/`.

---

## 1. Prerequisites

| | |
| --- | --- |
| Toolchain | **Monad's Foundry fork** — `forge 1.7.1-monad-v1.0.0` or later |
| Submodules | `lib/forge-std` and `lib/openzeppelin-contracts` (v5.1.0), already vendored |
| Network | **None.** Everything runs in Foundry's in-process EVM. No RPC, no `.env`, no funded key. |

`forge` is **not on `PATH` in a non-interactive shell** on the current machine — it lives
at `~/.foundry/bin/forge`. Interactive terminals get it from the shell profile; scripts
and agents must use the absolute path:

```bash
~/.foundry/bin/forge --version    # expect: forge Version: 1.7.1-monad-v1.0.0
git submodule update --init --recursive
```

---

## 2. Run it

```bash
cd sc

forge build                       # compiles src/ + test/ under solc 0.8.24, shanghai
forge test                        # the whole suite — SC-001
forge test -vv                    # + console output from failing assertions
forge test -vvvv                  # + full call traces; what you want when one fails
```

Expected shape of a green run — six suites, 81 passing, zero skipped:

```text
Ran 6 test suites: 81 tests passed, 0 failed, 0 skipped (81 total tests)
```

### Run one group

The file split maps onto the spec's protection groups, so a group is one flag:

```bash
forge test --match-path test/TierSplits.t.sol      # the five percentages
forge test --match-path test/Timers.t.sol          # the four deadline boundaries
forge test --match-path test/AccessControl.t.sol   # who may call what
forge test --match-path test/StateMachine.t.sol    # no double-settle
forge test --match-path test/Withdrawals.t.sol     # withdrawFor pays the payee
forge test --match-path test/HappyPath.t.sol       # the undisputed lifecycles

forge test --match-test test_Resolve_Half_SplitsEvenly -vvv   # a single test
```

---

## 3. Validate the success criteria

Each check below is a command plus what it must show. These are what make the criteria
verifiable rather than aspirational.

### SC-001 — everything passes, nothing skipped

```bash
forge test
grep -rn "vm.skip\|// *function test_" test/    # must return nothing
```

A commented-out test and a passing suite look identical in the summary line; the grep is
the difference.

### SC-002 — the five percentages are findable by name

```bash
forge test --match-path test/TierSplits.t.sol --list
```

Five names must be readable as the five splits — `NoRefund_PaysSellerEverything`,
`Quarter_Splits500kTo1500k`, `Half_SplitsEvenly`, `ThreeQuarter_Splits1500kTo500k`,
`Full_PaysBuyerEverything` — without opening `GuardianEscrow.sol`.

### SC-003 — solvency after every state-changing test

```bash
grep -c "solvent" test/*.t.sol      # per-file count of modifier uses
grep -rn "function test_" test/ | grep -v solvent
```

The second command lists tests **without** the modifier. Every line it prints must be a
genuinely read-only test (a pure revert-before-any-effect check). Anything that changes
state and is missing `solvent` is a defect in the suite, not a style choice.

### SC-005 — deadline boundaries

```bash
forge test --match-path test/Timers.t.sol --list
```

Eight boundary tests across four gates, in `(T−1, T)` pairs, plus the single-instant
mutual-exclusion test. Both sides of every gate.

### SC-008 — under 60 seconds

`forge test` prints per-suite timing. With no fuzzing and no forking the realistic figure
is single-digit seconds; 60 is the ceiling that keeps the suite runnable before every
change.

### SC-009 — reproducible and isolated

```bash
forge test && forge test                                  # identical output twice
forge test --match-test test_Resolve_Quarter_Splits500kTo1500k   # passes alone
```

Foundry re-runs `setUp()` before every test function against fresh EVM state, so
isolation is structural. The single-test run confirms no test depends on a neighbour
having run first.

### SC-010 — the tier tests actually detect a wrong tier

**This is the one check that tests the tests.** Do it once when the suite is written,
and again any time `_refundBps` changes.

1. In `src/GuardianEscrow.sol`, change one tier by a single basis point:
   `if (t == Tier.Quarter) return 2_500;` → `return 2_501;`
2. `forge test --match-path test/TierSplits.t.sol`
3. **Expect failures in at least:** `test_Resolve_Quarter_Splits500kTo1500k`,
   `test_Resolve_OddAmount_Quarter_RemainderToSeller`, and
   `test_ForceResolve_AfterDeadline_AppliesQuarterTier`.
4. `git checkout src/GuardianEscrow.sol` — **revert before doing anything else.**

If step 3 produces a green run, the tier tests are table-driven off the same numbers as
the contract and prove nothing. That is the failure this procedure exists to catch.

Repeat for one other tier to confirm the property is not specific to `Quarter`.

---

## 4. What "done" looks like

- [ ] `forge build` clean, no warnings introduced by `test/`
- [ ] `forge test` — 81 passed, 0 failed, 0 skipped
- [ ] Every state-changing test carries `solvent` (SC-003 grep above)
- [ ] The five tier tests are longhand, with literal amounts a reader can check by eye
- [ ] The mutation procedure in §3 fails the expected tests, then is reverted
- [ ] `src/GuardianEscrow.sol` is **unmodified** — `git diff src/` is empty
- [ ] Coverage matrix rows all map to a real test function name

---

## 5. Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| Every test fails inside the token on `openDeal` | The operator never approved the escrow | `setUp` must mint to `operator` **and** `vm.prank(operator); usdc.approve(address(escrow), type(uint256).max)`. An overridden `setUp` that skips `super.setUp()` does this too. |
| A role test fails with "call did not revert as expected" | Role failures are OZ v5's `AccessControlUnauthorizedAccount` custom error, not a string | Use `_expectUnauthorized(caller, role)`, never `vm.expectRevert("...")`. |
| The missing-allowance test does not match | `SafeERC20` v5.1 **bubbles** the token's own error | Expect `ERC20InsufficientAllowance(spender, allowance, needed)`, not `SafeERC20FailedOperation`. |
| A boundary test passes on both sides | The warp is relative and the fixture already moved time | Warp to an absolute instant computed from the deal's own `deliveredAt`/`openedAt`/`disputedAt`. |
| Solvency fails right after a settlement | A payee is not in the `participants` registry, so `Σ balances` is short | `_track(newAddress)` before settling to it. The assertion breaking here is intended — see [research R-003](./research.md#r-003--sum-balances-over-an-explicit-participant-registry). |
| `forge: command not found` in a script | `~/.foundry/bin` is not on a non-interactive `PATH` | Use the absolute path, or `source ~/.zshrc` first. |
| Compiler complains about `test/helpers/*.sol` not being tests | Nothing is wrong | Foundry compiles every `.sol` under `test/` but only discovers tests in `*.t.sol`. Helpers are deliberately named without it. |
