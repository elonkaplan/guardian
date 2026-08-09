# Feature Specification: Verdict card & case file

**Feature Branch**: `005-verdict-card`

**Created**: 2026-08-08

**Status**: Draft

**Input**: User description: "docs/specs/UI-05-verdict-card.md — The component that decides whether the audit reads as credible or as 'the AI decided something.' In scope: the verdict card (tier badge 0/25/50/75/100, the split of you-get / seller-gets, reasoning text); citations rendered as a ✓/✗ checklist, each showing its source (capability · exclusion · criterion), the quoted clause, and whether it was met; the transaction hash linked to MonadVision; and a case-file panel carrying the buyer's input, the acceptance criteria, the listing's promises and exclusions, the execution steps and their timings. Out of scope: automated tests of any kind, client-side redaction (the API does it), appeal UI (there are no appeals), verdict editing."

## Overview

A dispute ends with a number: the buyer gets some fraction of their money back and the seller keeps the rest. Everything about whether this product is believable turns on how that number is presented.

There are two ways to present it, and they carry the same information to completely different effect. One is a paragraph — *"Guardian reviewed the delivery and determined a 50% refund was appropriate."* The other is a list of clauses, each quoted from a document that existed before the work started, each marked met or unmet. The first asks for trust in a model. The second hands the reader the evidence and lets them arrive at the same conclusion on their own. This feature exists to make sure the product ships the second one.

That is why the citation checklist is not a presentational detail of this screen — it is the screen's entire argument, and the reasoning text is its supporting paragraph rather than its substitute. A verdict card that renders beautifully typeset prose and no checklist has failed this feature even if every word of the prose is correct.

Two other things make the ruling checkable rather than merely stated. **The transaction hash** is the one claim on the page a sceptic can verify without taking anything here on faith: they follow the link to a public block explorer and see the money move. **The case file** is the evidence Guardian was handed — the buyer's own input, the criteria they wrote before any work happened, what the listing promised and excluded, and what the agent actually did, step by step, with timings. Together they answer the two questions a doubtful observer asks in order: *did the money really move?* and *did it see what I see?*

One constraint runs through all of it. The seller's system prompt is their intellectual property, and a buyer must never see it — otherwise filing a frivolous complaint becomes a way to steal a seller's work. The upstream service is what redacts; this screen adds no redaction of its own and instead makes the leak structurally impossible, by having nowhere to put a prompt even if one arrived.

The people served: the **buyer**, who wants to know what they got back and why; the **sceptical observer** in a demo audience, who is the real audience for the checklist and the explorer link; and the **demo operator**, for whom this is the closing beat of the second act.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Read the ruling and the split (Priority: P1)

A buyer whose complaint has been ruled on opens their order. The outcome is stated at the top of the record: what fraction of the price came back, in plain money, alongside what the seller kept, and Guardian's explanation of how it got there.

**Why this priority**: It is the outcome of the dispute. Nothing else in this feature has a place to live until the card exists and states the ruling.

**Independent Test**: Take an order through a complaint to a ruling, open it, and confirm the card states the refund tier, both money figures, and the reasoning — and that the two figures add up to what was paid.

**Acceptance Scenarios**:

1. **Given** an order that has been ruled on, **When** the screen renders, **Then** a verdict card is displayed as the conclusion of the record, showing the refund tier, the amount returned to the buyer, the amount kept by the seller, and Guardian's reasoning.
2. **Given** the verdict card, **When** the tier is displayed, **Then** it is shown as a proportion a person reads without conversion — none, a quarter, a half, three quarters, or the full price — rather than as an internal code.
3. **Given** the verdict card, **When** the two money figures are displayed, **Then** both are always shown, both are labelled by who receives them, and together they equal the price the buyer paid for the order.
4. **Given** a ruling that awards no refund at all, **When** the card renders, **Then** it still shows both figures — zero to the buyer, the full price to the seller — rather than omitting the buyer's side or showing only the tier.
5. **Given** a ruling that awards the full price back, **When** the card renders, **Then** it shows the full price to the buyer and zero to the seller, on the same two-figure layout as every other tier.
6. **Given** the verdict card, **When** the reasoning is displayed, **Then** it is presented as supporting explanation beneath or beside the checklist, and never as the only account of why the ruling came out as it did.

---

### User Story 2 - Check the ruling against the clauses (Priority: P1)

The buyer — or somebody watching over their shoulder — reads down a list of clauses. Each one names where it came from, quotes it word for word, and carries a ✓ or an ✗. They can see for themselves which promises held and which did not, and the tier stops being an opinion.

