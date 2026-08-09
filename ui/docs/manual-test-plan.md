# Guardian — manual test plan

**For:** anyone with a browser and a wallet. **You do not need to read any source code.**
**Duration:** about **2 hours 15 minutes** for a full pass — §0 setup 30m · §1 5m · §2 45m ·
§3 20m · §4 15m · §5 10m · §6 15m · §7 5m. Budget three hours the first time.

---

## How to run this

Work top to bottom. Tick each step's box.

**Every step states exactly one expected result.** If what you see is not that result, the step
**fails** — write down what you saw instead and keep going unless the step says otherwise. Do
not decide a near-miss is close enough; a step you resolved generously at 3am is a step that
did not run.

Some steps carry a **⚠ If it fails** note. That note tells you what the symptom usually means,
so your report can say *"the citation rows are empty, which points at the field name"* rather
than *"the verdict looks wrong."*

**Report format:** step number · what you expected · what you saw. Nothing else is needed.

---

## §0 Preconditions

Everything here must be true **before step 1.1**. Do not start the acts and fix these as you
hit them — half the steps below become uninterpretable if the ground is not solid.

### §0.1 Services

| | Step | Expect | ✓ |
|---|---|---|---|
| 0.1.1 | Start Postgres: `docker compose up -d` in `api/` | `docker compose ps` shows the database container running and **published on port 5433** | ☐ |
| 0.1.2 | Confirm nothing else owns the port: `lsof -i :5433` | Only the Docker process. **A native Postgres commonly holds 5432 — Guardian does not use 5432**, so if the API cannot connect, check you did not point it at the wrong one | ☐ |
| 0.1.3 | Start the API: `npm run start:dev` in `api/` | The process stays up and logs a listening line for port 3000 | ☐ |
| 0.1.4 | Start the frontend: `npm run dev` in `ui/` | Vite prints a local URL and stays up | ☐ |
| 0.1.5 | Check `ui/.env.local` contains `VITE_API_URL=http://localhost:3000` | The value matches the port the API actually bound in 0.1.3 | ☐ |

### §0.2 Wallets

You need **two separate wallet accounts**. One wallet cannot be both buyer and seller — the
seller screens must show a sale the buyer made, and an account cannot buy from itself.

| | Step | Expect | ✓ |
|---|---|---|---|
| 0.2.1 | In your browser wallet, add **Monad Testnet** and select it | The wallet reports chain id **10143** | ☐ |
| 0.2.2 | Confirm **account A (buyer)** holds MON for gas | A non-zero MON balance | ☐ |
| 0.2.3 | Confirm **account B (seller)** holds MON for gas | A non-zero MON balance | ☐ |
| 0.2.4 | Confirm the operator/treasury wallet configured in `api/.env` holds MON **and test USDC** | Both non-zero. This wallet funds every top-up and pays every settlement — if it is empty, Act 2's split will fail with a chain error and you will spend an hour blaming the frontend | ☐ |

### §0.3 Seed data

| | Step | Expect | ✓ |
|---|---|---|---|
| 0.3.1 | `curl -sX POST localhost:3000/demo/seed` | HTTP 200, and the body lists three agents with keys `ledgerbot`, `tldr`, `polyglot`, each with a non-null `onchainAgentId` | ☐ |
| 0.3.2 | Read the `fixtures` array in that response | Three entries, `act: 1`, `act: 2`, `act: 3`. **Keep this response open** — §2 tells you to paste values from it verbatim | ☐ |

> ⚠ **If `onchainAgentId` is null** for any agent, on-chain registration did not complete. Stop
> and fix that first: an agent in that state cannot be bought, and every act below will fail at
> the purchase step for a reason that has nothing to do with the frontend.

### §0.4 Reference figures

The prices and expected outcomes for the whole pass. Check them against the seed response.

| Act | Agent | Price | Verdict tier | Buyer gets back | Seller keeps |
|---|---|---|---|---|---|
| 1 | TLDR Agent | **$1.00** | `none` (0%) | **$0.00** | **$1.00** |
| 2 | LedgerBot | **$2.00** | `half` (50%) | **$1.00** | **$1.00** |
| 3 | PolyglotAI | **$1.50** | `full` (100%) | **$1.50** | **$0.00** |

---

## §1 Smoke

Five cheap checks. If any of these fails, stop — everything after it becomes noise.

