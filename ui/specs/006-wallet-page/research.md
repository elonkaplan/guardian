# Phase 0 — Research: Wallet page

**Feature**: `006-wallet-page` · **Date**: 2026-08-09 · **Spec**: [spec.md](./spec.md)

Sixteen decisions. The ones worth arguing about are **R4** (the page does its own polling — or rather, deliberately does not), **R6** (a money input has to parse without touching a float), **R8** (three POSTs that move money, three different silences), **R10** (this feature deliberately breaks a rule the last feature wrote down), and **R12** (the statement does not audit itself).

---

## R1 — Five endpoints, none of which exist yet

**Decision**: Build against the documented contract, record every field-name assumption in [contracts/internal-api.md §7](./contracts/internal-api.md), and confine the blast radius of a wrong guess to two files (`api/types.ts`, `api/wallet.ts`).

**Rationale**: `api/src/` currently exposes exactly two controllers — `auth` and `health` (`grep -rn "@Controller(" api/src/`). `GET /me`, `GET /me/ledger`, `POST /topup`, `POST /withdraw` and `POST /offramp` are all documented in api-design §3.2 and all unbuilt. This is the same position UI-05 planned from and it worked; the alternative is blocking the frontend on a backend module nobody has scheduled.

Two things make this materially safer than it was for UI-05, and both are worth knowing before anyone estimates the API side:

- **The hard parts already exist.** `BalanceRepository.getAvailableBalanceMinor()` returns the signed `SUM` in cents. `EscrowReadService.balanceOfCents(address)` returns a withdrawable balance in cents. `LedgerEntry` is a mapped entity with `amountMinor`, `kind`, `orderId`, `externalRef`, `createdAt`. The API work for `GET /me` and `GET /me/ledger` is a controller over three existing readers, not a new subsystem.
- **The money-moving endpoints are the real work**, because `/topup`, `/withdraw` and `/offramp` need the operator signer and a funder wallet, and only `/withdraw` has an obvious existing home (`EscrowOperatorService`).

**Alternatives considered**: waiting for the API (the frontend is the demo, and it is the thing with eight screens to build); mocking with MSW (a test dependency in a repo that has deliberately no tests).

---

## R2 — `settledFundsMinor` is `Cents | null`, and `null` means *unknown*, never *zero*

**Decision**: `AccountSummary.settledFundsMinor: Cents | null`. `null` is rendered as `—` everywhere and never participates in arithmetic, a comparison, or a default.

**Rationale**: This is the user's resolution of the spec's one open question, and it is the right shape for a reason worth writing down: the three figures do not have the same failure mode. Available balance and escrow come from Postgres, in the same transactionally-consistent read as the account itself. Settled funds come from an `eth_call` against Monad testnet, through `EscrowReadService.balanceOfCents`, which throws `ChainError` when the RPC is unreachable. `GET /me` is the most-polled read in the product — the header widget hits it every five seconds on every screen — so letting a chain outage fail that request would take the entire application's money display down to protect one number.

So the figure has three states, and the type has to carry all three: an amount, zero, and unknown. `number | null` does that with no ceremony. What it must never become is `number` with a `?? 0`, which is the same bug as `67dcf4d`: an absent value silently becoming a confident, plausible, wrong zero.

**Alternatives considered**: `settledFundsMinor?: Cents` (optional) — rejected, because optionality invites `?? 0` and reads as "sometimes we don't bother", when the truth is "sometimes it cannot be known". A discriminated union (`{ known: true, cents } | { known: false }`) — rejected as ceremony for a two-state value that `null` already expresses.

---

## R3 — Normalise the figure at the boundary; do not trust the field to arrive

**Decision**: `fetchMe` coerces `settledFundsMinor` to `Cents | null` at the API boundary: a finite number stays, anything else — `undefined`, `null`, a string, `NaN` — becomes `null`.

