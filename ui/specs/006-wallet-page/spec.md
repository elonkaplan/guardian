# Feature Specification: Wallet page — money in, money out

**Feature Branch**: `006-wallet-page`

**Created**: 2026-08-08

**Status**: Draft

**Input**: User description: "docs/specs/UI-06-wallet-page.md — Money in, money out, and make the two different kinds of money legible. In scope: three separate money figures — available balance, in escrow, and settled funds — never collapsed, with the settled figure read server-side from the chain and possibly unavailable, rendering as a dash with withdrawal disabled while the rest of the page keeps working; the statement, refreshed while the page is open; add funds; withdraw settled funds to your own wallet; cash out unspent balance back to the treasury; and the line that says where the money came from. Out of scope: automated tests of any kind, Rain route UI, bank details, transaction history beyond the statement."

## Overview

Every other screen in this product spends money or moves it. This one is where a person finds out what they actually have — and it is the screen most likely to make the rest of the product look broken, because the money is in more than one place and each place has its own way out.

Three figures, not one. **Available balance** is topped-up money that has not been spent; it lives in the platform's own books and leaves by going back to where it came from. **In escrow** is money already committed to orders that have not concluded; it is not spendable and not withdrawable, it is simply waiting. **Settled funds** are what disputes and sales have already paid out — they sit on-chain under the person's own address, outside the platform's reach, and leave to their own wallet. Add these together into a single "balance" and the number is wrong in three directions at once: it overstates what can be spent, it implies escrowed money could be withdrawn, and it makes the statement look like it has lost track of things, because the statement will never explain a change in settled funds. It cannot: settlement happens on-chain and produces no book entry at all.

That last point is the one that decides the design. The statement is a complete explanation of the available balance and nothing else, and the page must say so rather than leave a reader to discover a gap and conclude the books are unreliable.

The third figure is also the fragile one. Two of these numbers come from the platform's own records; the settled figure comes from the chain, and that read can fail on its own. So it has a state the others do not — unknown, which is not zero — and the screen has to hold the distinction. A wallet that blanks itself because one of three numbers is temporarily unreadable is a worse outcome than a dash, and telling someone they have nothing settled when the truth is that nobody could look is worse than either.

Two exits follow from two kinds of money that can leave. **Cash out** returns unspent available balance to the treasury it was funded from — no signature, the platform does it. **Withdraw** sends settled funds from the contract to the person's own address. Offering one button for both would either strand the unspent balance, which is the more embarrassing failure in a demo — money can enter but not leave — or imply the platform can reach into funds it deliberately cannot touch.

Finally, the smallest requirement here carries disproportionate weight. When a hundred dollars appears with no bank transfer behind it, an observer wonders what just happened, and a question asked is far worse than a question answered. One line on the page — funded from the demo treasury, because the payments partner has no rail to this chain yet — turns a suspicion into a disclosed and reasonable limitation.

The people served: the **buyer**, who needs funds before they can purchase and needs to see the charge afterwards; the **seller**, whose earnings arrive as settled funds and who wants them in their own wallet; and the **sceptical observer**, who is the real audience for the separated figures and for the line about where the money came from.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - See what you have, and where it is (Priority: P1)

Someone signed in opens the wallet screen. Three amounts are laid out and labelled by where the money is and what can be done with it: what is spendable now, what is committed to orders in flight, and what has already paid out to their own address. Nothing is summed, and each figure says what it means.

**Why this priority**: Every other action on this screen is meaningless without it, and separating the figures is the point of the feature. This alone is a useful screen.

**Independent Test**: Sign in with an account that has a balance, orders in flight, and a concluded dispute; confirm three distinct labelled figures, no combined total, and that each one matches its source — then make the settled figure unreadable and confirm the screen degrades to a dash rather than failing.

**Acceptance Scenarios**:

1. **Given** a signed-in account, **When** the wallet screen renders, **Then** available balance, money in escrow, and settled funds are each displayed as their own labelled currency figure.
2. **Given** the three figures, **When** they are displayed, **Then** no combined or total figure is presented anywhere on the screen, and no two of them are added together.
3. **Given** each figure, **When** it is displayed, **Then** it is accompanied by wording that says where that money is and how it can leave — spendable here, committed to an order, or already yours on-chain — without requiring the reader to know the system's internals.
4. **Given** an account with an order in flight, **When** that order concludes while the screen is open, **Then** the escrow figure falls and the affected figures update without a refresh or a click.
5. **Given** an account that has never funded anything, **When** the screen renders, **Then** all three figures show zero explicitly, and the screen still explains what each one is rather than hiding empty sections.
6. **Given** the screen is open, **When** the underlying figures are re-read on a cadence, **Then** the amounts on screen never flicker to a placeholder or to zero between reads.
7. **Given** the settled-funds figure cannot be read, **When** the screen renders, **Then** it shows a dash in that figure's place — never a zero — while the other two figures, the statement, and every other control on the screen continue to work normally.
8. **Given** the settled-funds figure cannot be read, **When** the header's balance display renders elsewhere in the application, **Then** it is unaffected and continues to show the platform's own two figures.

---

### User Story 2 - Add funds (Priority: P1)

A person with an empty balance types an amount, confirms, and sees their available balance rise straight away — no pending state, no waiting for a confirmation to land somewhere. Beside the control is the line explaining that the money came from the demo treasury and why.

**Why this priority**: Nothing can be bought without it, so it gates the entire demo; and the provenance line is one of the things the demo must show.

**Independent Test**: On an account with a zero balance, add funds and confirm the available balance and the statement both reflect it within the same interaction, with the treasury explanation visible on screen.

**Acceptance Scenarios**:

1. **Given** the wallet screen, **When** the person enters an amount and confirms, **Then** the funds are added and the available balance shown on screen reflects the new amount without a manual refresh.
2. **Given** a completed top-up, **When** the person looks at the statement, **Then** a corresponding credit entry is present and identifies itself as funding.
3. **Given** the funding control, **When** it is displayed, **Then** the screen states that funds come from the demo treasury and that the payments partner has no rail to this chain, in wording an observer reads without asking a follow-up.
4. **Given** an amount that is empty, zero, negative, or not a valid currency amount, **When** the person tries to confirm, **Then** the action is refused with an explanation and nothing is submitted.
5. **Given** a submitted top-up, **When** it is in flight, **Then** the control indicates it is working and cannot be submitted a second time, so a double-click cannot fund twice.
6. **Given** a top-up that fails, **When** the failure is returned, **Then** the reason is shown in place, the balance figures are left as they truly are, and the person can try again without reloading the screen.

---

### User Story 3 - Read the statement (Priority: P2)

The person scrolls a list of movements: what changed, by how much, in which direction, when, and why — a purchase, a top-up, a cash-out. Every change in the available balance is accounted for, and a purchase entry points back at the order that caused it.

**Why this priority**: It is what makes the balance believable rather than asserted, and it is an explicit acceptance criterion — but the figures and funding come first.

**Independent Test**: Fund an account, buy something, cash out, then confirm the statement contains one entry per movement, correctly signed, and that applying them in order arrives at the displayed available balance.

**Acceptance Scenarios**:

1. **Given** an account with activity, **When** the statement renders, **Then** each movement appears as its own row showing the amount, whether it was a credit or a debit, what kind of movement it was, and when it happened.
2. **Given** the statement, **When** the rows are read in order, **Then** they account for the whole of the displayed available balance, with no unexplained difference.
3. **Given** a movement caused by a purchase, **When** its row renders, **Then** it identifies the order it belongs to and offers a way to reach that order.
4. **Given** the statement, **When** a new movement occurs while the screen is open, **Then** the new row appears on its own without a refresh, and the reader's scroll position is not thrown away.
5. **Given** the statement, **When** it is displayed, **Then** the screen makes clear that it explains the available balance and not the settled funds, because settled money moves on-chain and produces no entry here.
6. **Given** an account with no activity at all, **When** the statement renders, **Then** it states that there is nothing yet, rather than rendering an empty region or an error.
7. **Given** a movement of a kind this screen does not recognise, **When** its row renders, **Then** the amount, direction, and time are still shown, labelled with whatever the movement called itself.

