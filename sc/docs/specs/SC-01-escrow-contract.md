# SC-01 — Escrow contract

**Component:** `sc/` · **Depends on:** — · **Size:** Large

> **Feed this file to `/speckit-specify`.** Read [`../CONTEXT.md`](../CONTEXT.md)
> first — it carries the component-wide invariants this spec assumes.

## Goal

Build `GuardianEscrow`, the Solidity contract that holds a buyer's payment until the
buyer accepts, the review window expires, or Guardian rules on a dispute — then
splits the money accordingly. This is the only part of Guardian the platform cannot
undo, which is the point: a verdict is executed, not recommended.

## In scope

- `DealState` (`None`/`Open`/`Delivered`/`Disputed`/`Settled`) and `Tier`
  (`NoRefund`/`Quarter`/`Half`/`ThreeQuarter`/`Full`) enums
- `Agent` and `Deal` structs exactly as specified
- Storage: `agents`, `deals`, `balances`, `totalEscrowed`, id counters starting at 1
- OpenZeppelin `AccessControl` with `OPERATOR_ROLE` and `GUARDIAN_ROLE`
- Constants: `DELIVERY_DEADLINE` 24h, `DISPUTE_DEADLINE` 72h
- Agent registry: `registerAgent`, `updateAgent`, `setAgentActive`
- Deal lifecycle: `openDeal`, `markDelivered`, `accept`, `release`, `reclaim`
- Dispute: `dispute`, `resolve`, `forceResolve`
- Money out: `withdraw`, `withdrawFor`
- All nine events
- `foundry.toml` — `solc = 0.8.24`, optimizer on

## Out of scope

Upgradeability · `Pausable` · fees · `reviewWindow` bounds checking (accepted risk)
· reputation · anything about agent definitions beyond storing a `bytes32` hash.

## Acceptance

- `forge build` succeeds under the **Monad Foundry fork**
- Every function matches the documented signature and access control
- Settlement paths credit `balances` only — the single `safeTransfer` out lives in
  `withdrawFor`
- `totalEscrowed` increments in `openDeal`, decrements on all four settlement paths
- Ids start at 1 so `0` unambiguously means "not found"

## Watch out for

- **`withdraw()` must delegate to `withdrawFor(msg.sender)`.** A `msg.sender`-only
  withdraw sends every operator-driven payout to the operator.
- **`resolve` takes a `Tier`, never an amount.** The contract computes the split, so
  a compromised Guardian key cannot invent a 37% refund.
- **`release`, `reclaim`, and `forceResolve` are permissionless on purpose.** Each
  only pushes a deal past a deadline that has already passed. Restricting them lets
  the platform strand funds by going quiet.
- **`seller` is snapshotted at `openDeal`**, not looked up at payout — otherwise
  transferring agent ownership mid-deal redirects money for work the previous owner
  performed.
- **`forceResolve` settles at `Tier.Quarter`**, matching the product's
  inconclusive-evidence rule. Without it, a dead Guardian freezes funds forever.

## Source

`../../../docs/smart-contract.md` §2–§5 and the appendix.
