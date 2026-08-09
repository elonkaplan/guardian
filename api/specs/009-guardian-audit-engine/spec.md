# Feature Specification: Guardian audit engine

**Feature Branch**: `009-guardian-audit-engine`

**Created**: 2026-08-09

**Status**: Draft

**Input**: User description: "docs/specs/API-09-guardian-audit.md — Guardian audit engine. Turn a complaint into a cited, tiered verdict, and settle it on-chain."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A complaint becomes a cited, tiered ruling that moves money (Priority: P1)

A buyer has disputed a delivery. The platform gathers everything that is known about the order — what the buyer asked for, what they said "done right" would mean, what the seller's listing promised and excluded at the moment of purchase, and what the agent actually did and produced — and hands that record to an impartial auditor. The auditor returns one of five refund tiers, written reasoning, and a list of citations: each one naming a specific promise, exclusion, or criterion, quoting it, and stating whether the delivery met it. The ruling is written down, then the escrow is instructed to split the money according to the tier.

**Why this priority**: This is the product. Every other feature in the system exists to produce the evidence this story consumes or to display the ruling it produces. Without it there is a marketplace with no recourse, which is the exact gap the product claims to close.

**Independent Test**: File a complaint on a delivered order, then observe that a ruling exists containing a tier and at least one citation, and that the escrow paid out a split matching that tier. Fully testable with a single order and no other story implemented.

**Acceptance Scenarios**:

1. **Given** a delivered order whose output falls short of the buyer's acceptance criteria, **When** the buyer files a complaint, **Then** a ruling is recorded with a tier, written reasoning, and at least one citation, and each citation names its source as a capability, an exclusion, or a criterion, quotes it, and states whether it was met.
2. **Given** a ruling has been recorded, **When** the escrow is instructed to settle, **Then** the refund split paid out matches the ruling's tier and the order is marked settled.
3. **Given** an order whose listing promise and acceptance criteria were both met, **When** the buyer complains anyway, **Then** the ruling is the no-refund tier and the citations show the met clauses.
4. **Given** the auditor is judging, **When** the complaint concerns something the listing never promised and the buyer never asked for, **Then** the ruling is the no-refund tier.
5. **Given** an order whose evidence is genuinely ambiguous or whose recorded trace is unusable, **When** the audit runs, **Then** the ruling is the quarter-refund tier rather than a full rejection or a full refund.

---

### User Story 2 - The seller can read the ruling made against them (Priority: P2)

A seller is told that a dispute was filed against one of their agents and later that it was decided. They open the ruling and see the same tier, reasoning, and citations the buyer sees — which clause was cited, what it says, and whether the auditor found it met.

**Why this priority**: A seller who is ruled against and cannot read the ruling has been told of an accusation they are not allowed to examine. It costs almost nothing on top of Story 1 and it is half of the product's credibility: the audit is defensible only if the audited party can see it.

**Independent Test**: With one recorded ruling, retrieve it as the buyer and as the owner of the agent that ran, and confirm both receive the identical ruling; retrieve it as an unrelated account and confirm the order is not visible.

**Acceptance Scenarios**:

1. **Given** a recorded ruling, **When** the buyer retrieves it, **Then** they receive the tier, the reasoning, the citations, the refund amount, and the settlement transaction reference.
2. **Given** the same ruling, **When** the owner of the agent that ran the order retrieves it, **Then** they receive the identical content.
3. **Given** the same ruling, **When** an account that is neither the buyer nor the agent's owner requests it, **Then** the order is reported as not found — the same response a stranger receives for an order that does not exist.
4. **Given** a disputed order whose audit has not finished, **When** either party requests the ruling, **Then** they are told no ruling exists yet rather than receiving a partial one.

---

### User Story 3 - Non-delivery resolves at a full refund (Priority: P3)

A buyer paid, the agent produced nothing — it crashed, timed out, or returned an empty result — and the buyer complains. The absence of output is itself the evidence, and the ruling is a full refund.

