# Feature Specification: Orders & the Purchase Saga

**Feature Branch**: `007-orders-purchase-saga`

**Created**: 2026-08-09

**Status**: Draft

**Input**: User description: "docs/specs/API-07-orders-purchase-saga.md — Purchase through to acceptance or complaint, with a failure branch that never leaves a buyer out of pocket. The purchase as an explicit saga: validate, one atomic money-and-order write, the escrow call, a compensating branch when the chain refuses, and an immediate answer while the work is dispatched behind it. Plus the buyer's orders, the seller's sales, early acceptance, complaining inside the window, and the two order reads a seller must also be able to open."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A buyer purchases an agent and the money is locked in escrow (Priority: P1)

A signed-in buyer picks an agent from the catalogue, supplies the input it asked for, and writes down what "done right" means for this particular job. The platform checks that the agent is on sale, that the input is the shape the agent declared it needs, that the buyer actually said what they wanted, and that they have the money. It then does two things at once and inseparably: it records the order and it takes the price out of the buyer's spendable balance. Only then does it ask the escrow contract to lock the same amount, and only once the contract has confirmed and handed back a deal identifier does the order carry one. The buyer gets an answer immediately after that — the work itself starts behind the response.

The order does not point at the agent. It points at the exact definition that was on sale at the moment of purchase, and it carries its own copy of the price and the review window. A seller who republishes their agent five minutes later has changed nothing about what this buyer bought, what will run, or what a later verdict will be measured against.

The order of the two writes is the whole design. The database moves first because a database mistake is one compensating row, while an escrow deal opened against an order that was never recorded is money locked with no record of whose it is — recoverable only by hand. This ordering is specific to purchases, which *reduce* what the platform owes; it is not a rule to carry to a flow that increases a balance.

**Why this priority**: Nothing else in this feature exists without a purchase. It is also the flow where money, the chain, and asynchronous work meet in a single request, which makes it the place a defect is most expensive and least visible.

**Independent Test**: With a funded buyer and a listed agent, place an order. Confirm the buyer's spendable balance drops by exactly the price, that the escrow contract holds the corresponding amount for a deal whose identifier is recorded on the order, and that the response arrives without waiting for the agent to finish its work.

**Acceptance Scenarios**:

1. **Given** a signed-in buyer with sufficient balance and an agent that is on sale, **When** they order it with valid input and non-empty acceptance criteria, **Then** an order is recorded against the agent's current definition, the price is debited from the buyer's balance, the escrow contract locks the price, the deal identifier the contract assigned is stored on the order, and the buyer is answered with the created order.
2. **Given** a successful purchase, **When** the recorded order is inspected, **Then** it carries its own copy of the price and the review window taken at purchase time, and it identifies the exact agent definition that was current when it was placed — not the agent.
3. **Given** a successful purchase, **When** the buyer's spendable balance is recomputed, **Then** it has decreased by exactly the price, recorded as a single purchase-kind entry linked to that order.
4. **Given** an order is being placed, **When** the record of the order and the debit against the balance are examined, **Then** they were written together — there is no point in time at which one exists without the other.
5. **Given** a buyer whose balance is less than the price, **When** they attempt to order, **Then** the request is refused, no order is recorded, no money moves, and no escrow deal is opened.
6. **Given** a buyer with exactly enough balance for one purchase, **When** two purchases of that price are attempted at the same moment, **Then** exactly one succeeds and the other is refused for insufficient funds — the balance never goes negative.
7. **Given** input that does not satisfy the shape the agent declared it needs, **When** the order is attempted, **Then** it is refused with a reason identifying the mismatch, and nothing is recorded.
8. **Given** empty or whitespace-only acceptance criteria, **When** the order is attempted, **Then** it is refused — a buyer who never said what they wanted cannot be given a dispute they could win on.
9. **Given** an agent that is unavailable, or that carries no escrow-contract identifier, **When** it is ordered, **Then** the request is refused and no money moves.
10. **Given** acceptance criteria that ask for something the listing never promised, **When** the order is placed, **Then** it succeeds — the mismatch is judged later, at dispute time, not blocked here.
11. **Given** a purchase request from a caller with no valid session, **When** it is submitted, **Then** it is refused as unauthenticated.
12. **Given** the platform's configured review window is zero or absent, **When** the platform starts or a purchase is attempted, **Then** it refuses rather than opening a deal — a zero window silently destroys the buyer's right to complain and auto-releases the money instantly.
13. **Given** a successful purchase, **When** the response is returned, **Then** it arrives without waiting for the agent's work to complete, and the order has moved into the state that hands it to execution.

