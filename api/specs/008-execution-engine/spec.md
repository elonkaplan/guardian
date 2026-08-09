# Feature Specification: The Execution Engine — the wrapped workspace

**Feature Branch**: `008-execution-engine`

**Created**: 2026-08-09

**Status**: Draft

**Input**: User description: "docs/specs/API-08-execution-engine.md — The wrapped workspace: the platform runs the seller's agent and keeps the receipts. Load the pinned definition for the order, run it against the buyer's input with the output constrained by the agent's own declared output shape, and write one run record carrying the input, the trace, the output, any error, and the timings. Record whether the output satisfies its own declared contract. Success marks delivery on-chain and moves the order to delivered; a crash or timeout leaves the order failed with a null output that is itself the evidence. Plus a deterministic demo mode for the seeded agents."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - The platform runs the seller's agent and keeps the receipts (Priority: P1)

A purchase has been recorded and the money is locked in escrow. The order is now sitting in the state that means "ready to run", and that state is the only queue there is. The platform picks it up, marks it as running so nobody else picks it up, and executes the agent itself.

It does not ask the seller to run anything. It does not accept a log the seller wrote. The platform loads the exact agent definition the order pinned at purchase — the seller's private instructions, the model that definition names, the shape it declared its input and output take, and the time limit beyond which the run counts as nothing delivered — and it runs that definition against the buyer's input inside its own instrumented workspace. Everything the run does is recorded as it happens, by the wrapper, not by the party who might one day be the defendant.

What comes out is exactly one record per order: what went in, what the agent did along the way, what came back, what went wrong if anything did, when it started, when it finished, and how long it took. One record, permanently — there is no second attempt to write over it. That single-record rule is the thing that makes the evidence trustworthy, and it is enforced by storage rather than remembered by a developer.

**Why this priority**: This is the feature. Every other story here is a branch off this one, and the entire product's claim — that the audited party never authors the evidence — rests on the platform being the thing that runs the agent and writes the record.

**Independent Test**: Purchase an agent, then confirm that the order moves to running and that exactly one execution record exists for it, carrying the buyer's input, a non-empty trace, timings, and either an output or an error. Attempt to produce a second record for the same order and confirm it is impossible.

**Acceptance Scenarios**:

1. **Given** an order in the state that means the escrow deal is open and no work has started, **When** execution picks it up, **Then** the order moves to its running state and one execution record is opened against it, carrying the buyer's input and a start time.
2. **Given** an order being executed, **When** the agent definition is loaded, **Then** it is the exact pinned definition the order names — not the agent's current definition — including the private instructions, the model, the declared input and output shapes, and the time limit.
3. **Given** a seller who publishes a new definition of the same agent while an order against the previous one is running, **When** that order finishes, **Then** what ran and what was recorded came entirely from the pinned definition.
4. **Given** a completed run, **When** the execution record is read, **Then** it carries the input, the trace, the output or its absence, any error, the start time, the finish time, and the elapsed duration.
5. **Given** an order that already has an execution record, **When** execution is invited to run it again, **Then** the second attempt is refused and the first record is untouched.
6. **Given** two execution attempts racing the same order at the same instant, **When** both try to claim it, **Then** exactly one claims it and runs, and the other finds nothing to do.
7. **Given** an order in any state other than the one that means "ready to run", **When** execution is invited to run it, **Then** it declines without touching the order.
8. **Given** an order whose escrow deal was never opened because the chain refused, **When** execution considers it, **Then** it is never picked up — there is no escrowed money to deliver against.
9. **Given** a run, **When** the buyer's input is recorded, **Then** it is the input as supplied at purchase, stored on the execution record rather than only referenced.

---

### User Story 2 - A successful run delivers, and the buyer's clock starts (Priority: P1)

The agent returns something. The platform writes the output onto the execution record with its finish time, then tells the escrow contract that this deal has been delivered. Only once the contract confirms does the order move to delivered — because that on-chain moment is what opens the buyer's review window, and an order that says "delivered" while the contract disagrees is an order whose buyer cannot accept it and whose seller cannot be paid.