**Why this priority**: It is one of the two failure modes the product claims to cover, it is one of the three demo acts, and it is the case where a wrong answer is most obviously wrong to an audience. It rides on Story 1's pipeline but is a distinct, independently demonstrable outcome.

**Independent Test**: Dispute an order whose recorded run produced no output and confirm the ruling is the full-refund tier and the buyer's money returns in full.

**Acceptance Scenarios**:

1. **Given** an order whose run produced no output, **When** the audit runs, **Then** the ruling is the full-refund tier.
2. **Given** an order that never ran at all, **When** the audit runs, **Then** the case file still assembles — recording the absence of any trace and any output — and the ruling is the full-refund tier.
3. **Given** the absent output, **When** the case file is assembled, **Then** the absence is presented to the auditor as an explicit statement that nothing was produced, never as a missing section or an error condition.

---

### User Story 4 - A ruling is final and is replayed, never recomputed (Priority: P4)

A dispute is decided once. Any later attempt to audit the same order is refused, and every later read returns the ruling that was recorded the first time — the same tier, the same reasoning, the same citations.

**Why this priority**: It is the product rule that there are no appeals, and it is also what makes a live rehearsal reproducible: the auditor cannot be pinned by sampling controls, so replaying what was stored is the only way the same order gives the same answer twice.

**Independent Test**: Audit an order, then attempt to audit it again, and confirm the second attempt is refused and no second ruling exists.

**Acceptance Scenarios**:

1. **Given** an order that already has a ruling, **When** an audit is attempted again, **Then** it is refused and no second ruling is created.
2. **Given** an order that already has a ruling, **When** the order is read repeatedly over the course of a rehearsal, **Then** the tier, reasoning, and citations are byte-for-byte identical every time.
3. **Given** two audit attempts that begin at the same moment for the same order, **When** both complete, **Then** exactly one ruling exists.

---

### User Story 5 - A failed settlement does not cost the ruling (Priority: P5)

The ruling is written down before the escrow is touched. If the escrow instruction fails, the ruling survives; the order waits in an adjudicated state and a later retry settles it using the ruling already recorded, without asking the auditor anything.

**Why this priority**: It is the invariant that makes the two-step honest, but it only becomes visible under a failure that the happy-path demo does not exercise. It must be built with Story 1, not after it — the ordering is not something that can be retrofitted.

**Independent Test**: Force the escrow instruction to fail after a ruling is produced, then confirm the ruling is readable, the order is adjudicated rather than settled, and a retry settles it without producing a different tier.

**Acceptance Scenarios**:

1. **Given** an audit that produced a ruling, **When** the escrow instruction fails, **Then** the ruling is recorded and readable, the order is adjudicated, and no settlement reference is recorded.
2. **Given** an adjudicated order with a recorded ruling, **When** settlement is retried, **Then** the escrow is instructed with the stored tier and the stored ruling reference, and the auditor is not consulted.
3. **Given** an escrow instruction whose outcome could not be determined, **When** the system reacts, **Then** the ruling is kept and the order is left in a state a retry can act on, rather than being rolled back.

---

### Edge Cases

