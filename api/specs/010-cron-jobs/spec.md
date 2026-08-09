# Feature Specification: Cron jobs — the three timers that make the deadlines fire

**Feature Branch**: `010-cron-jobs`

**Created**: 2026-08-09

**Status**: Draft

**Input**: User description: "docs/specs/API-10-cron-jobs.md — The three timers that make the contract's deadlines actually fire. A smart contract cannot act on its own; something must poke it. A sweeper releases a delivered order once its review window expires. A reclaimer takes a buyer's money back out of an escrow deal that was never delivered against, once the delivery deadline passes. A reaper moves an order stuck mid-execution to failed. Each job logs what it acted on, each is idempotent, and none of them may crash the scheduler when a chain call fails."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - The sweeper: an untouched order pays its seller on its own (Priority: P1)

A buyer bought something, the agent delivered, and the buyer did nothing at all — did not accept, did not complain, closed the tab. The review window they were given runs out. Nothing in the escrow arrangement moves on its own: the money is still locked, the seller is still unpaid, and the contract will sit in that position forever unless somebody sends it a transaction saying the window is over.

So the platform sends it. On a fixed cadence it looks for orders that have been delivered and whose review window has now elapsed, and for each one it tells the escrow to pay the seller. Only once the chain confirms that payout does the order move to its released state — because the order saying "released" is a claim about where the money is, and making that claim before the chain agrees is how a seller reads "paid" on a screen while holding nothing.

The cadence is tunable per deployment. A rehearsal wants it in seconds, because the whole point of the first act is that the audience watches an uncontested trade settle itself with nobody touching the keyboard. A real deployment wants it in minutes, because a query per second forever buys nothing.

The platform is a convenience here, not a dependency. Releasing after the window is something anyone can do — a seller the platform never sweeps can send that transaction themselves. That is deliberate, and it is also why this job may never assume it was the one that acted: it must be equally correct arriving second.

**Why this priority**: This is the job the audience sees. It is the ending of Act 1, and without it the demo's happy path stops one step short of the money actually moving. It is also the only thing that pays a seller who was never disputed.

**Independent Test**: Deliver an order, touch nothing, and wait out the review window. Confirm the order reaches released without any request being made, that the escrow regards the deal as settled, and that the seller's on-chain settled funds rose by the full price.

**Acceptance Scenarios**:

1. **Given** a delivered order whose review window has elapsed and which nobody accepted or complained about, **When** the next sweep runs, **Then** the escrow is told to pay the seller and, once that is confirmed, the order moves to released.
2. **Given** a delivered order whose review window has **not** yet elapsed, **When** a sweep runs, **Then** it is not touched and no chain call is made for it.
3. **Given** an order the sweeper has just released, **When** the following sweep runs, **Then** it is not selected again and no second payout is attempted.
4. **Given** a released order, **When** the buyer's and seller's money figures are read, **Then** the price has left the buyer's escrowed total and appears in the seller's settled funds, in that one place only.
5. **Given** a released order, **When** the ledger is inspected, **Then** the sweep wrote no ledger entry at all — the payout happened on-chain, under the seller's own address, where the platform cannot recapture it.
6. **Given** a deal that somebody else already released permissionlessly, **When** the sweeper reaches it, **Then** the order still ends up released and the job does not get stuck retrying it forever.
7. **Given** a chain that refuses the payout because it considers the window still open — a few seconds of disagreement between the platform's clock and the chain's — **When** the sweep handles that refusal, **Then** it is treated as "not yet", the order is left exactly as it was, and the next pass tries again.
8. **Given** a buyer who complains in the last second of the window while a sweep is in flight, **When** the outcome is examined, **Then** the order is never both released and disputed: whichever the chain accepted first is what the order reflects, and the sweeper reconciles to the chain rather than overwriting it.
9. **Given** ten orders whose windows expire at the same moment, **When** the next sweep runs, **Then** all ten are handled without waiting ten cadences.

---