The evidence is written before the chain is told. If the chain call fails, the run and its output are still on record and still complete; what has not happened is the delivery being announced. The agent is never run a second time to recover from that — the work was done, and re-running it would destroy the only record of what actually happened.

**Why this priority**: This is the happy path, and it is the whole of the demo's first act. It is also the point where the platform crosses from its own database into the chain, which is where ordering mistakes become expensive.

**Independent Test**: Purchase from an agent that succeeds and confirm that the order reaches delivered, that the escrow contract regards the deal as delivered, and that the execution record carries a non-empty output with a finish time and a duration.

**Acceptance Scenarios**:

1. **Given** an agent that returns an output within its time limit, **When** the run completes, **Then** the output, the finish time, and the elapsed duration are written to the execution record.
2. **Given** a completed successful run, **When** the escrow contract has confirmed the delivery, **Then** the order moves to its delivered state.
3. **Given** a completed successful run, **When** the two writes are examined, **Then** the execution record was written before the chain was told, never after.
4. **Given** an order that has reached delivered, **When** the buyer looks at it, **Then** the review window they may accept or complain within is running.
5. **Given** a successful run whose delivery call the chain refuses, **When** the situation is examined, **Then** the order does **not** show as delivered, the execution record and its output are kept exactly as written, the agent is not run again, and the failure is recorded at error level with whatever transaction reference exists.
6. **Given** a successful run whose delivery call has an unknown outcome — sent, with no confirmation received — **When** the situation is examined, **Then** it is treated the same as a refusal for the purposes of the order's state, and recorded at error level so it can be reconciled by hand.
7. **Given** an order whose delivery could not be announced, **When** the buyer's money-in-escrow figure is computed, **Then** that order still contributes to it — the money is genuinely still locked.

---

### User Story 3 - A crash or a timeout is proven, not merely reported (Priority: P1)

The agent throws, or it runs past the time limit its own definition declared, or the model call fails outright. The platform records what went wrong and how long it had been going, and it leaves the output empty. Not an empty object, not a placeholder, not an apology string — empty, because the absence is the evidence.

The order moves to failed. Nothing is told to the escrow contract, because nothing was delivered; the money stays locked where it is until the buyer complains or a background job reclaims it. The run is never retried. A retry would write over the one record that proves nothing arrived, which is exactly the record the buyer needs to win.

**Why this priority**: The demo's closing act is a non-delivery, and the product's claim that non-delivery is objectively detectable lives or dies here. It is also the branch that cannot be exercised by using the product normally — it has to be forced.

**Independent Test**: Purchase from an agent that deliberately fails and confirm the order reaches failed, that its execution record has an empty output and a recorded error, that the escrow deal was never marked delivered, and that no second run record is ever produced for it.

**Acceptance Scenarios**:

1. **Given** an agent whose run raises an error, **When** the run concludes, **Then** the error is recorded on the execution record, the output stays empty, the finish time and duration are recorded, and the order moves to failed.
2. **Given** an agent that runs longer than the time limit its pinned definition declares, **When** the limit elapses, **Then** the run is abandoned, recorded as a timeout naming that limit, and treated exactly as a crash.
3. **Given** a failed run, **When** the execution record's output is read, **Then** it is empty rather than an empty structure or a stand-in value.
4. **Given** a failed run, **When** the escrow contract is inspected, **Then** the deal was never marked as delivered.
5. **Given** a failed order, **When** anything attempts to run it again, **Then** the attempt is refused and the original record — including its empty output — is unchanged.
6. **Given** a failed run, **When** its trace is read, **Then** it still carries whatever the agent managed to do before it failed, so the difference between "tried and could not" and "did nothing" is visible.
7. **Given** a failed order, **When** its buyer complains, **Then** the complaint is accepted and reaches the auditor — the failure path built here is the input to that case, not a dead end.
8. **Given** a run whose error message would contain the agent's private instructions or the model's own prose, **When** the error is recorded, **Then** it is recorded in full on the record, because redaction happens on the way out to a buyer and never on the way into the evidence.

