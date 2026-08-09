# Feature Specification: Seller pages — joining the marketplace, and the other side of a dispute

**Feature Branch**: `007-seller-pages`

**Created**: 2026-08-09

**Status**: Draft

**Input**: User description: "docs/specs/UI-07-seller-pages.md — Proof that anyone can join the marketplace, and the seller's side of a dispute. In scope: a seller's home listing their own agents and their sales; an availability toggle per agent; a create-agent form taking name, description, price, capabilities, exclusions, input and output schemas as raw JSON, system prompt and model; and the seller's view of a disputed order — the full case file and the verdict, with no reply. Out of scope: automated tests of any kind, schema builders, agent version history UI, analytics, payout scheduling."

## Overview

There are three agents in this marketplace and we put all three there. Every claim the product makes about being a marketplace rather than a catalogue rests on a thing nobody has yet done from the outside: list an agent. The first question from the floor is *"can anyone sell here?"*, and the only answer that survives contact with a sceptic is a form that a person fills in while being watched, followed by the new listing appearing beside the seeded ones. These screens are not in the three demo acts. They are what makes the three demo acts a marketplace.

The form is also the single best place in the product to improve the quality of what Guardian judges. **Capabilities and exclusions are contract terms**, not marketing copy — they are quoted verbatim in verdicts, and they decide disputes in both directions. A seller who writes a vague capability loses a dispute they should have won; a seller who writes a precise exclusion wins one they would otherwise have lost. Every other route to better contract text costs engineering. Saying so in the form, beside the fields, costs a sentence, and it is the cheapest lever this product has on the quality of its own evidence.

Two things the form deliberately does not do. It does not build schemas — the input and output contracts are raw JSON in textareas, because a schema builder is a day of work for a control the demo never touches and a seller in this MVP is a person authoring three fixtures. And it does not show the seller's own execution spec back to them: the system prompt goes out and is never rendered on the way back, so this application keeps its property of having no code path that can display one.

The other half is the seller's side of a dispute, and its shape is a product decision that is easy to mistake for a missing feature. A seller whose work has been complained about receives the **full case file and Guardian's reasoning** — the input, their own pinned listing text, the output, the steps, the tier, the citations, the split. What they do not receive is a reply box. Verdicts are final; there is no appeal. Notification without appeal is a deliberate scope decision, and the screen has to read as one. A page that shows a ruling and nothing else looks like a form that was never built; the same page with a line explaining that verdicts are final and why looks like a product that made a choice. The absence of the reply affordance is the requirement, and stating the absence is what makes it legible.

The people served: the **prospective seller**, who needs to get an agent listed without help; the **seller in a dispute**, who needs to see exactly what was ruled and on what evidence; and the **sceptical observer**, who wants to see that the marketplace has a door and that the adjudication has two sides.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - List an agent (Priority: P1)

A person who has never sold here opens the create form, fills in a name, a description, a price, what their agent does and explicitly does not do, the shape of the input it takes and the output it returns, and the instructions and model it runs on. They submit, and their agent is in the marketplace beside the seeded ones.

**Why this priority**: It is the entire argument of the feature. Without it the marketplace is a catalogue that someone else populated, and the most obvious question from an audience has no answer.

**Independent Test**: On a signed-in account, complete the form end to end and confirm the new agent appears in the public marketplace and can be opened like any other listing — with no seeded data and no other screen from this feature required.

**Acceptance Scenarios**:

1. **Given** the create form, **When** it renders, **Then** it collects a name, a description, a price, capability claims, exclusions, an input contract, an output contract, a system prompt, and a model.
2. **Given** the capability and exclusion fields, **When** they render, **Then** the screen states that these are contract terms quoted in verdicts — that vague capabilities lose disputes and precise exclusions win them — in wording a first-time seller reads before typing rather than after.
3. **Given** the capability and exclusion fields, **When** the seller adds terms, **Then** each is captured as its own separate term, and terms can be added and removed individually rather than being typed into one undivided block.
4. **Given** the input and output contract fields, **When** they render, **Then** they accept the schema as raw text the seller writes or pastes, with no builder, picker, or field-by-field editor.
5. **Given** a contract field containing text that is not well-formed, **When** the seller tries to submit, **Then** the submission is refused with an explanation naming which contract is malformed, and nothing is sent.
6. **Given** a completed form, **When** the seller submits, **Then** the agent is created and the seller is taken to their own agents screen where the new agent is present.
7. **Given** a submitted form, **When** the request is in flight, **Then** the submit control indicates it is working and cannot be submitted again, so an impatient click cannot create two agents.
8. **Given** a newly created agent, **When** the public marketplace is opened, **Then** the agent appears there and its detail screen shows its name, description, price, capabilities, and exclusions.
9. **Given** a submission that fails, **When** the failure is returned, **Then** the reason is shown in place, everything the seller typed is still in the form, and the submission can be retried without re-entering anything.
10. **Given** any state of this screen, **When** it renders, **Then** no system prompt, model, or other execution-spec value that came back from the server is displayed anywhere.

---

### User Story 2 - See my agents and my sales (Priority: P1)

A seller opens their home screen. Two things are on it: the agents they have listed, each with its price and whether it is currently on the market, and the sales those agents have made, each showing what state it is in and what it was worth.

**Why this priority**: It is where listing an agent lands, and it is what turns "the request succeeded" into "my agent exists". It is also the only screen where a seller learns that one of their sales is in dispute.

**Independent Test**: Sign in with an account that owns agents and has sales, and confirm both lists render with their own empty, loading, and failure states — no other screen from this feature required.

**Acceptance Scenarios**:

1. **Given** a signed-in seller who owns agents, **When** the screen renders, **Then** each of their agents is listed with its name, its price, and whether it is currently available to buyers.
2. **Given** a seller whose agents include ones that are not currently on the market, **When** the screen renders, **Then** those agents are listed too, distinguished from the available ones rather than hidden.
3. **Given** a signed-in seller with sales, **When** the screen renders, **Then** each sale is listed with the agent it was for, its amount, its current state, and when it happened.
4. **Given** a sale that is in dispute or has been ruled on, **When** it renders in the list, **Then** it is visibly distinguished from an ordinary sale and offers a way to see the ruling and its evidence.
5. **Given** a seller who owns no agents, **When** the screen renders, **Then** it says so and offers the way to list one, rather than rendering an empty region.
6. **Given** a seller with no sales, **When** the screen renders, **Then** it says so plainly rather than rendering an empty region or an error.
7. **Given** either list failing to load, **When** the failure occurs, **Then** it is reported within that list with a way to retry, and the other list continues to render.
8. **Given** the screen, **When** it renders, **Then** a way to list a new agent is present and reachable without scrolling past the lists.
9. **Given** the screen, **When** it renders, **Then** no system prompt, model, or other execution-spec value is displayed for any agent.

---

### User Story 3 - See a dispute against me, and that there is no reply (Priority: P2)

A seller finds that one of their sales has been complained about. They open it and read the whole case: what the buyer supplied, what the buyer asked for, the capabilities and exclusions their listing carried at the time, what their agent returned, what it did along the way, and then Guardian's ruling — the tier, the reasoning, the clause-by-clause citations, and how the money split. There is nowhere to argue, and the screen says why.

**Why this priority**: It is the second acceptance criterion of the feature and the half that makes adjudication look two-sided. It ranks below listing because a marketplace with no door is a worse failure than a dispute view a seller reaches from a list.

**Independent Test**: With an account that owns an agent whose order was disputed and ruled on, open that sale and confirm the case file and the verdict both render in full and that no reply, appeal, or response control exists anywhere on the screen.

**Acceptance Scenarios**:

1. **Given** a disputed sale, **When** the seller opens it, **Then** the buyer's input, the buyer's acceptance criteria, the capabilities and exclusions the listing carried at the time of the order, the output that was delivered, and the execution steps are all shown.
2. **Given** a sale that has been ruled on, **When** the seller opens it, **Then** Guardian's verdict is shown with its tier, its reasoning, its citations as a clause-by-clause checklist, and the resulting split between buyer and seller.
3. **Given** any state of this screen, **When** it renders, **Then** there is no control to reply, appeal, respond, contest, or comment — not disabled, not hidden behind a menu, absent.
4. **Given** the verdict, **When** it renders, **Then** the screen states that the seller is notified of the outcome and that verdicts are final, so that the absence of a reply reads as a stated decision rather than an unbuilt feature.
5. **Given** a sale that is in dispute but not yet ruled on, **When** the seller opens it, **Then** the case file renders and the screen says the ruling has not been made yet, updating to show the verdict when it arrives without the seller reloading.
6. **Given** a case file that fails to load, **When** the failure occurs, **Then** it is reported in place with a way to retry, and the verdict — if available — still renders.
7. **Given** a verdict that fails to load or is not available, **When** the failure occurs, **Then** it is reported in place with a way to retry, and the case file still renders.
8. **Given** a sale that was never disputed, **When** the seller opens it, **Then** the screen shows what the sale was and states there is no dispute, rather than reporting an error or rendering an empty case file.
9. **Given** the citations, **When** they render, **Then** each is attributed to what it came from — a capability, an exclusion, or a buyer's criterion — and shown as met or unmet.
10. **Given** any state of this screen, **When** it renders, **Then** no system prompt is displayed, even though the case file is the seller's own.

---

### User Story 4 - Take a listing off the market, and put it back (Priority: P3)

A seller decides their agent should not be sold right now. They switch it off from their agents list; it disappears from the public marketplace. Later they switch it back on and it returns.

**Why this priority**: It is the smallest piece of real ownership on the screen and the cheapest proof that a listing is under its seller's control — but nothing in the demo depends on it, and the other three stories stand without it.

**Independent Test**: On an account owning an available agent, switch it off, confirm the marketplace no longer offers it, switch it on, and confirm it returns — no other screen from this feature required.

**Acceptance Scenarios**:

1. **Given** an agent the seller owns, **When** they change its availability, **Then** the change is applied and the agent's availability shown on screen reflects it without a manual refresh.
2. **Given** an availability change in flight, **When** it is working, **Then** the control indicates it and cannot be operated again until the change resolves.
3. **Given** an agent made unavailable, **When** the public marketplace is viewed, **Then** that agent is no longer offered there.
4. **Given** an availability change that fails, **When** the failure is returned, **Then** the reason is shown, the control returns to showing the agent's true availability rather than the attempted one, and it can be tried again.
5. **Given** a list of several agents, **When** one agent's availability is changed, **Then** only that agent's row is affected and the rest of the screen is undisturbed.

---

### Edge Cases

- **A contract schema that is well-formed but is not a schema at all.** Accepted. This form validates that the text parses, not that it describes a useful contract — the alternative is a schema validator nobody asked for, and a seller pasting arbitrary JSON is a seller who gets an agent that behaves oddly, which is their problem to see.
- **A seller submits with no capabilities and no exclusions.** Allowed if the platform allows it, but the screen has said what that costs them in a dispute. The form does not silently invent contract terms, and it does not block on an empty list.
- **A capability or exclusion entered as an empty line.** Discarded before submission rather than sent as an empty contract term, since an empty clause in a verdict citation is worse than no clause.
- **A price of zero, a negative price, or a price with impossible precision.** Refused with an explanation before submission, using the application's existing rules for entering an amount.
- **An agent is created but the marketplace does not show it.** Expected when the agent is created unavailable, and the seller's own screen is the one place that distinguishes "not listed" from "listed but off". The seller's list shows it either way.
- **A sale for an agent the seller has since taken off the market, or edited.** The sale still lists, and a dispute over it shows the listing text the order pinned — not today's. A ruling explained with current text would break the trace from a citation to its source in the one direction that flatters the seller.
- **A sale in a state this screen does not recognise.** Its amount, agent, and time still render, labelled with whatever the state called itself, rather than the row vanishing.
- **A dispute is filed against a sale while the seller is looking at the list.** The sale's state changes on the screen's own reading cadence, without the seller acting.
- **A verdict arrives while the seller is reading the case file.** The ruling appears in place; the case file is not re-fetched or thrown away, and the seller's scroll position survives.
- **The seller looks for somewhere to respond.** There is nothing to find, on any of these screens, in any state — and the screen has already said that verdicts are final, so the search ends with an answer rather than a suspicion that a page failed to load.
- **A double submission of the create form.** Only one agent is created; the second submission is refused while the first is in flight.
- **A very long list of agents or sales.** Both stay scannable and scroll within their own regions rather than pushing each other off the screen.
- **A very large output or a long execution log in a case file.** It renders within its own region and does not push the verdict off the screen.
- **The session expires while a seller screen is open.** The screen stops showing the seller's own data and directs them to sign in again; it never renders another account's agents or sales.
- **Any of these screens is opened without being signed in.** No lists, no form, no controls — a prompt to connect, consistent with every other authenticated screen.
- **A server response that carries an execution-spec field it should not.** Nothing renders it, because no screen in this feature has anywhere to put one. The guarantee is structural, not a rule someone remembers.

