# Feature Specification: Accounts, Ledger & Funding

**Feature Branch**: `005-accounts-ledger-funding`

**Created**: 2026-08-09

**Status**: Draft

**Input**: User description: "docs/specs/API-05-accounts-ledger-funding.md — Money in and money out, plus the Rain stubs that document what we would have called. `GET /me` returning three separate money figures and never collapsing them, `GET /me/ledger`, `POST /topup`, `POST /withdraw`, `POST /offramp`, and the `POST /onramp/routes` and `POST /offramp/routes` stubs that log the exact request body they would have sent and make no call."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Seeing where your money actually is (Priority: P1)

A signed-in person asks the platform for their account summary and gets back three separate money figures, never merged: what they can spend right now, what is locked in purchases that have not finished, and what has already settled to their own wallet address. The three are different kinds of money in three different places, and the summary says so by keeping them apart.

The third figure — settled funds — is the only one the platform cannot look up in its own records, because settled money lives on-chain under the user's own address and the platform never writes it down. So the summary reaches out to the chain for it. That reach is treated as optional: if the chain is slow or unreachable, the figure comes back as "unknown" and the other two are served exactly as normal. The summary never fails because of it.

**Why this priority**: This summary is polled continuously by the balance widget that sits on every page of the product, which makes it the single most-requested thing in the whole backend and the most visible thing on stage. If it collapses the figures, the number on screen is wrong in three of the four places money can be. If it fails when the network is having a bad minute, every page in the product breaks at once.

The separation is also what carries the demo's closing act. That act ends in a full refund, and a refund lands in settled funds under the buyer's own address — so the spendable figure does not move at all. Against a single collapsed balance, a presenter saying "and the money comes back" would be standing beside a number that did not change, which reads as a failure. The third figure is what makes the refund visible. On its own this story delivers an honest, always-available picture of an account.

**Independent Test**: Sign in, request the account summary, and confirm three distinctly named money figures come back. Then point the platform at a chain endpoint that does not answer, request the summary again, and confirm it still succeeds, still carries both record-based figures, and reports the settled figure as unknown rather than as zero or as an error.

**Acceptance Scenarios**:

1. **Given** a signed-in account, **When** the account summary is requested, **Then** the response carries the account's identity plus three separately named money figures — spendable balance, amount held in escrow, and settled funds — and no single combined "balance" figure.
2. **Given** an account with money in more than one place, **When** the summary is requested, **Then** each figure reflects only its own location and no figure includes money counted in another.
3. **Given** an account that has never transacted, **When** the summary is requested, **Then** the spendable and escrowed figures are both zero rather than absent.
4. **Given** the chain is unreachable, **When** the summary is requested, **Then** the request succeeds, the two record-based figures are correct, and the settled figure is explicitly unknown — distinguishable from a genuine zero.
5. **Given** the chain is reachable but answering slowly, **When** the summary is requested, **Then** the platform stops waiting well before the caller's next poll would arrive and reports the settled figure as unknown rather than holding the request open.
6. **Given** the chain answers normally, **When** the summary is requested, **Then** the settled figure matches what the chain reports for that account's own address, expressed in the same money unit as the other two figures.
7. **Given** a request with no valid session, **When** the summary is requested, **Then** it is refused as unauthenticated.

---

### User Story 2 - Money enters the platform (Priority: P2)

A signed-in person asks to add funds. The platform moves real test tokens from the funder wallet — which stands in for the outside world — into the pooled wallet it holds on users' behalf, and only once that transfer has actually gone through does it credit the person's account in its records. The credit records which transfer it came from, so the money can always be traced back to a transaction on the chain. The person's spendable balance goes up by the amount added, and nothing else changes.

**Why this priority**: Every other thing a buyer can do in the product costs money, so nothing downstream is demonstrable until money can get in. It ranks below the summary only because the summary is what makes the result of a top-up visible, and because an account with no money is still a working account.

**Independent Test**: Note the funder wallet's token balance, the pooled wallet's token balance, and the account's spendable balance. Add funds. Confirm all three moved by the same amount in the right directions, and that the new record entry names the on-chain transfer it came from.