| | Step | Expect | ✓ |
|---|---|---|---|
| 1.1 | Open the Vite URL in your browser | The app renders. Not a blank page, not a stack trace | ☐ |
| 1.2 | `curl -s localhost:3000/health` | `{"status":"ok"...}` with `"database":{"status":"up"}` | ☐ |
| 1.3 | Open `localhost:3000/docs` in a browser | An API documentation page renders with a list of endpoints | ☐ |
| 1.4 | Click Connect, choose your wallet, approve the connection, then **approve the signature prompt** | You land signed in — the header shows your address and the guarded pages become reachable | ☐ |
| 1.5 | Reload the page (⌘R) | You are **still signed in**. You are not returned to the Connect screen and no second signature is requested | ☐ |

> ⚠ **If 1.4 fails with "Signature verification failed"** after you approved the prompt in your
> wallet, that is **not** your wallet rejecting anything. It means the app signed the wrong
> string — it must sign the `message` field from `POST /auth/nonce`, never the `nonce`. This
> exact bug shipped once and locked every account out of every page. Report it as a sign-in
> defect, not a wallet problem.

> ⚠ **If 1.5 returns you to Connect**, the session is not surviving a reload. Report it — every
> later step assumes it does, and you will otherwise be re-signing all afternoon.

---

## §2 The three acts

The centre of the pass. Run each act start to finish, in order.

**Paste the fixture values verbatim** from the §0.3.2 seed response. A retyped input is a
*different* input: the agent will produce a live result rather than the scripted one, the tier
may not match the table in §0.4, and you will not know whether the mismatch is a bug or your
typing.

Sign in as **account A (buyer)** for all of §2.

### §2.1 Act 1 — the rejected complaint (0%)

| | Step | Expect | ✓ |
|---|---|---|---|
| 2.1.1 | From the marketplace, open **TLDR Agent** | The detail page shows the price as **$1.00** — not `100`, not `$100.00` | ☐ |
| 2.1.2 | Look for the agent's instructions or prompt anywhere on this page | **Nothing of the kind is shown.** No system prompt, no model name | ☐ |
| 2.1.3 | Fill the input form with the act-1 fixture (`wordCap`, `document`) | The form accepts both values | ☐ |
| 2.1.4 | Type the acceptance criteria **exactly**: `Under 100 words, must cover the pricing change.` | The text appears in the criteria field | ☐ |
| 2.1.5 | Look for a field letting you set the price or the review window | **There is none.** Neither is a thing a buyer can choose | ☐ |
| 2.1.6 | Buy | You land on the order page for this order | ☐ |
| 2.1.7 | Watch the order page **without touching anything** | The page moves from *purchased* through *running* to showing a delivered output, on its own | ☐ |
| 2.1.8 | Read the delivered screen | The **acceptance criteria you typed are on screen beside the output** — you can compare them without scrolling to another page | ☐ |
| 2.1.9 | Read the countdown | It shows a decreasing time remaining and ticks down without you refreshing | ☐ |
| 2.1.10 | Click Complain and submit: `This is far too short. I paid for a summary of a multi-section memo and got one paragraph — it cannot possibly cover a document this size properly.` | **Without any refresh**, the page moves to a disputed state | ☐ |
| 2.1.11 | Keep watching, still without refreshing | A **verdict card appears on its own** | ☐ |
| 2.1.12 | Read the tier on the card | It reads as **0% / none** | ☐ |
| 2.1.13 | Read the refund figure | **$0.00 to you, $1.00 to the seller** | ☐ |
| 2.1.14 | Read the citation checklist | Each row shows **quoted text from the criteria or the listing** beside a ✓ or ✗ mark | ☐ |
| 2.1.15 | Read the reasoning | It refers to the buyer's own word cap — the ruling explains *why* the complaint was rejected | ☐ |
| 2.1.16 | Wait for the transaction hash to appear, then click it | A block-explorer page opens **and that page exists** — it shows a transaction, not a 404 or an empty search result | ☐ |

> ⚠ **If the checklist rows render as empty quotation marks** — marks present, no text — the
> app is reading the wrong field name off the citation. That is a data-plumbing bug, **not a
> styling problem**. Report it as "citations render with empty quotes."

> ⚠ **If 2.1.11 never happens** and the page sits on disputed indefinitely, check whether the
> verdict request stopped firing (browser Network tab, filter `verdict`). A poll that gave up
> on a still-running audit is a known failure mode: the request returns 404 while the audit is
> in progress, and stopping on that 404 is wrong.