## Requirements *(mandatory)*

### Functional Requirements

**The seller's home**

- **FR-001**: The application MUST provide a seller's home screen listing the agents the signed-in account owns and the sales those agents have made, as two distinct sections.
- **FR-002**: Each owned agent MUST show its name, its price, and whether it is currently available to buyers.
- **FR-003**: Agents that are not currently available MUST be listed alongside available ones, visibly distinguished, and MUST NOT be omitted.
- **FR-004**: Each sale MUST show the agent it was for, its amount, its current state, and when it occurred.
- **FR-005**: A sale that is in dispute or has been ruled on MUST be visibly distinguished from an ordinary sale and MUST offer a way to reach that dispute.
- **FR-006**: The screen MUST re-read both lists on a recurring cadence while it is open, so that a dispute filed elsewhere appears without the seller acting, and MUST NOT revert either list to a placeholder between reads.
- **FR-007**: Each list MUST report its own empty state in words, and MUST report its own load failure with a retry, without taking the other list down with it.
- **FR-008**: The screen MUST offer a way to list a new agent, present without scrolling past the lists.
- **FR-009**: A sale whose state this screen does not recognise MUST still be listed with its agent, amount, and time, labelled with the state it reports.
- **FR-010**: Both lists MUST scroll within their own regions when long, leaving the other section reachable.

**Creating an agent**

- **FR-011**: The application MUST provide a create-agent screen collecting a name, a description, a price, capability claims, exclusions, an input contract, an output contract, a system prompt, and a model.
- **FR-012**: Capabilities and exclusions MUST each be collected as an ordered set of individually added and removed terms, not as a single undivided block of text.
- **FR-013**: The screen MUST state, beside those two fields, that they are contract terms quoted verbatim in verdicts — that vague capabilities lose disputes and precise exclusions win them — visible before the seller types rather than after.
- **FR-014**: Empty terms MUST be discarded before submission rather than sent as empty contract clauses.
- **FR-015**: The input and output contracts MUST be collected as raw text the seller writes or pastes. The screen MUST NOT provide a schema builder, field picker, or structured schema editor of any kind.
- **FR-016**: The screen MUST refuse to submit when either contract is not well-formed, naming which one, and MUST NOT send anything in that case.
- **FR-017**: The screen MUST NOT reject a well-formed contract on the grounds that it is not a meaningful schema.
- **FR-018**: The price MUST be entered and validated using the application's existing rules for entering a currency amount, refusing an empty, zero, negative, or impossibly precise value before submission.
- **FR-019**: The screen MUST refuse to submit with a missing name, description, or system prompt, identifying what is missing.
- **FR-020**: The submit control MUST NOT be operable twice while a submission is in flight, and MUST indicate that it is working.
- **FR-021**: A successful creation MUST take the seller to their own agents screen with the new agent present.
- **FR-022**: A failed creation MUST report its reason in place, preserve everything the seller entered, and allow a retry without re-entry.
- **FR-023**: The screen MUST send the system prompt and model as part of the created agent, and MUST NOT display either back to the seller after creation.

**Availability**

- **FR-024**: Each owned agent MUST offer a control to change whether it is available to buyers.
- **FR-025**: A successful change MUST be reflected in that agent's displayed availability without a manual refresh.
- **FR-026**: A change in flight MUST NOT be operable again until it resolves, and MUST indicate it is working.
- **FR-027**: A failed change MUST report its reason and leave the control showing the agent's true availability, never the attempted one, and MUST allow a retry.
- **FR-028**: A change to one agent MUST NOT disturb the rest of the screen.

**The seller's view of a dispute**

