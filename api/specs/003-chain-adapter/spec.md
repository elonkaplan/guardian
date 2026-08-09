# Feature Specification: Chain Adapter

**Feature Branch**: `003-chain-adapter`

**Created**: 2026-08-08

**Status**: Draft

**Input**: User description: "docs/specs/API-03-chain-adapter.md — The only module that talks to the chain, and the only place that knows token base units exist. One chain definition, three signing identities, typed wrappers for every escrow function, one money-unit conversion point, receipt waiting, typed errors, explicit gas limits, and read helpers."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A backend action becomes a confirmed transaction anyone can look up (Priority: P1)

Any part of the backend that needs something to happen on the escrow — register an agent, open a deal, mark it delivered, settle it — asks this module in the platform's own vocabulary and gets back either a confirmed transaction reference that can be pasted into the public block explorer, or a named failure describing what went wrong. Nothing outside this module ever addresses the chain directly.

**Why this priority**: Every later feature that moves money depends on this working, and it is the piece the demo makes visible — a clickable transaction is what turns "the platform says it settled" into "the chain says it settled". On its own it delivers the ability to put real, verifiable transactions on the chain from the backend.

**Independent Test**: Run a throwaway script that registers an agent through the module, and confirm the returned transaction appears on the public explorer with the expected effect.

**Acceptance Scenarios**:

1. **Given** the escrow is deployed and the operator identity is funded, **When** a script registers an agent through the module, **Then** the call returns only after the transaction is confirmed, hands back the transaction reference and the new agent identifier, and that transaction is visible on the public block explorer.
2. **Given** a confirmed transaction, **When** its outcome is inspected, **Then** the module reports success only if the chain recorded it as successful — a transaction that was mined but reverted is reported as a failure, not a success.
3. **Given** a call the escrow rejects (for example, opening a deal on an inactive agent), **When** it is submitted, **Then** the module raises a named, catchable failure identifying the rejected operation rather than an unstructured low-level error.
4. **Given** the chain endpoint is unreachable, **When** any call is attempted, **Then** the module raises a named connectivity failure that is distinguishable from a rejection by the escrow.
5. **Given** every function the escrow exposes, **When** the module's surface is reviewed, **Then** each one has a wrapper that takes and returns the platform's own types rather than raw chain encodings.

---

### User Story 2 - Money crosses the unit boundary exactly once (Priority: P2)

The rest of the platform speaks only in whole US cents. This module is the sole place that knows the settlement token counts in base units, and it converts in exactly one pair of functions — cents in, base units out on the way to the chain; base units in, cents out on the way back.

**Why this priority**: A conversion error here is a factor-of-ten-thousand error in real money, and it would surface as a settlement that pays out the wrong amount in front of an audience. Concentrating it in one reviewable place is the entire mitigation. It is independently valuable and independently checkable the moment the module exists.

**Independent Test**: Convert a set of known amounts in both directions and confirm each round-trips exactly; then search the whole backend outside this module for any other multiplication or division by the token's scale and confirm there is none.

**Acceptance Scenarios**:

1. **Given** an amount in whole cents, **When** it is converted for the chain, **Then** the result is that amount multiplied by ten thousand, expressed as a whole-number token base amount.
2. **Given** a token base amount that came from the chain, **When** it is converted back, **Then** the result is a whole number of cents and round-trips to the original value.
3. **Given** any amount handled by this module, **When** the conversion is performed, **Then** no step uses fractional arithmetic at any point.
4. **Given** the backend outside this module, **When** it is searched for the token's decimal scale, **Then** the scale appears nowhere else.
5. **Given** a negative amount or a non-whole cent value, **When** conversion is attempted, **Then** it is rejected rather than silently truncated.

---

### User Story 3 - The guardian identity is physically incapable of anything but ruling (Priority: P3)

The identity that settles disputes is given a view of the escrow that contains one operation and nothing else. Attempting to open a deal, register an agent, or move money with the guardian identity is not a policy violation caught in review — it is impossible to express.