### User Story 2 - The reaper: nothing sits mid-run forever (Priority: P1)

There is no job queue. An order being worked on is an order whose state says "running", and that state is the only record that somebody is on it. Restart the backend at that instant and the worker is gone while the state remains — the order is now claimed by a process that no longer exists, and nothing will ever unclaim it. The buyer waits on a screen that says work is in progress, and it never is again.

The reaper is what closes that hole. On a short cadence it looks for orders that have been running longer than the agent's own declared time limit could possibly justify, plus a margin so a legitimately slow run is never killed out from under itself, and it moves them to failed.

Marking them failed is correct, not a workaround. From the buyer's side, an agent that never came back is non-delivery, regardless of whether the reason was a crash, a deploy, or a model that hung. That is exactly the position the buyer is entitled to complain from, and the failure the reaper writes is the same failure a crashed run would have written.

Two things it must not do. It must not tell the escrow anything, because nothing was delivered and announcing delivery on an order that produced nothing would open a review window over work that does not exist. And it must not erase what is already recorded — in particular, an order can be stuck in running precisely because its delivery announcement was lost after a successful run, and that order has a real output on its record. The reaper marks that order failed too, because the chain never learned of the delivery, but it leaves the output exactly where it is for an auditor to read on its merits.

**Why this priority**: Without it a single restart during a rehearsal leaves a permanently wedged order with the buyer's money locked and no path out. It is the safety net that lets "the state column is the queue" be a real design rather than a bet on the process never dying.

**Independent Test**: Start a run, kill the backend mid-execution, restart it, and confirm that within the reaper's cadence the order has moved from running to failed, that the escrow was never told anything about it, and that its run record still carries whatever the run managed to produce before it was interrupted.

**Acceptance Scenarios**:

1. **Given** an order left in running by a process that no longer exists, **When** its time limit plus the grace margin has passed, **Then** the next reaper pass moves it to failed.
2. **Given** an order that has been running for less than its declared time limit, **When** a reaper pass runs, **Then** it is left alone.
3. **Given** an order the reaper has moved to failed, **When** the escrow is inspected, **Then** it was never told the deal was delivered and no payout was attempted.
4. **Given** an order the reaper has moved to failed, **When** its run record is read, **Then** an ending is recorded on it — a finish time and the reason it was abandoned — and nothing that was already written has been overwritten.
5. **Given** an order stuck in running whose run actually produced an output that was never announced, **When** the reaper handles it, **Then** the order moves to failed and that output is still present and unaltered on the record.
6. **Given** an order the reaper has moved to failed, **When** anything considers running it again, **Then** it is not re-run and no second run record appears.
7. **Given** an order that finishes normally between being selected by a pass and being written, **When** the pass writes, **Then** it does not move a delivered order back to failed.
8. **Given** a failed order, **When** its buyer complains, **Then** the complaint is accepted — the reaper produced an ordinary non-delivery, not a special case.
9. **Given** a disputed order that Guardian has been unable to rule on, **When** the reaper runs, **Then** it does not touch it: stuck disputes are not this job's business and are resolved by the escrow's own dispute deadline.

---

### User Story 3 - The reclaimer: money is never stranded in a deal that never delivered (Priority: P2)

An escrow deal that was opened and never delivered against holds a buyer's money with no way out of its own accord. Two orders end up in that position: one that was never picked up and never ran at all, and one whose agent ran and produced nothing. Both look identical to the contract — the deal is open, the delivery deadline is ticking, and after it passes anyone at all may take the money back to the buyer.

The reclaimer is the platform doing that on the buyer's behalf, on a slow cadence because the deadline it enforces is a whole day long. It finds those orders, tells the escrow to return the money, and once the chain confirms, records the order as settled on-chain.

It writes nothing to the ledger, and that is the part most likely to be got wrong. The buyer's money does not come back to their platform balance; it lands on-chain under their own address as a claim they can withdraw. Crediting the ledger as well would hand the buyer the same money twice — once as spendable balance and once as an on-chain claim — and the platform's solvency rests on that never happening. For the same reason the order must stop counting as escrowed at the moment it starts counting as settled funds, and never appear in both.