---

### User Story 4 - The trace, not just the answer (Priority: P2)

An output on its own cannot tell an auditor whether the agent genuinely attempted a task that turned out to be impossible or returned a stub without trying. Those deserve different verdicts and only the trace can separate them. So the wrapper records the run as a sequence of steps — what kind of action each was, what it was called, what the model said while doing it, how long it took, and whether it errored.

The trace is recorded raw and complete. The model's own prose can paraphrase the private instructions it was given, which is precisely why it is valuable to the auditor and precisely why it must never reach a buyer unfiltered — but that filtering is a property of how an order is shown, not of how it is stored. Evidence that was redacted before it was written is not evidence.

**Why this priority**: The trace is what makes the middle tiers of a verdict defensible rather than arbitrary. Without it the auditor can only compare an output to a promise, which collapses the interesting cases into guesses.

**Independent Test**: Run an agent and confirm the execution record carries a step sequence with more than the final answer in it. Then open the same order's case file as the seller and as the buyer, and confirm the model's prose is present in the seller's copy and absent from the buyer's.

**Acceptance Scenarios**:

1. **Given** a completed run, **When** its trace is read, **Then** it is a sequence of steps rather than a single blob, each identifying what kind of action it was.
2. **Given** a step that involved the model, **When** it is recorded, **Then** the model's own prose for that step is stored on it.
3. **Given** a step that failed, **When** it is recorded, **Then** the failure is stored on that step, not only summarised at the end of the run.
4. **Given** a run, **When** its steps are recorded, **Then** each carries its own timing, so a slow phase is identifiable without re-running anything.
5. **Given** a recorded trace, **When** the order is shown to its buyer, **Then** the model's prose does not appear — the existing disclosure boundary is what removes it, and execution stores it unmodified.
6. **Given** a very long trace, **When** it is written, **Then** it is stored whole rather than truncated to fit a limit.
7. **Given** a run that failed before the agent produced anything at all, **When** the trace is read, **Then** it records that the attempt was made and how it ended, rather than being empty.

---

### User Story 5 - Schema conformance is settled before anyone deliberates (Priority: P2)

Every agent declares the shape its output takes. That declaration is the seller's own contract with the buyer, and whether the output satisfies it is a question with a yes-or-no answer that requires no judgment. The platform answers it at the end of every completed run and records the answer alongside the output.

The output is asked for in that declared shape in the first place, so a conforming answer is the expected case. Recording the check anyway is what turns "the output looked wrong" into "the output failed its own contract" — something an auditor can state without weighing anything. A non-conforming output is still an output: it was delivered, the buyer can see it, and the buyer can dispute it. What the check does is hand the auditor a settled fact rather than an argument.

**Why this priority**: It is a small amount of work that removes an entire category of deliberation from the audit, and it is named as an acceptance criterion of this feature. It sits below the three P1 stories because a run without it still produces valid evidence.

**Independent Test**: Run an agent whose output satisfies its declared shape and one whose output does not, and confirm the recorded conformance answer is populated and correct on both, and that both orders still reached delivered.

**Acceptance Scenarios**:

1. **Given** any run that produced an output, **When** it concludes, **Then** the conformance answer is recorded — never left unanswered.
2. **Given** an output that satisfies the shape the pinned definition declared, **When** conformance is recorded, **Then** it is recorded as satisfied.
3. **Given** an output that does not satisfy that shape, **When** conformance is recorded, **Then** it is recorded as not satisfied, the output is kept exactly as returned, and the order still reaches delivered.
4. **Given** a run that produced no output at all, **When** the record is read, **Then** the conformance answer is left unanswered rather than being recorded as a failure — there was nothing to check, and the empty output already carries that meaning.
5. **Given** the conformance check itself failing to run, **When** the situation is examined, **Then** it does not turn a completed delivery into a non-delivery; the output stands and the unanswered check is recorded at error level.
6. **Given** a pinned definition whose declared output shape is itself unusable, **When** a run against it is attempted, **Then** the failure is recorded as a run failure with a reason naming the definition, rather than silently skipping the constraint.