---

### User Story 2 - A chain failure leaves the buyer's balance whole (Priority: P1)

The escrow call is the step most likely to fail: a node is unreachable, gas is refused, the transaction never confirms. When it does fail, the platform does not leave the buyer paid-for-nothing. The order is marked as failed to open, and a compensating entry puts the exact amount back into the buyer's spendable balance, linked to the same order so the history shows what happened rather than hiding it.

This branch is the reason the database goes first. Because nothing was ever escrowed, restoring the ledger restores the buyer completely — there is no on-chain money to chase and nothing stranded. That is not true of the refund a verdict produces, which settles on-chain under the buyer's own address and never returns to spendable balance; the two must not be confused.

A failed purchase must also stop counting as money in escrow. It is not locked anywhere, and showing it as locked would tell the buyer their money is somewhere it is not.

**Why this priority**: This is the branch the acceptance criteria name explicitly and the one that cannot be tested by using the product normally — it has to be forced. It is also the difference between a demo failure that is embarrassing and one that takes a buyer's money.

**Independent Test**: Force the escrow call to fail, place an order, and confirm the buyer's spendable balance afterwards is identical to what it was before, that the order is visibly failed, and that the money is not reported as being in escrow.

**Acceptance Scenarios**:

1. **Given** an escrow call that is known to have failed, **When** a purchase is attempted, **Then** the order is marked as failed to open, a compensating entry of exactly the price is credited back to the buyer, and the entry is linked to the same order.
2. **Given** a purchase whose escrow call failed, **When** the buyer's spendable balance is recomputed, **Then** it equals the balance before the purchase, to the unit.
3. **Given** a purchase whose escrow call failed, **When** the buyer's money-in-escrow figure is computed, **Then** that order contributes nothing to it.
4. **Given** a purchase whose escrow call failed, **When** the buyer is answered, **Then** they are told the purchase did not complete, and are not handed an order that looks live.
5. **Given** a purchase whose escrow call failed, **When** the ledger is read as a statement, **Then** both the original debit and the compensating credit appear — the history is corrected, never rewritten or deleted.
6. **Given** an order that failed to open, **When** any later action is attempted against it — accepting, complaining, or execution picking it up — **Then** it is refused, because there is no escrowed money to settle.
7. **Given** the escrow call succeeds but recording its deal identifier fails, **When** the situation is examined, **Then** it is recorded at error level with the transaction reference so it can be reconciled by hand, and the order is not presented as a completed purchase.
8. **Given** an escrow call whose outcome is unknown — sent, but with no confirmation received — **When** the purchase is answered, **Then** the buyer is told it did not complete, **and** nothing is compensated: the debit stands and the order stays as placed, because the money may genuinely be escrowed and crediting it back while it is would leave the platform owing more than it holds.
9. **Given** an order whose escrow call outcome is unknown, **When** the buyer's money-in-escrow figure is computed, **Then** that order still contributes to it — that is where the money most likely is, and it must appear somewhere.

---

### User Story 3 - The buyer settles: accept early, or complain inside the window (Priority: P2)

When the work has been delivered, the buyer has a window. They can end it early by accepting, which releases the whole escrowed amount to the seller. Or they can complain, stating what is wrong, which freezes the escrow and hands the case to the auditor. Both are the buyer's alone: the seller is told a complaint was filed, but has no right of reply — that is a deliberate product decision, not an omission.

A buyer whose agent produced nothing at all can complain too. That case is the strongest a buyer can have and it must reach a verdict rather than a timeout, so the complaint records the concluded delivery attempt and opens the dispute together, as one action — the escrow will not accept a dispute against a deal it was never told had concluded.

The complaint window closes exactly when the review window closes. One second later and complaining must fail, because the escrow contract itself will refuse it and the money is on its way to the seller. A buyer who has already complained cannot complain again, and cannot amend — one complaint per order, enforced where it cannot be forgotten.

