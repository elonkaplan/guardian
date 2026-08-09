# Quickstart & Manual Validation: Marketplace & Agent Detail

**Feature**: 003-marketplace-buy · **Date**: 2026-08-08

This component has no automated tests by explicit project decision (`ui/docs/CONTEXT.md`). Everything below is run by hand, in a browser, and **is** the acceptance criteria. Work through it in order; each part maps to one user story.

---

## Prerequisites

- The frontend from UI-02, running (`npm run dev`, default `http://localhost:5173`), with sign-in working.
- A browser wallet extension with an address that can sign in.
- **The Guardian API with API-06 and API-07 built** — `GET /agents`, `GET /agents/:id`, `POST /orders`. Parts B through G cannot be run without it. Part A is the offline part, and it is worth running first regardless.
- At least two seeded agents (`POST /demo/seed`, API-11). One of them should be LedgerBot, whose input is a single block of receipt text — it is the agent both demo acts use.
- A funded account for Part E, and an **empty** one for Part F. Getting a second account ready now saves a mid-test detour; `POST /topup` on the wallet screen funds the first.

## Setup

```bash
cd ui
npm run typecheck    # must be clean before you start clicking
npm run dev
```

No `npm install` step: this feature adds no dependencies. If `npm install` appears in the diff, something went wrong — the schema-to-form mapping is hand-rolled on purpose (research R4).

---

## Part A — Offline behaviour (User Story 1, no backend)

Stop the API, or point `VITE_API_URL` at a dead port and restart the dev server.

| # | Do | Expect | Covers |
| --- | --- | --- | --- |
| A1 | Load `/agents`. | An error state naming the problem, with a retry control. **Not** an empty grid, and not "no agents are listed yet". | FR-003, SC-006 |
| A2 | Activate retry. | A new request goes out (visible in the network tab). The page does not reload. | FR-003 |
| A3 | Load `/agents/anything`. | An error state, with a route back to the catalogue. No white screen, no unhandled rejection in the console. | FR-012, SC-006 |
| A4 | Check the console across A1–A3. | No uncaught errors. | SC-006 |

Restart the API before continuing.

---

## Part B — The catalogue (User Story 1)

| # | Do | Expect | Covers |
| --- | --- | --- | --- |
| B1 | Load `/agents`. | One card per seeded agent, each showing name, description, and price as formatted currency (`$2.00`, not `200`). | FR-001, FR-002 |
| B2 | Count the cards against the seed. | Equal. No duplicates, no missing agent. **If this shows zero, check the response shape first** — a list envelope read as an array is the failure this is watching for (research R3). | FR-001 |
| B3 | Look for search, filters, sort controls, page numbers, or star ratings. | **None present.** | FR-005 |
| B4 | Select a card. | The detail screen for that specific agent, at `/agents/<its id>`. | FR-004 |
| B5 | Copy that URL, open it in a new tab. | The same screen renders directly. | FR-004 |
| B6 | Load `/agents` on a backend seeded with zero agents (or temporarily deactivate all of them). | An explicit "no agents listed yet" state — visibly different from A1's error and from a loading state. | FR-003 |

---

## Part C — The listing as a contract (User Story 2)

Use an agent that declares **both** capabilities and exclusions.

| # | Do | Expect | Covers |
| --- | --- | --- | --- |
| C1 | Load the detail screen. | Every capability and every exclusion is on screen. Count them against the seed data — none truncated, none behind a "show more". | FR-006, SC-002 |
| C2 | Look for a disclosure control anywhere near either list. | None. There is no control that could hide them. | FR-006 |
| C3 | Read the labelling on both lists. | It says these are the terms a dispute is judged against — not "features" or "highlights". | FR-007 |
| C4 | Scroll from the top. | The buy action appears **after** both lists. You cannot reach it without passing them. | FR-008, SC-002 |
| C5 | Shrink the window to a 13" laptop viewport (roughly 1280×800) and reload. | C1 and C4 still hold. This is the viewport SC-002 is measured at. | SC-002 |
| C6 | Open a listing whose `exclusions` is empty. | The exclusions section is still there and says the seller declared none. It does not disappear. | FR-009 |
| C7 | Check the price, the description of what you must supply, and the shape of the result. | All three present. | FR-010 |
| C8 | Open the network tab, inspect the `GET /agents/:id` response. | Confirm it carries no `systemPrompt` / `model`. If it does, that is an **API-06 bug** — report it. The screen shows nothing either way. | FR-011 |
| C9 | Load `/agents/00000000-0000-0000-0000-000000000000`. | Not-found state, with a route back to the catalogue. | FR-012 |

---

## Part D — The buy form (User Story 3 and 5, no purchase yet)

| # | Do | Expect | Covers |
| --- | --- | --- | --- |
| D1 | Look at the input area for LedgerBot. | One labelled field for the receipt text, as a **multi-line** control — not a single-line input. Required fields are marked. | FR-013, R6 |
| D2 | Paste roughly 400 characters of receipt text into it. | It is readable without fighting the control. | R6 |
| D3 | Find the acceptance-criteria field. | Multi-line, and accompanied by copy saying these criteria are half of what a dispute is judged against and cannot be changed after purchase. | FR-015, FR-016 |
| D4 | Read that copy as if you had never seen the product. | You can state what the field is for. This is SC-004 — ask someone else if you can. | SC-004 |
| D5 | Look for an example of a well-formed criterion. | Present, concrete — not just "describe your requirements". | FR-016 |
| D6 | Check the price shown next to the buy action. | Matches the listing price, formatted as currency. | FR-018 |
| D7 | Clear a required input and attempt to buy. | Blocked, the field is identified, **no request in the network tab**. | FR-019 |
| D8 | Fill inputs, clear the acceptance criteria, attempt to buy. | Same: blocked, identified, no request. | FR-015, FR-019 |
| D9 | Enter `ok` as the acceptance criteria and attempt to buy. | A **warning** that this is unlikely to be enforceable — and the purchase is still allowed to proceed. Do not complete it yet. | FR-017 |
| D10 | If you have an agent with a nested input schema (or temporarily seed one), open it. | A single raw JSON textarea with the expected shape shown beside it, and a stated reason. The agent is still buyable. | FR-014 |
| D11 | In that raw field, type `{"a":` and attempt to buy. | Blocked with a parse message; no request sent. | FR-014 |