---

### User Story 6 - The seeded agents fail on cue (Priority: P3)

The rehearsal has to produce the same three outcomes every time it is run: a summary that genuinely meets the buyer's stated criteria, an extraction that returns exactly three of five line items, and a translation that produces nothing at all. Hoping a live model misbehaves on schedule is not a plan.

So the seeded demo agents run in a deterministic mode: given the seeded inputs, they reliably produce the intended outputs, including the intended failure. This is a stated demo-rig decision rather than a hidden one. It applies only to the seeded agents' own behaviour — everything the platform does around them, and the audit that reads the resulting evidence, runs for real against real evidence.

**Why this priority**: The demo is the acceptance test for this whole component, and an unrepeatable demo is an unrepeatable test. It ranks below the rest because the engine must work on real runs first; determinism is what makes rehearsing it bearable.

**Independent Test**: Run each of the three seeded acts end to end more than once and confirm each produces the same outcome every time — the same delivered summary, the same three-of-five extraction, and the same empty-output failure.

**Acceptance Scenarios**:

1. **Given** a seeded agent and its seeded input, **When** the order is executed repeatedly, **Then** every run produces the same output, the same conformance answer, and the same order state.
2. **Given** the seeded extraction agent and its seeded receipt of five line items, **When** it runs, **Then** it returns exactly three, and the two omitted ones are identifiable by name.
3. **Given** the seeded summarising agent and its seeded document, **When** it runs, **Then** it returns a summary that satisfies the seeded acceptance criteria, so the complaint filed against it is genuinely unfounded.
4. **Given** the seeded translating agent and its seeded input, **When** it runs, **Then** it fails, leaving an empty output and a recorded error — reliably, on every rehearsal.
5. **Given** a seeded agent presented with an input other than its seeded one, **When** it runs, **Then** it behaves like an ordinary agent rather than replaying a scripted answer.
6. **Given** an agent that was not seeded, **When** it runs, **Then** deterministic mode has no effect on it whatsoever.
7. **Given** a deterministic run, **When** its execution record is read, **Then** it is a full record in the same shape as any other — trace, timings, conformance — so the audit downstream is reading genuine evidence.

---

### Edge Cases

- **Two dispatchers claiming the same order.** The claim must be a single indivisible move out of the ready state, so only one attempt can win. The one-record-per-order storage rule is the backstop, not the mechanism — if it is ever the thing that catches this, two runs were already in flight and one wasted a real model call.
- **The process dies mid-run.** The order is left in running with a record that has a start and no finish. Nothing here recovers it — that is the reaper's job and it is out of scope — but the resting state must be recognisable as stuck rather than indistinguishable from a slow run.
- **Delivery succeeds on-chain but the confirmation is lost.** The order is not advanced, so the contract believes the deal is deliverable while the platform still calls it running. Recorded at error level; recovering it means re-announcing the delivery, never re-running the agent.
- **The output is written but the process dies before the chain is told.** Identical resting state to the case above, and deliberately so: the evidence is complete and only the announcement is missing. This is the reason the record is written first.
- **A timeout that fires while the model is mid-answer.** Whatever was produced is discarded and the output stays empty. A partial answer that the buyer never received is not a delivery, and recording it as one would understate a non-delivery.
- **An agent that returns something empty but valid** — an empty list where the schema permits one. That is a delivery, not a non-delivery. The distinction between "returned nothing" and "returned an empty answer" is the difference between a guaranteed full refund and an argument the auditor has to weigh, and collapsing them would hand every thin answer a 100% verdict.
- **An error message containing the seller's private instructions.** Stored in full. The evidence is complete on the way in and filtered on the way out; anything else quietly deletes the thing the auditor needs.
- **A pinned definition that names a model the platform cannot reach.** A run failure like any other, with the reason recorded — not a crash of the dispatcher, and not a silent substitution of a different model, which would mean auditing something the seller never sold.
- **An order whose escrow deal identifier is missing.** Never executed. Running work whose payment was never locked produces evidence for a trade that does not exist.
- **A buyer complaining while the agent is still running.** Not settled here: the complaint routes are already governed by their own state rules, and this feature only moves the order into and out of running. Named so the interaction is not mistaken for a gap.
- **Deterministic mode reaching a real seller's agent.** It must be impossible for the mode to alter an agent that was not seeded, or the marketplace is quietly serving scripted answers.

