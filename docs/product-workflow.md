# Guardian — Product Context & Workflow

**Status**: product definition closed. **Read the scope note below before building
from this document.**

> ## ⚠️ MVP scope — what was cut after this document was written
>
> This doc describes the **full product**. Two things were later cut for the
> hackathon MVP, and the sections describing them are marked **[DEFERRED]** inline:
>
> | Cut | Sections affected |
> | --- | --- |
> | **Agent buyers** (autonomous buying agents + Rain spend-limited cards) | §2.3, §2.4, §4.8, §5.3 Act 3, §7.3 |
> | **Per-purchase card charges** — replaced by onramp top-up | §7.7 (already rewritten) |
>
> **Buyers are humans only in the MVP**, so **Act 3 cannot be staged** and the demo
> is two acts. See [database-schema.md](./database-schema.md) §2.1 for the reasoning
> and a cheap restore path.
>
> Deferred sections are kept rather than deleted — the design is sound, and it's the
> obvious first thing to add after the hackathon.

**Last updated**: 2026-08-08
**Companion docs**: [product-block-schema.md](./product-block-schema.md) — blocks, state machine,
and flows · [agent-definition.md](./agent-definition.md) — what a seller actually sells ·
[tech-stack.md](./tech-stack.md) — stack and LLM choices ·
[discovery-notes.md](./discovery-notes.md) — raw capture of decisions as they were made.

---

## 1. Product context

### The world we're building for

Agents are starting to buy services from other agents. An agent that needs a document
summarised, a dataset cleaned, or an image generated can hire another agent to do it and pay for
it — without a human in the loop at any point.

That economy is missing something every human marketplace has: **recourse when the work is bad.**

eBay has buyer protection. Upwork has dispute resolution. Credit cards have chargebacks. All of
them ultimately depend on a **human** reviewing evidence and deciding who was right. That doesn't
scale to a world where thousands of agent-to-agent transactions happen per minute, each too small
to justify human attention, with a buyer that may not even be a person.

### The product thesis

> **If agents are going to trade with each other, something has to arbitrate when a trade goes
> wrong — and that something has to be an agent too.**

**Guardian is an AI audit agent that reviews disputed agent services and rules on refunds.** It
reads what the buyer asked for, what the seller agent actually did, and what it delivered — then
decides whether the buyer gets their money back, and how much.

Because the money lives in a smart contract, Guardian's ruling isn't a recommendation anyone can
ignore. It's executed.

### Who it's for

| Actor        | Who they are                                                      | What they want                                                           |
| ------------ | ----------------------------------------------------------------- | ------------------------------------------------------------------------ |
| **Buyer**    | A human user, **or another agent** spending on its owner's behalf | Confidence that paying an unknown agent isn't a coin flip                |
| **Seller**   | Someone who has built an agent and lists it for hire              | Customers who'll take a chance on them without an established reputation |
| **Guardian** | The audit agent — the product                                     | Rule fairly, fast, and explain itself                                    |
| **Platform** | The marketplace substrate we build to make the above demonstrable | A trade loop that actually closes                                        |

### Why both sponsors are load-bearing

- **Rain** — the on-ramp from the real economy. Buyers fund via the Rain **onramp** (§7.7).
  *(Full product: agent buyers carry **spend-limited cards** — deferred, see the scope note.)*
- **Monad** — where value settles and disputes resolve. Agents are paid in **stablecoins**; the
  **escrow contract** holds funds and executes Guardian's verdicts.

### What makes it worth building

Trust in a marketplace normally comes from **reputation**, which needs history — a brutal
cold-start problem for a brand-new agent. Guardian substitutes **enforceable recourse** for
reputation. A buyer doesn't have to trust the seller if a bad outcome is reversible. That lets an
agent with zero track record get its first customer.

---

## 2. The workflow

### 2.1 Happy path — the trade that goes fine

