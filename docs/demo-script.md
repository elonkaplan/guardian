# Guardian — demo video script

**Target: 4 minutes.** Speech is written to be *spoken*, not read. Short sentences.
Say it in your own words; the beats are what matter.

---

## Before you hit record

| | |
| --- | --- |
| `POST /demo/reset` | Clears orders, runs, complaints, verdicts. Do this between every take. |
| `POST /demo/seed` | Only if the catalogue is empty — re-seeding mints new on-chain agents. |
| Buyer wallet | Connected to Monad Testnet (10143), holding enough balance for three purchases |
| Funder wallet | Has test USDC — it is the only source of money in the system |
| Tabs open | The app, and **MonadVision** on the escrow contract |
| Browser | Zoom to ~125%. The verdict card has to be legible in a compressed video. |
| Close | Notifications, Slack, anything that can pop up mid-take |

**Record the three acts as three separate takes and cut them together.** Each act ends
in a settled state that cannot be re-run, so a fluffed line in Act 3 would otherwise
mean resetting and re-doing all three.

---

## Scene 1 — The problem (0:00–0:25)

**On screen:** the marketplace, static.

> Agents are starting to buy services from other agents. One agent needs a document
> summarised, hires another, and pays for it — with no human in the loop.
>
> That economy is missing something every human marketplace has. Recourse, when the
> work is bad.
>
> eBay has buyer protection. Upwork has dispute resolution. Credit cards have
> chargebacks. Every one of them ends with a *human* reading the evidence and deciding
> who was right. That doesn't scale to thousands of tiny agent-to-agent transactions —
> and it can't work at all when the buyer isn't a person.
>
> So we built Guardian. An AI auditor that rules on disputes — and because the money
> sits in a smart contract, **its ruling isn't advice. It executes.**

---

## Scene 2 — Sign in (0:25–0:45)

**Do:** click Connect Wallet → sign the message → land signed in.

> Registration is one signature. No password, no email — connecting a wallet is the
> whole of it.
>
> Two numbers here, not one. Your available balance, and money currently held in
> escrow. They're different money in different places, and a single number would be
> wrong about both.

*If the wallet extension is slow, cut the dead frames.*

---

## Scene 3 — What a seller actually sells (0:45–1:05)

**Do:** open an agent's detail page. Point at capabilities and exclusions.

> Sellers don't upload a service. They submit a *definition* — what the agent
> promises, what it explicitly doesn't do, and the schema its output must satisfy.
>
> These aren't marketing copy. They're **contract terms**, and Guardian quotes them
> verbatim when it rules. You'll see an exclusion save a seller in a minute.
>
> And the platform runs the agent — not the seller. That matters more than it sounds:
> **the party being audited never writes the record.** Without that, Guardian would be
> grading a self-assessment.

---

## Scene 4 — Act 1: the complaint that gets rejected (1:05–2:00)

**Do:** buy from **TLDR Agent**. Acceptance criteria: *"Under 100 words, must cover
the pricing change."* Watch it run. Output appears beside the criteria.

> I'm buying a summary. Before any work happens, I write my acceptance criteria —
> under 100 words, must cover the pricing change. That's half of what Guardian will
> judge against, and I wrote it *first*.

**Point at the countdown.**

> Money's in escrow now. This countdown is the review window — when it hits zero the
> escrow releases to the seller automatically. Nobody has to do anything.

**Point at output beside criteria.**

> Eighty-five words. Opens with the price rise, the date, the reason, the exceptions.
> That's what I asked for.
>
> But I'm going to complain anyway.

**Do:** Complain → *"This is far too short."* → submit.

> Now — every judge watching is thinking the same thing. Isn't this just a free-refund
> button?

**Verdict appears. Point at the checklist.**

> **Zero percent.** Guardian quotes my own hundred-word cap back at me. The seller is
> paid in full.
>
> And look at *how* it says it. Not a paragraph of AI prose — a checklist. Each clause,
> where it came from, and whether it was met. You can audit the auditor.

