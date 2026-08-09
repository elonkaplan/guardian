# Feature Specification: Demo seed & the three seller agents

**Feature Branch**: `011-demo-seed-fixtures`

**Created**: 2026-08-09

**Status**: Draft

**Input**: User description: "docs/specs/API-11-demo-seed.md — Demo seed & the three seller agents. The catalogue the demo runs on, and the failure modes all three acts depend on."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A seeded marketplace whose agents actually run (Priority: P1)

An operator points a single command at an empty system and gets a working marketplace: three listings, each with a name, a description, what it claims to do, what it explicitly refuses to do, the shape of input it takes, the shape of output it returns, its price, and its private operating instructions. A buyer can find all three, buy from all three, and receive a real result from all three.

**Why this priority**: Nothing else in this feature is reachable without it, and "the listing exists" is not the bar — the bar is that a purchase from each of the three produces a run rather than a definition error. The previous feature's verification run proved this is where the seed fails: every listing looked valid and every run was refused.

**Independent Test**: Seed an empty system, then purchase once from each of the three listings and confirm each produces a recorded run. Delivers a working demo marketplace with no fixture or act implemented.

**Acceptance Scenarios**:

1. **Given** an empty system, **When** the seed is run once, **Then** three listings exist, each carrying capabilities, exclusions, an input contract, an output contract, a price, and private operating instructions, and each is discoverable in the public catalogue as buyable.
2. **Given** the three seeded listings, **When** a buyer purchases from each in turn with input matching that listing's input contract, **Then** each purchase produces a recorded run — none is refused for a reason internal to its definition.
3. **Given** a seeded system, **When** the seed is run a second time, **Then** no duplicate listing is created, no second on-chain registration is made, and the caller receives the identifiers that already exist.
4. **Given** the seed's response, **When** it is read by anyone, **Then** it carries no seeded private operating instructions.
5. **Given** a system where the demo seller's payout identity is not configured, **When** the seed is run, **Then** it refuses and creates nothing, rather than publishing listings whose earnings pay out to an address nobody controls.

---

### User Story 2 - Act 2: a shortfall the room can count (Priority: P2)

A buyer hires the receipt agent on a receipt that plainly shows five line items, asking for all of them with totals. The agent returns three and drops two. The buyer complains. Everyone watching can count the rows before the ruling appears, and the ruling names the two that are missing.

**Why this priority**: It is the demo's centrepiece and the only act where the audience reaches the verdict before the auditor does. It is also the act with the most moving parts, so it must be exercised earliest.

**Independent Test**: Buy the seeded receipt fixture, read the delivered output, and confirm exactly three of the receipt's five line items came back and the two omitted ones are identifiable by name from the receipt itself.

**Acceptance Scenarios**:

1. **Given** the seeded receipt input, **When** the receipt agent runs, **Then** the delivered output contains exactly three line items, each matching a line on the receipt, and the two omitted lines are nameable from the receipt.
2. **Given** the same purchase repeated, **When** the agent runs again, **Then** the same three line items come back — not three different ones.
3. **Given** the delivered output, **When** the buyer complains that items are missing, **Then** the ruling reaches the half-refund tier and its citations name the shortfall.
4. **Given** the buyer's complaint also raises a grievance the listing explicitly excludes, **When** the ruling is made, **Then** it cites that exclusion in the seller's defence and still reaches the half-refund tier.
5. **Given** a different receipt typed by an onlooker, **When** the same agent runs on it, **Then** a real extraction is returned rather than the seeded three-of-five.

---

### User Story 3 - Act 1: a complaint that is correctly rejected (Priority: P3)

A buyer buys a summary, asking for one under a hundred words that covers a specific point. They get a summary well inside the cap that does cover that point — and complains anyway that it is too short. The ruling goes against them and the seller is paid in full.

**Why this priority**: It is the demo's opening argument and the answer to the first objection any audience forms. It is also the fixture most easily got wrong in a way that inverts the argument: a summary that misses the required point turns a fairness demonstration into a visible misfire.