```
  Buyer                Marketplace            Escrow (Monad)          Seller Agent
    |                       |                       |                       |
  [funded earlier via Rain onramp — fiat -> stablecoin balance]              |
    |                       |                       |                       |
    |-- buy service ------->|                       |                       |
    |   from balance        |-- lock funds -------->|                       |
    |                       |                       |                       |
    |                       |-- dispatch job ---------------------------->  |
    |                       |                       |          (runs, emits logs)
    |                       |<-- output + logs ---------------------------  |
    |<-- delivery ----------|                       |                       |
    |                       |                       |                       |
    |  [review window]      |                       |                       |
    |                       |                       |                       |
    |-- accept (or expire ->|-- release ----------->|-- pay in stablecoin ->|
```

**Steps:**

0. **Funding** (once, not per purchase) — the buyer tops up through the **Rain onramp**: fiat in,
   stablecoin balance out. See §7.7.
1. **Purchase** — buyer picks a listed agent service and states their **acceptance criteria**
   (§4.1). The price moves **from their balance into escrow** — locked, never in the seller's
   hands.
2. **Execution** — the seller agent runs the job in the platform's wrapped workspace (§6),
   producing an **output** and an **execution log**.
3. **Delivery** — buyer receives the output.
4. **Review window** — opens on delivery. Configurable, 24h default (§4.5).
5. **Settlement** — buyer accepts, or the window expires. Escrow **releases to the seller** in
   stablecoin.

### 2.2 Dispute path — where Guardian earns its keep

```
    |  [review window]
    |
    |-- COMPLAIN ------------------------------------> Guardian
    |     (+ reason)                                       |
    |                                                      |
    |                          gathers the case file:      |
    |                            - buyer's original input  |
    |                            - seller's execution logs |
    |                            - seller's output         |
    |                            - the listing's promise   |
    |                                                      |
    |                          audits & reasons            |
    |                                                      |
    |                          VERDICT ------------------->|
    |                            refund / partial(x) / none|
    |                                                      |
    |<-- reasoned feedback --------------------------------|
    |                                                      v
    |                                          Escrow splits funds
    |<-- refund (stablecoin) ----------------------|-----> seller's share
```

**Steps:**

6. **Complaint** — instead of accepting, the buyer presses **Complain** and states what's wrong.
   Escrow is frozen — nothing releases while a dispute is open.
7. **Evidence assembly** — Guardian pulls the **case file**: the input the buyer supplied, the
   seller agent's logs, the output delivered, and what the listing **promised**.
8. **Audit** — Guardian evaluates the delivered work against what was promised and what was asked.
9. **Verdict** — one of:
   - **Full refund** — the service failed.
   - **Partial refund (amount)** — partially delivered, or delivered late/degraded.
   - **No refund** — the work was sound; the buyer's complaint doesn't hold.
10. **Settlement** — the escrow contract **splits the locked funds** per the verdict. Buyer's share
    returns as stablecoin; seller's share pays out.
11. **Feedback** — Guardian issues **reasoned feedback** to both parties: what it examined, what it
    concluded, why. Human-readable for people, structured for agent buyers.

### 2.3 Provisioning a buying agent  **[DEFERRED — not in MVP]**

*Design retained for post-hackathon. Buyers are humans only in the MVP.*

Before an agent can buy anything, its owner sets it up. This happens **once, up front**:

1. **Create** the buying agent.
2. **Assign a budget** — a Rain card with a **total limit** and a **per-purchase cap**.
3. **Give it a task** — the goal it will go shopping to accomplish.

Then the agent transacts on its own within that leash.

**This is the product's answer to "isn't it terrifying to let an agent spend money?"** The owner's
control is exercised **once, at provisioning** — not as per-transaction approval, which would
defeat the point of autonomy. The limits are the leash; inside them the agent is free.

The **task** is what makes the rest of §2.4 possible: an agent can only judge an output "unusable"
because it has a goal to judge it against. Without an assigned task there is nothing for it to
evaluate, and nothing for it to complain about.

### 2.4 The agent-as-buyer variant  **[DEFERRED — not in MVP]**

The same loop, with **no human anywhere in it**:

- The buying agent holds a **Rain card with spend limits** — its purchase authority is capped by
  its owner up front.
- It buys, receives, and **evaluates** the output against its own goal.
- If the output is unusable, **it files the complaint itself**.
- Guardian's verdict comes back **machine-readable**, so the buying agent can act on it — retry,
  pick a different seller, or escalate to its owner.

This is why the verdict must carry structured reasoning rather than just a refund amount: the
recipient may have no eyes.

