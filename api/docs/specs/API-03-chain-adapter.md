# API-03 — Chain adapter

**Component:** `api/` · **Depends on:** API-01 · **Size:** Medium

> **Feed this file to `/speckit-specify`.** Read [`../CONTEXT.md`](../CONTEXT.md)
> first — it carries the nine backend invariants this spec assumes.

## Goal

`chain/` — the only module that talks to Monad, and the only place that knows token
base units exist.

## In scope

- `monadTestnet` chain definition (id 10143, RPC, MonadVision explorer)
- Three viem clients: `publicClient`, `operatorClient`, `guardianClient`
- Contract ABI and typed wrappers for every escrow function
- `toBaseUnits` / `fromBaseUnits` — cents ↔ 6-decimal units, **the single
  conversion point**
- Receipt waiting, tx-hash return, typed errors
- Explicit gas limits on the operator's hot paths
- Read helpers: `totalEscrowed`, `balances(address)`, `deals(id)`

## Out of scope

**Automated tests of any kind** (MVP decision — see `../CONTEXT.md`). Plus:

Any business logic, order state, or database writes.

## Acceptance

- A throwaway script calls `registerAgent` and the transaction appears on
  MonadVision
- Reads and writes both work against the deployed contract
- `guardianClient` is constructed with an ABI containing **only `resolve`**

## Watch out for

- **Narrow the guardian client deliberately.** The role separation is only real if
  signing an `openDeal` with the guardian key is a compile error rather than a
  code-review question.
- **Monad charges the gas *limit*, not the usage** — `value + gas_price * gas_limit`.
  Estimate-and-pad spends real money on every operator transaction, and the sweeper
  fires constantly.
- **viem must be ≥ 2.40.0** — Monad's stated floor.
- Conversion is `cents × 10⁴`. Getting it wrong is a factor-of-10,000 error, which
  is exactly why it lives in one function.

## Source

`../../../docs/smart-contract.md` §4 · `../../../docs/project-structure.md` §1, §5.