**Why this priority**: The credibility of the whole arbitration story rests on the claim that the judge cannot also be the trader. That claim is only true if it is structural. It costs almost nothing to build in now and is exactly the kind of separation that erodes the moment it depends on discipline.

**Independent Test**: Inspect the guardian identity's declared view of the escrow and confirm it names exactly one operation; attempt to express any other operation through it and confirm it cannot be written.

**Acceptance Scenarios**:

1. **Given** the guardian identity, **When** its declared escrow interface is inspected, **Then** it contains the dispute-resolution operation and no other.
2. **Given** the guardian identity, **When** any non-resolution operation is attempted through it, **Then** the attempt fails before the code can run rather than at execution time.
3. **Given** the operator identity, **When** its declared escrow interface is inspected, **Then** it contains every operation the operator is entitled to call and does not contain the dispute-resolution operation.
4. **Given** the read-only identity, **When** it is inspected, **Then** it holds no signing secret and can only read.
5. **Given** the three identities, **When** the module's exported surface is reviewed, **Then** a caller cannot obtain a raw signing capability and bypass the narrowed interfaces.

---

### User Story 4 - The platform can ask the chain what it currently holds (Priority: P4)

The backend and the demo screen can read the escrow's live state: how much is currently held across all unsettled purchases, what a given address is owed, and the full recorded state of any single purchase.

**Why this priority**: The escrow total is what makes "money is genuinely locked up" visible during the demo, and the per-deal read is how the backend reconciles its own records against the chain when something looks wrong. It ranks below the write path because reads prove nothing until something has been written.

**Independent Test**: Against the deployed escrow, read the escrow total, one address's owed balance, and one purchase's recorded state, and confirm each matches what the transactions performed so far imply.

**Acceptance Scenarios**:

1. **Given** the deployed escrow, **When** the total currently held is requested, **Then** it is returned in whole cents.
2. **Given** an address, **When** its owed balance is requested, **Then** it is returned in whole cents, and an address with nothing owed returns zero rather than an error.
3. **Given** a purchase identifier, **When** its recorded state is requested, **Then** the module returns the purchase's parties, amount, state, and timestamps in the platform's own types.
4. **Given** a purchase identifier that does not exist, **When** it is requested, **Then** the module reports "not found" distinctly rather than returning a plausible-looking record of zeroes.
5. **Given** any read, **When** it is performed, **Then** no signing secret is involved.

---

### User Story 5 - Repeated operator transactions cost a known amount (Priority: P5)

The operations the platform performs over and over — opening deals, marking delivery, releasing settled funds — each declare in advance what they are willing to spend, so the cost of a long demo is predictable and the funding wallet does not drain faster than expected.

**Why this priority**: On this chain the declared spending ceiling is what is actually charged, not what the transaction consumes, so the usual habit of estimating and adding a safety margin spends that margin on every single transaction. The background job that releases settled deals fires continuously, which multiplies the waste. It is last only because getting it wrong wastes funds rather than producing incorrect results.

**Independent Test**: Inspect the repeated operator operations, confirm each declares an explicit ceiling rather than deriving one, and confirm the recorded cost of a sample transaction matches the declared ceiling rather than its consumption.

**Acceptance Scenarios**:

1. **Given** the repeated operator operations, **When** each is submitted, **Then** it carries an explicit, stated spending ceiling.
2. **Given** any operator transaction, **When** it is submitted, **Then** the module does not ask the chain to estimate a ceiling and then inflate the answer.
3. **Given** a declared ceiling, **When** it is located in the code, **Then** it is a named constant with a comment recording where the figure came from, so it can be revised once real measurements exist.
4. **Given** a ceiling that proves too low, **When** the transaction is submitted, **Then** the resulting failure is reported as a named, recognisable exhausted-budget failure rather than a generic rejection.

---

### Edge Cases

