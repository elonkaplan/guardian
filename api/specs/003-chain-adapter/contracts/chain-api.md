# Contract: the `chain/` module's exported surface

Everything the rest of the backend may call, and nothing else. Types are defined in
[../data-model.md](../data-model.md).

**The narrowing rule** (FR-005): the three viem clients are `private readonly` fields
on their services. They are never exported, never injected, and never returned. A
caller who wants to sign something must go through a wrapper below, which is what
makes the guardian's one-function ABI an actual guarantee rather than a convention.

---

## `EscrowReadService`

No signing key. Every method here is a free `eth_call`.

```ts
totalEscrowedCents(): Promise<number>
```
Sum of all live, unsettled deal amounts, in cents. The number the demo screen shows.

```ts
balanceOfCents(account: Address): Promise<number>
```
What `account` may withdraw, in cents. Returns `0` for an address with nothing owed —
never throws for that case (FR-018).

```ts
getDeal(dealId: bigint): Promise<OnChainDeal>
```
Throws `DealNotFoundError` when `state === DealState.None`. Never returns a
zero-filled record (FR-020).

```ts
getAgent(agentId: bigint): Promise<OnChainAgent>
```
Throws `AgentNotFoundError` when `owner` is the zero address.

```ts
explorerTxUrl(hash: Hex): string
```
Built from `MONAD_EXPLORER_URL`. Convenience for the UI and the demo; no chain access.

---

## `EscrowOperatorService`

Signs with `OPERATOR_PRIVATE_KEY`. Every method simulates first, then writes with an
explicit gas ceiling (R4), waits for one confirmation, and returns a `TxResult`.

**Registry**

```ts
registerAgent(owner: Address, priceCents: number, defHash: Hex): Promise<TxResult<bigint>>
updateAgent(agentId: bigint, priceCents: number, defHash: Hex): Promise<TxResult>
setAgentActive(agentId: bigint, active: boolean): Promise<TxResult>
```

`registerAgent` returns the new agent id, read from the `AgentRegistered` log (R3).

**Deal lifecycle**

```ts
openDeal(agentId: bigint, buyer: Address, reviewWindowSeconds: number): Promise<TxResult<bigint>>
markDelivered(dealId: bigint): Promise<TxResult>
accept(dealId: bigint): Promise<TxResult>
release(dealId: bigint): Promise<TxResult>
reclaim(dealId: bigint): Promise<TxResult>
```

`openDeal` calls `ensureAllowance` before simulating (FR-012, R10) and returns the new
deal id from the `DealOpened` log. It takes no amount — the contract charges
`agent.price` from its own storage.

**Dispute**

```ts
dispute(dealId: bigint): Promise<TxResult>
forceResolve(dealId: bigint): Promise<TxResult>
```

`forceResolve` is here rather than on the guardian service: it is permissionless, it
chooses nothing, and giving the guardian key a second callable function would weaken
the property FR-003 buys.

**Money out**

```ts
withdrawFor(account: Address): Promise<TxResult>
```

**`withdraw()` is deliberately not wrapped.** It pays `msg.sender`; called by the
operator it would send every user's payout to the operator. Its absence is the
mechanism, not an oversight — see research R15.

**Allowance**

```ts
ensureAllowance(requiredCents: number): Promise<TxResult | null>
```
Reads the current allowance (free). Returns `null` when it is already sufficient;
otherwise approves `ALLOWANCE_TOPUP_CENTS` ($10,000) and returns the approval's
`TxResult`. Idempotent and safe to call before every `openDeal`.

**Against the current deployment this always returns `null`** — the deploy runbook
already granted an effectively unbounded allowance, accepted as-is
([research R10](../research.md)). The top-up branch exists for a *fresh* deployment,
which starts at zero allowance and would otherwise fail the first purchase with an
ERC-20 error nobody was expecting. Unexercised, not dead.

---

## `EscrowGuardianService`

Signs with `GUARDIAN_PRIVATE_KEY`. **One method. There is no second one, and there
cannot be** — the client is constructed with an ABI containing only `resolve`, so any
other `functionName` is a type error (FR-003).

```ts
resolve(dealId: bigint, tier: VerdictTier, verdictHash: Hex): Promise<TxResult>
```

Takes the **database's** `VerdictTier` string and maps it to the contract's `uint8`
internally (R13), so no caller ever handles the numeric index.

---

## `ChainPreflightService`

```ts
check(): Promise<PreflightReport>
```

Four free reads at boot: chain id, settlement token address, token decimals, and both
role grants (R11). **Logs warnings; never throws, never blocks startup** — the
existing placeholder convention requires the API to boot before the contract is
deployed, and `ESCROW_CONTRACT_ADDRESS` is a placeholder today.

---

## Constants (`chain.constants.ts`)

Not configuration. Each is a decision with its reasoning in a comment.

| Constant | Value | Source |
| --- | --- | --- |
| `GAS_LIMITS` | per-operation table | research R5 |
| `RECEIPT_TIMEOUT_MS` | `30_000` | research R7 |
| `RECEIPT_CONFIRMATIONS` | `1` | research R7 |
| `ALLOWANCE_TOPUP_CENTS` | `1_000_000` ($10,000) | research R10 |
| `CENTS_TO_BASE_SCALE` | `10_000n` | research R9 — **appears nowhere else** |

---

## What this module does not export

Stated so that a later reviewer can check the boundary is intact:

- No viem client, wallet, account, or transport
- No raw private key or anything derived from one
- No ABI (the three ABI files are internal)
- No `bigint` amounts in base units — every amount crossing the boundary is cents
- No database access, no entity, no repository
- No business rule, no order state, no product decision
