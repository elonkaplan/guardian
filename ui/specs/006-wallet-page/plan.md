# Implementation Plan: Wallet page — money in, money out

**Branch**: `006-wallet-page` | **Date**: 2026-08-09 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/006-wallet-page/spec.md`

## Summary

Replace the `/wallet` placeholder with the screen that makes three kinds of money legible and gives two of them a way out: available balance, escrow, and settled funds as three figures that are never summed; a statement that accounts for the first of them completely; add funds, cash out, and withdraw; and the line that says the money came from a demo treasury before anyone has to ask.

**The approach is mostly subtraction.** The page adds one poll (`['ledger']`) and no second reader of `/me` — it subscribes to the cache entry the header widget already refreshes every five seconds, which is both the required cadence and the only way the header and the page cannot disagree (R4). Nothing here polls the chain, signs anything, or knows what a token base unit is.

Five decisions carry the weight. **`settledFundsMinor` is `Cents | null` and `null` means unknown, never zero** — a coercion at the boundary makes that structural rather than dependent on `formatUsd` happening to guard against `NaN` (R2, R3). **`parseUsd` builds cents from integers**, because `lib/money.ts` forbids float arithmetic on money and the inverse direction has to keep the rule (R6). **Three money POSTs get three different silence messages**, each naming the specific signal on this page that resolves the ambiguity — the statement for two of them, the settled figure for withdrawal, which writes no ledger entry ever (R8). **Withdraw is disabled on an unknown balance**, knowingly contradicting a rule the previous feature wrote in capitals, for reasons set out in full (R10). And **the statement does not audit itself** (R12).

Six new files, five edits, one placeholder replaced. The spec needed no corrections during planning.

## Technical Context

**Language/Version**: TypeScript 5.9.3, React 19.2.8. Unchanged strict settings.

**Primary Dependencies**: **None added.** Existing: `@tanstack/react-query@5.101.4` (via `usePolling` and `useMutation`, both unchanged), `react-router-dom@7.18.2`. viem contributes one type import (`Hex`) through the extracted explorer link. **wagmi is not used and must not be** — settled funds are on-chain money read server-side, which is the demonstration of `ui/docs/CONTEXT.md` §2's boundary rather than the exception to it.

**Storage**: None. No `localStorage`, no context, no persisted keys. Four `useState` and one `useRef`, all in one component ([data-model.md §5](./data-model.md)).

**Testing**: **None.** No unit, integration, or e2e tests — an explicit project decision (`ui/docs/CONTEXT.md`), restated as FR-037. Acceptance is by hand via [quickstart.md](./quickstart.md): Part A is the parser with no backend at all, Part F is the degradation run the demo will never produce, Part G is eleven boundary greps.

**Target Platform**: Desktop Chrome on a demo laptop at ~1280×800, and a projector.

**Performance Goals**: Two requests every five seconds while the page is open — `/me` (shared with the header, not additional) and `/me/ledger`. Every action reflected on screen within 2 seconds without a refresh (SC-003).

**Constraints**: No chain call, no chain read, no wallet signature from the browser (FR-033). No payment-route interface (FR-034). Money is integer cents throughout; the only arithmetic is `Math.abs` on a signed entry and a `<=` against the balance. Nothing may write `settledFundsMinor ?? 0`.

**Scale/Scope**: 6 new files, 5 edited, 5 backend endpoints consumed — **none of which exists yet**, though three of them are controllers over readers that do ([contracts §7.1](./contracts/internal-api.md)). One developer, a day.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

**Status: NOT EVALUATED — no ratified constitution exists.**

`.specify/memory/constitution.md` is still the unmodified Spec Kit template. Sixth consecutive feature to record it. The substitute is unchanged and works: [quickstart.md](./quickstart.md) Part G turns this feature's structural rules — no chain access from the browser, no zero-defaulting of an unknown balance, one explorer host, no float arithmetic on money, no stub routes called, no second `/me` poller, no automatic retry on a money POST, the placeholder actually deleted — into eleven commands a reviewer runs in under a minute.

**Post-Phase 1 re-check**: unchanged. No constitution was added during planning, and no decision below would violate one if it existed.

## Key Decisions

Full reasoning in [research.md](./research.md). The five worth arguing about:

| Decision | Why | Reversibility |
| --- | --- | --- |
| **`settledFundsMinor` is `Cents \| null`, coerced at the boundary** (R2, R3) | The three figures do not fail alike: two come from Postgres in the same read as the account, one comes from an `eth_call` that throws when the RPC is unreachable — on the most-polled endpoint in the product. So the figure has three states and the type carries all three. The coercion exists because a *renamed* field arrives as `undefined`, which renders `—` by luck (`formatUsd`'s finite guard) but silently fails `settled > 0`, disabling Withdraw with the *zero* wording — telling a seller they earned nothing when nobody looked. That is `67dcf4d` with money on it. | One boundary function. If the API ever guarantees the field, the coercion becomes a no-op worth keeping anyway. |
| **The page does not poll `/me`; it subscribes** (R4) | Query-key dedup shares data but not schedules — a `usePolling(['me'])` here would quietly double the request rate while the wallet screen is open, and put two independent reads of the same number one element apart on the one screen whose promise is that the figures are trustworthy. `useAccountSummary` already argued this for the buy panel. | The hook is already there; this is the absence of code. |
| **Three POSTs, three silences, no automatic retry** (R8) | `api/orders.ts` warns in writing against copying its rule without re-deriving it, so: `BuyPanel` sends the buyer away because nothing watches the outcome of a purchase. This page *is* the thing that watches — so silence gets wait-and-see copy. But top-up and cash-out are resolved by the statement, and **withdrawal never is**, because settlement writes no ledger entry (database-schema §3.3). Telling someone to watch their statement for a withdrawal is advice that cannot come true. | Copy strings and one classifier. An idempotency key upstream deletes the whole branch. |
| **Withdraw is disabled when the settled figure is unknown** (R10) | Deliberately contradicts `useAccountSummary`'s capitalised warning that unknown must never read as "cannot afford". The difference is real: a false block on a purchase blocks the demo, while a false block on a withdrawal blocks nothing — the money is on-chain and the button returns in five seconds. And the reason the read failed is usually that the RPC is unreachable, which is exactly when `withdrawFor` fails too, surfacing a chain error on stage instead of a sentence. Cash-out keeps the original rule. | One predicate. Documented in both files so it cannot be mistaken for an oversight. |
| **The statement does not reconcile itself** (R12) | FR-016 is a requirement on the system, not a feature of the screen. A client-side sum next to the server's `SUM(amount_minor)` is a second authority that would fire "your books don't balance" over a five-second race between two reads, in front of an audience, when the server is right. | It is not built. SC-004 is quickstart C6, run by a human with a piece of paper. |

**No spec corrections were needed.** The spec's four informed guesses — cash-out takes an amount, withdrawal takes none, the `$2` simulation minimum does not apply, settlement writes no entry — were each re-checked in R7, R8, and against `rain-integration.md` §0.3 and §1.2 during planning. All four survived.

## Project Structure

### Documentation (this feature)

```text
specs/006-wallet-page/
├── plan.md              # This file
├── spec.md              # Feature specification (unamended)
├── research.md          # Phase 0 — 16 resolved decisions
├── data-model.md        # Phase 1 — payload types, the one coercion, derived values, query keys
├── quickstart.md        # Phase 1 — the manual acceptance run (Parts A–H)
├── contracts/
│   └── internal-api.md  # Phase 1 — module surface + the backend handoff (§7)
├── checklists/
│   └── requirements.md  # Spec quality checklist
└── tasks.md             # Phase 2 — created by /speckit-tasks, not here
```

### Source Code (repository root)

```text
ui/src/
├── api/
│   ├── types.ts                    EDIT — + settledFundsMinor, LedgerKind, LedgerEntry, request/response shapes
│   ├── me.ts                       EDIT — fetchMe gains the settled-funds coercion
│   └── wallet.ts                   NEW  — fetchLedger, topUp, cashOut, withdraw + the non-idempotency doctrine
├── lib/
│   ├── money.ts                    EDIT — + parseUsd, integer-only, total
│   └── ledger.ts                   NEW  — direction from the sign, kind vocabulary, absolute timestamps
├── hooks/
│   ├── useAccountSummary.ts        EDIT — + error, so the page can keep stale figures on screen
│   └── useLedger.ts                NEW  — ['ledger'] at 5s, never terminal
├── components/
│   ├── MoneyFigures.tsx            NEW  — three figures, never a total, three states for the third
│   ├── AmountField.tsx             NEW  — the money input and its refusal, shared by both forms
│   ├── WalletActions.tsx           NEW  — all three mutations, one in-flight ref, refusal vs silence
│   ├── LedgerTable.tsx             NEW  — the statement, keyed rows, scope note, order links
│   ├── ExplorerTxLink.tsx          NEW  — extracted from TxHashLink: validate, truncate, link out
│   └── TxHashLink.tsx              EDIT — delegates its present-hash branch; props unchanged
├── pages/
│   └── WalletPage.tsx              EDIT — composition; the PagePlaceholder goes
└── index.css                       EDIT — figures, amount fields, action panels, statement rows
```

**Structure Decision**: still no new directories, and `src/components/` now reaches twenty-eight files. UI-05's plan recommended reorganising once after UI-08, when the full set is visible; that recommendation stands and this feature is the evidence for it, not a reason to do it early. A move done mid-series is a move done twice.

`src/lib/ledger.ts` earns its place on the same grounds as `verdict.ts`, `orderState.ts`, and `money.ts`: pure data transformation, no React, and functions whose callers must not disagree — nothing else in the app may decide what a `purchase` row is called or whether an amount is a credit.

`src/chain/chains.ts` is **used and not edited**. `BalanceWidget.tsx` is **neither used nor edited** — it keeps reading the two properties it already reads, which is what makes FR-008's "does not blank the header" a structural fact rather than a promise (R11).

## Implementation Order

Dependency-ordered, matching the spec's story priorities. Each step is verifiable against the named part of [quickstart.md](./quickstart.md).

| # | Step | Story | Verify |
| --- | --- | --- | --- |
| 0 | **Send [contracts §7.2](./contracts/internal-api.md) to whoever builds the API** — ten assumptions, one of which (nullable on chain failure) is the whole degradation story | — | A conversation. Assumption 2 is the one that gets missed. |
| 1 | `lib/money.ts` — `parseUsd`, integer-only, total | US2 | **Part A** — the entire parser, no backend, no API |
| 2 | `api/types.ts`, `api/me.ts` coercion, `lib/ledger.ts` | US1 | `npm run typecheck`; **G2**, **G9** |
| 3 | `api/wallet.ts` — four calls, envelope unwrap, the doctrine comment | — | **G7** |
| 4 | `hooks/useAccountSummary.ts` edit, `hooks/useLedger.ts` | US1, US3 | **B7** in the network panel — one `/me` per 5s, not two |
| 5 | `MoneyFigures` + `WalletPage` composition; placeholder deleted | US1 | **Part B**, **G8** |
| 6 | `AmountField` + `WalletActions` — add funds first, then cash out | US2, US5 | **Part C**, **Part E** |
| 7 | `LedgerTable` | US3 | **Part C** — C6 is the one that matters, and C8 |
| 8 | `ExplorerTxLink` extraction; withdraw in `WalletActions` | US4 | **Part D**; re-run UI-05's verdict-card link check |
| 9 | `index.css` | — | **G10** (greyscale), **G11** (distance) |
| 10 | Degradation: null settled, stale figures, silence copy | US1, US4 | **Part F** — the part nobody runs |
| 11 | Boundary sweep, then the rehearsal | — | **Part G**, then **Part H** |

Steps 1–3 are worth landing before the API's accounts module exists: Part A is a complete acceptance run that needs nothing but the dev server, and the parser is the part nobody returns to once money is moving on screen.

## Risks

| Risk | Impact | Response |
| --- | --- | --- |
| **`/me` fails outright when the chain read throws.** The natural implementation lets `ChainError` escape. | **Application-wide.** `/me` is polled every 5s by the header on every screen; an escaping chain error takes all money display down — the precise failure the nullable field exists to prevent. | Handoff assumption 2, called out as the one most likely to be missed. Part F is built around it. The frontend cannot mitigate this; it can only degrade correctly once the API answers. |
| **None of the five endpoints exists.** Every payload shape is an assumption. | Parts B–F cannot run; field names may be wrong on first contact. | Deliberate (R1). Ten numbered assumptions in [contracts §7.2](./contracts/internal-api.md); blast radius is `api/types.ts` plus `api/wallet.ts`. Three of the five are controllers over readers that already exist. |
| **A money POST is submitted twice.** | Funding or cashing out twice, with a statement that then explains it — honestly, but embarrassingly. | One in-flight ref shared by all three actions (R9), the pattern `OrderActions` measured. C10 and D6 are the deliberate double-click checks. |
| **Silence on a top-up.** We do not know whether it landed. | A person funds twice and the treasury drains faster than the demo expects. | No retry button anywhere (R8); the copy names the statement as the signal. The real fix is an idempotency key upstream, noted as assumption 9. |
| **`withdrawFor` reverts on a zero or unknown balance**, mid-demo. | A chain error on stage in place of a disabled button. | R10 — disabled at both zero and unknown, with different wording. This is the one place the app deliberately blocks on an unknown figure. |
| **The statement and the balance disagree** during a race between two reads five seconds apart. | Looks like the books are broken, on the screen that exists to prove they are not. | R12: the screen does not compute a second total, so there is nothing to disagree. C6 verifies reconciliation by hand, where a human can tell a race from a bug. |
| **`ExplorerTxLink` extraction regresses the verdict card**, which shipped yesterday. | The demo's most persuasive artefact breaks. | Props unchanged, call site unmoved, and step 8 re-runs UI-05's own link check. If it looks at all risky in review, inline the anchor in the wallet instead — the host still comes from `explorerTxUrl` either way. |
| **Twenty-eight files in `src/components/`.** | Navigability, not correctness. | Accepted. Reorganise once after UI-08, as UI-05 recommended. |
| **No constitution**, sixth feature running. | Structural rules enforced by review only. | Part G converts the eight that matter into greps. |

## Complexity Tracking

No constitution exists, so there are no violations to justify. Nothing here adds a dependency, a directory, an environment variable, a route, or a persisted key.

Three things depart from something already written down, and each is argued rather than assumed:

| Departure | Where | Justification |
| --- | --- | --- |
| **Shape tolerance on one field** of an object read, where `api/orders.ts` says there is none | `fetchMe` | R3. The rule is right for envelopes; this is one documented tri-state field whose absent case must not read as zero. Confined to one expression, tabulated in [data-model.md §2](./data-model.md), and checked by **G2** and **F6**. |
| **Blocking an action on an unknown figure**, where `useAccountSummary` warns in capitals against it | Withdraw | R10. The costs are asymmetric in the opposite direction from the buy panel's, set out in three bullets there. The user's explicit decision, recorded so it reads as a choice. |
| **Editing shared machinery** — `useAccountSummary`, `TxHashLink`, `lib/money.ts` | three files | All additive: a third return field, a delegated branch with unchanged props, a new exported function. `usePolling`, `queryClient`, `client.ts`, `errors.ts`, and `BalanceWidget` are untouched. |
