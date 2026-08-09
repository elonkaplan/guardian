# Phase 1 — Quickstart: Seller pages

**Feature**: `007-seller-pages` · **Date**: 2026-08-09

**This is the test suite.** There are no automated tests in this component by decision (`ui/docs/CONTEXT.md`, FR-043), so acceptance is this document run by hand. Parts A and F need no backend. Parts B–E need the four new endpoints in [contracts/internal-api.md §11](./contracts/internal-api.md), and Part E additionally needs the order read, case file, and verdict authorised for the seller — api-design §3.4 requires it, and Part E is where a buyer-only implementation of it surfaces.

---

## Prerequisites

```bash
cd ui && npm install && npm run dev          # http://localhost:5173
cd api && npm run start:dev                  # http://localhost:3000
```

Sign in with a wallet, then open `/sell`.

```bash
npm run typecheck      # must be clean before any part below counts
npm run build
```

**There is no `npm run lint` in this component** — no script, no config, no ESLint dependency. Earlier specs in this series ask for one; it errors. `tsc --noEmit` under `strict` and `noUncheckedIndexedAccess` is the whole of the static gate, which is part of why Part F's greps exist.

---

## Part A — The create form, with no backend at all

Everything here is `lib/agentDraft.ts` and `parseUsd`. Nothing is submitted successfully; a failing `POST /agents` is fine and expected until the endpoint exists.

### A.1 The two contract fields (FR-015, FR-016, FR-017)

| # | Put in the input schema box | Expect on submit |
| --- | --- | --- |
| A1 | `{ "type": "object", "properties": { "receiptText": { "type": "string" } } }` | accepted |
| A2 | `{ "type": "object", }` (trailing comma) | **refused**, naming the *input* contract specifically |
| A3 | `[1, 2, 3]` | refused — a contract has to be an object |
| A4 | `"hello"` | refused, same reason |
| A5 | `{}` | **accepted.** Well-formed and an object; this form does not judge whether it is a *useful* schema (R12) |
| A6 | *(empty)* | refused |
| A7 | Break the **output** box instead, leave the input valid | The message names the *output* contract. If both messages say the same thing, the subject parameter is not wired |

**A8** — no schema builder anywhere: both fields are plain textareas, with no field-adder, type picker, or structured editor (FR-015).

### A.2 The price (FR-018, R14)

| # | Type | Expect |
| --- | --- | --- |
| A9 | `2` / `2.50` / `$1,234.50` | accepted |
| A10 | `0`, `-5`, `abc`, `1.999` | refused, same wording as the wallet's amount field |
| A11 | `50000` | refused — and the message is about **a price**, not about the demo treasury. A sentence about the treasury here means `ceilingMessage` was not passed |

### A.3 Terms (FR-012, FR-013, FR-014)

| # | Do | Expect |
| --- | --- | --- |
| A12 | Read the two hints before typing anything | Both are visible without opening or scrolling to them, and both say these are contract terms quoted in verdicts (SC-003) |
| A13 | Add three capabilities, remove the middle one | The other two survive intact and in order |
| A14 | Leave one row blank among three filled ones, submit | The blank is dropped; three rows become two terms. Not an error |
| A15 | Leave *all* capability rows blank, submit | Allowed — the form does not invent contract terms, and the hint already said what that costs |
| A16 | Type a term containing a comma | Stays one term. A comma is not a separator |

### A.4 Refusals and submission (FR-019, FR-020, FR-022)

| # | Do | Expect |
| --- | --- | --- |
| A17 | Submit an empty form | **Every** missing field is named at once, not one per attempt |
| A18 | Clear the name only, submit | Name named; nothing else complains |
| A19 | Clear the system prompt, submit | Refused (FR-019) |
| A20 | Fill everything, then double-click submit fast | **One** request in the network tab, not two (SC-012). The guard is a ref; `disabled` alone does not catch same-frame clicks |
| A21 | Submit with the API stopped, wait for the timeout | Locked with a *do not submit again* message pointing at `/sell` — **no retry button** (R10) |
| A22 | Submit against an API that 4xxs | The reason in place, every value still in the form, submit re-enabled |

**A23** — the model field: it is pre-filled with `claude-haiku-4-5`, the dropdown offers `claude-sonnet-5`, and a hand-typed third value is accepted (R15).

---

## Part B — List an agent, and find it in the marketplace (US1)