**Why this priority**: This is the feature's reason for existing. A verdict without a checklist is the failure mode the whole component was specified to prevent.

**Independent Test**: On a ruled order, confirm the citations render as a list of discrete marked rows — not a paragraph — with each row showing its origin, the quoted clause, and an unambiguous met/unmet mark.

**Acceptance Scenarios**:

1. **Given** a ruling with citations, **When** the card renders, **Then** each citation appears as its own row in a checklist, visually separated from the others, and never merged into running prose.
2. **Given** a citation row, **When** it renders, **Then** it states which side of the contract the clause came from — a capability the listing promised, an exclusion the listing declared, or a criterion the buyer wrote — using wording a reader understands without a legend.
3. **Given** a citation row, **When** it renders, **Then** it shows the clause quoted verbatim and marked as a quotation, not paraphrased or summarised on screen.
4. **Given** a citation row, **When** it renders, **Then** whether the clause was met is conveyed by a mark that does not rely on colour alone, so it survives a projector, a colour-blind reader, and a monochrome screenshot.
5. **Given** a ruling whose citations include both met and unmet clauses, **When** the checklist renders, **Then** met and unmet rows are distinguishable at a glance from across a room, and the unmet ones are the ones that draw the eye.
6. **Given** a ruling that arrived with no citations at all, **When** the card renders, **Then** the checklist area states plainly that no clauses were cited rather than rendering an empty region, and the card does not present the reasoning as though it were a citation.
7. **Given** a citation whose quoted clause is very long, **When** the row renders, **Then** the row remains readable and the checklist stays scannable, without one clause pushing the rest of the card off screen.

---

### User Story 3 - Verify that the money actually moved (Priority: P1)

The reader does not have to believe the split happened. They follow the transaction link out to a public block explorer and see it.

**Why this priority**: It is the only claim on the page that can be checked independently of this product entirely, which makes it the one that converts a sceptic.

**Independent Test**: On a settled order, confirm the transaction reference is shown and that following it opens the public explorer at that exact transaction.

**Acceptance Scenarios**:

1. **Given** a settled order, **When** the card renders, **Then** the settlement transaction reference is displayed and is followable to a public block explorer entry for that transaction.
2. **Given** the transaction reference, **When** it is displayed, **Then** it is shortened for legibility but the full value remains obtainable — by copying it — so it can be checked elsewhere.
3. **Given** the transaction link, **When** it is followed, **Then** it opens away from this application without navigating the order screen away from the order, and it is marked as leaving the site.
4. **Given** a ruling that exists but whose settlement has not yet been recorded, **When** the card renders, **Then** it states that settlement is still completing and shows no transaction link, rather than an empty link, a placeholder hash, or a dead control.
5. **Given** an order whose settlement completes while the screen is open, **When** the transaction becomes known, **Then** the link appears on its own, without the buyer refreshing or navigating.

---

### User Story 4 - Read what Guardian was given (Priority: P2)

The buyer opens the case file: the input they submitted, the criteria they wrote, what the listing promised and ruled out, and what the agent actually did — each step with its timing. It is the evidence, presented as the evidence.

**Why this priority**: It turns the checklist's quotes into things with a visible provenance. Valuable, but the ruling and the checklist are legible without it, which is why it ranks below them.

**Independent Test**: On a disputed or ruled order, open the case file and confirm it shows the submitted input, the acceptance criteria, the listing's promises and exclusions, and the execution steps with timings — and contains nothing resembling the seller's instructions to their agent.

**Acceptance Scenarios**:

1. **Given** an order with a dispute on it, **When** the case-file panel renders, **Then** it presents the buyer's submitted input, the acceptance criteria as written at purchase, the capabilities the listing promised, the exclusions it declared, and the execution steps.
2. **Given** the execution steps, **When** they render, **Then** each step shows what the agent did and how long it took, in order, and any error a step produced is shown rather than hidden.
3. **Given** the case-file panel, **When** it renders, **Then** the clauses quoted by the citation checklist are recognisable as the same text that appears in the listing and criteria sections, so a reader can trace a citation back to its source.
4. **Given** an order under arbitration but not yet ruled on, **When** the screen renders, **Then** the case file is available to read while the ruling is pending, and no verdict card is shown.
5. **Given** an order that was never disputed, **When** the screen renders, **Then** no case-file panel is offered.
6. **Given** the case file, **When** any part of it renders, **Then** nothing describing the seller's private instructions to their agent appears anywhere in it.
7. **Given** a case file whose steps or input are large, **When** the panel renders, **Then** it does not overwhelm the verdict card — the ruling remains the first thing read, and the evidence is available beneath or behind it.