---

## Part E — Buying (User Story 3)

Use the **funded** account, LedgerBot, real receipt text, and a specific acceptance criterion — something like *"every line item from the receipt, each with its amount, and a total"*. You will want this order later for UI-04, so make it a good one.

| # | Do | Expect | Covers |
| --- | --- | --- | --- |
| E1 | Note the header's available balance. | — | — |
| E2 | Buy. | The action reports that it is working and is disabled while in flight. | FR-020 |
| E3 | **Click it repeatedly while it is working.** | Exactly one `POST /orders` in the network tab. | FR-020, SC-005 |
| E4 | On success. | You land on `/orders/<id>` — the created order (a placeholder screen is fine, the address is what matters). | FR-022 |
| E5 | Check `/orders`. | **Exactly one** new order. This is the real check for E3. | SC-005 |
| E6 | Press the browser back button. | You return to the agent's detail screen. **No second order is created**, and `/orders` still shows one. | FR-022 |
| E7 | Look at the header balance. | Debited by the price, without a manual reload. | §4 cache invalidation |
| E8 | Time the run from opening `/agents` to standing on the order. | Under 90 seconds, without consulting docs. | SC-001 |
| E9 | Deactivate the agent on the backend, then buy again from a stale detail tab. | Refused, the reason is shown on the form, **everything you typed is still there**. | FR-023 |
| E10 | Stop the API, then buy. | Copy that says the order may still have been created, and a link to `/orders`. **No retry button on this branch.** | FR-024, R12 |
| E11 | Follow that link. | `/orders` — where the truth is. | FR-024 |

---

## Part F — Affordability (User Story 4)

Use the **empty** account.

| # | Do | Expect | Covers |
| --- | --- | --- | --- |
| F1 | Open any agent's detail screen. | Available balance and price are both shown, as two separately labelled figures. **Never one combined number.** | FR-025 |
| F2 | Look at the buy action. | Unavailable, with the shortfall amount stated ("$2.00 short", not just "insufficient funds"). | FR-026 |
| F3 | Attempt to buy anyway. | **No `POST /orders` in the network tab.** | SC-003 |
| F4 | Follow the top-up route. | The wallet screen. | FR-026 |
| F5 | Add funds, then navigate back to the agent. | The buy action becomes available **without a full page reload**. | FR-027 |
| F6 | Add funds in a *second tab* while the detail screen sits open in the first. | Within about five seconds the first tab's buy action becomes available on its own — it shares the header's polled balance. | R8 |
| F7 | Block `GET /me` (stop the API briefly, or block the route in devtools) and reload the detail screen. | The buy action stays **available** and the balance reads as unknown. An unreadable balance must not block a purchase. | FR-028 |
| F8 | Sign out and open a detail screen. | The listing renders in full. Where the buy action was, an invitation to sign in. | FR-030, R10 |
| F9 | Sign in from there. | You come back to the same agent. | FR-030 |

---

## Part G — Boundaries (the checks that are not clicking)

These are the rules a reviewer would otherwise have to hold in their head. Run from `ui/`.

| # | Check | Expect | Covers |
| --- | --- | --- | --- |
| G1 | `grep -rnE "systemPrompt\s*[:.]\|\.systemPrompt\|system_prompt" src/` | **No matches** — no property, no access, anywhere. The pattern deliberately matches *code* rather than any mention: `src/api/types.ts` names the field in a doc comment to record that its absence is the guarantee, and that comment is worth more than a simpler grep. | FR-011 |
| G2 | `grep -rn "signMessage\|writeContract\|sendTransaction" src/pages/ src/components/BuyPanel.tsx` | **No matches.** The wallet signs one thing, and this feature is not it. | FR-029 |
| G3 | `grep -rn "'/agents\|\"/agents\|/orders/" src/pages/ src/components/` | Only `routes/paths.ts` builds route strings; pages import from it. | UI-01 convention |
| G4 | `grep -rn "reviewWindow\|priceMinor" src/api/orders.ts` | **No matches** — the purchase body carries neither. | FR-021 |
| G5 | `git diff --stat package.json package-lock.json` | Unchanged. No dependency was added. | R4 |
| G6 | `grep -rnE "collapsed\|expandable\|showMore\|slice\(0," src/components/ContractTerms.tsx` | **No matches.** No mechanism exists by which exclusions could be hidden. The file's comment describes the forbidden props rather than naming them, so that this check stays a simple one. | FR-006 |
| G7 | `npm run typecheck` | Clean. | — |

---

## What "done" means

Parts A–G pass, and then the thing that actually matters: **run the setup for both demo acts twice in a row, with a `POST /demo/reset` in between**, entirely from these two screens with no manual API calls (SC-007). A rehearsal that needs a curl command to get to the order screen is not passing, however green the table above is.
