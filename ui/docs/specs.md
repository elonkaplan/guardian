# `ui/` — Spec Breakdown

> How the frontend is split into speckit-sized specs.

Eight specs, dependency-ordered — **the last one runs the product rather than
building it.** Read [`CONTEXT.md`](./CONTEXT.md) first.

| # | Spec | Depends on | Size | Demo-critical |
| --- | --- | --- | --- | --- |
| UI-01 | Foundation: Vite, routing, API client | — | M | ✅ |
| UI-02 | Wallet connect & session | 01 | M | ✅ |
| UI-03 | Marketplace & agent detail (buy) | 02 | M | ✅ |
| UI-04 | Order Detail — the state machine | 03 | **L — the hero** | ✅ |
| UI-05 | Verdict card & case file | 04 | M | ✅ |
| UI-06 | Wallet page | 02 | M | ✅ |
| UI-07 | Seller pages | 02 | M | ○ |
| UI-08 | Verification pass & contract reconciliation | 01–07 **+ a live API** | M | ✅ |

**Why UI-05 is separate from UI-04.** Order Detail is a state machine; the verdict
card is a piece of argumentation. Splitting them means the card gets designed on its
own terms rather than as the last branch of a switch statement — and it's the single
component most likely to decide whether the demo lands.

**UI-07 isn't in either act** — the demo agents are seeded. It's here because
without it the marketplace is a catalogue nobody can join, and *"can anyone list an
agent?"* is an obvious question from the floor.

---

## UI-01 — Foundation

**Deliver:** an app that runs, routes, and talks to the API.

- Vite + React + TypeScript, strict
- Routes for all eight pages with placeholders
- Typed API client (base URL from `VITE_API_URL`, JWT header, error normalisation)
- A polling hook — interval, and **stop on a terminal state**
- App shell: header with balance widget and a link to Wallet
- `Dockerfile` + `docker-compose.yml`

**Done when** every route renders and the client reaches `/health`.

**Note:** for iteration `npm run dev` beats the container — Vite hot reload through
a Docker volume mount is noticeably laggier, especially on macOS. Compose is for a
clean one-command start.

**Source:** ui-design §2, project-structure §3.2.

---

## UI-02 — Wallet connect & session

**Deliver:** the entire registration flow — connect a wallet, and that's it.

- wagmi + viem, `monadTestnet` chain definition
- Connect button → `POST /auth/nonce` → sign → `POST /auth/verify` → JWT
- Session persistence, auth guard, disconnect
- Wrong-network detection with a switch prompt

**Done when** connecting produces an authenticated session that survives a reload.

**No passwords, no email, no Rain provisioning.** Connecting a wallet is the whole of
registration — worth keeping the screen as simple as that fact.

**Source:** ui-design §3 Flow A, api-design §7.

---

## UI-03 — Marketplace & agent detail

**Deliver:** browse, then buy.

- `/agents` — grid from `GET /agents`
- `/agents/:id` — **capabilities and exclusions presented as contract terms**, not
  marketing copy
- Buy form: input (per the agent's `input_schema`) + **acceptance criteria** (free
  text) + price
- `POST /orders` → redirect to `/orders/:id`
- Balance check with a link to top up

**The acceptance-criteria field is doing real work.** It's half of what Guardian
judges against, and the buyer writes it *before* any work happens. The form should
make that consequence visible — a vague criterion is a weak case later.

**Done when** a purchase creates an order and lands on its detail page.

**Source:** ui-design §3 Flow C, agent-definition §2.1.

---

## UI-04 — Order Detail (the hero page)

⚠️ **The demo happens here.** All three acts play out on this page.

**Deliver:** one page, five faces, driven by `orders.state`.

| State | Shows | Actions |
| --- | --- | --- |
| `purchased` / `running` | "Agent is working…", your input, elapsed | — |
| `delivered` | Output **beside** your acceptance criteria, **countdown** | Accept · Complain |
| `failed` | "The agent returned nothing." | Complain |
| `disputed` | "Guardian is reviewing…" | — |
| `adjudicated` / `settled` | Verdict card (UI-05) | — |

- Poll `GET /orders/:id` at 1s, **stop on terminal**
- Countdown from `delivered_at + review_window_seconds`, client-side
- Complain modal: reason → confirm
- Optional: total-escrow figure in the header

**The countdown is the proof escrow is real.** When it reaches zero the sweeper
releases and the page flips to `released` with nobody touching the keyboard. That is
Act 1's ending, and it only works if the countdown and the poll are both live.

**Output beside criteria, always.** Act 2's whole effect is the audience counting
rows and reaching 50% before Guardian says it. Stack them vertically and that
evaporates.

**Done when** an order can be watched from `running` to `released` without a manual
refresh, and a complaint moves it to `disputed`.

**Source:** ui-design §2.1, §5, product-workflow §5.3.

---

## UI-05 — Verdict card & case file

**Deliver:** the component that decides whether the audit reads as credible.

- Verdict card: tier badge, refund split (you / seller), reasoning
- **Citations as a ✓/✗ checklist** — each showing source
  (capability · exclusion · criterion), the quoted clause, and whether it was met
- Transaction hash linked to MonadVision
- Case-file panel: input, criteria, listing promise, execution steps, timings —
  **prompt redacted**

**Checklist, not prose.** *"The AI decided 50%"* and *"this clause, unmet, here is
the quote"* are the same information and completely different arguments. The
reasoning text supports the checklist; it must not replace it.

**Steps are shown but the prompt is not**, and the API summarises reasoning text
precisely because a step can paraphrase its own instructions. The UI just renders
what it's given — no client-side redaction, no code path that could render a prompt.

**Done when** a settled order shows tier, split, cited clauses, and a working
explorer link.

