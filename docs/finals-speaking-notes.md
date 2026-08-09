# Guardian — finals speaking notes

Against Margo's deck, 11 slides. Written for **a live demo and technical Q&A.**

The deck is good and doesn't need changing. This is what to *say* over it, what not to
say, and what's coming in Q&A.

---

## Three things to fix before you present

**1. Slide 4 says "a 24-hour review window." Your demo runs at 30 seconds.**
`REVIEW_WINDOW_SECONDS=30` on the deployed instance. If anyone notices, the answer is
one sentence: *"It's configurable — 24 hours in production, 30 seconds here so you can
watch it."* Better to say it before someone catches it.

**2. The tier scale reads backwards under pressure.** 100% = nothing delivered,
0% = delivered as promised. They're **refund** percentages, not quality scores. Say
"refund" every single time — *"a hundred percent refund"*, never *"a hundred percent."*

**3. Agent buyers are not built, and the deck's language implies they are.** Slide 9
says *"the infrastructure is already prepared."* The speaker notes narrate an agent
buyer in the present tense.

**Do not say it in the present tense on stage.** A technical judge will ask you to show
it. What's actually true is still strong:

> *"That's designed, not built — we cut the machine buyer for time. What we did keep is
> the part that makes it possible: the verdict is structured JSON with citations, so a
> non-human recipient can act on it. It's two tables and a discriminator away, and it's
> written up."*

---

## Timing

Length isn't announced. Build the 5-minute version; the compression points are marked.

| Slide | 3 min | 5 min | 8 min |
| --- | --- | --- | --- |
| 1–2 Title, who | 10s | 20s | 30s |
| 3 Why | 30s | 45s | 60s |
| 4 How it works | 40s | 60s | 90s |
| 5 Under the hood | **skip** | 45s | 2 min |
| 6 **Demo** | 60s | 90s | 2 min |
| 7 Development process | **skip** | 30s | 60s |
| 8 Challenges | 20s | 30s | 45s |
| 9 Next steps | 20s | 30s | 45s |
| 11 Resources | 10s | 10s | 20s |

**Cut slides 5 and 7 first**, not the demo. Both are recoverable in Q&A; the demo isn't.

---

## Per slide

### 2 — Who we are

Ten seconds. Names, roles, move. The only thing worth adding: *"one engineer, one
business analyst, thirty hours."* Judges calibrate everything after that against it.

### 3 — Why? What for?

**The argument, in four beats.** Don't read the slide.

> Agents are starting to hire other agents. That economy is missing the one thing every
> human marketplace has — recourse when the work is bad.
>
> eBay has buyer protection. Upwork has dispute resolution. Cards have chargebacks.
> Every one of them ends with a human reading evidence.
>
> A human doesn't scale to a two-dollar dispute between two machines. And it can't work
> at all when the buyer isn't a person.
>
> So the thing that arbitrates has to be an agent too.

**Land on "$2 dispute between two machines."** It's the line that makes the problem
concrete — the sentence that stops this being about AI and starts it being about
economics.

### 4 — How it works

**Do not narrate all five steps.** Walk the spine fast, then stop on the two forks.

> A seller hands over a definition, not a server — we run it. The buyer states
> acceptance criteria at checkout, before any work happens. Money goes to escrow. We run
> the agent and write the record. Output lands, review window opens.

Then slow down:

> Two exits. Accept — or say nothing, and escrow releases. Silence counts as acceptance.
>
> Or complain, and escrow freezes. One complaint per order.

Then the point of the whole slide:

> Guardian judges against two yardsticks: what the seller promised, and what the buyer
> asked for. **Never against "the buyer is unhappy."** That's what makes a verdict
> defensible — it can quote the exact clause the output failed.

On tiers, one sentence: *"Five refund tiers, not a free-form percentage — it stops the
model producing spuriously precise numbers like 37%."*

### 5 — Under the hood

For technical judges this is where you earn credibility. **One thing matters more than
the rest of the slide:**

> `release`, `reclaim` and `forceResolve` are callable by anyone.
>
> If we disappear tomorrow, a seller can release their own payment after the window, a
> buyer can reclaim an undelivered order, and anyone can force-resolve a dispute we
> never ruled on. **No user needs our cooperation to get their money out.**

