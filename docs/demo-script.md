# Guardian — 60-second demo script

**Functionality only.** The problem statement and the thesis are on the slides — the
video's job is to show the product doing the thing, not to argue for it.

> The 4-minute walkthrough is in git history at `51e52e9` if you want it for a live
> booth demo.

---

## The shape

**Record each act in full, then cut to the moments.** Nobody watches a form being
filled. What survives the cut is: the output beside the criteria, the complaint being
sent, and the verdict landing.

| | Time | On screen |
| --- | --- | --- |
| Sign in | 0:00–0:05 | Connect wallet → signature → signed in |
| The listing | 0:05–0:14 | Agent detail: capabilities, exclusions, schema |
| Act 1 | 0:14–0:28 | Output beside criteria → complaint → 0% |
| Act 2 | 0:28–0:44 | Receipt → 3 of 5 rows → 50% → MonadVision |
| Act 3 | 0:44–0:53 | "The agent returned nothing" → 100% |
| Wallet | 0:53–1:00 | Refund landed in settled funds |

Act 2 gets the most room deliberately — it is the only one a viewer can verify
themselves.

---

## Script

### 0:00 — Sign in

**Do:** Connect Wallet → sign → land signed in.

> Registration is one wallet signature. No password, no email.

### 0:05 — What a seller sells

**Do:** open an agent's detail page. Point at capabilities, then exclusions.

> Every listing carries capabilities, exclusions, and the schema its output has to
> satisfy. These are contract terms — Guardian quotes them verbatim when it rules.

### 0:14 — Act 1

**On screen:** the buy form with criteria typed, then output beside criteria, then the
verdict.

> I write my acceptance criteria before anything runs — under a hundred words, must
> cover the pricing change.
>
> The platform runs the agent and records the whole trace. Eighty-five words, and it
> covers it. I complain anyway.
>
> **Zero percent.** Guardian cites my own word cap back at me.

### 0:28 — Act 2

**On screen:** the receipt, then the three returned rows. Linger — this is the shot the
demo rests on.

> A receipt with five line items. This one returns three.
>
> **Fifty percent**, and Guardian names both rows it dropped.
>
> I also complained it didn't convert to dollars — it cites the seller's exclusion and
> rules against me there.

**Cut to MonadVision.**

> The split executes on-chain. That's the transaction.

### 0:44 — Act 3

**On screen:** "The agent returned nothing." Then the verdict.

> The third agent crashes and returns nothing. The platform recorded the crash, so the
> absence itself is evidence.
>
> **A hundred percent.**

### 0:53 — Wallet

**On screen:** the wallet page.

> Available balance and settled funds, tracked separately. The refund landed on-chain
> under my own address — I withdraw it whenever I want.

---

## What's deliberately not here

| Not in the video | Why |
| --- | --- |
| The problem statement, the thesis | On the slides |
| The countdown and auto-release | 30 seconds of screen time proving less than the verdicts do |
| Rain stubbed, testnet caveats | README and submission text — worth saying, not worth ten seconds |
| Agent buyers being deferred | Keep as a spoken answer if a judge asks why a human is clicking |

## Production notes

- **Text overlays carry what speech can't afford.** Put `0%` / `50%` / `100%` and the
  transaction hash on screen. Don't spend words on numbers a viewer can read.
- **Guardian takes ~9–10s to rule.** Cut every second of it.
- **Zoom the browser to ~125%** before recording — the verdict checklist has to survive
  compression.
- `POST /demo/reset` between takes. Verdicts are persisted and never re-computed, so a
  settled order cannot be replayed.
- Act 2's tier is **50%, confirmed on three separate passes** with the verdicts deleted
  between each. If a take returns something else, say the number you got.

## If you only keep three shots

1. Output sitting beside the acceptance criteria the buyer wrote first
2. Five line items, three returned
3. The transaction on MonadVision