- **The auditor returns no citations.** A tier with no citation is an assertion, not an audit. The audit is treated as failed, nothing is recorded, and the order remains disputed for a retry — a bare tier is never persisted.
- **The auditor quotes text that is not in the case file.** A citation whose quote cannot be traced to the clause it names undermines the entire credibility claim; the audit is treated as failed rather than persisting an unverifiable quote.
- **The auditor is unreachable, times out, or returns an unusable response.** No partial ruling is written; the order stays disputed and is retried later. A dispute that cannot be decided must look undecided, not decided badly.
- **An audit is attempted on an order that is not disputed.** Refused. Only a disputed order is auditable — a released, running, or purchased order has no complaint to answer.
- **A disputed order has no escrow deal recorded.** There is nothing to settle; the audit is refused rather than producing a ruling that can never move money.
- **The seller edits their listing between purchase and audit.** The audit judges the version the order pinned. The current listing is never consulted, so a citation always traces to text that was live when the buyer paid.
- **Two audit workers claim the same disputed order.** Exactly one ruling is created; the loser is refused by the same rule that refuses a re-audit.
- **A ruling is requested for an order that has none.** Reported as absent, and distinguishable to the caller from an order they are not permitted to see only in that the latter reports the order itself as not found.
- **The full-refund tier and the no-refund tier both settle.** A rejected complaint still instructs the escrow — the seller being paid in full is a settlement, not a no-op, and the order reaches the settled state either way.
- **The auditor accepts the request and never answers.** The audit is abandoned at a bounded deadline and the worker returns to picking up work. A single hung request must not stop every later dispute from being decided — with one audit in flight at a time, an unbounded wait is indistinguishable from an outage.
- **The auditor's service rejects the request outright.** Treated as a failed audit like any other: nothing recorded, the order stays disputed, retried later. It must never be mistaken for a dispute that was decided, and it must not be reported to either party as a ruling.
- **The process dies between the auditor answering and the ruling being recorded.** The ruling is lost and the order is still disputed, so the next attempt decides it afresh. This is the one place a dispute is genuinely re-audited, and it is correct: nothing was recorded, so nothing was final.
- **The same seeded case produces a different tier on a later rehearsal.** Only possible before a ruling is recorded, since a decided order is replayed rather than re-audited. If it happens, the case file is ambiguous — which is a fixture problem in the execution layer, not an audit problem.

## Requirements *(mandatory)*

### Functional Requirements

#### Case file assembly — what the auditor is shown

- **FR-001**: The system MUST assemble, for each audit, a case file containing the buyer's order input, the buyer's acceptance criteria, the listing's stated capabilities and exclusions, the recorded run trace, the produced output, any recorded error, and the run's timings.
- **FR-002**: The capabilities and exclusions in the case file MUST come from the agent version the order pinned at purchase, never from the agent's current listing.
- **FR-003**: The case file MUST include the seller's private operating instructions. The auditor needs them to separate *"tried hard and the task was impossible"* from *"returned a stub without trying"*, which is an intent-versus-effort judgment the public promise alone cannot support. *(This is the documented product decision — `agent-definition.md` §4 lists Guardian as one of the three parties that sees the prompt, and the buyer as the only one that does not. An earlier draft of this spec excluded it; that was a reversal of a settled decision rather than a gap being closed, and it is withdrawn. The containment is FR-042, not exclusion.)*
- **FR-004**: An absent output MUST be presented to the auditor as an explicit statement that nothing was produced, distinguishable from an output that was produced and was empty.
- **FR-005**: An order with no recorded run MUST still produce a complete case file — one that states there was no trace and no output — rather than failing to assemble.
- **FR-006**: The run trace given to the auditor MUST be the recorded trace **including each step's reasoning**. The steps are what let the auditor tell a genuine attempt from a stub, and that distinction is the main input to the difference between a severe-shortfall and an inconclusive ruling. *(An earlier draft gave the auditor the buyer's redacted step view, on the grounds that step reasoning could be paraphrased into buyer-facing verdict prose. With FR-003 restored, the private instructions are in the payload anyway, so redacting a derivative of them while shipping the original is incoherent. Both inputs are in; the containment is FR-042.)*

#### The audit

