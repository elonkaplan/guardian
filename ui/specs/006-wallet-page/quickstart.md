# Phase 1 — Quickstart: Wallet page

**Feature**: `006-wallet-page` · **Date**: 2026-08-09

**This is the test suite.** There are no automated tests in this component by decision (`ui/docs/CONTEXT.md`, FR-037), so acceptance is this document run by hand. Parts A and G need no backend. Parts B–F need the five endpoints from [contracts/internal-api.md §7](./contracts/internal-api.md).

---

## Prerequisites

```bash
cd ui && npm install && npm run dev          # http://localhost:5173
cd api && npm run start:dev                  # http://localhost:3000
```

Sign in with a wallet (one signature — that is the whole of registration), then open `/wallet`.

```bash
npm run typecheck      # must be clean before any part below counts
npm run lint
```

---

## Part A — The amount field, with no backend at all

Type each of these into **Add funds** and read what the field says. Nothing is submitted; this is the whole of `parseUsd` (R6).

| # | Type | Expect |
| --- | --- | --- |
| A1 | `25` | accepted — the button reads `Add $25.00` |
| A2 | `25.5` | accepted — `$25.50` |
| A3 | `$1,234.50` | accepted — `$1,234.50`; symbol and separator stripped |
| A4 | *(empty)*, then submit | refused, "enter an amount" |
| A5 | `0` / `0.00` | refused — "greater than zero" |
| A6 | `-5` | refused |
| A7 | `1.999` | **refused**, and specifically not accepted as `$1.99` — silent truncation is the failure this rule exists to prevent |
| A8 | `abc`, `1e3`, `1.2.3` | refused |
| A9 | `50000` | refused — over the treasury ceiling, named as such |
| A10 | `1.` then `1.5` | both accepted (`$1.00`, `$1.50`) — ordinary typing must not be punished |

**A11** — repeat A1, A5, A7 in the **Cash out** field. Same answers, same wording. Two fields must not validate differently; if they do, the parse leaked out of `lib/money.ts`.

---

## Part B — The three figures (US1)

| # | Do | Expect |
| --- | --- | --- |
| B1 | Open `/wallet` signed in | Three separately labelled figures: available, in escrow, settled |
| B2 | Read the screen top to bottom | **No total anywhere.** No figure is the sum of any two others (SC-002) |
| B3 | Read each label | Each says where that money is and how it leaves, without jargon (FR-003) |
| B4 | Fresh account, nothing funded | All three read `$0.00` explicitly — not blank, not hidden (FR-005) |
| B5 | Buy something in a second tab, return | Available falls and escrow rises within ~6s, untouched by you (SC-006) |
| B6 | Watch for 30s with DevTools open | Figures never blink to `—` or `$0.00` between polls (FR-006) |
| B7 | Network tab, filter `/me` | **One** request every 5s, not two. Two means the page polls `['me']` itself instead of subscribing (R4) |

---

## Part C — Add funds and the statement (US2, US3)

| # | Do | Expect |
| --- | --- | --- |
| C1 | Add `$100` | Available balance shows `$100.00` **within 2 seconds**, no refresh (SC-003) |
| C2 | Look at the header widget | It shows the same new figure — one value, not two (R4) |
| C3 | Look at the statement | A credit row, labelled as funding, with a time |
| C4 | Read the copy beside Add funds | *"Funded from the demo treasury — Rain's onramp has no Monad rail yet."* Visible without scrolling or opening anything (FR-013, SC-007) |
| C5 | Buy an agent, return to `/wallet` | A debit row for the purchase, linking to that order; following it lands on the order (FR-018) |
| C6 | Apply every row in order, on paper, from zero | The total equals the displayed available balance **exactly** (SC-004). This is the check the screen deliberately does not do for you (R12) |
| C7 | Read the statement's heading area | It states that the statement explains the available balance, and that settled funds move on-chain without an entry (FR-019) |
| C8 | Scroll the statement, wait through a poll | Scroll position holds; a new row inserts without the list jumping (FR-017) |
| C9 | Brand-new account | "No activity yet" — an empty state, not an error, not a blank box (FR-020) |
| C10 | Double-click Add funds hard, ten times | **One** entry, one movement (SC-009). The button disables on the first activation |

---

## Part D — Withdraw settled funds (US4)

Needs an account with a concluded dispute or a sale, so `balances[address] > 0` on the escrow.

| # | Do | Expect |
| --- | --- | --- |
| D1 | Read the Withdraw control | It says it sends on-chain funds to the signed-in address, and asks for no signature (FR-023) |
| D2 | Withdraw | The settled figure falls; a receipt appears |
| D3 | Follow the transaction link | MonadVision, that exact transaction, first attempt (FR-030) |
| D4 | Account with `$0.00` settled | Withdraw disabled, reason given: nothing settled to withdraw (FR-027) |
| D5 | Check the statement afterwards | **No new row** — and the screen already said why (C7). This is correct, not a bug |
| D6 | Double-click Withdraw | One request (FR-028) |

---