### §2.2 Act 2 — the partial refund (50%)

The centrepiece. The audience should be able to count the missing rows themselves.

| | Step | Expect | ✓ |
|---|---|---|---|
| 2.2.1 | Note your available balance before starting | Write the figure down — 2.2.12 compares against it | ☐ |
| 2.2.2 | Open **LedgerBot**, paste the act-2 `receiptText` fixture verbatim | Price shows **$2.00** | ☐ |
| 2.2.3 | Type the criteria exactly: `Extract all line items with their amounts, and give the correct total.` | Text appears in the criteria field | ☐ |
| 2.2.4 | Buy, then watch without touching anything | The page reaches a delivered output on its own | ☐ |
| 2.2.5 | Count the line items in the delivered output | **3** — the receipt has 5. Two are missing, and you can see that from the screen | ☐ |
| 2.2.6 | Complain: `Two line items are missing — the desk lamp and the cable kit — so the total is 62.00 short. It also left everything in euros instead of converting the amounts to dollars.` | Page moves to disputed **with no refresh** | ☐ |
| 2.2.7 | Wait | The verdict card appears on its own | ☐ |
| 2.2.8 | Read the tier | **50% / half** | ☐ |
| 2.2.9 | Read the split | **$1.00 back to you, $1.00 to the seller** — two figures, both in dollars | ☐ |
| 2.2.10 | Read the checklist | At least one ✗ row, quoting the criterion about extracting all line items | ☐ |
| 2.2.11 | Click the transaction hash | An explorer page that exists, showing a transaction | ☐ |
| 2.2.12 | Return to the app and compare your balance against 2.2.1 | **The figure moved.** The $1.00 refund is reflected | ☐ |

### §2.3 Act 3 — non-delivery, full refund (100%)

| | Step | Expect | ✓ |
|---|---|---|---|
| 2.3.1 | Open **PolyglotAI**, paste the act-3 fixture (`targetLanguage`, `preserveTerms`, `text`) | Price shows **$1.50** | ☐ |
| 2.3.2 | Type the criteria exactly: `Translate the product description into German, keeping the product names unchanged.` | Text appears | ☐ |
| 2.3.3 | Buy and watch | The order reaches a **failed** state — the screen says the agent returned nothing | ☐ |
| 2.3.4 | Read that screen carefully | It says **nothing came back**. It does not show an empty output panel that could be mistaken for a blank result, and it does not still say the agent is working | ☐ |
| 2.3.5 | Complain: `Nothing came back at all. There is no translation in the order — I paid $1.50 and received an empty result.` | Page moves to disputed with no refresh | ☐ |
| 2.3.6 | Wait | Verdict card appears on its own | ☐ |
| 2.3.7 | Read the tier | **100% / full** | ☐ |
| 2.3.8 | Read the split | **$1.50 back to you, $0.00 to the seller** | ☐ |
| 2.3.9 | Click the transaction hash | An explorer page that exists | ☐ |

### §2.4 The uncontested path — the page flips on its own

None of the three acts exercises this, and it is the single most-watched moment of the demo.
Do it separately.

| | Step | Expect | ✓ |
|---|---|---|---|
| 2.4.1 | Buy **TLDR Agent** again with any input and any criteria | You land on a new order page | ☐ |
| 2.4.2 | Wait for delivery, then note the countdown value | A decreasing time remaining | ☐ |
| 2.4.3 | **Put your hands in your lap.** Do not click, do not scroll, do not refresh. Watch the countdown reach zero | When it hits zero the page **changes state on its own** to released — with nobody touching the keyboard | ☐ |
| 2.4.4 | Confirm the page did not need a nudge | You did not press anything between 2.4.2 and 2.4.3 | ☐ |

> ⚠ **If the page sits at zero unchanged**, the automatic release is not reaching the screen.
> Refresh once: if the state *then* updates, the backend worked and the page is not polling —
> report that distinction, it is the useful half of the finding.

### §2.5 My Orders

| | Step | Expect | ✓ |
|---|---|---|---|
| 2.5.1 | Click **My Orders** in the navigation | A page titled "My Orders" showing a **placeholder**, not a list of your orders | ☐ |

> **This placeholder is the expected result, not a failure.** The page was never built — all
> three acts run on the order detail screen, reached from the purchase flow. Tick the box and
> move on. It is listed here only so you do not spend twenty minutes reporting it.

