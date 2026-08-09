# Phase 0 — Research: Order Detail

**Feature**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md)

Seventeen decisions. R3, R5, R9, R11 and R14 are the ones a reviewer should push on;
the rest are recorded so they are not re-argued during implementation.

---

## R1 — The order endpoints do not exist yet, and we build against them anyway

**Decision**: Consume `GET /orders/:id`, `POST /orders/:id/accept`, and
`POST /orders/:id/complain` as documented in `docs/api-design.md` §3.4, with every
shape assumption confined to `src/api/types.ts` and `src/api/orders.ts`.

**Rationale**: Identical to UI-03's R1, and the reasoning has held. `api/specs/`
contains 001–003 (foundation, entities, chain adapter); the orders module is
unbuilt. But the order's *columns* are not guesswork — `api/specs/002-entities-migrations/data-model.md`
§5 fixes `state`, `price_minor`, `acceptance_criteria`, `review_window_seconds`,
`created_at`, `delivered_at`, `disputed_at`, `settled_at`, and §6 fixes the run's
`input` and `output`. The wire format is those columns in camelCase, which is what
the one documented request body (`{ agentId, input, acceptanceCriteria }`) already
uses.

**Alternatives considered**: Wait for the API. Rejected — it serialises two
workstreams that were specified to run in parallel, and the demo's most important
screen is the worst one to start late.

---

## R2 — What `GET /orders/:id` is assumed to return

**Decision**: One object carrying the order's own columns plus two things the screen
cannot work without and cannot get elsewhere: the **agent's name** and the **run's
input and output**. Timestamps are ISO-8601 strings.

**Rationale**: The alternative is three requests on a 1s poll to render one page.
The agent name is needed because the persistent header says what was bought (FR-003)
and the order row points at an `agent_version_id`, not a name the client can resolve.
The run is needed because output-beside-criteria is the whole feature. api-design
§3.4 already describes this route as "State, output, timings", so the assumption is
the documented one.

**Alternatives considered**: Also folding in the verdict. Rejected — the verdict is
its own documented route and its own feature (UI-05); modelling it here would create
two type definitions racing to describe the same resource, which is the mistake
`CreateOrderResponse` deliberately avoided in UI-03.

---

## R3 — The countdown is anchored to a server clock, degrading to the device clock

**Decision**: A module-level clock offset (`src/lib/serverClock.ts`) updated from the
`Date` response header on **every** API response. `serverNow()` returns
`Date.now() + skewMs`. When the header is unreadable the skew stays `0` and the
countdown falls back to the device clock, which is exactly today's behaviour.

**Rationale**: FR-017 exists because the countdown is the one number on screen the
audience is invited to trust, and it is computed entirely on the client from
`deliveredAt + reviewWindowSeconds`. A laptop whose clock is two minutes fast shows
a window that expired before delivery. Reading the header costs three lines in
`client.ts` and needs no new endpoint, no extra request, and no signature change —
the page already makes a request every second, so the offset is never stale.

**The gotcha, recorded because it will otherwise be debugged twice**: `Date` is not a
CORS-safelisted response header. Cross-origin (UI on :5173, API on :3000) it reads as
`null` unless the API sends `Access-Control-Expose-Headers: Date`. That request is in
the backend handoff ([contracts §7](./contracts/internal-api.md)). Until it lands the
fallback is in force and nothing looks broken — which is the property that makes this
worth doing at all.

**Alternatives considered**: A dedicated `/time` endpoint (a new backend route for a
number every response already carries). Trusting `Date.now()` outright (leaves FR-017
unmet for free). Deriving skew from `deliveredAt` versus local time (only works after
delivery, and confuses "the server's clock" with "when the agent finished").

---

## R4 — Terminal means `released` or `settled`, and the existing hook already enforces it

**Decision**: `isTerminalState(state)` returns true for `released` and `settled` only.
Everything else — including `failed` and `adjudicated` — keeps polling.
`usePolling`'s existing `isTerminal` predicate does the stopping.

