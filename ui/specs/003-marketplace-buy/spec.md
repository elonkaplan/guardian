# Feature Specification: Marketplace & Agent Detail

**Feature Branch**: `003-marketplace-buy`

**Created**: 2026-08-08

**Status**: Draft

**Input**: User description: "docs/specs/UI-03-marketplace.md — Browse the catalogue, then buy, capturing the acceptance criteria Guardian will later judge against. `/agents` grid of listings (name, description, price); `/agents/:id` detail with capabilities and exclusions presented as contract terms; a buy form with input fields per the agent's input schema, an acceptance-criteria free-text field, and the price; creating the order redirects to its detail page; a balance check with a link to top up when short. Out of scope: automated tests of any kind, search, filtering, sorting, pagination, ratings."

## Overview

Guardian's pitch is that a buyer has recourse after the fact. That recourse is only as good as the two documents it rests on: **what the seller promised** and **what the buyer asked for**. Both are fixed before any work happens, and this feature is where both get in front of the buyer — one to read, one to write.

So the catalogue is not really the point. The catalogue exists to get someone to a single screen where they read a promise, read its stated limits, state their own criteria, and pay. Everything that happens later — the countdown, the complaint, the verdict, the split — is adjudicated against text captured on this screen. A vague acceptance criterion here is a weak case later, and by then it cannot be edited.

Two consequences shape the work:

- **Exclusions are not fine print.** They are how a seller defends itself, and showing them as plainly as the capabilities is what makes the eventual verdict fair to read. They must be visible on arrival — not folded behind a "show more", not below a buy button that a buyer can reach without scrolling past them.
- **The acceptance-criteria field is doing real work.** It is the only place in the product where the buyer writes their half of the contract, and it is the only place that can tell them so. The form has to make that consequence visible at the moment of writing, because there is no second chance to explain it.

The people served are the **buyer** — human, in this release — who needs to understand what they are agreeing to before spending money, and the **demo operator**, for whom this screen is the setup for both acts: the purchase that quietly settles, and the purchase that ends in a dispute.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Browse the catalogue and open a listing (Priority: P1)

A signed-in buyer opens the marketplace. They see every active agent as a card carrying its name, a one-sentence description of what it does, and its price. Nothing is truncated to the point of being unreadable, and the price is legible at a glance so the buyer can tell a $2 job from a $20 one without opening anything. Selecting a card takes them to that agent's detail screen.

**Why this priority**: It is the entry to the entire buying flow and the first screen with real backend data on it. Without it the product is a set of screens nobody can reach in the order a demo needs them.

**Independent Test**: With the backend seeded, sign in and open the marketplace. Confirm one card per active agent, each showing name, description, and price, and that selecting a card lands on that agent's detail screen.

**Acceptance Scenarios**:

1. **Given** a signed-in buyer and a catalogue containing active agents, **When** they open the marketplace, **Then** each active agent appears once as a card showing its name, its description, and its price formatted as currency.
2. **Given** the catalogue is still loading, **When** the marketplace renders, **Then** a loading state is shown rather than an empty grid that looks like "there are no agents".
3. **Given** the catalogue returns no agents, **When** the marketplace renders, **Then** an explicit empty state explains that no agents are listed yet, distinct from both the loading state and an error.
4. **Given** the catalogue request fails, **When** the marketplace renders, **Then** an error state explains what went wrong and offers a way to retry without a full page reload.
5. **Given** a rendered grid, **When** the buyer selects any card, **Then** they arrive at the detail screen for that specific agent.

---

### User Story 2 - Read the contract terms before paying (Priority: P1)

A buyer opens an agent's detail screen. They see what it claims to do and, with equal weight, what it explicitly does not do. Both are labelled as terms of the deal rather than as marketing copy, so it is obvious that these lines are what a later dispute will be judged against. They also see what they will be asked to supply and what shape the result comes back in, and the price.

