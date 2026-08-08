# Guardian — UI Structure, Flows & Endpoint Map

> **DRAFT for review.** React + TypeScript + Vite. Not yet implemented.

**Last updated**: 2026-08-08
**Companion docs**: [api-design.md](./api-design.md) ·
[product-workflow.md](./product-workflow.md) · [database-schema.md](./database-schema.md)

---

## Contents

- [1. The page that matters](#1-the-page-that-matters)
- [2. Pages](#2-pages)
- [3. User flows](#3-user-flows)
- [4. Page → endpoint map](#4-page--endpoint-map)
- [5. Polling](#5-polling)
- [6. What the audience sees](#6-what-the-audience-sees)
- [7. Open questions](#7-open-questions)

---

## 1. The page that matters

**Order Detail is the demo.** Both remaining acts play out entirely on it: delivery
arrives, a window counts down, a complaint is filed, Guardian rules, and escrow
splits — all on one screen, without navigating away.

Every other page exists to get you there. Design budget should be spent accordingly:
if only one screen looks finished, make it this one.

---

## 2. Pages

| # | Page | Route | Demo-critical? |
| --- | --- | --- | --- |
| 1 | **Connect** | `/` | ✅ Entry point |
| 2 | **Marketplace** | `/agents` | ✅ Browse the catalogue |
| 3 | **Agent Detail + Buy** | `/agents/:id` | ✅ Where a purchase starts |
| 4 | **Order Detail** | `/orders/:id` | ✅ **The hero page** |
| 5 | **My Orders** | `/orders` | ○ Supporting |
| 6 | **Wallet** | `/wallet` | ✅ Funding must happen before buying |
| 7 | **My Agents (Sales)** | `/sell` | ○ Proves the seller side is real |
| 8 | **Create Agent** | `/sell/new` | ○ Same |

Eight pages, four of them load-bearing. Pages 7–8 aren't in the three acts — the
demo agents are seeded — but without them the marketplace is a catalogue nobody can
join, and *"can anyone list an agent?"* is an obvious question from the floor.

### 2.1 Order Detail — the state machine on screen

One page, five faces. This is the whole product in one component.

| Order state | What's shown | Actions |
| --- | --- | --- |
| `purchased` / `running` | "Agent is working…", the input you submitted, elapsed time | — |
| `delivered` | **Output**, your acceptance criteria beside it, **countdown to auto-release** | **Accept** · **Complain** |
| `failed` | "The agent returned nothing." | **Complain** |
| `disputed` | "Guardian is reviewing…", the case file it's reading | — |
| `adjudicated` / `settled` | **Verdict card** — tier, reasoning, cited clauses, the split, tx hash | — |

Two details that carry a lot of weight:

**Show the acceptance criteria next to the output.** The buyer wrote them before any
work happened; putting them side by side is what makes the later verdict legible —
the audience can judge before Guardian does, which is the whole point of Act 2.

**The countdown is the visible proof that escrow is real.** It's computed client-side
from `delivered_at + review_window_seconds`, and when it hits zero the sweeper
releases and the page flips to `released` on its own. Nobody clicks anything. That's
Act 1's ending.

### 2.2 The verdict card

The single most important component to get right.

```
┌──────────────────────────────────────────────────┐
│  VERDICT — 50% REFUND                            │
│                                                  │
│  "The listing promises every line item with its  │
│   amount. The receipt contains 5; the output     │
│   returned 3. Items 'Napkins 2.40' and 'Tax      │
│   1.85' are absent."                             │
│                                                  │
│  ✗ capability  "extracts every line item…"       │
│  ✓ exclusion   "no handwritten receipts"         │
│  ✗ criterion   "all line items with totals"      │
│                                                  │
│  You get  $1.00      Seller gets  $1.00          │
│  ⛓ 0x7f3a…c21   ← view on Monad explorer         │
└──────────────────────────────────────────────────┘
```

**Render the citations as a checklist, not prose.** Each one is a clause with a
✓/✗ — that's what turns "the AI decided" into "here is the clause, here is whether
it was met." The reasoning text supports the checklist; it shouldn't replace it.

The transaction hash is the proof the money actually moved. Link it out.

---

## 3. User flows

### Flow A — Onboard and fund

```
/  Connect Wallet
   └─ sign nonce → JWT → account created on first sign-in
      └─ /wallet
         └─ [Add funds] → funder wallet transfers test USDC → balance appears immediately
                          (sub-second finality; no polling needed)
```

**Say on screen where the money comes from.** "Funded from the demo treasury —
Rain's onramp has no Monad rail yet." A judge seeing "$100 added" with no bank
transfer will wonder, and volunteering the answer is much better than being asked.

### Flow B — Sell

```
/sell → [List an agent] → /sell/new
   name · description · price
   capabilities[] · exclusions[]        ← Guardian's yardstick
   input schema · output schema
   system prompt · model                ← private, never shown to buyers
   └─ submit → agent registered on-chain → /sell
```

The form should **label capabilities and exclusions as contract terms**, not
marketing copy — a seller who writes vague capabilities loses disputes, and one who
writes good exclusions wins them. Say that in the form.

### Flow C — Buy and accept (the quiet path)

```
/agents → pick one → /agents/:id
   read promise + exclusions · write acceptance criteria · provide input
   └─ [Buy — $2.00] → /orders/:id
      running → delivered
      └─ [Accept]  or  let the countdown expire
         → released, seller paid
```

### Flow D — Buy and complain (Acts 1 & 2)

```
/orders/:id  (delivered)
   └─ [Complain] → reason → confirm
      → disputed — "Guardian is reviewing…"
      → verdict card appears
         Act 1: 0%  — complaint rejected, seller paid in full
         Act 2: 50% — escrow splits, both sides credited
```

### Flow E — Money out (two different exits)

```
/wallet
 ├─ [Withdraw settled funds] → withdrawFor(wallet) → tokens land in your wallet
 │      (refunds and sales — they live on-chain, not in your balance)
 │
 └─ [Cash out unspent balance] → operator pool → funder wallet, ledger debit
        (topped-up money you never spent — the offramp)
```

**Two exits because there are two kinds of money**, and the Wallet page has to make
that legible or the ledger looks broken:

| | Where it is | How it leaves |
| --- | --- | --- |
| **Available balance** | Postgres ledger | *Cash out* → back to the funder |
| **Settled funds** | On-chain `balances[]` | *Withdraw* → your own wallet |

Conflating them into one "balance" number would be wrong in both directions.

---

## 4. Page → endpoint map

| Page | Element | Calls |
| --- | --- | --- |
| **Connect** | Connect Wallet | `POST /auth/nonce` → sign → `POST /auth/verify` |
| **Marketplace** | Page load | `GET /agents` |
| | Agent card click | → `/agents/:id` |
| **Agent Detail** | Page load | `GET /agents/:id` |
| | **Buy** | `POST /orders` `{ agentId, input, acceptanceCriteria }` → redirect `/orders/:id` |
| **Order Detail** | Page load + poll | `GET /orders/:id` |
| | Case file panel | `GET /orders/:id/case-file` |
| | **Accept** | `POST /orders/:id/accept` |
| | **Complain** | `POST /orders/:id/complain` `{ reason }` |
| | Verdict card | `GET /orders/:id/verdict` |
| | Explorer link | Monad testnet explorer (external) |
| **My Orders** | Page load | `GET /orders` |
| **Wallet** | Page load + poll | `GET /me`, `GET /me/ledger` |
| | **Add funds** | `POST /topup` `{ amountMinor }` — funder wallet → balance |
| | **Withdraw** | `POST /withdraw` — settled funds to your wallet |
| | **Cash out** | `POST /offramp` — unspent balance back to the funder |
| **My Agents** | Page load | `GET /sales`, `GET /agents?owner=me` |
| | Toggle active | `PATCH /agents/:id/active` |
| **Create Agent** | Submit | `POST /agents` |
| **(dev only)** | Seed / Reset | `POST /demo/seed`, `POST /demo/reset` |

Every endpoint in api-design §3 is reachable from a page except `/offramp/routes`
(a stretch goal) — worth confirming that's intentional rather than an omission.

---

## 5. Polling

Decided: polling, no SSE (api-design §8).

| Page | Interval | Stops when |
| --- | --- | --- |
| **Order Detail** | 1s | State is terminal (`released` / `settled`) |
| **Wallet** | 5s | Never (a deposit can land at any time) |
| **My Orders** | 5s | Never |
| Everything else | — | Load only |

**Only Order Detail needs the fast interval**, and only while an order is live. Stop
polling on a terminal state — a demo laptop hammering an endpoint for an order that
finished ten minutes ago is a needless way to look bad.

---

## 6. What the audience sees

Three things should be on screen during the demo, because they're the ones that make
the claims checkable rather than asserted:

1. **The countdown**, in Act 1 — escrow is really time-locked, and the release
   happens with nobody touching the keyboard.
2. **The output beside the acceptance criteria**, in Act 2 — the audience counts the
   rows and reaches the verdict before Guardian announces it.
3. **The transaction hash on the verdict card** — the money actually moved, and it's
   one click to verify.

A **total escrow figure** somewhere persistent (header or footer) is worth
considering — `totalEscrowed` from the contract (smart-contract §3.3). Watching it
drop as a dispute settles is a small thing that makes the escrow feel real.

---

## 7. Decisions

All resolved — no open UI questions.

| Question | Decision |
| --- | --- |
| Wallet page vs header widget | **Keep the page.** The ledger and the spendable-vs-settled distinction need room. A header balance can still link to it. |
| Schema editors on Create Agent | **Raw JSON textareas.** A schema builder is a day of work for something the demo never touches. |
| Show execution steps to the buyer | **Yes** — see the caveat below. |

### 7.1 Showing steps has a redaction consequence

Steps make Guardian's reasoning far easier to follow — *"the agent made one
extraction pass and stopped"* is legible in a way a bare verdict isn't. Worth
showing.

But it widens the redaction boundary in a way that's easy to miss: **stripping the
`system_prompt` field is no longer sufficient.** A reasoning step can quote its own
instructions verbatim, so a step like *"The user asked me to extract line items; my
instructions say to skip handwritten entries…"* leaks the seller's prompt through a
field nobody thought of as sensitive.

Two options, and the second is the honest one:

| Approach | Verdict |
| --- | --- |
| Show steps raw to the buyer | ❌ Leaks the prompt whenever the model paraphrases its instructions |
| **Show tool calls, timings, and errors; summarise reasoning text** | ✅ Keeps the legibility, drops the leak |

Either way this belongs in the **same serialiser** that strips `system_prompt`
(api-design §1.3) — the point of having one function is that a new sensitive field
gets handled in one place rather than remembered in five.

The seller's own view of the case file stays unredacted; it's their prompt.
