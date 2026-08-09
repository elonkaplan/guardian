# Feature Specification: The published API contract & its divergence report

**Feature Branch**: `012-openapi-contract`

**Created**: 2026-08-09

**Status**: Draft

**Input**: User description: "docs/specs/API-12-openapi-contract.md — The OpenAPI contract & Swagger UI. Write down what the API actually does, so the frontend can be corrected against something true rather than something assumed — and report anywhere that differs from what it was supposed to do."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A frontend engineer can trust one document instead of guessing (Priority: P1)

A frontend engineer about to correct the interface opens a single published contract document. For every operation the backend serves, they find the address, the method, whether a caller must be signed in, what must be sent, what comes back field for field, and which failures are possible. They stop reading backend source, and they stop inferring shapes from the screens that already exist.

**Why this priority**: Every other part of this feature exists to make this document trustworthy. Without it the interface is reconciled against assumption, which is the state that already produced one wrong-name defect on this project.

**Independent Test**: Take the list of operations the running backend actually serves, and the list the document describes, and check that neither contains an entry the other lacks. Then call several operations and compare each returned payload against its described shape, name by name. Delivers a usable contract with no report and no corrections written.

**Acceptance Scenarios**:

1. **Given** the running backend, **When** its registered operations are listed and compared with the document, **Then** every registered operation appears in the document and every operation in the document is registered — no extras on either side.
2. **Given** any documented operation, **When** it is called and the real payload compared with the document, **Then** every field name, type, and nullability matches what actually came back.
3. **Given** an operation that requires a signed-in caller, **When** the document is read, **Then** it states that requirement, and states which callers are permitted where a single operation serves more than one kind of caller.
4. **Given** a field that is always present and may carry "unknown", **When** the document is read, **Then** it is described as always present and permitted to be empty — not as a field that may be missing, and not as one that defaults to zero.
5. **Given** the interface's fixed sets of values — order states, ledger entry kinds, evidence sources, refund tiers — **When** the document is read, **Then** each set is enumerated in full with the exact values the backend emits.
6. **Given** a failure the interface must handle differently from a retry, **When** the document is read, **Then** the failure is described with its status and its payload shape.

---

### User Story 2 - Every difference from the design is written down and judged (Priority: P2)

A reviewer compares the new contract against the product's design documents and records every place they disagree — what the design says, what the backend does, and a verdict on which one is wrong. The result is published beside the contract so the next reader knows which parts they may adopt blindly and which they must not.

**Why this priority**: This is the only thing standing between "the contract describes the code" and "the contract blesses a bug". Without it, a mistaken field name becomes the interface's target and the fix travels in the wrong direction.

**Independent Test**: Read the published report and pick any row at random; confirm the design claim, the backend behaviour, and the verdict can each be checked independently against their sources. Delivers the honesty check even if no correction is ever applied.

**Acceptance Scenarios**:

1. **Given** the finished contract and the design documents, **When** they are compared, **Then** a published report exists recording every difference, each with where it occurs, what the design says, what the backend does, and one of three verdicts: the backend is wrong, the design is stale, or the departure was deliberate.
2. **Given** a comparison that found no differences at all, **When** the report is read, **Then** it exists and states plainly that the comparison was performed and found nothing.
3. **Given** a row whose verdict is that the design is stale, **When** the design document is read afterwards, **Then** it has been updated so the two agree.
4. **Given** a row whose verdict is that the departure was deliberate, **When** the row is read, **Then** it records the reason.
5. **Given** the report, **When** the interface team reads it before adopting the contract, **Then** they can tell for every row whether the documented behaviour is safe to build against.

---

### User Story 3 - Behaviour the report calls a defect is fixed, not documented (Priority: P3)

Where the comparison finds the backend simply wrong — a permitted caller the code forgot to permit, a failure returned with the wrong status — the backend is corrected and the contract describes the corrected behaviour. Where there is no time to correct it, the contract and the report both flag it loudly enough that nobody builds on it.