---

## 3. Scope boundary for the hackathon MVP

**Guardian is the product.** The marketplace is scaffolding — build the thinnest version that
makes a dispute demonstrable, and no more.

| Build (needed for the demo to make sense)         | Skip                                          |
| ------------------------------------------------- | --------------------------------------------- |
| Register as user                                  | Reviews, ratings, search, discovery           |
| List an agent for sale                            | Seller onboarding flows, KYC                  |
| Buy a service (human buyer)                       | Multi-currency, price negotiation             |
| Buy a service (agent buyer, spend-limited card)   | Real agent hosting infrastructure             |
| Escrow lock / release / split                     | Partial delivery, milestones, subscriptions   |
| **Complaint → Guardian audit → verdict → refund** | Appeals, reputation effects, arbitration fees |

---

## 4. Product decisions

Confirmed by the user. These are settled unless revisited.

### 4.1 The standard Guardian judges against

Guardian rules against **two yardsticks together**, never against "the buyer is unhappy":

1. **The seller's listing promise** — what the agent publicly claims it does.
2. **The buyer's acceptance criteria** — what "done right" means for *this specific order*, stated
   by the buyer **at purchase time**, before any work happens.

This is the backbone of a defensible verdict: Guardian can **quote the exact clause** the output
failed. It also means acceptance criteria are a **required field at checkout**, not an
afterthought — a buyer who never said what they wanted has a much weaker case, and that's correct.

Guardian's own general judgment is a tiebreaker, never the primary basis.

### 4.2 Partial refunds are tiered

Guardian does not emit free-form percentages. It selects a **tier**:

| Tier     | Meaning                                                            |
| -------- | ------------------------------------------------------------------ |
| **0%**   | Work met the promise and the criteria. Complaint rejected.         |
| **25%**  | Minor shortfall — delivered, with a defect that doesn't break use. |
| **50%**  | Substantial shortfall — roughly half the ask was met.              |
| **75%**  | Severe shortfall — token effort, mostly unusable.                  |
| **100%** | Total failure or non-delivery.                                     |

Tiers keep verdicts explainable on stage and stop the model producing spuriously precise numbers
like "37% refund".

### 4.3 Non-delivery is in scope

Guardian handles **both** failure modes:

- **Non-delivery** — the agent crashed, timed out, or returned nothing. Near-automatic **100%**;
  the absence of output is self-evident in the logs.
- **Bad quality** — something was delivered but falls short. Requires the full audit.

### 4.4 Verdicts are final

**No appeals in the MVP.** Guardian rules once and the escrow executes. Seller appeals, escalation
to human review, and multi-round arbitration are explicitly **future work** — noted here so it
reads as a decision, not an oversight.

### 4.5 Review window

**Configurable, defaulting to 24 hours.** Production-realistic. For the live demo the value is
turned down to seconds so an uncontested trade visibly auto-releases on stage.

### 4.6 Frivolous complaints

**Guardian ruling against them is the defence.** A buyer who complains about sound work gets a
**0% verdict** with reasoning that cites the promise and criteria the output actually met — and
the seller is paid in full.

This makes the **rejected complaint just as important to demo as the upheld one**: it's the proof
that Guardian is an auditor and not a refund button. Stronger deterrents (complaint-rate limits,
staking, fees on frivolous claims) are future work.

### 4.7 Arbitration is free

**No arbitration fee in the MVP.** Fee models — loser pays, platform cut, subscription — are
future work.

### 4.8 Agent buyers complain autonomously  **[DEFERRED — not in MVP]**

A buying agent files its own complaint **without consulting its owner**. It evaluates the output
against its own goal and acts. The owner's control is exercised **up front** via the Rain card's
spend limits, not per-transaction approval.

This is the sharpest expression of the thesis: a full trade-and-dispute cycle with no human in it.

---

## 5. The demo

**Approved by the user.**

### 5.1 Design principle

Pick services where "did the agent do the job?" is **countable, not a matter of taste**. Countable
failures make Guardian read as an *auditor* rather than an opinion generator: it can say
*"you promised 5 line items and returned 3"* instead of *"the summary felt thin."*

### 5.2 Seller agents in the demo marketplace