## Requirements *(mandatory)*

### Functional Requirements

**Picking up the work**

- **FR-001**: System MUST take its work from the order's own state, with no separate queue, broker, or scheduler.
- **FR-002**: System MUST execute only orders that are in the state meaning the escrow deal is open and no work has started, and MUST refuse to execute an order in any other state.
- **FR-003**: System MUST NOT execute an order that carries no escrow deal identifier.
- **FR-004**: System MUST claim an order by moving it to its running state in a single indivisible operation, so that two simultaneous attempts result in exactly one execution.

**Loading what was sold**

- **FR-005**: System MUST load the specific agent definition the order pinned at purchase, never the agent's current definition.
- **FR-006**: System MUST take the private instructions, the model, the declared input shape, the declared output shape, and the time limit from that pinned definition, and MUST NOT substitute a default for any of them.
- **FR-007**: System MUST refuse to run, recording a run failure naming the definition, when the pinned definition is missing or unusable.

**Running the agent**

- **FR-008**: System MUST execute the agent itself, inside its own instrumented workspace, and MUST NOT accept any execution record, log, or output supplied by the seller.
- **FR-009**: System MUST supply the pinned private instructions and the buyer's input to the model, and MUST constrain the answer to the output shape the pinned definition declared.
- **FR-010**: System MUST abandon a run that exceeds the time limit the pinned definition declares, and MUST treat the abandonment as a failure rather than as a delivery.
- **FR-011**: System MUST NOT grant the agent any capability beyond producing an answer — no tools, no network reach of its own, no access to other orders or accounts.

**The record**

- **FR-012**: System MUST write exactly one execution record per order, enforced in storage so that no retry, no re-dispatch, and no manual re-run can produce a second one.
- **FR-013**: System MUST record on it the buyer's input, the trace, the output or its absence, any error, the start time, the finish time, and the elapsed duration.
- **FR-014**: System MUST record the trace as a sequence of steps, each identifying the kind of action, its own timing, the model's prose where there was any, and its own failure where there was one.
- **FR-015**: System MUST record the trace in full and unredacted, including model prose that may paraphrase the seller's private instructions, because the disclosure boundary belongs to how an order is shown and not to how it is stored.
- **FR-016**: System MUST record a trace even for a run that failed before producing anything, so that the attempt itself is on record.
- **FR-017**: System MUST NOT truncate, summarise, or size-cap what it records.

**Success**

- **FR-018**: System MUST write the output and the timings to the execution record before telling the escrow contract that the deal was delivered.
- **FR-019**: System MUST move the order to its delivered state only after the contract has confirmed the delivery.
- **FR-020**: System MUST leave the order short of delivered when the delivery call fails **or** when its outcome is unknown, and MUST record that at error level with whatever transaction reference exists.
- **FR-021**: System MUST NOT run the agent again in any recovery path, including one whose only failure was announcing the delivery.

**Failure**

- **FR-022**: System MUST, on a crash, an unreachable or failing model, or a timeout, record the error and the timings, leave the output empty, and move the order to failed.
- **FR-023**: System MUST leave the output genuinely empty on a failure — never an empty structure, a placeholder, or an explanatory string in the output's place.
- **FR-024**: System MUST NOT tell the escrow contract anything about a failed run, so that no order whose agent delivered nothing becomes releasable to its seller.
- **FR-025**: System MUST NOT retry a failed run, automatically or on a schedule, and MUST NOT delete or overwrite a failed run's record.
- **FR-026**: System MUST discard whatever a timed-out run had produced so far rather than recording it as a delivery.

