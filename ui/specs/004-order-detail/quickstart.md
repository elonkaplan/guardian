# Quickstart & Manual Validation: Order Detail

**Feature**: 004-order-detail · **Date**: 2026-08-08

This component has no automated tests by explicit project decision (`ui/docs/CONTEXT.md`). Everything below is run by hand, in a browser, and **is** the acceptance criteria. Work through it in order; each part maps to one user story.

This is the demo's screen, so treat Parts D and E as a rehearsal rather than a test — run them twice, and treat a failure the way you would treat a red build.

---

## Prerequisites

- The frontend from UI-03, running (`npm run dev`, default `http://localhost:5173`), with sign-in and buying working.
- **The Guardian API with the orders module built** — `GET /orders/:id`, `POST /orders/:id/accept`, `POST /orders/:id/complain`. Parts B onward need it. Part A is offline and worth running first regardless.
- **`SWEEPER_INTERVAL_MS` at its demo value (3s) and the review window turned down to seconds.** Part D is unrunnable against a 24-hour window. If the sweeper is not running, orders will sit at `delivered` forever and D4 will fail for a reason that has nothing to do with this feature — check the API logs before debugging the page.
- Seeded agents (`POST /demo/seed`). **LedgerBot** matters most: its output is a list of line items, which is what Part C's table branch and Act 2 both depend on.
- A funded account. `POST /demo/reset` between rehearsals.

## Setup

```bash
cd ui
npm run typecheck    # must be clean before you start clicking
npm run dev
```

No `npm install` step: this feature adds no dependencies. If `npm install` appears in the diff, something went wrong (research R17).

Keep the **network panel open** for the whole run. Half of this feature's requirements are about requests that should or should not be happening, and they are invisible otherwise.

---

## Part A — Offline and boundary behaviour (no backend needed for A1–A2)

| # | Do | Expect | Covers |
| --- | --- | --- | --- |
| A1 | With the API stopped, load `/orders/<any-uuid>`. | An error state naming the problem, with a retry that does not reload the page. No white screen, no unhandled rejection. | FR-014, SC-007 |
| A2 | Activate retry. | One new request per activation. The page does not reload and the session survives. | SC-007 |
| A3 | With the API running, load `/orders/00000000-0000-0000-0000-000000000000`. | A not-found state with a route back to your orders. | FR-034 |
| A4 | Watch the network panel for 30s on A3. | **Zero repeated requests.** A 404 must stop the schedule, not poll once a second forever. | FR-010, SC-005 |
| A5 | Sign out, then load an order URL directly. | Redirected to connect. Sign in; you land back on **that order**, not on a generic page. | FR-035 |
| A6 | Open an order belonging to a different account. | Not-found or not-authorised, no polling. | FR-034 |

---

## Part B — The working face (User Story 1)

Buy from any agent and stay on the screen you land on.

| # | Do | Expect | Covers |
| --- | --- | --- | --- |
| B1 | Watch the page immediately after purchase. | "The agent is working", the input you submitted, and an elapsed time that advances without you touching anything. | FR-004 |
| B2 | Watch the network panel. | One `GET /orders/:id` roughly every second. No overlapping requests, no bursts. | FR-009 |
| B3 | Wait for delivery. | The page shows the output on its own. No refresh, no click. | FR-009, SC-001 |
| B4 | Reload mid-flight, before delivery. | The working face renders immediately. **No flash** of a different face first. | FR-001 |
| B5 | Check the persistent band across B1→B3. | Agent name, price, and a state chip stay in place as the face changes underneath. | FR-003 |
| B6 | Kill the API while an order is running, wait ~10s, restart it. | The last known state stays on screen with a quiet "not updating" indicator — not an error page, not a blank. Request rate does **not** increase. Recovery is automatic. | FR-014 |

---

## Part C — Output beside criteria (User Story 3)

Use **LedgerBot** on a receipt with several line items. Set the browser to roughly **1280×800** — SC-003 is measured there.

