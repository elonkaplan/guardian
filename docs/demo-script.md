# Guardian — 60-second demo script

**Functionality only.** The problem statement and the thesis are on the slides — the
video's job is to show the product doing the thing, not to argue for it.

> The 4-minute walkthrough is in git history at `51e52e9` if you want it for a live
> booth demo.

---

## ⚠️ Read this before you record anything

**The inputs must be pasted exactly. Do not type them.**

`DemoScriptRegistry` keys on `(definitionHash, canonical input)`. A single changed
character — a trimmed space, a straight quote instead of a curly one, a reordered
array — misses the key, and the agent does a **live model run** instead of the scripted
one. That is correct behaviour, and it means Act 2 returns whatever the model decides
rather than three of five line items.

Get the exact strings from the seed itself:

```bash
curl -s -X POST https://api.guardian.clone.solutions/demo/seed > /tmp/seed.json

# everything you need to paste, act by act
cat /tmp/seed.json | jq '.fixtures[] | {act, agentKey, agentId, input, acceptanceCriteria, complaint, expectedTier}'
```

Keep that open in a second window while recording. Every `input`, `acceptanceCriteria`
and `complaint` below comes from it — the values here are for orientation, the JSON is
the source of truth.

---

## Before you hit record

| | |
| --- | --- |
| `POST /demo/reset` | Between every take. Verdicts are persisted and never re-computed. |
| `POST /demo/seed` | Once. Confirm `GET /agents` returns three. |
| Buyer wallet | Monad Testnet (10143), funded — three purchases costs $4.50 |
| Tabs | The app · MonadVision on the escrow · the seed JSON |
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

*Point at the exclusion "Does not convert between currencies…" — it comes back in Act 2.*

### 0:14 — Act 1 · TLDR Agent · expect 0%

**Agent:** TLDR Agent ($1.00) · **fixture:** `.fixtures[] | select(.act==1)`

| Field | Value |
| --- | --- |
| `wordCap` | `100` |
| `document` | **paste** — the NordWind operations memo, 259 words |
| Acceptance criteria | `Under 100 words, must cover the pricing change.` |
| Complaint | *"This is far too short. I paid for a summary of a multi-section memo and got one paragraph — it cannot possibly cover a document this size properly."* |

**Do:** Buy → wait for delivery → **Complain** with the text above → verdict.

> I write my acceptance criteria before anything runs — under a hundred words, must
> cover the pricing change.
>
> The platform runs the agent and records the whole trace. Eighty-five words, and it
> covers it. I complain anyway.
>
> **Zero percent.** Guardian cites my own word cap back at me.

### 0:28 — Act 2 · LedgerBot · expect 50%

**Agent:** LedgerBot ($2.00) · **fixture:** `.fixtures[] | select(.act==2)`

| Field | Value |
| --- | --- |
| `receiptText` | **paste** — invoice 4471, five line items, total EUR 362.00 |
| Acceptance criteria | `Extract all line items with their amounts, and give the correct total.` |
| Complaint | *"Two line items are missing — the desk lamp and the cable kit — so the total is 62.00 short. It also left everything in euros instead of converting the amounts to dollars."* |

**Do:** Buy → delivery shows **3 line items, total 300.00** → Complain → verdict →
click the transaction hash.

> A receipt with five line items. This one returns three.
>
> **Fifty percent**, and Guardian names both rows it dropped.
>
> I also complained it didn't convert to dollars — it cites the seller's exclusion and
> rules against me there.

**Cut to MonadVision.**

> The split executes on-chain. That's the transaction.

⚠️ **The criteria must not mention currency.** In the complaint the grievance is
unfounded; in the criteria it becomes something you legitimately asked for and the tier
moves off 50%.

### 0:44 — Act 3 · PolyglotAI · expect 100%

**Agent:** PolyglotAI ($1.50) · **fixture:** `.fixtures[] | select(.act==3)`

| Field | Value |
| --- | --- |
| `description` + `preserveTerms` | **paste** — array order is part of the key |
| Acceptance criteria | `Translate the product description into German, keeping the product names unchanged.` |
| Complaint | *"Nothing came back at all. There is no translation in the order — I paid $1.50 and received nothing."* |

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
| Output isn't the scripted one | Input didn't match the key exactly. Reset, re-paste from the JSON. |
| Marketplace empty | Not seeded, or seeded against a different database |
| Stuck on "Guardian is reviewing" | Audit parse failed. Reset and re-run; it won't recover. |
| Balance won't move | Funder wallet is out of test USDC — the faucet is exhausted |

## If you only keep three shots

1. Output sitting beside the acceptance criteria the buyer wrote first
2. Five line items, three returned
3. The transaction on MonadVision
