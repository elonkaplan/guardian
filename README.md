# Guardian

**An AI audit agent that arbitrates disputes between agents — and executes the
refund.**

Built for the Rain × Monad hackathon.

> **Status:** contract complete and live; backend and frontend in progress.
> `sc/` is deployed, tested, and verified on-chain. `api/` and `ui/` are being built
> from the specs in each component's `docs/specs/`. Every architectural decision is
> written down in [`docs/`](./docs).

---

## The problem

Agents are starting to buy services from other agents. One that needs a document
summarised or a dataset cleaned can hire another agent and pay for it, with no human
in the loop.

That economy is missing something every human marketplace has: **recourse when the
work is bad.**

eBay has buyer protection. Upwork has dispute resolution. Credit cards have
chargebacks. All of them ultimately depend on a **human** reviewing evidence and
deciding who was right — which doesn't scale to thousands of agent-to-agent
transactions a minute, each too small to justify human attention, with a buyer that
may not even be a person.

> **If agents are going to trade with each other, something has to arbitrate when a
> trade goes wrong — and that something has to be an agent too.**

## What Guardian does

Guardian reads what the buyer asked for, what the seller's agent actually did, and
what it delivered — then rules on a refund and explains itself.

Because the money sits in a smart contract, **Guardian's ruling isn't a
recommendation anyone can ignore. It's executed.**

```
  Buyer                Marketplace           Escrow (Monad)          Seller Agent
    |                       |                       |                       |
    |-- buy service ------->|-- lock funds -------->|                       |
    |                       |                       |                       |
    |                       |-- run the agent ---------------------------->|
    |                       |<-- output + execution trace -----------------|
    |<-- delivery ----------|                       |                       |
    |                                                                       |
    |  [review window]                                                      |
    |                                                                       |
    |-- COMPLAIN ----------> GUARDIAN                                        |
    |                          reads: input · acceptance criteria           |
    |                                 listing promise · execution trace     |
    |                                 output · errors · timings             |
    |                          rules: 0 / 25 / 50 / 75 / 100 %              |
    |                                 + written reasoning + cited clauses   |
    |                                    |                                  |
    |<-- refund ------------------- escrow splits --------------> seller ---|
```

## Two ideas hold it up

**The platform runs the agents, so the platform owns the evidence.** Sellers submit
an agent *definition* — prompt, schemas, capability claims, exclusions — and the
marketplace executes it in an instrumented workspace. The audited party never
authors the record. Without this, Guardian would be grading a self-assessment.

**The money sits in escrow, so the verdict executes itself.** Guardian never has to
persuade anyone to pay. Without this, a verdict is a suggestion.

Two consequences worth naming:

- **Verdicts are tiers, enforced on-chain.** `resolve(dealId, Tier)` accepts one of
  five values and the contract computes the split — so the refund scale is an
  invariant the chain enforces, not a convention a model might drift from.
- **A compromised Guardian key can produce a wrong verdict and nothing worse.** It
  can only split money already escrowed, between two addresses fixed at purchase
  time. It cannot open deals or move funds anywhere else.

## The demo

**Act 1 — the complaint that gets rejected (0%).** A buyer asks for a summary under
100 words covering the pricing change. They get 85 words covering it, and complain
anyway. Guardian quotes the buyer's own word cap back at them and rules **0%**. The
seller is paid in full.

*This opens the demo deliberately: the first question anyone forms is "isn't this
just a free-refund button?" No. Guardian said no first.*

**Act 2 — the partial refund (50%).** A buyer hires LedgerBot on a receipt, asking
for all line items with totals. The receipt has 5; the agent returns 3. Guardian
names the two missing items and rules **50%**. The escrow splits live on screen.

*The audience can count the rows themselves and reach the verdict before Guardian
announces it. That's what makes the ruling feel checkable rather than magic.*

---

## Repository layout

```
guardian/
├── docs/     the design — start with product-workflow.md
├── sc/       Solidity escrow (Foundry, Monad Testnet)   ·  3 specs
├── api/      NestJS + TypeORM + PostgreSQL              · 11 specs
└── ui/       React + TypeScript + Vite                  ·  7 specs
```

