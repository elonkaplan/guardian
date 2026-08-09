# Feature Specification: Contract Test Suite

**Feature Branch**: `002-contract-test-suite`

**Created**: 2026-08-08

**Status**: Draft

**Input**: User description: "docs/specs/SC-02-test-suite.md — Automated tests that prove the escrow does what the product promises, especially the refund tier splits, which are the on-chain half of Guardian's credibility."

## Overview

The settlement layer built in SC-01 is the one part of Guardian that cannot be
corrected in place. Every other component can be fixed and redeployed at no cost to
anyone holding money; a settlement bug moves someone's funds to the wrong address and
costs a redeploy plus a configuration change everywhere the settlement layer's address
is recorded. That asymmetry is the entire reason this component keeps an automated
verification suite while the rest of the project does not.

The deliverable is a body of automated checks, plus a stand-in settlement token used
only by those checks, that demonstrates each promise the product makes about money:
the five refund percentages are exactly the five percentages advertised, deadlines
open and close on the correct side of the boundary, only the intended party can take
each action, a purchase can never settle twice, the funds actually held always cover
every claim against them, and a payout reaches the person owed rather than whoever
triggered it.

The audience is twofold. Reviewers of the settlement layer read the suite as evidence
that the guarantees are real rather than asserted. Anyone changing the settlement layer
later relies on it to reveal a regression before funds are at stake.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Every verdict splits the money exactly as promised (Priority: P1)

Guardian rules on a disputed purchase by picking one of five refund levels — none, a
quarter, half, three quarters, or everything. The product's credibility rests on those
five numbers being the numbers that actually move. A reviewer must be able to point at
a single check per level and see the buyer's and seller's shares written out.

**Why this priority**: This is the highest-risk, highest-visibility behaviour in the
entire project. A wrong percentage is invisible in normal operation and surfaces only
when a real verdict is executed — in a demo, in front of the audience watching that
exact number. Every other check protects against a bug that at least announces itself.

**Independent Test**: Drive a purchase to the disputed state and have the arbitrator
rule at each of the five levels in turn, asserting the buyer's and seller's claimable
amounts for each. Fully meaningful on its own — it is the evidence the product's
headline promise is honoured.

**Acceptance Scenarios**:

1. **Given** a disputed purchase of a known amount, **When** the arbitrator rules "no
   refund", **Then** the seller is owed the entire amount and the buyer is owed
   nothing.
2. **Given** the same setup, **When** the arbitrator rules "quarter refund", **Then**
   the buyer is owed exactly one quarter and the seller exactly three quarters.
3. **Given** the same setup, **When** the arbitrator rules "half refund", **Then**
   buyer and seller are each owed exactly half.
4. **Given** the same setup, **When** the arbitrator rules "three-quarter refund",
   **Then** the buyer is owed exactly three quarters and the seller one quarter.
5. **Given** the same setup, **When** the arbitrator rules "full refund", **Then** the
   buyer is owed the entire amount and the seller nothing.
6. **Given** any of the five rulings, **When** it is applied, **Then** the two shares
   add up to the original amount exactly — nothing is created, nothing is lost.
7. **Given** a disputed purchase whose amount does not divide evenly by four, **When**
   a quarter-based ruling is applied, **Then** the two shares still sum to the exact
   original amount and the remainder lands on the seller's side.
8. **Given** a disputed purchase nobody ruled on within the arbitration deadline,
   **When** any address force-settles it, **Then** the outcome is the quarter-refund
   split and it is distinguishable from a real verdict by the absence of a verdict
   reference.

---

### User Story 2 - Undisputed purchases settle in full to the right party (Priority: P2)

Most purchases never reach a dispute. They end in one of three ways: the buyer accepts,
the buyer stays silent until the review window lapses, or nothing is ever delivered and
the buyer takes their money back. Each must credit the full amount to exactly one
party, and that party must be able to actually receive it.

**Why this priority**: This is the volume path — the flow almost every purchase takes.
It is ranked below the refund levels only because a failure here is loud and immediate
rather than silent, but a suite that skipped it would prove nothing about the ordinary
case.

**Independent Test**: Run a purchase from registration through delivery to each of the
three undisputed endings, asserting after each that the correct party is owed the whole
amount, the other party is owed nothing, the amount held for live purchases has fallen
by exactly that amount, and the payout can then be taken out.

**Acceptance Scenarios**:

1. **Given** a registered, purchasable agent, **When** a purchase is opened for a
   buyer, **Then** the agent's price moves into holding, the purchase records the
   buyer, the seller, the amount, and the agent definition in force at that moment, and
   the total held rises by the price.
2. **Given** a delivered purchase, **When** the buyer accepts, **Then** the seller is
   owed the full amount, the buyer is owed nothing, and no funds have yet left the
   settlement layer.