---

## §3 Seller flow

Sign out and sign in as **account B (seller)**.

> **Nothing in this section has ever been run before.** Every seller route sits behind sign-in,
> and sign-in was broken until recently — so these screens have never rendered for anyone.
> Expect first-run surprises here, and report them as findings rather than assuming you did
> something wrong.

| | Step | Expect | ✓ |
|---|---|---|---|
| 3.1 | Go to the sell area and list a new agent (any name, description, price, schemas, prompt) | The agent is created and appears in **your agents** list | ☐ |
| 3.2 | Open the public marketplace | Your new agent **appears there** | ☐ |
| 3.3 | Back on your agents list, switch the new agent **off** | The row's availability control now reads that it is not on the market | ☐ |
| 3.4 | Reload the marketplace | The agent is **gone** from the public list | ☐ |
| 3.5 | Return to your agents list | **The agent is still there**, shown as off the market | ☐ |
| 3.6 | Switch it **back on** | The control returns to on-the-market, and the agent reappears in the marketplace | ☐ |
| 3.7 | Look for an agent on your list whose on-chain registration did not complete | It carries a **visible text marker saying buyers cannot see it** — a badge or label with words, not merely a different shade | ☐ |
| 3.8 | Compare that row against a healthy one | The difference is **stated in words**, so it survives a black-and-white screenshot | ☐ |

> ⚠ **If step 3.5 fails and the switched-off agent has vanished from your own list**, the
> seller's list is filtering to active agents only. That makes the switch **one-way** — there is
> no screen left that could switch it back on. It looks like a working feature right up until
> someone tries to undo it, which is why 3.5 exists.

> **If you have no unregistered agent** for 3.7, that is normal on a clean seed. Note the step
> as not exercised rather than passed — do not tick it.

### §3.9 The seller's view of a dispute

| | Step | Expect | ✓ |
|---|---|---|---|
| 3.9.1 | Open your sales list | The Act 2 sale (LedgerBot, $2.00) is listed, marked as disputed | ☐ |
| 3.9.2 | Open that sale | The page loads — you are the agent's owner, and owners may read a sale they did not buy | ☐ |
| 3.9.3 | Read the case file | It is **readable**: the buyer's input, the criteria, the output | ☐ |
| 3.9.4 | Read the verdict | The same ruling the buyer saw — tier 50%, the split, the citation checklist | ☐ |
| 3.9.5 | Look for any control to reply to, appeal, or contest the dispute | **There is none.** There is no reply box and no appeal button | ☐ |
| 3.9.6 | Look for the buyer's wallet address anywhere on this page | **It is not shown.** You learn what was ordered and what was ruled, not who bought it | ☐ |
| 3.9.7 | Read the execution trace section on **this seller page** | It lists the steps the agent took | ☐ |

### §3.10 The buyer's view is the same view

| | Step | Expect | ✓ |
|---|---|---|---|
| 3.10.1 | Sign back in as **account A (buyer)** and open the same settled Act 2 order | The verdict card renders | ☐ |
| 3.10.2 | Compare it against what you saw at 3.9.4 | **Identical** — same tier, same figures, same checklist rows, same layout. Being the buyer rather than the seller changed nothing about the verdict card | ☐ |

---

## §4 Money

Stay signed in as **account A**.

| | Step | Expect | ✓ |
|---|---|---|---|
| 4.1 | Open the Wallet page | **Three separate figures** are shown — available balance, money in escrow, and settled funds. They are not summed into one number | ☐ |
| 4.2 | Read the labels | Each figure says what it is. You can tell which one you could spend right now | ☐ |
| 4.3 | Find the explanation of where the money came from | The page states the balance was **funded from the demo treasury** — a reader is not left wondering what bank transfer happened | ☐ |
| 4.4 | Top up by a known amount | The available balance increases by that amount | ☐ |
| 4.5 | Open the ledger | A **new entry** for that top-up, with a positive amount | ☐ |
| 4.6 | Cash out a known amount | The available balance decreases by that amount, and a **new ledger entry** appears with a negative amount | ☐ |
| 4.7 | Read the ledger's amount column | Credits and debits are distinguishable **by a word or sign, not only by colour** | ☐ |
| 4.8 | Attempt a withdrawal of settled funds | Either a transaction hash appears (that links to a real explorer page), **or** a clear message saying there is nothing settled to withdraw. Not a silent failure | ☐ |
| 4.9 | Look for a ledger entry explaining the Act 2 settlement | **There is none, and the page says so** — settled money goes to your own wallet address on-chain and never passes through the platform ledger | ☐ |
| 4.10 | Re-read the three figures | They are still three. Nothing on this page has collapsed them into a single "balance" | ☐ |