- **FR-029**: The application MUST provide the seller with a view of a disputed sale showing the buyer's input, the buyer's acceptance criteria, the listing's capabilities and exclusions as they stood when the order was placed, the delivered output, and the execution steps.
- **FR-029a**: That view MUST be its own screen within the seller's area, reached from the sale it belongs to, and MUST NOT be an expansion inside the sales list. The evidence and the ruling together are taller than a list row can carry, and two open disputes in one list is a page nobody can read.
- **FR-029b**: That screen MUST NOT be served by the buyer's order screen, and MUST NOT introduce a branch into it. The buyer's screen is the product's hero and is judged on being the state machine on screen for one party; a second party's face inside it is a conditional in the worst possible place.
- **FR-030**: That view MUST show Guardian's verdict when one exists, with its tier, its reasoning, its citations, and the resulting split between buyer and seller.
- **FR-031**: Citations MUST be presented as a clause-by-clause checklist, each attributed to a capability, an exclusion, or a buyer's criterion, and each marked met or unmet — never as prose alone.
- **FR-032**: The view MUST contain no control to reply, appeal, respond, contest, or comment, in any state. Such a control MUST be absent rather than present and disabled.
- **FR-033**: The view MUST state that the seller is notified of the outcome and that verdicts are final, so the absence of a reply is legible as a decision rather than an omission.
- **FR-034**: A dispute not yet ruled on MUST render the case file and say the ruling has not been made, and MUST show the verdict when it arrives without the seller reloading.
- **FR-035**: The case file and the verdict MUST each report their own load failure in place, with a retry, without preventing the other from rendering.
- **FR-036**: A sale that was never disputed MUST render as a sale with a statement that there is no dispute, rather than an error or an empty case file.

**Boundaries**

- **FR-037**: No screen in this feature MUST display a system prompt, a model, or any other execution-spec value returned by the server — including in the seller's own case file, where the content is the seller's own.
- **FR-038**: This feature MUST NOT provide agent editing, version history, or version comparison.
- **FR-039**: This feature MUST NOT provide seller analytics, earnings charts, or payout scheduling. Money is the wallet screen's subject and is not duplicated here.
- **FR-040**: This feature MUST NOT request a wallet signature or submit any transaction from the browser; registering an agent on-chain is the backend's work.
- **FR-041**: Every screen in this feature MUST require an established session, showing no lists, form, or controls otherwise, consistent with the application's existing authenticated screens.
- **FR-042**: This feature MUST reuse the application's existing money formatting, verdict presentation, case-file presentation, loading and error conventions, and reading cadence rather than introducing its own.
- **FR-043**: No automated tests are produced for this feature; its acceptance is verified by hand (see Assumptions).

### Key Entities

- **Owned agent**: an agent listed by the signed-in account. Carries the public listing — name, description, price, capabilities, exclusions, and the two contracts — plus a private execution spec the seller writes once and this application never reads back, and an availability flag that decides whether buyers can see it.
- **Capability claim**: one explicit thing the agent does, in the seller's own words. Half of Guardian's yardstick, quoted verbatim in verdicts.
- **Exclusion**: one explicit thing the agent does not handle. The seller's defence, written in advance; the clause that turns "was that reasonable to expect?" into something citable.
- **Input contract / output contract**: the declared shape of what a buyer must supply and what comes back, authored as raw text. The output contract is what makes a verdict arithmetic rather than an opinion, which is why the form takes it even though nothing in this feature reads it.
- **Sale**: one order placed against an agent the account owns — its agent, its amount, its state, and its time. The seller's view of the same order the buyer sees from the other side.
- **Case file**: the evidence Guardian was handed for a disputed sale — the buyer's input and criteria, the listing text pinned at purchase, the output, and the execution steps.
- **Verdict**: the ruling on a disputed sale — a tier, reasoning, citations against listing terms and buyer criteria, and the split. Final: it is delivered to the seller, and it is not answerable.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A person who has not used the product before lists a working agent through the form, unaided, in under 5 minutes, and finds it in the public marketplace immediately afterwards.
- **SC-002**: A newly listed agent is purchasable through the ordinary buyer flow with no manual data fix in between, in ten consecutive attempts.
- **SC-003**: An observer asked what capabilities and exclusions are for answers correctly from the form's own wording, without being told.
- **SC-004**: No control to reply, appeal, or respond to a verdict exists anywhere in this feature, in any state, across a full rehearsal — verified by inspection of every screen, including their disabled and empty states.
- **SC-005**: A seller shown their dispute view can state, within 30 seconds and from the screen alone, which clause the ruling turned on and how the money split.
- **SC-006**: A seller reading their dispute view knows, without asking, that there is no appeal — the screen says so.
- **SC-007**: Malformed input and output contracts are refused before submission in 100% of attempts, naming which contract is at fault, with nothing sent.
- **SC-008**: An agent switched off disappears from the public marketplace, and switched on returns to it, in ten consecutive attempts.
- **SC-009**: A dispute filed against a seller's sale appears on their sales list within 6 seconds without the seller acting.
- **SC-010**: No system prompt, model, or other execution-spec value appears on any screen in this feature, in any rehearsal — including in a seller's own case file.
- **SC-011**: Every refusal and failure path — invalid contract, invalid price, missing field, a failing creation, a failing availability change, a failing list, a failing case file, a failing verdict — renders a stated reason and a way forward; none renders a blank region, a silent no-op, or an unhandled error.
- **SC-012**: No double submission creates two agents or applies an availability change twice, across ten deliberate double-click attempts on each control.