**Why this priority**: Shipping a contract that documents a known defect is worse than shipping none, because the defect then propagates into the interface. It sits below the report because it cannot begin until the report has identified what to fix.

**Independent Test**: For each row verdicted "backend is wrong", either exercise the corrected behaviour against the running backend, or find the row's warning carried in both the contract and the report. Delivers a contract nobody can accidentally build a defect on.

**Acceptance Scenarios**:

1. **Given** a row saying the backend is wrong, **When** the correction is applied, **Then** the corrected behaviour is what the contract describes, and the row records that it was fixed.
2. **Given** a request for something that does not exist, **When** it is made, **Then** the response is the "not found" failure the interface treats as final — not a generic server failure the interface would retry forever.
3. **Given** an operation the design permits both the buyer and the selling agent's owner to read, **When** the selling agent's owner requests it, **Then** they are permitted — or, if they are not, the report carries it as a defect rather than the contract carrying it as behaviour.
4. **Given** a row saying the backend is wrong that could not be corrected in time, **When** the contract and the report are read, **Then** both mark it as known-wrong and not to be adopted.

---

### User Story 4 - Anyone can open the contract in a browser without signing in (Priority: P4)

A judge, a reviewer, or a teammate with only the address of the running system opens the documentation page and browses every operation. Nothing asks them to sign in.

**Why this priority**: It costs little and is what turns the contract from a file in a repository into something demonstrable, but the document's accuracy matters more than its presentation.

**Independent Test**: Open the documentation address in a browser with no credentials of any kind and confirm the operations render and are browsable.

**Acceptance Scenarios**:

1. **Given** a running system and a browser holding no credentials, **When** the documentation address is opened, **Then** the page renders the operations and does not challenge for a sign-in.
2. **Given** the published contract document, **When** it is changed, **Then** the rendered page reflects the change without any other part of the system being rewritten.
3. **Given** the documentation page, **When** its list of operations is compared with the published document, **Then** they are the same set.

---

### Edge Cases

- **A field's declared shape and its actual shape disagree.** What is sent on the wire is the truth. The declaration states intent and the thing that produces the payload states reality, and a contract transcribed from the declaration documents an intention nobody receives.
- **A field that is always present but may be empty is described as optional.** A consumer then treats absent and empty as the same, and "we do not know this amount yet" silently becomes zero on a screen showing money.
- **The document is written from the design rather than the code.** It becomes a second copy of the design, the comparison finds nothing by construction, and the report certifies a match that was never checked.
- **The document is written from the code without the comparison.** A wrong field name becomes the contract, the interface is corrected into matching it, and the defect is now in two places and much harder to see. This has already happened once on this project.
- **The comparison finds nothing.** The report is still written, saying so. A missing report is indistinguishable from a comparison nobody ran.
- **The documentation page ends up behind the sign-in guard.** The guard is global and refuses by default, so the page is protected unless it is explicitly opened. The failure is silent to whoever wrote it and immediate for whoever opens it.
- **An operation exists in the backend but nobody remembered it.** Health, the demo controls, the stubbed payment-route lookups — all are served, all are callable, and any of them missing from the contract makes "every operation is here" false and the document untrustworthy in ways unrelated to its size.
- **An operation is described in the contract but no longer served.** A consumer builds a call that can only ever fail, and no comparison against the design would have caught it — only a comparison against what is actually registered.
- **Two operations share an address and differ only by method.** Described as one, half of the pair vanishes from the contract.
- **A failure the interface treats as final is returned with a status the interface treats as retryable.** The interface retries forever against a condition that will never change. The status is part of the contract, so this is a defect in the backend and not something the interface absorbs.
- **An operation serves a signed-in caller and an anonymous one differently.** Documented as one behaviour, whichever half was not documented becomes a surprise.
- **Extending the code with contract annotations everywhere in order to produce the document.** Touching every payload definition across eleven finished features to generate a document is a change to verified code for a documentation benefit, and the risk lands on the parts of the system the demo depends on.
- **The design document is itself out of date.** Then the comparison's job is to say so and update it, not to record a difference nobody resolves.

## Requirements *(mandatory)*