Neither settlement writes anything to the ledger. Settled money lands on-chain under the parties' own addresses, where the platform cannot recapture it; that is the property that lets either side exit without us, and inventing a ledger entry for it would be a lie about where the money is.

**Why this priority**: This is what turns a purchase into a completed trade and what opens the dispute path the whole product exists for. It sits below the purchase because there is nothing to accept or complain about until a purchase works.

**Independent Test**: Take a delivered order, accept it, and confirm the escrow settles to the seller and the order reflects it. On a second delivered order, complain, and confirm the complaint is recorded, the escrow contract is put into dispute, and the order moves into the state the auditor picks up. On an order that failed in execution, complain, and confirm the escrow reaches dispute rather than refusing. Then wait past the window on a fourth and confirm complaining is refused.

**Acceptance Scenarios**:

1. **Given** a delivered order, **When** its buyer accepts, **Then** the escrow contract is told to settle the full amount to the seller, the order moves to its released state, and no ledger entry is written.
2. **Given** a delivered order, **When** its buyer complains with a stated reason, **Then** a complaint is recorded against the order, the escrow contract is put into dispute, the order moves to its disputed state with the time recorded, and the work is handed to the audit stage.
3. **Given** a delivered order past the end of its review window, **When** its buyer complains, **Then** the complaint is refused and no complaint is recorded.
4. **Given** an order with a complaint already recorded, **When** its buyer complains again with a different reason, **Then** the second attempt is refused and the first complaint is unchanged.
5. **Given** an order, **When** anyone other than its buyer attempts to accept or complain — including the seller who owns the agent — **Then** it is refused as not permitted.
6. **Given** a complaint with an empty reason, **When** it is submitted, **Then** it is refused.
7. **Given** an order that is not in a state that can be settled — still working, already released, already disputed, already settled — **When** acceptance or a complaint is attempted, **Then** it is refused with a reason naming the current state.
8. **Given** a complaint whose escrow call fails, **When** the buyer is answered, **Then** they are told the complaint did not go through, and the order is not left showing as disputed while the escrow still believes it is deliverable.
9. **Given** an order whose agent produced nothing at all, **When** its buyer complains, **Then** the complaint is accepted and reaches the auditor — non-delivery is the strongest case a buyer can have, not an unreachable one.
10. **Given** an order that failed in execution, whose escrow deal was therefore never marked as delivered, **When** its buyer complains, **Then** the platform records the delivery attempt as concluded on-chain and opens the dispute in the same action, so the escrow ends in dispute and the auditor rules on it — rather than the buyer's only recourse being a timeout with no verdict.
11. **Given** a complaint against a failed order, **When** the two escrow calls are examined, **Then** they happen together as one action, leaving no interval in which the deal sits deliverable and could be released to a seller who delivered nothing.

---

### User Story 4 - Both sides can follow an order, and the case file is redacted for the buyer (Priority: P2)

An order can be opened by the buyer who placed it **or** by the seller who owns the agent that ran it. The same is true of the case file — the assembled evidence: what the buyer asked for, what they said "done right" meant, what the listing promised and excluded, what the agent actually did, what it returned, and how long it took.

The two parties do not see the same case file. The seller's copy is complete, because the agent's private instructions are theirs. The buyer's copy has them removed — otherwise filing a complaint becomes a free way to steal a seller's work, and a frivolous complaint becomes an extraction tool. Removing the one field is not enough, either: an agent narrating its own reasoning can quote its instructions in passing, so reasoning text in the buyer's copy is summarised rather than passed through, while what it did, when, and what went wrong is shown in full.

Authorising these two reads on the buyer alone is the natural thing to write and it silently deletes half the seller experience. A seller told that a dispute has been filed against them, who then cannot open the order or read the evidence, has been notified of an accusation they are not allowed to see.

**Why this priority**: The seller side of these two reads is called out as a specific acceptance criterion because it is the thing most likely to be missed, and the redaction rule is what keeps a dispute from being an attack on the seller. Both matter to the demo's dispute act.

**Independent Test**: Place an order as a buyer against an agent owned by a different account. Open the order and the case file as the buyer, then as the seller, and confirm both succeed. Set the agent's private instructions to an unmistakable marker, then search the buyer's copy of both responses for it and confirm it appears nowhere, while the seller's copy carries it.