**Why this priority**: This is the seller's half of the contract. If a buyer can pay without having seen the exclusions, every verdict that cites one looks like a trap, and the fairness argument the product is built on stops holding.

**Independent Test**: Open the detail screen for a seeded agent whose listing has both capabilities and exclusions. Confirm both lists are visible without any expand interaction and without scrolling past the buy action, and that both are labelled as contract terms.

**Acceptance Scenarios**:

1. **Given** an agent whose listing declares capabilities and exclusions, **When** its detail screen renders, **Then** every capability and every exclusion is visible immediately — no disclosure control, no truncation, no "show all" — and the two lists are visually distinguishable from each other.
2. **Given** the detail screen, **When** it renders, **Then** the capability and exclusion lists carry labelling that states they are the terms Guardian judges against, not promotional text.
3. **Given** the detail screen, **When** it renders, **Then** the buy action appears after the contract terms in reading order, so a buyer cannot reach it without having passed them.
4. **Given** an agent that declares no exclusions, **When** the detail screen renders, **Then** the exclusions area is still present and says explicitly that the seller declared none, rather than silently disappearing.
5. **Given** the detail screen, **When** it renders, **Then** the price, a human-readable statement of what the buyer must supply, and the shape of the result are all shown.
6. **Given** an agent id that does not exist or is not listed, **When** the detail screen is opened, **Then** a not-found state is shown with a way back to the catalogue, rather than a broken or empty form.
7. **Given** any part of the listing, **When** it renders, **Then** no seller-private material appears anywhere on the screen — there is no field on this screen that would display a system prompt or model choice even if the backend sent one.

---

### User Story 3 - Place an order and land on it (Priority: P1)

The buyer fills in what the agent needs, writes their acceptance criteria, sees the price they are about to pay, and buys. The application submits the purchase, and on success the buyer is taken straight to that order's own screen — the place where the work will appear and the review window will run.

**Why this priority**: It is the transaction. Every other story on this screen exists to make this one safe to perform.

**Independent Test**: On a seeded agent's detail screen with sufficient balance, complete the input fields and acceptance criteria, buy, and confirm arrival at the newly created order's screen with an identifier that matches the order the backend created.

**Acceptance Scenarios**:

1. **Given** an agent whose listing declares required inputs, **When** the buy form renders, **Then** it presents one labelled field per declared input rather than asking the buyer to compose a raw payload, and marks which of them are required.
2. **Given** the buy form, **When** it renders, **Then** it includes a free-text acceptance-criteria field and displays the exact amount that will be charged.
3. **Given** a required input left empty or an acceptance-criteria field left empty, **When** the buyer attempts to buy, **Then** the purchase is not submitted, the offending fields are identified, and no money moves.
4. **Given** a complete, valid form and sufficient balance, **When** the buyer confirms the purchase, **Then** the application submits the agent, the supplied input, and the acceptance criteria as one purchase request.
5. **Given** the purchase request succeeds, **When** the response arrives, **Then** the buyer is taken to the detail screen of the created order, and the marketplace screen is not left behind them in a state that would re-submit on a back navigation.
6. **Given** the purchase request is in flight, **When** the buyer activates the buy action again or presses Enter repeatedly, **Then** only one purchase request is ever sent, and the action visibly reports that it is working.
7. **Given** the backend rejects the purchase — invalid input, an agent that has been deactivated, or a balance that turned out to be short — **When** the response arrives, **Then** the reason is shown on the form, everything the buyer typed is preserved, and they can correct and retry.
8. **Given** the purchase request fails for connectivity reasons with no answer from the backend, **When** the error surfaces, **Then** the buyer is told the purchase may or may not have been created and is pointed at their orders list, rather than being invited to blindly retry.

---

### User Story 4 - Know I can afford it before I commit (Priority: P2)

Before buying, the buyer can see their available balance against the price. When the balance is short, the application says so plainly on the form, disables the purchase, and offers a direct route to add funds — so the failure happens in the interface rather than as a server rejection after a click.

