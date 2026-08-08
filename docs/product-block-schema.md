# Guardian — Product Block Schema & Flows

Product-level architecture: **what the blocks are, what each is responsible for, and how work
moves between them.** No stack, no frameworks, no storage choices — those belong to the technical
pass.

**Companion docs**: [product-workflow.md](./product-workflow.md) (decisions and rationale) ·
[discovery-notes.md](./discovery-notes.md) (raw capture, deferred technical items)

**Last updated**: 2026-08-08

> ⚠️ **MVP scope**: agent buyers are **deferred** (see
> [product-workflow.md](./product-workflow.md) scope note). The Agent API surface and
> flow **F2** are marked accordingly; everything else is in scope.

---

## 1. Block schema

```
┌───────────────────────────────────────────────────────────────────────────────┐
│                                  SURFACES                                     │
│                                                                               │
│   ┌────────────────────────────┐        ┌──────────────────────────────┐      │
│   │   Marketplace App          │        │   Agent API                  │      │
│   │   (human buyer & seller)   │        │  (agent buyer — DEFERRED)    │      │
│   │                            │        │                              │      │
│   │  browse · buy · review     │        │  buy · evaluate · complain   │      │
│   │  list agent · see verdicts │        │  machine-readable verdicts   │      │
│   └────────────────────────────┘        └──────────────────────────────┘      │
└───────────────────────────────┬───────────────────────────────────────────────┘
                                │
┌───────────────────────────────▼───────────────────────────────────────────────┐
│                              CORE DOMAIN                                      │
│                                                                               │
│  ┌───────────────┐  ┌───────────────┐  ┌───────────────┐  ┌────────────────┐  │
│  │   Accounts    │  │   Listings    │  │  Agent Buyer  │  │     Orders     │  │
│  │               │  │               │  │  Provisioning │  │                │  │
│  │ register      │  │ agent def     │  │               │  │ lifecycle      │  │
│  │ buyer+seller  │  │ promise       │  │ budget & caps │  │ review window  │  │
│  │ same account  │  │ exclusions    │  │ assigned task │  │ state machine  │  │
│  │               │  │ price         │  │               │  │                │  │
│  └───────────────┘  └───────────────┘  └───────────────┘  └────────┬───────┘  │
│                                                                    │          │
│                                            ┌───────────────────────▼───────┐  │
│                                            │        Complaints             │  │
│                                            │  intake · freeze escrow       │  │
│                                            │  one per order                │  │
│                                            └───────────────┬───────────────┘  │
└────────────────────────────────────────────────────────────┼──────────────────┘
              │                                              │
┌─────────────▼──────────────────────────┐   ┌───────────────▼──────────────────┐
│            EXECUTION                   │   │          ARBITRATION             │
│                                        │   │                                  │
│  ┌──────────────────────────────────┐  │   │  ┌────────────────────────────┐  │
│  │   Wrapped Agent Workspace        │  │   │  │   Guardian Audit Engine    │  │
│  │                                  │  │   │  │                            │  │
│  │   runs the seller's agent        │  │   │  │   reads the case file      │  │
│  │   platform-operated, not seller  │  │   │  │   judges vs promise +      │  │
│  │   instruments every run          │  │   │  │     acceptance criteria    │  │
│  └────────────────┬─────────────────┘  │   │  │   emits tiered verdict     │  │
│                   │                    │   │  │     + written reasoning    │  │
│  ┌────────────────▼─────────────────┐  │   │  └─────────────┬──────────────┘  │
│  │   Run Record Store               │──┼──▶│                │                 │
│  │                                  │  │   │       the CASE FILE feeds it     │
│  │   input · criteria · promise     │  │   │                │                 │
│  │   steps · output · errors · time │  │   │  ┌─────────────▼──────────────┐  │
│  │   the tamper-resistant evidence  │  │   │  │   Verdict & Settlement     │  │
│  └──────────────────────────────────┘  │   │  │   0/25/50/75/100 → split   │  │
└────────────────────────────────────────┘   │  └─────────────┬──────────────┘  │
                                             └────────────────┼─────────────────┘
                                                              │
┌─────────────────────────────────────────────────────────────▼─────────────────┐
│                                   MONEY                                       │
│                                                                               │
│  ┌────────────────────────────┐         ┌──────────────────────────────────┐  │
│  │   Rain                     │         │   Escrow Contract (Monad)        │  │
│  │                            │         │                                  │  │
│  │   card charge (fiat in)    │────────▶│   LOCK    on purchase            │  │
│  │   agent spend limits       │         │   FREEZE  on complaint           │  │
│  │   offramp (fiat out) ◇     │◀────────│   RELEASE on accept/expiry       │  │
│  └────────────────────────────┘         │   SPLIT   on verdict             │  │
│                                         └───────────────┬──────────────────┘  │
│  ┌────────────────────────────────────────────────────  ▼───────────────────┐ │
│  │   Payouts — crypto to wallet, or fiat via Rain offramp ◇                 │ │
│  │   symmetric: refunded buyers and paid sellers alike                      │ │
│  └──────────────────────────────────────────────────────────────────────────┘ │
└───────────────────────────────────────────────────────────────────────────────┘

                     ◇ = fiat rails: goal, not foundation (§7.8.1)
```

