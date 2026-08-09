# Feature Specification: Order Detail — the hero page

**Feature Branch**: `004-order-detail`

**Created**: 2026-08-08

**Status**: Draft

**Input**: User description: "docs/specs/UI-04-order-detail.md — One page, five faces, driven by the order's state: 'the agent is working' through to a settled verdict, without navigating away. Poll the order at 1s and stop on a terminal state; a countdown computed client-side from delivered_at + review_window_seconds; output shown beside the buyer's acceptance criteria; Accept and Complain actions, complaint via reason → confirm; optional total-escrow figure in the header. Out of scope: automated tests of any kind, the verdict card itself (UI-05), seller-side views (UI-07)."

## Overview

Everything else in this product is a way of getting someone to this screen. It is where a purchase stops being a receipt and becomes a thing that visibly happens: work runs, a result arrives, a clock runs down, money either releases or gets argued over. The buyer never navigates away while any of that occurs — the screen changes underneath them.

That "changes underneath them" is not a nicety. Two of the product's central claims are only credible if this screen moves on its own:

- **Escrow is really time-locked.** A countdown that runs to zero and is followed, with nobody touching the keyboard, by the page reporting that the money released is the difference between a claim and a demonstration. If the buyer has to refresh, the escrow looks like a database column.
- **A verdict is checkable, not asserted.** That only holds if the buyer — and, during a demo, the room — can read the delivered output *beside* the criteria written before any work happened. Side by side, a person reaches the verdict themselves. Stacked vertically, they are asked to take Guardian's word for it.

The screen has five faces and one identity. It is not five screens behind a router; it is one page that shows what is true right now, with the parts that survive across states (what was ordered, what the buyer asked for, what it cost) staying put while the working area changes. A buyer who opens the page mid-flight, or reloads it, or arrives after everything has finished, must land in the right face with no sense that they missed something.

The people served: the **buyer**, who wants to know whether they got what they paid for and what they can do about it; and the **demo operator**, for whom this page is both acts of the demo — the uncontested trade that settles itself, and the disputed one that splits.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Watch the work happen and the result arrive (Priority: P1)

A buyer lands here straight from purchase. The order is being worked on, and the page says so plainly, showing what they submitted and how long it has been going. When the agent finishes, the page shows the result without the buyer doing anything.

**Why this priority**: It is the spine of the page. Every other story is a face of this same live view, and none of them can be reached if the page cannot follow an order's state on its own.

**Independent Test**: Buy from a seeded agent, land on the order screen, and leave it alone. Confirm the working state names what was submitted and shows elapsed time advancing, and that the delivered result appears without any manual refresh.

**Acceptance Scenarios**:

1. **Given** an order that is purchased or running, **When** the screen renders, **Then** it states that the agent is working, shows the input the buyer submitted, and shows time elapsed since the order was created, advancing without interaction.
2. **Given** the screen is open on a live order, **When** the order's state changes at the backend, **Then** the screen reflects the new state within a couple of seconds and without a manual refresh.
3. **Given** an order that reaches delivered, **When** the screen updates, **Then** the agent's output is displayed in full and readable form, not truncated to a preview.
4. **Given** the screen is opened directly by URL on an order in any state, **When** it loads, **Then** it renders the face matching that state immediately, with no flash of an earlier state.
5. **Given** an order that belongs to a different buyer or does not exist, **When** the screen is opened, **Then** a not-found or not-authorised state is shown with a route back to the buyer's own orders, and no live updating is started.
6. **Given** the initial load of the order fails, **When** the screen renders, **Then** an error state explains the failure and offers a retry that does not require reloading the page.

---

### User Story 2 - The countdown runs out and the money releases on its own (Priority: P1)

The result has arrived and a review window is open. The buyer sees exactly how long they have to object, counting down in front of them. If they do nothing, the window closes, the escrow releases, and the page says so — with nobody having touched the keyboard.

**Why this priority**: This is the ending of the demo's first act and the single most persuasive thing on the screen. It is also the acceptance criterion the whole feature is measured by: an order watched from running to released without a manual refresh.

