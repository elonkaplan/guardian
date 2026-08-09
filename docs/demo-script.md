# Guardian — 60-second demo script

**169 words of speech** — 61 seconds at a brisk delivery, 68 at a relaxed one. That is
the whole budget. Every sentence below is load-bearing; cutting one loses an argument,
not a flourish. If you need to reach 60 exactly, speed up rather than cut.

> The 4-minute walkthrough version is in git history at `51e52e9` if you want it for a
> live booth demo. This file is the submission cut.

---

## The shape

**Record each act in full, then cut to the moments.** Nobody watches a form being
filled. What survives the cut is: the output beside the criteria, the complaint being
sent, and the verdict landing. Everything else is a jump cut.

| | Time | On screen |
| --- | --- | --- |
| Hook | 0:00–0:10 | Marketplace, then a wallet signature |
| Act 1 | 0:10–0:22 | Output beside criteria → 0% verdict |
| Act 2 | 0:22–0:40 | Receipt → 3 of 5 rows → 50% verdict → MonadVision |
| Act 3 | 0:40–0:50 | "The agent returned nothing" → 100% verdict |
| Close | 0:50–1:00 | Wallet, refund landed |

Act 2 gets the most room deliberately. It is the only one the viewer can verify
themselves.

---

## Script

### 0:00 — Hook

**On screen:** the marketplace. Then one quick shot of the wallet signature.

> Agents are hiring other agents. When the work is bad there's no recourse — every
> dispute system we have ends with a human reading evidence.
>
> Guardian is an AI auditor, and because the money sits in escrow, **its ruling doesn't
> advise. It executes.**

*(Sign-in is one signature. Show it; don't narrate it.)*

### 0:10 — Act 1

**On screen:** output beside acceptance criteria. Then the complaint. Then the verdict.

> I asked for under a hundred words covering the pricing change. I got eighty-five that
> cover it. I complain anyway.
>
> **Zero percent** — Guardian quotes my own word cap back at me.

### 0:22 — Act 2

**On screen:** the receipt, then the three returned rows. Linger here — this is the
shot the whole demo rests on.

> Five line items. It returned three.
>
> **Fifty percent**, and it names the two it dropped.
>
> I also complained it didn't convert to dollars — it cites the seller's exclusion and
> rules against me there.

**Cut to MonadVision on the transaction.**

> That split just executed on-chain.

### 0:40 — Act 3

**On screen:** "The agent returned nothing." Then the verdict.

> Third agent crashes. Nothing to read — and the absence *is* the evidence, because our
> platform recorded the crash, not the seller.
>
> **A hundred percent.**

### 0:50 — Close

**On screen:** wallet page, refund landed.

> Zero, fifty, a hundred. Not a refund button.
>
> Guardian replaces reputation with recourse you can enforce — which is how an agent
> with no track record gets a first customer.

---

## What had to go, and why it's survivable

| Cut | Where it lives instead |
| --- | --- |
| The eBay / Upwork / chargebacks setup | "every dispute system ends with a human" carries it |
| "The platform runs the agent, so it owns the evidence" | Compressed into Act 3's *"our platform recorded the crash, not the seller"* |
| Capabilities and exclusions as contract terms | Demonstrated in Act 2 rather than explained |
| The countdown and auto-release | Gone entirely. It costs 30 seconds and proves less than the verdicts do. |
| Rain being stubbed, testnet caveats | **README and the submission text.** Say it in writing, not on the clock. |

## Production notes

- **Text overlays carry what speech can't afford.** Put the tier (`0%` / `50%` / `100%`)
  and the transaction hash on screen. The voice shouldn't spend words on numbers the
  viewer can read.
- **Guardian takes ~9–10s to rule.** Cut it. In a 60-second video there is no such thing
  as an acceptable wait.
- **Zoom the browser to ~125%** before recording — the verdict checklist has to survive
  compression.
- `POST /demo/reset` between takes. Verdicts are persisted and never re-computed, so a
  settled order cannot be replayed.

## If you only keep three sentences

1. *"Its ruling isn't advice — it executes."*
2. *"Five line items. It returned three."*
3. *"Not a refund button."*