- **The confirmation wait times out while the transaction is still in flight**: reported as an unknown outcome, never as a failure, because the transaction may still confirm and reporting failure would invite a duplicate submission of the same money-moving action.
- **A transaction is mined but reverted**: treated as a failure even though it was included, and the spending ceiling has still been charged.
- **Two operator transactions are submitted at once** (the purchase flow and the background release job overlap): both must reach the chain; the module must not let one silently replace the other.
- **The purchase flow submits without the token spend having been authorised**: the escrow rejects it, and the module reports a recognisable authorisation-missing failure rather than a generic rejection.
- **The configured chain identifier does not match the chain the endpoint actually serves**: detected and reported at startup rather than producing transactions signed for the wrong network.
- **The escrow address is still a placeholder** (the deploy has not happened yet): the service starts anyway — this is the existing configuration convention — and the first chain call fails with a clear, attributable error.
- **A read for an identifier that has never existed**: distinguished from a record whose fields happen to be zero.
- **The funding wallet runs out of native currency mid-demo**: reported as a recognisable insufficient-funds failure naming the identity that ran dry, since it is otherwise easily misread as a chain problem.
- **A token base amount arrives from the chain that is not a whole number of cents**: surfaced rather than rounded, because it means an amount entered the escrow through a path that bypassed this module.

## Requirements *(mandatory)*

### Functional Requirements

**Chain definition and identities**

- **FR-001**: The system MUST define the target chain once — its identifier, name, native currency, endpoint, and public block explorer — and every part of the platform that needs those facts MUST take them from that one definition.
- **FR-002**: The system MUST provide exactly three chain identities: a read-only one holding no signing secret, an operator one, and a guardian one.
- **FR-003**: The guardian identity MUST be constructed with an escrow interface containing only the dispute-resolution operation, so that expressing any other operation through it is impossible rather than merely disallowed.
- **FR-004**: The operator identity MUST be able to express every operation the operator is entitled to perform, and MUST NOT be able to express dispute resolution.
- **FR-005**: The module MUST NOT expose a raw signing capability that would let a caller bypass the narrowed interfaces.
- **FR-006**: The system MUST verify at startup that the endpoint serves the configured chain identifier, and MUST report a mismatch clearly.

**Escrow operations**

- **FR-007**: The system MUST provide a wrapper for every operation the escrow exposes, each accepting and returning the platform's own types rather than raw chain encodings.
- **FR-008**: Each write wrapper MUST wait for the transaction to be recorded before returning, and MUST return the transaction reference together with any value the operation produces (such as a new agent or purchase identifier).
- **FR-009**: The system MUST treat a recorded-but-rejected transaction as a failure, never as a success.
- **FR-010**: The system MUST report failures as named, catchable kinds that distinguish at minimum: the escrow rejected the operation, the endpoint could not be reached, the confirmation wait elapsed with the outcome still unknown, the spending ceiling was exhausted, the signing identity had insufficient native currency, and the token spend had not been authorised.
- **FR-011**: A confirmation wait that elapses MUST be reported as an unknown outcome carrying the transaction reference, and MUST NOT be reported as a failed transaction.
- **FR-012**: The system MUST ensure the token spend required by the purchase-opening operation is authorised, and MUST expose that as an explicit operation rather than assuming it was arranged elsewhere.

**Money units**

- **FR-013**: The system MUST provide exactly one function converting whole US cents to token base units and exactly one converting back, and these MUST be the only place in the backend where the token's decimal scale appears.
- **FR-014**: Conversion MUST be exact whole-number arithmetic in both directions, with no fractional step at any point.
- **FR-015**: Every amount crossing this module's boundary toward the rest of the platform MUST be expressed in whole US cents; every amount crossing toward the chain MUST be expressed in token base units.
- **FR-016**: The system MUST reject a conversion of a negative amount, and MUST surface rather than round a chain amount that is not a whole number of cents.

**Reads**

- **FR-017**: The system MUST provide a read for the total currently held across all unsettled purchases, returned in whole cents.
- **FR-018**: The system MUST provide a read for the amount an address is owed, returned in whole cents, with zero for an address that is owed nothing.
- **FR-019**: The system MUST provide a read for a single purchase's full recorded state — parties, amount, state, and timestamps — in the platform's own types.
- **FR-020**: Reads MUST distinguish a non-existent identifier from a record whose values are zero.
- **FR-021**: Reads MUST NOT involve any signing secret.