**Acceptance Scenarios**:

1. **Given** a signed-in account and a funder wallet with sufficient tokens, **When** funds are added for a given amount, **Then** tokens equal to that amount move from the funder wallet to the pooled wallet, and the account's spendable balance increases by exactly that amount.
2. **Given** a completed top-up, **When** the account's statement is inspected, **Then** it contains one new positive entry categorised as an incoming transfer, carrying a reference to the on-chain transaction that funded it.
3. **Given** a top-up request, **When** the on-chain transfer fails or is rejected, **Then** no credit is recorded, the caller is told the top-up did not happen, and the account's spendable balance is unchanged.
4. **Given** the funder wallet does not hold enough tokens, **When** funds are requested, **Then** the request is refused with a reason that identifies the shortfall, and nothing is recorded.
5. **Given** a top-up request for zero, a negative amount, or a fractional amount smaller than the platform's money unit, **When** it is submitted, **Then** it is refused as invalid and no transfer is attempted.
6. **Given** any completed top-up, **When** the pooled wallet's token holdings are compared with the sum of every account's spendable balance, **Then** the pooled wallet still holds at least as much as the platform owes.

---

### User Story 3 - The statement explains the balance (Priority: P3)

A signed-in person asks for their statement and gets the list of every money movement the platform has recorded for them — each with an amount that is positive for money in and negative for money out, what kind of movement it was, when it happened, and what it relates to. Adding the amounts up gives exactly the spendable balance shown on the summary. Entries are never edited or removed; a correction appears as a new entry of its own.

**Why this priority**: A balance nobody can explain is a balance nobody trusts, and on stage the statement is what turns "the number changed" into "here is why." It ranks below the movements themselves because it only reports on them.

**Independent Test**: Perform a top-up and a cash-out, request the statement, and confirm both appear with correct signs and categories, and that their amounts sum to the spendable balance on the summary.

**Acceptance Scenarios**:

1. **Given** an account with recorded movements, **When** the statement is requested, **Then** every movement for that account is listed with its amount, category, timestamp, and any related order or external reference.
2. **Given** the statement is listed, **When** its amounts are added together, **Then** the total equals the spendable balance reported by the account summary at the same moment.
3. **Given** money in, **When** its entry is inspected, **Then** its amount is positive; **and given** money out, **Then** its amount is negative.
4. **Given** an account belonging to someone else, **When** their statement is requested, **Then** it is refused — a caller only ever sees their own movements.
5. **Given** an existing entry, **When** anything in the system attempts to change or delete it, **Then** the attempt does not succeed; corrections exist only as new entries.
6. **Given** an account that has never transacted, **When** the statement is requested, **Then** an empty list is returned rather than an error.

---

### User Story 4 - Settled funds reach the user's own wallet (Priority: P4)

After a purchase has finished and money has settled, a signed-in person asks the platform to move their settled funds out. The platform instructs the escrow contract to pay that account's own wallet address, and the money leaves the platform's reach entirely. Because settled money was never in the platform's records to begin with, this movement adds nothing to the statement — the settled figure on the summary simply drops to zero and the tokens appear in the user's wallet.

**Why this priority**: It is the exit that makes the escrow promise real — either party can get their money without the platform's cooperation. It sits below the entry paths because a demo can show settlement happening before it shows anyone cashing out, and because it moves money that is already safely outside the platform's control.

**Independent Test**: With an account that has a non-zero settled figure, note the wallet's token balance, request a withdrawal, and confirm the tokens arrive at that wallet, the settled figure falls to zero, and the statement gained no new entries.

**Acceptance Scenarios**:

1. **Given** an account with settled funds, **When** a withdrawal is requested, **Then** the escrow contract pays those funds to that account's own registered wallet address and the caller is told which transaction did it.
2. **Given** a completed withdrawal, **When** the statement is inspected, **Then** it has not changed — no entry is written for settled funds.
3. **Given** a completed withdrawal, **When** the summary is requested afterwards, **Then** the settled figure has fallen to zero while the spendable and escrowed figures are untouched.
4. **Given** an account with no settled funds, **When** a withdrawal is requested, **Then** it is refused with a clear reason and no transaction is submitted.
5. **Given** a withdrawal request, **When** the destination is determined, **Then** it is always the account's own registered wallet address and never an address supplied by the caller.
6. **Given** the chain rejects the withdrawal, **When** the failure comes back, **Then** the caller is told the withdrawal did not happen and the settled figure is unchanged.

---

### User Story 5 - Unspent balance can leave the way it came in (Priority: P5)

A signed-in person who added funds but did not spend all of them asks to cash the remainder out. The platform debits their records first, then returns the equivalent tokens from the pooled wallet back to the funder wallet — the same outside world the money came from. If the return transfer does not go through, the debit is reversed by a new correcting entry, so the records and the tokens stay in agreement.

**Why this priority**: A demo where money can enter but not leave invites the obvious question, and closing the loop makes the funder wallet's balance a usable health signal. It is last among the money paths because it is the only one no other feature depends on.

**Independent Test**: Top up, spend nothing, cash out the full amount, and confirm the spendable balance returns to zero, a negative outgoing entry appears in the statement, and the funder wallet's token balance returns to where it started.

**Acceptance Scenarios**:

1. **Given** an account with spendable balance, **When** a cash-out is requested for an amount at or below that balance, **Then** the balance is reduced by that amount, tokens equal to it move from the pooled wallet back to the funder wallet, and the caller is told which transaction did it.
2. **Given** a completed cash-out, **When** the statement is inspected, **Then** it contains one new negative entry categorised as an outgoing transfer, carrying a reference to the on-chain transaction.
3. **Given** a cash-out request for more than the spendable balance, **When** it is submitted, **Then** it is refused, no debit is recorded, and no transfer is attempted.
4. **Given** an account whose money is held in escrow, **When** a cash-out is requested for that escrowed money, **Then** it is refused — only unspent spendable balance can leave this way.
5. **Given** a debit has been recorded, **When** the return transfer subsequently fails, **Then** a new correcting entry restores the balance, the original debit remains in the statement, and the caller is told the cash-out did not complete.
6. **Given** a cash-out request for zero, a negative amount, or a fractional amount smaller than the platform's money unit, **When** it is submitted, **Then** it is refused as invalid.

---

### User Story 6 - The fiat routes admit they are stubs (Priority: P6)

Someone asks the platform for a fiat on-ramp or off-ramp route. The platform assembles the exact request it would send to the payment provider, writes that request to the logs at warning level so it can be read off the console during the demo, and then makes no call. It answers with something that says in plain terms that no call was made and why — and for the off-ramp route, it hands back the funder wallet's address as the deposit address, which is exactly the shape the real provider would return.

**Why this priority**: This carries no money and blocks nothing, so it comes last. It exists because the request body is the actual finding — it shows precisely what was attempted and where the provider's rails stop — and because a stub that quietly returns a fake success is a thing that gets forgotten and then demoed by accident.

**Independent Test**: Call each route endpoint, confirm the full would-be request body appears in the logs at warning level, and confirm the response body cannot be read as a successful provider response by anyone looking at it.

**Acceptance Scenarios**:

1. **Given** an on-ramp route request, **When** it is submitted, **Then** the complete request body the provider would have received is written to the logs at warning level, and no request is sent to the provider.
2. **Given** an off-ramp route request, **When** it is submitted, **Then** the same logging happens and the response supplies the funder wallet's address as the deposit address.
3. **Given** either route response, **When** it is read, **Then** it states explicitly that no provider call was made, and contains nothing that imitates a provider's success payload.
4. **Given** the live-provider setting is off, **When** either route is called, **Then** the stub behaviour applies; **and given** it were switched on, **Then** that is the only thing that would need to change.
5. **Given** a logged request body, **When** it is inspected, **Then** it contains no private key, session credential, or other secret.

---

### Edge Cases

