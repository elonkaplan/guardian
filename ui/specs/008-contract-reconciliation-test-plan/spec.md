# Feature Specification: Contract Reconciliation & Manual Test Plan

**Feature Branch**: `008-contract-reconciliation-test-plan`

**Created**: 2026-08-09

**Status**: Draft

**Input**: User description: "`ui/docs/specs/UI-08-reconciliation-and-test-plan.md` — reconcile the frontend against the API's published contract, and write the manual test plan a human executes to verify everything UI-01…07 deferred."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - The screen shows what the API actually sent (Priority: P1)

A buyer opens a settled order and reads the verdict card. A seller opens their agent
list. Neither of them sees a blank row, a missing warning, a stale figure, or a page
that has thrown. Every value the API sends that the product promised to show, the
product shows — because every boundary between the frontend and the API has been
compared against the contract the API publishes, field name by field name, in both
directions.

This is the story with a known casualty. The citation checklist reads one field name;
the API sends a different one. The shapes agree, so nothing complained — not the type
checker, not the build, not a test, because there are none. The checklist renders empty
rows on stage. The seller's list has a second: an agent whose on-chain registration
never confirmed is drawn identically to a healthy one, so a seller advertises something
nobody can buy and has no way to find out.

**Why this priority**: These are not polish. Each one is a visibly wrong screen during
the demo, and each one currently passes every check that exists. Nothing else in this
feature matters if the screens are lying.

**Independent Test**: Walk the contract end to end against the frontend's boundaries
and fix each disagreement. Verifiable on its own: open a settled order and confirm the
citation checklist renders quoted clause text rather than empty quotation marks; open a
seller's agent list containing an unregistered agent and confirm it is visibly marked
as unbuyable.

**Acceptance Scenarios**:

1. **Given** the API returns a verdict whose citations carry clause text, **When** a
   buyer opens the settled order, **Then** each checklist row displays that clause text
   beside its ✓ or ✗ mark, and no row renders as empty quotation marks.
2. **Given** a seller owns an agent whose registration never confirmed, **When** the
   seller opens their agent list, **Then** that agent is visibly distinguished from
   buyable agents, and the distinction survives desaturation.
3. **Given** the API emits an order state or ledger kind the frontend has never
   rendered before, **When** a page receives it, **Then** the page displays something
   intelligible and does not blank or throw.
4. **Given** a seller opens a disputed sale of their own agent, **When** they request
   the case file and verdict, **Then** both load and are readable, and no control to
   reply to the dispute is offered.
5. **Given** the API returns a status code for a genuinely missing or forbidden
   resource, **When** the frontend receives it, **Then** the frontend stops and reports
   it rather than retrying indefinitely.
6. **Given** settled funds are unknown rather than zero, **When** the wallet page
   renders, **Then** the figure reads as unknown and not as `$0.00`.

---

### User Story 2 - A tester runs a full acceptance pass without reading any code (Priority: P2)

Someone who has never opened this repository sits down with a browser and a document.
They start at the preconditions, work down, and mark each step passed or failed. At the
end they can say, without hedging, whether the product works — and if something failed,
they can describe it well enough for whoever fixes it to know where to look.

Every acceptance criterion in UI-01 through UI-07 was deferred to a manual pass. This
is that pass, written down.

**Why this priority**: The frontend can only be verified by hand — automated tests are
out of scope for this component by an explicit MVP decision. Without a written plan,
"verified" means whatever the last person to click around happened to try, and the
deferred criteria quietly become criteria nobody ever checked.

**Independent Test**: Hand the finished document to someone unfamiliar with the source
and watch them execute it. Every step either passes or fails; no step requires them to
ask what "correct" means, and no step requires reading source to interpret.

**Acceptance Scenarios**:

1. **Given** a tester with only the plan and a browser, **When** they read the
   preconditions section, **Then** every service, port, funded wallet, seed step, and
   wallet-network setting they need is listed before step one — and nothing required is
   discovered mid-run.
2. **Given** a tester reaches any step in the plan, **When** they perform it, **Then**
   the step states exactly one expected result concrete enough that pass or fail is not
   a judgement call.
3. **Given** a step fails in a way whose cause is not obvious, **When** the tester
   consults the plan, **Then** the plan names the symptom and what it most likely
   indicates.
4. **Given** a tester finishes a full pass, **When** they want to run it again,
   **Then** the plan tells them how to reset, and states what the reset does and does
   not clear.
5. **Given** someone needs to schedule a pass, **When** they open the plan, **Then** it
   states roughly how long a full pass takes.

---

### User Story 3 - Nothing deferred is lost, and no defect is quietly absorbed (Priority: P3)