**Rationale**: `failed` is not an ending: a complaint can still be filed from it, and
that transition has to appear on screen. `adjudicated` is a ruling whose settlement
has not completed, and the page's own concluded face says "settling" until `settled`
arrives. This matches `docs/ui-design.md` §5 exactly ("Stops when: state is terminal
(`released` / `settled`)") and the state machine in
`api/specs/002-entities-migrations/data-model.md` §5.

**Alternatives considered**: Treating `failed` as terminal. Rejected — it would freeze
the page at the moment the buyer is most likely to act.

---

## R5 — Polling continues while the page is hidden — **spec correction**

**Decision**: FR-012 is rewritten. Re-reading does **not** suspend when the document
is hidden. The countdown is still recomputed from the clock on return (FR-018 is
untouched).

**Rationale**: `src/lib/queryClient.ts` sets `refetchIntervalInBackground: true` with a
comment written for this exact feature: React Query pauses intervals whenever the
document is hidden, and on macOS a window that is merely **occluded** counts as
hidden. FR-012 as originally written would mean that a browser sitting behind a
terminal window during a rehearsal does not flip to `released` — the precise failure
Act 1 cannot survive. The existing decision is better than the requirement, so the
requirement moved.

Nothing is lost on the cost side: `refetchOnWindowFocus: false` means returning to
the tab produces no burst, and against a localhost API a 1s poll on a hidden tab is
free. Note this is also the only reason the spec's own edge case "the tab was asleep
across the whole review window" is a countdown problem and not a state problem — the
state kept arriving.

**Alternatives considered**: Honour FR-012 and reverse `refetchIntervalInBackground`.
Rejected: it trades a demonstrable stage failure for a saving that is zero on
localhost, and it would silently change the Wallet and My Orders polls too.

---

## R6 — The countdown recomputes from the clock; it never decrements a counter

**Decision**: `useCountdown(deadlineMs)` ticks on a 1s interval and, on each tick,
recomputes `deadlineMs - serverNow()`. It also recomputes on `visibilitychange`. It
clamps at zero and stops its interval there.

**Rationale**: A hook that stores `remaining` and subtracts 1000 each tick drifts
under timer throttling and is simply wrong after a suspended tab — it would resume
from where it stopped, which is what FR-018 forbids. Recomputing from an absolute
deadline makes suspension a non-event: the worst case is one second of staleness, and
the `visibilitychange` listener removes even that. The interval is also the only timer
this feature creates, and it is cleared on unmount (FR-013).

**Alternatives considered**: `requestAnimationFrame` (60× the work for a display that
changes once a second). No interval at all, relying on the 1s poll to re-render
(couples the visible clock to network health — the countdown would freeze during an
outage, which is the one moment it must not).

---

## R7 — Remaining time is formatted, not counted out in seconds

**Decision**: `src/lib/duration.ts` — `formatRemaining(ms)` → `4m 12s`, `1h 03m`,
`12s`, `0s`; `formatElapsed(ms)` → the same vocabulary for the running face.

**Rationale**: FR-021. The review window is seconds during the demo and 24 hours in
principle (`docs/product-workflow.md` §4.5), and one format has to read correctly at
both ends. Below a minute the seconds are the interesting part; above an hour they
are noise. Pure functions in `lib/` for the same reason `money.ts` is there — the
elapsed line and the countdown must not each invent their own wording.

---

## R8 — Output beside criteria is a CSS grid with an internally scrolling output

**Decision**: A two-column grid at the demo viewport, output left, criteria right,
each panel scrolling inside its own box with a bounded height. One media query
collapses to a stack below 900px.

**Rationale**: FR-022 is the feature's central visual claim and SC-003 measures it at
1280×800. The failure mode is not "no columns", it is "columns that stop being
side-by-side once the output is long" — hence the bounded height and internal scroll
rather than letting the output push the criteria off the fold (FR-024). The collapse
breakpoint exists because a stacked layout on a narrow window is better than two
unreadable columns; it is explicitly below the demo viewport so it can never fire on
stage.

---

## R9 — Output is rendered by shape: table, prose, or JSON

**Decision**: `OutputPanel` inspects the value. An array of flat objects renders as a
table. A string renders as pre-wrapped prose. Anything else renders as indented JSON
in a `<pre>`.

**Rationale**: Act 2's argument is that the audience counts rows and reaches 50%
before Guardian says it (`docs/product-workflow.md` §5.3 — five line items, three
returned). Counting rows in a JSON blob is possible; counting them in a table is
instant, and the difference is about thirty lines of code in the one component the
demo's centrepiece depends on. The prose branch serves TLDR Agent, whose output is a
summary. The JSON branch is the honest fallback and guarantees no seller's output
shape can produce a blank panel.

**Alternatives considered**: Render `outputSchema` and lay out the output against it.
Rejected — the schema is not on the order payload, it would need a second request per
poll, and the three demo agents' outputs are already covered by shape inspection.

---

## R10 — Faces are chosen by state, and the choice cannot go backwards

**Decision**: `faceFor(state)` maps the eight states onto five faces. A `stateRank`
map gives each state a position in the lifecycle, and the page keeps the
highest-ranked order it has seen; a response that ranks lower is ignored for
rendering.

**Rationale**: FR-015. Sequential polling makes an out-of-order response unlikely
rather than impossible, and the visible failure — a page that has shown a verdict
dropping back to "the agent is working" — is the kind of thing that ends a demo's
credibility in one frame. Ten lines and a `useRef`. The ranking is also the honest
place to record that `released` and `disputed` are alternative exits from `delivered`
rather than successive states.

---

## R11 — An action that gets no answer is recovered by the poll, not by a retry rule

**Decision**: Accept and Complain both surface connectivity failures as "we did not
hear back — this page will update on its own if it went through", with no retry
button and no navigation away. Refusals (`kind === 'http'`) show the reason and
re-read the order.

**Rationale**: This is deliberately *not* UI-03's R12 rule, and the difference is
worth stating because copying that rule here would be cargo-culting. `POST /orders`
was dangerous on silence because it debits a ledger and there was no screen watching
the result. These two calls are state transitions on an order this page is already
re-reading every second: if the complaint landed, the state becomes `disputed` within
a second and the interface corrects itself with no user action. Duplicate submission
is also harmless in a way a duplicate purchase is not — the second call meets an order
that has already moved and is refused. So the poll is the reconciliation mechanism,
and the correct behaviour on silence is to say so and wait.

**Alternatives considered**: Offer a retry (unnecessary — the poll already recovers,
and a retry button invites clicking during the second where the state has not yet
flipped). Reuse UI-03's "check your orders" copy (nonsense here: the buyer is
standing on the order).