- **The chain read for settled funds hangs rather than failing.** Waiting is worse than failing here, because the caller polls again in a few seconds regardless. The read is abandoned at a fixed deadline and the figure is reported unknown.
- **The chain reports a settled figure of exactly zero.** This must be reported as zero, not as unknown — the two mean different things to the person reading the screen, and conflating them hides whether the chain was reached at all.
- **An order concludes in a full refund to the buyer.** The refunded money lands in settled funds, so the settled figure rises while the spendable figure stays exactly where it was and the statement gains nothing. That is correct, not a missing write — and it is the case that most looks like a bug to someone watching a single number.
- **A top-up's on-chain transfer succeeds but recording the credit then fails.** The pooled wallet holds money the platform has not credited to anyone. Nothing is lost and the solvency relationship still holds in the safe direction, but the user is short. The transaction reference is logged at error level so the credit can be replayed by hand as a correcting entry.
- **A cash-out's debit is recorded but the return transfer fails.** Handled by a compensating entry rather than by deleting the debit, because the record of movements is never rewritten.
- **Two cash-outs are requested at once for a balance that only covers one.** The balance check and the debit must settle against each other so the account cannot be drawn below zero; the second request is refused.
- **A withdrawal is requested twice in quick succession.** The second finds nothing settled and is refused rather than submitting a transaction that would do nothing and cost gas.
- **An escrow figure is requested while the orders that back it are still being created.** The figure reflects whatever is currently open; it is a live sum, not a stored number, so it is never stale in the other direction.
- **The funder wallet drifts steadily in one direction across a session.** Not an error the platform raises, but the intended health signal: top-ups should pull it down and cash-outs should push it back up.
- **A wallet involved in a transfer has no gas.** The transfer fails cleanly and is reported as a failure, rather than being recorded as though it had happened.
- **A caller asks for a summary or statement while holding a session for an account that has since been removed.** Refused as unauthenticated rather than answered with empty figures.

## Requirements *(mandatory)*

### Functional Requirements

**Account summary**

- **FR-001**: System MUST expose an account summary for the signed-in caller that returns the caller's account identity together with three separately named money figures: spendable balance, amount held in escrow, and settled funds.
- **FR-002**: System MUST NOT expose any combined or single "balance" figure alongside or instead of the three, and MUST NOT let one figure include money counted in another.
- **FR-003**: System MUST derive the spendable balance from the platform's own recorded money movements and the escrowed amount from the caller's currently open orders, with neither depending on the chain.
- **FR-004**: System MUST derive the settled-funds figure from the chain, reading the balance held for the caller's own wallet address, because the platform holds no record of settled money.
- **FR-005**: System MUST treat the settled-funds read as best-effort: on any failure, error, or read exceeding a fixed deadline, the summary MUST still succeed, MUST still carry both record-based figures, and MUST report settled funds as unknown.
- **FR-006**: System MUST report an unknown settled figure distinguishably from a genuine zero.
- **FR-007**: System MUST bound the settled-funds read by a deadline shorter than the interval at which the summary is polled, so a slow chain never delays a caller past their next request.
- **FR-008**: System MUST name the settled-funds field consistently with the other two money fields and express it in the same money unit, because the consuming interface reads the name literally and a mismatch renders as an absent value rather than as an error.

**Statement**

- **FR-009**: System MUST expose a statement for the signed-in caller listing every recorded money movement on their account, each carrying a signed amount, a category, a timestamp, and any related order or external transaction reference.
- **FR-010**: System MUST record credits as positive amounts and debits as negative amounts, such that the sum of a caller's entries equals their spendable balance.
- **FR-011**: System MUST NOT modify or delete a recorded movement once written; corrections MUST be expressed as new entries in a correction category.
- **FR-012**: System MUST return an empty statement, not an error, for an account with no movements.
- **FR-013**: System MUST scope both the summary and the statement to the calling account only.

**Adding funds**