**Independent Test**: With the review window configured to a handful of seconds, let a delivered order sit untouched. Confirm the countdown decrements once per second, reaches zero, and the page moves to the released face on its own.

**Acceptance Scenarios**:

1. **Given** a delivered order, **When** the screen renders, **Then** a countdown to automatic release is displayed, derived from the delivery time and the order's own review-window duration, and it decrements visibly at least once per second.
2. **Given** a running countdown, **When** it reaches zero, **Then** the countdown stops at zero and the screen states that release is being processed, rather than displaying negative time or freezing on a stale number.
3. **Given** a countdown that has reached zero, **When** the backend records the release, **Then** the screen moves to the released face on its own — no click, no refresh — and states that the seller has been paid in full.
4. **Given** a delivered order opened after its window has already elapsed but before release is recorded, **When** the screen loads, **Then** it shows an already-expired window rather than a fresh countdown, and does not offer actions that can no longer succeed.
5. **Given** the review window is long, **When** the countdown renders, **Then** the remaining time is expressed in units a person can read at a glance rather than as a raw number of seconds.
6. **Given** the screen has been left open in a background tab across the moment of expiry, **When** it is returned to, **Then** the countdown and the state shown are correct for the present moment, not resumed from where the tab was suspended.

---

### User Story 3 - Judge the output against my own criteria, then accept (Priority: P1)

The buyer reads what came back with their acceptance criteria beside it — the same words they wrote before any work happened. Satisfied, they accept, and the order settles at once instead of waiting out the window.

**Why this priority**: Side-by-side is the product's core legibility argument and the entire visual mechanic of the second act. Accepting early is also the quiet path a buyer takes when a trade simply went fine.

**Independent Test**: On a delivered order, confirm the output and the acceptance criteria are visible at the same time, side by side, without scrolling between them. Accept, and confirm the order moves to released and the actions disappear.

**Acceptance Scenarios**:

1. **Given** a delivered order, **When** the screen renders at the demo viewport, **Then** the output and the buyer's acceptance criteria are on screen simultaneously, laid out beside each other, so both can be read without scrolling from one to the other.
2. **Given** the acceptance criteria panel, **When** it renders, **Then** it presents the criteria verbatim as written at purchase and labels them as the buyer's own words, fixed since then.
3. **Given** a delivered order, **When** the screen renders, **Then** an Accept action and a Complain action are both offered, and Accept is presented as the affirmative path.
4. **Given** the buyer activates Accept, **When** the request succeeds, **Then** the screen moves to the released face, the countdown disappears, and neither action remains available.
5. **Given** an Accept request in flight, **When** the buyer activates Accept or Complain again, **Then** no second request is sent and the interface visibly reports that it is working.
6. **Given** Accept is rejected because the window already closed and the order released, **When** the error arrives, **Then** the screen re-reads the order and settles into the released face rather than showing a bare failure — the buyer got the outcome they wanted anyway.
7. **Given** Accept fails for any other reason, **When** the error arrives, **Then** the reason is shown, the order's state is re-read, and the actions remain usable if they are still valid.

---

### User Story 4 - Complain, with a reason, and see Guardian take the case (Priority: P1)

The buyer is not satisfied. They complain, are asked what was wrong, confirm — being told plainly that the decision is final and cannot be withdrawn — and the page moves to a state that says Guardian is reviewing the case.

**Why this priority**: It is the entry to arbitration, the hinge of the second act, and one of the three stated acceptance criteria. It is also the only irreversible action on the page, so its confirmation step is part of the feature, not decoration.

**Independent Test**: On a delivered order, complain with a reason, confirm, and observe the page enter the reviewing state. Then repeat on a failed order and confirm the same path is available there.

**Acceptance Scenarios**:

1. **Given** a delivered order, **When** the buyer activates Complain, **Then** a modal opens asking for the reason as free text and requires a non-empty reason before it can be confirmed.
2. **Given** the complaint modal, **When** it renders, **Then** it states that filing is final, cannot be withdrawn, and that the ruling is binding on both sides.
3. **Given** the complaint modal, **When** the buyer dismisses or cancels it, **Then** nothing is submitted, the order is unchanged, and the countdown is still running underneath.
4. **Given** a reason entered and confirmed, **When** the request succeeds, **Then** the modal closes and the screen moves to the reviewing face, stating that Guardian is examining the case, with no actions offered.
5. **Given** a complaint request in flight, **When** the buyer confirms again, **Then** exactly one complaint is submitted.
6. **Given** the complaint is rejected because the review window has already closed, **When** the error arrives, **Then** the modal explains that the window expired and the order has released, the typed reason is preserved until dismissal, and the screen re-reads the order.
7. **Given** the complaint fails for another reason, **When** the error arrives, **Then** the reason is shown inside the modal, the typed text is preserved, and the buyer can retry or cancel.
8. **Given** the screen is in the reviewing face, **When** the backend records a verdict, **Then** the screen moves on its own to the ruled face without a refresh.

---

### User Story 5 - Be told plainly when nothing came back (Priority: P2)

Execution produced nothing. Rather than an empty output panel or a spinner that never resolves, the page says the agent returned nothing and offers the one action that makes sense: complain.

**Why this priority**: Non-delivery is explicitly in scope for arbitration, and it is a state the demo can hit by accident under time pressure. A page that shows a blank result for a failed order looks broken at exactly the wrong moment.

**Independent Test**: With an order forced into the failed state, open the screen and confirm the failure is stated in plain language, that Accept is not offered, and that Complain is.

**Acceptance Scenarios**:

1. **Given** a failed order, **When** the screen renders, **Then** it states that the agent returned nothing, in plain language, rather than showing an empty output area.
2. **Given** a failed order, **When** the screen renders, **Then** Complain is offered and Accept is not.
3. **Given** a failed order, **When** the screen renders, **Then** no countdown is shown, because there is no delivery for a review window to run from.
4. **Given** a failed order, **When** the buyer complains, **Then** the same reason-and-confirm path as a delivered order is used and the screen moves to the reviewing face.

---

### User Story 6 - Land on a settled outcome (Priority: P2)

The case has been ruled on. The page stops being live and presents the outcome as the final word on this order, in the place where the verdict card will live.

**Why this priority**: The page must terminate correctly even though the verdict card's own design ships separately. Getting here matters now; how rich it looks is the next feature's problem.

**Independent Test**: With an order in the ruled and then settled state, open the screen and confirm it presents a stable final view, offers no actions, and has stopped updating in the background.

**Acceptance Scenarios**:

1. **Given** an order that has been ruled on or settled, **When** the screen renders, **Then** it presents the outcome region as the page's conclusion and offers no buyer actions.
2. **Given** an order that has been ruled but whose settlement is still completing, **When** the screen renders, **Then** it indicates that settlement is finishing and continues to follow the order until it is settled.
3. **Given** a settled order, **When** the screen renders, **Then** the parts of the page that persist across states — what was ordered, the input, the acceptance criteria, the output — are still present alongside the outcome, so the record can be read as a whole.
4. **Given** the outcome region, **When** it renders in this feature, **Then** it occupies a clearly reserved place on the page that the verdict card will later fill, and never renders a blank gap.

---

### User Story 7 - Don't hammer the backend after the order is done (Priority: P2)

Once an order can no longer change, the page stops asking about it.

**Why this priority**: It is a stated requirement of the feature and a visible-quality issue: a laptop polling once a second for an order that finished ten minutes ago is a bad thing to have discovered on stage.

**Independent Test**: Watch outbound requests while an order moves to released. Confirm the repeated fetches stop within one interval of the terminal state and never resume while the page stays open.

**Acceptance Scenarios**:

1. **Given** an order in a non-terminal state, **When** the screen is open, **Then** the order is re-read approximately once per second.
2. **Given** an order that reaches a terminal state, **When** the terminal state is observed, **Then** the repeated re-reads stop within one interval and do not resume for as long as the page remains open.
3. **Given** a terminal order opened directly, **When** the screen loads, **Then** it reads the order once and never starts a repeated re-read at all.
4. **Given** the screen is left in a background tab, or behind another window, on a live order, **When** it is not visible, **Then** re-reading continues at the same cadence so the order still reaches its terminal state on screen, and returning to the page produces no burst of catch-up requests.
5. **Given** the buyer navigates away from the screen, **When** the page is left, **Then** all repeated re-reading and the countdown timer stop.
6. **Given** repeated re-reads that begin to fail, **When** the failures continue, **Then** the screen keeps showing the last known state with a quiet indication that updates are not getting through, rather than replacing the page with an error or retrying at an escalating rate.

---

### Edge Cases

- **The tab was asleep across the whole review window.** On return the countdown is recomputed from the clock, not resumed, so it cannot show time that has already passed.
- **The device clock is wrong.** The countdown is anchored to a server-provided time reference so a skewed local clock cannot show a window that ended minutes ago or one that never ends.
- **The countdown hits zero but the sweeper is slow.** The page shows a settling-shortly state and keeps following the order; it does not claim a release that has not been recorded.
- **A state moves backwards or arrives out of order between reads.** The page never regresses to an earlier face once a later one has been observed.
- **The buyer complains at the very last second.** Whichever of the complaint and the automatic release the backend accepts is authoritative; the page reconciles to the state the backend reports rather than to what it had rendered.
- **A very large output** — thousands of characters or many rows. The output panel scrolls within itself so the criteria beside it stay in view and the page does not become unusable.
- **Output that is structured rather than prose.** It is rendered legibly according to its shape rather than dumped as one unbroken string.
- **The session expires while the page is open.** Re-reads start failing as unauthenticated; the buyer is told to sign in again and returns to this same order.
- **The order was placed with an agent whose listing has since changed.** The page shows what the order was bought under, not what the listing says today.
- **Two tabs open on the same order.** Both follow the same order independently; accepting or complaining in one is reflected in the other on its next read.

## Requirements *(mandatory)*

### Functional Requirements

**One page, five faces**

- **FR-001**: The screen MUST be addressable by the order's own URL and MUST render the face corresponding to the order's current state on first paint, for every state the order can be in.
- **FR-002**: The screen MUST present five faces: work in progress, delivered and under review, non-delivery, under arbitration, and concluded — selected solely by the order's state as reported by the backend.
- **FR-003**: Material that is true regardless of state — what was ordered, the input the buyer submitted, the acceptance criteria, the price — MUST remain present across faces rather than being replaced as the state changes.
- **FR-004**: In the work-in-progress face the screen MUST state that the agent is working, show the submitted input, and show elapsed time since the order was created, updating without interaction.
- **FR-005**: In the non-delivery face the screen MUST state plainly that the agent returned nothing, MUST NOT show an empty output area, and MUST NOT show a countdown.
- **FR-006**: In the arbitration face the screen MUST state that Guardian is reviewing the case and MUST offer no buyer actions.
- **FR-007**: In the concluded face the screen MUST reserve a clearly delimited region for the verdict presentation delivered by a later feature, MUST NOT leave a blank gap there, and MUST offer no buyer actions.
- **FR-008**: The screen MUST NOT display any seller-private material, and MUST have no code path capable of rendering one even if a response contained it.

**Live updating**

- **FR-009**: While the order is in a non-terminal state the screen MUST re-read the order approximately once per second and reflect changes without any manual refresh.
- **FR-010**: The screen MUST stop re-reading within one interval of observing a terminal state, MUST NOT resume while the page remains open, and MUST NOT start re-reading at all for an order that was already terminal when the page loaded.
- **FR-011**: Terminal states for the purpose of FR-010 are the uncontested release and the settled conclusion of a dispute. Every other state — including non-delivery and a ruling whose settlement has not completed — MUST continue to be followed.
- **FR-012**: Re-reading MUST continue while the page is hidden or merely occluded by another window, so that an unattended order still reaches its terminal state on screen; returning to the page MUST NOT produce a burst of catch-up requests. The countdown is recomputed on return rather than assumed to have kept ticking (FR-018).
- **FR-013**: All re-reading and timers MUST stop when the buyer leaves the screen.
- **FR-014**: When re-reads fail, the screen MUST retain and display the last known state with an unobtrusive indication that updates are not getting through, MUST NOT replace the rendered page with an error, and MUST NOT increase its request rate in response to failures.
- **FR-015**: The rendered face MUST NOT regress to an earlier state in the order's lifecycle once a later one has been observed.