**Rationale**: `api/orders.ts` argues at length that the API layer has no shape tolerance, and that rule is right for envelopes and field names generally. This is a narrow, deliberate exception on one field, and the asymmetry that justifies it is the same one `unwrapList` uses in `agents.ts`: *what does the mistake look like on screen?*

A missing `settledFundsMinor` — the field renamed upstream, or misspelled here — arrives as `undefined`. Left alone, `formatUsd(undefined)` happens to render `—` (the `Number.isFinite` guard), which is the correct output by accident. But `undefined` also silently passes `settled > 0` as `false`, which disables Withdraw with the *zero* copy rather than the *unknown* copy — telling a seller they have earned nothing when the truth is that nobody looked. One coercion at the boundary makes the correct behaviour structural instead of coincidental.

The brief names this directly: *"A name that doesn't match renders as an absent value rather than an error, which is exactly how `67dcf4d` happened."*

**Alternatives considered**: trusting the payload (relies on `formatUsd`'s guard for correctness, and gets the disabled-state copy wrong); a runtime schema validator like zod (a new dependency, for one field).

---

## R4 — The wallet page adds no polling of its own for the figures

**Decision**: The page reads the account figures through the existing `useAccountSummary()` hook — a passive subscriber to the `['me']` cache entry the shell's `BalanceWidget` already polls at 5s. The page owns one new poll: `['ledger']`, also at 5s.

**Rationale**: `useAccountSummary`'s module comment already worked this out for the buy panel, and the reasoning applies verbatim here — with more force, because this is the screen where a disagreement would be visible. TanStack Query deduplicates by key, so a second observer of `['me']` shares the data but **keeps its own schedule**: a `usePolling(['me'], …, { intervalMs: 5000 })` on this page would silently double the request rate against `/me` while the wallet screen is open. And the header widget is mounted on this screen too, one element above the page content — two independent reads of the same number, drifting up to five seconds apart, on the one screen whose entire purpose is that the money figures are trustworthy.

The dependency this creates is worth stating plainly: **the wallet page's figures refresh because the shell's balance widget is mounted.** That is true today for every route (`AppShell` wraps all of them) and it is what `useAccountSummary` was built on. If the widget is ever removed from the shell, this page and the buy panel both stop refreshing, and the fix is to move the cadence into a hook rather than to add a second one here.

**Alternatives considered**: `usePolling(['me'])` on the page (doubles the rate — measurable in the network tab, invisible in review); a `['wallet-me']` key (a second request *and* two numbers that can disagree, which is the exact failure the spec's SC-002 is about).

---

## R5 — `useAccountSummary` gains an `error`, so the page can keep the last known figures

**Decision**: Extend `AccountSummaryResult` from `{ data, unknown }` to `{ data, unknown, error }`. Additive; `BuyPanel`'s use is untouched.

**Rationale**: FR-007 requires a failed refresh to leave the last known amounts on screen, marked stale — not to blank them. The current hook cannot express that. Its `unknown` flag is `!isSignedIn || error !== null || data === undefined`, so after one good read and one failed refresh, `unknown` is `true` while `data` still holds perfectly good figures from five seconds ago. That collapse is correct for the buy panel (which only wants to know whether it can trust the number for an affordability check) and wrong here (where blanking three figures because one refresh failed is the screen breaking itself over a blip).

Exposing the error rather than adding a second flag keeps one hook with one meaning per field: `data` is the last thing we read, `error` is what happened most recently, `unknown` stays exactly what it was for the caller that already depends on it.

**Alternatives considered**: a separate `useWalletAccount()` (a second observer of `['me']` — see R4, and now two hooks whose `unknown` rules can drift apart); reading `useQuery(['me'])` inline on the page (duplicates the sign-in gating that the hook exists to hold in one place).

---

## R6 — `parseUsd` parses money as strings and integers, and never as a float

**Decision**: Add `parseUsd(input: string): ParseResult` to `lib/money.ts`, returning `{ ok: true, cents }` or `{ ok: false, message }`. It splits on the decimal point and builds cents with integer arithmetic — no `parseFloat(x) * 100`.

**Rationale**: `lib/money.ts` opens with *"No floating-point arithmetic on money. This module formats; it does not add."* This feature needs the other direction, and the discipline has to survive the trip. `Math.round(parseFloat('19.99') * 100)` gives 1999 today and is one careless refactor away from `Math.floor`, which gives 1998. Splitting `"19.99"` into `19` and `99` and computing `19 * 100 + 99` cannot round at all.

The rules, each traceable to a spec line:

| Input | Result | Why |
| --- | --- | --- |
| `""`, whitespace | refused | FR-010 |
| `"0"`, `"0.00"` | refused — "Enter an amount greater than zero." | FR-010; a zero-value movement is a ledger entry that explains nothing |
| `"-5"` | refused | FR-010 |
| `"$1,234.50"` | 123450 | `$`, `,` and spaces stripped before parsing — a person pasting a formatted figure is not making a mistake |
| `"1.999"` | **refused**, not truncated | Spec edge case: *"never silently truncated into a different amount"* |
| `"1."`, `"1.5"` | 100, 150 | A trailing point and one decimal place are ordinary typing |
| `"abc"`, `"1e3"`, `"1.2.3"` | refused | Only digits, one separator, and an optional currency symbol |
| `> $10,000.00` | refused — "That is more than this demo's treasury holds." | See below |

The cap is the one rule not derived from the spec. The treasury is a faucet-funded testnet wallet; the most likely money failure in a rehearsal is not a hostile input but a slipped finger — `100000` instead of `100.00` — which the backend would refuse with whatever a failed ERC-20 transfer says, mid-demo, in front of an audience. A named client-side ceiling turns that into one clear sentence. It is a display convenience, not a security control: the backend remains the authority.

**Alternatives considered**: `<input type="number">` with `valueAsNumber` (dollars as a float, then a multiplication — the precise thing the module forbids, and browser number inputs also accept `1e3`); a currency-input dependency (a package for forty lines).

---

## R7 — Cash-out takes an amount, pre-filled with the whole balance

**Decision**: `POST /offramp { amountMinor }`, with the input pre-filled to the current available balance so the common case is one click. Handoff assumption 8.

**Rationale**: api-design §3.2 describes `/offramp` as *"cash out unspent platform balance"* without saying whether it takes an amount. An amount is the more useful shape and degrades gracefully — if the backend only supports the full balance, the field becomes read-only and the copy still states what will move, which satisfies the spec's assumption as written. The reverse (building full-balance-only and discovering the endpoint wants an amount) means a form appears late.

Pre-filling matters more than it looks: rain-integration §0.3 makes the funder wallet's balance a **live health check** — it should fall as users top up and rise as they cash out. A demo that cashes out the whole balance in one click exercises that loop; one that makes the presenter type a number invites them to skip it.

**Alternatives considered**: full balance only, no field (loses the partial exit named in the spec's assumptions).

---

## R8 — Three money POSTs, three silences, and only one of them is resolved by the statement

**Decision**: No automatic retry on any of the three. On a refusal (`kind === 'http'`), show what the backend said and let the person correct and retry. On silence (`isConnectivityError`), disable the control that was in flight and name **the specific signal on this page that will resolve the ambiguity**:

| Action | Silence resolved by | Copy names |
| --- | --- | --- |
| `POST /topup` | the statement — a landed top-up writes a `onramp` entry | "your statement refreshes every few seconds; if it landed it will appear there" |
| `POST /offramp` | the statement — a landed cash-out writes an `offramp` entry | the same |
| `POST /withdraw` | **the settled-funds figure falling** — a withdrawal writes no ledger entry, ever | "settled funds will fall on their own if it landed" |

**Rationale**: `api/orders.ts` already draws this distinction and explicitly warns against copying its rule without re-deriving it. Doing that here: `BuyPanel` offers no retry and sends the buyer away because a purchase debits a ledger *with no screen watching the outcome*. This page is the opposite — it is the screen that watches the ledger, refreshing every five seconds. So silence is recoverable here without any user action, exactly as it is on the order screen, and the right copy is wait-and-see rather than a dead end.

But the three actions do not share a resolving signal, and that is the part that would be wrong if copied carelessly. Settlement and withdrawal produce **no ledger entry at all** (database-schema §3.3) — telling someone to watch their statement for a withdrawal is advice that can never come true. Withdrawal's signal is the third figure dropping, which is on the same screen and refreshes on the same cadence.

**Alternatives considered**: a retry button on silence (how someone funds twice, or withdraws into a pending transaction); idempotency keys (an API change nobody has scoped, noted in the handoff as the thing that would delete this whole paragraph).

---

## R9 — One in-flight guard for all three actions, held in a ref

**Decision**: A single `useRef(false)` in the component owning all three mutations. Any action in flight disables all three controls.

**Rationale**: The ref, rather than `isPending`, is settled precedent with a measurement behind it — `OrderActions` records that five synchronous activations sent five requests before the ref existed, because `disabled` comes from state and state does not change until React re-renders. Money makes that worse than an accidental double-accept.

Sharing one guard across all three is a stronger rule than FR-028 requires (it asks only that each control not be submittable twice), and the reason is the statement. All three movements touch the same available balance; two in flight at once produce two entries whose ordering the person cannot predict, on a screen whose central promise is that the statement explains the balance. One at a time costs nothing — nobody tops up and cashes out simultaneously on purpose — and it keeps FR-016 true at every instant.

**Alternatives considered**: three independent guards (permits concurrent movements for no benefit); a page-level context (indirection for something one component can hold).

---

## R10 — Withdraw is disabled when the settled figure is unknown, which deliberately contradicts the rule `useAccountSummary` wrote down

**Decision**: Disable Withdraw both at zero and at unknown, with different copy for each. This is the user's explicit instruction and it is a knowing divergence from an existing, documented app rule.

**Rationale**: `useAccountSummary` carries a warning in capitals: *"`unknown === true` must NEVER be read as 'cannot afford'. It is the absence of an answer, not a negative one. Disabling a purchase because a transient `GET /me` failed would block a spend the backend would have accepted."* That rule is right, and this feature breaks it in one place, so the difference has to be real rather than convenient:

- **Cost of a false block.** Blocking a purchase blocks the demo — there is no other path to an order. Blocking a withdrawal blocks nothing: settled funds are the person's own money on-chain, they are not going anywhere, and the button returns on the next successful read five seconds later.
- **Cost of allowing it.** A purchase submitted on an unknown balance is either accepted or cleanly refused by the ledger. A withdrawal submitted on an unknown settled balance goes to `withdrawFor(wallet)` against a contract we have just failed to read — and the reason we failed to read it is almost always that the RPC is unreachable, which is exactly when the write will fail too. The likely outcome is a chain error surfacing on stage in place of a disabled button that says *"we could not read this just now."*
- **`withdrawFor` takes no amount.** There is no partial withdrawal to fall back on, so proceeding is not a smaller bet.

So: the rule stands where it was written, and this is the case it does not cover. Cash-out keeps the original rule — it is refused locally only when the *amount exceeds a balance we actually have* (FR-027), never because a read failed.

**Alternatives considered**: allowing the attempt and letting the backend refuse (consistent with the buy panel, but the failure lands as a chain error rather than a sentence, at the worst moment); disabling on any `/me` failure (would take cash-out down with it, for a figure that came from Postgres and was fine).

---

## R11 — The header keeps two figures; the third one lives only here

**Decision**: `BalanceWidget` is not modified. It continues to show available balance and escrow.

**Rationale**: The brief requires that a `null` settled figure *"blanks neither the wallet page nor the header balance widget."* The strongest form of that guarantee is that the widget never reads the field at all — which is already true, since it destructures two named properties from `AccountSummary`. Adding a nullable third property to the type cannot affect it. No code change is the guarantee.

Beyond compatibility, the widget is on screen during Act 2's closing beat on the order page, and a third money number in the header — one with no action attached to it there — is noise competing with the verdict card. The wallet page is where settled funds become actionable, so that is where they are shown.

**Alternatives considered**: three figures in the header (noise on every screen, and a `—` in the shell during any chain blip, which reads as breakage app-wide).

---

## R12 — The statement does not audit itself

**Decision**: Render the entries; do not sum them client-side and compare against the balance. SC-004 is verified by hand in [quickstart.md](./quickstart.md) Part C.

**Rationale**: FR-016 is a requirement on the *system*, not a feature of the screen. Building a client-side reconciliation banner would create a second computation of the available balance sitting next to the first, and the first is authoritative — it is `SUM(amount_minor)` computed by Postgres over the same rows. When the two disagree the client is wrong far more often than the server, and the honest cases where they legitimately differ are ordinary: a `/me` read and a `/me/ledger` read taken five seconds apart with a purchase between them, or the day the endpoint grows a page limit. Each of those would fire a "your books don't balance" warning at a demo audience over nothing.

**Alternatives considered**: a discrepancy banner (spurious by construction, and it would need to explain a race); a dev-only console assertion (a check nobody watching the demo can see, in a build where nobody is watching the console).

---

## R13 — `['ledger']` polls at 5s, forever, and rows are keyed by entry id

**Decision**: `usePolling(['ledger'], fetchLedger, { intervalMs: 5000, enabled: isSignedIn })`. No `isTerminal` — the statement never finishes. Rows keyed by `entry.id`, newest first, no pagination and no virtualisation.

**Rationale**: The cadence is fixed by ui-design §5 and CONTEXT §4 (Wallet 5s, never stops — a deposit can land at any time). `usePolling` already expresses "never terminal" by omitting the predicate.

The keying is what satisfies FR-017's scroll requirement. React reconciles a keyed list by identity, so a new entry prepended to the array inserts one row and leaves the rest of the DOM — and therefore the scroll offset — untouched. Keying by array index would remount every row on each poll and throw the reader's position away every five seconds. Pagination is explicitly out of scope (CONTEXT §5); at demo scale the statement is tens of rows.

`isFatalError` is deliberately omitted: unlike an order 404, a failing `/me/ledger` is a resource that exists and will come back, and giving up on it permanently would leave the screen stale for the rest of the session with no way to recover but a reload.

**Alternatives considered**: sharing one query for `/me` and `/me/ledger` (two endpoints, and the header needs only one of them); `refetchOnWindowFocus` (off app-wide, deliberately — `lib/queryClient.ts`).

---

## R14 — Every successful action invalidates `['me']` and `['ledger']` together

**Decision**: `onSettled` on all three mutations invalidates both keys — settled rather than success, following `OrderActions`.

**Rationale**: FR-009 requires a top-up to show in the balance as part of the same interaction, not five seconds later. `BuyPanel` established the pattern (`invalidateQueries({ queryKey: ['me'] })` after a purchase) and it is one line. Invalidating on *settled* rather than *success* is the more useful choice for exactly the ambiguous case: after a silent failure we do not know what happened, and re-reading is how the page finds out — which is also what makes the wait-and-see copy in R8 true rather than a hope.

Both keys, always, even for withdrawal, which writes no ledger entry: an unnecessary refetch of a small list costs one request, and a missing one costs a stale statement that contradicts the balance beside it.

**Alternatives considered**: optimistic cache writes (the app has none anywhere, and optimism about money that may not have moved is the worst place to start); waiting for the next poll (five seconds of a screen contradicting an action the person just watched succeed).

---

## R15 — The explorer anchor is extracted from `TxHashLink` rather than rebuilt

**Decision**: Extract the validate-truncate-link core of `TxHashLink` into `components/ExplorerTxLink.tsx`; `TxHashLink` keeps its props and its order-specific missing-hash copy and renders the extracted piece for the present-hash case. The withdrawal receipt uses `ExplorerTxLink` directly.

**Rationale**: FR-030 says the explorer destination comes from the application's single configured definition, and `chain/chains.ts` says a second hardcoded explorer address is precisely the drift it exists to prevent. Both are satisfied by calling `explorerTxUrl`, which either approach does. The reason to extract is the rest of the logic: `isTxHash` validation before a link is emitted, middle-truncation for display, the full value in `title` and `href`, `target="_blank"` with `rel="noopener noreferrer"`. Re-typing those four rules in a wallet component is how one of them ends up missing — most likely the validation, which is the one that stops a malformed hash from becoming an authoritative-looking link to an explorer 404.

`TxHashLink`'s props do not change, so the verdict card's call site is untouched. The copy button stays in `TxHashLink`: the verdict card needs it because a sceptic is checking that hash elsewhere; a withdrawal receipt is a confirmation the person already believes.

**Alternatives considered**: duplicating the anchor in the wallet component (four rules to keep in sync, and UI-05 shipped yesterday); generalising `TxHashLink`'s `state: OrderState` prop into something order-agnostic (changes a component the demo's closing beat depends on, for no gain here).

---

## R16 — `GET /me/ledger` unwraps a list envelope; `GET /me` does not

**Decision**: `fetchLedger` uses the same envelope-tolerant unwrap as `fetchAgents`, checking `entries`, `items`, `data`. `fetchMe` stays strict apart from the one coercion in R3.

**Rationale**: `agents.ts` states the test for when tolerance is earned, and the statement passes it exactly. An envelope misread as an array yields `[]`, which this screen faithfully renders as *"no activity yet"* (FR-020) — a plausible, silent, wrong success, on a screen whose job is to prove the money moved. That is the same failure `unwrapList` was written for, and the same reason it is confined to list reads rather than generalised.

`GET /me` fails the test in the other direction: a wrong field name there renders as a blank or a dash next to two figures that are visibly fine, which is loud, local, and gets fixed. Hence no envelope handling on the object read — with the single exception of R3's coercion, which exists to make that blank say the right thing rather than to hide it.

**Alternatives considered**: generalising `unwrapList` into `client.ts` (the `agents.ts` comment forbids it by name — *"Do not generalise this. The asymmetry is the whole argument for it"*); strictness on both (a silent empty statement in a demo).

---

## Sources

- `ui/docs/specs/UI-06-wallet-page.md` — the brief, revised mid-planning to carry the three-figure contract and the nullable rule
- `ui/docs/CONTEXT.md` §2 (never calls the escrow contract), §3 (six visible things, items 5 and 6), §4 (polling cadences, `VITE_` guardrail), §5 and the tests decision
- `docs/ui-design.md` §3 Flow E (two exits), §4 (page → endpoint map), §5 (polling)
- `docs/api-design.md` §3.2 (the five endpoints; why `/me` returns two figures rather than one), §4
- `docs/database-schema.md` §3.2 (`ledger_entries`, the four kinds), §3.3 (settlement produces no ledger entry — the fact this whole feature is shaped around)
- `docs/rain-integration.md` §0.3 (funder wallet as the outside world; the unspent-balance gap that `/offramp` closes), §1.2 (the $2 simulation minimum, and why the top-up model makes it moot)
- Existing code read during planning: `hooks/usePolling.ts`, `hooks/useAccountSummary.ts`, `api/client.ts`, `api/errors.ts`, `api/orders.ts`, `api/agents.ts`, `lib/money.ts`, `lib/queryClient.ts`, `components/BalanceWidget.tsx`, `components/BuyPanel.tsx`, `components/OrderActions.tsx`, `components/TxHashLink.tsx`, `components/LoadState.tsx`, `chain/chains.ts`, `routes/AppRoutes.tsx`
- Backend read during planning: `api/src/ledger/balance.repository.ts`, `api/src/chain/escrow-read.service.ts`, `api/src/entities/ledger-entry.entity.ts`, `api/src/chain/units.ts`