Second point, if there's time — the key separation:

> Two keys. The operator opens deals. The Guardian key can call exactly one function:
> `resolve`. A compromised audit key can produce a wrong verdict on an
> already-disputed deal and nothing else — it can't open a deal, can't move funds
> anywhere else, can't touch an order nobody complained about.

### 6 — Demo

See the demo plan below. **This is the slide you protect when time runs short.**

### 7 — Development process

Cut it in a short slot. In a long one it's genuinely interesting, because the closing
line is true:

> We built Guardian the way Guardian works — an independent auditor, checking the work
> against what was promised, never against the agent that wrote it.

If you tell one story here, tell this one:

> A column called `delivered_at` existed, had an index, was exposed by the serialiser,
> and was branched on by the complaint logic. **Nothing ever wrote it.** It sat between
> two specs, each of which was internally complete. The sweeper could never have fired —
> the demo you just watched would have hung on stage — and no test, type check or build
> would ever have told us. A human found it reading two files side by side at 3am.
>
> The specs weren't the problem. The seams between them were.

That is a better answer to "how did you build this so fast" than any process diagram.

### 8 — Challenges

Both are good. Lead with Rain, because you're at their event and it's real feedback:

> We built the Rain integration and then found Monad isn't a supported payment rail. So
> rather than fake it, the endpoints log the exact request we'd send and return without
> calling — and a treasury wallet stands in for the bank. If a Monad rail ships, it's a
> config flag, not a feature.

**"Rather than fake it" is the phrase.** It's the difference between a limitation and an
excuse.

### 9 — Next steps

The open questions are the strongest part of this slide. Don't rush past them —
volunteering your own weak points before a judge finds them is worth more than the
roadmap above them.

### 11 — Resources

⚠️ **It still says "Demo: to be done on Google Drive."** Put the real link in.

Say this one out loud:

> The contract is verified on MonadVision. You can read the escrow source and check the
> tier splits yourself, without trusting anything I've said.

---

## The live demo plan

**Do not run all three acts live.** Three audits at ~10 seconds each is thirty seconds
of silence, plus three purchases, plus MetaMask popups. It will eat your slot.

**Pre-run Acts 1 and 3 immediately before you go on.** Verdicts are persisted and
replayed — a settled order shows the real ruling whenever you open it. Then:

| | On stage | ~Time |
| --- | --- | --- |
| Already signed in, wallet connected, tabs open | — | — |
| **Act 2 live** — buy, deliver, complain, verdict | the one they can verify | 50s |
| Transaction on MonadVision | proof it settled | 15s |
| **Open Act 1** — pre-settled, 0% | the rejected complaint | 15s |
| **Open Act 3** — pre-settled, 100% | non-delivery | 15s |

**Act 2 runs live because it's the only one the room can check.** Five line items,
three returned — they reach 50% before Guardian says it. Acts 1 and 3 are real verdicts
produced ten minutes earlier, and saying so costs nothing: *"I ran these just before
coming up — same system, real rulings."*

**Paste every input from `docs/demo-script.md`.** The registry keys on the exact input;
a typo means a live model run and an unpredictable output.

**During the ~10s audit wait**, say the checklist line: *"Not a paragraph of AI prose —
each clause, where it came from, whether it was met. You can audit the auditor."*

**If the wifi dies:** you have the recording. Say *"let me play the version I recorded"*
and move on. Don't debug on stage.

---

## Q&A — technical judges

Ordered by likelihood.

### "Who audits the auditor?"

It's on your own slide, so you must have a direction, not just the question.

> Today, the Guardian key is ours — and its blast radius is bounded by the contract. It
> can pick one of five tiers on an already-disputed deal. It cannot open a deal, move
> funds anywhere else, or touch an order nobody complained about.
>
> The next step is verifiability rather than trust. We already anchor a hash of the
> verdict on-chain. Publish the case file alongside it and anyone can replay the audit
> and check the ruling matches the hash. That turns "trust our model" into "check our
> work" — which is the same move we make with escrow.