**Source:** ui-design §2.2, §7.1, agent-definition §4.

---

## UI-06 — Wallet page

**Deliver:** money in, money out, and the distinction between two kinds of it.

- `GET /me` → **available balance** and **in escrow**, as separate figures
- `GET /me/ledger` → statement
- **Add funds** → `POST /topup`, balance updates immediately (sub-second finality)
- **Withdraw** → `POST /withdraw` — settled funds to your own wallet
- **Cash out** → `POST /offramp` — unspent balance back to the treasury
- Copy: *"Funded from the demo treasury — Rain's onramp has no Monad rail yet."*

**Two exits, because there are two kinds of money:** available balance lives in the
platform ledger and leaves via cash-out; settled funds live on-chain under your own
address and leave via withdraw. One combined number would be wrong in both
directions.

**Volunteer where the money comes from.** A judge seeing "$100 added" with no bank
transfer will ask; answering first is much better than being asked.

**Done when** a top-up, a withdraw, and a cash-out each work and the ledger explains
all three.

**Source:** ui-design §3 Flow E, §4, database-schema §3.3.

---

## UI-07 — Seller pages

**Deliver:** proof that anyone can join the marketplace.

- `/sell` — my agents (`GET /agents?owner=me`) and my sales (`GET /sales`)
- Active toggle → `PATCH /agents/:id/active`
- `/sell/new` — create agent: name, description, price, **capabilities[]**,
  **exclusions[]**, input/output schemas (**raw JSON textareas**), system prompt,
  model
- Seller's view of a disputed order: full case file, verdict, **no reply** — no
  appeals in the MVP

**Label capabilities and exclusions as contract terms in the form.** A seller who
writes vague capabilities loses disputes; one who writes good exclusions wins them.
Saying so in the UI is the cheapest way to get better data into Guardian.

**Notified, but no right of reply.** That's a deliberate product decision, and the
seller's view should read as such rather than looking like a missing feature.

**Done when** an agent can be listed through the UI and appears in the marketplace.

**Source:** ui-design §3 Flow B, agent-definition §2, product-workflow §7.5.


## UI-08 — Verification pass & contract reconciliation

**Deliver:** the first time any of this is seen working.

UI-01…07 were built against **types describing an API that did not yet exist**. That
is the right way to build in parallel and it has one failure mode, which has already
happened once: UI-05's normaliser read `raw.clause` where the API sends `quote`.
Shapes agreed, names did not, and nothing caught it — the raw fields are optional
`unknown` by design, so a wrong name is an absent value, not a type error. It would
have surfaced as an empty checklist in Act 2, on stage.

- **Reconcile three ways** against `docs/openapi.yaml`: UI types ↔ contract (the UI is
  wrong), contract ↔ running API (the API or the contract is wrong — escalate), and
  contract ↔ `api-design.md` (the design decides). Names, enum members, nullability,
  status codes, and **auth per endpoint** — API-04's guard is global and fail-closed.
  Produce a written note of what disagreed, even if it says "nothing".
- **Find the decoupled surface**: endpoints the UI calls that the contract omits,
  endpoints nothing reaches, query semantics (`?owner=me` must include inactive), and
  every state transition the API writes that the UI must render.
- **Do not generate types from the contract** — several UI types encode guarantees by
  omission, and a faithful generator would delete them silently.
- Render all eight pages against a seeded database, reached by clicking
- **Run the three acts twice**, same verdicts both times
- UI-05's carryovers: quickstart Parts B–F, 3m legibility, the greyscale check, long
  clauses, the stranger test, and **T033** — delete `splitFor`'s subtraction if the
  API sends `sellerMinor`
- Check the redaction boundary in the **network response**, not the rendering

**Done when** three acts run twice with identical verdicts, no page polls past a
terminal state, and a buyer's case file carries no prompt text on the wire.

**Source:** ui-design, product-workflow §5.3/§5.5, CONTEXT §3, commit `67dcf4d`.


## No automated tests in this component

Time-boxed MVP decision: **only the escrow contract keeps a test suite** (`sc/`
SC-02). Everything here is verified by hand against each spec's acceptance criteria.

The trade is deliberate and worth naming: the contract is the one component where a
bug moves money incorrectly *and* costs a redeploy plus an `.env` update to fix.
Everything else can be corrected in place while the app is running.

**Consequence:** demo rehearsal is now the test suite. Run all three acts end to end
more than once, and treat a failed rehearsal the way you'd treat a red build.

## Individual spec files

Run these through `/speckit-specify` **in order** — each assumes the ones above it.

| # | Spec | File |
| --- | --- | --- |
| 1 | UI-01 — Foundation | [`specs/UI-01-foundation.md`](./specs/UI-01-foundation.md) |
| 2 | UI-02 — Wallet connect | [`specs/UI-02-wallet-connect.md`](./specs/UI-02-wallet-connect.md) |
| 3 | UI-03 — Marketplace | [`specs/UI-03-marketplace.md`](./specs/UI-03-marketplace.md) |
| 4 | UI-04 — Order Detail | [`specs/UI-04-order-detail.md`](./specs/UI-04-order-detail.md) |
| 5 | UI-05 — Verdict card | [`specs/UI-05-verdict-card.md`](./specs/UI-05-verdict-card.md) |
| 6 | UI-06 — Wallet page | [`specs/UI-06-wallet-page.md`](./specs/UI-06-wallet-page.md) |
| 7 | UI-07 — Seller pages | [`specs/UI-07-seller-pages.md`](./specs/UI-07-seller-pages.md) |
| 8 | UI-08 — Verification pass | [`specs/UI-08-verification-pass.md`](./specs/UI-08-verification-pass.md) |

Each file is self-contained enough for one speckit run: goal, in/out of
scope, acceptance criteria, and the specific traps for that slice.
