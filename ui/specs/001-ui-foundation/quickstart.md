# Quickstart & Manual Validation: UI Foundation

**Feature**: `001-ui-foundation` · **Date**: 2026-08-08

This component has **no automated tests** by explicit project decision (`ui/docs/CONTEXT.md`). Everything below is verified by hand — this document is the acceptance run, and it is the closest thing this feature has to a test suite.

Budget about 15 minutes for a full pass.

---

## Prerequisites

- Node ≥ 22.12 (24 LTS recommended; a 26.x dev machine is fine)
- Docker, for Part E only
- The Guardian API running on `http://localhost:3000` for Parts B and D. Parts A, C, and E need no backend.

## Setup

```bash
cd ui
npm install
cp .env.example .env.local     # then set VITE_API_URL=http://localhost:3000
npm run dev                    # → http://localhost:5173
```

Keep the browser devtools **Console** and **Network** panels open throughout; several criteria are observations in those panels rather than things visible on the page.

---

## Part A — Routing (User Story 1, no backend needed)

Visit each address and confirm a placeholder naming the screen renders.

| # | Visit | Expect |
| --- | --- | --- |
| A1 | `/` | "Connect" placeholder |
| A2 | `/agents` | "Marketplace" placeholder |
| A3 | `/agents/abc-123` | "Agent Detail" placeholder **showing `abc-123`** |
| A4 | `/orders` | "My Orders" placeholder |
| A5 | `/orders/xyz-789` | "Order Detail" placeholder **showing `xyz-789`** |
| A6 | `/wallet` | "Wallet" placeholder |
| A7 | `/sell` | "My Agents" placeholder |
| A8 | `/sell/new` | "Create Agent" placeholder |
| A9 | `/nonsense` | "Not found" placeholder **with a link back to `/`** — not a blank page |

**A10** — From `/sell/new`, use the browser Back button twice, then Forward once. Screens change with **no full page reload** (the Network panel shows no new document request).

**A11** — The header stays mounted across every navigation above.

✅ **Passes SC-001** if all nine addresses render and the Console shows **zero** errors across the whole pass.

---

## Part B — Backend client (User Story 2, backend required)

**B1 — Reachability.** With the API up, trigger the health check (the entry screen shows its result, or call it from the Console). Expect success.
→ **SC-002**

**B2 — Backend down.** Stop the API. Re-trigger. Expect a rendered error message identifying a *connectivity* failure, and **no unhandled rejection** in the Console.
→ **SC-003**

**B3 — Missing configuration.** Stop the dev server, comment out `VITE_API_URL` in `.env.local`, restart. The app must fail immediately with an error **naming the variable** — not silently issue requests against `localhost:5173`. Restore afterwards.
→ FR-006

**B4 — Credential attached.** In the Console, `localStorage.setItem('guardian.jwt', 'test-token')`, reload, and trigger any backend call. The Network panel shows `Authorization: Bearer test-token`.
→ FR-008

**B5 — Credential absent.** `localStorage.removeItem('guardian.jwt')`, reload, trigger a call. The request is **sent** without an `Authorization` header — it does not fail locally.
→ FR-008

**B6 — Rejection clears the session.** With a deliberately invalid token set, trigger a call against an authenticated endpoint. Expect: the stored token is cleared, and the app returns to `/`. Critically, watch the Network panel for **10 seconds afterwards** — there must be no retry loop.
→ FR-011

**B7 — Malformed response.** Point `VITE_API_URL` at something that answers HTTP but not JSON (`python3 -m http.server 3001` works). Expect the normalised error, not a parsing exception reaching the screen.
→ FR-010

---

## Part C — Polling (User Story 3)

**Use the built-in harness at `/__poll-test`.** It is DEV-only (absent from production builds) and drives `usePolling` at a 1 s interval against a fetcher that reports a terminal state after four reads, with a button to unmount the poller. It exists because this is the one piece of shared machinery three later features inherit, and its failure modes surface on stage rather than at the desk. It expects a backend exposing `/stub/order?after=4&key=…`; against the real API, point it at an order instead.