**Independent Test**: Buy the seeded summary fixture and read the output: confirm it is under the cap, that the word count it declares matches the summary it returns, and that a human reading it agrees the required point is covered.

**Acceptance Scenarios**:

1. **Given** the seeded document and the criteria *"under 100 words, must cover the pricing change"*, **When** the summary agent runs, **Then** the delivered output is a summary of roughly eighty-five words that discusses the pricing change, and it declares its own word count.
2. **Given** the delivered summary, **When** its declared word count is compared with the summary text, **Then** the two agree — the declaration is not decorative.
3. **Given** the buyer complains *"too short"*, **When** the ruling is made, **Then** it reaches the no-refund tier, cites the buyer's own word cap, and the seller is paid in full.
4. **Given** the fixture is inspected before a rehearsal, **When** a reader who was not involved in writing it is asked whether the summary covers the pricing change, **Then** they say yes without needing the question explained.

---

### User Story 4 - Act 3: nothing arrived, and the absence was recorded (Priority: P4)

A buyer pays for a translation. The agent crashes and produces nothing. The order lands in the failed state with no output at all, and the crash itself is on the record. The buyer complains and gets everything back.

**Why this priority**: It closes the tier range at 100% and is the act the audience can check without reading anything. It rides entirely on the ordinary failure path, so it is the least new work — but the way it is built is what makes or breaks it.

**Independent Test**: Buy the seeded translation fixture and confirm the order reaches the failed state, no output was recorded, and an error describing the crash was.

**Acceptance Scenarios**:

1. **Given** the seeded translation input, **When** the agent runs, **Then** the order reaches the failed state, no output is recorded, and the failure is recorded as an error on the run.
2. **Given** the failed order, **When** the case file is assembled, **Then** the absent output is presented as an explicit statement that nothing was produced.
3. **Given** the buyer complains, **When** the ruling is made, **Then** it reaches the full-refund tier and the buyer's whole payment returns.
4. **Given** the seeded crash, **When** the path it travelled is inspected, **Then** it is the same path any real crash travels — no record was written ahead of it and no state was set for it directly.

---

### User Story 5 - Reset makes the rehearsal repeatable (Priority: P5)

An operator has just run all three acts. One call clears the transactional history — orders, runs, complaints, rulings — and leaves the accounts and the three listings standing. The acts run again from the top with no re-seeding and no manual database work.

**Why this priority**: The acts will be run many times before they are run once in front of people, and re-seeding by hand between rehearsals is how a demo gets broken. It depends on the other four stories existing but is independently observable.

**Independent Test**: Run one act to a settled ruling, call reset, and confirm the order, its run, its complaint, and its ruling are gone while the accounts and the three listings remain and the act can be run again.

**Acceptance Scenarios**:

1. **Given** a system where all three acts have run, **When** reset is called, **Then** every order, run, complaint, and ruling is gone, and the accounts and the three listings — with their on-chain registrations — remain.
2. **Given** a reset system, **When** the three acts are run again without re-seeding, **Then** each reaches the same tier it reached before: no refund, half refund, full refund.
3. **Given** a system with no orders at all, **When** reset is called, **Then** it succeeds and reports that nothing was cleared.
4. **Given** an order still in flight, **When** reset is called, **Then** the reset reports how many in-flight orders it removed, and the worker holding one does not crash or leave a half-written record behind.
5. **Given** a reset, **When** the ledger is read afterwards, **Then** no ledger entry was deleted or reversed.

---

### Edge Cases