---

## §5 Degradation

What good failure looks like. Some of these need you to break something on purpose.

| | Step | Expect | ✓ |
|---|---|---|---|
| 5.1 | Stop the API (`Ctrl-C` in its terminal), then reload the Wallet page | A **labelled error or loading state** — a line of text saying what is happening. Not a blank card, not a spinner with no words | ☐ |
| 5.2 | With the API still down, read the settled-funds figure | It reads **`—` or "unknown"**. It does **not** read `$0.00` | ☐ |
| 5.3 | Restart the API and reload | The figures return | ☐ |
| 5.4 | Open a settled order, then watch it for thirty seconds | The state **never moves backwards** — a settled order does not flicker back to disputed or to running | ☐ |
| 5.5 | Open the browser Network tab on that settled order and watch for a minute | The order and verdict requests **stop firing** once the order is settled. They do not poll forever | ☐ |
| 5.6 | Navigate to a made-up order URL (change the id to random characters) | A clear not-found message that **stops**. The page does not retry forever with a spinner | ☐ |

> ⚠ **On 5.2:** `$0.00` in place of `—` is a real defect, not a cosmetic one. It tells a seller
> they earned nothing when the truth is that nobody could read the figure.

> ⚠ **On 5.6:** if the network tab shows the same request repeating every second, the app is
> retrying something permanently broken. Report it — that is a bug that only shows up here.

---

## §6 Human-judgement checks

Four checks no script can make. Do all four.

### §6.1 Greyscale

| | Step | Expect | ✓ |
|---|---|---|---|
| 6.1.1 | Screenshot the Act 2 verdict card. Desaturate it (Preview → Tools → Adjust Color → Saturation to 0, or any image editor) | Every ✓ and ✗ is **still distinguishable** — you can tell which clauses were met | ☐ |
| 6.1.2 | In the same greyscale image, read the tier and the refund figure | Both readable | ☐ |
| 6.1.3 | Screenshot the seller's agents list (§3) and desaturate it | An off-the-market agent is **still identifiable** as off the market | ☐ |
| 6.1.4 | In the same greyscale image, find an unregistered agent | It is **still marked** as invisible to buyers | ☐ |

> **A failure here is a defect, not a polish item.** Demos run on projectors, and projectors
> wash out colour. A refund decision carried by colour alone is a refund decision the room
> cannot read.

### §6.2 Legibility at three metres

| | Step | Expect | ✓ |
|---|---|---|---|
| 6.2.1 | Put the Act 2 verdict card on screen. Stand back **about three metres** — a judge's distance | You can read the **tier** | ☐ |
| 6.2.2 | From the same distance | You can read the **refund figure** | ☐ |
| 6.2.3 | From the same distance | You can tell the **✓ and ✗ marks apart** | ☐ |

### §6.3 The stranger test

| | Step | Expect | ✓ |
|---|---|---|---|
| 6.3.1 | Find someone who has not seen this project. Show them the settled Act 2 order. Say nothing | Within about **thirty seconds** they can tell you **what happened and why** — that the buyer got half their money back, and roughly what the agent got wrong | ☐ |
| 6.3.2 | Ask them what the ✗ rows mean | They can answer without help | ☐ |

> If they cannot, the card has failed at its only job. Record what they said instead — their
> wrong answer is the most useful thing in this document.

### §6.4 Long clauses

| | Step | Expect | ✓ |
|---|---|---|---|
| 6.4.1 | Buy any agent and enter an acceptance criterion of **roughly 300 characters** (a long run-on sentence is fine). Complain and wait for the verdict | The checklist renders it: the text **wraps or is contained**, and the row's ✓/✗ mark is still visible and aligned | ☐ |
| 6.4.2 | Check the surrounding layout | Nothing has overflowed its container or pushed the refund figure off screen | ☐ |

---

## §7 Redaction

The one section where you check the **network response**, not the page. A field the screen
declines to display is still a field that was sent.