Watch the **Network** panel — that is where the criteria live.

> **Expect roughly double the configured interval while the browser window is hidden or occluded.** Chrome clamps background timers: a 1 s poll measures ~2 s, a 5 s poll ~6 s. That is the throttling the edge case below anticipates, not a defect. Bring the window fully to the front before judging cadence.

**C1 — Cadence.** A 1000 ms poll fetches immediately, then roughly once per second.
→ FR-015

**C2 — Stops on terminal.** When the fetched data satisfies the finishing rule, requests stop within one interval. **Watch for two full minutes: zero further requests.**
→ **SC-004**, FR-016

**C3 — Terminal on first fetch.** Point the poll at data that is already finished. Exactly **one** request is ever made.
→ FR-016

**C4 — Unmount.** While a 1 s poll is running, navigate away. Wait one minute. **Zero further requests** attributable to that screen, and no "state update on unmounted component" warning in the Console.
→ **SC-005**, FR-017

**C5 — No overlap.** Throttle the Network panel to "Slow 3G" so responses exceed the interval. Requests must **queue, not overlap** — never two in flight at once.
→ FR-018

**C6 — Failure doesn't stop it.** Stop the API mid-poll. The screen surfaces the failure and **keeps trying**; restart the API and it recovers on the next tick without a reload.
→ FR-019

**C7 — Backgrounded tab.** Switch to another tab for two minutes, then return. The poll keeps running while hidden (at a browser-throttled cadence), resumes its normal cadence on return, and does **not** fire a burst of queued requests.
→ Edge case; see research R4 on `refetchIntervalInBackground`

**C8 — Timer accumulation.** Navigate through all eight screens twice. Console: `console.log(setTimeout(()=>{},0))` — the handle ID should be in the same range as a fresh page load, not climbing steeply.
→ **SC-006**

---

## Part D — Header widget (User Story 4, backend required)

**D1** — Signed in: the header shows **two distinctly labelled figures** — available balance and in escrow. Confirm on all eight screens.
→ **SC-007**, FR-021

**D2** — There is **no single combined number** anywhere in the header. This one matters more than it looks: a merged figure is wrong in both directions and makes the ledger read as broken.

**D3** — Activating the widget navigates to `/wallet`.
→ FR-022

**D4** — Change the balance on the backend. The header updates within ~5 s **with no reload**.
→ FR-023

**D5** — Signed out: a sign-in affordance, **no amounts**, and no polling requests to `/me` in the Network panel.
→ FR-024

**D6** — API stopped: the widget degrades to a neutral placeholder and **the rest of the screen still works**.
→ FR-024

---

## Part E — Container (User Story 5)

```bash
cd ui
docker compose up --build
```

**E1** — `http://localhost:5173` serves the entry screen.
→ **SC-008**

**E2** — The app inside the container reaches the API at the compose-configured address. (If the API runs on the host rather than in a compose network, `VITE_API_URL` needs `host.docker.internal:3000` — a known gotcha, not a defect.)
→ FR-027

**E3 — The bundle guardrail.** This is the one check with a security consequence:

```bash
npm run build
grep -ri "PRIVATE_KEY\|MNEMONIC\|SECRET" dist/ || echo "clean"
```

Expect `clean`. Then confirm the positive case — `grep -r "VITE_API_URL\|localhost:3000" dist/` **does** hit, proving the search would have found something.
→ **SC-009**, FR-026

---

## Sign-off

| Story | Parts | Criteria |
| --- | --- | --- |
| US1 — Routing | A | SC-001 |
| US2 — Backend client | B | SC-002, SC-003 |
| US3 — Polling | C | SC-004, SC-005, SC-006 |
| US4 — Header widget | D | SC-007 |
| US5 — Container | E | SC-008, SC-009 |

SC-010 ("a new endpoint costs one file, no hand-written error handling") is judged at the start of UI-02 rather than here — it is a claim about the next feature's experience, and UI-02 is its first honest test.

**Re-run Parts A and C after every later UI feature.** They are cheap, and route regressions and leaked intervals are exactly the failures that surface on stage rather than at the desk.