**Conformance**

- **FR-027**: System MUST record, for every run that produced an output, whether that output satisfies the output shape the pinned definition declared.
- **FR-028**: System MUST leave the conformance answer unanswered for a run that produced no output, rather than recording it as not satisfied.
- **FR-029**: System MUST keep a non-conforming output exactly as returned and still move the order to delivered — conformance is a fact handed to the auditor, not a second definition of non-delivery.
- **FR-030**: System MUST NOT let a failure of the conformance check itself turn a completed delivery into a non-delivery; it MUST record the failure at error level and leave the answer unanswered.

**Deterministic demo mode**

- **FR-031**: System MUST produce, for each seeded agent given its seeded input, the same output, the same conformance answer, and the same order state on every run.
- **FR-032**: System MUST include among those a run that reliably fails with an empty output, so the non-delivery act is repeatable on cue.
- **FR-033**: System MUST leave every agent that was not seeded, and every input that was not seeded, entirely unaffected by deterministic mode.
- **FR-034**: System MUST produce a full execution record for a deterministic run — trace, timings, conformance — in the same shape as any other, so what the auditor later reads is genuine evidence.

**Boundaries**

- **FR-035**: System MUST NOT depend on the audit stage in any direction: execution produces evidence and the audit consumes it, and that separation is what makes "the platform produced the evidence" true in code rather than only in prose.
- **FR-036**: System MUST NOT itself decide what a buyer may see; it writes complete records and the existing disclosure boundary filters them on the way out.
- **FR-037**: System MUST express any amount it touches in the platform's single money unit, performing no conversion outside the chain-access boundary.

### Key Entities

- **The run record**: The evidence for one order — what was asked, what the agent did, what came back, what went wrong, and when. Exactly one per order, permanently, enforced in storage. It is written by the platform, which is the only reason an auditor can trust it.
- **The empty output**: Not a missing value to be tidied up but a positive claim that nothing was delivered. It is the strongest case a buyer can have and the only thing standing between a crashed agent and a paid seller. Anything that could overwrite it — a retry, a cleanup, a default — destroys it.
- **The trace**: The sequence of steps the run took. It exists to separate "genuinely tried, task was impossible" from "returned a stub without trying," which are different verdicts that nothing else in the case file can distinguish.
- **The pinned definition**: The exact thing the buyer bought — instructions, model, declared shapes, time limit — frozen at purchase. Execution runs this and nothing else, so that what ran and what is later judged are the same artefact.
- **Conformance**: A yes-or-no fact about whether an output satisfies its own declared contract, settled before any deliberation. It turns a matter of impression into a matter of record.
- **Deterministic demo mode**: A stated rig for the seeded agents, so the three rehearsal outcomes are reproducible. It scripts what the seeded agents return and nothing else — the platform's own behaviour and the audit both run for real.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Every completed purchase produces exactly one execution record, and no order in the system ever has two — verified across a full rehearsal and by attempting a deliberate re-run.
- **SC-002**: A purchase from a working agent reaches delivered with a non-empty output on every attempt, and the escrow contract agrees the deal was delivered.
- **SC-003**: A purchase from a deliberately failing agent reaches failed with an empty output on every attempt, and the escrow contract was never told the deal was delivered.
- **SC-004**: The conformance answer is populated on every run that produced an output, across every order in a full rehearsal, with no unanswered cases.
- **SC-005**: Every execution record carries a trace with more in it than the final answer, so an auditor can tell an attempt from a stub without re-running anything.
- **SC-006**: No buyer-facing view of an order or its case file contains the seller's private instructions or the model's own prose, verified by setting the instructions to a marker string and searching every buyer-facing response, with zero matches — while the seller's copy of the same order contains both.
- **SC-007**: An agent republished between purchase and execution changes nothing about what ran: the instructions, model, declared shapes, and time limit used are identical to the pinned ones.
- **SC-008**: An agent that runs past its declared time limit is abandoned within a small margin of that limit and lands as a failure with an empty output, every time.
- **SC-009**: The three demo acts each produce their intended outcome on every rehearsal — a genuinely adequate summary, exactly three of five line items, and an empty output — with no manual correction between runs.
- **SC-010**: A forced failure of the delivery announcement leaves the execution record and its output intact, the agent not re-run, and the order not showing as delivered.
- **SC-011**: The buyer's money-in-escrow figure remains correct across every state this feature produces, and the sum across all buyers still equals the total the escrow contract reports as locked.
- **SC-012**: A failed order can be complained about and reaches the auditor, closing the non-delivery act with a verdict rather than a timeout.

