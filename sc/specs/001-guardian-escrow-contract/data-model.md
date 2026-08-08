# Phase 1 Data Model: Guardian Escrow Contract

**Feature**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md) · **Research**: [research.md](./research.md)

All storage is on-chain. Nothing in this feature persists off-chain; agent definitions
and verdict text live in Postgres and reach the contract only as `bytes32` commitments.

---

## 1. Enums

### `DealState`

| # | Name | Meaning |
| --- | --- | --- |
| 0 | `None` | Deal does not exist. **The default for any unset id** — this is why ids start at 1. |
| 1 | `Open` | Paid and escrowed. Not yet delivered. |
| 2 | `Delivered` | Output delivered. Review window running. |
| 3 | `Disputed` | Buyer complained. Frozen, awaiting the arbitrator. |
| 4 | `Settled` | **Terminal.** Funds credited. Nothing further is possible. |

`None` being the zero value is load-bearing, not incidental: a lookup on an unknown id
returns a zero-filled struct whose `state` reads as `None`, so every entry point's
state precondition rejects unknown ids without a separate existence check.

### `Tier`

| # | Name | Refund bps | To buyer | To seller |
| --- | --- | --- | --- | --- |
| 0 | `NoRefund` | 0 | 0% | 100% |
| 1 | `Quarter` | 2500 | 25% | 75% |
| 2 | `Half` | 5000 | 50% | 50% |
| 3 | `ThreeQuarter` | 7500 | 75% | 25% |
| 4 | `Full` | 10000 | 100% | 0% |

`Quarter` doubles as the inconclusive-evidence default, and therefore as the
`forceResolve` outcome. Solidity rejects out-of-range enum values at the ABI decode
boundary, so "a tier outside the five" is unrepresentable rather than merely rejected.

---

## 2. Entities

### `Agent` — a listed, purchasable agent

| Field | Type | Set at | Mutable by | Meaning |
| --- | --- | --- | --- | --- |
| `owner` | `address` | `registerAgent` | — | Seller's payout address. Immutable for the agent's life. |
| `price` | `uint256` | `registerAgent` | `updateAgent` | Price per purchase, in the token's **base units** (6 decimals). |
| `defHash` | `bytes32` | `registerAgent` | `updateAgent` | `keccak256` of the canonical agent definition. |
| `version` | `uint32` | `registerAgent` → `1` | `updateAgent` → `+1` | Definition version. |
| `active` | `bool` | `registerAgent` → `true` | `setAgentActive` | Gates **new** deals only. Never affects deals already running. |

**Storage cost**: 4 slots as declared (`owner` alone in slot 0; `price`; `defHash`;
`version`+`active` packed). Packing `version` and `active` alongside `owner` would save
one slot — deliberately not done, see [research.md R-005](./research.md).

**Existence test**: `agents[id].owner != address(0)`.

**Validation rules**:
- `owner != address(0)` at registration → `"bad owner"` (FR-022)
- Agent must exist for `updateAgent` / `setAgentActive` → `"no agent"` (FR-023, FR-024)
- Agent must be `active` for `openDeal` → `"agent inactive"` (FR-024)
- `price` is **not** validated. Zero is permitted; a zero-price deal escrows nothing and
  settles to zero on both sides, which is harmless.

### `Deal` — one purchase

| Field | Type | Set at | Meaning |
| --- | --- | --- | --- |
| `agentId` | `uint256` | `openDeal` | Which agent was bought |
| `buyer` | `address` | `openDeal` | Refund recipient |
| `seller` | `address` | `openDeal` | **Snapshot** of `agent.owner` at purchase |
| `amount` | `uint256` | `openDeal` | Escrowed value (`= agent.price` at that moment) |
| `defHash` | `bytes32` | `openDeal` | **Pinned** — the definition that actually ran |
| `defVersion` | `uint32` | `openDeal` | **Pinned** version number |
| `openedAt` | `uint64` | `openDeal` | Unix seconds. Starts `DELIVERY_DEADLINE`. |
| `deliveredAt` | `uint64` | `markDelivered` | Unix seconds; `0` until delivered. Starts `reviewWindow`. |
| `disputedAt` | `uint64` | `dispute` | Unix seconds; `0` until disputed. Starts `DISPUTE_DEADLINE`. |
| `reviewWindow` | `uint32` | `openDeal` | Seconds the buyer has to complain. Per-deal, not a constant. |
| `state` | `DealState` | throughout | §1 |