Two paper trails. The first records every disagreement found between the frontend and
the contract, and how each was resolved — including the ones where the API is the
defect and the resolution was "escalated, nothing changed in the frontend." The second
is the list of criteria earlier specs deferred: they appear by name in the test plan,
so a deferral is a scheduled check rather than a forgotten one.

**Why this priority**: Real but not demo-blocking on its own. Its value is that it stops
the next person from re-deriving the same findings, and stops a broken API from being
silently papered over in the client, where the workaround outlives the bug.

**Independent Test**: Read the divergence report's list of API defects and confirm each
one appears in the reconciliation record with a stated resolution. Read the carryover
list from the earlier specs and confirm each appears as a step in the test plan.

**Acceptance Scenarios**:

1. **Given** the divergence report classifies a behaviour as an API defect, **When**
   the reconciliation record is reviewed, **Then** that behaviour appears with what the
   frontend did about it — even when the answer is "nothing, escalated."
2. **Given** a disagreement was found and fixed, **When** the reconciliation record is
   reviewed, **Then** it states what differed, who the contract blames, and how it was
   resolved.
3. **Given** a criterion deferred by an earlier spec, **When** the test plan is
   searched for it, **Then** it appears as an executable step.

---

### Edge Cases

- **A contract that faithfully documents a bug.** The contract is written from the
  running implementation, so an incorrectly named or wrongly typed field appears in it,
  described accurately. Matching it blindly propagates the defect into the frontend.
  The divergence report is what separates "the API is right, fix the frontend" from
  "the API is wrong, escalate."
- **A field the frontend never declared.** A contract field no frontend type mentions
  arrives on the wire, is discarded, and produces no error anywhere. Checks that start
  from the frontend's types cannot see it; only walking the contract can.
- **A value the frontend cannot render.** The frontend branches exhaustively with no
  fallback, so a state or category the API can emit but the frontend has never seen
  does not degrade — it throws, taking the page with it.
- **A permanent failure treated as temporary.** If the API answers a missing resource
  with a code the frontend classifies as retryable, the page retries forever and never
  reports anything.
- **An endpoint the frontend believes is public.** The API's authorisation is global
  and fail-closed; an unauthenticated call lands on a page with no sign-in prompt and
  no explanation.
- **A filter that looks like a working feature.** If the seller's own-agent list
  excludes inactive agents, deactivating one appears to work perfectly — until someone
  tries to reactivate it and finds it gone.
- **Settled funds that are unknown rather than zero.** Rendering unknown as `$0.00`
  tells a seller their money is gone.
- **A citation quoting a very long clause.** The checklist must stay readable rather
  than overflow or truncate the mark that carries the decision.
- **An API defect that cannot be fixed before the demo.** The frontend records what it
  does instead; it does not grow a permanent workaround.
- **Guarantees held by omission.** Several frontend types promise "this never reaches
  the browser" by simply not declaring the field. Regenerating types from the contract
  would restore those fields and delete the guarantee while everything still compiles.

## Requirements *(mandatory)*

### Functional Requirements

#### Reconciliation — reading the contract

- **FR-001**: The reconciliation MUST read the divergence report before the contract,
  and MUST use it to classify each disagreement before deciding what to change.
- **FR-002**: Where the divergence report does not mention a behaviour, the contract
  MUST be treated as correct and the frontend changed to match it.
- **FR-003**: Where the divergence report classifies a behaviour as an API defect, the
  frontend MUST NOT be changed to match it; the defect MUST be escalated and recorded.
  If it cannot be corrected before the demo, the record MUST state what the frontend
  does instead.
- **FR-004**: Frontend types MUST NOT be generated from the contract. Fields absent
  from a frontend type by design — the seller's system prompt, the buyer's raw prompt
  and raw verdict payload, purchase-time price and review window — MUST remain absent
  after reconciliation.
- **FR-005**: A frontend type MUST NOT gain a field solely because the contract sends
  one; each addition requires a stated reason.

#### Reconciliation — field-level checks

- **FR-006**: Every frontend↔API boundary MUST be compared against the contract by
  field name string, not by field shape.
- **FR-007**: The comparison MUST also run contract→frontend: every field the contract
  sends that no frontend type declares MUST be enumerated and each one resolved as
  either "surface it" or "deliberately ignored, with a reason."
- **FR-008**: Citation clause text MUST be read from the field name the contract
  publishes, and MUST render inside each checklist row.
- **FR-009**: An agent's registration-confirmed status MUST be carried through to the
  seller's own-agent views, and an unconfirmed agent MUST be visibly distinguished from
  a buyable one by means that survive desaturation.
- **FR-010**: Every enumerated set the frontend branches on — order state, ledger
  entry kind, citation source, agent tier — MUST cover the contract's full member list.
- **FR-011**: Receiving an unrecognised member of any such set MUST NOT blank or crash
  the page.