### 1.1 Block responsibilities

| Block | Owns | Notes |
| --- | --- | --- |
| **Marketplace App** | Human buying, selling, reviewing, complaining | One account is both buyer and seller |
| **Agent API** ⚠️ *deferred* | The same actions, for a non-human buyer | Verdicts stay **machine-readable** regardless — structured output costs nothing |
| **Accounts** | Identity | No role split |
| **Listings** | Agent definition, **promise**, **exclusions**, price | Promise + exclusions are half of Guardian's yardstick |
| **Agent Buyer Provisioning** ⚠️ *deferred* | Budget, per-purchase cap, assigned task | Owner control is exercised **once, here** |
| **Orders** | Lifecycle, review window, acceptance criteria | The state machine in §2 |
| **Complaints** | Intake, freezing escrow | One per order, no amendments |
| **Wrapped Agent Workspace** | Running seller agents | **Platform-operated** — this is what makes evidence trustworthy |
| **Run Record Store** | The evidence | Produced by the platform, never by the audited party |
| **Guardian Audit Engine** | Reading the case file, judging, explaining | The product |
| **Verdict & Settlement** | Turning a tier into a fund split | Verdict is final (no appeals in MVP) |
| **Rain** | Onramp (fiat in), offramp (fiat out) | Spend limits deferred with agent buyers |
| **Escrow Contract (Monad)** | Custody and execution of outcomes | Money is only ever on-card, in-escrow, or settled |
| **Payouts** | Getting money out, crypto or fiat | Symmetric for buyers and sellers |

### 1.2 The two structural claims

Everything else is plumbing. These two are why the product works:

1. **The platform runs the agents, so the platform owns the evidence.** The audited party never
   authors the record. Without this, Guardian is grading a self-assessment.
2. **The money sits in escrow, so the verdict executes itself.** Guardian never has to persuade
   anyone to pay. Without this, a verdict is a suggestion.

---

## 2. Order state machine

Every order is in exactly one state. This is the spine of the product.

```
                            ┌─────────────┐
                            │  PURCHASED  │  card charged → funds locked in escrow
                            └──────┬──────┘
                                   │ dispatch to workspace
                            ┌──────▼──────┐
                            │   RUNNING   │  wrapped workspace executing
                            └──────┬──────┘
                    ┌──────────────┴──────────────┐
         delivered  │                             │  crashed / timed out
                    ▼                             ▼
            ┌───────────────┐             ┌───────────────┐
            │   DELIVERED   │             │    FAILED     │
            │ review window │             │  no output    │
            │    open       │             └───────┬───────┘
            └───────┬───────┘                     │
        ┌───────────┼───────────┐                 │ near-automatic
        │           │           │                 │ 100% verdict
   accept       expire      complain              │
        │           │           │                 │
        ▼           ▼           ▼                 │
    ┌───────────────────┐  ┌─────────────┐        │
    │     RELEASED      │  │  DISPUTED   │◀───────┘
    │ seller paid full  │  │ escrow      │
    └───────────────────┘  │ frozen      │
                           └──────┬──────┘
                                  │ Guardian audits the case file
                           ┌──────▼──────┐
                           │  ADJUDICATED│  tier chosen + reasoning written
                           └──────┬──────┘
                                  │ escrow splits
                           ┌──────▼──────┐
                           │   SETTLED   │  both sides notified, funds moved
                           └─────────────┘
```

**Terminal states**: `RELEASED` and `SETTLED`. Both mean the escrow is empty and the order is
closed forever — no appeals (§4.4).

**`FAILED` is not terminal.** Non-delivery still routes through arbitration, so the outcome is
recorded and reasoned like any other. It just has a near-foregone conclusion.

---

## 3. Flows

### F1 — Seller lists an agent

```
Seller ──▶ Marketplace App ──▶ Listings
                                  │
                                  ├─ agent definition (prompt, tools, config)
                                  ├─ promise      "extracts line items with totals"
                                  ├─ exclusions   "no handwritten receipts"
                                  └─ price        $2.00
                                  │
                                  ▼
                          listed & purchasable
```

The seller hands over a **definition, not an endpoint.** They never host anything — which is what
makes §1.2's first claim possible.

### F2 — Owner provisions a buying agent  **[DEFERRED — not in MVP]**

```
Owner ──▶ Agent Buyer Provisioning
              │
              ├─ create agent
              ├─ budget      ──▶ Rain: card with total limit + per-purchase cap
              └─ assign task     "get this contract translated to Spanish"
              │
              ▼
      agent free to transact inside the leash
```