- **An output contract is accepted at listing and refused at execution.** This is the known failure and it has already happened once: the listing validator is more permissive than the model service, so a definition can be published and then refuse to run. The seed's own success condition is therefore an execution, not a validation — the seed is not "done" because three rows exist.
- **The platform restarts after seeding.** The listings survive in storage; anything held only in memory does not. If the fixtures do not come back with the process, Act 2 quietly returns a live extraction of five items on stage and the demo's centrepiece dissolves without an error anywhere. The fixtures must be in force whenever the seeded listings exist.
- **An onlooker pastes their own receipt into the receipt agent.** They get a real extraction. The fixture is keyed to a specific input as well as a specific listing, so anything else is a live run — which is also the honest answer to *"is this thing actually running?"*
- **Someone registers their own agent called "LedgerBot".** They inherit nothing. The fixture is keyed to the seeded definition itself, not to a name a stranger can copy.
- **The seed is interrupted after one or two listings are registered.** The next run completes the set rather than starting a fourth and fifth listing, and does not re-register what is already on-chain.
- **Reset is called while an act is mid-run.** The order disappears from under a worker. The worker must fail quietly and leave nothing partial; a reset must never be the reason the process dies or the reason an orphaned record survives.
- **Reset is called twice in a row.** The second call clears nothing and succeeds.
- **Money that was already escrowed or settled when reset ran.** It stays where it is. Clearing the platform's record of an order does not and cannot recall funds sitting in escrow or already paid out — reset restores a *re-runnable* system, not a rewound one.
- **The buyer's balance after several rehearsals.** Each rehearsal spends real balance and reset does not give it back, because the ledger is append-only and settled money is on-chain under someone else's address. A long rehearsal session needs topping up through the ordinary funding path.
- **The seeded summary drifts off the required point.** Act 1 inverts: the complaint becomes valid and a no-refund ruling stops being a demonstration of fairness. The fixture is checked by reading it, not by counting its words.
- **The seeded receipt has too many rows to count from the back of a room.** The verdict stops being arithmetic the audience can do, which is the entire reason this agent is the centrepiece.
- **The two dropped line items cannot be named.** A ruling that says "some items are missing" is an opinion; one that names the two is arithmetic. The fixture must make both omissions identifiable from the receipt itself.
- **A seeded crash that never reaches the failed state.** An error recorded on a run that stays in some other state removes the evidence the ruling depends on — the absence of output is what proves non-delivery, and it only counts if the order says so too.
- **A fixture that writes a ruling, a state, or a run record directly.** The demo stops demonstrating anything: the auditor would be judging a record the demo wrote rather than evidence the platform produced.
- **Two consecutive rehearsals reach different tiers on the same act.** The ruling is made fresh after a reset, so the fixture is what has to be unambiguous. A case file whose correct tier a reasonable person would argue about is a fixture defect, and it surfaces as a wrong number on stage.
- **The seed endpoint is called by a stranger against a deployed instance.** It is unauthenticated by decision, so it must be safe to call twice and it must not disclose the seller's private operating instructions in what it returns.

## Requirements *(mandatory)*

### Functional Requirements

#### Seeding the catalogue

- **FR-001**: A single seed call MUST create three seller listings — a receipt-extraction agent, a summarisation agent, and a translation agent — each carrying a name, a description, stated capabilities, stated exclusions, an input contract, an output contract, private operating instructions, a model, a price, and a timeout.
- **FR-002**: The prices MUST be exactly $2.00 for the receipt agent, $1.00 for the summariser, and $1.50 for the translator, so that the half-refund split shown on screen is a clean dollar each way.
- **FR-003**: The output contracts MUST be: a list of line items each with a description and an amount, plus a total, for the receipt agent; a summary and a word count for the summariser; a translation for the translator. The list is what makes Act 2 countable and the declared word count is what makes Act 1 mechanical — free text in either place turns an arithmetic ruling into an opinion.
- **FR-004**: Every object appearing anywhere in a seeded output contract — the root and every nested object — MUST explicitly declare that no additional properties are permitted. A contract that omits this passes listing validation and is refused at execution, which fails all three acts for a reason unrelated to anything the demo is about.
- **FR-005**: The seed MUST refuse to publish a definition whose output contract would be refused at execution, rather than publishing it and discovering it during an act.
- **FR-006**: All three listings MUST be owned by a demo seller identity whose payout address comes from configuration. If it is absent, the seed MUST refuse and create nothing — ownership is fixed at registration, so a listing published against the wrong payout address cannot be corrected.
- **FR-007**: Seeding MUST be idempotent: a second call MUST NOT create a duplicate listing, MUST NOT register a second agent on-chain, and MUST return the identifiers that already exist.
- **FR-008**: An interrupted seed MUST be completable by running it again — the second run finishes the set rather than starting a parallel one.
- **FR-009**: The seed MUST report success only once all three listings are buyable: registered on-chain, active, and visible in the public catalogue.
- **FR-010**: The seed's response MUST NOT contain any seeded private operating instructions. The route is unauthenticated, so its response is a public surface.
- **FR-011**: The seed and reset routes MUST require no authentication and MUST carry no environment guard, per the recorded API decision, and that fact MUST be documented where an operator will read it.