An order whose escrow deal was never confirmed in the first place is not this job's business. There is no deal to reclaim, and guessing at one is how a single purchase ends up with two deals escrowing two prices.

**Why this priority**: It is the buyer's guarantee that a silent platform cannot keep their money, and it is what closes out the non-delivery path. It ranks below the first two only because its deadline is a day away, so nothing in a rehearsal depends on it firing.

**Independent Test**: Open a deal, let it pass its delivery deadline without ever delivering, and confirm that a reclaimer pass returns the money: the order records as settled, the buyer's escrowed figure falls by exactly the price, their on-chain settled funds rise by exactly the price, and no ledger entry was written.

**Acceptance Scenarios**:

1. **Given** an order whose escrow deal is still open and whose delivery deadline has passed, **When** the next reclaimer pass runs, **Then** the escrow is told to return the money to the buyer and, once confirmed, the order records as settled with the time it settled.
2. **Given** an order whose agent ran and produced nothing, and whose delivery deadline has passed, **When** the reclaimer runs, **Then** it is reclaimed on the same terms as one that never ran — the contract does not distinguish them and neither does this job.
3. **Given** an order whose escrow deal was never confirmed, **When** the reclaimer runs, **Then** it is skipped entirely and no chain call is made against it.
4. **Given** an order whose delivery deadline has not yet passed, **When** the reclaimer runs, **Then** it is left alone.
5. **Given** a reclaimed order, **When** the ledger is inspected, **Then** no entry was written for the reclaim.
6. **Given** a reclaimed order, **When** the buyer's figures are read, **Then** the price has left their escrowed total and appears in their on-chain settled funds — in exactly one of the two, never both and never neither.
7. **Given** a reclaimed order, **When** the following pass runs, **Then** it is not selected again.
8. **Given** a deal somebody else already reclaimed permissionlessly, **When** the reclaimer reaches it, **Then** the order still records as settled and the job does not retry it forever.
9. **Given** a chain that refuses the reclaim as too early, **When** the pass handles that refusal, **Then** the order is left untouched and the next pass tries again.

---

### User Story 4 - The timers are safe to leave running unattended (Priority: P2)

These three jobs run for as long as the backend does, without anybody starting them, and they touch money on every pass. What makes them safe to leave alone is not that they always succeed — the chain will be unreachable sometimes, a transaction will be refused sometimes — but that failing is uneventful.

A refused or unanswered chain call means the pass logs it and gives up on that order until the next tick. It never crashes the scheduler, never takes the other two jobs down with it, and never brings the process down. A pass that runs long never has a second copy of itself started underneath it. A pass that acted says what it acted on, one line per order, so a rehearsal log reads as a narrative of what the platform did. A pass that found nothing says nothing at all, because a job that narrates every empty second buries the three lines that mattered.

And every pass is idempotent by construction. Running the same pass twice over the same order does the same thing the once did, because each job decides what is true by reading the chain's own view of the deal rather than by trusting that its last attempt landed. That is what makes an interrupted pass, a duplicated pass, and a restart mid-flight all recover to the same place.

**Why this priority**: It is the difference between three timers and three ways to wedge the platform overnight. Every acceptance criterion in the stories above assumes it.

**Independent Test**: Point the backend at an unreachable chain and leave it running through many cadences of all three jobs. Confirm the process stays up, the jobs keep ticking, errors are logged rather than thrown away, and that once the chain returns the backlog clears on the following passes with no restart and no manual step.

**Acceptance Scenarios**:

1. **Given** an unreachable chain, **When** many passes of all three jobs run, **Then** the process stays up, each failure is recorded at error level naming the order, and the timers keep firing.
2. **Given** a chain that has come back after an outage, **When** the next passes run, **Then** every order that had been due is handled, with no restart and no manual intervention.
3. **Given** a pass that is still running when its next tick is due, **When** the tick fires, **Then** a second overlapping pass of that job does not start.
4. **Given** one job failing repeatedly, **When** the other two run, **Then** they are unaffected.
5. **Given** a period in which nothing is due, **When** the logs are read, **Then** the jobs produced no output beyond whatever they log once at startup.
6. **Given** a pass that acted on orders, **When** the logs are read, **Then** each order it acted on is named along with what happened to it.
7. **Given** a shutdown signal, **When** the process stops, **Then** the timers stop with it and the process actually exits rather than hanging.
8. **Given** an in-flight pass at shutdown, **When** the process stops, **Then** it does not claim new work on the way down, and anything it had already claimed is left in a state a later pass can pick up.
9. **Given** a chain call whose outcome is unknown — sent, with no confirmation received — **When** the pass handles it, **Then** the order's state is left exactly as it was and the situation is recorded at error level, because a state written on a guess about the chain is worse than a state written a minute late.

---

### Edge Cases

- **The platform's clock and the chain's clock disagree by a few seconds.** Both deadlines are evaluated by the platform against its own database timestamps and by the contract against block time, and block timestamps carry a few seconds of validator latitude. A job will therefore sometimes ask a second too early and be refused. That is an expected outcome, not an error: the order is untouched and the next pass gets it. It also means a review window shorter than about half a minute makes the disagreement visible on stage.
- **A buyer accepts an order in the same instant the sweeper releases it.** Both routes end with the seller paid, so the outcome is the same; what must not happen is the order being written twice or ending in a state the chain does not share.
- **A buyer complains in the last second of the window.** The complaint and the release are racing for the same deal and the contract admits only one. Whichever it took is the truth, and the sweeper's refusal is how it learns which.
- **Someone else already sent the transaction.** Release and reclaim are permissionless. A deal that is already settled when a job reaches it is a success that the job did not perform, and it must record it as such rather than retrying.
- **An order in running that has a real output.** Its delivery announcement was lost. The reaper marks it failed because the chain never learned of the delivery, and leaves the output for an auditor.
- **An order still awaiting confirmation of its escrow deal.** It has no deal id, so neither the sweeper nor the reclaimer can act on it, and the reaper does not cover it. It is visible rather than silent — see the last requirement group — and its resolution is by hand.
- **A dispute Guardian could not rule on.** No job here moves it. It is left to the escrow's own dispute deadline, which is deliberately slow and permissionless.
- **A backlog of orders all due at once**, which is what a rehearsal that runs three acts back to back produces. A pass handles what is due rather than one item per tick.
- **A run whose agent legitimately takes almost its whole time limit.** The reaper's grace margin exists so that run is never killed while it is still working.

## Requirements *(mandatory)*

### Functional Requirements

**The scheduler**

- **FR-001**: System MUST run three recurring background jobs — a sweeper, a reclaimer, and a reaper — for as long as the backend is running, started automatically at boot with no request, no operator action, and no external trigger.
- **FR-002**: The sweeper's cadence MUST be configurable per deployment, so a rehearsal can show an auto-release within seconds while a real deployment runs it on the order of a minute. The reclaimer MUST run on the order of every five minutes and the reaper on the order of every minute.
- **FR-003**: System MUST NOT begin a new pass of a job while that job's previous pass is still running.
- **FR-004**: System MUST contain any failure inside a pass: it is recorded, the pass is abandoned, the timers keep firing, the other two jobs are unaffected, and the process never exits because of it.
- **FR-005**: System MUST stop the timers on shutdown so the process exits, and MUST NOT claim new work once shutdown has begun.
- **FR-006**: A pass that acted MUST record one line per order naming the order and what happened to it. A pass that found nothing to do MUST produce no output.
- **FR-007**: Every job MUST be idempotent over an order: a second pass across the same data MUST make no further change and MUST NOT repeat a chain call whose effect already holds.
- **FR-008**: Every job MUST select and advance an order in a way that two overlapping attempts cannot both act on it.
- **FR-009**: No job may move an order whose money has already left escrow — one that is released or settled — nor move any order backwards through its lifecycle.