| # | Do | Expect | Covers |
| --- | --- | --- | --- |
| C1 | Look at the delivered face without scrolling. | Output and acceptance criteria **side by side**, both readable at once. A vertical stack is a failure, not a layout preference. | FR-022, SC-003 |
| C2 | Read the criteria panel. | Your words, verbatim, labelled as fixed since purchase. Not paraphrased, not truncated. | FR-023 |
| C3 | Count the line items in the output. | Rendered as a table — countable at a glance. This is Act 2's entire mechanic. | FR-024 |
| C4 | Buy from **TLDR Agent** and look at its output. | Prose, wrapped and readable — not a JSON blob with escaped newlines. | FR-024 |
| C5 | Deliver an output with a long body (a large receipt). | The output panel scrolls **inside itself**; the criteria beside it stay in view and the page does not grow a second scrollbar of its own. | FR-024 |
| C6 | Search the rendered page and the network response for `systemPrompt`, `model`, or `steps`. | Absent from both. If the API is sending them, that is an API bug — report it rather than filtering client-side. | FR-008 |

---

## Part D — The countdown and unattended release (User Story 2) — **Act 1**

The single most important part of this document. Review window at a handful of seconds.

| # | Do | Expect | Covers |
| --- | --- | --- | --- |
| D1 | On the delivered face, watch the countdown. | Decrements at least once per second, in readable units (`0m 24s`, not `24000`). | FR-016, FR-021 |
| D2 | **Put your hands on the desk.** Let it run to zero. | The countdown stops at zero — no negative numbers, no freeze on a stale value — and says release is being processed. | FR-019 |
| D3 | Keep watching. | The page moves to the concluded face **on its own**, within about 5 seconds of zero, saying the seller has been paid. Nobody clicked anything. | FR-009, SC-002 |
| D4 | Watch the network panel across D3. | Requests stop within one interval of `released` and **do not resume** while the tab stays open. Leave it five minutes and confirm zero further requests. | FR-010, SC-005 |
| D5 | Watch the header during D3. | The in-escrow figure moves as the order settles — it should not lag by five seconds. | FR-038 |
| D6 | Repeat, but cover the browser with another window (or switch tabs) from D2 until well after zero. | On return: the page is already on the concluded face. It flipped while hidden. **This is why `refetchIntervalInBackground` is true** (research R5) — if it did not flip, that setting has been reverted. | FR-012 |
| D7 | Repeat, and put the laptop to sleep across the window. On waking, look before the next poll lands. | The countdown reads zero or expired — never a resumed value counting down from where it stopped. | FR-018 |
| D8 | Open a delivered order whose window has **already** elapsed. | Renders as expired with no live countdown, and offers no actions. | FR-020 |
| D9 | Set the OS clock forward two minutes and reload a delivered order. | The countdown is still correct. If it is wildly wrong, check for `Access-Control-Expose-Headers: Date` on the API — without it the fallback is in force (research R3). This is a *should*, not a blocker. | FR-017 |

---

## Part E — Accept and complain (User Stories 3 and 4) — **Act 2**

