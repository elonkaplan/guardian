# Guardian — finals script

**Illia's spoken script, slide by slide.** Written as it will be said, not as prose.
Filled in one slide at a time.

Reference material — the pre-flight corrections, the live demo plan, and Q&A prep —
is below the script.

---

## The script

### Slide 1 · Title

> Hi — I'm Illia, this is Margo. We built Guardian.

*(If an MC introduces you: "Thanks — so, Guardian." Skip the names.)*

### Slide 2 · Who we are

> Margo's a business analyst and founder of Clone Solutions — she owned the product
> side, I took the engineering.

### Slide 3 · Why? What for?

*To write.*

- **Job:** make them believe the problem is real before showing a solution
- **Must land:** *a human doesn't scale to a $2 dispute between two machines*
- **Trap:** don't read the four lines — tell it as one connected thought

### Slide 4 · How it works

*To write.*

- **Job:** the mechanism, fast, without narrating five numbered steps
- **Must land:** Guardian judges against the promise and the criteria — **never against
  "the buyer is unhappy"**
- Say **"refund"** with every percentage. The scale inverts under pressure.

### Slide 5 · Under the hood

*To write.*

- **Job:** credibility with technical judges
- **Must land:** `release` / `reclaim` / `forceResolve` are callable by anyone — no user
  needs our cooperation to get their money out
- Second, if time: two keys, and the Guardian key can call exactly one function

### Slide 6 · Demo

*See the demo plan below.*

### Slide 7 · Development process

*To write.*

- **Job:** answer "how did two people do this in thirty hours"
- **Must land:** we built Guardian the way Guardian works — an independent auditor
  checking work against what was promised
- Best story available: the `delivered_at` column (see below)

### Slide 8 · Challenges

*To write.*

- **Job:** turn two blockers into evidence of judgement
- **Must land:** *"rather than fake it"* — the Rain endpoints log the exact call they'd
  make and return without calling

### Slide 9 · Next steps

*To write.*

- **Job:** show you know your own weak points
- **Must land:** the three open questions. Don't rush them — volunteering them is worth
  more than the roadmap above them.

### Slide 10 · Questions

*Hand-off line to write.*

### Slide 11 · Thank you / resources

*To write.*

- **Must land:** the contract is verified on MonadVision — you can read the escrow
  source and check the tier splits without trusting anything I've said

---
---

# Reference

## Three things to fix before presenting

**1. Slide 4 says "a 24-hour review window." The demo runs at 30 seconds.**
`REVIEW_WINDOW_SECONDS=30` on the deployed instance. Say it before anyone catches it:
*"configurable — 24 hours in production, 30 seconds here so you can watch it."*

**2. The tier scale reads backwards under pressure.** 100% = nothing delivered, 0% =
delivered as promised. They are **refund** percentages. Say "refund" every time.

**3. Agent buyers are designed, not built — the deck implies otherwise.** Slide 9 says
"the infrastructure is already prepared," and the speaker notes narrate an agent buyer
in the present tense. A technical judge will ask to see it. The true version:

> That's designed, not built — we cut the machine buyer for time. What we kept is the
> part that makes it possible: the verdict is structured JSON with citations, so a
> non-human recipient can act on it. It's two tables away, and it's written up.

**4. Slide 11 still says "Demo: to be done on Google Drive."** Put the real link in.

## Timing

Length isn't announced. Build the 5-minute version.

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

**Cut 5 and 7 first, never the demo.** Both are recoverable in Q&A; the demo isn't.

## The live demo plan

**Don't run all three acts live.** Three audits at ~10s each is thirty seconds of
silence, plus three MetaMask popups.

**Pre-run Acts 1 and 3 immediately before going on.** Verdicts are persisted and
replayed, so a settled order shows the real ruling whenever you open it.

| On stage | Why | ~Time |
| --- | --- | --- |
| Already signed in, tabs open | — | — |
| **Act 2 live** — buy, deliver, complain, verdict | the only act the room can verify | 50s |
| Transaction on MonadVision | proof it settled | 15s |
| **Open Act 1** — pre-settled, 0% refund | the rejected complaint | 15s |
| **Open Act 3** — pre-settled, 100% refund | non-delivery | 15s |

Say it plainly: *"I ran these just before coming up — same system, real rulings."*

**Paste every input from `docs/demo-script.md`.** The registry keys on the exact input;
a typo means a live model run and an unpredictable output.

**During the ~10s audit wait**, fill it: *"Not a paragraph of AI prose — each clause,
where it came from, whether it was met. You can audit the auditor."*