---

## Scene 5 — Act 2: the partial refund (2:00–3:00)

**Do:** buy from **LedgerBot**. Criteria: *"Extract all line items with their amounts,
and give the correct total."* Show the receipt input.

> Different agent. A receipt, and I want every line item with its amount, plus the
> correct total.

**Output appears. Slow down here.**

> Count with me. The receipt has five line items. It returned three.
>
> Desk lamp — missing. Cable kit — missing. Printed total, three sixty-two. It reported
> three hundred.

**Do:** Complain → *"Two line items are missing… it also left everything in euros
instead of dollars."*

> I'm making two complaints. One's real. One isn't — nowhere in my criteria did I ask
> for currency conversion.

**Verdict appears.**

> **Fifty percent.** It names both missing items. And on the currency, it cites the seller's
> own exclusion — *does not convert between currencies* — and rules against me on that
> point.
>
> That's the whole argument. You reached that number before Guardian announced it. It's
> arithmetic, not an opinion.

**Do:** click the transaction hash → MonadVision.

> And the split just executed on-chain. That's the transaction. Real contract, real
> settlement — you can check it without trusting anything I've said.

> ✅ **Confirmed 50% across three separate rehearsal passes**, with the verdicts
> deleted between each so the auditor decided fresh every time. The 75% risk I
> flagged earlier did not materialise. Still: if a take comes back different, say
> the number you got.

---

## Scene 6 — Act 3: nothing came back (3:00–3:30)

**Do:** buy from **PolyglotAI**. It crashes. Order shows "The agent returned nothing."

> Last one. This agent crashes and returns nothing at all.
>
> There's nothing to read here. No output to compare against anything — and that
> absence *is* the evidence. It's in the case file because **our wrapper recorded the
> crash**, not because the seller told us.

**Do:** Complain. Verdict appears.

> **One hundred percent.** Full refund.
>
> Three disputes. Zero, fifty, a hundred. Guardian isn't a refund button and it isn't
> a rubber stamp — it read the evidence each time and ruled differently.

---

## Scene 7 — Close (3:30–4:00)

**On screen:** the wallet page, showing the refund landed.

> One thing worth being straight about. This is Monad testnet, and the Rain integration
> is stubbed — we built it, then found Monad isn't a supported payment rail yet, so the
> endpoints log the exact call we'd make and a treasury wallet stands in for the bank.
> Everything else is real: real contract, real transactions, a real model reading a real
> case file.
>
> Guardian replaces reputation with **enforceable recourse**. A buyer doesn't need to
> trust a seller if a bad outcome can be reversed.
>
> Which is how an agent with no track record gets its first customer.

---

## Handling the slow parts

| Moment | Duration | What to do |
| --- | --- | --- |
| Agent runs | ~2–3s | Fine, leave it |
| Guardian audits | **~9–10s** | Keep talking — this is where the "checklist not prose" line goes |
| Review window | **30s** | Never wait for it. Complain well before zero. |

**The auto-release is worth showing once — but it costs 30 seconds.** If you have room,
do it as a separate 15-second clip at the end of Act 1: buy, deliver, say *"if nobody
complains, the escrow releases on its own"*, cut, resume on the released page. Don't
film 30 seconds of a ticking number.

## If something goes wrong mid-take

- **Verdict is a different tier than expected** — keep rolling. Say the number it gave.
  A verdict you didn't script is more convincing than one you did.
- **Order stuck in "Guardian is reviewing"** — the audit failed its parse. Reset and
  re-run; it will not recover on its own.
- **Marketplace empty** — the seed didn't run, or agents registered without confirming
  on-chain. Re-seed.
- **Balance won't move** — funder wallet is out of test USDC. That's the only source of
  money in the system.

## The three lines to keep if you have to cut

1. *"Guardian said no first."* — the answer to the free-refund objection
2. *"You reached that number before Guardian announced it."* — why it's checkable
3. *"The ruling isn't advice. It executes."* — the whole product
