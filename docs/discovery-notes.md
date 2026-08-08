# Guardian — Discovery Notes

Running capture of everything the user tells me about the product. This file is the source of
truth that feeds the eventual `spec.md`.

**Status**: in progress — details still being gathered.
**Last updated**: 2026-08-08

---

## Context

- **Event**: hackathon co-hosted by **Rain** and **Monad**.
- **Deliverable**: MVP for a live demo (not production).
- **Working name**: Guardian.
- **Repo state at kickoff**: empty. No code, no README. Spec Kit scaffolding only; constitution is
  an unfilled template.

## Sponsors / available platform surface

### Rain

- Fiat **onramp** and **offramp**.
- **Crypto cards** (card issuing / spending crypto balances).

### Monad

- **EVM-compatible blockchain** — standard EVM tooling and Solidity apply.
- Also runs **Memonex**: a **marketplace for agent memories** (agent-to-agent knowledge trading).

## Scope decision: no Memonex integration

**Memonex is out of scope for the hackathon MVP.** Instead we build **our own minimal
marketplace** covering the same shape of interaction. This marketplace is not the point of the
project — it is the **prerequisite substrate the Guardian feature runs on**, and it has to exist
for the demo to make sense.

### Marketplace MVP capabilities

1. **Register as a user.**
2. **List an agent for sale** — a seller publishes an agent service.
3. **Buy an agent service** — as a human user.
4. **Buy an agent service *as another agent*** — agent-to-agent purchase, paid with a
   **Rain crypto card that carries spending limits**.

Capability 4 is the interesting one: an autonomous agent spending real money on another agent's
service, bounded by card limits.

### Rain API — what the sandbox docs say

Reference: <https://rain-sandbox-trial.mintlify.site/reference/rain-api>
Base URL: `https://api-dev.raincards.xyz/v1` · Auth: `Api-Key` header.

Endpoint groups:

| Group | Purpose |
| --- | --- |
| **Cards** | Create **scoped** cards for users; fetch card by ID. Scoping is how spending controls are expressed. |
| **Transactions** | List transactions, fetch one by ID. This is our event feed. |
| **Payment Routes** | Fiat↔crypto conversion pathways (onramp / offramp). |
| **Payment Accounts** | Bank accounts for offramp payouts. |
| **Simulate** | Drive the **entire transaction lifecycle with no real fund movement**. |

Two things that matter for the demo:

- **`Simulate` is the demo lever.** We can run the full purchase lifecycle on stage without moving
  real money — removes the biggest live-demo risk.
- **Spending limits ride on scoped card creation**, so "issue an agent a card with limits" is a
  first-class API concept rather than something we have to build ourselves.
- Rate limits are generous (1k/min unauthenticated, 3k/hr card creation) — not a demo constraint.
- *Not yet read*: the exact shape of the limit/scope object on a card. Worth pulling the Cards
  sub-page before we finalise the architecture.

---

## THE MAIN FEATURE — Guardian

### The problem

A customer buys an agent service. The service runs. **The result is bad.** In an agent-to-agent
economy there is no human support desk, no chargeback culture, no reputation you can shout at.
The buyer — who may itself be an agent — has no recourse.

### What Guardian is

**Guardian is an audit agent that arbitrates disputes over agent service quality and executes
refunds.**

### The flow

1. Customer (human **or** agent) buys a service through the marketplace.
2. Customer receives the result and is **unhappy** with it.
3. Customer presses a **Complain** button.
4. **Guardian audits** three artifacts:
   - the **input** the customer gave to the seller agent,
   - the seller agent's **execution logs**,
   - the seller agent's **output**.
5. Guardian issues a **verdict**: `refund` / `no refund` / `partial refund` (with an amount).
6. Guardian **executes the refund** over Rain + Monad infrastructure.
7. Guardian returns **reasoned feedback** explaining how it reached the verdict.

The customer being possibly an *agent* is the load-bearing detail — the whole loop has to work
with no human in it, which is why the verdict must come with machine-readable reasoning and not
just a number.

### Why this needs both sponsors

- **Rain** — the payment rail. Cards, spend limits, and the refund/payout path.
- **Monad** — where the escrow and/or the tamper-evident record of verdicts can live.

---

---

## DECIDED — money movement

> "All of the money movement will be done via the Smart Contract. User gives fiat via the Rain
> card, agents are paid with Stable Coins on Monad."

- **Smart contract is the single mover of funds.** Escrow is settled — the contract holds the
  payment and executes Guardian's verdict.
- **Fiat in via the Rain onramp** → **stablecoin balance** (top-up; see product §7.7).
- **Agents are paid in stablecoin**, not fiat.
- Therefore **refunds settle on-chain in stablecoin**. No dependency on Rain charge reversals —
  which removes the unverified-endpoint risk flagged earlier. A Rain **offramp** back to fiat is a
  stretch goal, not core.

Answers open questions 1 and 2 below. Deeper technical shape (contract interface, token choice,
onramp mechanics) deferred — user: *"those are technical details, that's what we will discuss
next."*

---

## Open questions raised by the main feature

**Product decisions now live in [product-workflow.md](./product-workflow.md) §4 and §5.** This list
is kept as the audit trail of what was asked and how it resolved.