**Acceptance Scenarios**:

1. **Given** an order, **When** its buyer opens it, **Then** they get its state, its timings, the input they gave, their acceptance criteria, the listing it was bought from, and the output if there is one.
2. **Given** an order placed against an agent they own, **When** the seller opens it, **Then** the request succeeds — verified while signed in as the seller's account, not the buyer's.
3. **Given** an order, **When** an account that is neither its buyer nor the agent's owner opens it, **Then** the request is refused without revealing whether the order exists.
4. **Given** an order, **When** its case file is requested by the seller who owns the agent, **Then** it is complete, including the agent's private instructions and the agent's reasoning as recorded.
5. **Given** the same order, **When** its case file is requested by the buyer, **Then** the private instructions are absent and the agent's reasoning appears summarised, while the actions taken, the timings, and any errors appear in full.
6. **Given** an agent whose private instructions are set to an unmistakable marker string, **When** the buyer's copy of the order and of the case file are searched, **Then** the marker appears in neither, under any input.
7. **Given** an order whose agent has since been given a newer definition, **When** its case file is assembled, **Then** the promise and exclusions it carries are those of the definition the order was placed against, never the current one.
8. **Given** an order whose agent produced no output, **When** the case file is requested, **Then** the output is present and empty rather than the request failing — the absence is the evidence.
9. **Given** an order whose work has not finished, **When** the case file is requested, **Then** it returns what exists so far, with the parts not yet produced absent rather than fabricated.
10. **Given** an order identifier that does not exist or is malformed, **When** either read is requested, **Then** the answer is a clean not-found or invalid-input result rather than an error.

---

### User Story 5 - Each side sees their own trades (Priority: P3)

A buyer asks for their orders and gets every order they placed, whatever state it reached, newest first. A seller asks for their sales and gets every order placed against any agent they own. Neither list shows anything belonging to anyone else, and the seller's list never shows a buyer's private business beyond the order that concerns them.

The seller's list is reached through the agent, because an order does not name a seller — it names a definition, and the definition names an agent, and the agent names its owner. Which also means a seller's list must keep showing sales of agents they have since taken down.

**Why this priority**: Both lists are the entry point to every other screen in this feature, but each is a straightforward read over data the earlier stories already produce.

**Independent Test**: With two accounts, place orders from one against agents owned by the other. Confirm the buyer's list shows exactly their orders and the seller's list shows exactly the same trades from the other side, and that neither account can see the other's list.

**Acceptance Scenarios**:

1. **Given** a signed-in buyer with orders, **When** they request their orders, **Then** every order they placed is returned regardless of state, newest first, each carrying enough to identify the agent, the price, the state, and the timings.
2. **Given** a signed-in seller, **When** they request their sales, **Then** every order placed against any agent they own is returned, and no order against anyone else's agent is.
3. **Given** an account with no orders, **When** it requests its orders or its sales, **Then** an empty list is returned rather than an error.
4. **Given** either list requested without a session, **When** it is submitted, **Then** it is refused as unauthenticated.
5. **Given** a seller who has taken an agent down, **When** they request their sales, **Then** orders placed against that agent while it was on sale still appear.
6. **Given** a buyer's list, **When** it is inspected, **Then** it contains no part of any seller's private instructions.

---

### Edge Cases