**The countdown**

- **FR-016**: In the delivered face the screen MUST display a countdown to automatic release, computed on the client from the order's delivery time plus its own review-window duration, decrementing at least once per second.
- **FR-017**: The countdown MUST be anchored to a server-provided time reference rather than trusting the device clock outright, so clock skew cannot misstate the remaining window.
- **FR-018**: The countdown MUST be recomputed from the current time whenever the page becomes visible again, never resumed from where it was suspended.
- **FR-019**: At zero the countdown MUST stop at zero, MUST NOT show negative time, and the screen MUST state that release is being processed while it continues following the order.
- **FR-020**: A delivered order whose window has already elapsed at load time MUST render as expired rather than as a fresh countdown, and MUST NOT offer actions that can no longer succeed.
- **FR-021**: Remaining time MUST be formatted for human reading at a glance rather than as a raw seconds count.

**Output beside criteria**

- **FR-022**: In the delivered face the output and the buyer's acceptance criteria MUST be laid out beside each other and both readable on screen at once at the demo viewport, without scrolling from one to the other. A vertical stack does not satisfy this requirement.
- **FR-023**: The acceptance criteria MUST be shown verbatim as captured at purchase and labelled as the buyer's own words, fixed since then.
- **FR-024**: A long output MUST scroll within its own panel so that the criteria beside it stay in view, and structured output MUST be rendered according to its shape rather than as one unbroken string.

**Actions**

- **FR-025**: The delivered face MUST offer both Accept and Complain; the non-delivery face MUST offer Complain only; no other face MUST offer buyer actions.
- **FR-026**: Accept MUST submit an early-acceptance request and, on success, move the screen to the released face with the countdown and both actions gone.
- **FR-027**: Complain MUST open a modal that collects a free-text reason, MUST require a non-empty reason, MUST state that filing is final and cannot be withdrawn, and MUST require an explicit confirmation before anything is submitted.
- **FR-028**: Cancelling or dismissing the complaint modal MUST submit nothing and leave the order and its countdown untouched.
- **FR-029**: A confirmed complaint MUST submit exactly one request carrying the reason and, on success, move the screen to the arbitration face.
- **FR-030**: While either action's request is in flight the interface MUST prevent a second submission of either action and MUST visibly report that it is working.
- **FR-031**: When an action is rejected because the order has moved on — the window closed, the order already released or already disputed — the screen MUST explain what happened in those terms, re-read the order, and settle into the correct face rather than showing a bare failure.
- **FR-032**: When an action fails for other reasons the screen MUST show the reason, preserve a typed complaint reason, re-read the order, and leave the actions usable if they remain valid.
- **FR-033**: The screen MUST NOT request a wallet signature or perform any on-chain transaction; both actions are backend calls.

**Access and boundaries**

- **FR-034**: An unknown order, or one belonging to another account, MUST produce a not-found or not-authorised state with a route back to the buyer's own orders, and MUST NOT start live updating.
- **FR-035**: An unauthenticated visitor MUST be sent to sign in and MUST return to this same order afterwards.
- **FR-036**: The screen MUST NOT provide seller-side views of the order, and MUST NOT render the verdict card's own content — both belong to later features.
- **FR-037**: No automated tests are produced for this feature; its acceptance is verified by hand (see Assumptions).

**Optional**

- **FR-038**: A persistent escrow figure SHOULD be visible in the application header so that it can be seen to move as an order settles. It MUST come from the account read the header already performs — the frontend does not read the escrow contract directly. It is not required for acceptance, and when the figure cannot be read it MUST render as unknown rather than as zero.

