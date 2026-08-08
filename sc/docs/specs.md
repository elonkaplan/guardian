# `sc/` — Spec Breakdown

> **For review.** How I'd split the smart-contract component into speckit-sized
> specs. Nothing implemented yet.

Three specs, strictly ordered. Read [`CONTEXT.md`](./CONTEXT.md) first.

| # | Spec | Depends on | Rough size |
| --- | --- | --- | --- |
| SC-01 | Escrow contract | — | Large |
| SC-02 | Contract test suite | SC-01 | Medium |
| SC-03 | Deployment & operations scripts | SC-01 | Small |

**Why only three.** This component is one contract. Splitting it further would mean
specs that can't compile on their own — the state machine, the roles, and the timers
are a single interlocking design, and a spec that delivers half of them delivers
nothing testable.

---

## SC-01 — Escrow contract

**Deliver:** `src/GuardianEscrow.sol`, compiling under the Monad Foundry fork.

**In scope**

- `DealState` and `Tier` enums; `Agent` and `Deal` structs
- Storage: `agents`, `deals`, `balances`, `totalEscrowed`, id counters
- `AccessControl` with `OPERATOR_ROLE` and `GUARDIAN_ROLE`
- Constants `DELIVERY_DEADLINE` (24h), `DISPUTE_DEADLINE` (72h)
- Agent registry: `registerAgent`, `updateAgent`, `setAgentActive`
- Deal lifecycle: `openDeal`, `markDelivered`, `accept`, `release`, `reclaim`
- Dispute: `dispute`, `resolve`, `forceResolve`
- Money out: `withdraw`, `withdrawFor`
- All nine events
- `foundry.toml` with `solc = 0.8.24`, optimizer on

**Explicitly out**

Upgradeability, `Pausable`, fees, `reviewWindow` bounds checking (accepted risk —
smart-contract §11.3), reputation.

**Done when**

- `forge build` succeeds
- Every function in smart-contract §4 exists with the documented signature and
  access control
- Settlement paths only credit `balances` — the sole `transfer` out is in
  `withdrawFor`
- `totalEscrowed` increments in `openDeal` and decrements on all four settlement
  paths

**Source:** `../docs/smart-contract.md` §2–§5, appendix.

---

## SC-02 — Contract test suite

**Deliver:** `test/GuardianEscrow.t.sol` — Foundry tests with a mock ERC-20.

**In scope**, grouped by what each group protects:

| Group | Covers |
| --- | --- |
| **Happy paths** | register → open → deliver → accept; and → release after expiry |
| **Dispute paths** | Each of the five tiers splits correctly, including the 0/100 edges |
| **Timers** | `release` reverts before expiry; `dispute` reverts after; `reclaim` and `forceResolve` revert before their deadlines |
| **Access control** | Every `OPERATOR`-only and `GUARDIAN`-only function reverts for the wrong caller; the three permissionless ones succeed for a stranger |
| **State machine** | No double-settle from any entry point; every function rejects the wrong prior state |
| **Solvency** | `token.balanceOf(escrow) >= totalEscrowed + Σ balances` holds after every operation |
| **Payee correctness** | `withdrawFor(x)` pays `x`, never the caller — the bug that motivated it |

**Done when**

`forge test` passes; the solvency invariant is asserted after each state-changing
test, not just at the end.

**Worth noting:** the tier-split tests are the ones that matter most. They're the
on-chain half of the product's core promise, and an off-by-one in `_refundBps`
would be invisible until a live demo.

**Source:** `../docs/smart-contract.md` §2.2, §4, §8.

---

## SC-03 — Deployment & operations scripts

**Deliver:** `script/Deploy.s.sol`, `README.md` runbook.

**In scope**

- `Deploy.s.sol` reading `DEPLOYER_PRIVATE_KEY`, `USDC_ADDRESS`,
  `OPERATOR_ADDRESS`, `GUARDIAN_ADDRESS` from env
- Prints the deployed address **in `.env` format** (`ESCROW_CONTRACT_ADDRESS=0x…`)
  so deployment is copy-one-line
- `README.md`: install the Monad Foundry fork → fund wallets → deploy → paste
  address → **`approve` the escrow from the operator**
- A note on which four wallets need funding and with what

**Done when**

A cold reader can go from empty machine to a deployed, operator-approved contract
using only the README.

**The step that bites:** the `cast send ... approve()` from the operator wallet.
`openDeal` uses `transferFrom`, so without an allowance the **first purchase**
reverts — long after deployment looked successful. It belongs in the runbook as a
numbered step, not a footnote.

**Source:** `../docs/project-structure.md` §4.


## SC-02 is the project's only test suite

Automated tests were cut from `api/` and `ui/` for time. The contract keeps its
suite: it is the only component where a bug both moves money incorrectly and costs a
redeploy to fix.

## Individual spec files

Run these through `/speckit-specify` **in order** — each assumes the ones above it.

| # | Spec | File |
| --- | --- | --- |
| 1 | SC-01 — Escrow contract | [`specs/SC-01-escrow-contract.md`](./specs/SC-01-escrow-contract.md) |
| 2 | SC-02 — Contract test suite | [`specs/SC-02-test-suite.md`](./specs/SC-02-test-suite.md) |
| 3 | SC-03 — Deployment & operations | [`specs/SC-03-deployment.md`](./specs/SC-03-deployment.md) |

Each file is self-contained enough for one speckit run: goal, in/out of
scope, acceptance criteria, and the specific traps for that slice.