- **FR-007**: The system MUST present the auditor with a fixed instruction set and refund rubric that is identical across every audit, so that the stable portion of each request can be reused rather than re-sent.
- **FR-008**: The auditor's answer MUST be structurally constrained to a tier, written reasoning, and a list of citations — not free prose that is later parsed.
- **FR-009**: The tier MUST be one of exactly five values meaning no refund, quarter refund, half refund, three-quarter refund, and full refund. No other refund proportion is representable.
- **FR-010**: Each citation MUST identify its source as one of capability, exclusion, or criterion; carry the quoted text of that clause; and state whether the delivery met it.
- **FR-011**: A ruling MUST carry at least one citation. A ruling with none MUST be rejected as a failed audit and MUST NOT be recorded.
- **FR-012**: Each citation's quoted text MUST be traceable to the case file clause it names. A citation that cannot be traced MUST be rejected as a failed audit.
- **FR-013**: The auditor MUST judge against both yardsticks together — the listing promise and the buyer's acceptance criteria. A complaint about something neither promised nor asked for MUST reach the no-refund tier.
- **FR-014**: An order with no output MUST reach the full-refund tier.
- **FR-015**: Evidence that is genuinely inconclusive — a corrupt trace, an ambiguous output, criteria open to competing readings — MUST reach the quarter-refund tier, on the principle that the complainant carries the burden of proof while genuine ambiguity is still acknowledged.
- **FR-016**: The system MUST record which auditor model produced each ruling.
- **FR-017**: A failed audit — unreachable auditor, unusable answer, or a rejection under FR-011, FR-012, or FR-042 — MUST leave the order disputed with no ruling recorded, so a later attempt can decide it, subject to the bound in FR-043. Retrying is not re-auditing: nothing was recorded, so nothing was final.
- **FR-038**: Every audit MUST be bounded by a deadline, and one that exceeds it MUST be abandoned as a failed audit. *(Carried from the execution engine, where each run is bounded by the seller's declared timeout. The audit has no seller-declared bound, so it needs its own — and it needs one more than a run does, because a single audit occupies the only slot the worker has.)*
- **FR-039**: A partial, truncated, or abandoned auditor response MUST be discarded, never salvaged into a ruling. There is no "close enough" for a verdict that moves money and is final.
- **FR-040**: A failed audit MUST leave **no ruling record at all** — never a placeholder carrying an empty tier, empty citations, or empty reasoning. The absence of a record is what marks a dispute as undecided; a placeholder would consume the one ruling an order is ever allowed and permanently block the real one.
- **FR-041**: The system MUST NOT provide any mechanism — configuration, seeded fixture, or environment mode — for supplying a pre-determined ruling that bypasses the auditor. *(This is deliberately the opposite of the execution layer, which seeds deterministic agent outputs so the demo is reproducible. That seam is safe because it substitutes the thing being **judged**; a seam here would substitute the **judgment**, which is the single claim the product makes. Reproducibility on stage comes from recording the first ruling and replaying it, and from the seeded case files being unambiguous.)*
- **FR-042**: Before a ruling is recorded, the system MUST reject it as a failed audit if its reasoning reproduces a **verbatim run** of the seller's private operating instructions. *(The auditor is shown the instructions (FR-003) and its reasoning reaches the buyer through no redaction, so the containment has to sit on the output. `agent-definition.md` §4 states the rule as an instruction to the auditor — *"must never quote the prompt"* — and this makes it a check rather than a hope. It deliberately does **not** attempt to detect paraphrase: §4 explicitly permits reasoning that describes execution behaviour, and a paraphrase detector over free prose would reject legitimate rulings. Verbatim reproduction is the failure that leaks the seller's actual words, and it is the one that can be caught reliably.)*
- **FR-043**: A failed audit MUST be retried a bounded number of times. After the bound is reached the system MUST stop retrying and MUST NOT record a ruling.
- **FR-044**: An order whose audit attempts are exhausted MUST report that fact to both parties as an explicit terminal outcome, distinguishable from an audit still in progress. *(Without this the order rests in the disputed state forever: no scheduled job touches a stuck dispute, and the only backstop is the escrow's 72-hour deadline and its permissionless force-settlement. The failure that must not happen is the silent one — a screen that says the ruling is being prepared, indefinitely, with nothing behind it.)*

#### Recording and settling

- **FR-018**: The system MUST record the ruling — tier, refund amount, reasoning, citations, ruling fingerprint, and model — **before** issuing any instruction to the escrow.
- **FR-019**: The recorded refund amount MUST be derived from the tier and the order's price, and MUST be understood as a record of the ruling rather than as the instrument of payment; the escrow computes and pays the actual split.
- **FR-020**: The system MUST compute a fingerprint over the ruling's content and anchor that fingerprint in the escrow instruction, so the on-chain settlement points at the off-chain ruling that produced it.
- **FR-021**: After recording, the system MUST instruct the escrow to settle the disputed deal at the ruling's tier, using the identity whose only permitted action is settling disputes.
- **FR-022**: On a successful settlement the system MUST record the settlement reference and move the order to settled.
- **FR-023**: If the settlement instruction fails or its outcome cannot be determined, the ruling MUST remain recorded and the order MUST remain in a state from which settlement can be retried.
- **FR-024**: A retried settlement MUST use the stored ruling and MUST NOT consult the auditor again.
- **FR-025**: The system MUST refuse to audit an order that already has a ruling, and MUST enforce at most one ruling per order at the storage layer rather than by check alone.
- **FR-026**: Settlement MUST NOT write a ledger entry. Settled funds sit on-chain under each party's own address and are outside the platform's balances.
- **FR-027**: Only an order in the disputed state, with a recorded escrow deal, MUST be eligible for audit.
- **FR-028**: Disputed orders MUST be picked up for audit from the order's own state, without a separate queue or broker.

#### Reading the ruling

- **FR-029**: Users MUST be able to retrieve an order's ruling, receiving the tier, the reasoning, the citations, the refund amount, the settlement reference when one exists, and when the ruling was made.
- **FR-030**: Retrieval MUST be permitted to the buyer **or** the owner of the agent the order was placed against. A seller ruled against who cannot read the ruling has no idea what they were found to have done.
- **FR-031**: A request from anyone else MUST report the order as not found — the same response any stranger receives — rather than acknowledging the order and denying access.
- **FR-032**: Each citation MUST be delivered as structured data with its source, quoted text, and met flag as separate fields, so it can be rendered as a checklist rather than parsed out of prose.
- **FR-033**: The citation field names MUST be exactly `source`, `quote`, and `met`. These names are read literally by the client; a renamed field renders as an absent panel rather than an error.
- **FR-034**: A request for a ruling that does not exist yet MUST report its absence rather than returning a partial or provisional ruling.

#### The disclosure boundary

- **FR-035**: No buyer-facing surface introduced or extended by this feature may carry the seller's private operating instructions **verbatim**. Reasoning that describes what the agent did — *"made one extraction attempt and stopped"* — is permitted and is the point of showing the auditor the instructions at all.
- **FR-036**: The buyer's copy of a run trace MUST continue to carry only platform-authored step descriptions, with model reasoning omitted entirely rather than shortened or re-summarised. Shortening or model-summarising a paraphrase is the same disclosure with a step in front of it. *(Already satisfied by the existing serialiser — a regression check, not new work. Note this is a deliberately stricter rule than FR-035 applies to verdict prose, and the asymmetry is intentional: a step's reasoning is raw seller-side model output with no reader in between, whereas verdict prose is written by an auditor that has been instructed not to quote and is checked before it is stored.)*
- **FR-037**: The reasoning shown to a buyer with a ruling is made safe by **checking it before it is recorded** (FR-042), not by withholding its sources from the auditor. This is the one buyer-facing text in the product that no serialiser stands in front of, so the check is the boundary.