**The sweeper**

- **FR-010**: System MUST find orders that are delivered and whose review window, measured from the moment of delivery, has elapsed.
- **FR-011**: System MUST ask the escrow to pay the seller for each such order, and MUST move the order to released only after the chain has confirmed that payout — never before it and never on the strength of having sent the request.
- **FR-012**: System MUST NOT write any ledger entry when an order is released. The payout is on-chain under the seller's own address and the platform cannot recapture it.
- **FR-013**: System MUST treat a payout refused as premature as an ordinary "not yet": the order is left untouched, nothing is logged at error level, and the next pass retries.
- **FR-014**: System MUST resolve any other refusal by reading the deal's actual state from the chain rather than by interpreting the refusal, and MUST bring the order into line with what the chain says — including recording as released a deal that somebody else released permissionlessly, and leaving alone a deal that the chain reports as disputed.
- **FR-015**: System MUST handle every order that is due in a single pass rather than one per tick.
- **FR-016**: System MUST NOT select an order that is in any state other than delivered.

**The reaper**

- **FR-017**: System MUST find orders that are running and have been for longer than the pinned agent version's declared time limit plus a grace margin, and MUST move them to failed.
- **FR-018**: System MUST NOT tell the escrow anything about an order it reaps — no delivery announcement, no payout — because nothing was delivered.
- **FR-019**: System MUST record an ending on the reaped order's run record — a finish time and the reason it was abandoned — and MUST NOT overwrite, blank, or delete anything already written there, including an output that a lost delivery announcement left behind.
- **FR-020**: System MUST NOT re-run a reaped order's agent and MUST NOT create a second run record for it.
- **FR-021**: System MUST leave a reaped order complainable on exactly the same terms as any other failed order.
- **FR-022**: System MUST NOT move an order that left running between selection and write.
- **FR-023**: System MUST NOT act on a disputed order, including one whose audit has repeatedly failed.

**The reclaimer**

- **FR-024**: System MUST find orders whose escrow deal is still open — nothing was ever delivered against it — and whose delivery deadline has passed, covering both an order that never ran and an order whose agent produced nothing.
- **FR-025**: System MUST skip any order that has no confirmed escrow deal, and MUST NOT open, retry, or guess at a deal for one.
- **FR-026**: System MUST ask the escrow to return the full amount to the buyer, and MUST record the order as settled on-chain, with the time it settled, only after the chain has confirmed.
- **FR-027**: System MUST NOT write any ledger entry when an order is reclaimed. The money returns as an on-chain claim under the buyer's own address, and crediting the balance as well would give the buyer the same money twice.
- **FR-028**: A reclaimed order MUST stop being counted in the buyer's escrowed total at the same moment its money begins being counted in their on-chain settled funds, appearing in exactly one of the two at any time.
- **FR-029**: System MUST treat a reclaim refused as premature as an ordinary "not yet", and MUST resolve any other refusal by reading the deal's state from the chain — including recording as settled a deal somebody else reclaimed permissionlessly.

**Purchases still awaiting confirmation**

- **FR-030**: System MUST make an order that is still awaiting confirmation of its escrow deal past a grace period visible rather than silent: it is reported at error level, naming the order and the buyer, so it can be reconciled by hand. System MUST NOT change such an order's state, MUST NOT compensate its ledger debit, and MUST NOT make any chain call against it — the deal may yet confirm, and opening a second one would escrow two prices against one purchase.

### Key Entities