3. **Given** a delivered purchase whose review window has lapsed, **When** an address
   unrelated to the purchase settles it, **Then** the seller is owed the full amount —
   the caller receives nothing and chooses nothing.
4. **Given** a purchase where nothing was delivered before the delivery deadline,
   **When** an unrelated address reclaims it, **Then** the buyer is owed the full
   amount.
5. **Given** a party owed a positive amount, **When** the payout is taken, **Then**
   exactly that amount reaches that party, their owed amount returns to zero, and a
   second attempt is rejected.
6. **Given** a seller who has sold through more than one agent, **When** both purchases
   settle, **Then** the amounts accumulate into a single claimable total.

---

### User Story 3 - Deadlines open and close on the correct side (Priority: P3)

Three clocks govern the settlement layer: the review window after delivery, the
delivery deadline after purchase, and the arbitration deadline after a complaint. Each
action they gate must be rejected on one side of its boundary and permitted on the
other, with no instant where a purchase is stuck between the two.

**Why this priority**: A clock that is off by one direction either lets a purchase
settle while the buyer still has the right to complain, or strands the funds
indefinitely. Both are serious, but neither is subtle in the way a wrong percentage is,
and both require the paths in Stories 1 and 2 to exist before they can be tested.

**Independent Test**: For each clock, advance time to just before and just after the
boundary and assert the gated action is rejected in the first case and succeeds in the
second.

**Acceptance Scenarios**:

1. **Given** a delivered purchase inside its review window, **When** anyone tries to
   settle it as lapsed, **Then** the attempt is rejected.
2. **Given** a delivered purchase whose review window has lapsed, **When** the buyer
   tries to complain, **Then** the attempt is rejected.
3. **Given** a delivered purchase at the exact instant the review window ends, **When**
   settlement and complaint are each attempted, **Then** exactly one of them is
   available — settlement succeeds and complaint is rejected.
4. **Given** an undelivered purchase before the delivery deadline, **When** anyone
   tries to reclaim it, **Then** the attempt is rejected; after the deadline the same
   attempt succeeds.
5. **Given** a disputed purchase before the arbitration deadline, **When** anyone tries
   to force-settle it, **Then** the attempt is rejected; after the deadline the same
   attempt succeeds.
6. **Given** a purchase whose review window is zero, **When** it is delivered, **Then**
   it is immediately settleable as lapsed and no longer open to complaint.

---

### User Story 4 - Only the intended party can act, and payouts reach the payee (Priority: P4)

The settlement layer separates three kinds of authority: the platform's backend drives
the lifecycle but can never move held funds; the arbitrator can only split an
already-disputed purchase between two addresses fixed at purchase time; and three
actions are open to anyone by design because each can only push a purchase past a
deadline that has already passed. Alongside this, a payout must always reach the party
owed, never the party who triggered it.

**Why this priority**: These boundaries are what make the platform unable to override
an outcome. They are ranked here because a violation requires a hostile or mistaken
caller to exploit, whereas Stories 1–3 can fail during entirely ordinary use.

**Independent Test**: For every restricted action, call it as a party that should not be
able to and assert rejection; for every deliberately open action, call it as a complete
stranger past the relevant deadline and assert success. Separately, trigger a payout on
someone else's behalf and assert the funds land with them.

**Acceptance Scenarios**:

1. **Given** an address holding no role, **When** it attempts to register an agent,
   change an agent, change an agent's availability, open a purchase, or mark a purchase
   delivered, **Then** every attempt is rejected.
2. **Given** the arbitrator's key, **When** it attempts any lifecycle action other than
   ruling on a dispute, **Then** the attempt is rejected.
3. **Given** the platform backend's key, **When** it attempts to rule on a dispute,
   **Then** the attempt is rejected.
4. **Given** an address that is neither the buyer nor the backend, **When** it attempts
   to accept or to complain about a delivered purchase, **Then** both attempts are
   rejected.
5. **Given** a stranger with no relationship to a purchase, **When** the relevant
   deadline has passed and they settle a lapsed purchase, reclaim an undelivered one,
   or force-settle a stalled dispute, **Then** each succeeds.
6. **Given** a seller who is owed money and holds no funds for transaction costs,
   **When** a third party triggers the payout on their behalf, **Then** the funds
   arrive at the seller and the third party receives nothing.
7. **Given** an address owed nothing, **When** a payout is triggered for it, **Then**
   the attempt is rejected.

---

### User Story 5 - A purchase cannot settle twice, and the funds always cover the claims (Priority: P5)

A settled purchase is final. No entry point may re-settle it, and no action may be
performed against a purchase in the wrong stage of its life. Underlying everything, the
funds actually held must at every moment be at least the sum of everything still held
for live purchases plus everything owed to individuals.

