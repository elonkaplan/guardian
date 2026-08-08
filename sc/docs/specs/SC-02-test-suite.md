# SC-02 — Contract test suite

**Component:** `sc/` · **Depends on:** SC-01 · **Size:** Medium

> **Feed this file to `/speckit-specify`.** Read [`../CONTEXT.md`](../CONTEXT.md)
> first — it carries the component-wide invariants this spec assumes.

## Goal

Foundry tests that prove the escrow does what the product promises — especially the
tier splits, which are the on-chain half of Guardian's credibility.

> **This is the only test suite in the project.** Automated tests were cut from
> `api/` and `ui/` to save time; the contract keeps its suite because it is the one
> component where a bug moves money incorrectly *and* costs a redeploy plus an
> `.env` update to fix. Everything else can be corrected in place.

## In scope

A mock ERC-20 plus tests grouped by what each group protects:

| Group | Covers |
| --- | --- |
| Happy paths | register → open → deliver → accept; and → release after expiry |
| Dispute paths | All five tiers split correctly, including the 0% and 100% edges |
| Timers | `release` reverts before expiry; `dispute` reverts after; `reclaim` and `forceResolve` revert before their deadlines |
| Access control | Every role-gated function reverts for the wrong caller; the three permissionless ones succeed for a stranger |
| State machine | No double-settle from any entry point; every function rejects the wrong prior state |
| Solvency | `token.balanceOf(escrow) >= totalEscrowed + Σ balances` |
| Payee correctness | `withdrawFor(x)` pays `x`, never the caller |

## Out of scope

Fuzzing, invariant campaigns, gas benchmarking, formal verification.

## Acceptance

- `forge test` passes
- The solvency invariant is asserted **after every state-changing test**, not once
  at the end
- Each of the five tiers has an explicit split assertion

## Watch out for

- **The tier-split tests matter most.** An off-by-one in `_refundBps` would be
  invisible until a live demo, and it's the number the audience is watching.
- **Test `withdrawFor` with a third-party caller.** That function exists because of
  a real bug; a test that only calls it as the owner wouldn't have caught it.
- Use `vm.warp` for the timers — all three deadlines need both sides tested.

## Source

`../../../docs/smart-contract.md` §2.2, §4, §8.