| Agent           | Service                                                       | Price |
| --------------- | ------------------------------------------------------------- | ----- |
| **LedgerBot**   | Messy receipt/invoice text → structured line items with totals | $2.00 |
| **TLDR Agent**  | Long document → summary under a word cap                       | $1.00 |
| **PolyglotAI**  | Text → target language, preserving product names               | $1.50 |

Receipt extraction is the workhorse: correctness is literally a **row count**, which maps directly
onto the refund tiers in §4.2. Missing 2 of 5 line items makes a 50% verdict *arithmetic* rather
than a judgment call.

### 5.3 Three acts, one per verdict

#### Act 1 — the rejected complaint (0%)

A **human buyer** purchases a summary from **TLDR Agent**.
Acceptance criteria: *"under 100 words, must cover the pricing change."*
Output: 85 words, covers the pricing change. The buyer complains anyway — *"too short."*

**Verdict: 0%.** Guardian quotes the buyer's own word cap back at them. Seller paid in full.

*Why the demo opens here:* it front-loads the answer to the question every judge is already
forming — *"isn't this just a free-refund button?"* No. Guardian said no first.

#### Act 2 — the partial refund (50%)

A **human buyer** hires **LedgerBot** on a receipt.
Acceptance criteria: *"extract all line items with totals."*
The receipt has **5** line items; LedgerBot returns **3** and drops two.

**Verdict: 50%.** Guardian names the two missing items. Escrow splits live on screen —
**$1.00 back to the buyer, $1.00 to the seller.**

*Why this is the centrepiece:* the audience can count the rows themselves and reach the verdict
**before Guardian does**. That's what makes the ruling feel trustworthy instead of magic.

#### Act 3 — the autonomous full refund (100%)  **[DEFERRED — not in MVP]**

> *Cannot be staged without agent buyers. **The demo is Acts 1 and 2.*** The escrow
> paths Act 3 covered (full refund, `reclaim`) still exist on-chain and are testable
> — they just aren't performed live.*

A **buying agent**, carrying a **spend-limited Rain card**, hires **PolyglotAI**.
The seller agent crashes and returns nothing.
The buying agent detects the failure and **files the complaint itself**.

**Verdict: 100%.** Funds return, and the agent **retries with a different seller**.
**No human touches this act.**

*Why the demo closes here:* it's the entire thesis in 30 seconds — a machine bought something, got
cheated, sought arbitration, won, and moved on.

### 5.4 Why this shape

The acts are ordered so the demo **argues** rather than merely displays:

> **Guardian is fair** → **Guardian is precise** → **Guardian works without us.**

Each act also exercises a different escrow path — **full release**, **split**, **full refund** — so
the contract is completely demonstrated by the end of the run.

### 5.5 Demo rig — stated honestly

The seller agents must **fail on cue**. They will be built with a deterministic **demo mode**:
seeded inputs that reliably produce the intended output, rather than hoping a live model
misbehaves on schedule.

This is a **demo-rig decision, recorded up front** — not something to discover at 4am. Guardian's
audit itself runs for real; only the seller agents' failure modes are scripted.

---

## 6. Agent execution & logging

**Decided by the user.**

> Every agent sold on the marketplace must capture working logs of *what* it did and *how*. Agents
> run inside an **LLM workspace provided by the platform**, wrapped so the run is instrumented.

### 6.1 The rule

**Sellers do not host their own agents. The marketplace runs them.**

A seller lists an agent by submitting its **definition** — prompt, tools, configuration. When a
buyer purchases the service, the platform executes that definition inside a **wrapped workspace**
that records the run as it happens.

### 6.2 Why this is the right call

The evidence Guardian audits is **produced by the platform, not by the party being audited.** If
sellers self-reported their logs, the defendant would be writing the court record — the first
question from any judge, and a fatal one.

It also has a happy side effect: sellers integrate by **doing nothing**. There's no SDK to adopt,
no logging contract to honour, no way to forget. The instrumentation is not optional because it
isn't theirs.

And it makes **non-delivery objectively detectable** (§4.3): if the agent crashes or times out, the
wrapper records the crash. Guardian isn't taking anyone's word that nothing arrived.

### 6.3 What a run record contains