**Storage cost**: 7 slots as declared. Slots 0–4 hold `agentId`, `buyer`, `seller`,
`amount`, `defHash`; slot 5 packs `defVersion`+`openedAt`+`deliveredAt`+`disputedAt`+
`reviewWindow` to exactly 32 bytes; `state` spills alone into slot 6.

**Three fields exist to close specific holes** — worth stating because each looks
redundant until you know what it prevents:

- **`seller` is a snapshot, not a lookup.** Reading `agents[agentId].owner` at payout
  time would let an ownership transfer mid-deal redirect money for work the *previous*
  owner's agent performed.
- **`defHash` / `defVersion` are pinned.** Otherwise a seller could soften their own
  declared capabilities after a bad delivery and win the dispute retroactively.
- **`amount` is copied, not derived.** `agent.price` is mutable; the escrowed amount
  must not be.

**Validation rules**:
- `buyer != address(0)` → `"bad buyer"` (FR-010)
- `reviewWindow` is **not** bounds-checked. `0` is accepted and closes the complaint
  window instantly — an accepted MVP risk, guarded backend-side rather than on-chain.
- Every entry point checks `state` against its required prior state; see
  [access-control.md](./contracts/access-control.md).

### `balances` — the pull-payment ledger

`mapping(address => uint256)`. Withdrawable funds per address, keyed by address rather
than by agent or deal, so a seller owning several agents accumulates into one balance
and an address that both buys and sells uses the same entry.

**This is where all settlement lands.** No settlement path transfers tokens; each one
converts an escrowed amount into one or two entries here.

---

## 3. Contract-level storage

| Name | Type | Notes |
| --- | --- | --- |
| `token` | `IERC20 immutable` | Settlement token, fixed at deploy, cannot be swapped (FR-028) |
| `agents` | `mapping(uint256 => Agent)` | The registry |
| `deals` | `mapping(uint256 => Deal)` | Every deal, forever |
| `balances` | `mapping(address => uint256)` | The pull-payment ledger |
| `totalEscrowed` | `uint256` | Sum of all live (unsettled) deal amounts |
| `nextAgentId` | `uint256` | Counter, **starts at 1** |
| `nextDealId` | `uint256` | Counter, **starts at 1** |

All are `public`, so Solidity generates getters and the API needs no bespoke view
functions.

### Constants

| Name | Type | Value | Gates |
| --- | --- | --- | --- |
| `OPERATOR_ROLE` | `bytes32` | `keccak256("OPERATOR_ROLE")` | Registry + lifecycle |
| `GUARDIAN_ROLE` | `bytes32` | `keccak256("GUARDIAN_ROLE")` | `resolve` only |
| `DELIVERY_DEADLINE` | `uint32` | `24 hours` (86 400) | `reclaim` |
| `DISPUTE_DEADLINE` | `uint32` | `72 hours` (259 200) | `forceResolve` |

`reviewWindow` is deliberately **not** a constant — it is per-deal, so the demo can run
seconds while production defaults to 24 hours.

### The solvency invariant (FR-007)

```
token.balanceOf(address(this))  >=  totalEscrowed  +  Σ balances
                                    └─ escrowed ─┘     └ credited ┘
```

`>=` rather than `==`: anyone can send tokens directly to the contract, raising
`balanceOf` with no matching claim. Such tokens are stranded — no function can pay them
out — which is harmless, but an equality assertion would false-alarm on it. A balance
*below* the right-hand side is a genuine bug: value credited without being escrowed, or
credited twice.

`totalEscrowed` exists **only** to make the left half of this checkable on-chain.
Solidity cannot iterate a mapping, so without a running counter there is no way to sum
live deals. It increments in `openDeal` and decrements on all four settlement paths.

---

## 4. State transitions

