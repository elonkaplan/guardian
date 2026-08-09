# Phase 1 Data Model: Chain Adapter

This feature stores nothing. Its "data model" is the set of types that cross its
boundary — what the rest of the backend hands in, what it gets back, and the two
representations of money that meet in one file.

Every type below lives under `api/src/chain/`. Nothing here is a TypeORM entity and
nothing here touches the database.

---

## 1. The two money representations

The boundary this whole module exists to hold.

| | Platform side | Chain side |
| --- | --- | --- |
| **Type** | `number` | `bigint` |
| **Unit** | whole US cents | token base units (6 decimals) |
| **Example** | `200` | `2_000_000n` |
| **Where it may appear** | everywhere | `src/chain/` only |
| **Scale between them** | `10_000` (`10^(6−2)`) | |

```ts
// src/chain/units.ts — the only file where the scale appears
export function toBaseUnits(cents: number): bigint
export function fromBaseUnits(base: bigint): number
```

**Validation rules** (R9):

| Rule | On violation |
| --- | --- |
| `cents` is an integer | throw `UnitConversionError` |
| `cents >= 0` | throw `UnitConversionError` |
| `cents <= Number.MAX_SAFE_INTEGER` | throw `UnitConversionError` |
| `base >= 0n` | throw `UnitConversionError` |
| `base % 10_000n === 0n` | throw `UnitConversionError` — **never round** |
| `base / 10_000n <= MAX_SAFE_INTEGER` | throw `UnitConversionError` |

The non-whole-cent rule is the important one: a base amount that does not divide
evenly means value entered the escrow through a path that bypassed this module, and
silently rounding it destroys the only evidence.

---

## 2. `DealState` — mirrors the contract enum

```ts
export enum DealState {
  None = 0,      // the zero value: "does not exist"
  Open = 1,
  Delivered = 2,
  Disputed = 3,
  Settled = 4,   // terminal, never left
}
```

**Order is significant** — these are the contract's `uint8` values, not labels.
Distinct from the database's `OrderState` (`src/entities/enums.ts`), which is finer:
the product tracks `running` and `failed`, the chain does not. Nothing in this module
converts between them; that mapping belongs to the orders module.

---

## 3. `Tier` — mirrors the contract enum, maps to `VerdictTier`

```ts
export enum Tier {
  NoRefund = 0,
  Quarter = 1,
  Half = 2,
  ThreeQuarter = 3,
  Full = 4,
}
```

Bidirectional, exhaustive mapping to the database's `VerdictTier` (R13). Typed as
`Record<VerdictTier, Tier>` so adding a tier on either side fails to compile until
both are updated.

| `Tier` | `VerdictTier` | Refund to buyer |
| --- | --- | --- |
| `NoRefund` (0) | `none` | 0% |
| `Quarter` (1) | `quarter` | 25% |
| `Half` (2) | `half` | 50% |
| `ThreeQuarter` (3) | `three_quarter` | 75% |
| `Full` (4) | `full` | 100% |

The names differ at index 0 (`NoRefund` vs `none`), which is why this is a table and
not a cast.

---

## 4. `OnChainDeal` — the mapped read

The contract's `deals(uint256)` getter returns an **11-element positional tuple**
(R12). This is its named form; the mapping happens in exactly one function.

| Field | Type | Tuple index | Notes |
| --- | --- | --- | --- |
| `agentId` | `bigint` | 0 | on-chain agent id, not the database UUID |
| `buyer` | `Address` | 1 | refund recipient |
| `seller` | `Address` | 2 | **snapshot** of `agent.owner` at purchase |
| `amountCents` | `number` | 3 | converted from base units on the way out |
| `defHash` | `Hex` | 4 | pinned definition hash |
| `defVersion` | `number` | 5 | pinned |
| `openedAt` | `Date` | 6 | starts the 24 h delivery deadline |
| `deliveredAt` | `Date \| null` | 7 | `null` when the raw value is `0` |
| `disputedAt` | `Date \| null` | 8 | `null` when the raw value is `0` |
| `reviewWindowSeconds` | `number` | 9 | per-deal, not a constant |
| `state` | `DealState` | 10 | |