---

### User Story 4 - Withdraw settled funds to your own wallet (Priority: P2)

A seller who has been paid, or a buyer who won a refund, sends that money out of the contract to the address they signed in with. It is their money already; this is the door.

**Why this priority**: It is the exit that proves the escrow's central property — that either party can be paid without the platform's cooperation. It matters, but the demo can be told without it before it can be told without funding.

**Independent Test**: On an account with non-zero settled funds, withdraw, and confirm the settled figure falls to zero on screen and the transfer is evidenced.

**Acceptance Scenarios**:

1. **Given** an account with settled funds, **When** the person withdraws, **Then** the funds are sent to the address they are signed in with and the settled figure on screen falls to reflect it.
2. **Given** a withdrawal, **When** it is requested, **Then** the screen states plainly that it is sending on-chain funds to the signed-in address, and does not ask the person to sign anything.
3. **Given** an account with zero settled funds, **When** the screen renders, **Then** the withdraw control is unavailable and the screen says why — there is nothing settled to withdraw — rather than offering an action that will fail.
4. **Given** a withdrawal in flight, **When** it is working, **Then** it cannot be submitted again, and the screen indicates that an on-chain movement may take a moment.
5. **Given** a completed withdrawal, **When** a transaction reference is available, **Then** it is shown and can be followed to the public block explorer.
6. **Given** a withdrawal that fails, **When** the failure is returned, **Then** the reason is shown in place, the figures continue to show the true state, and the action can be retried.
7. **Given** the settled-funds figure could not be read, **When** the screen renders, **Then** the withdraw control is unavailable with its own stated reason — the amount is presently unknown, distinct from being zero — and it becomes available again on a later read that succeeds, without the person reloading.

---

### User Story 5 - Cash out unspent balance (Priority: P2)

Someone who funded a hundred dollars and spent two sends the remaining ninety-eight back where it came from. Their available balance falls, and the statement records the debit.

**Why this priority**: Without it money can enter the platform and never leave, which is the first thing an observer probes. It follows withdrawal because it moves platform money rather than the person's own.

**Independent Test**: On an account with an unspent balance, cash out and confirm the available balance falls and a matching debit appears in the statement.

**Acceptance Scenarios**:

1. **Given** an account with an available balance, **When** the person cashes out, **Then** the available balance falls by the amount cashed out and a debit appears in the statement identifying itself as a cash-out.
2. **Given** the cash-out control, **When** it is displayed, **Then** the screen states that the money returns to the treasury it was funded from, and that this is what the payments partner's offramp would do.
3. **Given** an amount greater than the available balance, **When** the person tries to cash out, **Then** the action is refused with an explanation before anything is submitted.
4. **Given** an account whose available balance is zero, **When** the screen renders, **Then** the cash-out control is unavailable with a stated reason.
5. **Given** a cash-out in flight, **When** it is working, **Then** it cannot be submitted twice, and a failure is reported in place with the figures left showing the true state.
6. **Given** both exits on screen, **When** they are displayed, **Then** each is labelled with which money it moves and where that money goes, so the two are not mistaken for each other.

---

### Edge Cases