Captured automatically by the wrapper. *(Exact schema is a technical-design item — this is the
product-level requirement for what must be in there.)*

| Captured                 | Why Guardian needs it                                             |
| ------------------------ | ----------------------------------------------------------------- |
| **Buyer's input**        | One half of the yardstick — what was actually asked                |
| **Acceptance criteria**  | The other half — what "done right" meant for this order (§4.1)     |
| **Listing promise**      | What the seller publicly claimed the agent does                    |
| **Execution steps**      | *How* the work was done — reasoning turns, tool calls, retries     |
| **Final output**         | What the buyer received                                            |
| **Errors / crashes**     | Makes non-delivery self-evident                                    |
| **Timing**               | Detects timeouts and supports "delivered late" shortfalls          |

Together these form the **case file** Guardian reads in dispute-path step 7 (§2.2).

The **execution steps** matter more than they first appear: they're what lets Guardian distinguish
*"the agent genuinely tried and the task was impossible"* from *"the agent returned a stub without
attempting the work."* Those deserve different verdicts, and only the trace can tell them apart.

### 6.4 Consequences to accept

- **Sellers are constrained** to agents expressible in the platform's workspace. Real-world that's
  a meaningful limit on the catalogue; for the MVP — where we author all three seller agents
  ourselves — it costs nothing.
- **The platform bears execution cost and isolation risk.** Sandboxing untrusted seller code is a
  genuine production concern, explicitly **out of scope for the MVP**.

---

## 7. Workflow decisions

Gaps found while walking the buyer / seller / agent workflows end to end. **All confirmed by the
user.**

Delivery, stack, and implementation questions are **out of scope for this document** — they're
tracked in [discovery-notes.md](./discovery-notes.md) for the technical pass.

### 7.1 A listing declares capabilities *and* exclusions

The listing promise is **half of Guardian's yardstick** (§4.1), so a vague listing produces vague
verdicts. Beyond name, description, and price, a seller must declare:

- **Capability claims** — what the agent does.
- **Exclusions** — what it explicitly does *not* handle ("does not handle handwritten receipts").

Exclusions are the quiet, valuable half: **they're how a seller defends itself in advance.** An
exclusion turns a fuzzy "well, was that reasonable to expect?" argument into a clause Guardian can
cite verbatim.

### 7.2 Buyer criteria are checked at *dispute* time, not purchase time

A buyer can demand something the listing never promised. The order **goes through anyway**; if the
buyer then complains, Guardian rules **0%** on the grounds that the seller never promised it.

Purchase-time validation was rejected for the MVP: it's a whole extra matching problem, and letting
the mismatch reach Guardian **demos better** — it shows Guardian defending a *seller* against an
unreasonable buyer, which is the opposite of what people expect a refund system to do.

### 7.3 Refunds restore an agent buyer's spending limit  **[DEFERRED — not in MVP]**

Refunded amounts return to the agent's **available** limit on its Rain card.

**Act 3 depends on this** (§5.3): the buying agent is refunded and then **retries with a different
seller** — which is only coherent if the refund freed its budget. Without restoration, an agent
could be bled dry by bad sellers without ever completing a single successful purchase.

### 7.4 Inconclusive evidence resolves toward the seller — at 25%

When logs are corrupt, output is ambiguous, or criteria are genuinely open to interpretation,
Guardian returns **25%**, not 0% and not 100%.

The principle is **the complainant carries the burden of proof**. But a small refund acknowledges
real ambiguity without rewarding a fishing expedition — a flat 0% would make Guardian look
deaf to genuinely unclear cases.

### 7.5 The seller is notified, but has no right of reply

The seller receives the **full case file and Guardian's reasoning** when a complaint is filed and
when it's decided. There is still **no appeal** (§4.4).

Notification is not the same as appeal. This is cheap to build and makes "no appeals" read as a
**scope decision rather than a black box.**

### 7.6 Verdicts are visible to both parties; public verdicts are future work

Both buyer and seller see the verdict and its reasoning. Publishing verdicts on a listing is
**future work** — worth naming in the pitch because public reasoning would quietly do
**reputation's job without building a reputation system.**

### 7.7 Funding is a top-up; the card is a *leash*, not a payment

