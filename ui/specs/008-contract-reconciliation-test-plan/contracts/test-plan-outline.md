# Contract: `ui/docs/manual-test-plan.md`

The required shape of deliverable 2. The tester is a human with a browser who has not read the
source, and who may be running this tired.

## The four rules

Every step obeys all four. They are the difference between a checklist and prose.

1. **One expected result per step**, specific enough that pass or fail is not a judgement
   call. *"Check the wallet page looks right"* is worthless. *"The Settled figure reads `—`
   with the note 'unknown, not zero'; it does not read `$0.00`"* is a test. *(FR-026)*
2. **A pass/fail box on every step.** It is a checklist to run, not prose to read. *(FR-027)*
3. **Name the symptom wherever a failure is subtle.** *"If the citation checklist renders rows
   with empty quotation marks, the field name is wrong — that is the `quote`/`clause` bug, not
   a styling problem."* Naming the symptom is what makes a tester able to report something
   useful. *(FR-028)*
4. **Never assert something a browser cannot show.** "The state is `adjudicated`" is not
   observable. "The verdict card appeared" is.

**Banned words in an expected result**: *looks right · looks correct · seems fine · renders
properly · works · is displayed correctly*. Greppable, and the quickstart greps for them.

## Required sections

### §0 Preconditions

Everything true before step 1. Anything the tester must fix belongs here, not discovered at
step 40. *(FR-031)*

- Services up and on which ports — **Postgres is on `5433`**; a native Postgres holds 5432
- Which wallets need MON and which need test USDC, and roughly how much
- `POST /demo/seed` run, and what it creates
- Browser wallet connected to **Monad Testnet, chain `10143`**
- Two accounts available — the acts need a buyer and a seller, and one wallet cannot be both

### §1 Smoke

The cheap checks that make every later failure interpretable. *(FR-032)*

App loads · `/health` answers · `/docs` renders · **sign-in produces a session that survives a
reload**.

> The sign-in step carries a symptom note. R-01 is exactly this failure — a 401 from
> `/auth/verify` that the screen renders as the backend's own copy, so it reads like a rejected
> signature rather than a client defect. A tester who sees "signature verification failed"
> after approving the prompt in their wallet should report R-01, not a wallet problem.

### §2 The three acts

Each start to finish, per `product-workflow.md` §5.3. For each act: the exact input, the
acceptance criteria to type, the expected tier, the expected split **in dollars**, and what
appears on screen at every state change. *(FR-033)*

> Post the seeded fixture values **verbatim**. The contract says so in
> `SeededFixtureResponse`: *"A retyped input is a different input and produces a live run
> rather than the scripted one."*

Four steps are named explicitly because they are the demo's actual argument *(FR-034)*:

- The countdown reaches zero and **the page flips with nobody touching the keyboard**
- A complaint moves the page to `disputed` and on to a verdict **without a refresh**
- The transaction hash links out and **the page it lands on exists**
- Balance figures move when an order settles

Discharges carryovers QS-B…QS-F.

### §3 Seller flow

List an agent · see it in the marketplace · toggle it inactive · watch it leave · **toggle it
back**. *(FR-035)*

- A step for an agent with `listed: false`: **visibly distinguished on the seller's own list**,
  since it cannot be bought and nothing else on the screen would say so. This is R-03, and the
  step that catches an `?owner=me` filtered to active — which looks like a working feature
  until someone tries to undo it.
- Open a **disputed sale as the seller**: the case file and verdict are readable, and there is
  **no reply control**.
- Open a **settled order as the buyer** and confirm the verdict card is identical to the
  seller's view — the `perspective` prop changed nothing. (T029-live; the static tier only
  proved the diff was small.)

Discharges T040, T029-live, SELLER-DISPUTE.

> **These have never run.** Every seller route is behind `RequireAuth`, and R-01 means sign-in
> has been failing — so no seller screen has ever rendered. Expect first-run surprises here
> and report them as findings, not as tester error.

### §4 Money

Top-up · cash-out · withdraw · and the ledger explaining all three. **The three figures never
collapse into one.** *(FR-036)*

Includes a step for "funded from the demo treasury" being stated on screen — a judge seeing
"$100 added" with no bank transfer will wonder.

### §5 Degradation

What the tester should see when things fail *(FR-037)*: a settled figure of `—` rather than
`$0.00` · a labelled loading line rather than a blank card · **a page that does not move
backwards**.

Add one step for the 502 `ChainOutcomeUnknownResponse`: it is **not a failure**. The
transaction may still confirm, and the expected result is a transaction hash to follow, not an
error banner.

### §6 Human-judgement checks

The ones no script can make. Four, all required. *(FR-038)*

- **Greyscale.** Screenshot the verdict card and the seller screens, desaturate, confirm ✓ and
  ✗ remain distinguishable — and that a `listed: false` agent is still marked. Colour alone
  carrying a refund decision fails on a projector, and projectors are what demos run on.
- **Legibility at ~3m**, a judge's distance: tier, refund figure, ✓/✗ marks.
- **The stranger test.** Someone who has not seen the code reads a settled order and says what
  happened and why. If they cannot, the card has failed at its only job.
- **Long clauses.** A citation quoting a ~300-character criterion must not break the checklist.

Discharges T039, GREY-VERDICT, LEGIBILITY-3M, STRANGER, LONG-CLAUSE.

> Anything failing greyscale or 3m legibility is **wrong, not unpolished** — it fails at the
> distance the demo is actually watched from.

### §7 Redaction

Open a buyer's case file and check the **network response**, not the rendering. A field the
frontend declines to display is still a field that was sent. *(FR-039)*

Expected: no `systemPrompt` anywhere in the buyer's payload.

**One step needs a symptom note**: the buyer's `steps` array is **`[]` on every order, and that
is a known API defect (R-04), not a frontend failure.** Without this note a tester reports the
empty trace as a bug in the page. The seller's case file for the same order carries the
populated trace, which is the check that distinguishes the two.

## Also required in the document

- **A rough duration**, so a full pass can be scheduled rather than started at 3am. *(FR-029)*
- **Reset instructions** — `POST /demo/reset` between runs, and **what it does and does not
  clear**. On-chain state is not reset by a database call, and a tester who assumes otherwise
  will misread the second run. *(FR-030)*
- **A carryover index** — the ten register entries mapped to their steps, so nothing deferred
  is lost. *(FR-040)* Includes T033, marked `answered` by the reconciliation rather than
  discharged by a step.
- **An expected-placeholder note for My Orders.** The nav links to a route that is a titled
  placeholder. That is the expected result (R-07); without saying so, a tester reports a false
  failure.

## What the plan must not do

- **Not be executed as part of this feature.** No step reported as passing. *(FR-041)*
- **Not describe pages that do not exist.** *(FR-043)*
- **Not assume source access.** Every step readable by someone who has never opened the repo.