### Key Entities

- **Order**: what the buyer bought and everything that has happened to it — its state, the price paid, the acceptance criteria captured at purchase, the review-window duration snapshotted at purchase, and the times of creation, delivery, dispute, and settlement. Its state is the single input that selects which face the screen shows.
- **Run**: the execution of the order — the input the buyer submitted and the output that came back, or the absence of one. It is what the buyer reads against their criteria.
- **Review window**: the interval between delivery and automatic release, carried on the order itself rather than read from a global setting, so an order shows the window it was actually sold under.
- **Complaint**: a buyer's stated reason for objecting, submitted once, not withdrawable, and the trigger for arbitration.
- **Verdict**: the ruling on a disputed order. This feature is responsible for reaching the state in which one exists and reserving its place on the page; its presentation belongs to the next feature.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An order can be watched from work-in-progress all the way to released without a single manual refresh or click, in ten consecutive rehearsals.
- **SC-002**: With the review window turned down for the demo, the countdown reaches zero and the page shows the released outcome within 5 seconds of zero, unattended.
- **SC-003**: At the demo viewport, 100% of observers can see the delivered output and the acceptance criteria at the same time without scrolling.
- **SC-004**: Complaining moves the page to the reviewing state within 2 seconds of confirmation, and the page reaches the concluded state on its own once the ruling exists.
- **SC-005**: Requests for an order stop within 2 seconds of it reaching a terminal state; a page left open on a finished order for five minutes issues zero further requests for it.
- **SC-006**: Repeatedly activating Accept, or confirming a complaint repeatedly, produces exactly one accepted order and at most one complaint.
- **SC-007**: Every failure path on this screen — unknown order, another buyer's order, failed initial load, dropped updates, expired session, an action rejected because the order moved on — renders a message naming what happened and what to do next; none render a blank screen or an unhandled error.
- **SC-008**: A person unfamiliar with the product, shown the delivered face, can say what the countdown will do when it reaches zero without being told.
- **SC-009**: Both acts of the demo run end to end on this screen twice in a row after a reset, with no manual intervention outside the interface.

## Assumptions

- **The backend endpoints exist and behave as documented** — reading an order returns its state, timings, submitted input, output, acceptance criteria, and review-window duration; accepting and complaining are backend calls that perform any chain work server-side. This feature is a client of that contract.
- **Terminal means released or settled.** Non-delivery is not terminal, because a complaint can still be filed from it, and a ruling that has not finished settling is still followed. This matches the documented polling rule.
- **The concluded face is a container in this release.** The verdict's tier, reasoning, citations, split, and transaction hash are the next feature's work; here the region exists, is labelled, and shows enough that the page does not look unfinished if a rehearsal reaches it early.
- **The case-file panel is not part of this feature.** The arbitration face states that Guardian is reviewing; showing the evidence it is reading is deferred, and it would come with a redaction obligation this feature does not take on.
- **The review window is short during the demo and long in principle.** The countdown is written to read correctly for both, which is why the format is human-readable rather than a seconds counter.
- **A server-provided time reference is available** from responses the page already makes, so the countdown can be anchored without adding a dedicated time endpoint.
- **Polling and money formatting from earlier features are reused**; this feature introduces no second source of truth for either.
- **Elapsed time and the countdown are display-only.** The frontend performs no arithmetic that decides an outcome — the backend decides when a window has closed, and a disagreement is resolved by re-reading the order.
- **The buyer is a human.** Agent-buyer flows are deferred product-wide.
- **Seller-side views of the same order are a separate feature** and nothing on this screen is conditioned on the viewer being anything other than the buyer.
- **The total-escrow header figure is optional** and will be dropped without further discussion if reading it complicates the header or the demo.
- **No automated tests are written for this feature.** This is a deliberate, time-boxed MVP decision recorded in the component briefing: the only kept test suite is the escrow contract's. Acceptance here is verified by hand, and the demo rehearsal is the real regression check.
