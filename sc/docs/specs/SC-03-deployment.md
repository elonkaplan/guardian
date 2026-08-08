# SC-03 — Deployment & operations scripts

**Component:** `sc/` · **Depends on:** SC-01 · **Size:** Small

> **Feed this file to `/speckit-specify`.** Read [`../CONTEXT.md`](../CONTEXT.md)
> first — it carries the component-wide invariants this spec assumes.

## Goal

Take a cold machine to a deployed, operator-approved contract on Monad Testnet using
only a README.

## In scope

- `script/Deploy.s.sol` reading `DEPLOYER_PRIVATE_KEY`, `USDC_ADDRESS`,
  `OPERATOR_ADDRESS`, `GUARDIAN_ADDRESS` from env
- Prints the address in **`.env` format** (`ESCROW_CONTRACT_ADDRESS=0x…`) so
  deployment is copy-one-line
- `README.md` runbook: install the Monad Foundry fork → fund wallets → deploy →
  paste address → **approve the escrow from the operator wallet**
- The four-wallet funding table

## Out of scope

CI/CD, multi-environment config, contract verification (not needed for the MVP),
upgrade scripts.

## Acceptance

- A cold reader reaches a working deployment from the README alone
- `ESCROW_CONTRACT_ADDRESS` is printed ready to paste
- The `approve` step is a **numbered step**, not a footnote

## Watch out for

- **The `approve` step is the one that bites.** `openDeal` uses `transferFrom`, so
  without an allowance the *first purchase* reverts — long after deployment looked
  successful.
- **Four wallets need funding**: deployer (MON), funder (MON + test USDC), operator
  (MON), guardian (MON). **The guardian is the one that gets forgotten** — everything
  works until the first dispute, then silently fails at settlement.
- **Monad charges the gas limit, not usage.** Note it in the README so nobody
  wonders where the MON went.

## Source

`../../../docs/project-structure.md` §4.
