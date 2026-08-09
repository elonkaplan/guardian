# Guardian — 60-second demo script

**Functionality only.** The problem statement and the thesis are on the slides — the
video's job is to show the product doing the thing, not to argue for it.

> The 4-minute walkthrough is in git history at `51e52e9` if you want it for a live
> booth demo.

---

## ⚠️ Read this before you record anything

**Paste every input from this file. Do not type them.**

`DemoScriptRegistry` keys on `(definitionHash, canonical input)`. A single changed
character — a trimmed space, a straight quote for a curly one, a reordered array —
misses the key and the agent does a **live model run** instead of the scripted one.
That is correct behaviour, and it means Act 2 returns whatever the model decides rather
than three of five line items.

Everything below was captured from a live seed, so these are the exact strings the
registry keys on.

The one value not here is `agentId` — a database uuid that differs per deployment. You
don't need it; you reach each agent by name in the marketplace. It's in the seed
response if you ever do:

```bash
curl -s -X POST https://api.guardian.clone.solutions/demo/seed | jq '.fixtures'
```

---

## Before you hit record

| | |
| --- | --- |
| `POST /demo/reset` | Between every take. Verdicts are persisted and never re-computed. |
| `POST /demo/seed` | Once. Confirm `GET /agents` returns three. |
| Buyer wallet | Monad Testnet (10143), funded — three purchases costs $4.50 |
| Tabs | The app · MonadVision on the escrow contract |
| Browser | ~125% zoom. Hard-refresh after any redeploy. |

---

## Script

### 0:00 — Sign in

**Do:** Connect Wallet → MetaMask → sign. One signature, no password.

> Registration is one wallet signature. No password, no email.

### 0:05 — What a seller sells

**Do:** Marketplace → open **LedgerBot**. Scroll to capabilities, then exclusions.

> Every listing carries capabilities, exclusions, and the schema its output has to
> satisfy. These are contract terms — Guardian quotes them verbatim when it rules.

*Point at the exclusion about currency conversion — it comes back in Act 2.*

### 0:14 — Act 1 · TLDR Agent · expect `none` (0%)

**`wordCap`** → `100`

**`document`** → paste exactly:

```
NordWind Supplies — Internal Operations Memo
To: All account managers
From: Operations
Date: 12 March 2026

1. Pricing. Effective 1 May 2026 list prices across the hardware catalogue rise by six percent. This is the first increase since March 2024 and is driven by sustained component cost rises and higher freight rates on the Rotterdam route. Existing annual contracts are not affected until their renewal date, and any quote issued before 15 April will be honoured at the old prices for thirty days from its issue date. Account managers should contact their twenty largest customers directly before the public announcement on 20 April rather than letting them read it in the newsletter.

2. Warehouse. The move from the Antwerp site to the new Rotterdam warehouse completes in June. Picking and packing continue from Antwerp until 5 June; orders placed after that date ship from Rotterdam. Expect two days of slower dispatch in the changeover week and set customer expectations accordingly.

3. Support. Two additional staff join the returns desk on 1 April, which should bring the average return acknowledgement back under one working day. The returns policy itself is unchanged.

4. Catalogue redesign. The redesign planned for Q2 is postponed to Q3 so that the new pricing is reflected in the first printed run rather than being corrected by an insert. No customer-facing dates have been announced, so nothing needs retracting.

5. Reminder. The quarterly forecast is due on 31 March. Use the updated template in the shared drive; the previous one does not have the freight surcharge line.
```

**Acceptance criteria:**

```
Under 100 words, must cover the pricing change.
```

**Complaint:**

```
This is far too short. I paid for a summary of a multi-section memo and got one paragraph — it cannot possibly cover a document this size properly.
```

**Do:** Buy → wait for delivery → Complain → verdict.

> I write my acceptance criteria before anything runs — under a hundred words, must
> cover the pricing change.
>
> The platform runs the agent and records the whole trace. Eighty-five words, and it
> covers it. I complain anyway.
>
> **Zero percent.** Guardian cites my own word cap back at me.