- **FR-012**: Nullability MUST agree with the contract in both directions: no frontend
  type may treat a nullable contract field as guaranteed, and none may treat a
  guaranteed field as optional in a way that renders a placeholder over real data.
- **FR-013**: Money MUST be handled in minor units throughout, with the naming
  convention the contract uses, and a settled-funds figure that is unknown MUST render
  as unknown rather than as zero.
- **FR-014**: A single casing convention for field names MUST be decided once and
  applied at every boundary.
- **FR-015**: If the contract already supplies the seller's share of a split, the
  frontend MUST display that figure directly rather than deriving it, and the
  client-side derivation and its reconciliation guard MUST be removed.

#### Reconciliation — behaviour at the boundary

- **FR-016**: The frontend's classification of failures as fatal versus retryable MUST
  match the status codes the contract actually returns, and a permanently failing
  request MUST stop retrying and report.
- **FR-017**: Every endpoint the frontend calls MUST be confirmed against the contract
  as requiring or not requiring authentication, and no page may issue a call it
  believes is public against an endpoint the API guards.
- **FR-018**: Reads of an order, its case file, and its verdict MUST be reachable by
  the agent's owner as well as the buyer.
- **FR-019**: Every endpoint the frontend calls MUST exist in the contract.
- **FR-020**: Every endpoint the contract defines MUST be reachable from some page,
  except the documented off-ramp routes endpoint; any other unreachable endpoint MUST
  be named in the reconciliation record.
- **FR-021**: Query semantics MUST be verified, not just parameter names — in
  particular, a seller's own-agent listing MUST include inactive agents.
- **FR-022**: Every state transition the API can write MUST be one the frontend
  renders.

#### The reconciliation record

- **FR-023**: A reconciliation record MUST be produced containing one row per
  disagreement, stating what differed, how the divergence report classifies it, and how
  it was resolved.
- **FR-024**: Every API defect named in the divergence report MUST appear in the
  reconciliation record with a resolution.

#### The manual test plan — form

- **FR-025**: A manual test plan document MUST be produced, written for a tester with a
  browser who has not read the source.
- **FR-026**: Every step MUST state exactly one expected result, specific enough that
  pass or fail is not a judgement call. No step may ask the tester to confirm that
  something "looks correct" or "looks right."
- **FR-027**: Every step MUST carry a pass/fail column.
- **FR-028**: Wherever a failure would be subtle, the plan MUST name the visible
  symptom and what it most likely indicates.
- **FR-029**: The plan MUST state an approximate duration for a full pass.
- **FR-030**: The plan MUST give reset instructions between runs, including what the
  reset does and does not clear.

#### The manual test plan — coverage

- **FR-031**: A preconditions section MUST list everything that must be true before the
  first step: which services must be running and on which ports, which wallets need
  native and test-stablecoin funds, the seed step, and the browser wallet's required
  network. Anything the tester must fix belongs here rather than being discovered
  mid-run.
- **FR-032**: A smoke section MUST cover the app loading, the API's health and
  documentation endpoints answering, and a sign-in session surviving a page reload.
- **FR-033**: The plan MUST cover all three demo acts start to finish, each stating the
  exact input, the acceptance criteria text to type, the expected verdict tier, the
  expected split in dollars, and what appears on screen at every state change.
- **FR-034**: The acts MUST include steps confirming that the countdown reaching zero
  flips the page with no keyboard or mouse input; that a complaint moves the order to
  disputed and then to a verdict with no page refresh; that the transaction hash links
  out to a page that exists; and that balance figures move when an order settles.
- **FR-035**: A seller section MUST cover listing an agent, seeing it in the
  marketplace, deactivating it, watching it leave, and reactivating it; an agent whose
  registration never confirmed being visibly distinguished on the seller's own list;
  and opening a disputed sale as the seller to confirm the case file and verdict are
  readable and that no reply control is offered.
- **FR-036**: A money section MUST cover top-up, cash-out, and withdrawal, and the
  ledger that explains all three, with a step confirming the distinct money figures
  never collapse into one.
- **FR-037**: A degradation section MUST state what the tester should see when things
  fail: an unknown settled figure rather than zero, a labelled loading state rather
  than a blank card, and a page that never moves backwards through states.
- **FR-038**: A human-judgement section MUST cover four checks: a greyscale check on
  the verdict card and seller screens confirming ✓ and ✗ stay distinguishable when
  desaturated; legibility of tier, refund figure, and ✓/✗ marks at roughly three
  metres; a stranger reading a settled order and correctly stating what happened and
  why; and a citation quoting a very long clause not breaking the checklist.
- **FR-039**: A redaction section MUST direct the tester to inspect the network
  response for a buyer's case file rather than the rendered page, confirming that
  withheld fields were never sent.