#### The three fixtures

- **FR-012**: The system MUST register exactly three fixtures, one per act, each bound to one seeded definition and one specific input.
- **FR-013**: A fixture MUST comprise the buyer's input, the buyer's acceptance criteria, the buyer's complaint text, and the intended outcome. Seeding only the input leaves two thirds of what the ruling is computed from to whoever is typing on stage.
- **FR-014**: **Act 1** — given the seeded document and the criteria *"under 100 words, must cover the pricing change"*, the summariser MUST deliver a summary of approximately eighty-five words that substantively covers the pricing change, and MUST declare a word count that agrees with the summary it returns.
- **FR-015**: Act 1's summary MUST be verified by reading it, not by counting its words. Word count alone cannot detect the failure that matters — a summary inside the cap that never mentions the pricing change makes the buyer's complaint valid and reverses the act.
- **FR-016**: **Act 2** — the seeded receipt MUST contain exactly five line items, and the receipt agent MUST return exactly three of them, the same three every time.
- **FR-017**: The two omitted line items MUST be identifiable by name from the receipt, so the ruling can name them rather than gesture at them.
- **FR-018**: The seeded receipt MUST be countable at a glance from the back of a room — few enough rows to count, and descriptions short enough to read at a distance.
- **FR-019**: The total in Act 2's output MUST be consistent with the three items actually returned, so the shortfall is visible twice: in the row count and in the money.
- **FR-020**: Act 2's fixture MUST be designed so that the buyer's complaint contains one grievance that a stated exclusion answers, and the resulting ruling cites that exclusion while still reaching the half-refund tier. An exclusion that is never cited is a claim the demo makes and never shows.
- **FR-021**: **Act 3** — the seeded translation input MUST produce a crash that delivers nothing: the order reaches the failed state, no output is recorded, and the failure is recorded as an error on the run.
- **FR-022**: Act 3's failure MUST travel the ordinary failure path. No fixture may set an order's state, write a run record, or write a ruling directly.
- **FR-023**: The substitution a fixture performs MUST be confined to what the seller's agent produces. Everything downstream — the run record, the trace, the timings, the conformance check, the state move, the chain calls, and the audit — MUST be the ordinary machinery.
- **FR-024**: A fixture MUST fire only on an exact match of both the seeded definition and the seeded input. Any other input to a seeded agent MUST produce a live run.
- **FR-025**: A fixture MUST be bound to the seeded definition itself rather than to the agent's name, so a listing published by anyone else cannot inherit it.
- **FR-026**: The registered fixtures MUST be in force whenever the seeded listings exist, including after a restart of the platform. A seeded listing whose fixture is missing is worse than an error, because it succeeds: the act runs live and produces a plausible wrong result with nothing logged as having gone wrong.
- **FR-027**: Each fixture MUST produce a case file whose correct tier is not arguable — no refund for Act 1, half for Act 2, full for Act 3. Reproducibility across rehearsals comes from the evidence being unambiguous, since the ruling is made fresh whenever a previous one has been cleared.
- **FR-028**: The system MUST publish the three fixtures — input, acceptance criteria, and complaint text — exactly as registered, so an act can be driven without re-typing them. A retyped input is a different input and produces a live run.

#### Reset