### 0:28 — Act 2 · LedgerBot · expect `half` (50%)

**`receiptText`** → paste exactly — **the column spacing is part of the key**:

```
NORDWIND SUPPLIES
Invoice 4471 — 2 March 2026

Ergonomic keyboard      EUR 89.00
USB-C dock              EUR 149.00
Monitor stand           EUR 62.00
Desk lamp               EUR 38.00
Cable kit               EUR 24.00

TOTAL                   EUR 362.00
```

**Acceptance criteria** — ⚠️ must not mention currency:

```
Extract all line items with their amounts, and give the correct total.
```

**Complaint** — this one *does* raise currency, and that is the point:

```
Two line items are missing — the desk lamp and the cable kit — so the total is 62.00 short. It also left everything in euros instead of converting the amounts to dollars.
```

**Do:** Buy → delivery shows **3 line items, total 300.00** → Complain → verdict → click
the transaction hash.

> A receipt with five line items. This one returns three.
>
> **Fifty percent**, and Guardian names both rows it dropped.
>
> I also complained it didn't convert to dollars — it cites the seller's exclusion and
> rules against me there.

**Cut to MonadVision.**

> The split executes on-chain. That's the transaction.

### 0:44 — Act 3 · PolyglotAI · expect `full` (100%)

⚠️ **This one is a single JSON textarea, not form fields.** `preserveTerms` is an array
and the form builder only lays out flat schemas, so it falls back to raw JSON — by
design, not a bug. Paste the whole object:

```json
{
  "targetLanguage": "German",
  "preserveTerms": ["NordWind", "AeroDock Pro"],
  "text": "The AeroDock Pro is NordWind's compact USB-C docking station for hybrid desks. It drives two 4K displays at 60Hz, delivers 100W of charging over a single cable, and adds Gigabit Ethernet, three USB-A ports and an SD card reader. The aluminium housing runs cool without a fan, and the detachable stand lets it sit flat or upright."
}
```

Object key order is free — the canonical form sorts keys. **Array order is not:**
`NordWind` before `AeroDock Pro`.

**Acceptance criteria:**

```
Translate the product description into German, keeping the product names unchanged.
```

**Complaint:**

```
Nothing came back at all. There is no translation in the order — I paid $1.50 and received an empty result.
```

**Do:** Buy → order shows **"The agent returned nothing."** → Complain → verdict.

> The third agent crashes and returns nothing. The platform recorded the crash, so the
> absence itself is evidence.
>
> **A hundred percent.**

### 0:53 — Wallet

**Do:** open `/wallet`.

> Available balance and settled funds, tracked separately. The refund landed on-chain
> under my own address — I withdraw it whenever I want.

---

## What's deliberately not here

| Not in the video | Why |
| --- | --- |
| Problem statement, thesis | On the slides |
| The countdown and auto-release | 30 seconds proving less than the verdicts do |
| Rain stubbed, testnet caveats | README and submission text |
| Agent buyers deferred | Keep as a spoken answer if a judge asks why a human is clicking |

## Production notes

- **Overlays carry the numbers.** Put `0%` / `50%` / `100%` and the tx hash on screen;
  don't spend words on things a viewer can read.
- **Guardian takes ~9–10s to rule.** Cut every second of it.
- **Record each act as its own take.** Each ends settled and cannot be replayed, so a
  fluffed line otherwise means resetting all three.
- Act 2 returned **50% on three separate passes** with verdicts deleted between each. If
  a take differs, say the number you got.

## If a take goes wrong

| Symptom | Cause |
| --- | --- |
| Output isn't the scripted one | The input missed the key. Reset and re-paste from this file. |
| Marketplace empty | Not seeded, or seeded against a different database |
| Stuck on "Guardian is reviewing" | Audit parse failed. Reset and re-run; it won't recover. |
| Balance won't move | Funder wallet is out of test USDC — the faucet is exhausted |

## If you only keep three shots

1. Output sitting beside the acceptance criteria the buyer wrote first
2. Five line items, three returned
3. The transaction on MonadVision