| # | Do | Expect |
| --- | --- | --- |
| B1 | Complete the form and submit | Lands on `/sell` with the new agent in the list (FR-021) |
| B2 | Open `/agents` | The new agent is there beside the seeded three (SC-001) |
| B3 | Open its detail page | Name, description, price, capabilities, and exclusions all render |
| B4 | Buy it through the ordinary flow | Purchase completes with no manual data fix in between (SC-002) |
| B5 | Read the detail page carefully | No system prompt, no model, nowhere (SC-010) |

---

## Part C — My agents and my sales (US2)

| # | Do | Expect |
| --- | --- | --- |
| C1 | Open `/sell` signed in | Two sections: your agents, your sales |
| C2 | Each agent row | Name, price, and whether it is available (FR-002) |
| C3 | An account with no agents | "You have not listed an agent yet" plus the way to list one — not a blank region (FR-007) |
| C4 | An account with no sales | Its own sentence, in the other section, independently (FR-007) |
| C5 | Stop the API, reload | Both sections report their own failure with a retry |
| C6 | Break **only** `/sales` (e.g. 500 it) | The sales section errors; the agents list renders normally. And the reverse (FR-007) |
| C7 | Buy one of your own agents in a second tab | The sale appears within ~6s with nobody touching this tab (SC-009) |
| C8 | Network tab, 30s | Exactly two requests per 5s — one `/agents?owner=me`, one `/sales`. Four means something polls twice (R6, R7) |
| C9 | The "list an agent" control | Reachable without scrolling past either list (FR-008) |
| C10 | A list of 20+ rows | Each section scrolls in its own region; the other stays reachable (FR-010) |
| C11 | Read the whole page | No system prompt or model for any agent (FR-037) |

---

## Part D — Availability (US4)

| # | Do | Expect |
| --- | --- | --- |
| D1 | Switch an agent off | The row shows it working, then settles on **unavailable** (FR-025) |
| D2 | Open `/agents` | It is gone from the public catalogue (SC-008) |
| D3 | Switch it back on, check `/agents` again | It has returned |
| D4 | Watch the switch closely during D1 | It never shows the attempted state before the server confirms. No flicker to the new value and back (R8, FR-027) |
| D5 | Make the `PATCH` fail | The reason appears beside the row and the switch shows the agent's **true** availability (FR-027) |
| D6 | Double-click the switch | One request, not two (SC-012) |
| D7 | Toggle one row in a list of several | No other row changes, and neither list re-renders from scratch (FR-028) |
| D8 | Switch an agent off, then reload `/sell` | It is still listed, marked unavailable — **not** filtered out. If it vanished, `GET /agents?owner=me` is filtering to active agents against api-design §3.3, and the agent can never be switched back on |

---

## Part E — The seller's side of a dispute (US3)

Needs a sale in `disputed`, then `adjudicated`, then `settled`. The demo's Act 2 produces all three.