- **FR-029**: A single reset call MUST remove every order, run, complaint, and ruling.
- **FR-030**: Reset MUST preserve accounts and MUST preserve the seeded listings, their versions, and their on-chain registrations, so the acts can be re-run without re-seeding.
- **FR-031**: Reset MUST NOT delete or reverse any ledger entry. The ledger is append-only, and money that has settled is on-chain under its recipient's own address and cannot be recalled by clearing a record.
- **FR-032**: Reset MUST report what it cleared, including how many orders were still in flight, so an operator who resets mid-act knows funds were left escrowed.
- **FR-033**: Reset MUST succeed when there is nothing to clear, and MUST be safe to call repeatedly.
- **FR-034**: A worker whose order is removed by a reset MUST fail quietly and leave no partial record. A reset MUST never be the cause of a crashed process or an orphaned row.
- **FR-035**: After a reset, the three acts MUST be runnable end to end again with no re-seeding and no manual data editing, given sufficient buyer balance.

#### Verification

- **FR-036**: The seeded definitions MUST be verified by purchasing from each of the three and observing a run, not by re-reading the stored definitions. A definition that reads correctly and is refused at execution is the exact failure this requirement exists to catch.
- **FR-037**: The three acts MUST be verified end to end at least twice, with a reset in between, and both passes MUST reach the same three tiers.

### Key Entities

- **Seeded listing**: One of the three demo agents, as published — its claims, its exclusions, its input and output contracts, its price, and its private instructions. Owned by the demo seller, registered on-chain, indistinguishable in shape from any seller's listing.
- **Fixture**: One act's content — the buyer's input, the acceptance criteria, the complaint text, and the intended outcome — bound to one seeded definition. Content, not code.
- **Act**: One end-to-end demo run: purchase, execution, complaint, ruling, settlement. Three of them, targeting the no-refund, half-refund, and full-refund tiers.
- **Demo seller identity**: The account that owns all three listings and receives every seller payout on stage. Its payout address is configuration, not a literal.
- **Reset**: The operation that returns the system to a re-runnable state by clearing transactional history while leaving identity, catalogue, and the ledger intact.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: From an empty system, one seed call followed by one purchase from each listing produces three runs, and none of the three fails for a reason internal to its own definition.
- **SC-002**: An operator can take an empty system to demo-ready — three listings, three fixtures, all three buyable — in under two minutes, with no manual data editing.
- **SC-003**: Act 2 returns exactly three of the receipt's five line items, and the same three, on five consecutive runs.
- **SC-004**: Act 1's delivered summary is under the hundred-word cap, its declared word count agrees with the summary it returns, and an independent reader confirms it covers the pricing change — every run.
- **SC-005**: Act 3 reaches the failed state with no recorded output and a recorded error, on every run.
- **SC-006**: All three acts run end to end and reach the no-refund, half-refund, and full-refund tiers respectively, on two consecutive rehearsals separated by a reset.
- **SC-007**: At least one of the three rulings cites a stated exclusion of the listing it judges.
- **SC-008**: An input other than the seeded one, given to any seeded agent, produces a live result rather than the scripted one, in every attempt.
- **SC-009**: Restarting the platform between two rehearsals changes no act's outcome.
- **SC-010**: Seeding twice produces three listings, not six, and no second on-chain registration.
- **SC-011**: No seed or reset response contains any seeded private operating instructions.
- **SC-012**: After a reset, every order, run, complaint, and ruling is gone, all three listings and every account remain, and no ledger entry was removed.
- **SC-013**: A reset issued while an act is running leaves no partial record and does not stop the platform from serving the next rehearsal.
- **SC-014**: The two line items Act 2 dropped can be named from the receipt by someone seeing it for the first time.

## Assumptions