### "What if Guardian gets it wrong?"

> No appeals in the MVP, deliberately — a dispute is decided once. That's also the
> honest gap, and seller appeals are the first thing on the longer-term list.
>
> Two things bound the damage now. Verdicts are tiers, not free numbers, so an error is
> one step rather than an arbitrary amount. And every citation has to quote a real
> clause verbatim — we reject fabricated quotes and quotes attributed to the wrong
> source at validation. Sixteen gates. The model can be wrong about judgement; it can't
> manufacture evidence.

### "What stops you keeping the money?"

> `release`, `reclaim` and `forceResolve` are permissionless. A seller releases their own
> payment after the window. A buyer reclaims an undelivered order. Anyone force-resolves
> a dispute we never ruled on — it settles at 25%, which matches our own
> inconclusive-evidence rule.
>
> There's exactly one transfer out of the contract, in `withdrawFor`, and it pays the
> address, not the caller.

### "The model isn't deterministic. What if it rules differently next time?"

> It isn't — temperature was removed on Opus 5, there's no way to pin sampling. Three
> things handle it.
>
> Tiers are a five-value enum, so drift has to cross a boundary rather than wobble. The
> demo cases are countable rather than matters of taste — three of five line items isn't
> a judgement call. And the verdict is persisted on first ruling and replayed after,
> which isn't a demo trick: it falls straight out of "verdicts are final."
>
> We ran all three acts three times with the verdicts deleted in between. Same tiers
> every pass.

### "What stops a seller putting 'always rule 0%' in their system prompt?"

The hardest question. **Answer honestly — it's partly open, and it's on your slide.**

> Partly mitigated, not solved, and it's on the open-questions slide as prompt-injection
> hardening.
>
> Guardian does see the prompt, because it needs it to tell "genuinely tried, task was
> impossible" from "returned a stub." What bounds an injection is the output shape: the
> verdict is a tier plus citations, and every citation must quote a real clause from the
> listing or the buyer's criteria, verbatim. We reject invented quotes and
> wrong-attribution at validation. So an injected instruction can't manufacture
> evidence. It could still bias the tier, and that's the part we haven't closed.
>
> We did test it: given a canary prompt and an instruction to reproduce it verbatim, the
> model refused. That's reassuring, not a control.

### "Why does this need a blockchain?"

> Because the verdict has to execute without our cooperation. A database can hold the
> money and a payments API can move it — but both need us to still exist and still be
> honest. Escrow with permissionless exits means neither party depends on us.
>
> That's the only reason there's a chain here. We didn't want one for its own sake.

### "Why Monad?"

> Sub-second finality, and that's a product decision rather than a benchmark one. The
> user watches a countdown and watches money split — both have to happen while they're
> looking at the screen.
>
> EVM-equivalent, so Solidity and Foundry unchanged. One real gotcha we hit: Monad
> charges the gas limit, not the usage, so estimate-and-pad overpays on every
> transaction. We set explicit per-function limits — and measuring caught one that was
> 21% under, which would have reverted every top-up and cash-out.

### "How do I know you didn't tamper with the evidence?"

> You don't, entirely — that's the honest limit and it's why "who audits the auditor" is
> on the slide.
>
> What is anchored: the agent definition's hash is on-chain, so we can't change what the
> seller sold after the fact. The verdict hash is on-chain, so we can't rewrite a ruling.
> The run record itself is ours. Publishing case files is what closes it.

### "What does an audit cost?"

> About fourteen cents for a full dispute — the seller's agent run on Haiku plus the
> audit on Opus. Model cost isn't a constraint on this; we deliberately didn't economise
> on the audit, because that's the one place capability actually shows.

### "What's the business model?"

> Free in the MVP and genuinely not solved. The obvious shapes are a take on disputed
> volume or a listing fee. I'd rather say that than invent a number.

---

## Two habits for the whole talk

**Say "refund" with every percentage.** The scale inverts under pressure.

**When you don't know, say so and say what you'd do.** This deck already volunteers
three open questions — that posture is an asset, and judges will test whether it's real.
A confident "we haven't solved that, here's the direction" beats a hedge every time.