### Functional Requirements

#### The contract document

- **FR-001**: The system MUST publish a machine-readable contract document, in OpenAPI 3.1 format, describing every operation the backend serves.
- **FR-002**: The document MUST parse as valid OpenAPI 3.1.
- **FR-003**: Every operation the running backend registers MUST appear in the document, and every operation in the document MUST be registered by the running backend. Completeness MUST be established against what the backend actually serves, not against any design document.
- **FR-004**: Each operation MUST record its address, its method, its request payload where it takes one, its response payloads with their status codes, and the failures it can return.
- **FR-005**: Response shapes MUST be derived from payloads actually returned by the running backend, field name for field name, rather than transcribed from internal type declarations.
- **FR-006**: Where an internal declaration and the actual payload disagree, the document MUST describe the actual payload.
- **FR-007**: Each operation MUST state whether it requires a signed-in caller, whether it accepts one optionally, or whether it is open to anyone.
- **FR-008**: Where an operation is readable by more than one kind of caller — the buyer or the owner of the selling agent — the document MUST state which callers are permitted, per operation.
- **FR-009**: The document MUST enumerate, in full and with the exact values the backend emits, every fixed value set the interface branches on: order states (eight), ledger entry kinds (four), evidence sources (three), and refund tiers.
- **FR-010**: Every money field MUST be documented under its exact name, with its unit, and with its nullability stated exactly.
- **FR-011**: A field that is always present and may carry "unknown" MUST be documented as always present and permitted to be empty, and MUST NOT be documented as optional. The distinction is what stops a consumer from substituting zero for an unknown amount.
- **FR-012**: Failure responses MUST be part of the document, including their status codes and payload shapes, because the interface's decision to retry or to stop is made from the status.

#### The browsable rendering

- **FR-013**: The system MUST serve a browsable rendering of the contract at a documentation address on the running backend.
- **FR-014**: The documentation address MUST be reachable with no credentials. The system refuses unauthenticated requests by default, so this exemption MUST be explicit.
- **FR-015**: The rendering MUST be driven by the published contract document, so that changing the document changes the page with no other change.

#### The divergence report

- **FR-016**: Before this feature is considered finished, the contract MUST be compared against the product's design documents — the API design's endpoint section, the database schema's serialisation section, and the technology document's contract section.
- **FR-017**: The system MUST publish a divergence report recording every difference found, each row naming the operation or field, what the design says, what the backend does, and a verdict.
- **FR-018**: Every row's verdict MUST be exactly one of: the backend is wrong, the design is stale, or the departure was deliberate.
- **FR-019**: A comparison that finds no differences MUST still produce the report, stating that the comparison was performed and found nothing. The report's existence is the evidence that the check happened.
- **FR-020**: Rows verdicted "the design is stale" MUST be resolved by updating the design document so the two agree.
- **FR-021**: Rows verdicted "deliberate" MUST record the reason for the departure.
- **FR-022**: Rows verdicted "the backend is wrong" MUST be corrected in the backend, and the contract MUST then describe the corrected behaviour.
- **FR-023**: Where such a correction cannot be made in time, both the contract and the report MUST mark the behaviour as known-wrong and not to be adopted, so that no consumer adopts a defect as a target.
- **FR-024**: The report MUST be readable as the interface team's guide to which parts of the contract may be trusted blindly and which may not.

#### Boundaries

- **FR-025**: Changing backend behaviour is out of scope except for the corrections required by FR-022 — those corrections are in scope.
- **FR-026**: The contract MUST be produced without adding contract annotations across the payload definitions of already-finished features, because that is a change to verified code carrying regression risk for a documentation benefit.

### Key Entities