---

### User Story 5 - The verdict arrives on its own (Priority: P2)

The buyer is on the order screen while Guardian is still reviewing. They do nothing. The ruling appears, and then the transaction appears under it.

**Why this priority**: The screen already follows the order live; this feature must fit into that motion rather than requiring a reload to reveal itself. It is the closing beat of the demo's second act.

**Independent Test**: Sit on a disputed order until it is ruled and settled. Confirm the card appears without interaction, then the transaction link appears, and that repeated background reads stop once the order is finished.

**Acceptance Scenarios**:

1. **Given** the screen is open on an order under arbitration, **When** the ruling is recorded, **Then** the verdict card appears without a refresh or a click.
2. **Given** the verdict card is showing for a ruling whose settlement is pending, **When** settlement completes, **Then** the card updates in place to show the settled transaction, and the card's other contents do not visibly rebuild or flicker.
3. **Given** an order that is already settled, **When** the screen is opened directly, **Then** the complete card renders on first paint without a visible intermediate state that lacks the ruling.
4. **Given** a settled order, **When** the card and case file have been read once, **Then** the screen issues no further repeated reads for them, because none of it can change again.
5. **Given** the verdict cannot be read while the order says it has been ruled on, **When** the card renders, **Then** it explains that the ruling could not be loaded and offers a retry, rather than leaving the conclusion of the record blank.

---

### Edge Cases

- **A ruling exists but the chain settlement has not landed.** The card shows the tier, split, reasoning, and checklist with a settlement-pending note and no transaction link. It never renders a link with nothing behind it.
- **Settlement lands but the recorded transaction reference is absent.** The card reports the order as settled and states that no transaction reference is available, rather than silently dropping the proof or inventing a placeholder.
- **A citation names a source type this screen does not recognise.** The row still renders, with its quote and its mark, labelled by whatever the ruling called it — an unfamiliar source is not a reason to drop evidence from the list.
- **A citation is missing its quote, or its met/unmet mark.** The row is shown as incomplete rather than guessed at; an unmarked clause is never rendered as met.
- **The ruling's tier and the recorded refund amount disagree.** The recorded amount governs both figures — it is what the chain settled — and the two figures still sum to the price. The split is never recomputed from the tier's percentage.
- **The reasoning text is empty.** The checklist stands on its own and the card does not collapse; a missing paragraph is not a missing verdict.
- **The reasoning text quotes the agent's own instructions.** The upstream service is responsible for preventing this; this screen adds no redaction, but it also has no field in which a seller's prompt could arrive and no code path that would render one.
- **The case file cannot be loaded while the verdict can.** The card renders in full and the case-file panel reports its own failure with a retry; one panel's failure never blanks the other.
- **A very long reasoning text, or dozens of citations.** The card stays scannable — the tier, split, and checklist remain readable without hunting, and long content scrolls within its own region rather than burying the rest of the page.
- **The order is settled but was never disputed** — an uncontested release. No verdict card is shown at all, because there was no ruling; the released outcome belongs to the order screen's existing conclusion.
- **The screen is opened by someone who is not the buyer, or the session expires.** The card and case file are subject to the same access rules as the order itself and show nothing before authorisation is established.
- **A very small order price.** The split figures are still exact currency amounts that sum to the price; no rounding artefact makes them disagree with what settled.

## Requirements *(mandatory)*

### Functional Requirements

**The verdict card**

- **FR-001**: The screen MUST display a verdict card for an order that has been ruled on, occupying the concluded region reserved by the order screen, and MUST NOT display one for an order that was never disputed.
- **FR-002**: The card MUST show the refund tier as a human-readable proportion of the price, MUST show the amount returned to the buyer and the amount kept by the seller as two separately labelled currency figures, and MUST show Guardian's reasoning text.
- **FR-003**: Both money figures MUST always be present, including when one of them is zero, and together they MUST equal the price paid for the order.
- **FR-004**: The split figures MUST be derived from the refund amount recorded with the ruling — the figure that was settled — and MUST NOT be recomputed on this screen from the tier's percentage.
- **FR-005**: The reasoning text MUST be presented as support for the citation checklist and MUST NOT be the only account of the ruling shown; a card that renders reasoning without a checklist region does not satisfy this feature.
- **FR-006**: The card MUST render its ruling content even when the reasoning is empty or the citation list is empty, without collapsing to a blank region.

**The citation checklist**