- **Two purchases racing the same balance.** The check that the buyer can afford it and the debit that spends it must be one indivisible operation. Any gap between them is a window in which the same money is spent twice, and it will not show up under manual testing — it needs two requests in flight at once.
- **The escrow call succeeds but the response is lost.** The platform believes the deal failed and compensates the buyer, while the contract holds real escrowed money against nobody. Recorded at error level with whatever transaction reference exists; recovering it is a manual reconciliation, not an automatic retry, because a retry would open a second deal.
- **The compensating entry itself fails to write.** The buyer is genuinely out of pocket. This is the worst outcome in the feature and must be loud — error level, the order identifier, the amount, the buyer — so it is fixed by hand within minutes rather than discovered by the buyer.
- **A complaint filed in the same instant the review window closes.** The platform's own check and the escrow contract's check must agree on the boundary, and the contract's answer is final. Complaining at exactly the closing instant is refused; the platform must not report success on a complaint the contract rejected.
- **A complaint racing the automatic release.** The background release and a buyer's complaint can be in flight at once. Only one can win, and the contract decides — the platform's job is to report the actual outcome rather than the one it hoped for.
- **A seller who republishes their agent between the buyer opening the page and pressing buy.** The order pins whichever definition was current when it was recorded, and the price and window it carries are copies. What the buyer is charged and what is judged later always come from the same pinned definition.
- **A seller who takes their agent down while an order against it is running.** Nothing changes for that order. Availability governs new purchases only.
- **An order that failed in execution and is never complained about.** Nothing in this feature settles it, because every settlement here is a buyer action. It is left for the background reclaim job, which is out of scope — worth naming so it is not mistaken for a gap this feature should close.
- **A complaint against a failed order whose second escrow call fails after the first succeeded.** The deal is left recorded as concluded but not disputed, which is the one state a crashed order should not sit in for long, since it can be released to the seller. The buyer is told the complaint did not go through, the order is not moved to disputed, and the situation is recorded at error level so it is retried by hand or by a further complaint rather than left quiet.
- **An order placed against an agent whose owner is the buyer.** Allowed. Nothing in the flow needs the two parties to differ, and forbidding it would complicate seeding and rehearsal for no product reason. Both reads simply authorise the same account twice.
- **A case file requested for an order in every state it can reach.** Every state must answer. The contents vary with what exists; the request never fails because the order is early.
- **Money already spent cannot be un-spent by a verdict.** A refund from a dispute settles on-chain under the buyer's own address and never returns to their spendable balance. Only the compensating entry for a failed escrow call restores spendable balance, because in that case nothing was ever locked.

## Requirements *(mandatory)*

### Functional Requirements

**Validating a purchase**

- **FR-001**: System MUST accept a purchase from a signed-in caller naming an agent, the input for it, and acceptance criteria, and MUST refuse a purchase from a caller with no session.
- **FR-002**: System MUST refuse a purchase against an agent that is unavailable or that carries no escrow-contract identifier.
- **FR-003**: System MUST validate the supplied input against the input shape declared by the agent's current definition and refuse the purchase, identifying the mismatch, when it does not conform.
- **FR-004**: System MUST require acceptance criteria that are present and not blank, and MUST NOT check them against the listing's promise — that comparison belongs to the audit, not to checkout.
- **FR-005**: System MUST refuse a purchase when the buyer's spendable balance is less than the price, before anything is recorded and before any escrow call is made.
- **FR-006**: System MUST take the buyer's identity from the authenticated session and never from the request body.

**The atomic write**

- **FR-007**: System MUST record the order and debit the price from the buyer's balance within a single indivisible operation, such that no observable state exists in which one has happened and the other has not.
- **FR-008**: System MUST perform the affordability check within that same indivisible operation, so that two purchases in flight at once cannot both spend the same balance, and a buyer's balance can never become negative.
- **FR-009**: System MUST record the debit as a single purchase-kind ledger entry, negative, linked to the order it paid for, and MUST NOT introduce any mutable balance field.
- **FR-010**: System MUST record the new order pointing at the specific agent definition current at that moment, never at the agent, so that what runs and what is later judged are the same definition.
- **FR-011**: System MUST copy the price and the review window onto the order at purchase time, so that a later change to the listing or to configuration cannot alter what this purchase was for.
- **FR-012**: System MUST record the order in its purchased state with no escrow deal identifier, since the contract has not yet assigned one.

**The escrow call**

- **FR-013**: System MUST ask the escrow contract to open a deal for the order only after the order and the debit are durably recorded, and never before.
- **FR-014**: System MUST supply the review window from platform configuration and never from the request, and MUST refuse to operate with a zero or absent review window rather than opening a deal with one.
- **FR-015**: System MUST store the deal identifier the contract assigns onto the order once the transaction confirms.
- **FR-016**: System MUST record at error level, with the transaction reference, any case where the contract confirms but the identifier cannot be stored, and MUST NOT present such a purchase as complete.

**The failure branch**

