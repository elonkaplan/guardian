# `sc/` — Context Briefing

Everything needed to build the smart-contract component. Read this first; the root
docs have the detail.

**Root docs that matter here** (paths relative to this file):

| Doc | Why |
| --- | --- |
| [`../../docs/smart-contract.md`](../../docs/smart-contract.md) | **The specification.** Data types, storage, functions, access control, events, draft Solidity in the appendix. |
| [`../../docs/project-structure.md`](../../docs/project-structure.md) | §1 Monad gotchas · §4 Foundry setup and the deploy runbook |
| [`../../docs/product-workflow.md`](../../docs/product-workflow.md) | Why the tiers and timers are what they are |

---

## 1. What this component is

**One contract: `GuardianEscrow`.** It holds a buyer's payment until the buyer
accepts, the review window expires, or Guardian rules on a dispute — then it splits
the money accordingly.

It is the only part of Guardian that cannot be undone by the platform. That is the
entire point: Guardian's verdict is executed rather than recommended.

## 2. Chain and toolchain

| | |
| --- | --- |
| Network | **Monad Testnet**, chain ID `10143` |
| RPC | `https://testnet-rpc.monad.xyz` |
| Explorer | `https://testnet.monadvision.com` |
| Token | Test USDC, **6 decimals** — `0x534b2f3A21130d7a60830c2Df862319e593943A3` |
| Toolchain | **Monad's Foundry fork** — not upstream (project-structure §1.2) |
| Solidity | `^0.8.24`, OpenZeppelin `AccessControl` + `SafeERC20` |

## 3. Five things that are easy to get wrong

1. **Gas: the *limit* is charged, not the usage.** `value + gas_price * gas_limit`.
   Estimate-and-pad costs real money on Monad. Measure, then set limits.
2. **Two roles, deliberately separate.** `OPERATOR` (backend) can open deals but
   never move escrowed funds; `GUARDIAN` (an autonomous LLM's key) can only split
   an already-disputed deal between two addresses fixed at purchase. A compromised
   Guardian key must be able to produce a wrong verdict and nothing worse.
3. **Three functions are permissionless on purpose** — `release`, `reclaim`,
   `forceResolve`. Each can only push a deal past a deadline that has already
   passed, into the outcome the rules already dictate. Restricting them would let
   the platform strand funds by going quiet. That is the line between escrow and
   custody.
4. **`withdrawFor(account)` exists because the operator drives everything.**
   `withdraw()` pays `msg.sender` — if the operator called it, every payout would
   go to the operator.
5. **Guardian picks a tier, never an amount.** `resolve(dealId, Tier, verdictHash)`.
   The five tiers are `0 / 25 / 50 / 75 / 100`, and the contract computes the split.

## 4. Environment variables

Read from the repo-root `.env`:

```
MONAD_RPC_URL · MONAD_CHAIN_ID · USDC_ADDRESS
DEPLOYER_PRIVATE_KEY          separate throwaway key, discard after deploy
OPERATOR_ADDRESS · GUARDIAN_ADDRESS
ESCROW_CONTRACT_ADDRESS       written back after deployment
```

## 5. Out of scope

Upgradeability · pausing · fees · reputation · appeals · agent spend limits (those
live in Rain, and are deferred) · anything to do with agent definitions beyond
storing a `bytes32` hash.