### Key Entities

- **Case file**: The complete, assembled record of one order handed to the auditor — buyer input, acceptance criteria, the pinned listing's capabilities and exclusions, the run trace, the output or its absence, errors, and timings. Assembled per audit; not itself stored.
- **Ruling (verdict)**: The decision on one order. Carries the tier, the refund amount it implies, the written reasoning, the citations, a fingerprint of its own content, the auditor model, and — once settled — the settlement reference. **At most one per order, forever.**
- **Citation**: One clause the ruling relies on: which yardstick it came from (capability, exclusion, or criterion), its quoted text, and whether the delivery met it. The unit that turns a tier into an audit.
- **Tier**: One of five refund outcomes. A closed set, not a percentage the auditor invents.
- **Complaint**: The buyer's testimony, filed once per order, that opens the dispute this feature answers.
- **Order**: The transaction under audit. Its state carries the dispute through disputed → adjudicated → settled, and is itself the work queue.
- **Run**: The recorded execution — steps, output, errors, timings. The evidence the platform produced, which the audited party did not author.
- **Pinned agent version**: The listing as it stood when the buyer paid. The only version a citation may quote.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of decided disputes produce a ruling carrying at least one citation, and every citation's quoted text appears in the clause it names.
- **SC-002**: 100% of settled disputes show an on-chain refund split matching the ruling's tier — verified by reading the settlement, not the database.
- **SC-003**: A complaint reaches a settled order without any manual intervention, and the ruling is readable within one minute of the complaint being filed.
- **SC-004**: Repeating an audit on an already-decided order never produces a second ruling, across unlimited attempts.
- **SC-005**: Reading a decided order any number of times returns identical tier, reasoning, and citations every time — the figure shown on stage does not change between rehearsals.
- **SC-006**: 100% of disputes on orders that produced no output resolve at the full-refund tier.
- **SC-007**: A complaint against work that met both the listing promise and the acceptance criteria resolves at the no-refund tier, with the met clauses cited, and the seller is paid in full.
- **SC-008**: Both the buyer and the agent's owner can retrieve the identical ruling; no third party can confirm the order exists.
- **SC-009**: Across all three rehearsal scenarios, no buyer-visible response anywhere in the audit path reproduces any verbatim run of the seller's private operating instructions.
- **SC-010**: A settlement failure after a ruling never destroys the ruling: the ruling remains readable in 100% of induced failures, and a retry settles at the original tier.
- **SC-011**: A dispute that cannot be decided is never silently stuck: after the retry bound, both parties see an explicit failure rather than an in-progress state, in 100% of induced failures.
- **SC-012**: A single failed audit never stops later disputes from being decided — the worker continues picking up work after any failure, including one where the auditor accepts a request and never answers.
- **SC-013**: Every ruling in the record was produced by the auditor. No configuration, fixture, or failure path writes one.