- **FR-017**: System MUST, when the escrow call is **known** to have failed, move the order to its failed state and write a compensating adjustment-kind ledger entry crediting exactly the debited amount back to the buyer, linked to the same order.
- **FR-017a**: System MUST NOT compensate when the escrow call's outcome is **unknown** — sent, with no confirmation received. It MUST leave the order and the debit exactly as placed, distinguishable as a purchase still awaiting confirmation, and MUST record the attempt at error level with its transaction reference. Crediting the money back while it may in fact be escrowed would leave the platform owing more than it holds, which is the one error in this feature that no later entry can correct.
- **FR-018**: System MUST leave the buyer's spendable balance identical to its pre-purchase value after an escrow call known to have failed, to the unit.
- **FR-019**: System MUST NOT alter or remove the original debit when compensating — the ledger is append-only and the correction is a further entry.
- **FR-020**: System MUST exclude an order that failed to open from the buyer's money-in-escrow figure.
- **FR-021**: System MUST tell the caller the purchase did not complete when the escrow call fails **or** when its outcome is unknown, rather than returning an order that appears live. The two are reported the same way to the caller and handled differently inside — the caller cannot act on the difference, and the platform must.
- **FR-022**: System MUST record at error level, naming the order, the amount, and the buyer, any failure to write the compensating entry.

**Answering and handing off**

- **FR-023**: System MUST answer a successful purchase without waiting for the agent's work to complete, and MUST hand the order to the execution stage after answering rather than as a condition of answering.
- **FR-024**: System MUST use the order's own state as the record of what stage it has reached, with no separate queue or broker.

**Accepting**

- **FR-025**: System MUST let the buyer of a delivered order accept it, telling the escrow contract to settle the full amount to the seller and moving the order to its released state.
- **FR-026**: System MUST refuse acceptance from any caller who is not the order's buyer, including the seller who owns the agent.
- **FR-027**: System MUST refuse acceptance for an order that is not in a state from which it can be settled, naming the current state.
- **FR-028**: System MUST NOT write any ledger entry on settlement, because settled funds land on-chain under the parties' own addresses and have no database representation by design.

**Complaining**

- **FR-029**: System MUST let the buyer of an order that has been delivered, or that failed in execution, complain with a stated reason — recording the complaint, telling the escrow contract to open a dispute, moving the order to its disputed state, recording the time, and handing the order to the audit stage.
- **FR-030**: System MUST refuse a complaint once the review window has elapsed, at the same instant the escrow contract does, and MUST NOT report success for a complaint the contract rejected.
- **FR-031**: System MUST allow at most one complaint per order, enforced in storage rather than by a check that can be bypassed, and MUST refuse amendments and re-filings.
- **FR-032**: System MUST refuse a complaint with a blank reason, and MUST refuse a complaint from any caller who is not the order's buyer.
- **FR-033**: System MUST NOT leave an order showing as disputed when the escrow call to open the dispute failed.
- **FR-034**: System MUST accept a complaint against an order that failed in execution, recording the delivery attempt as concluded on-chain and opening the dispute as one action, so that non-delivery is judged by the auditor rather than resolved by a timeout.
- **FR-035**: System MUST NOT record a delivery attempt as concluded on-chain except as part of opening a dispute against a failed order, so that no order whose agent delivered nothing is left in a state from which the escrow could be released to the seller.
- **FR-036**: System MUST give the seller no ability to accept, complain, or respond — notification without right of reply is the product decision here.

**Reading an order and its case file**

- **FR-037**: System MUST authorise the order read and the case-file read on the order's buyer **or** the owner of the agent the order was placed against, resolving the seller through the pinned definition rather than through any field on the order.
- **FR-038**: System MUST refuse both reads to any other account without revealing whether the order exists.
- **FR-039**: System MUST return, on the order read, the order's state, its timings, the buyer's input, the acceptance criteria, the listing it was bought from, and the output when one exists.
- **FR-040**: System MUST assemble the case file from the buyer's input, the acceptance criteria, the promise and exclusions of the pinned definition, what the agent did, what it returned, any errors, and the timings.
- **FR-041**: System MUST resolve the listing promise and exclusions in a case file from the definition the order pinned, never from the agent's current definition.
- **FR-042**: System MUST answer a case-file request for an order in any state, returning what exists and omitting what does not, and MUST treat an absent output as content rather than as an error.

**The redaction boundary**

