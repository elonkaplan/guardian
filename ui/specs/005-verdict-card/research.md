# Phase 0 — Research: Verdict card & case file

**Feature**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md)

Fifteen decisions. The ones that change what gets built are R3 (the split comes from the settled amount, never from the tier), R5 (citations are normalised defensively — a deliberate exception to this app's no-shape-tolerance rule), R6 (the verdict poll stops when the transaction lands, and the case file is read exactly once), and R13 (`VerdictSlot` is deleted rather than grown).

No NEEDS CLARIFICATION markers were carried in from the spec. The four assumptions it resolved by informed guess are re-examined here against the code and the API's schema, and all four survive.

---

## R1 — Neither endpoint exists yet, and we build against them anyway

**Decision**: Build the whole feature against `GET /orders/:id/verdict` and `GET /orders/:id/case-file` as documented in `docs/api-design.md` §3.4, with the assumed payloads written down in [contracts/internal-api.md §7](./contracts/internal-api.md) as a diff list.

**Rationale**: Same position as UI-04 (its R1), and for the same reason: `api/specs/` holds 001–003, the orders module is unbuilt, and waiting serialises two people who could work in parallel. The blast radius is bounded by construction — every field name in this feature enters through two functions in `src/api/verdicts.ts`, and the components downstream read a normalised type that the boundary produces. If the API lands `refund_minor` instead of `refundMinor`, or nests the citations one level deeper, the change is in one file.

What is different from UI-04 is that this feature's payload is not just unbuilt but *partly unspecified*: `verdicts.citations` is `jsonb NOT NULL DEFAULT '[]'` in the schema (`docs/database-schema.md` §5, `api/specs/002-entities-migrations/contracts/schema.sql`) and typed `unknown[]` in the API's own data model. There is no agreed inner shape anywhere in the documents. R5 is the response to that.

**Alternatives considered**: Wait for API-05. Rejected on schedule. Mock the endpoints behind a flag — rejected because a mock that is not exercised against the real thing is a second contract to maintain, and the quickstart's Part A already covers the offline case with hand-crafted responses in the network panel.

---

## R2 — What `GET /orders/:id/verdict` is assumed to return

**Decision**: Assume the buyer-facing verdict payload is the `verdicts` row minus the parts that are not the buyer's business:

```json
{
  "tier": "half",
  "refundMinor": 100,
  "reasoning": "The listing promises every line item with its amount…",
  "citations": [
    { "source": "capability", "clause": "extracts every line item with its amount", "met": false }
  ],
  "txHash": "0x7f3a…c21",
  "createdAt": "2026-08-08T12:04:31.000Z"
}
```

Mapped from the schema: `tier` → `verdict_tier`, `refundMinor` → `refund_minor`, `txHash` → `onchain_tx_hash` (nullable), `citations` → the `jsonb` column.

**Rationale**: camelCase, because that is how `POST /orders` is spelled in `docs/api-design.md` §3.4 and how every type in `src/api/types.ts` already reads. Minor units, because money is integer USD cents everywhere in this app (`src/lib/money.ts`) and `refund_minor` is a `bigint` of cents on the API side.

**Three columns are deliberately not in the type**: `verdict_hash`, `model`, and `id`. The hash is anchored on-chain for the API's benefit and means nothing to a buyer who cannot recompute it; `model` is an internal reproducibility record; the id is never used as a key because there is exactly one verdict per order. Following the precedent set by `AgentListing` and `Order` — the absent property is the guarantee — none of them gets a field, so no component can drift into rendering "adjudicated by claude-opus-5", which would be the single fastest way to turn a checklist back into "the AI decided."

**Alternatives considered**: Fold the verdict into `GET /orders/:id` so the existing 1s poll carries it. Rejected in R6.

---

## R3 — The split is derived from the settled amount, never from the tier

**Decision**: `buyerMinor = verdict.refundMinor`, taken verbatim from the payload. `sellerMinor = order.priceMinor − verdict.refundMinor`, one integer subtraction. The tier is never used to compute either figure.

**Rationale**: This is FR-004, and it is the one arithmetic decision in the feature that can be wrong in a way an audience notices. `refund_minor` is what the API computed, what it hashed into `verdict_hash`, and what the escrow contract's `resolve()` actually moved. A percentage recomputed on the client is a second, independent calculation of the same quantity, and two independent calculations of a rounded quantity disagree eventually — on an odd-cent price, `quarter` of 199 is 49.75, and whichever way this screen rounds it there is a version of the demo where the card says $0.50 and the explorer says $0.49. The number that settled is the number that is true.

The subtraction is safe: both operands are integer cents, so there is no floating-point arithmetic here, only the one operation `src/lib/money.ts` says this app is allowed to do — and strictly speaking `money.ts` says it formats and does not add, which is why the subtraction lives in `src/lib/verdict.ts` with this paragraph attached rather than being inlined in a component.

**The reconciliation guard**: if `refundMinor` is not a finite integer, is negative, or exceeds `priceMinor`, the card shows the refund as recorded and renders the seller's figure as `—` with a one-line note that the figures do not reconcile. It never prints negative money and never silently clamps. Clamping would be the worst option available: it produces two plausible numbers that sum to the price and quietly contradict the chain, which is precisely the failure this whole feature is built to make impossible.

**Alternatives considered**: Ask the API for both figures. Better, and it is written into the handoff list as a *should* — if `sellerMinor` arrives, the subtraction and its guard become dead code and get deleted. Not blocking, because the subtraction is derivable today and a missing field would otherwise block the card entirely.

---

## R4 — The tier is a label with a percentage, and the percentage is presentational only

**Decision**: A pure, exhaustively switched module maps the five enum values to a percentage and a phrase:

| `tier` | Badge | Phrase |
| --- | --- | --- |
| `none` | 0% | No refund |
| `quarter` | 25% | Quarter refund |
| `half` | 50% | Half refund |
| `three_quarter` | 75% | Three-quarter refund |
| `full` | 100% | Full refund |

The switch falls through to `assertNever`, exactly as `faceFor` does, so a sixth tier added upstream is a compile error in one file rather than a card with a blank badge.

**Rationale**: `docs/specs/UI-05-verdict-card.md` asks for a badge reading 0/25/50/75/100 and the backend enum is a word; something has to translate, and doing it in a component would mean the badge and any future orders-list chip inventing the mapping twice. The phrase exists because "50%" alone does not say *of what, to whom* — it sits beside two labelled money figures that answer both, and FR-002 wants a proportion a person reads without conversion.

The percentage is a display string. It is never multiplied by anything (R3).

**Alternatives considered**: Show only the money. Rejected: the tier is the shape of the ruling, and a demo audience remembers "50%" in a way it does not remember "$1.00 / $1.00". Show only the tier — rejected by FR-003, which exists because a proportion with no amounts is not a settlement.

---

## R5 — Citations are normalised at the boundary, tolerantly, and this is a deliberate exception

**Decision**: `GET /orders/:id/verdict` is expected to send citations as objects with `source` (`capability` · `exclusion` · `criterion`), `clause` (the verbatim quote), and `met` (boolean). The boundary normalises whatever actually arrives into a discriminated shape that always renders:

| Arrived | Rendered |
| --- | --- |
| All three fields, known `source` | A normal row: origin label, quote, ✓/✗ |
| Unknown `source` string | The row, labelled with the raw string |
| `source` missing entirely | The row, labelled "Clause" |
| `clause` missing or empty | The row, marked "Quote unavailable" |
| `met` missing or not a boolean | The row, marked "Not recorded" — **never** ✓ |
| The element is not an object | Dropped, and counted in a "N citations could not be read" line |
| `citations` is not an array | Treated as no citations (FR-012's copy) |

**Rationale**: This app has a standing rule against shape tolerance — `fetchOrder` in `src/api/orders.ts` has no fallbacks, and the comment there argues that a tolerant read turns a contract break into a plausible silent wrong answer. That rule is right there and wrong here, for two reasons specific to this payload.

First, the column is `jsonb` with no schema behind it and the API's own data model types it `unknown[]`. Postgres will accept any JSON document in it. There is no upstream validation to be trusted, so tolerance is not a fallback for a broken contract — it is the contract.

Second, the failure modes are not comparable. A missing agent list renders as "no agents listed" and is silently, plausibly wrong. A ragged citation rendered as an incomplete row is *loudly* wrong: it is visible, it says what is missing, and nothing about it can be mistaken for a clean ruling. And the alternative — dropping a citation whose `met` field is absent — deletes evidence from the one screen whose entire purpose is showing the evidence. Between an ugly row and a missing row, the ugly row is the honest one.

The one asymmetry that matters: **a citation with no recorded `met` is never rendered as met** (FR-013). Guessing in that direction manufactures a passed clause, which is a fabricated fact about a seller's contract.

**Alternatives considered**: Validate strictly and show an error when the shape is wrong. Rejected — it means a single malformed row blanks the checklist, converting a cosmetic upstream defect into a total loss of the feature's argument mid-demo. A schema validation library (zod) — rejected under the no-new-dependencies rule (R14); the normaliser is about forty lines of `typeof` checks.

---

## R6 — The verdict polls until the transaction lands; the case file is read exactly once

**Decision**: Two separate reads, both through the existing `usePolling`, neither folded into the order poll.

**The verdict** — key `['verdict', id]`, interval 1s, enabled only when `order.state` is `adjudicated` or `settled`:

```ts
isTerminal: (v) => v.txHash !== null || orderState === 'settled'
isFatalError: (e) => e.kind === 'http' && (e.status === 404 || e.status === 403)
```

**The case file** — key `['case-file', id]`, enabled once the order has a dispute on it, with `isTerminal: () => true` and `isFatalError: () => true`. Both predicates constant, which is the idiomatic way to say "one attempt, then stop" through this hook: the first success stops the schedule, the first failure stops it too, and the panel's retry button calls `refetch` explicitly.

**Rationale for not folding either into `GET /orders/:id`**: that read runs once a second for the whole life of an order and is the page's hot path. Attaching a case file — which carries the input, the output, the listing text, and every execution step — to a 1s poll means shipping kilobytes sixty times a minute to render something the buyer looks at once. The verdict is smaller but has the same problem in reverse: it does not exist for most of the order's life, so it would be `null` on almost every poll.

**Rationale for the verdict's stopping rule**: between `adjudicated` and `settled` the ruling exists but `onchain_tx_hash` is still null, and FR-031 wants the link to appear on its own. Polling the verdict at 1s during that window is the mechanism. `txHash !== null` stops it the moment the link is real. The `|| settled` half of the predicate closes the case the spec's edge-case list calls out — settlement recorded but no transaction reference stored — which would otherwise poll a permanently-null field forever, the exact behaviour FR-033 and UI-04's SC-005 exist to prevent.

**Rationale for one cache key, not one per state**: keying the query `['verdict', id, state]` would refetch cleanly on the `adjudicated → settled` transition, but it also mints a new cache entry, so `data` is briefly `undefined` and the card unmounts and rebuilds — visible flicker on the demo's closing beat, and a direct violation of FR-031's "does not visibly rebuild". One key, polled to a stopping condition, updates in place.

**Alternatives considered**: A single combined `GET /orders/:id/dispute`. Cleaner in principle, but it is not what `docs/api-design.md` §3.4 documents, and asking the API to merge two documented routes to save this screen one request is a poor trade against a route list that is already agreed.

---

## R7 — The case file is available from the moment a dispute exists

**Decision**: Render the case-file panel whenever `order.disputedAt !== null`, which covers `disputed`, `adjudicated`, and `settled`. Never for an order that was released uncontested.

**Rationale**: `docs/ui-design.md` §2.1 lists "the case file it's reading" as the content of the `disputed` state, and UI-04's arbitration face already tells the buyer that Guardian is "weighing the seller's stated capabilities and exclusions against your acceptance criteria" — while showing none of it. That comment in `OrderDetailPage.tsx` explicitly defers the evidence to this feature. Showing it only after the ruling would leave the arbitration face exactly as vague as it is today, during the one stretch of the demo where there is nothing else on screen to look at.

The trigger is `disputedAt` rather than a state test because it is a fact about the order rather than a position in the lifecycle, and it stays true through every later state. A state list would need editing if a state were ever inserted between `disputed` and `settled`.

**Alternatives considered**: Show it only on the concluded face. Rejected above. Show it always, for every order — rejected by FR-025: there is no case file for an undisputed order, and the endpoint would 404.

---

## R8 — Execution steps are new to the client, and this does not reverse UI-04's decision

**Decision**: `CaseFileStep` carries what the agent did, its timing, and any error — and carries no field capable of holding a prompt or raw model reasoning. `OrderRun` in `src/api/types.ts` keeps having no `steps` property, unchanged.

**Rationale**: This needs saying explicitly, because the diff looks like a regression. `OrderRun`'s comment argues that steps are a documented redaction hazard and that omitting the property is the guarantee. This feature adds steps — but from a different endpoint, onto a different type, and that difference is the whole of the safety argument.

`GET /orders/:id` is a general order read. `GET /orders/:id/case-file` is the route `docs/api-design.md` §3.4 marks **"Redacted for a buyer, full for the seller"** — the one route in the system whose contract is explicitly about this. §1.3 and `docs/ui-design.md` §7.1 go further: the serialiser does not merely strip `system_prompt`, it *summarises reasoning text*, because a step can paraphrase its own instructions. So the buyer's step carries a summary the API produced, and the type has a `summary` field and no `reasoning` field, no `prompt` field, no `raw` field.

FR-027 is the other half: this screen performs no redaction of its own. It cannot — it has no way to tell a summarised sentence from a leaked one, and a client-side filter would be security theatre that also makes the upstream serialiser's failure invisible. What it does instead is refuse to have anywhere to put one. If the API regresses and starts sending `systemPrompt` on the case file, this type drops it on the floor at the boundary and no component can reach it.

**Alternatives considered**: Skip steps entirely and show only input, criteria, and listing text. Tempting for safety, but `docs/ui-design.md` §7 decided "yes, show steps" on the merits — *"the agent made one extraction pass and stopped"* is the sentence that makes a 50% ruling legible — and the redaction consequence was accepted there with a stated mitigation. Re-deciding it here would be relitigating a settled question with less information.

---

## R9 — The transaction hash is validated before it becomes a link

**Decision**: Render a link only when the value matches `/^0x[0-9a-fA-F]{64}$/`. Otherwise show the value as plain text with a note that it is not a recognisable transaction reference. The URL comes from `explorerTxUrl` in `src/chain/chains.ts` and from nowhere else.

**Rationale**: FR-018 forbids "a link with nothing behind it", and a malformed hash produces exactly that — a link that looks authoritative, is clicked on stage by someone who wants to check the claim, and lands on an explorer 404. Given that the transaction hash is the one item on this page whose entire job is being independently verifiable, a link that fails when a sceptic follows it is worse than no link.

`explorerTxUrl` already exists and its module comment names this feature: *"UI-05 renders transaction hashes as links; a hardcoded explorer URL anywhere else in src/ is precisely the drift this module exists to prevent."* That is FR-019, already satisfied by a module written for it, and the boundary sweep greps for the drift.

Display: middle-truncated (`0x7f3a…9c21`) with the full value in `title`, in the `href`, and behind a copy control (FR-016). The link carries `target="_blank" rel="noopener noreferrer"` and a visible external-destination marker (FR-017) — the order screen must not navigate away mid-demo.

**Alternatives considered**: Trust the string and link it unconditionally. One line cheaper, and it fails in the worst possible place. Link to an address explorer as a fallback — meaningless for a hash.

---

## R10 — ✓/✗ carries a word and a shape, not a colour

**Decision**: Every citation row renders a glyph (✓ / ✗), a text status ("Met" / "Not met" / "Not recorded"), and a border treatment. Colour is added on top of all three, never as the carrier.

**Rationale**: FR-010 and SC-006. Three of this feature's viewing conditions are hostile to colour and all three are the *normal* case rather than an edge: a projector with crushed contrast, a screenshot pasted into a deck, and a judge who is colour-blind. The checklist is the feature's whole argument, and an argument that only works on a good monitor is not one.

Unmet rows get the heavier treatment (FR-011) because they are the rows the ruling turns on — a 50% verdict is explained by the two clauses that failed, not by the one that passed.

**Alternatives considered**: Colour plus icon, no text. Passes greyscale but not a squint from the back of a room, and "Not recorded" (R5) has no glyph that means it.

---

## R11 — The case file is a native `<details>`, open on arbitration and closed on the concluded face

**Decision**: `<details>`/`<summary>`, with `open` defaulted by context: open while the order is under arbitration, closed once there is a verdict card above it.

**Rationale**: FR-024 says the case file must not displace the ruling. On the concluded face the card is the answer and the case file is the working, so it starts collapsed and one click away. On the arbitration face there is no card yet and the panel is the only thing to read, so it starts open.

`<details>` rather than a state-managed accordion for the same reason UI-04 used a native `<dialog>` (its R16): keyboard behaviour, focus, and the open/closed semantics are the platform's, correct by default, and cost no state. This feature adds no `useState` for disclosure anywhere.

**Alternatives considered**: A separate route or a modal. Both take the buyer away from the record they are reading the case file *about*, and the modal loses the side-by-side comparison the page already establishes.

---

## R12 — The two panels fail independently, and neither can blank

**Decision**: Verdict and case file are separate queries with separate error surfaces. A failed verdict read renders a message and a retry *inside the concluded region*; a failed case-file read renders a message and a retry inside the `<details>` body. Neither prevents the other from rendering (FR-035).

**Rationale**: The page below them is already a complete record — the order header, the input, the output, the criteria all come from the order poll and are unaffected. Letting one panel's failure escalate would replace a legible order with an error message, which UI-04 already argued against in its stale-vs-fatal split (`useOrder` returns `stale` for exactly this reason).

The concluded region must never be blank. That constraint is inherited from `VerdictSlot`'s FR-007 and is the one thing surviving that component's deletion: a settled order whose verdict read fails still shows a labelled region saying the ruling could not be loaded, with a retry.

---

## R13 — `VerdictSlot` is deleted, not grown

**Decision**: Delete `src/components/VerdictSlot.tsx`. `VerdictCard` is a new component with a different contract — it takes the order and the verdict, not just a state — and both call sites in `OrderDetailPage.tsx` are rewritten.

**Rationale**: `VerdictSlot` is a placeholder whose own comment describes it as a scope boundary: *"it renders a heading and one line about where the order stands, and deliberately renders no verdict content at all."* Its two branches exist to say *the verdict is not displayed here yet*. Keeping it and adding content would leave a component whose documentation contradicts its behaviour, and whose prop (`state`) is not enough to render a card. Deleting it makes the diff say what happened.

Its two states survive as content rather than as copy: `adjudicated` is now a real card with a settlement-pending note where the transaction goes, and `settled` is the complete card. The CSS block under `.verdict-slot` is replaced in the same edit.

**Alternatives considered**: Keep it as a thin wrapper that chooses between loading, error, and card. That is a reasonable component — but it is `VerdictCard`'s own top of file, not a separate file, and a second component in the chain would just be a place for the "never blank" rule to fall between two stools.

---

## R14 — No new dependencies, no new configuration, no new shared machinery

**Decision**: Nothing added to `package.json`, `.env.example`, or `vite.config.ts`. No changes to `usePolling`, `queryClient`, `client.ts`, or `errors.ts`.

**Rationale**: Worth recording as a contrast with UI-04, which needed one additive option on `usePolling` and three lines in `client.ts`. This feature needs neither: `usePolling`'s `isTerminal` and `isFatalError` predicates — added last feature for the order poll — turn out to express both of this feature's cadences exactly (R6), including the read-once case. That is the second caller justifying the first caller's design, which is the only real test an abstraction gets.

wagmi and viem stay out of the runtime path, as in UI-04. viem contributes one type import (`Hex`) and the chain definition that `explorerTxUrl` already wraps; no hook, no client, no chain call (FR-029).

---

## R15 — Do not fetch the listing to show what was promised

**Decision**: The listing's capabilities and exclusions come from the case-file payload. This feature never calls `GET /agents/:id`.

**Rationale**: An order pins the agent version that ran (`docs/agent-definition.md` §5), and the listing may have been edited since — a seller who lost a dispute has every reason to edit the capability that was cited against them. Reading today's listing to explain a ruling made against last week's would break FR-023's traceability in the one direction that matters, quietly, and would look like the product covering for the seller.

The case file is the record of what Guardian was actually given. It is the only correct source for those clauses, which is also why the citation quotes and the case-file text can be expected to match verbatim.

**Alternatives considered**: Fetch the listing as a fallback when the case file omits them. Rejected — a fallback to the wrong document is worse than an empty section that says the listing text is unavailable.
