# Guardian — Escrow Contract Specification

> ✅ **BUILT AND DEPLOYED.** This began as a design under review; it is now
> implemented, tested, and live.
>
> | | |
> | --- | --- |
> | Implementation | [`../sc/src/GuardianEscrow.sol`](../sc/src/GuardianEscrow.sol) |
> | Tests | 81 Foundry tests — the project's only suite |
> | Deployed | `0xe1b74F8dB511247786Ef61bde9330198a1929d53` on Monad Testnet |
> | Source | **Verified** on MonadVision via Sourcify, `exact_match` |
> | Exercised | Full dispute lifecycle run on-chain — see §12 |
>
> The appendix Solidity is the original sketch, kept for the record. **The shipped
> contract is `sc/src/`**, not the appendix.

**Chain**: **Monad Testnet** (EVM-equivalent) — see §3.6. **Settlement token**: test USDC.
**Last updated**: 2026-08-08
**Companion docs**: [product-workflow.md](./product-workflow.md) ·
[agent-definition.md](./agent-definition.md) · [tech-stack.md](./tech-stack.md)

> **Reading `§` references.** A bare `§` means *this document*. References to other
> docs are prefixed — `product §4.2`, `tech-stack §7.2`.

---

## Contents

**Reviewing for the first time?** Read [§2 Data types](#2-data-types),
[§4.1 Access control at a glance](#41-access-control-at-a-glance), and
[§11 Open questions](#11-open-questions). Everything else is supporting detail.

- [1. Changes to the proposed model, and why](#1-changes-to-the-proposed-model-and-why)
  - [1.1 Drop `agent.balance` — one ledger, keyed by address](#11-drop-agentbalance--one-ledger-keyed-by-address)
  - [1.2 `refund` is not an entity — it's a resolution on the deal](#12-refund-is-not-an-entity--its-a-resolution-on-the-deal)
  - [1.3 One `openDeal`, not two — the buyer/agent difference is off-chain](#13-one-opendeal-not-two--the-buyeragent-difference-is-off-chain)
  - [1.4 "Complain → stake money from agent" — there's nothing left to stake](#14-complain--stake-money-from-agent--theres-nothing-left-to-stake)
  - [1.5 The tier enum belongs in the contract, not just the prompt](#15-the-tier-enum-belongs-in-the-contract-not-just-the-prompt)
  - [1.6 Split `OPERATOR` from `GUARDIAN`](#16-split-operator-from-guardian)
  - [1.7 Add permissionless `release()`, `reclaim()`, and `forceResolve()`](#17-add-permissionless-release-reclaim-and-forceresolve)
  - [1.8 Also added](#18-also-added)
- [2. Data types](#2-data-types)
  - [2.1 `DealState` — where a deal is in its life](#21-dealstate--where-a-deal-is-in-its-life)
  - [2.2 `Tier` — the five verdicts, on-chain](#22-tier--the-five-verdicts-on-chain)
  - [2.3 `Agent` — a listed, purchasable agent](#23-agent--a-listed-purchasable-agent)
  - [2.4 `Deal` — one purchase](#24-deal--one-purchase)
  - [2.5 A note on units — the classic bug](#25-a-note-on-units--the-classic-bug)
- [3. Storage, constants, and roles](#3-storage-constants-and-roles)
  - [3.1 Storage](#31-storage)
  - [3.2 Where the escrowed money physically sits](#32-where-the-escrowed-money-physically-sits)
  - [3.3 The solvency invariant](#33-the-solvency-invariant)
  - [3.4 Constants](#34-constants)
  - [3.5 Roles](#35-roles)
  - [3.6 Deployment target — Monad Testnet](#36-deployment-target--monad-testnet)
- [4. Functions](#4-functions)
  - [4.1 Access control at a glance](#41-access-control-at-a-glance)
  - [4.2 Agent registry](#42-agent-registry) — `registerAgent`, `updateAgent`, `setAgentActive`
  - [4.3 Deal lifecycle](#43-deal-lifecycle) — `openDeal`, `markDelivered`, `accept`, `release`, `reclaim`
  - [4.4 Dispute](#44-dispute) — `dispute`, `resolve`, `forceResolve`
  - [4.5 Money out](#45-money-out) — `withdraw`
- [5. Events](#5-events)
- [6. How the freeze actually works](#6-how-the-freeze-actually-works)
  - [6.1 A contract cannot act on its own](#61-a-contract-cannot-act-on-its-own)
  - [6.2 The three timers](#62-the-three-timers)
  - [6.3 Someone must poke it — this is a backend job](#63-someone-must-poke-it--this-is-a-backend-job)
  - [6.4 A gap the timers exposed, and the fix](#64-a-gap-the-timers-exposed-and-the-fix)
  - [6.5 One caveat: `block.timestamp` is approximate](#65-one-caveat-blocktimestamp-is-approximate)
- [7. State machine — contract vs. product](#7-state-machine--contract-vs-product)
- [8. Security properties worth stating out loud](#8-security-properties-worth-stating-out-loud)
- [9. Deliberate non-goals](#9-deliberate-non-goals)
- [10. Centralisation, stated honestly](#10-centralisation-stated-honestly)
- [11. Open questions](#11-open-questions)
  - [11.1 Resolved — no user input needed](#111-resolved--no-user-input-needed)
  - [11.2 Build checklist, not design questions](#112-build-checklist-not-design-questions)
  - [11.3 Accepted risks — deliberately not fixing for the MVP](#113-accepted-risks--deliberately-not-fixing-for-the-mvp)
- [Appendix — draft Solidity](#appendix--draft-solidity)

---

## 1. Changes to the proposed model, and why

The starting sketch was: `user`, `agent(id, owner, price, balance)`, `deal(agent,
wallet)`, `refund(deal, amount)`; functions for buyer-deal, agent-deal, complain,
resolve, withdraw. Seven changes.

### 1.1 Drop `agent.balance` — one ledger, keyed by address

The sketch has money accumulating per agent, then sellers pulling from their agents
and withdrawing. That's two hops and two pieces of state for one outcome.

Replaced with a single `balances[address]` — the standard **pull-payment** ledger. A
seller owning three agents accumulates into one balance and calls `withdraw()` once.
Per-agent revenue is a *reporting* question, answered from events off-chain, not
something the contract should carry.

### 1.2 `refund` is not an entity — it's a resolution on the deal

A verdict produces exactly one settlement: how much to the buyer, how much to the
seller. That's two numbers at the moment the deal settles, not a separate record
with its own lifecycle.

### 1.3 One `openDeal`, not two — the buyer/agent difference is off-chain

The sketch separates "make deal from buyer (staked)" from "make deal from agent
(grabbed)". **On-chain these are identical**: tokens move into escrow and a buyer
address is recorded as the refund recipient.

The difference lives entirely off-chain: a human buyer spends from a topped-up
balance; an agent buyer spends against a Rain card limit. By the time value reaches
the contract it is already stablecoin and the distinction has evaporated. *(Agent
buyers are deferred for the MVP — but the contract needs no change if they return,
which is the point.)*

Keeping them separate would duplicate logic and — worse — imply the contract
enforces spend limits. **It doesn't, and shouldn't.** Rain is the leash (product §7.8.1),
which is exactly what keeps Rain load-bearing rather than decorative.

### 1.4 "Complain → stake money from agent" — there's nothing left to stake

**Confirmed with the user: this is a freeze.** By complaint time the money is
already in escrow; it went there at purchase and never reached the seller. A
complaint moves no value — it stops the review window from expiring into an
automatic release.

### 1.5 The tier enum belongs in the contract, not just the prompt

`resolve(dealId, amount)` would let Guardian settle on any arbitrary number.
`resolve(dealId, Tier)` restricts it to **0 / 25 / 50 / 75 / 100** and computes the
split on-chain.

This turns product §4.2 from *a prompt convention the model might drift from* into
**an invariant the chain enforces**. A compromised Guardian key still cannot invent a 37%
split.

### 1.6 Split `OPERATOR` from `GUARDIAN`

One privileged key doing everything means a leak is total. Guardian's key is the one
attached to an autonomous LLM — scoping it to *"split money already escrowed,
between two addresses fixed at purchase time"* means the worst-case compromise is a
wrong verdict, not a drained contract. Full role table in §3.5.

### 1.7 Add permissionless `release()`, `reclaim()`, and `forceResolve()`

None were in the sketch, and without them **the platform can hold funds hostage by
going quiet** — and a dead Guardian would freeze disputed funds forever. Escrow that
only the operator can open isn't escrow, it's custody. See §6.

### 1.8 Also added

- **`defHash` / `defVersion` pinned on the deal** — the commitment from
  [agent-definition.md](./agent-definition.md) §5, so a dispute is judged against
  the definition version that actually ran.
- **`verdictHash` stored on resolve** — the tamper-evident audit anchor. One field
  on a call we're already making, which retires the "optional enhancement" flagged
  in discovery-notes Q4.

---

## 2. Data types

### 2.1 `DealState` — where a deal is in its life

| # | Name | Meaning |
| --- | --- | --- |
| 0 | `None` | Deal does not exist. The default for any unset id. |
| 1 | `Open` | Paid and escrowed. The agent has not delivered yet. |
| 2 | `Delivered` | Output delivered. The review window is running. |
| 3 | `Disputed` | Buyer complained. Frozen, awaiting Guardian. |
| 4 | `Settled` | **Terminal.** Funds credited. Nothing further is possible. |

`Settled` is reached from four different paths (accept, release, resolve, reclaim)
and is never left. That single fact is what makes product §4.4 — *verdicts are
final* — structurally true rather than a policy we promise to honour.

### 2.2 `Tier` — the five verdicts, on-chain

| # | Name | Refund to buyer | Product meaning (product §4.2) |
| --- | --- | --- | --- |
| 0 | `NoRefund` | 0% | Work met the promise. Complaint rejected. |
| 1 | `Quarter` | 25% | Minor shortfall — **also the inconclusive-evidence default** (product §7.4) |
| 2 | `Half` | 50% | Substantial shortfall — roughly half the ask met |
| 3 | `ThreeQuarter` | 75% | Severe shortfall — mostly unusable |
| 4 | `Full` | 100% | Total failure or non-delivery |

Guardian chooses **only** which of these five applies. It never supplies an amount.

### 2.3 `Agent` — a listed, purchasable agent

| Field | Type | Set at | Mutable? | Meaning |
| --- | --- | --- | --- | --- |
| `owner` | `address` | `registerAgent` | No | Seller's payout address |
| `price` | `uint256` | `registerAgent` | `updateAgent` | Price per purchase, in **token base units** — see §2.5 |
| `defHash` | `bytes32` | `registerAgent` | `updateAgent` | `keccak256` of the canonical agent definition |
| `version` | `uint32` | `registerAgent` → 1 | `updateAgent` → +1 | Definition version number |
| `active` | `bool` | `registerAgent` → true | `setAgentActive` | Whether **new** deals may be opened. Never affects deals already running. |

Only the on-chain commitment lives here. The definition itself — prompt, schemas,
capabilities, exclusions — is in Postgres (tech-stack §7.2).

### 2.4 `Deal` — one purchase

| Field | Type | Set at | Meaning |
| --- | --- | --- | --- |
| `agentId` | `uint256` | `openDeal` | Which agent was bought |
| `buyer` | `address` | `openDeal` | Refund recipient |
| `seller` | `address` | `openDeal` | **Snapshot** of `agent.owner` at purchase — see note |
| `amount` | `uint256` | `openDeal` | Escrowed value (= `agent.price` at that moment) |
| `defHash` | `bytes32` | `openDeal` | **Pinned** — the definition that actually ran |
| `defVersion` | `uint32` | `openDeal` | **Pinned** version number |
| `openedAt` | `uint64` | `openDeal` | Unix seconds. Starts `DELIVERY_DEADLINE`. |
| `deliveredAt` | `uint64` | `markDelivered` | Unix seconds, `0` until delivered. Starts `reviewWindow`. |
| `disputedAt` | `uint64` | `dispute` | Unix seconds, `0` until disputed. Starts `DISPUTE_DEADLINE`. |
| `reviewWindow` | `uint32` | `openDeal` | Seconds the buyer has to complain |
| `state` | `DealState` | throughout | §2.1 |

**Why `seller` is a snapshot, not a lookup.** If we read `agents[agentId].owner` at
payout time, transferring agent ownership mid-deal would redirect money for work the
*previous* owner's agent performed. Snapshotting at purchase makes the payee
immutable for the life of the deal.

**Why `defHash` and `defVersion` are pinned.** Without them, a seller could soften
their own `capabilities` after a bad delivery and win the dispute retroactively.
Judging against the pinned version closes that.

### 2.5 A note on units — the classic bug

`price` and `amount` are in the token's **base units**, not dollars. USDC has 6
decimals:

| Display | On-chain value |
| --- | --- |
| $2.00 (LedgerBot) | `2_000_000` |
| $1.00 (TLDR Agent) | `1_000_000` |
| $1.50 (PolyglotAI) | `1_500_000` |

Never pass a float. Convert once, at the boundary, in the backend.

---

## 3. Storage, constants, and roles

### 3.1 Storage

| Name | Type | Notes |
| --- | --- | --- |
| `token` | `IERC20` (immutable) | The settlement token. Fixed at deploy — cannot be swapped. |
| `agents` | `mapping(uint256 => Agent)` | The registry |
| `deals` | `mapping(uint256 => Deal)` | Every deal, forever |
| `balances` | `mapping(address => uint256)` | **The pull-payment ledger.** Withdrawable funds per address. |
| `totalEscrowed` | `uint256` | Sum of all live (unsettled) deal amounts — see below |
| `nextAgentId` | `uint256` | Counter, starts at **1** |
| `nextDealId` | `uint256` | Counter, starts at **1** |

Ids start at 1 so that `0` unambiguously means "not found" — a mapping lookup on an
unknown id returns a zero-filled struct, which `state == None` and
`owner == address(0)` then detect.

### 3.2 Where the escrowed money physically sits

**There is no `escrow` field, and that's the part worth explaining** — nothing in
the struct list says "the money is here", so it looks missing.

The tokens are held **by the contract itself**. `openDeal` calls:

```solidity
token.safeTransferFrom(msg.sender, address(this), a.price);
```

`address(this)` is the escrow. From that moment the tokens belong to the contract
address in the **ERC-20 token's own ledger** — not in any field of ours. Our storage
holds no money; it holds **claims on money**, and its only job is deciding who may
take what.

So the money moves through three phases:

| Phase | Where the tokens are | What our storage says | Withdrawable? |
| --- | --- | --- | --- |
| **1. Escrowed** | Contract address | `deals[id].amount`, with `state != Settled` | ❌ No — nobody can touch it |
| **2. Credited** | Still the contract address | `balances[addr]`, deal now `Settled` | ✅ Yes, by that address |
| **3. Withdrawn** | The recipient's wallet | `balances[addr] == 0` | Gone — it has left the contract |

Note that **phase 1 → 2 moves no tokens at all.** Settlement is pure bookkeeping: a
deal's `amount` stops being a locked claim and becomes one or two entries in
`balances`. The only transaction that actually moves tokens out is `withdraw()`.
That's what makes settlement reentrancy-free (§8.1).

### 3.3 The solvency invariant

At every moment this must hold:

```
token.balanceOf(contract)  >=  totalEscrowed  +  Σ all balances
                               └─ phase 1 ─┘     └─ phase 2 ─┘
```

**`>=`, not `==`** — anyone can send tokens directly to the contract address, which
raises `balanceOf` without any corresponding claim. Such tokens are simply stranded
(no function can pay them out), which is harmless but does mean an equality check
would produce false alarms. If the balance ever falls **below** the right-hand side,
that is a genuine bug: funds credited without being escrowed, or credited twice.

**`totalEscrowed` exists to make the left half of that checkable on-chain** (Solidity
cannot iterate a mapping, so without a running counter there is no way to sum live
deals). It increments in `openDeal` and decrements on every settlement path.

It's also the number the demo UI should display: **"$X currently held in escrow"**
is a good thing to have on screen while the audience watches a dispute resolve.

### 3.4 Constants

| Name | Type | Value | Gates |
| --- | --- | --- | --- |
| `DELIVERY_DEADLINE` | `uint32` | 24 hours | After this, an undelivered deal is reclaimable by the buyer |
| `DISPUTE_DEADLINE` | `uint32` | 72 hours | After this, an unresolved dispute can be force-settled by anyone |

`reviewWindow` is deliberately **not** a constant — it's per-deal, so the demo can
run seconds while production defaults to 24h (product §4.5).

### 3.5 Roles

| Role | Held by | Can | Cannot |
| --- | --- | --- | --- |
| `DEFAULT_ADMIN_ROLE` | Deployer / multisig | Grant and revoke the two roles below | Touch funds or deals directly |
| `OPERATOR_ROLE` | The NestJS backend | Register/update agents, open deals, mark delivery, open disputes | Move escrowed funds anywhere |
| `GUARDIAN_ROLE` | The audit agent's key | Resolve a **disputed** deal into a tiered split | Open deals, register agents, choose addresses or amounts |

The separation is the point: Guardian's key is the one attached to an autonomous
LLM, so it holds the narrowest possible authority.

### 3.6 Deployment target — Monad Testnet

**We deploy to Monad Testnet. Never mainnet.** No real funds are involved at any
point in this project.

**✅ Confirmed with Monad.** These are verified values, not inferred ones.

| | |
| --- | --- |
| **Network** | Monad Testnet |
| **Chain ID** | `10143` |
| **RPC** | `https://testnet-rpc.monad.xyz` |
| **Explorer** | `https://testnet.monadvision.com` |
| **Gas token** | MON (test) — faucet: <https://faucet.monad.xyz> |
| **Settlement token** | Test USDC, 6 decimals — `0x534b2f3A21130d7a60830c2Df862319e593943A3` |
| **Block time / finality** | **Sub-second** |
| **Deployed escrow** | `0xe1b74F8dB511247786Ef61bde9330198a1929d53` — source verified on MonadVision |

All of it lives in `.env`; nothing is hardcoded.

**Two consequences worth carrying forward:**

**Sub-second finality removes a whole class of UI work.** The plan allowed for
optimistic UI states in case confirmation took ten seconds and left the screen
frozen mid-purchase. It doesn't — a transaction lands faster than the 1s UI poll, so
the honest state is always the confirmed one. The 3s sweeper interval is generous
rather than tight.

**✅ Contract source is verified on MonadVision.** Verified via Sourcify with an
`exact_match` on the runtime bytecode — so a judge clicking the verdict card's
transaction hash reaches **readable, verified escrow code**, not an opaque blob.

That matters more here than usual: the tier splits, the role separation, and the
permissionless exits are the claims the product rests on, and all three are now
independently checkable by someone who doesn't trust us at all.

Deployed at `0xe1b74F8dB511247786Ef61bde9330198a1929d53`. Verification command in [`../sc/README.md`](../sc/README.md).

**Consequences worth being explicit about:**

- **All three demo acts settle in test USDC.** The dollar figures in the product doc
  ($2.00 LedgerBot, etc.) are denominated in test tokens — real to the demo, worth
  nothing.
- **Rain's sandbox pairs with this naturally** (discovery-notes: Rain's `Simulate`
  endpoint drives the full card lifecycle with no real fund movement). Both money
  rails are therefore in test mode end to end — no real money touches the demo.
- **Say this on stage.** "Testnet and sandbox" is the honest framing and nobody
  penalises it at a hackathon; being caught implying otherwise would be much worse.
- Chain config (RPC URL, chain ID, contract addresses) belongs in environment
  variables from the first commit, so a mainnet deploy later is a config change and
  not a code change.

---

## 4. Functions

### 4.1 Access control at a glance

Every entry point and who may call it. **"Anyone"** means genuinely anyone — the
buyer, the seller, our backend, an unrelated bot, a judge in the audience. That is
deliberate, not an oversight: see the note below the table.

| Function | Operator | Guardian | Buyer | Seller | Anyone | Time gate |
| --- | :---: | :---: | :---: | :---: | :---: | --- |
| `registerAgent` | ✅ | — | — | — | — | — |
| `updateAgent` | ✅ | — | — | — | — | — |
| `setAgentActive` | ✅ | — | — | — | — | — |
| `openDeal` | ✅ | — | — | — | — | — |
| `markDelivered` | ✅ | — | — | — | — | — |
| `accept` | ✅ | — | ✅ | — | — | Any time while `Delivered` |
| `dispute` | ✅ | — | ✅ | — | — | **Only** during window |
| `release` | ✅ | ✅ | ✅ | ✅ | ✅ | **After** window expires |
| `reclaim` | ✅ | ✅ | ✅ | ✅ | ✅ | After `DELIVERY_DEADLINE` |
| `resolve` | — | ✅ | — | — | — | — |
| `forceResolve` | ✅ | ✅ | ✅ | ✅ | ✅ | After `DISPUTE_DEADLINE` |
| `withdraw` | ✅ | ✅ | ✅ | ✅ | ✅ | — (pays `msg.sender` only) |
| `withdrawFor` | ✅ | ✅ | ✅ | ✅ | ✅ | — (pays the named account only) |
| `grantRole` / `revokeRole` | — | — | — | — | — | Admin only |

**Reading the three permissionless rows.** `release`, `reclaim`, and `forceResolve`
are open to everyone *on purpose*. Each one can only push a deal past a deadline
that has already passed, into the single outcome the rules already dictate — the
caller chooses nothing. Restricting them would hand the platform a way to strand
funds by staying silent, which is the difference between escrow and custody.

`withdraw` is likewise open to anyone, but a caller can only ever move **their own**
balance, so there is nothing to exploit.

**Three things nobody can do**, in any role:

- Move escrowed funds to an address not recorded on the deal
- Settle a deal twice, or reopen a settled one
- Change the split Guardian chose, or choose a split outside the five tiers

**Per-function detail follows.** Each entry: **who may call**, **what it requires**,
**what it changes**, **what it emits**.

### 4.2 Agent registry

#### `registerAgent(owner, price, defHash) → agentId`

| | |
| --- | --- |
| **Caller** | `OPERATOR` |
| **Requires** | `owner != address(0)` |
| **Effect** | Creates an `Agent` at the next id with `version = 1`, `active = true` |
| **Returns** | The new `agentId` |
| **Emits** | `AgentRegistered` |

Operator-registered rather than seller-self-registered so sellers need no wallet
interaction or gas during the demo. See §11.2 — this is a deliberate tradeoff.

#### `updateAgent(agentId, price, defHash)`

| | |
| --- | --- |
| **Caller** | `OPERATOR` |
| **Requires** | Agent exists |
| **Effect** | Replaces `price` and `defHash`; **increments `version`** |
| **Emits** | `AgentUpdated` |

Deals already open are unaffected — they carry their own pinned `defHash`/`version`.

#### `setAgentActive(agentId, active)`

| | |
| --- | --- |
| **Caller** | `OPERATOR` |
| **Requires** | Agent exists |
| **Effect** | Toggles whether **new** deals may be opened. Running deals continue. |

### 4.3 Deal lifecycle

#### `openDeal(agentId, buyer, reviewWindow) → dealId`

| | |
| --- | --- |
| **Caller** | `OPERATOR` |
| **Requires** | Agent `active`; `buyer != address(0)`; caller has approved `agent.price` to this contract |
| **Effect** | Pulls `agent.price` from the caller into escrow. Creates a `Deal` in state `Open`, snapshotting seller, amount, `defHash`, `defVersion`, and `openedAt`. |
| **Returns** | The new `dealId` |
| **Emits** | `DealOpened` |

Tokens come **from the operator**, not the buyer — the buyer paid by card and may
hold no wallet at all. See §10.

#### `markDelivered(dealId)`

| | |
| --- | --- |
| **Caller** | `OPERATOR` |
| **Requires** | State is `Open` |
| **Effect** | State → `Delivered`; sets `deliveredAt`, which **starts the review window** |
| **Emits** | `Delivered` |

#### `accept(dealId)`

| | |
| --- | --- |
| **Caller** | The `buyer`, or `OPERATOR` on their behalf |
| **Requires** | State is `Delivered` |
| **Effect** | State → `Settled`; credits the **full amount** to the seller's balance |
| **Emits** | `Released` |

The buyer accepting early (product §7.9).

#### `release(dealId)`

| | |
| --- | --- |
| **Caller** | **Anyone** |
| **Requires** | State is `Delivered` **and** `now ≥ deliveredAt + reviewWindow` |
| **Effect** | State → `Settled`; credits the full amount to the seller |
| **Emits** | `Released` |

Permissionless by design: **a seller must never depend on the platform to get paid.**

#### `reclaim(dealId)`

| | |
| --- | --- |
| **Caller** | **Anyone** |
| **Requires** | State is `Open` **and** `now ≥ openedAt + DELIVERY_DEADLINE` |
| **Effect** | State → `Settled`; credits the **full amount** back to the buyer |
| **Emits** | `Reclaimed` |

The nothing-ever-arrived escape hatch. A buyer's money can never be stranded by a
silent platform.

### 4.4 Dispute

#### `dispute(dealId)`

| | |
| --- | --- |
| **Caller** | The `buyer`, or `OPERATOR` on their behalf |
| **Requires** | State is `Delivered` **and** `now < deliveredAt + reviewWindow` |
| **Effect** | State → `Disputed`; sets `disputedAt`. **No value moves** — the funds are already escrowed. |
| **Emits** | `Disputed` |

The complaint window closes exactly when the review window does. Complain, or accept
the release.

#### `resolve(dealId, tier, verdictHash)`

| | |
| --- | --- |
| **Caller** | `GUARDIAN` |
| **Requires** | State is `Disputed` |
| **Effect** | Splits the escrow by tier: `toBuyer = amount × tierBps / 10000`, `toSeller = amount − toBuyer`. Credits both balances. State → `Settled`. |
| **Emits** | `Resolved` (carrying tier, both amounts, and `verdictHash`) |

`verdictHash` anchors the off-chain verdict text on-chain — the tamper-evidence
argument from tech-stack §7.2.

#### `forceResolve(dealId)`

| | |
| --- | --- |
| **Caller** | **Anyone** |
| **Requires** | State is `Disputed` **and** `now ≥ disputedAt + DISPUTE_DEADLINE` |
| **Effect** | Settles at **`Tier.Quarter`** with an empty `verdictHash` |
| **Emits** | `Resolved` |

Guardian never ruled. See §6.4 for why 25% is the right default rather than an
arbitrary one.

### 4.5 Money out

#### `withdraw()`

| | |
| --- | --- |
| **Caller** | **Anyone with a balance** — buyers and sellers alike |
| **Requires** | `balances[caller] > 0` |
| **Effect** | Zeroes the balance **first**, then transfers the tokens |
| **Emits** | `Withdrawn` |

One function for both sides — product §7.8's symmetric payout. The fiat leg (Rain offramp)
happens off-chain afterwards.

#### `withdrawFor(account)`

| | |
| --- | --- |
| **Caller** | **Anyone** |
| **Requires** | `balances[account] > 0` |
| **Effect** | Zeroes `account`'s balance, then transfers the tokens **to `account`** |
| **Emits** | `Withdrawn` |

**Why this exists.** The user flow is *"all smart-contract operations are performed
via the Operator"* — but `withdraw()` pays `msg.sender`, so an operator calling it
would send every payout **to the operator**. `withdrawFor` makes the payee explicit.

Safe to leave permissionless: a caller can only ever move `account`'s balance **to
`account`**, so there is nothing to gain by calling it for someone else — beyond
paying their gas for them.

Keep both: `withdrawFor` for the operator-driven flow, `withdraw()` so a user can
always self-serve without the platform.

---

## 5. Events

Everything the frontend and the demo need. Every state change emits.

| Event | Fields | Fired by |
| --- | --- | --- |
| `AgentRegistered` | `agentId`, `owner`, `price`, `defHash` | `registerAgent` |
| `AgentUpdated` | `agentId`, `version`, `price`, `defHash` | `updateAgent` |
| `DealOpened` | `dealId`, `agentId`, `buyer`, `amount`, `defHash`, `defVersion` | `openDeal` |
| `Delivered` | `dealId`, `at` | `markDelivered` |
| `Released` | `dealId`, `seller`, `amount` | `accept`, `release` |
| `Disputed` | `dealId`, `at` | `dispute` |
| `Resolved` | `dealId`, `tier`, `toBuyer`, `toSeller`, `verdictHash` | `resolve`, `forceResolve` |
| `Reclaimed` | `dealId`, `buyer`, `amount` | `reclaim` |
| `Withdrawn` | `account`, `amount` | `withdraw` |

`Resolved` is the money shot for the demo — tier and split, on-chain, with a
clickable transaction hash.

---

## 6. How the freeze actually works

The user asked whether freezing money for a period is doable. It is, and it's above
— but the mechanic is worth stating precisely, because it's the most common
misconception about smart contracts.

### 6.1 A contract cannot act on its own

**There is no cron, no scheduler, no "in 24 hours, do X".** A contract is inert
between transactions; it runs only when someone sends it one. Time is **passive** —
it decides which calls are *permitted*, never which calls *happen*.

So "freeze the money for 24 hours" is implemented as a **refusal**: every path out
is closed until the deadline passes. That half is fully automatic and needs nobody.
What is *not* automatic is the exit — after the deadline, somebody still has to send
a transaction.

### 6.2 The three timers

| Timer | Scope | Gates | Effect |
| --- | --- | --- | --- |
| `reviewWindow` | Per deal (24h default) | `release()` blocked before; `dispute()` blocked after | The buyer's window to complain; the seller's wait to be paid |
| `DELIVERY_DEADLINE` | Global, 24h | `reclaim()` | Nothing delivered → buyer takes 100% back |
| `DISPUTE_DEADLINE` | Global, 72h | `forceResolve()` | Guardian never ruled → default outcome applies |

### 6.3 Someone must poke it — this is a backend job

Because nothing self-executes, the platform needs a **sweeper**: a scheduled job
that finds deals whose window has expired and calls `release()`. Without it a seller
stays unpaid indefinitely even though the contract would happily allow payment.

- **Production** — a NestJS cron job, every few minutes.
- **Demo** — a fast poller (every few seconds), so a ~30s review window visibly
  auto-releases on stage. That is Act 1's ending.
- **The safety net** — because `release()` is permissionless, a seller the platform
  never sweeps can send the transaction themselves. The sweeper is a convenience,
  not a trust dependency.

### 6.4 A gap the timers exposed, and the fix

Writing the timers out surfaced a real hole in the first draft: **`Disputed` was the
one state with no exit.** If Guardian's key were lost or the service died, those
funds were frozen *permanently* — every other state had a permissionless escape,
that one did not.

Fixed with `DISPUTE_DEADLINE` + `forceResolve()`. The interesting part is which
default it applies: **the 25% tier**, because product §7.4 already says inconclusive
evidence resolves toward the seller at 25%, and a timeout is the ultimate unproven
case. The product's own principle supplies the fallback, so it isn't an arbitrary
rule bolted on.

### 6.5 One caveat: `block.timestamp` is approximate

Validators have a few seconds of latitude over the timestamp they report.
Irrelevant for 24h and 72h windows. Worth knowing if the demo window gets short —
don't go below ~30 seconds, or block jitter becomes visible on stage.

---

## 7. State machine — contract vs. product

The on-chain states are a **coarser** view of the product state machine
(product-block-schema §2). Execution states live off-chain because they cost gas and
prove nothing.

| Product state | On-chain |
| --- | --- |
| `PURCHASED` | `Open` |
| `RUNNING` | *(off-chain)* |
| `DELIVERED` | `Delivered` |
| `FAILED` | *(off-chain; `reclaim()` is the on-chain backstop)* |
| `RELEASED` | `Settled` via `accept` / `release` |
| `DISPUTED` | `Disputed` |
| `ADJUDICATED` + `SETTLED` | `Settled` via `resolve` / `forceResolve` |

---

## 8. Security properties worth stating out loud

1. **Pull payments everywhere.** Settlement only credits `balances`; the sole token
   transfer out is `withdraw()`, which zeroes the balance before transferring. No
   reentrancy surface on settlement.
2. **Guardian cannot steal.** It picks one of five tiers on an already-disputed
   deal. Buyer and seller addresses were fixed at `openDeal`. Worst case from a
   compromised Guardian key is a **wrong verdict**, not a drained contract.
3. **Operator cannot steal.** No operator function moves escrowed funds to an
   operator-chosen address.
4. **Neither can stall, and no state can hang.** `release()`, `reclaim()`, and
   `forceResolve()` are permissionless once their deadlines pass. Every state has an
   exit that does not require the platform's cooperation — including a dead Guardian.
5. **Verdicts are final and singular.** Every path sets `Settled` before crediting,
   and every entry point requires a specific prior state — so a deal cannot be paid
   twice. Product §4.4 (no appeals) enforced by the state machine, not by policy.

---

## 9. Deliberate non-goals

| Not in the contract | Where it lives instead |
| --- | --- |
| **Agent spend limits** | Rain cards (product §2.3, product §7.8.1) — on-chain limits would duplicate Rain and weaken the sponsor story |
| Fiat on/off ramp | Rain; the contract only ever sees stablecoin |
| Complaint bonds | Ruled out — the 0% verdict is the deterrent (product §4.6) |
| Reputation / ratings | Future work (product §7.6) |
| Arbitration fees | Free in MVP (product §4.7) |
| Appeals | No appeals (product §4.4) — structurally impossible in the state machine |
| Agent definitions, run records, verdict text | Postgres; only hashes go on-chain (tech-stack §7.2) |

---

## 10. Centralisation, stated honestly

`openDeal` is `OPERATOR`-only, and funds are pulled from the platform's own token
balance — **not because the buyer lacks a wallet** (they connect one at
registration, §11.1) but because **the money arrives as fiat**. The buyer paid with
a card (product §7.7); the platform performed the fiat→stablecoin conversion and is
therefore the party holding the stablecoin at that moment.

The buyer's wallet is the **destination** for refunds and payouts, never the source
of the original payment.

This is an unavoidable consequence of a fiat on-ramp: **that leg cannot be
trustless.** What the contract still guarantees once value is inside it: the platform
cannot redirect, withhold, or double-spend escrowed funds, and both counterparties
can always exit without the platform's cooperation.

Worth saying plainly in the pitch rather than waiting to be asked.

---

## 11. Open questions

### 11.1 Resolved — no user input needed

1. ~~Should sellers self-register agents?~~ **No — operator registers.** We author
   all three demo sellers ourselves, so self-registration would add a wallet, gas,
   and a signing step to buy exactly nothing. Already the current design.

2. ~~Buyer wallet provisioning~~ **Users connect a wallet at registration; that
   address receives every payout.** User's call, and it's the faster build.

   **What this buys us — we never hold a private key.** No custodial key storage, no
   encryption at rest, no signing service, no "what if we lose the keys" question
   from a judge. `deal.buyer` is simply the address on the account.

   **The account model becomes:** wallet = identity + payout address; the Rain
   **onramp** funds the balance (product §7.7). One address per account covers
   buying, selling, and refunds — a seller who is also a buyer uses the same one,
   which is exactly what `balances[address]` already assumes (§1.1).

   **Side benefit worth knowing:** because every account now has a real wallet, the
   crypto-only fallback (product §7.8.1) becomes trivial — buyers could fund escrow
   directly if the onramp runs out of time. That de-risks the demo considerably.

### 11.2 Build checklist, not design questions

3. ~~Verify the Monad Testnet config~~ **✅ Confirmed with Monad** — chain ID, RPC,
   explorer, and test-USDC address are all in §3.6 and `.env`.
4. **Fund and approve the operator wallet** — `openDeal` pulls tokens from the
   operator, so that wallet needs test USDC *and* an ERC-20 `approve()` to the
   escrow contract before a single deal can open. Easy to forget until the first
   transaction reverts.
5. **Guard `reviewWindow` in the backend** — see the note at the end of §11.3.

### 11.3 Accepted risks — deliberately not fixing for the MVP

Per the user: *"don't pay attention for such edge cases."* Each of these needs an
adversarial actor, an unlucky race, or a non-standard dependency. None can occur
with the three demo agents on standard test USDC. Recorded so the omissions read as
decisions rather than oversights.

| Item | Why it's fine for the MVP |
| --- | --- |
| `reviewWindow` unbounded — `0` disables the buyer's recourse | Needs a hostile or broken operator; we hold that key |
| `openDeal` doesn't pin the price the buyer was quoted | Needs `updateAgent` to land inside the purchase window |
| Fee-on-transfer / rebasing tokens would break solvency | Test USDC is a standard ERC-20 |
| `accept` isn't window-gated but `dispute` is | Harmless — accepting only ever does what the lapse would have done |
| No emergency pause (`Pausable`) | Redeploy is faster than a pause at this size |

**One backend-side note carried over**, because it's a bug risk rather than an edge
case: if `reviewWindow` reaches the contract as `0` from a missing config or a JS
`undefined`, Acts 1 and 2 fail *silently* on stage — the window closes instantly and
Complain never works. A one-line guard where the backend builds the transaction
covers it, with no Solidity change.

---

## Appendix — draft Solidity

> ⚠️ **Sketch only.** Never compiled, never tested, never audited. Present to make
> §2–§5 concrete. Do not treat as implementation-ready.

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20}        from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20}     from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

/// @title GuardianEscrow
/// @notice Holds payment for an agent service until the buyer accepts, the review
///         window expires, or Guardian rules on a dispute.
contract GuardianEscrow is AccessControl {
    using SafeERC20 for IERC20;

    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");
    bytes32 public constant GUARDIAN_ROLE = keccak256("GUARDIAN_ROLE");

    IERC20 public immutable token;

    enum DealState { None, Open, Delivered, Disputed, Settled }
    enum Tier      { NoRefund, Quarter, Half, ThreeQuarter, Full }

    struct Agent {
        address owner;
        uint256 price;
        bytes32 defHash;
        uint32  version;
        bool    active;
    }

    struct Deal {
        uint256   agentId;
        address   buyer;
        address   seller;
        uint256   amount;
        bytes32   defHash;
        uint32    defVersion;
        uint64    openedAt;
        uint64    deliveredAt;
        uint64    disputedAt;
        uint32    reviewWindow;
        DealState state;
    }

    uint32 public constant DELIVERY_DEADLINE = 24 hours;
    uint32 public constant DISPUTE_DEADLINE  = 72 hours;

    mapping(uint256 => Agent)   public agents;
    mapping(uint256 => Deal)    public deals;
    mapping(address => uint256) public balances;

    /// Sum of all live (unsettled) deal amounts. Mappings can't be iterated, so
    /// this counter is the only way to assert solvency on-chain.
    uint256 public totalEscrowed;

    uint256 public nextAgentId = 1;
    uint256 public nextDealId  = 1;

    event AgentRegistered(uint256 indexed agentId, address indexed owner, uint256 price, bytes32 defHash);
    event AgentUpdated(uint256 indexed agentId, uint32 version, uint256 price, bytes32 defHash);
    event DealOpened(uint256 indexed dealId, uint256 indexed agentId, address indexed buyer, uint256 amount, bytes32 defHash, uint32 defVersion);
    event Delivered(uint256 indexed dealId, uint64 at);
    event Released(uint256 indexed dealId, address indexed seller, uint256 amount);
    event Disputed(uint256 indexed dealId, uint64 at);
    event Resolved(uint256 indexed dealId, Tier tier, uint256 toBuyer, uint256 toSeller, bytes32 verdictHash);
    event Reclaimed(uint256 indexed dealId, address indexed buyer, uint256 amount);
    event Withdrawn(address indexed account, uint256 amount);

    constructor(IERC20 _token, address admin, address operator, address guardian) {
        token = _token;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(OPERATOR_ROLE, operator);
        _grantRole(GUARDIAN_ROLE, guardian);
    }

    // ---------------------------------------------------------------- agents

    function registerAgent(address owner, uint256 price, bytes32 defHash)
        external onlyRole(OPERATOR_ROLE) returns (uint256 agentId)
    {
        require(owner != address(0), "bad owner");
        agentId = nextAgentId++;
        agents[agentId] = Agent(owner, price, defHash, 1, true);
        emit AgentRegistered(agentId, owner, price, defHash);
    }

    function updateAgent(uint256 agentId, uint256 price, bytes32 defHash)
        external onlyRole(OPERATOR_ROLE)
    {
        Agent storage a = agents[agentId];
        require(a.owner != address(0), "no agent");
        a.price    = price;
        a.defHash  = defHash;
        a.version += 1;
        emit AgentUpdated(agentId, a.version, price, defHash);
    }

    function setAgentActive(uint256 agentId, bool active) external onlyRole(OPERATOR_ROLE) {
        require(agents[agentId].owner != address(0), "no agent");
        agents[agentId].active = active;
    }

    // ----------------------------------------------------------------- deals

    function openDeal(uint256 agentId, address buyer, uint32 reviewWindow)
        external onlyRole(OPERATOR_ROLE) returns (uint256 dealId)
    {
        Agent memory a = agents[agentId];
        require(a.active, "agent inactive");
        require(buyer != address(0), "bad buyer");

        // The tokens now live at address(this) — this is the escrow.
        token.safeTransferFrom(msg.sender, address(this), a.price);
        totalEscrowed += a.price;

        dealId = nextDealId++;
        deals[dealId] = Deal({
            agentId:      agentId,
            buyer:        buyer,
            seller:       a.owner,
            amount:       a.price,
            defHash:      a.defHash,
            defVersion:   a.version,
            openedAt:     uint64(block.timestamp),
            deliveredAt:  0,
            disputedAt:   0,
            reviewWindow: reviewWindow,
            state:        DealState.Open
        });

        emit DealOpened(dealId, agentId, buyer, a.price, a.defHash, a.version);
    }

    function markDelivered(uint256 dealId) external onlyRole(OPERATOR_ROLE) {
        Deal storage d = deals[dealId];
        require(d.state == DealState.Open, "not open");
        d.state       = DealState.Delivered;
        d.deliveredAt = uint64(block.timestamp);
        emit Delivered(dealId, d.deliveredAt);
    }

    function accept(uint256 dealId) external {
        Deal storage d = deals[dealId];
        require(d.state == DealState.Delivered, "not delivered");
        require(msg.sender == d.buyer || hasRole(OPERATOR_ROLE, msg.sender), "not buyer");
        _payout(dealId, d);
    }

    function release(uint256 dealId) external {
        Deal storage d = deals[dealId];
        require(d.state == DealState.Delivered, "not delivered");
        require(block.timestamp >= d.deliveredAt + d.reviewWindow, "window open");
        _payout(dealId, d);
    }

    function _payout(uint256 dealId, Deal storage d) private {
        d.state = DealState.Settled;
        totalEscrowed     -= d.amount;   // leaves escrow, becomes a claim
        balances[d.seller] += d.amount;
        emit Released(dealId, d.seller, d.amount);
    }

    function reclaim(uint256 dealId) external {
        Deal storage d = deals[dealId];
        require(d.state == DealState.Open, "not open");
        require(block.timestamp >= d.openedAt + DELIVERY_DEADLINE, "too early");
        d.state = DealState.Settled;
        totalEscrowed    -= d.amount;
        balances[d.buyer] += d.amount;
        emit Reclaimed(dealId, d.buyer, d.amount);
    }

    // -------------------------------------------------------------- dispute

    function dispute(uint256 dealId) external {
        Deal storage d = deals[dealId];
        require(d.state == DealState.Delivered, "not delivered");
        require(msg.sender == d.buyer || hasRole(OPERATOR_ROLE, msg.sender), "not buyer");
        require(block.timestamp < d.deliveredAt + d.reviewWindow, "window closed");
        d.state      = DealState.Disputed;
        d.disputedAt = uint64(block.timestamp);
        emit Disputed(dealId, d.disputedAt);
    }

    function resolve(uint256 dealId, Tier tier, bytes32 verdictHash)
        external onlyRole(GUARDIAN_ROLE)
    {
        _settleDispute(dealId, tier, verdictHash);
    }

    function forceResolve(uint256 dealId) external {
        Deal storage d = deals[dealId];
        require(d.state == DealState.Disputed, "not disputed");
        require(block.timestamp >= d.disputedAt + DISPUTE_DEADLINE, "too early");
        _settleDispute(dealId, Tier.Quarter, bytes32(0));
    }

    function _settleDispute(uint256 dealId, Tier tier, bytes32 verdictHash) private {
        Deal storage d = deals[dealId];
        require(d.state == DealState.Disputed, "not disputed");

        uint256 toBuyer  = (d.amount * _refundBps(tier)) / 10_000;
        uint256 toSeller = d.amount - toBuyer;   // no dust: the split is exact

        d.state = DealState.Settled;
        totalEscrowed -= d.amount;
        if (toBuyer  > 0) balances[d.buyer]  += toBuyer;
        if (toSeller > 0) balances[d.seller] += toSeller;

        emit Resolved(dealId, tier, toBuyer, toSeller, verdictHash);
    }

    // ------------------------------------------------------------- withdraw

    function withdraw() external {
        withdrawFor(msg.sender);
    }

    /// @notice Pays `account`'s balance to `account`, whoever calls. Needed because
    ///         the operator drives every transaction on the user's behalf — a
    ///         msg.sender-only withdraw would send payouts to the operator.
    function withdrawFor(address account) public {
        uint256 amount = balances[account];
        require(amount > 0, "nothing to withdraw");
        balances[account] = 0;             // effects before interaction
        token.safeTransfer(account, amount);
        emit Withdrawn(account, amount);
    }

    function _refundBps(Tier t) private pure returns (uint256) {
        if (t == Tier.NoRefund)     return 0;
        if (t == Tier.Quarter)      return 2_500;
        if (t == Tier.Half)         return 5_000;
        if (t == Tier.ThreeQuarter) return 7_500;
        return 10_000;                      // Full
    }
}
```

---

## 12. Verified on-chain

The full dispute path was exercised against the deployed contract on Monad Testnet
(deal #2), not just in tests:

| Step | Result |
| --- | --- |
| `registerAgent` ($2.00) | ✅ 157,815 gas |
| `openDeal` | ✅ `totalEscrowed` = 2,000,000 |
| `markDelivered` | ✅ |
| `dispute` | ✅ escrow frozen |
| **`resolve` called by OPERATOR** | ✅ **reverted — wrong role** |
| `resolve` called by GUARDIAN, `Tier.Half` | ✅ `0x4be587c4…` |
| Split | ✅ buyer 1,000,000 · seller 1,000,000 |
| **`withdrawFor(buyer)` called by OPERATOR** | ✅ **buyer's USDC +1,000,000** |
| Solvency invariant (§3.3) | ✅ holds |

Three design claims are now demonstrated rather than asserted:

1. **The role split is enforced by the deployed contract** — the operator cannot
   resolve a dispute. This is the "a compromised Guardian key can do no worse than
   rule wrongly" argument, live.
2. **`withdrawFor` pays the recorded party, not the caller** — the operator called
   it and the *buyer's* wallet balance rose. That was the bug the function exists to
   prevent (§1.7).
3. **The 50% split is exact** — 2,000,000 in, 1,000,000 each out, escrow back to
   zero. Act 2's arithmetic, on-chain.

**What this bought the build:** when the API wires up `resolve`, the contract is no
longer a variable. A failure there is an API failure — one unknown instead of two.