- **FR-043**: System MUST exclude the agent's private instructions from every buyer-facing response in this feature, and MUST include them in the seller's copy of the case file.
- **FR-044**: System MUST summarise, rather than pass through, the agent's recorded reasoning text in the buyer's copy, because reasoning can paraphrase or quote the private instructions it was given.
- **FR-045**: System MUST retain in the buyer's copy the actions taken, the timings, and any errors in full, so the evidence stays legible after redaction.
- **FR-046**: System MUST route every buyer-facing representation in this feature through the existing single serialisation choke point rather than by each response omitting the fields itself.

**The two lists**

- **FR-047**: System MUST return, to a signed-in caller, every order they placed as buyer, in any state, newest first.
- **FR-048**: System MUST return, to a signed-in caller, every order placed against any agent they own, including agents they have since made unavailable.
- **FR-049**: System MUST scope both lists to the calling account, refuse them without a session, and return an empty list rather than an error when there is nothing to show.

**Cross-cutting**

- **FR-050**: System MUST express every amount in this feature in the platform's single money unit, performing no conversion outside the chain-access boundary.
- **FR-051**: System MUST answer an unknown or malformed order identifier with a not-found or invalid-input result rather than an error.
- **FR-052**: System MUST match the published HTTP contract for every endpoint in this feature — path, method, auth rule, field names, and casing — since the frontend is built against that contract and any divergence is a defect there.

### Key Entities

- **Order**: One purchase. Points at the definition that was bought, never at the agent, and carries its own copies of the price and the review window so that nothing a seller does afterwards changes what was sold. Its state is also the work queue — there is no broker, and a background job catches whatever gets stuck.
- **The purchase saga**: The named sequence — validate, write the order and the debit as one, open the escrow deal, compensate if that fails, answer, hand off. It is a saga rather than a transaction because one of its steps is on a chain that cannot participate in a database transaction, and the compensating step is what stands in for rolling back.
- **Ledger entry**: An append-only, signed record of money moving in or out of a spendable balance. A purchase writes one negative entry; a failed escrow call writes one positive correction; a settlement writes none at all. Balance is the sum, never a stored field.
- **Complaint**: The buyer's stated reason for disputing, one per order, enforced in storage. It is the trigger for the audit and the input the auditor weighs the delivery against, together with the acceptance criteria.
- **Acceptance criteria**: What "done right" means for this order, written by the buyer before any work happens. Free text, required, never validated against the listing. It is half of the standard a later verdict is measured by, and its existence at purchase time is what makes that verdict defensible.
- **Case file**: The assembled evidence for one order — what was asked, what was promised, what was excluded, what happened, what came back. It exists in two shapes: complete for the seller, redacted for the buyer. Not two documents, one assembly with one boundary applied on the way out.
- **The review window**: The interval, opened by delivery, in which the buyer may accept or complain. It comes from configuration, is copied onto the order, and can never be zero — a zero window destroys the buyer's recourse and releases the money instantly, with no error raised anywhere.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A purchase completes end to end and the escrow contract holds exactly the price against a deal recorded on the order — verified on every rehearsal, with no purchase leaving an order whose deal identifier is missing.
- **SC-002**: A forced escrow failure leaves the buyer's spendable balance identical to its pre-purchase value, to the unit, on every attempt.
- **SC-003**: Two purchases issued simultaneously against a balance that covers only one result in exactly one order and one debit, with the balance never negative.
- **SC-004**: Complaining records the complaint, opens the dispute on-chain, and moves the order into the state the audit stage consumes — completed as a single buyer action with no manual step.
- **SC-005**: A seller signed in as their own account can open both the order and the case file for a sale they did not buy, across every order placed against their agents.
- **SC-006**: No buyer-facing response in this feature contains a seller's private instructions, verified by setting the instructions to a marker string and searching every buyer-facing response across every route, with zero matches.
- **SC-007**: The seller's copy of a case file contains the private instructions and the reasoning as recorded, while the buyer's copy of the same case file contains neither — both verified on the same order.
- **SC-008**: A complaint filed after the review window has elapsed is refused every time, and no order reaches a disputed state without a corresponding dispute on-chain.
- **SC-009**: An order's price, review window, promise, and exclusions are identical when read at purchase and after the seller has published a newer definition of the same agent.
- **SC-010**: A purchase returns to the caller before the agent's work finishes, on every purchase, with the work observably starting afterwards.
- **SC-011**: A failed purchase contributes nothing to the buyer's money-in-escrow figure, and the sum of that figure across all buyers equals the total the escrow contract reports as locked.
- **SC-012**: The three demo acts — an uncontested trade, a disputed trade, and a non-delivery — can each be driven from purchase to their settling action through a full rehearsal with no manual correction to any order or ledger.
- **SC-013**: An order whose agent produced nothing can be complained about and reaches the disputed state on-chain, every time — the non-delivery act ends in a verdict rather than a timeout.
- **SC-014**: Every endpoint in this feature matches the published HTTP contract exactly on path, method, auth rule, and field names, so a frontend built only from that contract works against it unchanged.

