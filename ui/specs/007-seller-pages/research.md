# Phase 0 — Research: Seller pages

**Feature**: `007-seller-pages` · **Date**: 2026-08-09 · **Spec**: [spec.md](./spec.md)

Eighteen decisions. The ones worth arguing about are **R2** (one verdict card wearing two perspectives, rather than a second family of seller components), **R6** (this screen polls, which contradicts a table in the root UI doc), **R9** (the app's non-idempotency doctrine deliberately does *not* extend to the availability toggle), **R14** (a shipped money parser gains a parameter so that a price is not refused with a sentence about the treasury), and **R16** (the fourth copy of the same envelope-unwrap is the one that gets extracted).

> **Revised 2026-08-09, after api-design §3.3 and §3.4 were amended.** Two things this plan had carried as handoff assumptions are now written contract — `GET /agents?owner=me` includes inactive agents, and the case file and verdict authorise the buyer *or* the agent's owner. A third row changed with them: **`GET /orders/:id` is now "Buyer *or* seller"**, which this plan had assumed would stay buyer-scoped. That one is not a confirmation, it is a simplification, and it retires two decisions below. **R3 is withdrawn** (no `OrderIdentity` extraction is needed) and **R7 is rewritten** (the seller's dispute screen reads the order directly, through the hook that already exists, instead of polling the sales list to find one row). Both are left in place with their original reasoning visible, because a decision that was reversed by a document is worth being able to trace.

---

## R1 — Four unbuilt endpoints, but the database beneath them is finished

**Decision**: Build against the documented contract for `GET /agents?owner=me`, `POST /agents`, `PATCH /agents/:id/active`, and `GET /sales`. Record every field-name assumption in [contracts/internal-api.md §8](./contracts/internal-api.md), and confine the blast radius of a wrong guess to `api/types.ts`, `api/agents.ts`, and `api/sales.ts`.

**Rationale**: `grep -rn "@Controller(" api/src/` returns four modules — `auth`, `health`, `accounts`, `rain` — so the catalogue and order controllers are genuinely absent. What is *not* absent is everything underneath them: `api/src/entities/` already carries `agent.entity.ts`, `agent-version.entity.ts`, `order.entity.ts`, `verdict.entity.ts`, `complaint.entity.ts`, and `run.entity.ts` as mapped entities with their columns named.

That changes the character of the guesswork. This plan is not inventing a payload; it is reading one off a schema that is already committed:

| Frontend field | Entity column | Note |
| --- | --- | --- |
| `name`, `description`, `capabilities`, `exclusions` | `agent_versions.name / description / capabilities / exclusions` | `text[] NOT NULL` for both arrays — may be empty, never absent |
| `priceMinor` | `agent_versions.price_minor` (`bigint`) | Integer cents, the app's one money representation |
| `inputSchema`, `outputSchema` | `agent_versions.input_schema / output_schema` (`jsonb`) | Arbitrary JSON — nothing upstream validates them as schemas |
| `systemPrompt`, `model` | `agent_versions.system_prompt / model` (`text`) | The execution spec. Written once by this app, never read back (R17) |
| `active` | `agents.active` (`boolean`, **default `true`**) | Settles the spec's assumption: a new agent is on the market immediately |
| `state`, `priceMinor`, `createdAt`, `disputedAt` | `orders.*` | A sale is an order row selected by owner rather than by buyer |

The entity properties are already camelCase (`ownerAccountId`, `priceMinor`, `systemPrompt`), so a serialiser that hands the entity out unchanged produces exactly the names below. That is the assumption, and it is a much shorter guess than UI-05's or UI-06's were.

`agent_versions.timeout_seconds` has a column default of 120, which is why the form does not collect it and this feature does not send it.

**The two rules this feature most depends on are now in the doc rather than in this plan.** api-design §3.3 lists `GET /agents?owner=me` as its own row, with the reason attached — *"Includes inactive. Without this the availability toggle is one-way."* §3.4 marks the order read, the case file, and the verdict as **buyer *or* seller**, with a paragraph explaining that the narrow check is the natural one to write and silently removes half the seller experience. Both were handoff assumptions when this plan was written; they are contract now, which means API-06 and API-07 read the same sentences this feature was built against instead of inheriting them from a spec directory they have no reason to open.