- **Settled funds change and the statement says nothing.** Expected, and stated on screen: settlement is an on-chain fact with no book entry. The screen explains the statement's scope rather than letting a reader conclude the books are wrong.
- **A purchase is made in another tab while the wallet screen is open.** The available balance falls and the escrow figure rises on the next read, and the purchase entry appears in the statement, without the reader acting.
- **Two exits confused for one another.** Cash-out when settled funds are non-zero but the balance is zero — and the reverse — each leave only the applicable control available, with the other explaining why it is not.
- **The chain read behind the settled-funds figure fails while the platform's own figures are fine.** The screen keeps working: a dash where that one figure goes, withdrawal unavailable with a reason, everything else untouched — including the header display used on every other screen. This is a partial answer, not a failed one, and the person is never told the wallet is broken because one of three numbers is temporarily unknown.
- **The settled-funds figure is absent rather than explicitly unknown** — a field renamed, missing, or misspelled upstream. It renders as unknown, exactly like a failed read, and never as zero. An absent number silently becoming a confident zero is the failure mode this rule exists to prevent.
- **The settled-funds read recovers on a later cycle.** The dash becomes an amount and withdrawal becomes available on its own, without a reload.
- **A top-up succeeds but the following read of the figures fails.** The success is not withdrawn from the screen; the figures report that they could not be refreshed, and the statement entry stands.
- **A movement is recorded with an amount of zero, or a correction entry appears.** It is displayed like any other row rather than filtered out — a hand-made correction is exactly the entry a reader most needs to see.
- **An action is submitted twice by an impatient click.** Only one movement occurs; the control refuses the second submission while the first is in flight.
- **A cash-out is submitted for the full balance at the moment a purchase clears.** The refusal comes from the platform and is reported as stated, with the figures re-read afterwards rather than the screen guessing.
- **A withdrawal is requested when the on-chain movement is slow.** The screen says it may take a moment and keeps reading the figures; it never claims completion it has not observed.
- **The session expires while the screen is open.** The screen stops showing money figures and directs the person to sign in again; it never renders another account's amounts.
- **The screen is opened without being signed in.** No figures, no controls — a prompt to connect, consistent with every other authenticated screen.
- **A very long statement.** The list stays scannable and scrolls within its own region rather than pushing the money figures off the screen; the figures remain visible while reading history.
- **An amount entered with more precision than currency allows, or with separators and symbols.** It is either normalised or refused with an explanation; it is never silently truncated into a different amount.

## Requirements *(mandatory)*

### Functional Requirements

**The three figures**

- **FR-001**: The screen MUST display available balance, money in escrow, and settled funds as three separately labelled currency figures.
- **FR-002**: The screen MUST NOT display any combined total of those figures, and MUST NOT sum any two of them for display.
- **FR-003**: Each figure MUST carry wording stating where that money is and how it can leave, readable without knowledge of the system's internals.
- **FR-004**: All three figures MUST come from the single account read the application already uses. The settled-funds figure is on-chain money, but this screen MUST obtain it the same way as the other two — the browser makes no chain call for it, and this feature introduces no second source for any figure.
- **FR-005**: Each figure MUST show an explicit zero when it is zero, rather than being hidden or shown as blank.
- **FR-006**: The figures MUST be re-read on a recurring cadence while the screen is open, and MUST NOT revert to placeholders or zero between reads.
- **FR-007**: A failure to read the figures MUST be reported on the screen while the last known amounts remain visibly marked as stale, and MUST NOT blank the screen or replace amounts with zeros.
- **FR-008**: The settled-funds figure MUST be treated as optionally unavailable, because it is read from the chain and that read can fail while the platform's own two figures remain perfectly good. When it is unavailable the screen MUST render it as a dash — visibly distinct from zero, since "we could not read it" and "you have none" are different facts — MUST continue to display the other two figures and the statement normally, MUST leave the header's existing balance display unaffected, and MUST NOT report the screen as failed.

**Adding funds**

- **FR-009**: The screen MUST offer a control to add funds, taking an amount from the person and applying it to their available balance.
- **FR-010**: A completed top-up MUST be reflected in the displayed available balance as part of the same interaction, without the person refreshing or waiting for a subsequent read.
- **FR-011**: The screen MUST reject an amount that is empty, zero, negative, or not a valid currency amount, with an explanation and without submitting anything.
- **FR-012**: The funding control MUST NOT be submittable twice while a request is in flight, and MUST indicate that it is working.
- **FR-013**: A failed top-up MUST report its reason in place, leave the figures showing the true state, and allow a retry without reloading.

**Where the money came from**

- **FR-014**: The screen MUST state, adjacent to the funding control, that funds come from the demo treasury and that the payments partner has no rail to this chain — visible without scrolling to it or opening anything.
- **FR-015**: That statement MUST be presented as a disclosed limitation rather than an error or a warning about something being broken.

**The statement**