## Assumptions

- **All acceptance criteria here are verified by hand.** Automated tests of every kind are out of scope for this component — a time-boxed decision recorded in the component context. The demo rehearsal is the test suite.
- **Postgres before the chain applies here because a purchase reduces what the platform owes.** It is not a universal rule: the flow that increases a balance inverts it. What this spec fixes is the ordering for this flow and the existence of an explicit compensating branch.
- **Accepting moves the order to its released state**, the same state an automatic release produces, because the escrow contract makes no distinction between the two. The settled state is reserved for orders that reach settlement through a verdict.
- **Acceptance requires the order to be delivered.** The escrow contract permits it no earlier, so the platform refuses rather than sending a call that will be rejected.
- **A complaint is permitted from delivered *and* from failed**, because non-delivery is the strongest case a buyer has and the product's closing demonstration depends on it reaching a verdict. A failed order's deal was never marked delivered on-chain, and the escrow contract will not open a dispute against one that was not — so the complaint records the delivery attempt as concluded and opens the dispute together, as one action. Doing it here rather than at the moment of the crash is deliberate: marking a crashed deal as delivered up front would leave it releasable to a seller who delivered nothing for the whole review window, and release is permissionless. Confining it to the complaint keeps that window to the length of one action.
- **The compensating entry is a correction of a purchase that never happened, not a refund.** A refund from a verdict settles on-chain under the buyer's own address and does not return to spendable balance. Only this branch restores spendable balance, and only because nothing was ever locked.
- **A failed escrow call is not retried automatically.** A retry risks opening a second deal against the same order. Recovering a deal that was opened but not recorded is a manual reconciliation.
- **"Failed" and "unknown" are different, and only the first compensates.** A call that is known to have failed escrowed nothing, so restoring the balance restores the buyer completely. A call whose outcome is unknown was sent and may still confirm; compensating it would restore a balance whose money is simultaneously locked on-chain. The unknown case therefore leaves everything as placed and is resolved by the background job that reconciles purchases still awaiting confirmation — which is out of scope here, named so the resting state is not mistaken for a gap in this feature.
- **The seller of an order is resolved through the pinned definition to its agent to that agent's owner.** No seller identity is copied onto the order, which is what keeps the two reads authorising against the real current owner.
- **The verdict read is not part of this feature.** It belongs with the audit work that produces a verdict, alongside the audit itself and the assembly of the auditor's own view of the case file.
- **Running the agent, auditing a dispute, and the background jobs are out of scope.** This feature hands orders to execution and to audit and defines the states they consume; it does not do their work. The automatic release, the reclaim of undelivered orders, and the reaping of stuck ones are all jobs defined elsewhere.
- **The buyer's summarised view of the agent's reasoning is produced by the same serialisation boundary built for the catalogue**, extended here rather than duplicated, since it is the same disclosure rule reaching a second kind of content.
- **Ordering an agent you own is permitted**, since nothing in the flow requires the parties to differ and forbidding it would complicate seeding.
- **Neither list is paginated, searched, or sorted beyond newest-first**, matching the component's stated scope.
- **The published HTTP contract is the API documentation artefact produced by the documentation work.** Where it does not yet exist, the endpoint table in the API design document governs, and reconciling the two is that work's responsibility.
- **This feature depends on** the order, complaint, and ledger storage from the entities and migrations work; the balance, ledger, and escrow-exposure reads from the accounts and funding work; the catalogue's pinned definitions and its serialisation boundary; the chain-access layer that owns the escrow calls and the single money-unit conversion; and the wallet authentication that establishes who is calling.