**Why this priority**: This is the backstop. A double settlement or a lost stage check
would show up as one of the failures in Stories 1–4 in most cases; these checks catch
the cases where it would not, and the funds-cover-claims check turns every other test
into a solvency test as well.

**Independent Test**: Settle a purchase by each available route, then attempt every
other route against it and assert each is rejected. Assert the funds-cover-claims
relation after every check in the suite that changes state.

**Acceptance Scenarios**:

1. **Given** a purchase settled by acceptance, **When** any other settlement route is
   attempted against it — lapsed settlement, reclaim, complaint, ruling, or
   force-settle — **Then** every attempt is rejected.
2. **Given** a purchase settled by reclaim, ruling, or force-settle, **When** the same
   sweep of attempts is made, **Then** every attempt is rejected.
3. **Given** a purchase that has not yet been delivered, **When** acceptance,
   complaint, or a ruling is attempted, **Then** each is rejected.
4. **Given** a purchase that has been delivered but not disputed, **When** a ruling or
   force-settle is attempted, **Then** each is rejected.
5. **Given** a purchase identifier that was never issued, **When** any action is
   attempted against it, **Then** the attempt is rejected rather than silently
   succeeding against an empty record.
6. **Given** any check in the suite that changes state, **When** it completes, **Then**
   the funds held are at least the total held for live purchases plus the total owed to
   individuals.
7. **Given** funds sent directly to the settlement layer by an unrelated party, **When**
   the relation above is evaluated, **Then** it still holds and no purchase's outcome
   changes.

---

### Edge Cases

- **Zero-share outcomes.** At the "no refund" and "full refund" ends, one party's share
  is zero. The suite must confirm that party's claimable amount is genuinely unchanged
  and that no empty payout is created for them.
- **Amounts that do not divide by four.** A quarter-based split of an odd amount must
  still sum to the original, with the remainder falling to the seller. Amounts used by
  the suite must include at least one such value rather than only round numbers.
- **Exact-boundary instants.** At the precise moment a window ends, exactly one of the
  two competing actions must be available — never both, never neither.
- **A zero-length review window.** Permitted by design; the suite records the resulting
  behaviour (immediately settleable, never disputable) as intended rather than as a
  defect.
- **A purchase opened while the platform has not authorised the transfer of funds.**
  The attempt must fail before any record is created.
- **An agent made unavailable mid-life.** Purchases already running must be unaffected;
  only new purchases are blocked.
- **An agent changed after a purchase.** The running purchase must still report the
  definition and version in force when it was opened, not the current one.
- **The same address acting as both buyer and seller across different purchases.**
  Amounts owed must accumulate into a single total for that address.
- **A payout attempted twice.** The second attempt must be rejected, not silently pay
  nothing.

## Requirements *(mandatory)*

### Functional Requirements

**Coverage of money movement**

- **FR-001**: The suite MUST assert the buyer's and seller's resulting shares
  explicitly and separately for each of the five refund levels — five distinct
  assertions, not a loop over a table that could share a wrong formula with the code
  under test.
- **FR-002**: The suite MUST cover both extreme refund levels, where one party's share
  is zero.
- **FR-003**: The suite MUST assert, for every dispute outcome exercised, that the two
  shares sum to the original amount exactly.
- **FR-004**: The suite MUST exercise at least one purchase amount that is not evenly
  divisible by four and assert the remainder falls to the seller.
- **FR-005**: The suite MUST cover all three undisputed endings — acceptance, lapse of
  the review window, and reclaim of an undelivered purchase — and assert the full
  amount is credited to exactly one party in each.
- **FR-006**: The suite MUST cover the force-settlement of a stalled dispute and assert
  it produces the quarter-refund outcome and carries no verdict reference.

**Coverage of time**

- **FR-007**: The suite MUST test each of the three deadlines on both sides of its
  boundary — rejected before, permitted after (or, for the complaint window, permitted
  before and rejected after).
- **FR-008**: The suite MUST assert that at the exact instant the review window ends,
  lapsed settlement is available and complaint is not.
- **FR-009**: The suite MUST control the passage of time deterministically, so no check
  depends on real elapsed time or on execution speed.

**Coverage of authority**

- **FR-010**: The suite MUST assert that every restricted action is rejected when
  called by an address without the required authority, including cross-role attempts
  (the arbitrator attempting lifecycle actions, the backend attempting to rule).
- **FR-011**: The suite MUST assert that each of the three deliberately open actions
  succeeds when called by an address with no relationship to the purchase and no role.
- **FR-012**: The suite MUST assert that a payout triggered by a third party delivers
  the funds to the party owed and nothing to the caller.
- **FR-013**: The suite MUST assert that both buyer-initiated actions are also
  available to the platform backend acting on the buyer's behalf, and rejected for
  everyone else.

**Coverage of state**