- **FR-040**: The plan MUST name the carried-over criteria explicitly so none is lost:
  greyscale on the seller screens; the seller flow end to end; opening a settled order
  as the buyer to confirm the buyer/seller perspective setting changed nothing about
  the verdict card; the seller reading a disputed sale's case file and verdict; the
  verdict-card walkthrough parts deferred by the verdict-card spec; greyscale; three-
  metre legibility; long clauses; the stranger test; and the split-derivation removal.

#### Boundaries of this feature

- **FR-041**: This feature MUST NOT execute the test plan. No step may be reported as
  passing as part of delivering this feature.
- **FR-042**: This feature MUST NOT add automated tests of any kind.
- **FR-043**: This feature MUST NOT add features, redesign pages, or build pages that
  do not already exist. Something ugly but correct is left alone — except where it
  fails the greyscale or three-metre legibility check, which counts as incorrect rather
  than unpolished.

### Key Entities

- **Published contract**: The document describing what the API genuinely does, written
  from the running implementation. Accurate, therefore also accurate about the API's
  defects.
- **Divergence report**: The record of where the running API differs from its design
  document, and which side is wrong. Distinguishes "the API is the defect" from "the
  design is stale" from "deliberate." The first file read.
- **Reconciliation record**: One row per disagreement found — what differed, how the
  divergence report classifies it, how it was resolved. Includes every API defect, even
  the ones that were only escalated.
- **Manual test plan**: The executable checklist a human runs. Sections for
  preconditions, smoke, the three acts, the seller flow, money, degradation,
  human-judgement checks, and redaction. Each step: one action, one concrete expected
  result, one pass/fail box.
- **Carryover**: An acceptance criterion an earlier spec deferred to manual
  verification. Each becomes a named step in the plan.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A tester who has never read the source completes a full pass using only
  the plan, without needing to ask what any step means or consult source to interpret a
  result.
- **SC-002**: Zero steps in the plan have a subjective expected result — no step asks
  whether something looks right, looks correct, or seems fine.
- **SC-003**: 100% of the API defects named in the divergence report appear in the
  reconciliation record with a stated resolution.
- **SC-004**: Zero endpoints the frontend calls are missing from the contract, and zero
  contract endpoints are unreachable from the product apart from the one documented
  exception.
- **SC-005**: Every enumerated set the frontend branches on matches the contract member
  for member, and feeding an unrecognised member to any page leaves it readable rather
  than blank or broken.
- **SC-006**: A citation checklist rendered from a real verdict shows clause text in
  every row; zero rows render as empty quotation marks.
- **SC-007**: A seller viewing a list containing an unregistered agent identifies it as
  unbuyable without being told, including from a desaturated screenshot.
- **SC-008**: All three acts complete on screen with zero manual page refreshes, and
  zero keyboard or mouse input between the countdown reaching zero and the page
  flipping.
- **SC-009**: A person who has not seen the code reads a settled order and states
  correctly what happened and why, within about thirty seconds.
- **SC-010**: The verdict card and seller screens remain interpretable when desaturated
  and when read from roughly three metres — tier, refund figure, and ✓/✗ marks all
  identifiable.
- **SC-011**: A buyer's case-file network response contains no seller system prompt and
  none of the fields the frontend deliberately does not declare.
- **SC-012**: Every carryover criterion listed by the earlier specs is findable as a
  step in the plan.
- **SC-013**: A second full pass can be started from a clean state using only the
  plan's reset instructions, and the pass fits the duration the plan states.

## Assumptions

- The API's contract and divergence report are delivered, current, and describe the
  running API; this feature consumes them rather than producing them.
- A running API with a demo seed and reset facility is available to the reconciler and
  to the tester.
- Automated tests remain out of scope for this component by the standing MVP decision,
  which is why manual verification is the deliverable rather than a fallback.
- The reconciliation record lives alongside the component's other documentation, and
  the manual test plan lives at the component's documented path for it; neither is
  embedded in this spec.
- Escalating an API defect means recording it in the reconciliation record and raising
  it against the API component; this feature does not change the API.
- The frontend's existing field-naming convention is assumed correct where the contract
  agrees with it, and the contract wins where it does not, unless the divergence report
  says the API is at fault.
- Where the divergence report is silent and the contract is ambiguous, the contract's
  literal wire behaviour against the running API decides.
- The tester has a browser wallet, can fund it on the test network, and can open the
  browser's network inspector — the redaction check requires it.
- At least one further disagreement beyond the two already known is assumed to exist;
  the contract→frontend walk is done in full rather than spot-checked.

## Out of Scope

- Executing the test plan, or reporting any of its steps as passed.
- Automated tests of any kind — unit, integration, or end-to-end.
- New features, redesigns, and any page not already built.
- Changing the API. Defects found in it are escalated, not corrected here and not
  worked around in the frontend.
- Cosmetic improvements to anything ugly but correct, other than failures of the
  greyscale and three-metre legibility checks.