| # | Do | Expect |
| --- | --- | --- |
| E1 | A disputed sale in the list | Visibly distinguished from an ordinary one, and it opens (FR-005) |
| E2 | Open it | Buyer's input, buyer's criteria, the pinned capabilities and exclusions, the output, the steps (FR-029) |
| E3 | Read the case-file wording | It says **the buyer's** input and criteria — never "your input" (R2). Buyer-perspective copy here means `perspective` is unwired |
| E4 | With a verdict present | Tier, reasoning, citations as a ✓/✗ checklist, and the split (FR-030, FR-031) |
| E5 | Read the split labels | "The buyer gets back" and "**You keep**" — not "You get back" |
| E6 | Read the citation origins | A buyer's criterion reads "The buyer's criterion". "Promised capability" and "Declared exclusion" are unchanged |
| E7 | Look everywhere for a way to respond | There is none — not disabled, not in a menu, not at the bottom (FR-032, SC-004) |
| E8 | Read beneath the verdict | Notified, verdicts are final, no reply from either side (FR-033, SC-006) |
| E9 | Open a sale that is `disputed` but not ruled | Case file open; a line saying the ruling has not been made; **no** empty verdict card |
| E10 | Leave E9 open through adjudication | The verdict appears on its own, in place, no reload (FR-034) |
| E11 | Break the case file only | Reported in the panel with a retry; the verdict card still renders (FR-035) |
| E12 | Break the verdict only | Reported in the card with a retry; the case file still renders (FR-035) |
| E13 | Open a sale that was never disputed | The sale, and a sentence saying there is no dispute — not an error, not an empty case file (FR-036) |
| E14 | Open `/sell/sales/<an-order-against-someone-else's-agent>` | "No such sale", with a link back to `/sell`. A 403 and a bad id are the same dead end, and the poll has **stopped** — confirm in the network tab |
| E15 | Paste `/sell/sales/:id` into a fresh tab | Loads cold and renders — deep-linking works (R7) |
| E16 | Network tab on a **live** dispute | `/orders/:id` every 1s, not 5s — the seller follows a moving order at the cadence `docs/ui-design.md` §5 specifies (R7) |
| E17 | Network tab on a **settled** sale, 30s | All three reads have stopped: the order is terminal, the verdict has its hash, the case file was fetched once |
| E18 | Break the order read mid-dispute, leave the screen open | A quiet "updates are not getting through" over a screen that still reads correctly — the verdict is **not** blanked (`useOrder`'s `stale`) |
| E19 | Read the whole screen | No system prompt — even though this case file is the seller's own (FR-037, SC-010) |

---

## Part F — Boundary sweep

Run from `ui/`. Each prints nothing unless noted.

```bash
# F1  No reply affordance anywhere in the feature (FR-032, SC-004).
#     The only permitted hits are inside the sentence that explains the absence.
grep -rniE "reply|appeal|respond|contest|comment" \
  src/pages/SellerSalePage.tsx src/pages/MyAgentsPage.tsx src/components/SalesList.tsx

# F2  Nothing in this feature can render an execution spec (FR-037, R17)
grep -rn "systemPrompt\|system_prompt" src/ | grep -v "api/types.ts"
#     The single permitted hit is CreateAgentRequest, which only travels outward.

# F3  The seller screen follows the order through the shared hook, not a hook of its own (R7).
#     This grep EXPECTS hits: one useOrder in SellerSalePage, and no useSale anywhere.
grep -rn "useOrder(" src/pages/SellerSalePage.tsx
grep -rn "useSale\b" src/            # expect nothing — the list-poll substitute was withdrawn

# F4  No version-history surface (FR-038)
grep -rn "versions" src/api/agents.ts src/pages/

# F5  Perspective is threaded, not defaulted
grep -rn "perspective" src/components/VerdictCard.tsx src/components/CaseFilePanel.tsx \
  src/components/CitationChecklist.tsx src/pages/OrderDetailPage.tsx src/pages/SellerSalePage.tsx
#     Expect: required prop in three components; literal 'buyer' at 4 call sites in
#     OrderDetailPage (VerdictCard ×2, CaseFilePanel ×2), literal 'seller' at 2 in
#     SellerSalePage. CitationChecklist receives VerdictCard's, never a literal.
#     A `= 'buyer'` default anywhere is the bug R2 is about.

# F6  Both placeholders are actually gone
grep -rn "PagePlaceholder" src/pages/MyAgentsPage.tsx src/pages/CreateAgentPage.tsx

# F7  No float arithmetic on money reached the price field
grep -rn "parseFloat\|valueAsNumber" src/pages/CreateAgentPage.tsx src/lib/agentDraft.ts

# F8  One envelope unwrap, four callers (R16)
grep -rn "function unwrapList\|function unwrapEntries" src/
#     Expect exactly one hit, in lib/listEnvelope.ts.

# F9  The money doctrine did not get copied onto the idempotent PATCH (R9)
grep -n "idempot" src/api/agents.ts
#     Expect both paragraphs: not-idempotent for POST, idempotent-by-construction for PATCH.

# F10 Exhaustiveness still holds: add a ninth OrderState locally, typecheck.
#     Expect errors in lib/orderState.ts — not a silently missing sales row. Revert.
```

**F11** — greyscale a screenshot of `/sell`: available and unavailable agents are distinguishable by word, not by colour alone; disputed sales likewise.

**F12** — greyscale the seller's dispute screen: every ✓/✗ is readable as a word, as UI-05 required.

---

## Part G — What done means

1. Parts A–F pass.
2. Someone who has never used the product lists a working agent through the form, unaided, in under 5 minutes, and finds it in the marketplace immediately afterwards (SC-001).
3. Ask that same person what capabilities and exclusions are for. They answer correctly from the form's own wording, without being told (SC-003).
4. Show a seller their dispute screen. Within 30 seconds, from the screen alone, they say which clause the ruling turned on and how the money split (SC-005) — and they know without asking that there is no appeal (SC-006).
5. Run Act 2 end to end twice with `/sell` open in a second window; the dispute appears there unattended both times (SC-009).
6. Every refusal path in Part A and every failure path in Parts C–E renders a stated reason and a way forward. None renders a blank region, a silent no-op, or an unhandled error (SC-011).