- **One demo seller owns all three listings.** The product documents describe three agents but never three sellers, and a single seller identity means every payout on stage — full release, split, full refund — lands somewhere the operator can point at. Its payout address comes from configuration because ownership is fixed at registration and cannot be corrected afterwards.
- **The seed does not manufacture money.** Buyer balance arrives through the existing funding path. Crediting a balance directly would promise money the pool does not hold, which is the one direction the two-phase money rule forbids.
- **Reset leaves the ledger alone**, and therefore does not restore spent balance. The alternative — deleting or reversing purchase entries — breaks the append-only rule and would credit back money that has already left the pool for an escrow or a settlement. A long rehearsal session tops up instead. **This is a deliberate reading of a source spec that lists what reset clears and does not mention the ledger.**
- **A fixture is input *and* criteria *and* complaint text.** The ruling is computed from all three, so seeding the input alone would leave the demo's reproducibility resting on someone typing the same acceptance criteria twice.
- **Reproducibility across rehearsals comes from unambiguous evidence, not from a stored answer.** A recorded ruling is replayed rather than recomputed, but a reset clears rulings, so the next rehearsal audits afresh. That is why each fixture's correct tier must be one nobody would argue about.
- **The seeded agents' behaviour is the only thing scripted.** This is the demo-rig decision recorded up front in the product documents, and it is honest to state on stage: the auditor, the chain, the state machine, and the platform's instrumentation all run for real against the resulting evidence.
- **The substitution mechanism already exists.** The execution work built it and shipped it empty, explicitly leaving the three definitions, the three inputs, and the three intended outcomes to this feature. This feature authors and registers content; it does not build a second seam.
- **Requiring the fixtures to survive a restart is an addition to the source spec**, which does not mention it. It follows from the mechanism being in-memory while the listings are stored: without it, the failure is silent and lands on stage.
- **Neither demo route is authenticated or environment-guarded**, per the recorded API decision. The mitigation is that both are safe to call twice and neither discloses seller instructions.
- **The published API contract file the source spec names does not exist in this repository yet** — it belongs to a later feature. Until it does, the contract is the API design document's demo section, and reconciling with the published file when it lands is that feature's job.
- **Act 3′ — the autonomous variant with a machine buyer — is out of scope.** Agent buyers are deferred. Act 3 itself is in the demo with a human buyer; only the machine-buyer framing is cut, and it is worth saying aloud during Act 3 rather than staging.
- **Automated tests are out of scope** for this component, per the standing decision. Every acceptance scenario and success criterion here is verified by hand, which makes the rehearsal the test suite — and this feature is what the rehearsal runs on.

### Carried forward from building the execution and audit engines

Both were built and run before this feature was specified. These are recorded findings, not predictions.

- **Every seeded output contract was refused at execution, and all thirteen orders failed identically.** The model service rejects an object schema that does not explicitly forbid additional properties; the listing validator does not. The engine degraded correctly — a recorded failure naming the definition — which means the symptom was every act failing for a reason unrelated to what was being judged. Confirmed in both directions against the live service (FR-004, FR-005, SC-001).
- **"It validates locally" is not evidence that a run will be accepted.** The first live purchase after any change to a seeded definition is the check (FR-036).
- **The 0% and 50% acts have never run.** Every disputed order in the system so far is a non-delivery, so only Act 3's tier has been exercised end to end. The audit engine's own verification names this as its largest gap and points at this feature to close it (SC-006).
- **The audit engine's reproducibility depends on this feature's fixtures.** It records the first ruling and replays it, and its spec states plainly that a case file whose correct tier a human would argue about is where a non-deterministic auditor bites — and that the fixture, not the auditor, is where that is fixed (FR-027).
- **Determinism belongs in what is judged, never in the judgment.** The execution layer substitutes the model call so a seeded failure travels the ordinary path and produces ordinary evidence; the audit layer forbids any equivalent seam for verdicts. This feature stays on the execution side of that line (FR-022, FR-023).
- **An absent record is the marker for "did not happen."** Execution writes a genuinely absent output rather than an empty placeholder, and its verification checked exactly that across thirteen orders. Act 3 depends on it (FR-021).
- **The one defect the execution verification found was a query whose result shape was asserted rather than checked**, and a type check could not catch it — thirteen orders moved state with no record before anyone noticed. Any hand-written data operation in this feature, and reset is one, carries the same risk, and running it is the only thing that finds it (FR-029, FR-034).
- **There is an open finding in the settlement retry path**: an order left adjudicated whose deal is already settled on-chain retries roughly every two seconds and floods the log indefinitely. It is not this feature's defect, but a reset that clears orders mid-flight is one way to meet it during a rehearsal, and an operator should know the noise is a known issue rather than a new one.