Each component carries a `docs/CONTEXT.md` (the briefing) and `docs/specs/`
(implementable slices).

| Layer | Stack |
| --- | --- |
| Frontend | React · TypeScript · Vite · wagmi/viem |
| Backend | NestJS · TypeORM · PostgreSQL · viem · Anthropic SDK |
| Contract | Solidity 0.8.24 · Foundry (Monad fork) · Monad Testnet |
| Guardian's audit | `claude-opus-5`, structured outputs |
| Seller agents | `claude-haiku-4-5` |

## Getting started

**Prerequisites:** Node 20+, Docker, the [Monad Foundry
fork](https://docs.monad.xyz), and an Anthropic API key.

```bash
cp .env.example .env      # fill in keys and wallet addresses

# 1 — contract
cd sc && forge build
forge script script/Deploy.s.sol --rpc-url $MONAD_RPC_URL --broadcast
# paste ESCROW_CONTRACT_ADDRESS into ../.env, then approve the escrow
# from the operator wallet (see sc/README.md — this step is easy to miss)

# 2 — backend + database
cd ../api && docker compose up

# 3 — frontend
cd ../ui && npm install && npm run dev
```

**Four wallets need funding** from [faucet.monad.xyz](https://faucet.monad.xyz):
deployer (MON), funder (MON + test USDC), operator (MON), and **guardian (MON)** —
the last is the one that gets forgotten, and everything works until the first
dispute fails to settle.

---

## What's real, and what isn't

Worth stating plainly rather than leaving to be discovered.

| | |
| --- | --- |
| ✅ **Escrow on Monad Testnet** | Real contract, real transactions, real settlement |
| ✅ **Guardian's audit** | A real model reading a real case file and citing real clauses |
| ✅ **Agent execution** | Seller agents genuinely run and are genuinely instrumented |
| ⚠️ **Test money** | Test USDC on testnet. A funder wallet stands in for the bank. |
| ⚠️ **Rain integration — stubbed** | See below |
| ⛔ **Agent buyers** | Deferred. Buyers are human in the MVP. |

**On Rain.** We built the integration and found a real limitation: **Monad is not a
supported payment-route destination rail** — confirmed with Rain directly. Our escrow
is on Monad, so the onramp cannot deliver into it.

Rather than fake it, the onramp and offramp endpoints exist and **log the exact
request they would send**, then return without calling. A funder wallet supplies test
USDC instead. If a Monad rail ships, this becomes a config flag rather than a
feature.

**The escrow is deployed and its source is verified.**
[`0xe1b74F8dB511247786Ef61bde9330198a1929d53`](https://testnet.monadvision.com/address/0xe1b74F8dB511247786Ef61bde9330198a1929d53)
on Monad Testnet, verified via Sourcify with an exact bytecode match — so the
transaction hash on a verdict card leads to readable code, not a blob. The tier
splits, the role separation, and the permissionless exits are all checkable without
trusting us.

## Design docs

| Doc | What's in it |
| --- | --- |
| [product-workflow](./docs/product-workflow.md) | **Start here.** Product context, every decision, the demo acts |
| [product-block-schema](./docs/product-block-schema.md) | Blocks, state machine, flows |
| [agent-definition](./docs/agent-definition.md) | What a seller actually sells |
| [smart-contract](./docs/smart-contract.md) | Escrow spec, access control, timers, draft Solidity |
| [database-schema](./docs/database-schema.md) | 8 tables, DDL, where the money physically sits |
| [api-design](./docs/api-design.md) | Modules, endpoints, the purchase saga, cron jobs |
| [ui-design](./docs/ui-design.md) | Pages, flows, page→endpoint map |
| [rain-integration](./docs/rain-integration.md) | The Rain findings and the funder-wallet model |
| [tech-stack](./docs/tech-stack.md) | Stack, LLM choices, storage |
| [project-structure](./docs/project-structure.md) | Folders, Docker, Foundry, viem, Monad gotchas |
| [vendor-questions](./docs/vendor-questions.md) | What we asked Rain and Monad, and what they said |

---

*Guardian substitutes **enforceable recourse** for reputation. A buyer doesn't have
to trust a seller if a bad outcome is reversible — which is how an agent with no
track record gets its first customer.*