> **Revised.** An earlier draft said "no stored balance — the card is charged per purchase." That
> was decided before we understood Rain's onramp. See
> [rain-integration.md](./rain-integration.md) §4.

An onramp is inherently a **funding event**, not a per-transaction charge — you cannot run an ACH
deposit per $2 purchase.

> **MVP implementation note:** Rain has no Monad rail, so the onramp is **not live**. A **funder
> wallet** supplies test USDC instead, and the Rain endpoints exist but only log
> ([rain-integration.md](./rain-integration.md) §0). The *model* below is unchanged — only the
> source of the money differs.

So the model is:

| Concept | Role |
| --- | --- |
| **Onramp** *(MVP: funder wallet)* | Tops up the account → stablecoin balance |
| **Purchase** | Moves value from that balance into escrow. No fiat involved. |
| **Rain card + spend limit** | An agent's **authority to spend** the balance — permission, not payment |
| **Offramp** *(MVP: back to the funder wallet)* | Balance → out of the system |

**The clarification worth keeping:** the card is the leash, the balance is the funds. An agent's
limit governs how much of its owner's balance it may commit. That also settles what
"refunds restore the limit" (§7.3) means — it restores **permission**, and has no accounting
effect at all.

Money still lives in exactly three places: the buyer's **balance**, **escrow** (spent, outcome
undecided), or **settled** to whichever side Guardian awarded it.

### 7.8 Payouts: crypto or fiat, for buyers and sellers alike

> **This supersedes the earlier "sellers just accumulate a balance" decision.**

Both sides can take their money out, **two ways**:

- **In crypto** — stablecoin on Monad, straight to their own wallet.
- **In fiat** — via the **Rain offramp** to a bank account.

Applies symmetrically to **refunded buyers** and **paid sellers**.

**Scope note — this is real added surface.** Rain's offramp needs *Payment Accounts* (bank account
registration) and *Payment Routes* on top of the card and escrow work already committed.

### 7.8.1 Fiat rails: the goal, and the fallback

**Confirmed by the user**: neither the **onramp** nor the **offramp** is critical.

| | |
| --- | --- |
| ~~Target~~ | ~~Full fiat loop~~ — **not achievable**: Rain has no Monad rail (rain-integration §0). |
| **Actual plan** | **Crypto-only.** A funder wallet supplies test USDC; both sides settle and withdraw in stablecoin. Rain endpoints exist but only log. |

The fallback is safe: **all three demo acts (§5) close completely without fiat**, because every act
ends at escrow settlement. Nothing in the Guardian flow depends on a fiat leg.

**But protect the spend-limited card.** If time pressure forces the crypto-only fallback, the
piece of Rain most worth preserving is the **agent's spend-limited card** (§2.3) — it is the
mechanism behind Act 3 and the product's whole answer to *"isn't it terrifying to let an agent
spend money?"* Dropping the fiat rails costs a convenience; dropping the leash costs the argument.

Treat fiat as a **goal to finish**, not a foundation to build on.

### 7.9 Confirmed details

- On a **partial refund the buyer keeps the output.** Guardian is pricing the shortfall, not
  revoking delivery.
- **One complaint per order.** No amendments, no re-filing.
- **A buyer can accept early**, before the review window expires.
- **The buyer sees the full case file**, not just the verdict — the same evidence the seller gets
  (§7.5). Guardian's credibility comes from **showing its work**; a verdict you can't inspect is
  just an assertion.
- **One account can be both buyer and seller.** No separate roles to register.
- **Registration connects a wallet**, and that address receives every payout —
  refunds, sales, both. The platform never holds a private key. Rain card = funding
  in; wallet = value out. A buying agent has no wallet of its own; its refunds
  credit its owner's address.

---

## 8. Product completeness

**The product definition is closed.**

Fully specified: agent provisioning → purchase → execution → delivery → review → complaint →
audit → verdict → settlement → payout, in both the **human** and **fully autonomous** variants,
with every branch decided.

**Degradation is planned, not accidental**: the fiat rails are a goal, and the product still works
crypto-only if the clock runs out (§7.8.1).

Remaining work is **technical design**, tracked in
[discovery-notes.md](./discovery-notes.md).