- **Order**: The unit every job acts on. What matters here is its state — which is also the work queue — the moment it was delivered, the review window it was sold with, the moment it was created, whether its escrow deal is confirmed, and the time it settled.
- **Run record**: The evidence of an execution attempt. The reaper writes an ending onto one and never anything else.
- **Escrow deal**: The chain's view of the same order's money — open, delivered, disputed, or settled. It is the authority every job reconciles against when its own view and the chain's disagree.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A delivered order that nobody touches becomes released with no request made and no key pressed, within one sweeper cadence of its review window closing, on every rehearsal.
- **SC-002**: When that happens, the seller's on-chain settled funds rise by exactly the order's price, the buyer's escrowed total falls by exactly the same amount, and the platform's ledger is unchanged.
- **SC-003**: Killing the backend during a run and restarting it leaves that order in failed within one reaper cadence plus the grace margin, and leaves no order in running with no worker, in ten consecutive attempts.
- **SC-004**: Running any job twice over the same set of due orders produces exactly the same end state as running it once — no duplicate payouts, no repeated state changes, no second run record.
- **SC-005**: With the chain unreachable for thirty minutes, the backend stays up, all three jobs keep ticking, and every failure is attributable to a named order in the log; when the chain returns, the entire backlog clears within a small number of passes with no restart.
- **SC-006**: An order that was never delivered against has its money returned within one reclaimer cadence of its delivery deadline, and at every moment before and after, the price appears in exactly one of the buyer's escrowed total and their settled funds.
- **SC-007**: Across ten minutes in which nothing is due, the three jobs write nothing to the log.
- **SC-008**: In a rehearsal with the demo cadence configured, the gap between the review window closing and the release being visible on screen is short enough to hold an audience's attention without narration — a handful of seconds, not a wait.
- **SC-009**: An order whose escrow deal never confirmed is discoverable from the log alone, without querying the database, within one pass of its grace period expiring.
- **SC-010**: Every one of the three acts of the demo can be run end to end more than once in a session without a job leaving an order in a state a human has to correct.

## Assumptions

- **One backend process runs these jobs.** There is no distributed locking and no leader election, because there is one process. The guard against overlap is within the process. If a second instance were ever run, the permissionless nature of both chain calls means the worst case is a wasted transaction rather than a double payout — but it is not designed for and is out of scope.
- **A reclaimed order rests in the state that means settled on-chain, not in failed.** This is forced rather than chosen: the escrowed-money figure a buyer sees sums over a set of states that includes failed, precisely because a failed order's money genuinely is still locked. An order whose money has been returned must leave that set at the moment it enters the on-chain settled funds figure, or the buyer sees the same cents in two places. The state that means "the chain has paid this out" is the only one that satisfies both. The non-delivery itself remains legible from the run record, which is where the evidence lives anyway.
- **The reclaimer covers failed orders as well as never-started ones.** The contract cannot tell them apart — both are open deals past their deadline — and the escrowed-money figure already documents "the money sits in escrow until the reclaimer sweeps it" for a run that produced nothing. Covering only never-started orders would strand the money of every buyer whose agent failed.
- **The reaper's grace margin is a fixed additional allowance beyond the pinned version's declared time limit**, long enough that a run using its full budget is never reaped mid-flight and short enough that a wedged order is not invisible for long. A minute is the working default.
- **The deadlines belong to the contract, not to this feature.** The delivery deadline is twenty-four hours from the deal opening and the dispute deadline is seventy-two hours; both are constants of the deployed escrow. The jobs schedule around them and never define them.
- **The review window is the one snapshotted on the order at purchase**, not the seller's current setting, for the same reason the price is snapshotted.
- **Deadline comparisons are made against the platform's own timestamps** — delivery time for the sweeper, creation time for the reclaimer — while the contract judges the same deadlines against block time. The two are close but not identical, and the "too early" path is the designed response to the difference rather than a defect to engineer away.
- **The chain is reachable most of the time and transactions confirm in around a second.** Nothing here retries with backoff, queues work, or persists a retry count; the next tick is the retry.
- **No automated tests.** This component's acceptance is verified by hand, per the component's standing decision, which makes the rehearsal the test suite.
- **The database index that makes the sweeper's query cheap already exists**, as does the one over undelivered orders that the reclaimer uses.
- **Nothing in this feature reads or writes a seller's private instructions**, so the serialisation boundary that protects them is untouched.