**Spending ceilings**

- **FR-022**: The repeated operator operations — opening a purchase, marking delivery, and releasing settled funds — MUST each declare an explicit spending ceiling.
- **FR-023**: The system MUST NOT derive a ceiling by asking the chain to estimate and then inflating the answer.
- **FR-024**: Each declared ceiling MUST be a named constant accompanied by a note recording where the figure came from and that it is to be revised once measured.

**Boundaries**

- **FR-025**: This module MUST contain no business rules, no purchase state machine, and no database access.
- **FR-026**: No part of the backend outside this module may address the chain directly.

### Key Entities

- **Chain definition**: The single description of the target network — identifier, name, native currency, endpoint, and public explorer — shared by everything that needs it.
- **Chain identity**: One of three ways the platform appears to the chain: read-only, operator, or guardian. Each carries the narrowest view of the escrow its role requires.
- **Escrow interface**: The declared list of operations an identity may express. The guardian's contains one entry; that narrowness is the security property.
- **Transaction outcome**: What a write returns — a transaction reference, whatever value the operation produced, and a definite confirmed-successful status; or a named failure; or an explicitly unknown result when confirmation did not arrive in time.
- **Money amount**: The same value in two representations — whole US cents everywhere in the platform, token base units only on the chain side of this module — with a single conversion between them.
- **Purchase record (as read from the chain)**: The escrow's own view of one purchase: its parties, its amount, where it is in its life, and when each stage happened.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A throwaway script registers an agent through the module and the resulting transaction is findable on the public block explorer with the expected effect, on the first attempt.
- **SC-002**: Both a write and a read succeed against the deployed escrow in the same session, confirming the module works in both directions.
- **SC-003**: The guardian identity's declared escrow interface contains exactly one operation; a written attempt to use it for anything else fails before it can run.
- **SC-004**: A search of the entire backend outside this module for the token's decimal scale returns zero results.
- **SC-005**: Every amount in a set of at least ten test values, including the smallest and largest realistic prices, round-trips through both conversions with zero loss.
- **SC-006**: 100% of the repeated operator operations declare an explicit spending ceiling; zero of them ask the chain to estimate one.
- **SC-007**: Each of the six named failure kinds is reachable and reports distinguishably, verified by provoking each one at least once.
- **SC-008**: A search of the backend outside this module for direct chain access returns zero results.
- **SC-009**: A configuration naming the wrong chain identifier is caught at startup rather than producing a transaction on the wrong network.

## Assumptions

- **Verification is manual.** Automated tests remain out of scope for this component per the project's standing decision. Every scenario above is checked by hand — most of them by a throwaway script and a look at the public explorer.
- **The escrow is already deployed, or the configuration still holds a placeholder.** The existing convention is that format-valid placeholder values pass startup validation so the service can run before the deploy exists; this feature keeps that property and fails at the first chain call instead of at boot.
- **The chain, addresses, and signing secrets all come from the existing configuration.** This feature introduces no new configuration keys beyond the spending-ceiling constants, which are code, not environment.
- **Authorising the token spend is treated as part of this module.** The purchase-opening operation cannot succeed without it, so leaving it to a caller would make the module's own operation unusable on its own. It is a chain concern, not a business rule.
- **One confirmation is enough.** The target chain finalises in well under a second, so a single confirmation is treated as settled; no deeper confirmation depth is waited for.
- **Ceilings start as conservative estimates.** No measurements exist yet, so the initial figures are deliberate over-estimates recorded as revisable — over-estimating wastes funds, while under-estimating loses both the funds and the transaction.
- **The operator submits transactions one at a time.** No concurrency-control mechanism beyond ordinary sequential submission is built; the flows that could overlap are expected to be low enough in volume that the endpoint's own ordering suffices.
- **Reading chain history is not part of this feature.** Nothing subscribes to or replays the escrow's emitted events; state is obtained by direct reads.
- **The read of a single purchase returns what the escrow stores, not what the platform's database stores.** Reconciling the two is a later concern.