| # | Do | Expect | Covers |
| --- | --- | --- | --- |
| E1 | On a delivered order, press Accept. | The page moves to the concluded face, the countdown disappears, both actions are gone. | FR-026 |
| E2 | On a fresh delivered order, press Accept repeatedly and fast. | **Exactly one** order accepted. The button reports that it is working. Verify against your orders list. | FR-030, SC-006 |
| E3 | On a fresh delivered order, press Complain. | A modal asking for a reason, stating plainly that filing is final and cannot be withdrawn. | FR-027 |
| E4 | Try to confirm with an empty reason. | Blocked. Nothing is submitted. | FR-027 |
| E5 | Cancel the modal (button, and again with Esc). | Nothing submitted, order unchanged, countdown still running underneath. | FR-028 |
| E6 | Enter a reason and confirm. | The modal closes; the page moves to the arbitration face — "Guardian is reviewing" — with no actions offered. Within 2 seconds. | FR-029, SC-004 |
| E7 | Wait on the arbitration face. | It moves to the concluded face on its own when the verdict lands. No refresh. | FR-006, SC-004 |
| E8 | Look at the concluded face. | A clearly reserved, labelled verdict region — not a blank gap, and not a rendered verdict card (that is UI-05). The input, criteria, and output are still on the page. | FR-007, FR-036 |
| E9 | Let a countdown reach ~1s, then complain. | Whatever the backend accepts wins. The page reconciles to the state the backend reports — released **or** disputed — and explains which. It must not sit showing a state the backend disagrees with. | FR-031 |
| E10 | Complain, then (on a delivered order) let the window expire before confirming, then confirm. | The refusal is explained as "the window closed and it released", not as a raw error code. Typed reason preserved until dismissal. | FR-031, FR-032 |
| E11 | Throttle the network to offline, press Accept, then restore. | "We did not hear back — this page will update on its own if it went through." **No retry button.** The poll then corrects the page by itself. | FR-032 |

---

## Part F — Nothing came back (User Story 5)

Force a `failed` order — stop the execution worker, or use an agent configured to error.

| # | Do | Expect | Covers |
| --- | --- | --- | --- |
| F1 | Open the failed order. | "The agent returned nothing", in plain language. Not an empty output panel, not a spinner. | FR-005 |
| F2 | Look at the actions. | Complain offered; Accept **not** offered. | FR-025 |
| F3 | Look for a countdown. | None — there was no delivery to run a window from. | FR-005 |
| F4 | Watch the network panel. | Still polling. `failed` is not terminal: the complaint transition has to appear. | FR-011 |
| F5 | Complain from here. | Same reason-and-confirm path; the page moves to arbitration. | FR-029 |

---

## Part G — Boundaries (the checks that are not clicking)

Thirty seconds of grep, standing in for the structural rules no gate enforces.

| # | Check | Command | Why |
| --- | --- | --- | --- |
| G1 | No wallet signature or chain call in this feature. | `grep -rn "useSignMessage\|writeContract\|readContract\|useAccount" src/pages/OrderDetailPage.tsx src/components/Order* src/components/Complain* src/hooks/useOrder.ts` | FR-033, and `CONTEXT.md` §2 — the frontend never touches the escrow contract. Expect zero hits. |
| G2 | No route to render seller IP. | `grep -rn "systemPrompt\|steps\|model" src/api/types.ts` | FR-008. Expect zero hits in the order types. |
| G3 | No new dependencies. | `git diff --stat package.json package-lock.json` | Research R17. Expect no change. |
| G4 | Query defaults untouched. | `git diff src/lib/queryClient.ts` | Research R5 depends on `refetchIntervalInBackground: true`. Expect no change. |
| G5 | One poll interval, defined once. | `grep -rn "1000\|intervalMs" src/hooks/useOrder.ts src/pages/OrderDetailPage.tsx` | The cadence should appear once, in `useOrder`. |
| G6 | One timer in the whole app. | `grep -rn "setInterval\|setTimeout" src/components src/pages src/hooks src/lib` | FR-013. Expect exactly one `setInterval`, in `src/hooks/useNow.ts` — the shared clock both the elapsed line and the countdown read. Every other hit must be a comment. |
| G7 | Types clean. | `npm run typecheck` | `faceFor` must be exhaustive over `OrderState`. |

---

## What "done" means

Parts A–G pass, and then the part that actually matters:

**Run Acts 1 and 2 end to end, twice, from `POST /demo/reset`, without touching anything outside the browser.** Act 1 is Part D2–D4 with your hands off the keyboard. Act 2 is Part C1 followed by Part E3–E8. If either needs a refresh, a retry, or an explanation to the room, this feature is not finished regardless of what the tables above say (SC-009).