**Why this priority**: The stated acceptance is that insufficient balance is caught before submitting. It is also the most likely stumble in a live demo, where a rehearsal reset can leave an account empty.

**Independent Test**: With an account whose balance is below an agent's price, open that agent's buy form. Confirm the shortfall is stated, the buy action cannot be used, and the top-up link leads to the wallet screen. Add funds, return, and confirm the action becomes usable.

**Acceptance Scenarios**:

1. **Given** a signed-in buyer on a detail screen, **When** the form renders, **Then** the available balance and the price are both shown, as two clearly labelled figures.
2. **Given** an available balance below the price, **When** the form renders, **Then** it states that the balance is insufficient, states the shortfall amount, and the buy action is unavailable.
3. **Given** an insufficient balance, **When** the buyer follows the offered top-up route, **Then** they arrive at the wallet screen where funds can be added.
4. **Given** the buyer returns after adding funds, **When** the form re-reads the balance, **Then** an now-sufficient balance re-enables the buy action without requiring a full page reload.
5. **Given** the balance cannot be read at all, **When** the form renders, **Then** the buy action remains available and the backend stays the authority on affordability — an unreadable balance must not silently block a purchase that would have succeeded.

---

### User Story 5 - Write acceptance criteria that will hold up later (Priority: P2)

At the moment the buyer writes their criteria, the form tells them what those words are for: they are half of what Guardian will judge against, they are fixed once the order is placed, and a vague criterion is a weak case. The buyer writes with that consequence in view.

**Why this priority**: The field is the buyer's only leverage in a later dispute, and this screen is the only place that can explain it. It is separable from the mechanics of submitting an order, which is why it stands alone — but a demo that shows a verdict citing a criterion is much stronger if the audience saw the buyer warned when writing it.

**Independent Test**: Open a buy form and confirm the acceptance-criteria field carries an explanation of its consequence and at least one concrete example of a well-formed criterion, before anything is typed.

**Acceptance Scenarios**:

1. **Given** the buy form, **When** it renders, **Then** the acceptance-criteria field is accompanied by an explanation that these criteria are what a later dispute is judged against and that they cannot be changed after purchase.
2. **Given** the acceptance-criteria field, **When** it renders, **Then** it shows concrete guidance on what a specific, checkable criterion looks like, rather than only a generic "describe your requirements" prompt.
3. **Given** a criterion so short that it could not be checked against an output, **When** the buyer attempts to buy, **Then** the form warns that the criterion is unlikely to be enforceable — while still allowing a buyer who insists to proceed.
4. **Given** the acceptance-criteria field, **When** the buyer types into it, **Then** it accommodates several sentences of text without the buyer having to scroll a single-line field.

---

### Edge Cases

- **An agent is deactivated between the catalogue load and the purchase.** The backend refuses; the form must report that this agent is no longer available rather than a generic failure, and offer a route back to the catalogue.
- **The price changes between the detail load and the purchase.** The amount charged is whatever the backend applies; if the purchase is refused on price, the form re-reads the listing rather than continuing to display a stale figure.
- **An input contract the form cannot render as simple fields** (nested or otherwise complex structure). The form falls back to a single raw structured-text field with the expected shape shown alongside, so no agent becomes unbuyable.
- **Malformed content in that fallback field.** Caught before submission, with the position of the problem indicated, and no money moves.
- **The session expires between opening the form and buying.** The purchase is refused as unauthenticated; the buyer is returned to sign in and, on return, is not left staring at an empty form with their typed criteria gone.
- **A listing with an unusually long description or a dozen capabilities.** The detail screen stays readable and the exclusions remain fully visible; the catalogue card may summarise, the detail screen may not.
- **The catalogue contains agents owned by the signed-in user.** They are shown like any other listing; nothing on this screen depends on ownership.
- **Navigating back from the created order.** Returning to the detail screen does not re-submit the purchase and does not appear to have created a second order.

## Requirements *(mandatory)*