## Part E — Cash out (US5)

| # | Do | Expect |
| --- | --- | --- |
| E1 | Open the Cash out field | Pre-filled with the whole available balance (R7) |
| E2 | Cash out the full balance | Available falls to `$0.00`; a debit row appears, labelled as a cash-out |
| E3 | Read the copy | It says the money returns to the treasury it came from (FR-024) |
| E4 | Enter more than the balance | Refused **before** anything is submitted — check the network tab is silent (FR-027) |
| E5 | Balance `$0.00` | Cash out disabled with a stated reason (FR-027) |
| E6 | Read both exits side by side | Each names which figure it moves and where it goes; they cannot be confused (FR-025) |
| E7 | Before and after, in a terminal | The funder wallet's balance falls on top-up and rises on cash-out — money leaves by both doors (SC-010, rain-integration §0.3) |

---

## Part F — Degradation (the part nobody runs, and the one the spec was rewritten for)

**Simulate an unreadable settled figure** by pointing the API at a dead RPC (`MONAD_RPC_URL=http://127.0.0.1:1` in `api/.env`) and restarting it. `balanceOfCents` now throws; `/me` must still answer.

| # | Do | Expect |
| --- | --- | --- |
| F1 | Reload `/wallet` | Settled figure reads `—`. **Not `$0.00`** (SC-013) |
| F2 | The rest of the screen | Available, escrow, statement, Add funds, Cash out — all working normally (SC-012) |
| F3 | The header widget, on this and any other screen | Unaffected; two figures as always (FR-008) |
| F4 | Withdraw | Disabled, with a reason distinct from the zero-balance one: the amount could not be read (FR-027) |
| F5 | Restore the RPC, wait one poll | The figure and the button come back on their own, no reload (US4 AS7) |
| F6 | Rename `settledFundsMinor` in the API response | Identical to F1 — `—`, not `$0.00`. This is the `67dcf4d` check (R3) |
| **Stop the API entirely** | | |
| F7 | With figures already on screen | Last known amounts stay, marked stale; the screen is not blanked (FR-007) |
| F8 | Reload with the API down | Load-and-retry state; the retry button works when the API returns (FR-034 spec §Loading) |
| F9 | Statement only failing | Statement shows its error and retry; the figures above are untouched, and vice versa |
| F10 | Add funds while the API is stopped | Silence copy: do not submit again, watch the statement. **No retry button** (R8) |
| F11 | Withdraw while the API is stopped | Silence copy naming the *settled figure* as the signal — not the statement, which will never show a withdrawal (R8) |
| F12 | Let the session expire, or clear the token | Redirected to connect; no money figures render (FR-036) |

---

## Part G — Boundary sweep

Run from `ui/`. Each should print nothing unless noted.

```bash
# G1  No chain access from the browser — the whole point of the settled figure (FR-033)
grep -rn "wagmi\|createPublicClient\|readContract\|useReadContract" src/components/MoneyFigures.tsx src/components/WalletActions.tsx src/components/LedgerTable.tsx src/api/wallet.ts src/hooks/useLedger.ts

# G2  Nothing defaults an unknown settled balance to zero (R2, R3)
grep -rn "settledFundsMinor ?? 0\|settledFundsMinor || 0" src/

# G3  One explorer host, still (FR-030)
grep -rn "monadvision\|monadexplorer" src/ --include=*.tsx --include=*.ts | grep -v "chain/chains.ts"

# G4  No float arithmetic on money (R6)
grep -rn "parseFloat\|Number(.*) \* 100\|/ 100" src/lib/money.ts src/components/WalletActions.tsx

# G5  No route stubs called (FR-034)
grep -rn "onramp/routes\|offramp/routes" src/

# G6  No second observer of ['me'] with its own schedule (R4)
grep -rn "usePolling(\['me'\]" src/ | grep -v BalanceWidget

# G7  No automatic retry on a money POST (§3 of contracts)
grep -rn "retry:" src/ | grep -v queryClient.ts

# G8  The placeholder is actually gone
grep -rn "PagePlaceholder" src/pages/WalletPage.tsx

# G9  Exhaustiveness: add a fifth LedgerKind locally and typecheck — expect an error
#     in lib/ledger.ts, then revert.
```

**G10** — greyscale a screenshot of the page. The three figures remain distinguishable by label, and credits from debits by their sign and word, not by colour alone.

**G11** — from the back of the room on the presentation display: the three figures and the treasury line are readable without zooming (SC-007, SC-011).

---

## Part H — What done means

1. Parts A–G pass.
2. Someone who has not seen the product is shown the page and asked which money they can spend, which is committed, and which is already theirs. They answer correctly in under 30 seconds, from the screen alone (SC-001).
3. The same person asks nothing about where the $100 came from, because it is already answered on screen (SC-007).
4. Reset, then run Act 1 end to end twice: fund → buy → deliver → release, returning to `/wallet` each time and finding the statement explains every change (SC-005).
5. Scroll a statement of fifty-plus entries with the figures still visible above it (SC-011).