- **FR-014**: System MUST let a signed-in caller add funds by transferring tokens from the funder wallet to the pooled wallet and then crediting the caller's account by the same amount.
- **FR-015**: System MUST confirm the on-chain transfer before recording the credit, and MUST record no credit if the transfer does not complete.
- **FR-016**: System MUST record the credit as a single positive entry in the incoming-transfer category, carrying the transaction reference of the transfer that funded it.
- **FR-017**: System MUST refuse an amount that is not a positive whole number in the platform's money unit, without attempting a transfer.
- **FR-018**: System MUST refuse the request with a reason identifying the shortfall when the funder wallet cannot cover the amount.
- **FR-019**: System MUST preserve the relationship that the pooled wallet's token holdings are at least the sum of all accounts' spendable balances, across every funding operation — including at every intermediate point, so that a failure partway through a two-phase flow leaves the pool holding more than the records claim rather than less. In every such flow, whichever of the two writes increases what the platform owes MUST be the second one performed.

**Withdrawing settled funds**

- **FR-020**: System MUST let a signed-in caller move their settled funds out by instructing the escrow contract to pay the account's own registered wallet address.
- **FR-021**: System MUST determine the destination address from the caller's account and MUST NOT accept a destination from the request.
- **FR-022**: System MUST write no entry to the statement for a withdrawal of settled funds.
- **FR-023**: System MUST refuse a withdrawal when the caller has no settled funds, without submitting a transaction.
- **FR-024**: System MUST return the transaction reference on success and report failure without altering any recorded figure.

**Cashing out unspent balance**

- **FR-025**: System MUST let a signed-in caller cash out unspent spendable balance by recording the debit first and then returning the equivalent tokens from the pooled wallet to the funder wallet.
- **FR-026**: System MUST refuse a cash-out exceeding the caller's spendable balance, and MUST prevent concurrent cash-outs from drawing an account below zero.
- **FR-027**: System MUST record the debit as a single negative entry in the outgoing-transfer category, carrying the transaction reference once the transfer completes.
- **FR-028**: System MUST record a compensating correction entry restoring the balance, and report the failure to the caller, when the return transfer does not complete after the debit was recorded.
- **FR-029**: System MUST refuse an amount that is not a positive whole number in the platform's money unit.
- **FR-030**: System MUST NOT allow escrowed or settled money to be cashed out through this path.

**Provider route stubs**

- **FR-031**: System MUST expose on-ramp and off-ramp route endpoints that assemble the exact request body the payment provider would receive, write it to the logs at warning level, and make no call to the provider.
- **FR-032**: System MUST return a response from each stub that states plainly that no provider call was made, and MUST NOT return anything shaped like or mistakable for a successful provider response.
- **FR-033**: System MUST return the funder wallet's address as the deposit address from the off-ramp route, matching the shape the real provider would return.
- **FR-034**: System MUST gate live provider calls behind a single configuration setting that is off, such that switching it on is the only change required to go live.
- **FR-035**: System MUST exclude private keys, session credentials, and other secrets from the logged request bodies.

**Cross-cutting**

- **FR-036**: System MUST require an authenticated session for every endpoint in this feature and MUST refuse unauthenticated callers before any money is read or moved.
- **FR-037**: System MUST express every money amount in the endpoints and records of this feature in the platform's single money unit, performing no unit conversion outside the chain-access boundary that already returns that unit.
- **FR-038**: System MUST report every failed money movement as a failure to the caller, and MUST NOT report an outcome as successful when the corresponding transfer did not complete.

### Key Entities