### Functional Requirements

**Catalogue**

- **FR-001**: The marketplace screen MUST list every active agent returned by the catalogue, one entry each, showing name, description, and price.
- **FR-002**: Prices MUST be displayed as formatted currency derived from the integer minor-unit amount the backend supplies; the frontend MUST NOT perform arithmetic on money beyond comparing a balance to a price.
- **FR-003**: The marketplace MUST distinguish four states — loading, populated, empty catalogue, and failed request — and MUST offer a retry from the failed state that does not require reloading the page.
- **FR-004**: Selecting a catalogue entry MUST navigate to that agent's detail screen, addressable by its own URL so the screen can be opened directly.
- **FR-005**: The marketplace MUST NOT provide search, filtering, sorting, pagination, or ratings.

**Listing as contract**

- **FR-006**: The detail screen MUST display the agent's full capability list and full exclusion list, both rendered in their entirety on first paint, with no disclosure control, truncation, or expansion required to read either.
- **FR-007**: Capabilities and exclusions MUST be labelled as the terms a dispute is judged against, and MUST be visually distinguishable from each other and from descriptive copy.
- **FR-008**: The buy action MUST appear after the contract terms in the screen's reading order.
- **FR-009**: When a listing declares no exclusions, the screen MUST state that explicitly instead of omitting the section.
- **FR-010**: The detail screen MUST display the price, a human-readable statement of the required input, and the shape of the returned result.
- **FR-011**: The screen MUST have no code path capable of rendering a seller's private execution material (system prompt, model choice) even if such fields were present in a response.
- **FR-012**: An unknown or unavailable agent id MUST produce a not-found state with a route back to the catalogue.

**Purchase form**

- **FR-013**: The buy form MUST derive its input fields from the agent's declared input contract, presenting one labelled field per declared input and indicating which are required.
- **FR-014**: When the declared input contract cannot be represented as simple labelled fields, the form MUST fall back to a single raw structured-text field, display the expected shape beside it, and validate that the content is well-formed before submitting.
- **FR-015**: The form MUST include a multi-line free-text acceptance-criteria field, required and non-empty.
- **FR-016**: The acceptance-criteria field MUST be accompanied by an explanation that it is half of what a later dispute is judged against and is fixed at purchase, plus concrete guidance on what a checkable criterion looks like.
- **FR-017**: The form MUST warn when the acceptance criteria are too brief to be checkable, while still permitting the buyer to proceed.
- **FR-018**: The form MUST display the exact amount that will be charged, adjacent to the buy action.
- **FR-019**: The form MUST validate required fields locally and block submission with per-field messages when they are unmet; no purchase request is sent in that case.
- **FR-020**: On submission the application MUST send exactly one purchase request carrying the agent, the collected input, and the acceptance criteria, and MUST prevent duplicate submissions while one is in flight.
- **FR-021**: The application MUST NOT send a review-window duration, a price, or any settlement parameter with the purchase — those are the backend's to set.
- **FR-022**: On a successful purchase the application MUST navigate to the created order's detail screen, replacing the form in navigation history so a back navigation cannot re-submit.
- **FR-023**: On a backend rejection the form MUST show the reason, preserve all entered values, and allow correction and retry.
- **FR-024**: When a purchase fails without an answer from the backend, the message MUST state that the order may still have been created and point the buyer to their orders list rather than encouraging an immediate retry.

**Affordability**

- **FR-025**: The buy form MUST display the buyer's available balance and the price as two separately labelled figures, and MUST NOT present a single combined money number.
- **FR-026**: When the available balance is below the price, the form MUST state the shortfall, make the buy action unavailable, and offer a route to the wallet screen to add funds.
- **FR-027**: After funds are added, returning to the form MUST re-read the balance and re-enable the buy action without a full page reload.
- **FR-028**: When the balance cannot be read, the form MUST leave the buy action available and defer to the backend's decision.

**Boundaries**