## Assumptions

- **The auditor IS shown the seller's private operating instructions and the raw run trace**, per `agent-definition.md` §4 and `product-workflow.md` §6.3, because the intent-versus-effort judgment depends on both. An earlier draft of this spec excluded them; that draft reversed a settled product decision rather than closing a gap, and it is withdrawn. What the earlier draft got right is that the auditor's reasoning is the one buyer-facing text with no serialiser in front of it — so the containment moved from the input to the output (FR-042) rather than disappearing.
- **Verbatim reproduction is checked; paraphrase is accepted.** `agent-definition.md` §4 explicitly permits verdict reasoning that describes execution behaviour, so a paraphrase detector would reject legitimate rulings. The residual risk — an auditor that closely paraphrases the instructions rather than quoting them — is accepted, and is the same risk the product doc accepted when it wrote the rule as an instruction.
- **"Summarise reasoning text for buyer-facing case files" is treated as already satisfied, by omission rather than summarisation.** The buyer-facing serialiser built in the previous two features drops model reasoning outright and composes each step's description from platform-authored fields. That is strictly stronger than summarising, and the reasoning for it is recorded in the existing code: model-summarising a paraphrase means feeding the prose to a model whose output ships to the buyer. This spec therefore requires the existing behaviour to hold (FR-036) rather than adding a summarisation step. **This is a deliberate divergence from the source spec's wording and worth confirming.**
- **A rejected complaint still settles on-chain.** The no-refund tier is a ruling, and it pays the seller in full through the same escrow instruction. The order reaches settled in every decided case, whatever the tier.
- **Audits are triggered by polling the order state**, mirroring the execution trigger built in the previous feature, because the order state is the queue and there is no broker.
- **A failed audit is retried by the next poll, up to a bounded number of attempts**, after which the order is marked as failed audit and reported as such (FR-043, FR-044). An earlier draft left this unbounded on the reasoning that a permanently-disputed order "looks correct"; it does not. No scheduled job in the system touches a stuck dispute — the escrow's 72-hour deadline and its permissionless force-settlement are the only backstop, and neither is reachable during a rehearsal. Unbounded retry turns an undecidable dispute into a screen that says a ruling is coming, forever.
- **Tracking attempts requires storage, so this feature carries one small migration** — two nullable columns on the order — where the plan had originally claimed none. This is the cost of FR-043 and FR-044 and is worth naming rather than absorbing.
- **The money is not freed by an exhausted audit.** The platform does not write a fallback ruling to release it, because a fabricated row in the ruling record would undermine the one claim the product makes (FR-041, SC-013). Funds stay escrowed until the escrow's own deadline permits anyone to force-settle at the quarter tier, which is the contract's existing answer for a guardian that never ruled.
- **The refund amount recorded alongside the ruling is derived from the tier and the order price** using the same proportions the escrow contract applies, and exists for display and record rather than as the payment instruction.
- **Prompt caching applies to the fixed instruction set and rubric only**, since the case file differs on every audit.
- **Automated tests are out of scope** for this component, per the standing MVP decision. Every acceptance scenario and success criterion here is verified by hand during rehearsal, which makes the rehearsal the test suite — a failed rehearsal is treated as a red build.
- **The published API contract file referenced by the source spec does not exist in the repository yet** (it belongs to a later feature). Until it does, the contract this feature is built against is the API design document's orders section and the client's declared types, and reconciling with the published file when it lands is that feature's job.
- **The complaint, the dispute transaction, and the order's move to disputed already exist** and are not re-specified here; this feature begins at an order that is already disputed.