- **Account**: A person on the platform, identified by their wallet address. That address is both their identity and the destination for every payout they receive. One account is both buyer and seller.
- **Money movement (ledger entry)**: One recorded change to an account's spendable balance — a signed amount, a category (incoming transfer, purchase, outgoing transfer, correction), a timestamp, and optionally the order or on-chain transaction it relates to. Append-only; the list of these is the statement and their sum is the balance.
- **Funder wallet**: The outside world. The only source of money in the system: funds enter from it and cash-outs return to it. Its balance drifting in one direction only is a signal that something is wrong.
- **Pooled wallet**: The wallet the platform holds on all users' behalf. Must always hold at least the sum of what the platform owes.
- **Escrow hold**: Money locked against an open order. Not spendable, not settled, and not stored as its own number — it is the live sum over the caller's unfinished orders.
- **Settled funds**: Money the escrow contract has credited to a user's own address after an order concluded. The platform has no record of it and never will; it exists only on the chain and only the user can move it.
- **Provider route request**: The request body the payment provider would have received. Produced, logged, and deliberately not sent — it is the deliverable of the stub, not a side effect.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Adding funds moves real test tokens and shows up as spendable money: after a top-up, the funder wallet is down by the amount, the pooled wallet is up by it, and the account's spendable figure is up by it — three movements that agree, every time.
- **SC-002**: Cashing out returns tokens to the funder wallet and reduces the recorded balance by the same amount, so that a top-up followed by a full cash-out leaves the funder wallet's token balance where it started.
- **SC-003**: The account summary presents three money figures on every response and never fewer.
- **SC-004**: With the chain pointed at an address that does not answer, 100% of account-summary requests still succeed and still carry both record-based figures, with the settled figure reported as unknown.
- **SC-005**: A settled-funds read never delays an account-summary response beyond the interval at which the balance widget polls, so consecutive polls never queue behind one another.
- **SC-006**: Both provider stubs are recognisable as stubs on sight: an observer reading only the response body can tell that no provider call was made, and the full would-be request body is readable in the logs.
- **SC-007**: The statement explains the balance exactly: for any account at any moment, the sum of its listed movements equals its spendable figure, with no unexplained difference.
- **SC-008**: Withdrawing settled funds adds nothing to the statement, and the settled figure falls to zero while the other two figures are unchanged.
- **SC-009**: Across a full demo rehearsal, the pooled wallet's token holdings never fall below the total spendable balance the platform owes its users.
- **SC-010**: No money movement is ever reported as successful to a caller when the underlying transfer did not complete.

## Assumptions

- **All acceptance criteria here are verified by hand.** Automated tests of every kind are out of scope for this component — a time-boxed decision recorded in the component context. The demo rehearsal is the test suite.
- **The chain-access layer already returns settled balances in the platform's money unit**, so this feature performs no unit conversion of its own. Every amount in these endpoints and records is in that one unit.
- **The escrowed figure is computed live** from the caller's open orders rather than stored. Until the orders feature exists, it correctly reports zero.
- **The settled-funds deadline is assumed to be about two seconds**, comfortably inside the five-second polling interval of the balance widget. The exact value is a tuning decision, not a contract.
- **Write order in every two-phase money flow follows one rule: whichever write increases what the platform owes goes second.** The solvency relationship is "at least", not "exactly", so a crash between the two halves must leave the pool holding *more* than the records claim, never less. Cashing out reduces the records, so records go first; adding funds increases them, so the transfer goes first. Adding funds is the only flow in this feature that increases what is owed, and so the only one where the familiar "records first" shorthand is the wrong way round — that shorthand is a consequence of the direction rule, not the rule itself.

  | Flow | Records | Tokens | Order | A crash leaves |
  | --- | --- | --- | --- | --- |
  | Cash-out | ↓ | ↓ pool → funder | records first | records down, pool flat ✅ |
  | Adding funds | ↑ | ↑ funder → pool | **transfer first** | pool up, records flat ✅ |
- **The stubs answer with an ordinary successful transport response** whose body plainly states that no provider call was made. "Never fake a success" is about the body's content, not the status code; a transport-level error would misrepresent the endpoint as broken when it is working exactly as designed.
- **Route stub endpoints require a session** like every other endpoint here, even though they move no money.
- **Amounts are whole numbers in the platform's money unit** and no minimum or maximum is imposed beyond what the funder wallet or the account balance can cover.
- **Live provider calls, webhooks, deposit polling, bank accounts, and per-user provider records are out of scope**, along with pagination on the statement, rate limiting, and any off-ramp to a real bank.
- **This feature depends on** the account and money-movement storage from the entities and migrations work, the chain-access layer, and the wallet authentication that establishes who is calling.