| | Step | Expect | ✓ |
|---|---|---|---|
| 7.1 | Sign in as **account A (buyer)**. Open the settled Act 2 order with the browser Network tab open | You can see the requests the page makes | ☐ |
| 7.2 | Find the `case-file` request and open its **Response** | The raw JSON is visible | ☐ |
| 7.3 | Search that JSON for `systemPrompt` | **Not present.** The seller's instructions were never sent to the buyer's browser | ☐ |
| 7.4 | Search it for `prompt`, `reasoning`, and `raw` | None of them present as fields carrying model text | ☐ |
| 7.5 | Find the `verdict` request response and search it for `systemPrompt` | Not present | ☐ |
| 7.6 | Find the agent detail request (`/agents/...`) and search its response for `systemPrompt`, `model`, `timeoutSeconds` | None present | ☐ |
| 7.7 | Look at the `steps` array in the buyer's case-file response | **Populated** — one entry per recorded step, each with `label`, `summary`, `durationMs`, `error` and **nothing else** | ☐ |
| 7.8 | Read one of those step objects field by field | No `reasoning`, no `prompt`, no `raw`. `summary` is a terse platform sentence, not model prose | ☐ |
| 7.9 | On the buyer's screen, check the trace section renders those steps | The list is on screen. The empty-state sentence is **not** shown | ☐ |

> **7.7 changed on 2026-08-09.** It used to expect `[]` — the server sent a buyer no trace at
> all, which was `api-wrong` row 5 of `api/docs/openapi-divergences.md`. That is fixed: a buyer
> now receives the redacted trace. **An empty array on the Act 2 order is now a failure to
> report**, not the expected result.
>
> **7.8 is the redaction check, and it is the one that matters here.** The buyer's copy is
> summarised, not raw: `reasoning` can paraphrase the seller's system prompt, so it must never
> appear. If any step carries a `reasoning` field, or a `summary` that reads like the model
> talking rather than the platform describing, stop and report it — that is invariant #3
> failing. The seller's copy of the same order (§3.9.7) carries `rawSteps`, and *that* one is
> supposed to have the prose in it.

---

## Running it again

```bash
curl -sX POST localhost:3000/demo/reset
```

**What reset clears:** every order, run, complaint, and verdict.

**What reset keeps:**

- **Accounts and sign-ins.** You stay signed in; you do not re-register.
- **Agents and their on-chain registrations.** You do not re-seed to get the three demo agents
  back, and their `onchainAgentId`s do not change.
- **Every ledger entry.** The ledger is append-only and is never deleted or reversed.

**What reset does *not* undo — read this before a second run:**

- **It does not restore spent balance.** Money you spent is gone from the available balance.
  Top up again through the ordinary flow (§4.4).
- **It does not recall escrowed funds.** If the response's `ordersInFlight` is non-zero, those
  orders were mid-flight and their money is still escrowed on-chain. Clearing the database
  record cannot bring it back.
- **It does not touch the chain at all.** Settled money is at the recipient's own address.

> ⚠ A long rehearsal session drains the treasury wallet. If purchases start failing after
> several passes, check §0.2.4 before suspecting the app.

---

## Carryover index

Criteria deferred from earlier work, and where each one is checked here. **Nothing on this list
may be dropped without replacing it with a step.**

| From | Criterion | Checked at |
|---|---|---|
| UI-07 T039 | Greyscale on the seller screens | §6.1.3, §6.1.4 |
| UI-07 T040 | The seller flow end to end | §3.1–3.8 |
| UI-07 T029 (live) | Open a settled order **as the buyer** and confirm the buyer/seller setting changed nothing about the verdict card | §3.10 |
| UI-07 | The seller reading a disputed sale's case file and verdict — owner authorisation from the seller's side | §3.9 |
| UI-05 quickstart B–F | The verdict card walkthrough | §2.1.11–2.1.16, §2.2.7–2.2.12 |
| UI-05 | Greyscale on the verdict card | §6.1.1, §6.1.2 |
| UI-05 | Legibility at ~3m | §6.2 |
| UI-05 | Long clauses do not break the checklist | §6.4 |
| UI-05 | The stranger test | §6.3 |
| UI-05 T033 | *If the API sends the seller's share, stop deriving it* | **Answered, no step needed.** The API does not send it — the contract's verdict response has no such field — so the client-side subtraction stays. See `docs/reconciliation-note.md` |

---

## Result

| | |
|---|---|
| Run by | |
| Date | |
| Steps passed | ____ / ____ |
| Steps failed | |
| Not exercised | |
| Blockers found | |