## Assumptions

- **The backend serves the seller's own agents, filtered to the signed-in account, including agents that are not currently available.** A list that hid unavailable agents would make the availability control unusable, since switching one off would remove it from the only screen that can switch it back on.
- **The backend serves the account's sales as seller**, distinct from its orders as buyer, and each sale carries enough to identify its order so a dispute can be opened from it.
- **Creating an agent is a single request that returns when the agent exists**, including its on-chain registration. This screen therefore has nothing to poll for after submitting, and treats the response as the completion.
- **An agent's availability is changed by a single request against that agent**, and the request is the authority on the new state — the control reflects what the server confirms, not what was clicked.
- **A newly created agent is available by default** unless the platform says otherwise; if it is not, the seller's own list is where that is visible and the availability control is how it is corrected.
- **The seller's dispute screen is built from the sale, the case file, and the verdict** — the three things a seller is entitled to — and not from the buyer's order read, which is scoped to the account that placed the order. If the sales list does not carry enough to render the sale's own header, that is a gap to close in the sales list rather than a reason to reach for the buyer's read.
- **The seller's copy of a case file comes from the same case-file source the buyer's does**, differing in what the backend chooses to include. This application renders whichever fields it already knows how to render and adds no code path for any other, which is why the system-prompt guarantee holds regardless of what the seller's copy contains.
- **A dispute over a sale is explained with the listing text the order pinned**, not the agent's current text. This is the backend's guarantee; this feature depends on it and does not compensate for it by fetching the agent.
- **Verdict and case-file presentation already shipped are reused unchanged.** This feature adds no second way to render a ruling; if the seller's view needs anything the existing presentation cannot do, that is a gap in this assumption rather than a licence to build a parallel component.
- **The model field is free text with a sensible default**, because no allowlist of models is exposed to this application. A picker would either hard-code a list that drifts from the backend's or require an endpoint that does not exist.
- **Contract validation is well-formedness only.** The seller is authoring JSON in a textarea; this application checks that it parses and hands the rest to the backend, which is the party that knows what a valid contract is.
- **The reading cadence for the seller's home matches the application's existing five-second cadence** for list screens, reusing the existing reading mechanism rather than introducing a new one.
- **The create form does not read anything back.** It is write-only with respect to the execution spec, which is what lets the no-prompt-rendering guarantee be structural rather than remembered.
- **One account is both buyer and seller.** There is no role to switch into and no separate registration; these screens are simply the ones that read the account's seller-side resources.
- **These screens are supporting, not demo-critical.** They are the answer to "can anyone join?", not part of the three acts, and design budget is spent accordingly — correct, complete, and plain rather than the product's showpiece.
- **No automated tests are written for this feature.** This is a deliberate, time-boxed MVP decision recorded in the component briefing: the only kept test suite is the escrow contract's. Acceptance here is verified by hand, and the demo rehearsal is the real regression check.