**Conversions applied by the mapper**: base units → cents (field 3); `uint64` seconds
→ `Date` (fields 6–8, multiplying by 1000); `0` timestamp → `null` (fields 7–8).

Indices 6 and 7 are both `uint64` timestamps, so a transposition type-checks and
produces a plausible wrong answer. That is the reason the mapper is its own file.

---

## 5. `OnChainAgent` — the mapped read

From the `agents(uint256)` getter, a 5-element tuple.

| Field | Type | Index | Notes |
| --- | --- | --- | --- |
| `owner` | `Address` | 0 | payout address; `0x0…0` means not found |
| `priceCents` | `number` | 1 | converted from base units |
| `defHash` | `Hex` | 2 | |
| `version` | `number` | 3 | starts at 1 |
| `active` | `boolean` | 4 | gates **new** deals only |

---

## 6. `TxResult<T>` — what every write returns

```ts
export type TxResult<T = void> = {
  hash: Hex             // the explorer link the demo needs
  blockNumber: bigint
  gasUsed: bigint       // logged against the declared limit (R5)
  value: T              // the id for registerAgent / openDeal; void otherwise
}
```

A `TxResult` is only ever constructed from a receipt with `status === 'success'`.
A mined-but-reverted transaction becomes a thrown `ContractRevertError` (FR-009);
a receipt that never arrives becomes a thrown `ChainOutcomeUnknownError` carrying
the hash (FR-011). Those are the three, and only three, outcomes of a write.

`value` is populated from the receipt's event logs, never from the transaction's
return data — see R3.

| Operation | `T` | Recovered from |
| --- | --- | --- |
| `registerAgent` | `bigint` (agentId) | `AgentRegistered` log |
| `openDeal` | `bigint` (dealId) | `DealOpened` log |
| everything else | `void` | — |

---

## 7. Error hierarchy

Full taxonomy, decode rules, and the revert-string mapping in
[contracts/errors.md](./contracts/errors.md). The shape:

```
ChainError (abstract)
├── ChainConnectivityError        endpoint unreachable / RPC transport failure
├── ChainOutcomeUnknownError      receipt never arrived — carries `hash`
├── ContractRevertError           the escrow rejected it — carries `reason`
├── InsufficientAllowanceError    operator has not approved the escrow
├── InsufficientFundsError        the signing identity is out of MON
├── GasExhaustedError             the declared ceiling was too low
├── UnitConversionError           a guard in units.ts rejected an amount
├── DealNotFoundError             deals(id).state === None
└── AgentNotFoundError            agents(id).owner === 0x0…0
```

`ChainOutcomeUnknownError` is deliberately **not** a subclass of any failure type.
A caller catching "something went wrong" and retrying an `openDeal` opens a second
on-chain deal for one order — the precise thing invariant #1 forbids.

---

## 8. Configuration consumed

No new environment keys. Every value comes from the schema API-01 already validates
(`src/config/env.schema.ts`):

| Key | Used for |
| --- | --- |
| `MONAD_CHAIN_ID`, `MONAD_RPC_URL`, `MONAD_EXPLORER_URL` | the chain definition (R11) |
| `ESCROW_CONTRACT_ADDRESS` | every escrow call |
| `USDC_ADDRESS` | allowance and the token preflight |
| `OPERATOR_PRIVATE_KEY`, `GUARDIAN_PRIVATE_KEY` | the two signing accounts |
| `OPERATOR_ADDRESS`, `GUARDIAN_ADDRESS` | the role preflight |

Gas ceilings, the receipt timeout, and the allowance budget (`ALLOWANCE_TOPUP_CENTS`
= `1_000_000`, i.e. $10,000 — research R10) are **constants in code**, not
configuration — they are decisions with reasoning attached, not deployment knobs.

`FUNDER_PRIVATE_KEY` is not consumed here. The funder wallet belongs to API-04.