- **FR-016**: The screen MUST display a statement listing each movement of the available balance with its amount, its direction, its kind, and when it occurred.
- **FR-017**: The statement MUST account for the entirety of the displayed available balance, with no unexplained difference between the entries and the figure.
- **FR-018**: The statement MUST be re-read on the same recurring cadence as the figures, adding new entries without a refresh and without discarding the reader's scroll position.
- **FR-019**: An entry caused by a purchase MUST identify its order and provide a way to reach that order.
- **FR-020**: The screen MUST state that the statement explains the available balance only, and that settled funds move on-chain without producing an entry.
- **FR-021**: An empty statement MUST state that there is no activity yet rather than rendering an empty region or an error.
- **FR-022**: An entry of an unrecognised kind MUST still be listed with its amount, direction, and time, labelled with the kind it reports.
- **FR-023**: A long statement MUST scroll within its own region, leaving the three figures visible while history is read.

**The two exits**

- **FR-024**: The screen MUST offer withdrawal of settled funds to the signed-in address, and MUST present it as moving on-chain money that is already the person's own.
- **FR-025**: The screen MUST offer cash-out of unspent available balance back to the treasury, and MUST present it as returning platform money to where it was funded from.
- **FR-026**: Each exit MUST be labelled with which of the three figures it moves and where that money goes, so the two cannot be mistaken for one another.
- **FR-027**: An exit whose corresponding figure is zero MUST be unavailable with a stated reason, rather than offered as an action that will fail. Withdrawal MUST additionally be unavailable when the settled-funds figure could not be read, with its own stated reason — an unknown amount is not a licence to attempt the movement.
- **FR-028**: A cash-out amount exceeding the available balance MUST be refused with an explanation before submission.
- **FR-029**: Neither exit MUST be submittable twice while a request is in flight, and each MUST indicate that it is working.
- **FR-030**: A withdrawal MUST indicate that an on-chain movement may take a moment, and MUST NOT report completion the screen has not observed.
- **FR-031**: When a withdrawal returns a transaction reference, the screen MUST display it and link it to the public block explorer using the application's existing chain-and-explorer definition.
- **FR-032**: A failed exit MUST report its reason in place, leave the figures showing the true state, and allow a retry.
- **FR-033**: After any successful action, the figures and the statement MUST reflect the new state without the person refreshing or navigating.

**Boundaries**

- **FR-034**: This feature MUST NOT request a wallet signature, MUST NOT submit any transaction from the browser, and MUST NOT read chain state from the browser; every movement of money and every reading of on-chain state MUST be carried out by the backend.
- **FR-035**: This feature MUST NOT present payment-route selection, bank details, card details, or any other payments-partner interface.
- **FR-036**: This feature MUST NOT present transaction history beyond the statement and the transaction reference produced by a withdrawal.
- **FR-037**: The screen MUST require an established session, showing no money figures and no controls otherwise, consistent with the application's existing authenticated screens.
- **FR-038**: No automated tests are produced for this feature; its acceptance is verified by hand (see Assumptions).

### Key Entities