---

## R12 — "The order moved on" is detected by re-reading, not by parsing error codes

**Decision**: On any action refusal the page invalidates `['order', id]` and lets the
refetched state pick the face. The error copy is chosen from the *new* state, not from
the backend's error code.

**Rationale**: UI-03's R11 established that this app keys failure states on HTTP
status rather than on error codes the backend has not committed to, and the orders
module is even less specified than the catalogue was. But there is a better source
here than either: the order itself. If Accept is refused and the order comes back
`released`, the correct message is "the window closed first — it released, and the
seller has been paid", which is US3 AS6's requirement and reads as an outcome rather
than an error. Deriving that from a code string would mean guessing the string.

---

## R13 — Terminal transitions nudge `['me']`

**Decision**: When the polled order first reaches a terminal state, invalidate
`['me']` once.

**Rationale**: The header shows available balance and in-escrow (`BalanceWidget`),
polled every five seconds. A release or a settlement moves both. Five seconds is a
long pause on stage between "the page flipped" and "the money figures moved"; one
invalidation makes them move together. It is three lines in an effect keyed on the
terminal transition — not on every poll, which would defeat the shell's cadence.

---

## R14 — The escrow figure in the header already exists — **scope correction**

**Decision**: FR-038 is satisfied by the header's existing "In escrow" figure from
`GET /me`. The frontend does **not** read `totalEscrowed` from the escrow contract.

**Rationale**: The spec inherited "sourced from the escrow contract's own total" from
`docs/ui-design.md` §6, but `ui/docs/CONTEXT.md` §2 states the frontend never calls
the escrow contract — every chain interaction goes through the operator. A browser
`readContract` here would be the first violation of that rule, in service of an
explicitly optional nicety. The per-account figure is also the *better* number for the
demo: it is the buyer's own money, it is already on screen on every page, and R13
makes it move at the moment the page flips.

**Alternatives considered**: Ask the API for a `totalEscrowed` field on `GET /me`.
Rejected as scope creep into a backend that has not built the orders module yet.

---

## R15 — `usePolling` gains one optional predicate; nothing else shared changes

**Decision**: Add an optional `isFatalError?: (error: ApiError) => boolean` to
`usePolling`. Order Detail passes one that matches 404 and 403.

**Rationale**: The hook's existing error branch deliberately keeps polling, which is
right for a transient blip and wrong for an order that does not exist — a mistyped URL
would otherwise issue a request every second for as long as the tab is open, which is
the exact behaviour FR-010 and SC-005 exist to prevent. The addition is optional and
defaulted, so the three existing callers are unaffected, and it belongs in the hook
because the hook owns the schedule; simulating it with `enabled` at the call site
means every future caller re-derives it.

**Alternatives considered**: A local `enabled` flag driven by an error state
(works, and puts schedule logic in a page). Leave it (a visible defect against a
stated success criterion).

---

## R16 — The complaint modal is a native `<dialog>`

**Decision**: `<dialog>` with `showModal()`. No modal library, no portal, no focus-trap
dependency.

**Rationale**: Focus trapping, Esc-to-dismiss, inertness of the page behind, and the
`::backdrop` all come free and correct; the alternative is a div plus roughly a
hundred lines of focus management that will be worse. Baseline in every browser this
demo runs on. Note the distinction from a `window.confirm()`, which is forbidden
here for the ordinary reason that it is ugly and cannot carry the finality copy
FR-027 requires.

---

## R17 — No new dependencies, no new configuration

**Decision**: Nothing is added to `package.json`, `.env.example`, or the query client
defaults.

**Rationale**: Everything this feature needs is already present: `usePolling` for the
schedule, `useMutation` for the two actions, `paths` for navigation, `LoadState` for
the non-content states, `formatUsd` for money, `ApiError`/`isConnectivityError` for
failure branching. The only shared-file edits are the three lines in `client.ts`
(R3) and the optional predicate in `usePolling` (R15), both additive.