**Alternatives considered**: waiting for the API's catalogue module (the frontend has been the leading edge for six features and the demo is the frontend); MSW mocks (a test dependency in a repo that deliberately has no tests).

---

## R2 — One verdict card and one case-file panel, each wearing a perspective

**Decision**: Add a `perspective: 'buyer' | 'seller'` prop to `VerdictCard`, `CitationChecklist`, and `CaseFilePanel`. It is **required**, not defaulted. It changes copy only — never layout, never which fields render, never the arithmetic.

**Rationale**: The seller's screen has to show the same two artefacts the buyer's does, and four sentences in them are written from the buyer's chair:

| Component | Buyer copy | Seller copy |
| --- | --- | --- |
| `VerdictCard` → `Split` | "You get back" / "The seller keeps" | "The buyer gets back" / "You keep" |
| `CitationChecklist` note | "…the criteria **you** wrote before the work started" | "…the criteria **the buyer** wrote before the work started" |
| `CitationChecklist` → `sourceLabel` | "Your criterion" | "The buyer's criterion" |
| `CaseFilePanel` summary + two headings | "your input, your criteria" / "What you submitted" / "Your acceptance criteria" | "the buyer's input, their criteria" / "What the buyer submitted" / "The buyer's acceptance criteria" |

Two ways to get there. The first is a `SellerVerdictCard` and a `SellerCaseFilePanel`, which duplicates the split arithmetic, the citation checklist, the unreadable-citation counting, the two independent failure surfaces, and the `<details>` disclosure behaviour — every one of which UI-05 argued into its current shape and none of which is about who is reading. Two copies of that would drift, and the direction they would drift in is the dangerous one: the seller's copy would fall behind, and the screen that is supposed to prove adjudication is even-handed would be the one showing the older ruling component.

The second is a prop that selects between two strings in four places. That is the whole of the difference, so that is the whole of the mechanism.

**Required rather than defaulted** because `perspective = 'buyer'` as a default is a component that silently addresses a seller as the buyer whenever someone forgets — a wrong-but-plausible screen, which is this codebase's stated definition of the failure worth spending code to prevent. Required makes the omission a compile error at five call sites, once.

`OutputPanel`, `ExecutionSteps`, and `TxHashLink` need no perspective: they describe the artefact, not the reader.