- **Available balance**: unspent funded money held in the platform's books. Spendable on purchases; leaves by cash-out. The only figure the statement explains.
- **Money in escrow**: money committed to orders that have not concluded. Neither spendable nor withdrawable — it is shown so that the available balance is not mistaken for everything the person has.
- **Settled funds**: money the contract has already paid out, held on-chain under the person's own address. Leaves by withdrawal to that address; the platform cannot recall it, which is the property that lets either party exit unilaterally. Alone among the three figures it may be *unknown* as well as zero, because it is read from the chain — a third state the screen has to carry rather than flatten.
- **Statement entry**: one movement of the available balance — a signed amount, a kind (funding, purchase, cash-out, or a hand-made correction), a time, and, for a purchase, the order that caused it.
- **Top-up**: funding drawn from the demo treasury into the available balance, credited in a single interaction with no pending state.
- **Cash-out**: the return of unspent available balance to the treasury — a platform-executed movement requiring no signature.
- **Withdrawal**: the transfer of settled funds from the contract to the signed-in address, executed on the person's behalf and evidenced by a transaction reference.
- **Demo treasury**: the wallet that stands in for the outside world. Top-ups draw from it and cash-outs return to it, which is what makes its balance a health check on the whole loop.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A person who has never seen the product can state, from the screen alone and within 30 seconds, which money they can spend, which is committed, and which is already theirs on-chain.
- **SC-002**: No screen state in any rehearsal presents a single combined balance figure.
- **SC-003**: A top-up is reflected in the displayed available balance within 2 seconds of confirmation, in ten consecutive attempts, with no refresh or navigation.
- **SC-004**: Applying every statement entry in order reproduces the displayed available balance exactly, in 100% of rehearsals.
- **SC-005**: Each of the three actions — add funds, withdraw, cash out — completes successfully in ten consecutive rehearsals, and each is reflected on screen without a manual refresh.
- **SC-006**: A change made elsewhere — a purchase, an order concluding — appears on the wallet screen within 6 seconds without the reader acting.
- **SC-007**: An observer asking where the money came from finds the answer already on screen; the explanation is legible from the back of a demo room on the presentation display.
- **SC-008**: Every refusal and failure path — invalid amount, insufficient balance, zero settled funds, a failing top-up, withdrawal, or cash-out, unreadable figures, unreadable statement — renders a stated reason and a way forward; none renders a blank region, a silent no-op, or an unhandled error.
- **SC-009**: No double submission produces two movements, across ten deliberate double-click attempts on each control.
- **SC-010**: The treasury's own balance falls by exactly the amount of every top-up and rises by exactly the amount of every cash-out across a full rehearsal, confirming money leaves the platform by both exits.
- **SC-011**: The three figures remain visible while a statement of at least fifty entries is scrolled.
- **SC-012**: With the settled-funds figure made unreadable, the wallet screen and the application's header display both continue to function in full — the platform's own two figures, the statement, funding, and cash-out all work, withdrawal is unavailable with a stated reason, and no part of either screen is blank or reports an error.
- **SC-013**: An unreadable settled-funds figure is never displayed as zero, in any rehearsal.

## Assumptions

- **The backend serves the account figures and the statement as documented**, and executes all three money movements — funding, cash-out, and withdrawal — on the person's behalf. This screen is a client of that contract and introduces no second source for any figure.
- **The account read carries all three figures, the settled one included**, obtained server-side from the chain. The browser therefore makes zero chain calls, and the settled figure is not an exception to that boundary — it is the demonstration of it.
- **The settled-funds figure may be absent.** The account read is the most-polled read in the application and the platform's own two figures come from its own records, so a chain outage must degrade one number rather than fail the request. The screen accordingly distinguishes three states for that figure — an amount, zero, and unknown — where the other two have only two.
- **The recurring read cadence for this screen matches the component briefing's wallet cadence** and never stops, because a movement can land at any time. Reuse of the application's existing reading mechanism is assumed rather than a new one.
- **Funding is immediate and has no pending state.** The credit and the response happen together, which is why nothing on this screen polls for a top-up to land.
- **Cash-out takes an amount** rather than always returning the whole balance, mirroring funding and allowing a partial exit. If the platform only supports the full balance, the control still states the amount before confirming.
- **Withdrawal takes no amount.** Settled funds are withdrawn in full to the signed-in address, because that is the movement the contract performs.
- **Settlement produces no statement entry**, by design — it is an on-chain fact under the person's own address. This is the reason the statement's scope is stated on screen rather than assumed to be obvious.
- **The minimum amounts documented for the payments partner's simulations do not apply here**, because no partner call is made; funding is a treasury transfer under a stubbed route.
- **The chain and explorer definition already shipped is reused**; this feature adds no new explorer address or network configuration.
- **Money formatting, the authenticated-screen pattern, the header's existing balance display, and the application's error and loading conventions are reused** from features that shipped them; this screen introduces no separate way of showing an amount.
- **The header's existing two-figure balance display continues to show available balance and escrow only.** The third figure is this screen's concern, and nothing here changes the header.
- **The person is both buyer and seller on one account** — there is no role switch, and settled funds may arrive from either a sale or a won dispute.
- **No automated tests are written for this feature.** This is a deliberate, time-boxed MVP decision recorded in the component briefing: the only kept test suite is the escrow contract's. Acceptance here is verified by hand, and the demo rehearsal is the real regression check.