- **Contract document**: The published, machine-readable description of every operation the backend serves — addresses, methods, caller requirements, request and response shapes, failures. Describes what the backend does, not what it was supposed to do.
- **Operation**: One address-and-method pair the backend serves, with its permitted callers, its inputs, its successful outputs, and its failures. Roughly twenty-seven of them.
- **Fixed value set**: A closed list the interface branches on — order state, ledger entry kind, evidence source, refund tier. Documented in full because a missing member is an unhandled branch.
- **Divergence row**: One recorded difference between design and backend, with a verdict that decides which side changes.
- **Divergence report**: The published collection of rows, including the empty case. Tells a consumer which parts of the contract are trustworthy.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: The contract document parses as valid OpenAPI 3.1 with zero errors.
- **SC-002**: The set of operations the running backend serves and the set the contract describes are identical — zero entries appear in one and not the other.
- **SC-003**: For every operation exercised against the running backend, the returned payload's field names match the contract exactly, with zero unmatched names in either direction.
- **SC-004**: All four fixed value sets are enumerated in full, and every value the backend can emit for each appears in the contract.
- **SC-005**: Every money field in the contract carries a unit, and its nullability matches what the running backend returns.
- **SC-006**: Opening the documentation address in a browser holding no credentials renders the operations, with no sign-in challenge.
- **SC-007**: The divergence report exists, including in the case where no differences were found.
- **SC-008**: Every row in the report carries a verdict, and every row is resolved — corrected, design updated, reason recorded, or explicitly marked as known-wrong and not to be adopted. Zero unresolved rows.
- **SC-009**: A reader who has never seen the backend's source can determine, for any operation in the contract, who may call it and what it returns, without opening a source file.
- **SC-010**: Requesting something that does not exist returns the failure the interface treats as final, on every such operation.
- **SC-011**: No payload definition belonging to a previously finished feature was modified in order to produce the contract, except where a divergence row required a correction.

## Assumptions

- **The contract is hand-written from observed responses rather than generated from the code.** The source spec is explicit about this, and the reason is scope-shaped: generating it would mean annotating every payload definition across eleven finished features, which is a change to code the demo depends on and which has already been verified by hand. The cost is that the document can drift; the mitigation is that it is written last, immediately before the interface consumes it.
- **"Every operation the backend serves" includes the ones nobody thinks of as public** — the health check, the two unauthenticated demo controls, and the stubbed payment-route lookups. Anything callable is part of the contract, because a consumer can call it. Their presence in a public contract is consistent with the recorded decision to leave the demo controls unauthenticated.
- **The backend as it runs is the truth about behaviour; the design documents are the truth about intent.** Collapsing the two is the one failure mode this feature has to avoid, and the divergence report is the mechanism that keeps them separate.
- **The comparison covers the API design's endpoint section, the database schema's serialisation section, and the technology document's contract section** — those three, as named by the source spec, and not the whole documentation set.
- **Failures are part of the contract because the consuming interface branches on them**: a status treated as final stops the interface, and any other status makes it retry. A wrong status therefore causes an infinite retry loop in the consumer, which makes it the backend's defect to fix rather than the interface's to work around.
- **Roughly twenty-seven operations are in scope**, counted from the routes the backend currently registers across authentication, accounts, funding, catalogue, orders, sales, verdicts, payment-route stubs, demo controls, and health. The exact count is established during the work by listing what is registered, not by trusting this number.
- **Automated tests are out of scope** for this component, per the standing decision. Every acceptance scenario and success criterion here is verified by hand — which for this feature means calling the operations and reading what comes back, and that is the same activity that produces the document.
- **This feature runs after all preceding backend features and immediately before the interface's reconciliation pass.** The contract is the handoff between the two components, and its value decays quickly if backend work continues after it is written.

### Carried forward from earlier work

- **A wrong field name has already propagated once on this project.** The interface read one name where the backend sent another; a contract generated from the backend at that moment would have made the backend's name authoritative and the correction would have gone the wrong way. That single incident is why the divergence report exists and why it is not optional.
- **The sign-in guard is global and refuses by default.** Every route added since the guard landed has needed an explicit exemption to be reachable anonymously, and the documentation page is the same case. Forgetting it produces a page that works for whoever built it and a sign-in challenge for whoever is being shown it.
- **The preceding feature's specification recorded that this published contract did not yet exist**, and that reconciling with it when it lands is this feature's job. This is that reconciliation.