```
                    openDeal (OPERATOR)
        None ──────────────────────────────► Open
                                              │
                    markDelivered (OPERATOR)  │
                 ┌────────────────────────────┘
                 ▼
            Delivered ─────────────────────────────────┐
              │   │                                    │
              │   │ dispute (buyer|OPERATOR)           │ accept (buyer|OPERATOR)
              │   │ requires now < deliveredAt+window  │ any time while Delivered
              │   ▼                                    │  → seller credited 100%
              │  Disputed                              │
              │   │   │                                │
              │   │   │ resolve (GUARDIAN)             │
              │   │   │  → split by tier               │
              │   │   ▼                                │
              │   │  ┌──────────────────────────────┐  │
              │   │  │                              │  │
              │   │ forceResolve (anyone)           │  │
              │   │ requires now ≥ disputedAt+72h   │  │
              │   │  → split at Tier.Quarter        │  │
              │   │  │                              │  │
              │ release (anyone)                    │  │
              │ requires now ≥ deliveredAt+window   │  │
              │  → seller credited 100%             │  │
              ▼  ▼                                  ▼  ▼
        ┌────────────────────────────────────────────────┐
        │                    Settled                     │  ◄── TERMINAL
        └────────────────────────────────────────────────┘
                              ▲
                              │ reclaim (anyone)
                              │ requires state == Open && now ≥ openedAt + 24h
                              │  → buyer credited 100%
                            Open
```

**Four paths in, none out.** `Settled` is reached by `accept`, `release`, `resolve`/
`forceResolve`, and `reclaim`, and is never left. That single structural fact is what
makes "verdicts are final, no appeals" true by construction rather than by policy
(FR-009).

**Every state has an exit that does not require the platform** (FR-026):

| State | Stuck if the platform goes silent? | Escape |
| --- | --- | --- |
| `Open` | No | `reclaim` after 24h — anyone, buyer credited |
| `Delivered` | No | `release` after the review window — anyone, seller credited |
| `Disputed` | No | `forceResolve` after 72h — anyone, 25/75 split |
| `Settled` | n/a | `withdrawFor(account)` — anyone, always pays `account` |

The `Disputed` row is the one that was missing from the first draft of the design. Every
other state had a permissionless escape; a lost arbitrator key would have frozen those
funds permanently. `DISPUTE_DEADLINE` + `forceResolve` closed it, and the default tier
is not arbitrary — the product's own inconclusive-evidence rule already resolves to 25%,
and a timeout is the ultimate unproven case.

### Timing semantics

| Boundary | Comparison | At exactly `t` |
| --- | --- | --- |
| Review window | `release` needs `now >= deliveredAt + reviewWindow` | Release **allowed** |
| Review window | `dispute` needs `now < deliveredAt + reviewWindow` | Complaint **refused** |
| Delivery deadline | `reclaim` needs `now >= openedAt + DELIVERY_DEADLINE` | Reclaim **allowed** |
| Dispute deadline | `forceResolve` needs `now >= disputedAt + DISPUTE_DEADLINE` | Force-settle **allowed** |

The two review-window rows are complementary by construction — `>=` and `<` on the same
expression — so there is no instant where both release and complaint are available, and
none where neither is.

`block.timestamp` carries a few seconds of validator latitude. Irrelevant at 24 and 72
hours; review windows below ~30 seconds are not reliable and should not be used even in
the demo.

---

## 5. Settlement arithmetic

For a deal of `amount` settled at `tier`:

```
toBuyer  = amount * refundBps(tier) / 10_000
toSeller = amount - toBuyer                    ← derived, never computed independently
```

Deriving `toSeller` by subtraction makes `toBuyer + toSeller == amount` structurally
true for every tier and every amount (FR-019). Any truncation lands on the seller's side
by construction; no dust is created or stranded.

Worked example at $2.00 (`2_000_000` base units):

| Tier | bps | `toBuyer` | `toSeller` | Sum |
| --- | --- | --- | --- | --- |
| `NoRefund` | 0 | 0 | 2 000 000 | ✓ |
| `Quarter` | 2500 | 500 000 | 1 500 000 | ✓ |
| `Half` | 5000 | 1 000 000 | 1 000 000 | ✓ |
| `ThreeQuarter` | 7500 | 1 500 000 | 500 000 | ✓ |
| `Full` | 10000 | 2 000 000 | 0 | ✓ |

Zero-value credits are skipped (`if (toBuyer > 0)`) so the `NoRefund` and `Full` edges
do not write a pointless zero to the ledger.

---

## 6. Units — the classic bug

`price` and `amount` are in the token's **base units**, never dollars. Test USDC has 6
decimals:

| Display | On-chain |
| --- | --- |
| $2.00 | `2_000_000` |
| $1.50 | `1_500_000` |
| $1.00 | `1_000_000` |

The contract never sees a display value and performs no conversion. Conversion happens
exactly once, off-chain, at the API's chain-adapter boundary. Never pass a float.