| #   | Question                                     | Status                                                                |
| --- | -------------------------------------------- | --------------------------------------------------------------------- |
| 1   | Where does the money sit during the window?  | **Answered** — escrow in a smart contract on Monad                    |
| 2   | Which rail carries the refund?               | **Answered** — on-chain, stablecoin on Monad                          |
| 3   | What exactly is an "agent log"?              | **Answered** — platform-run wrapped workspace (§6)                    |
| 4   | Who audits the auditor?                      | **Open, optional** — verdicts on Monad = tamper-evident trail, cheap  |
| 5   | Can the seller contest a verdict?            | **Answered** — no appeals in MVP (§4.4)                               |
| 6   | What stops a fraudulent complaint?           | **Answered** — Guardian's 0% verdict is the defence (§4.6)            |
| 7   | How is a partial refund amount decided?      | **Answered** — fixed tiers 0/25/50/75/100% (§4.2)                     |
| 8   | Is there a complaint time window?            | **Answered** — configurable, 24h default (§4.5)                       |
| 9   | What standard does Guardian judge against?   | **Answered** — listing promise + buyer's acceptance criteria (§4.1)   |
| 10  | Non-delivery as well as bad quality?         | **Answered** — both in scope (§4.3)                                   |
| 11  | Who pays for arbitration?                    | **Answered** — free in MVP (§4.7)                                     |
| 12  | Agent buyers: who decides to complain?       | **Answered** — the agent, autonomously (§4.8)                         |
| 13  | What do the demo agents sell?                | **Answered** — LedgerBot / TLDR Agent / PolyglotAI, 3 acts (§5)       |

### Q3 — resolved

**The marketplace runs the agents.** Sellers submit an agent *definition*; the platform executes it
in a **wrapped LLM workspace** that instruments the run. Evidence is produced by the platform, not
by the party being audited. Full write-up in
[product-workflow.md](./product-workflow.md) §6.

### Deferred to the technical pass

User: *"All of that are technical and implementation questions to be discussed later"* — these are
deliberately kept **out of** [product-workflow.md](./product-workflow.md).

- **Prize-track requirements** — is any sponsor tech mandatory to qualify?
**Resolved since:**

- ~~Surfaces~~ — **React + Vite web app plus a NestJS API.** Settled by the stack
  choice and the block schema (Marketplace App + Agent API). No CLI, no bot.
- ~~Verdicts anchored on-chain (Q4)~~ — **in.** `verdictHash` rides on the
  `resolve()` call we already make, so it costs one field.
- ~~Contract interface~~ — drafted in [smart-contract.md](./smart-contract.md).
- ~~Token choice on testnet~~ — **test USDC**, 6 decimals.
- ~~Sandboxing/isolation of seller agent code~~ — **moot.** Sellers submit a prompt
  and schemas, never code ([agent-definition.md](./agent-definition.md) §7), so
  there is nothing to sandbox.
- **Deploy target: Monad Testnet** (chain 10143), settling in test USDC. Never
  mainnet — no real funds anywhere in this project. Pairs with Rain's sandbox
  `Simulate` endpoint so both money rails are test-mode end to end.

- ~~Team size~~ — **solo builder, with unlimited Claude.** See the note below on what
  that does and doesn't change.

**Still genuinely open:**

- **Hours remaining** — still unstated. Matters for exactly one decision: whether to
  attempt the Rain fiat leg at all, since it is both the largest integration
  unknown and explicitly droppable (§7.8.1).
- **Prize tracks** — is any sponsor tech mandatory to qualify? Low impact now (we
  use both sponsors substantially), but it could reorder priorities.

## What "solo + unlimited Claude" actually changes

Worth being precise, because it changes the plan less than it first appears.

**Removed as constraints:** code volume, boilerplate, API familiarity, writing three
seller agents, drafting schemas and migrations. None of these are the bottleneck any
more.

**Unchanged:**

- **Integration unknowns.** Rain's sandbox and Monad's testnet will behave however
  they behave. Claude cannot make a faucet dispense faster or a sandbox endpoint
  exist. This was the **single largest risk to the demo** — now roughly halved:
  **Rain's CTO is on site**, so a Rain-side blocker is a conversation, not an
  investigation. Monad-side unknowns remain unmitigated.
- **Wall-clock serial time** — deploys, faucets, RPC flakiness, waiting on
  confirmations.
- **Review bandwidth.** Every decision routes through one person. That's the other
  real ceiling, and it's why the docs carry recommendations rather than option
  menus.
- **Rehearsal.** The three acts need to be run end to end more than once. Budget for
  it explicitly; it is the thing solo builders cut first and regret.

**Planning consequence:** front-load the integration spikes (Rain sandbox, Monad
deploy) ahead of anything that only needs code. Finding out at hour 20 that the Rain
sandbox needs an approval step nobody mentioned is the failure mode worth spending
the first hour to rule out.
- Onramp mechanics — the Rain integration, next work item.
- Run-record schema — product-level requirements are in §6.3; the concrete shape
  lands with the Postgres schema.

## Observations to confirm

- A `memonex` skill is already installed in this environment; its description says trades settle
  **on Base with USDC**, not Monad. If Guardian is meant to hit a Monad prize track via Memonex,
  worth confirming which chain the marketplace actually settles on.