### Carried forward from building the execution engine

The execution layer was built and run before this feature was planned. These are its verified
learnings, not predictions.

- **Every audit needs its own deadline.** Each agent run is bounded by the seller's declared
  timeout. The audit has no seller-declared bound, and needs one *more* than a run does: the
  auditor reasons before answering, so a call can legitimately run for minutes, and one worker
  slot means a single unbounded call stops every later dispute from being decided (FR-038,
  SC-012).
- **A partial answer at the deadline is discarded, not salvaged.** The execution layer's rule —
  *"a run that timed out is not a run that delivered, and there is no 'close enough' for a
  structured output a buyer would pay for"* — applies with more force to a ruling that moves
  money and cannot be appealed (FR-039).
- **The absence of a record is the marker for "did not happen."** Execution records a produced
  nothing as a genuinely absent output, never an empty placeholder, and its verification run
  checked exactly that. The same rule here: a failed audit writes no ruling row, rather than a
  row with an empty tier or empty citations that would consume the one ruling an order is ever
  allowed (FR-040).
- **A worker module and an HTTP module fail differently, and this feature is both.** Execution
  has no controller, so its errors are never mapped to a response and its error module says so
  in as many words. This feature has one route, so it has two error families: audit-path
  failures that never become HTTP responses, and read-path failures that are only ever a
  not-found. Neither may be mapped into the other.
- **Determinism belongs upstream, in what is judged — never in the judgment.** The execution
  layer substitutes agent outputs at the model call so a seeded failure travels the ordinary
  path and produces ordinary evidence. That is what makes the case files this feature reads
  reproducible. This feature must add no equivalent seam (FR-041), and its own reproducibility
  comes from recording the first ruling and replaying it.
- **Rehearsal reproducibility depends on the seeded case files being unambiguous**, which is the
  demo-fixture feature's responsibility, not this one's. A case file whose correct tier a human
  would argue about is where a non-deterministic auditor bites.
- **A schema that validates locally can still be refused by the auditor's own service.** The
  execution layer's verification run found every seeded agent schema rejected at run time for a
  constraint the local validator does not impose. This feature's schema is generated by a helper
  that applies those constraints for it, so the same defect is unlikely here — but "it validates
  locally" is not evidence that a request will be accepted, and the first live audit after any
  schema change is the check.
- **The single defect found in the execution layer's verification run was a raw query whose
  result shape was asserted rather than checked**, and a type-check could not catch it: the
  assertion was simply wrong, and thirteen orders moved into a state with no record before
  anyone noticed. Any hand-written query in this feature is subject to the same failure, and
  running it is the only thing that finds it.