- **FR-007**: Citations MUST be rendered as a checklist of discrete rows, one per citation, and MUST NOT be rendered as running prose or a comma-separated sentence.
- **FR-008**: Each row MUST identify the clause's origin — a capability promised by the listing, an exclusion declared by the listing, or a criterion written by the buyer — in wording readable without a legend.
- **FR-009**: Each row MUST present the clause quoted verbatim and visibly marked as a quotation.
- **FR-010**: Each row MUST show whether the clause was met, using a mark that is distinguishable without relying on colour alone.
- **FR-011**: Met and unmet rows MUST be visually distinguishable at demo-projection distance, with unmet rows given the greater visual weight.
- **FR-012**: When a ruling carries no citations, the checklist region MUST state that no clauses were cited rather than render nothing.
- **FR-013**: A citation with an unrecognised origin, a missing quote, or a missing met/unmet mark MUST still be listed, presented as incomplete; an unmarked clause MUST NOT be rendered as met.
- **FR-014**: A long quoted clause MUST NOT break the card's layout or push other rows out of view; the checklist MUST remain scannable.

**The transaction**

- **FR-015**: When the settlement transaction is known, the card MUST display its reference and MUST link it to the public block explorer entry for that transaction.
- **FR-016**: The transaction reference MUST be displayed in a shortened form while leaving the complete value obtainable by the reader for checking elsewhere.
- **FR-017**: The explorer link MUST open outside the application without navigating the order screen away, and MUST be marked as an external destination.
- **FR-018**: When no settlement transaction is recorded, the card MUST say so — settlement pending, or unavailable — and MUST NOT render a link, a placeholder reference, or a disabled control that looks like one.
- **FR-019**: The explorer destination MUST come from the application's single configured chain-and-explorer definition; this feature MUST NOT introduce a second explorer address.

**The case file**

- **FR-020**: The screen MUST present a case-file panel for an order that has a dispute on it, available both while arbitration is pending and after the ruling.
- **FR-021**: The panel MUST show the buyer's submitted input, the acceptance criteria as captured at purchase, the capabilities the listing promised, the exclusions it declared, and the execution steps.
- **FR-022**: Execution steps MUST be shown in order, each with what the agent did, its timing, and any error it produced.
- **FR-023**: The clauses shown in the panel MUST be the same text the citation checklist quotes, so a reader can trace a citation to its source.
- **FR-024**: The panel MUST NOT displace the verdict card as the first thing read on a concluded order; large inputs, outputs, or step lists MUST scroll within their own regions.
- **FR-025**: The case-file panel MUST NOT be offered for an order that was never disputed.

**Redaction and boundaries**

- **FR-026**: No part of this feature MUST render the seller's private instructions to their agent, and no code path capable of doing so MUST exist — the data this screen consumes MUST have nowhere to carry one.
- **FR-027**: This feature MUST NOT perform redaction of its own — it renders what it is given, and summarisation of reasoning text is the upstream service's responsibility (recorded in Assumptions).
- **FR-028**: This feature MUST NOT offer any means of appealing, disputing, editing, annotating, or re-running a verdict; the ruling is presented as final and read-only.
- **FR-029**: This feature MUST NOT request a wallet signature or perform any on-chain transaction; it reads and links, and nothing more.
- **FR-030**: The card and the case file MUST be subject to the same access rules as the order itself and MUST render nothing before authorisation is established.

**Loading, failure, and live behaviour**

- **FR-031**: When the order is ruled on while the screen is open, the card MUST appear without a refresh or a click; when settlement subsequently completes, the card MUST update in place rather than rebuilding.
- **FR-032**: On an order that is already settled when the screen loads, the ruling is fetched as a second request gated on the order's state, so the screen MUST show a **labelled** loading line in the concluded region while it arrives — never a blank region, and never a card that appears complete while the ruling is still missing. *(Amended post-build to describe what ships. The original wording forbade any intermediate state, which would require prefetching the verdict from the route's order id in parallel. That was rejected: research R6 keeps the verdict off the 1s order poll, and a briefly labelled line is a smaller cost than putting an immutable row on a one-second schedule.)*
- **FR-033**: Once the ruling and its settlement are final, the screen MUST NOT continue repeated background reads of them.
- **FR-034**: A failure to load the ruling MUST be reported in place with a retry, and MUST NOT leave the concluded region blank.
- **FR-035**: A failure to load the case file MUST be reported within its own panel with a retry and MUST NOT prevent the verdict card from rendering, and vice versa.
- **FR-036**: No automated tests are produced for this feature; its acceptance is verified by hand (see Assumptions).