- **FR-014**: For each of the settlement routes, the suite MUST attempt every other
  settlement route against the already-settled purchase and assert rejection.
- **FR-015**: The suite MUST assert that every action which requires a particular stage
  is rejected when the purchase is in any other stage, including a purchase identifier
  that was never issued.
- **FR-016**: The suite MUST assert that a purchase carries the agent definition and
  version in force at the moment it was opened, unaffected by later changes to that
  agent.

**Solvency**

- **FR-017**: The suite MUST assert, after every check that changes state, that the
  funds held are at least the total held for live purchases plus the total owed to
  individuals. This assertion MUST be applied throughout rather than once at the end of
  the suite.
- **FR-018**: The suite MUST confirm the relation in FR-017 still holds after an
  unrelated party sends funds directly to the settlement layer, and that no purchase
  outcome changes as a result.

**Test infrastructure**

- **FR-019**: The suite MUST provide a stand-in settlement token used only for testing,
  behaving as an ordinary token with the same six-decimal precision as the production
  one, with freely mintable balances for test setup.
- **FR-020**: Each check MUST be independent of every other — no shared mutable state,
  no ordering dependency, no reliance on a previous check having run.
- **FR-021**: Every rejection assertion MUST assert on the specific reason given, so a
  check cannot pass because the action failed for an unrelated cause.
- **FR-022**: The suite MUST assert that the notifications emitted on settlement carry
  the correct purchase, parties, and amounts, since off-chain systems read outcomes from
  them rather than from stored state.

### Key Entities

- **Stand-in settlement token**: A test-only stand-in for the production settlement
  token. Ordinary behaviour, six-decimal precision, balances mintable at will for
  setup. Does not deduct on transfer, does not change balances on its own.
- **Test participants**: Named addresses for each role in the system — the
  administrator, the platform backend, the arbitrator, a buyer, a seller, a second
  seller, and at least one stranger holding no role and no relationship to any
  purchase.
- **Purchase fixture**: The common setup that brings a purchase to a given stage
  (registered agent → opened purchase → delivered → optionally disputed), so individual
  checks state only what is distinctive about them.
- **Solvency check**: The shared assertion that the funds held cover everything held
  for live purchases plus everything owed to individuals, invoked after every
  state-changing check.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: The complete suite runs and every check passes, with no skipped,
  disabled, or commented-out checks.
- **SC-002**: All five refund levels have an explicit, individually named check
  asserting both parties' resulting shares — a reader can find each of the five numbers
  in the suite without reading the settlement layer's code.
- **SC-003**: The solvency relation is asserted after 100% of state-changing checks.
- **SC-004**: Every restricted action has at least one check proving it is rejected for
  an unauthorised caller, and each of the three deliberately open actions has at least
  one check proving it succeeds for a stranger.
- **SC-005**: All three deadlines are verified on both sides of their boundary — six
  boundary checks minimum.
- **SC-006**: A payout triggered by a third party is proven to pay the party owed; the
  suite would fail if that payout were redirected to the caller.
- **SC-007**: Each of the settlement routes is proven unable to act on an
  already-settled purchase, from every other settlement entry point.
- **SC-008**: The suite completes in under 60 seconds on a developer machine, so it can
  be run before every change without friction.
- **SC-009**: Running the suite twice in a row, and running any single check in
  isolation, produces identical results.
- **SC-010**: Introducing a deliberate one-percentage-point error into any refund level
  causes at least one check to fail — the suite's sensitivity to the highest-risk defect
  is demonstrable.

## Assumptions

- **The settlement layer from SC-01 is the subject and is not modified by this work.**
  If a check reveals a defect, fixing it is a change to that component, not to this one.
- **The stand-in token is a plain, well-behaved token.** No transfer fees, no rebasing,
  no callbacks into the caller. Hostile-token behaviour is out of scope because the
  production settlement token is a fixed, known contract chosen at deployment.
- **Time is controlled by the test environment.** The environment can advance the clock
  to arbitrary points, which is what makes deadline checks deterministic rather than
  slow.
- **Randomised input generation, exhaustive property campaigns, cost benchmarking, and
  formal verification are out of scope**, per the source specification. Coverage here is
  by enumerated case.
- **Amounts are expressed in the token's base units**, with six decimals matching the
  production settlement token, and at least one amount is chosen so quarter-based splits
  do not divide evenly.
- **This is the only automated suite in the project.** Automated verification was
  deliberately cut from the other components; no coverage of the backend or the
  interface is expected or implied here.
- **The platform backend authorises the movement of its funds before the first
  purchase.** The suite performs that authorisation in setup and additionally covers the
  case where it is missing.
- **"Reviewer can find each of the five numbers"** (SC-002) is satisfied by check names
  and assertions that state the level and both resulting shares, not by comments.