**Alternatives considered**: a React context carrying the perspective (invisible coupling for a value that travels two levels); passing pre-built copy strings down (moves the seller's wording into the page and leaves the components unable to be read on their own).

---

## R3 — ~~`OrderIdentity`: narrow two components' props so a sale can use them~~ **WITHDRAWN**

**Withdrawn 2026-08-09.** No `OrderIdentity` is extracted. `Order` is unchanged, `OrderSummaryHeader` is not edited at all, and `VerdictCard`'s only change is the perspective prop from R2.

**Why it existed**: `OrderSummaryHeader` and `VerdictCard` took `order: Order` while using only four of its fields — the id, the agent name, the price, and the state. The seller's dispute screen was going to hold a `Sale` rather than an `Order` ([R7](#r7--the-sellers-dispute-screen-reads-the-order-directly-rewritten), original version), so the prop had to be narrowed to something a sale could satisfy.

**Why it is gone**: api-design §3.4 now authorises `GET /orders/:id` for the buyer *or* the seller. The dispute screen therefore holds a real `Order`, which both components already accept, and the narrowing has nothing left to buy. Extracting a shared supertype so that two components could accept a type nobody now passes them would be ceremony that outlived its reason.

**What survives**: `Sale` remains its own interface ([R4](#r4--sale-is-the-minimum-these-screens-read-not-a-mirror-of-order)) — the sales *list* still reads `GET /sales`, and that is a different payload from an order. It simply no longer extends anything.

Worth keeping from the original entry, because it still holds: `OrderSummaryHeader` says "Order", "Price", and a state chip, and all three are true from either side. The seller genuinely is looking at an order — the one placed against their agent — so the buyer's vocabulary is not being borrowed, it is being shared correctly. `lib/orderState`'s `stateLabel` is likewise not forked: "one vocabulary, one place to change it" is that module's stated job, and a state that reads "Released" to a buyer means the same event to the seller who was paid by it.

---

## R4 — `Sale` is the minimum these screens read, not a mirror of `Order`

**Decision**:

```ts
export interface Sale {
  id: string;
  agentName: string;
  priceMinor: Cents;
  state: OrderState;
  createdAt: string;
  disputedAt: string | null;
}
```

Six fields, and — since R3's withdrawal — a standalone interface rather than an extension of anything.

**Rationale**: `GET /sales` is listed in api-design §3.4 beside `GET /orders` ("Mine, as buyer" / "Mine, as seller"), which strongly suggests one serialiser and one row shape selected by a different owner column. If that is what lands, this type is a subset of it and every field is present. If instead the seller's copy is trimmed, this type is still satisfied — because it asks only for what the sales list renders.

**This type is now the list's alone.** The dispute screen reads a full `Order` ([R7](#r7--the-sellers-dispute-screen-reads-the-order-directly-rewritten)), so `Sale` no longer has to carry everything a second screen needs — which is why it stays at six fields rather than growing toward `Order`.

`disputedAt` earns its place as a *fact* rather than a state test, following the reasoning already written into `ConcludedFace`: `disputedAt !== null` is true from the moment a complaint is filed and stays true through every state after it, so a state added later in the lifecycle cannot silently mislabel a row. It is what lets the list mark a sale as disputed without inferring it from `settled` (FR-005).

`settledAt`, `deliveredAt`, `acceptanceCriteria`, `run`, and `reviewWindowSeconds` are deliberately absent. A list row shows none of them, and the criteria and output arrive on the dispute screen in the case file, pinned to the version that ran (agent-definition §5).

**Alternatives considered**: `type Sale = Order` (see R3); adding `buyerAddress` (the seller has no use for it, and it is a small privacy leak nobody asked for).

---

## R5 — The dispute view is its own route: `/sell/sales/:id`

**Decision**: A new route `/sell/sales/:id` rendering `SellerSalePage`, added to `routePatterns` and `paths`, guarded by `RequireAuth`. Every sale row links to it.

**Rationale**: The user's decision on the spec's one open question, and the two rejected shapes are recorded as FR-029a and FR-029b. The reasons in short: the case file plus a verdict card is far taller than a list row, and two disputes open at once turns the sales list into a wall; and the buyer's order screen is the product's hero, judged on being one order's state machine for one party — a second party's face inside it is a conditional in the worst possible place.

**A mechanical argument this entry used to make has been withdrawn.** The original version held that `GET /orders/:id` was scoped to `orders.buyer_account_id` and would refuse a seller outright, so the buyer's screen *could not* serve the seller even if the product argument were set aside. api-design §3.4 now authorises that read for the buyer *or* the seller, so that is no longer true and the decision rests entirely on the two paragraphs above — which is where it should have rested anyway. It is the user's answer to the spec's one open question, and FR-029a and FR-029b record it.

What the amended doc does change is where the screen gets its data ([R7](#r7--the-sellers-dispute-screen-reads-the-order-directly-rewritten)): a separate route, still, but one that reads the order directly rather than assembling a substitute out of the sales list.

The path shape matters slightly. `AppRoutes` already carries a note that React Router v7 ranks static segments above dynamic ones, so `/sell/new` would beat a hypothetical `/sell/:id` regardless of declaration order. `/sell/sales/:id` does not rely on that ranking at all — it cannot collide with `/sell/new` under any ordering — which is one less thing that has to stay true when someone adds `/sell/settings` later.

**Alternatives considered**: `/sell/:id` (relies on route ranking, and reads as though a sale were an agent); `/orders/:id` with a branch (R5's second paragraph).

---

## R6 — The seller's home polls at 5s, which contradicts a table in `docs/ui-design.md` §5

**Decision**: `/sell` polls both of its lists every 5 seconds, matching the My Orders cadence. `docs/ui-design.md` §5's polling table assigns "Load only" to everything except Order Detail, Wallet, and My Orders; this feature departs from it, knowingly.

**Rationale**: Because this list is the entire notification mechanism. `docs/product-workflow.md` §7.5 is titled *"The seller is notified, but has no right of reply"*, and the notification half is the part that makes the no-appeal half read as a scope decision rather than a black box. There is no email in this product, no push, no bell in the header, no notification model of any kind. The only place a seller can learn that a complaint has been filed against them is a row in this list changing state.

A load-only list means the seller is notified *if they refresh*. That is not notification, and it would quietly make §7.5 false — the one paragraph the seller's half of this feature exists to implement.

The cost is two requests every five seconds while one supporting screen is open, and the screen is not on stage during any of the three acts. The benefit is that "notified" is a true statement about the product. Recorded in the plan's Complexity Tracking as a deviation from a root doc, so that whoever reconciles the two later finds the argument rather than an inconsistency.

**Alternatives considered**: load-only with a manual refresh button (a refresh button is a request for the user to do the polling); polling only the sales list (the agents list is where an availability change made in another tab shows up, and the asymmetry would be arbitrary).

---

## R7 — The seller's dispute screen reads the order directly **(rewritten)**

**Decision**: `SellerSalePage` calls the existing `useOrder(id)`. No new hook, no `useSale`, no selection out of a list. `useSales` remains, for the list page only.

**Rationale**: api-design §3.4 now authorises `GET /orders/:id` for the buyer *or* the seller, which makes the order the seller's own resource rather than a payload they have to reconstruct.

The original plan here was a `useSale(id)` that polled `['sales']` at 5s and picked out the matching row, because there is no `GET /sales/:id` and the list was assumed to be the seller's only route to an order. It worked, and every part of it was a workaround: a whole list re-fetched every five seconds to follow one row, a terminal predicate that had to reach *inside* a collection to ask whether one member had finished, and a "not found" that meant "the list came back and this id was not in it".

`useOrder` already does all of that properly, and does several things the substitute could not:

- **1s while live, stopped on terminal** — the cadence `docs/ui-design.md` §5 actually specifies for following an order, instead of 5s inherited from a list.
- **404 and 403 are fatal, not retried** — a mistyped id or somebody else's order becomes a dead end rather than a request every interval for as long as the tab is open.
- **The monotonic guard.** A page that has shown a verdict must never drop back to an earlier state, and the seller's screen wants that exactly as much as the buyer's — it is the screen where a ruling appears while somebody watches.
- **`stale` versus a hard failure**, so a blip leaves the ruling on screen with a quiet notice instead of blanking it.

Reusing it means the seller's screen inherits four behaviours UI-04 argued into shape, at the cost of one function call, and this feature adds no order-following logic of its own.

Two consequences worth naming. `useOrder` invalidates `['me']` once when the order reaches a terminal state — written for the buyer, whose balance moves at settlement, and correct for the seller too, whose settled funds rise at the same moment. And `notFound` now means what `OrderDetailPage` means by it, so the dead end and its wording carry over; only the link back changes, to `/sell`.

Deep-linking works for the ordinary reason: the id is in the URL and the hook fetches it.

**Alternatives considered**: keeping `useSale` (a list poll standing in for a resource read, now that the resource read is available); requesting `GET /sales/:id` (a new endpoint for one screen, and it was never needed); reading the row out of the router's location state (breaks on reload and on a pasted link, which is when someone is most likely to be looking).

---

## R8 — The availability toggle is not optimistic

**Decision**: The switch reflects the server's answer only. While the `PATCH` is in flight the control is disabled and shows a working state; on settle, `['agents', 'mine']` and `['agents']` are both invalidated and the refetched value is what renders.

**Rationale**: FR-027 requires that a failed change leave the control showing the agent's *true* availability, never the attempted one. An optimistic update satisfies that only by adding a rollback, and the rollback is where this gets subtle: the list is also polling every five seconds (R6), so a poll landing between the click and the `PATCH` response would repaint the old value underneath an optimistic switch and flip it back before the mutation resolved. The user would see the switch move, move back, and then move again. Every part of that is a lie about a state that never existed.

Without optimism the switch simply does not move until the answer arrives — under a second on a local API — and everything it shows was true when the server said it.

There is a second reason, which is that this toggle has an off-screen effect: the public marketplace. `['agents']` is invalidated alongside `['agents', 'mine']` precisely so that US4 scenario 3 — switch off, navigate to the marketplace, the agent is gone — does not depend on a cache entry that expired at the right moment.

**Alternatives considered**: optimistic with rollback (above); a confirm dialog before toggling (this is a reversible switch, and a confirm on a reversible action teaches people to dismiss confirms).

---

## R9 — `PATCH /agents/:id/active` is idempotent by construction, and the money doctrine does not extend to it

**Decision**: The availability toggle gets an in-flight guard and no retry button, but it is explicitly **not** governed by the non-idempotency rule written in `api/orders.ts` and `api/wallet.ts`. Silence resolves by the next poll.

**Rationale**: `api/orders.ts` warns in writing against copying its rule onto neighbouring calls without re-deriving it, and `api/wallet.ts` re-derived it once already. Re-deriving it again:

Those rules exist because `POST /orders`, `POST /topup`, `POST /offramp`, and `POST /withdraw` each commit a *movement* — a new row, a credit, a debit, a transfer — and answer afterwards, so a duplicate submission produces a duplicate movement. `PATCH /agents/:id/active` sets a boolean to an absolute value supplied by the client. Applying it twice leaves the world exactly as applying it once did. That is idempotence in the literal sense, not by good fortune.

So a silent failure here needs no ambiguous branch and no locked control: the list re-reads every five seconds, and whatever the server actually thinks is on screen within one cycle. The in-flight guard stays, for a different and smaller reason — two `PATCH`es racing to opposite values would land in an order nobody chose, and the on-chain `setAgentActive` behind them costs gas twice for one intent.

**Alternatives considered**: copying the wallet's silence copy (cargo cult, and it would tell the seller not to try again when trying again is completely safe); a retry button (harmless, but the poll already does it).

---

## R10 — `POST /agents` *is* one of the non-idempotent ones

**Decision**: The create form guards submission with a ref written synchronously, offers no retry on a connectivity failure, and on that branch tells the seller to check their agents list before submitting again. A refusal — any 4xx — keeps every entered value and invites a corrected resubmission.

**Rationale**: api-design §3.3 describes `POST /agents` as "Creates agent + version 1, hashes the definition, calls `registerAgent`" — a Postgres insert pair *and* an on-chain write, answered afterwards. A client timeout at 10 seconds therefore says nothing about whether an agent exists, and a chain write is exactly the kind of thing that takes longer than 10 seconds on a bad day. Retrying produces two listings and two on-chain registrations for one intent.

This is the `POST /orders` shape, so it inherits the `POST /orders` treatment — including the destination: on this branch the seller is pointed at `/sell`, which is where the answer is, and which is where a *successful* submission would have sent them anyway.

The guard is a `useRef` rather than `isPending` or the `disabled` attribute, for the reason `OrderActions` measured and `WalletActions` restated: both of those come from state, state does not change until React re-renders, and several activations dispatched inside one frame all read the same stale `false`.

**Alternatives considered**: an idempotency key (would delete this whole branch — noted as a handoff assumption, not something this feature can build alone); a retry button on timeout (how a marketplace gets two identical listings).

---

## R11 — Draft validation lives in a new `lib/agentDraft.ts`, not in `lib/inputSchema.ts`

**Decision**: A new pure module owning the create form's rules: term-list cleaning, schema-text parsing, and assembly of the request body. `lib/inputSchema.ts` is not touched.

**Rationale**: `lib/inputSchema.ts` reads a seller's schema and builds a *buyer's* form from it. This module writes a seller's schema. They point in opposite directions, and the one function that looks reusable — `parseRawInput` — is wrong here in both its shape check and its wording: it exists for a buyer's input document and says "Enter this agent's input as JSON." A seller pasting an output schema would be told to enter an input.

The module earns its place on the same grounds `lib/ledger.ts`, `lib/verdict.ts`, and `lib/orderState.ts` earned theirs: pure data transformation, no React, no fetch, and rules that two callers must not disagree about. It is also the part of this feature that is fully testable by hand with no backend at all, which is what makes quickstart Part A possible.

**Alternatives considered**: generalising `parseRawInput` with a subject parameter (couples the buyer's purchase form to the seller's authoring form so that changing one has to be checked against the other); inline validation in the page component (two schema fields with two copies of the same rule, which is how they end up disagreeing).

---

## R12 — Schema fields are checked for well-formedness and object-ness, and nothing else

**Decision**: `parseSchemaText` accepts any text that parses as JSON **and** is a plain object. It does not check for `type`, `properties`, `$schema`, or anything else a JSON Schema might have. FR-016 and FR-017 are both satisfied by exactly this.

**Rationale**: The object-ness check is not schema validation creeping in — it is the same fact `JsonSchema`'s own type comment already records: this app's schema reader consults keywords on an object, and an array or a bare string at the top level has nowhere for any of them to live. A seller who pastes `[1,2,3]` has made a mistake this form can name precisely, before it becomes an agent whose buy form renders as an unexplained raw-JSON fallback.

Beyond that, nothing — and this is now confirmed rather than assumed: `api/docs/specs/API-06-catalogue.md` scopes *"validation that `input_schema` and `output_schema` are valid JSON Schema"* as backend work. So there **is** a real validator upstream, which turns the argument below from a guess into an observation. The backend is the party that knows what a valid contract is, `agent_versions.input_schema` is unvalidated `jsonb` at the column level on purpose, and a client-side validator would be a second opinion that eventually disagrees with the real one — refusing a listing the platform would have accepted, with no way to override it mid-demo. That is the same argument `BuyPanel` makes about affordability, pointed at schemas.

**Alternatives considered**: a full JSON Schema validator (ajv — a dependency, plus a policy this app has no standing to enforce); no check at all beyond parsing (accepts `[]` and `"hello"`, which pass the buyer's form straight into its raw fallback with no explanation).

---

## R13 — Capabilities and exclusions are a repeatable term field, and the note lives on the field

**Decision**: One `TermListField` component used twice — an ordered list of single-line terms, each individually removable, with an add control. Empty and whitespace-only terms are dropped at assembly. Each instance carries its own hint text, rendered adjacent to the control and always visible.

**Rationale**: FR-012 rules out a textarea, and the reason is not ergonomics: `capabilities` and `exclusions` are `text[]` columns, and a verdict cites one clause. A textarea would have to guess where one clause ends and the next begins, which is a guess this form has no business making about a document Guardian will quote verbatim.

The hint is on the field rather than in a page-level intro because FR-013 requires it to be read *before* the seller types, and a lede at the top of a nine-field form is read once and scrolled past. This is the cheapest lever the whole product has on the quality of its own evidence (spec Overview), and its entire cost is a sentence in the right place:

- **Capabilities** — "Each line is a promise Guardian will quote back at you. 'Extracts every line item with its amount' can be checked; 'high quality results' cannot, and a vague capability is how a seller loses a dispute they should have won."
- **Exclusions** — "Each line is a case you are not taking on. 'Does not handle handwritten receipts' is what turns a fuzzy argument into a clause Guardian can cite in your favour. This is the half sellers skip and then regret."

Empty terms are dropped rather than refused (FR-014) because an empty row is a UI artefact of an add button, not something a seller meant to say — and an empty string in a citation is worse than no clause at all.

**Alternatives considered**: a comma-separated single input (commas appear inside clauses); a textarea split on newlines (the guess above, and it silently merges a wrapped clause).

---

## R14 — `parseUsd` gains a ceiling message, so a price is not refused with a sentence about the treasury

**Decision**: `parseUsd(input, options?: { ceilingMessage?: string })`. The default is unchanged in every respect. The create form passes a price-worded ceiling message.

**Rationale**: The price field should reuse `parseUsd` and `AmountField` — FR-018 says so, and the alternative is a second definition of what a dollar amount looks like, which is the exact failure `AmountField`'s own comment says it exists to prevent. Almost every rule transfers cleanly: integer cents with no float anywhere, at most two decimal places, greater than zero (which is FR-018's zero refusal, already written), separators and symbols stripped.

One does not. Above `TREASURY_CEILING_CENTS` the parser says *"That is more than this demo's treasury holds"*, which is true of a top-up and meaningless about a listing price — the treasury does not pay for listings. A seller typing `50000` where they meant `500.00` would be corrected with a sentence about someone else's wallet.

The smallest honest fix is to let the caller supply that one message. The *number* stays shared deliberately: both ceilings are guarding against the same thing, a slipped decimal point at the same order of magnitude, and inventing a second constant would imply a pricing policy this product does not have. The form's wording: **"Enter a price under $10,000 — anything higher is almost certainly a slipped decimal."**

**Alternatives considered**: accepting the wrong message (small, and exactly the kind of small wrongness that is noticed on stage); a separate `parsePrice` (a second parser, which is what `AmountField` argues against); a `ceilingCents` option too (unused — YAGNI, and it invites a pricing policy).

---

## R15 — The model field is a datalist: free text with the two documented ids one click away

**Decision**: `<input list="agent-models">` backed by a `<datalist>` offering `claude-haiku-4-5` and `claude-sonnet-5`, pre-filled with `claude-haiku-4-5`.

**Rationale**: The spec assumed free text, on the grounds that no model allowlist is exposed to this application. That still holds — `agent_versions.model` is a `text` column, and the backend is the party that knows what it can run. But `docs/tech-stack.md` §2.2 does name exactly two, with a reason for each: `claude-haiku-4-5` for seller agents (approved in §8), and `claude-sonnet-5` as the alternative "if a seller needs more quality".

A `<select>` of those two would hard-code a list that can drift from the backend and would make an unlisted model impossible to enter. A bare text input makes a first-time seller guess a model id, which they will get wrong, producing an agent that fails at execution time — during a demo, in someone else's module.

A datalist is both: the value is free text and the field is a text input, so nothing is restricted and the backend stays the authority; the two documented ids are one click away; and the default means the common path requires no decision at all. One element, no dependency, no drift risk.

**Alternatives considered**: `<select>` (drift, and no escape hatch); free text with placeholder only (a placeholder disappears the moment someone types, which is when they need it); fetching an allowlist (an endpoint that does not exist and that nothing else needs).

---

## R16 — The fourth list endpoint is the one that gets the shared unwrap

**Decision**: Extract `unwrapList<T>(payload, keys)` into a new `lib/listEnvelope.ts`. `fetchAgents`, `fetchLedger`, `fetchOwnedAgents`, and `fetchSales` all call it with their own key list. `client.ts` is not touched.

**Rationale**: There are two identical private copies today — `agents.ts` and `wallet.ts` — and this feature adds two more call sites. Both existing copies carry the same argument for why the tolerance is justified (an envelope misread as an array renders as a plausible, silent, empty success on a screen whose job is to say what exists) and the same warning: *"Still not generalised into `client.ts`, for the reason given there: it should not be reachable by accident from a future endpoint."*

That warning is about `client.ts` specifically, and it survives this extraction intact. A named function in `lib/` that each fetcher explicitly imports and calls with its own envelope keys is not accidental reachability — it is an opt-in, one line long, at four sites that each still decide for themselves that they want it. What it removes is four copies of a subtle branch drifting apart.

Four is also the right moment. Two copies is a coincidence with a written rationale; four is a pattern, and the third and fourth arriving in a single feature is the signal.

The keys stay per-caller (`['agents','items','data']`, `['entries','items','data']`, `['sales','items','data']`) rather than being unioned into one list, because a shared union would mean `GET /sales` silently accepting an `agents` envelope — tolerance quietly widening into wrongness.

**Alternatives considered**: a third and fourth copy (the smell, and the drift); moving it into `client.ts` (explicitly argued against, twice, in the code).

---

## R17 — Nothing in this feature can render a system prompt, structurally

**Decision**: FR-037 is met by the *absence of a field to put one in*, at four places, rather than by a filter anywhere.

**Rationale**: This is the guarantee `ui/docs/CONTEXT.md` §2 states unconditionally — "the UI shouldn't have a code path that would render one" — and the checklist note on the spec records that it wins even over the seller's own case file, where the content is the seller's. The mechanism is the same one UI-05 built:

1. `normaliseCaseFile` copies named fields onto `CaseFile` and `CaseFileStep`. Neither type has a field a prompt could land in, so a serialiser regression upstream produces a missing sentence, not a leak. Unchanged by this feature.
2. `OwnedAgent` extends `AgentSummary` (`id`, `name`, `description`, `priceMinor`) plus `active`. No `systemPrompt`, no `model`, no `timeoutSeconds`. The seller's list has nowhere to render one even if `GET /agents?owner=me` sends the whole version row.
3. The create form is **write-only** with respect to the execution spec: the prompt and model travel outward in `CreateAgentRequest` and no response is read back. `createAgent` follows `acceptOrder`'s precedent and discards its response entirely, so the created agent's execution spec never enters the app's memory at all.
4. This feature adds no route that reads `GET /agents/:id/versions`, the one endpoint documented as returning execution specs.

Quickstart Part F turns each of those into a grep.

**Alternatives considered**: a redaction pass in the API layer (theatre — this app cannot tell a summarised sentence from a leaked one, and it would hide an upstream serialiser failure).

---

## R18 — "No reply" is an absence, and absences need a check that fails loudly

**Decision**: FR-032 is enforced by there being no such control, and verified by a grep over the feature's files for `reply|appeal|respond|contest|comment` outside the sentence that explains their absence. FR-033's sentence sits directly beneath the verdict.

**Rationale**: A requirement satisfied by nothing being there is the kind that regresses silently — somebody adds a helpful "Contact the buyer" button in six weeks and no test fails, because there are no tests (and would not be one for this even if there were). A grep in the acceptance run is a check that can actually fail.

The wording of the sentence is the other half, and it is the difference between a scope decision and a missing feature: **"You are notified of this outcome, and Guardian's reasoning is above in full. Verdicts are final — there is no appeal, and no reply is collected from either side."** It names what the seller *does* get, states the rule, and makes the symmetry explicit — neither side replies — so the screen does not read as the seller being the party who was shut out.

Placement is beneath the verdict rather than at the top of the page: read before the ruling it is a disclaimer, read after it is an explanation.

**Alternatives considered**: a disabled reply control with a tooltip (FR-032 forbids it, and correctly — a disabled button is a promise that this will exist one day); saying nothing (the screen then looks like a form that was never built, which is exactly the failure the spec's Overview describes).

---

## Sources

- `ui/docs/specs/UI-07-seller-pages.md` — the brief
- `ui/docs/CONTEXT.md` — §2 the three things the frontend does not do; §4 conventions; the no-tests decision
- `docs/ui-design.md` — §3 Flow B (the sell flow and the contract-terms instruction); §4 the page→endpoint map; §5 the polling table this feature departs from (R6)
- `docs/agent-definition.md` — §2 the three-part definition; §4 who sees the prompt; §5 an order pins the version that ran
- `docs/product-workflow.md` — §7.1 capabilities and exclusions; §7.5 notified but no right of reply; §7.6 verdicts visible to both parties
- `docs/api-design.md` — §3.3 the catalogue routes; §3.4 `GET /sales` and the case-file redaction note; §7 ownership checked per resource
- `docs/database-schema.md`, `api/src/entities/*.entity.ts` — the column names R1 reads the payload off
- `docs/tech-stack.md` — §2.2 the two seller-agent models (R15)
- `ui/src/` — `usePolling`, `useVerdict`, `useCaseFile`, `useAccountSummary`, `VerdictCard`, `CitationChecklist`, `CaseFilePanel`, `OrderSummaryHeader`, `AmountField`, `BuyPanel`, `WalletActions`, `api/orders.ts`, `api/wallet.ts`, `api/agents.ts`, `lib/money.ts`, `lib/orderState.ts`, `lib/inputSchema.ts`
- `specs/005-verdict-card/`, `specs/006-wallet-page/` — the two features this one reuses most