### Key Entities

- **Verdict**: the ruling on a disputed order — its refund tier, the refund amount actually settled, the reasoning text, the citations, and the settlement transaction reference once one exists. Exactly one per order; it is never amended, which is what makes this screen read-only.
- **Citation**: one clause Guardian weighed — where the clause came from (a listing capability, a listing exclusion, or a buyer criterion), the clause quoted verbatim, and whether it was met. The unit of the checklist and the unit of the feature's credibility.
- **Refund tier**: the proportion of the price returned to the buyer — none, a quarter, a half, three quarters, or the full amount. A label for the outcome, not the arithmetic behind the figures.
- **Case file**: the evidence the ruling was made from — the buyer's input, the acceptance criteria, the listing's promises and exclusions, and the execution steps with their timings. The buyer's copy is redacted upstream; the seller's own copy is not this feature's concern.
- **Execution step**: one action the agent took, with its timing and any error. Shown to make the ruling legible, and the reason the redaction boundary is wider than one field.
- **Settlement transaction**: the on-chain movement that split the escrow. The one item on the page verifiable outside this product.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A person who has never seen the product, shown a ruled order, can name which specific clauses were not met without reading the reasoning paragraph.
- **SC-002**: In ten consecutive rehearsals, the verdict card appears on its own within 2 seconds of the ruling being recorded, and the transaction link appears within 2 seconds of settlement, with no refresh or click.
- **SC-003**: 100% of rulings shown display two money figures that sum exactly to the order price, across every tier including none and full.
- **SC-004**: Following the transaction link lands on the public explorer's page for that exact transaction, on the first attempt, in 100% of settled rehearsals.
- **SC-005**: The tier, both figures, and every citation row are legible from the back of a demo room on the presentation display, without zooming.
- **SC-006**: The met/unmet state of every citation row remains unambiguous in a greyscale screenshot of the card.
- **SC-007**: No screen in this feature displays the seller's private agent instructions in any rehearsal, and a review of the feature's data shapes confirms there is no field in which one could arrive.
- **SC-008**: Every failure path — ruling not loadable, case file not loadable, settlement not yet recorded, no transaction reference, no citations — renders a stated explanation and, where recovery is possible, a retry; none renders a blank region or an unhandled error.
- **SC-009**: A reader can trace any quoted citation to the corresponding text in the case file in under 15 seconds.
- **SC-010**: The second act of the demo runs end to end twice in a row after a reset, concluding on a fully populated verdict card each time, with no manual intervention outside the interface.

## Assumptions

- **The backend serves the ruling and the case file as documented**, at reads addressed by the order, returning the tier, the settled refund amount, the reasoning, the citations, and the settlement transaction reference once one exists. This feature is a client of that contract and introduces no second source for any of it.
- **Redaction happens upstream, in one place.** The buyer's copy of the case file excludes the seller's system prompt and summarises reasoning text rather than passing it through raw, because a step can paraphrase its own instructions. This screen adds none of its own — and, as with the order and listing shapes already shipped, the absence of a field for it is the guarantee rather than everyone remembering.
- **Citations arrive as structured records**, each carrying an origin, a quoted clause, and a met/unmet mark — not as pre-formatted text. If they arrived as prose the feature's central requirement could not be met, so this is treated as a contract requirement on the upstream service rather than a display problem to solve here.
- **The case file appears from the moment a dispute exists**, not only after the ruling, because the order screen's arbitration face already promises the evidence Guardian is reading.
- **The refund amount recorded with the ruling is authoritative** for both figures; the tier is a label. The seller's figure is the price less the refund, which is why the two always reconcile with what settled on-chain.
- **A ruling is final and singular.** There are no appeals, no amendments, and no re-audits, which is what allows this screen to be read-only and to stop reading once settled.
- **The chain and explorer definition already shipped is reused**; this feature adds no new explorer address and no new network configuration.
- **This feature fills the region the order screen already reserved** for the conclusion of a disputed order, replacing its placeholder rather than introducing a new page or route.
- **Money formatting, live-reading cadence, and the order screen's access and error handling are reused** from the features that shipped them.
- **An uncontested release has no verdict**, and nothing in this feature renders for one; that outcome belongs to the order screen's existing concluded face.
- **The buyer is a human**, and the seller's own unredacted view of the same case file is a separate feature.
- **No automated tests are written for this feature.** This is a deliberate, time-boxed MVP decision recorded in the component briefing: the only kept test suite is the escrow contract's. Acceptance here is verified by hand, and the demo rehearsal is the real regression check.