- **FR-029**: This feature MUST NOT request any wallet signature or on-chain transaction; the purchase is entirely a backend call.
- **FR-030**: Browsing MUST stay open to an unauthenticated visitor — both the catalogue and the detail screen render without a session, because the underlying catalogue is public. **Buying** MUST require a session: an unauthenticated visitor sees an invitation to sign in where the buy action would be, and after signing in is returned to the agent they were looking at.
- **FR-031**: No automated tests are produced for this feature; its acceptance is verified by hand (see Assumptions).

### Key Entities

- **Agent listing**: the public half of an agent — name, description, price, capability claims, exclusion claims, a description and schema of required input, and the shape of the result. It carries nothing the seller considers private. The capability and exclusion lists are contract text, quoted verbatim in later verdicts.
- **Purchase request**: what the buyer composes on the detail screen — which agent, the input values they supplied, and the acceptance criteria they wrote. It is the buyer's half of the contract and is fixed once submitted.
- **Order reference**: what a successful purchase returns — an identifier that addresses the order's own screen. Nothing else about the order is this feature's concern.
- **Account balance**: the buyer's available spending balance, read to compare against a price. It is one of two distinct money figures in the product and must never be merged with the other.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A signed-in buyer with sufficient funds can go from opening the catalogue to standing on a newly created order's screen in under 90 seconds, without consulting documentation.
- **SC-002**: 100% of an agent's declared exclusions are readable on the detail screen without any expansion interaction, at the viewport size used for the demo.
- **SC-003**: Every attempted purchase where the balance is below the price is stopped by the interface — zero such attempts reach the backend.
- **SC-004**: In a review of the buy form by someone unfamiliar with the product, they can state without prompting what the acceptance-criteria field will be used for.
- **SC-005**: Repeatedly activating the buy action during a purchase produces exactly one order, verified against the buyer's orders list.
- **SC-006**: Every failure path on these two screens — empty catalogue, unknown agent, rejected purchase, connectivity loss, expired session — renders a message that names what happened and what to do next; none render a blank screen or an unhandled error.
- **SC-007**: Both acts of the demo rehearsal can be set up from this screen twice in a row, after a reset, with no manual intervention outside the interface.

## Assumptions

- **The backend endpoints exist and behave as documented** — the catalogue returns active listings, the single-agent route returns listing fields only, and the purchase route validates the agent, the input against its schema, a non-empty acceptance criteria, and the balance before moving money. This feature is a client of that contract, not a re-implementation of it.
- **The session, balance display, and money formatting from the previous feature are reused.** Available balance is already read for the shell; this feature compares it to a price rather than introducing a second source of truth.
- **Input fields are generated for flat inputs only.** Declared inputs whose values are simple text, numbers, or true/false get individual labelled fields; anything nested or otherwise complex falls back to a single raw structured-text field with the expected shape shown. The seeded demo agents take flat text input, so the fallback is a safety net rather than the common path.
- **The backend is the authority on validation.** Local checks exist to catch mistakes early and to satisfy the "caught before submitting" acceptance; they are not a mirror of the server's schema validation and are not expected to be exhaustive.
- **"Too brief to be checkable" is a soft warning with a low threshold**, tuned to catch one-word criteria rather than to police writing quality. It never blocks a purchase.
- **The order detail screen may still be a placeholder** when this feature lands; success is arriving at the correct address for the created order, not what that screen renders.
- **Money is integer minor units end to end**, formatted for display only. No floating-point arithmetic on money in this feature.
- **Balance re-reads happen on returning to the form**, not on a timer — this screen does not poll.
- **No automated tests are written for this feature.** This is a deliberate, time-boxed MVP decision recorded in the component briefing: the only kept test suite is the escrow contract's. Acceptance here is verified by hand, and the demo rehearsal is the real regression check.
- **Search, filtering, sorting, pagination, and ratings are out of scope**, as is any agent-as-buyer flow. The catalogue is small enough that a single grid is the whole design.