**Owner control happens once, here** — never per transaction. Per-transaction approval would
defeat the autonomy the product is arguing for.

### F3 — Purchase and execution

```
Buyer / Agent
     │  choose listing + state ACCEPTANCE CRITERIA
     ▼
  Orders ────────▶ Rain: charge card (fiat → stablecoin)
     │                      │
     │                      ▼
     │             Escrow: LOCK funds          [PURCHASED]
     │
     ├──▶ Wrapped Workspace: run seller's agent  [RUNNING]
     │           │
     │           ├──▶ Run Record Store: input, criteria, promise,
     │           │                      steps, output, errors, timing
     │           ▼
     └──◀── output delivered                     [DELIVERED]
                 │
                 ▼
         review window opens (24h default)
```

Acceptance criteria are captured **at purchase, before any work happens.** Stated after the fact
they'd be worthless as a yardstick.

### F4 — Uncontested settlement

```
[DELIVERED] ──── buyer accepts, or window expires ────▶ Escrow: RELEASE
                                                             │
                                                             ▼
                                                    seller paid in full
                                                        [RELEASED]
```

### F5 — Dispute (the main event)

```
[DELIVERED] ──── buyer/agent presses COMPLAIN (+ reason) ────▶ Complaints
                                                                    │
                                                    Escrow: FREEZE  │  [DISPUTED]
                                                                    ▼
                                                    ┌───── CASE FILE ─────┐
                                                    │  buyer's input      │
                                                    │  acceptance criteria│
                                                    │  listing promise    │
                                                    │  + exclusions       │
                                                    │  execution steps    │
                                                    │  output             │
                                                    │  errors / timing    │
                                                    └──────────┬──────────┘
                                                               ▼
                                                   Guardian Audit Engine
                                                               │
                                                   judge output against
                                                   promise AND criteria
                                                               │
                                                               ▼
                                              VERDICT: 0 / 25 / 50 / 75 / 100 %
                                              + written reasoning        [ADJUDICATED]
                                                               │
                                    ┌──────────────────────────┴──────────┐
                                    ▼                                     ▼
                          Escrow: SPLIT                          Notify BOTH parties
                          buyer share ──▶ buyer                  full case file +
                          seller share ─▶ seller                 reasoning, both sides
                                    │                            (seller: no reply)
                                    ▼                                     │
                               [SETTLED] ◀─────────────────────────────────┘
```

If the buyer is an **agent**, the verdict returns **machine-readable** so it can act — retry with
another seller, or escalate. Refunded amounts **restore its available spend limit** (§7.3),
without which a retry is impossible.

### F6 — Payout

```
Buyer (refunded)  ┐
                  ├──▶ Payouts ──┬──▶ crypto: stablecoin to own wallet
Seller (paid)     ┘              │
                                 └──▶ fiat: Rain offramp → bank ◇
```

Symmetric by design. **◇ Fiat is a goal, not a foundation** — the crypto path alone closes every
demo act (§7.8.1).

---

## 4. Product data objects

Product-level shape only. Fields, types, and storage are technical-pass concerns.

| Object | Carries | Created at |
| --- | --- | --- |
| **Account** | Identity; acts as buyer and seller | Registration |
| **Listing** | Agent definition, promise, **exclusions**, price | F1 |
| **Buying Agent** | Owner, budget, per-purchase cap, assigned task | F2 |
| **Order** | Listing, buyer, price, **acceptance criteria**, state, window | F3 |
| **Run Record** | Input, steps, output, errors, timing | F3 (by the workspace) |
| **Complaint** | Order, complainant, stated reason | F5 |
| **Case File** | Order + listing + run record, assembled for audit | F5 |
| **Verdict** | Tier, refund amount, **written reasoning**, evidence cited | F5 |
| **Settlement** | Buyer share, seller share, escrow transaction | F5 / F4 |
| **Payout** | Recipient, amount, crypto or fiat | F6 |

**The Verdict is the product's signature object.** It is not a number — it is a number *plus an
argument*, citing the specific promise, exclusion, or criterion the output met or missed. That's
the difference between arbitration and a refund button.

---

## 5. Where the sponsors sit

| Sponsor | Blocks | Droppable? |
| --- | --- | --- |
| **Rain** | Card charge (fiat in) | Yes — fallback to crypto funding |
| **Rain** | Agent spend limits ⚠️ *deferred with agent buyers* | n/a in MVP |
| **Rain** | Offramp (fiat out) | Yes — fallback to crypto payout |
| **Monad** | **Escrow contract** | **No** — it's what makes verdicts executable |
| **Monad** | Stablecoin settlement | No |
| **Monad** | Verdicts anchored on-chain | Optional enhancement, not yet decided |

---

## 6. Reading the schema in one line

> **Sell a definition → the platform runs it and keeps the receipts → money waits in escrow →
> if there's a fight, Guardian reads the receipts and the escrow obeys.**