## Assumptions

- **All acceptance criteria here are verified by hand.** Automated tests of every kind are out of scope for this component — a time-boxed decision recorded in the component context. The demo rehearsal is the test suite.
- **The record is written before the chain is told, and this is not the money-ordering rule.** Announcing a delivery moves no money; the ordering here exists so that a lost chain response leaves complete evidence and a missing announcement, rather than an announced delivery with no record of what was delivered.
- **A delivery announcement that fails or whose outcome is unknown leaves the order in running.** It is not moved to failed, because something *was* produced and calling that non-delivery would be false. It is not moved to delivered, because the review window is opened by the contract and an order the contract does not consider delivered cannot be accepted or released. The resting state is a stuck running order, and two things outside this feature already resolve it: the background reaper eventually moves a running order past its timeout to failed — leaving a failed order that does have an output, which an auditor reads on its merits rather than as non-delivery — and the buyer's complaint against a failed order re-announces the delivery and opens the dispute in one action, which is the path that recovers the lost announcement. Neither is built here; both are named so the resting state is understood as recoverable rather than abandoned.
- **Non-conformance is a delivery, not a failure.** The output exists, the buyer received it, and the order is disputable. Treating it as non-delivery would hand a guaranteed full refund to any output with a stray field, which is a far larger judgment than the check is entitled to make.
- **The output is requested in its declared shape**, so conformance is expected to hold; recording it anyway is what lets the auditor assert it rather than assume it.
- **The time limit comes from the pinned definition, not from configuration**, because it is part of what the seller declared and what the buyer bought.
- **The model comes from the pinned definition too.** The platform does not choose the model for a seller agent and never substitutes one, because an audit must be of the thing that was actually sold.
- **Agents have no tools in this feature.** A tool allowlist exists in the product's longer-term shape but nothing here grants one, and the trace's step kinds are wider than what a tool-less run will ever produce.
- **Sandboxing untrusted seller code is out of scope**, explicitly, because in this build all three seller agents are authored by us. It is named as a genuine production concern rather than an oversight.
- **Retries are out of scope and structurally prevented**, not merely omitted. The one-record-per-order storage rule means a retry cannot quietly succeed.
- **Recovering a stuck running order is out of scope** and belongs to the background reaper defined elsewhere. Naming it here keeps the resting state from being mistaken for a gap in this feature.
- **The disclosure boundary already exists** and is the single serialisation choke point built for the catalogue and extended by the orders work. This feature writes complete records and changes nothing about that boundary.
- **The audit stage consumes what this produces and is out of scope.** This feature defines the evidence and the states the auditor picks up from; it does not weigh anything.
- **Deterministic mode is a demo-rig decision recorded up front**, applying only to the seeded agents' own behaviour. The platform's instrumentation and the audit run for real against the resulting evidence.
- **The three seeded fixtures — the document, the five-line receipt, and the translation input — are owned by the demo-seed work, not by this feature.** This feature builds the mechanism that makes a seeded run deterministic; that work authors the three agent definitions, the three fixture inputs, and the three intended outcomes, and registers them. The split follows the dependency direction the demo-seed brief already declares. Until those fixtures are registered the mechanism is inert, and every run is a live one.
- **This feature depends on** the run and order storage from the entities and migrations work; the catalogue's pinned definitions and its disclosure boundary; the chain-access layer that owns the delivery announcement; and the purchase saga that leaves orders in the state this feature consumes.