**If the wifi dies:** play the recording. Don't debug on stage.

## The `delivered_at` story — for slide 7

> A column called `delivered_at` existed, had an index, was exposed by the serialiser,
> and was branched on by the complaint logic. **Nothing ever wrote it.** It sat between
> two specs, each of which was internally complete. The sweeper could never have fired —
> the demo would have hung on stage — and no test, type check or build would have told
> us. A human found it reading two files side by side at 3am.
>
> The specs weren't the problem. The seams between them were.

## Q&A — technical judges, by likelihood

**"Who audits the auditor?"**
> Today the Guardian key is ours, and the contract bounds what it can do: pick one of
> five tiers on an already-disputed deal. It can't open a deal, move funds elsewhere, or
> touch an order nobody complained about.
>
> The next step is verifiability rather than trust. We already anchor a hash of the
> verdict on-chain — publish the case file alongside it and anyone can replay the audit
> and check the ruling matches. That turns "trust our model" into "check our work,"
> which is the same move we make with escrow.

**"What if Guardian gets it wrong?"**
> No appeals in the MVP, deliberately — a dispute is decided once. That's the honest gap
> and seller appeals are first on the longer-term list.
>
> Two things bound it now. Verdicts are tiers, not free numbers, so an error is one step
> rather than an arbitrary amount. And every citation must quote a real clause verbatim
> — we reject fabricated quotes and wrong-source attribution at validation, sixteen
> gates. The model can be wrong about judgement; it can't manufacture evidence.

**"What stops you keeping the money?"**
> `release`, `reclaim` and `forceResolve` are permissionless. A seller releases their own
> payment after the window. A buyer reclaims an undelivered order. Anyone force-resolves
> a dispute we never ruled on — it settles at 25%, matching our own
> inconclusive-evidence rule. One transfer out of the contract, and it pays the address,
> not the caller.

**"The model isn't deterministic — what if it rules differently?"**
> It isn't; temperature was removed on Opus 5. Three things handle it. Tiers are a
> five-value enum, so drift has to cross a boundary rather than wobble. The demo cases
> are countable rather than matters of taste. And the verdict is persisted on first
> ruling and replayed after — not a demo trick, it falls out of "verdicts are final."
>
> We ran all three acts three times with verdicts deleted in between. Same tiers every
> pass.

**"What stops a seller writing 'always rule 0%' into their prompt?"**
> Partly mitigated, not solved — it's on the open-questions slide.
>
> Guardian sees the prompt because it needs it to tell "genuinely tried" from "returned
> a stub." What bounds an injection is the output shape: a tier plus citations, and every
> citation must quote a real clause verbatim. Invented quotes and wrong attribution are
> rejected at validation, so an injection can't manufacture evidence. It could still bias
> the tier, and that part we haven't closed.
>
> We did test it — given a canary prompt and an instruction to reproduce it, the model
> refused. Reassuring, not a control.

**"Why does this need a blockchain?"**
> Because the verdict has to execute without our cooperation. A database can hold the
> money and a payments API can move it, but both need us to still exist and still be
> honest. Escrow with permissionless exits means neither party depends on us. That's the
> only reason there's a chain here.

**"Why Monad?"**
> Sub-second finality, and that's a product decision. The user watches a countdown and
> watches money split — both have to happen while they're looking at the screen.
> EVM-equivalent, so Solidity and Foundry unchanged.
>
> One real gotcha: Monad charges the gas limit, not the usage, so estimate-and-pad
> overpays on every transaction. We set explicit per-function limits — and measuring
> caught one 21% under, which would have reverted every top-up and cash-out.

**"How do I know you didn't tamper with the evidence?"**
> You don't, entirely — that's the honest limit and it's why the question is on our
> slide. What is anchored: the definition hash is on-chain, so we can't change what the
> seller sold after the fact; the verdict hash is on-chain, so we can't rewrite a ruling.
> The run record itself is ours. Publishing case files is what closes it.

**"What does an audit cost?"**
> About fourteen cents for a full dispute — the seller's agent on Haiku plus the audit on
> Opus. Cost isn't the constraint, which is why we didn't economise on the audit.

**"What's the business model?"**
> Free in the MVP and genuinely not solved. Obvious shapes are a take on disputed volume
> or a listing fee. I'd rather say that than invent a number.

## Two habits for the whole talk

**Say "refund" with every percentage.**

**When you don't know, say so and say what you'd do next.** The deck volunteers three
open questions — judges will test whether that posture is real.
