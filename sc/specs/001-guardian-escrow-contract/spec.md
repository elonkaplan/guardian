# Feature Specification: Guardian Escrow Contract

**Feature Branch**: `001-guardian-escrow-contract`

**Created**: 2026-08-08

**Status**: Draft

**Input**: User description: "docs/specs/SC-01-escrow-contract.md — Build `GuardianEscrow`, the settlement layer that holds a buyer's payment until the buyer accepts, the review window expires, or Guardian rules on a dispute — then splits the money accordingly."

## Overview

Guardian is a marketplace where buyers purchase work from AI agents. Money for each
purchase is held by an independent settlement layer rather than by the platform, so
that neither the platform nor the arbitrator can redirect, withhold, or double-spend
it. A purchase resolves in exactly one of four ways: the buyer accepts, the buyer
stays silent until the review window lapses, nothing is ever delivered and the buyer
takes their money back, or the buyer complains and an arbitrator (Guardian) rules on
a five-step refund scale.

The value of this feature is not that money moves — it is that **the outcome cannot be
overridden by the party that operates the marketplace**. A verdict is executed, not
recommended.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Buyer pays, seller gets paid (Priority: P1)

A buyer purchases an agent's work. The payment is captured into escrow at purchase
time and is untouchable by anyone. The agent delivers, a review window starts, and
when the buyer either accepts or lets the window lapse, the full amount becomes
withdrawable by the seller.

**Why this priority**: This is the happy path and the minimum viable product. Without
it there is no marketplace at all. Everything else is a deviation from this flow.

**Independent Test**: Register an agent, open a deal against it, mark it delivered,
then settle it both ways (buyer accepts early; and the window lapses and a third
party settles it). In both cases the seller's withdrawable balance equals the full
purchase amount and the seller can take the money out.

**Acceptance Scenarios**:

1. **Given** an active agent priced at 2,000,000 base units, **When** the operator
   opens a deal for a buyer, **Then** 2,000,000 units move from the operator into
   escrow, the deal is recorded as `Open`, and the total held in escrow rises by
   2,000,000.
2. **Given** a deal in `Open`, **When** the operator marks it delivered, **Then** the
   deal becomes `Delivered` and the review window starts from that moment.
3. **Given** a `Delivered` deal, **When** the buyer accepts, **Then** the deal becomes
   `Settled`, the seller's withdrawable balance rises by the full amount, the total
   held in escrow falls by the full amount, and no tokens leave the contract.
4. **Given** a `Delivered` deal whose review window has expired, **When** *any*
   address settles it, **Then** the seller is credited the full amount — the caller
   gains nothing and chooses nothing.
5. **Given** a `Delivered` deal whose review window has **not** expired, **When**
   anyone tries to settle it, **Then** the call is rejected.
6. **Given** a seller with a positive withdrawable balance, **When** the withdrawal is
   triggered — by the seller or by the operator on the seller's behalf — **Then** the
   tokens are transferred **to the seller**, and the balance is zeroed before the
   transfer.

---

### User Story 2 - Buyer complains and Guardian rules (Priority: P1)

The delivered work falls short. Within the review window the buyer complains, which
freezes the deal — no value moves, the automatic release simply stops being possible.
Guardian reviews the evidence off-chain and rules by selecting one of five refund
tiers. The settlement layer computes the split from the tier and credits both sides.

**Why this priority**: This is Guardian's entire reason to exist and the centrepiece
of the demo. It is P1 alongside Story 1 because a marketplace with no recourse is a
different product.

**Independent Test**: Open and deliver a deal, complain within the window, then have
Guardian rule at each of the five tiers on separate deals. Verify the buyer/seller
split for each tier and that the two credited amounts always sum to exactly the
escrowed amount.

**Acceptance Scenarios**:

1. **Given** a `Delivered` deal inside its review window, **When** the buyer complains,
   **Then** the deal becomes `Disputed`, the complaint time is recorded, and no
   balance changes.
2. **Given** a `Delivered` deal whose review window has already closed, **When** the
   buyer tries to complain, **Then** the call is rejected — complaint and release
   windows close at exactly the same moment.
3. **Given** a `Disputed` deal of 2,000,000 units, **When** Guardian rules at the 50%
   tier, **Then** the buyer is credited 1,000,000, the seller is credited 1,000,000,
   the deal becomes `Settled`, and the ruling reference is recorded in the emitted
   event.
4. **Given** a `Disputed` deal, **When** Guardian rules at 0% (complaint rejected),
   **Then** the seller is credited the full amount and the buyer is credited nothing.
5. **Given** a `Disputed` deal, **When** Guardian rules at 100%, **Then** the buyer is
   credited the full amount and the seller nothing.
6. **Given** any tier and any amount, **Then** the two credited amounts sum to exactly
   the escrowed amount — no dust is created or lost.
7. **Given** a `Disputed` deal, **When** anyone other than Guardian attempts to rule,
   **Then** the call is rejected.
8. **Given** an `Open`, `Delivered`, or already-`Settled` deal, **When** Guardian
   attempts to rule on it, **Then** the call is rejected — only a disputed deal can be
   ruled on.

---

### User Story 3 - Nobody can be stranded by a silent platform (Priority: P1)

Every state a deal can be in has an exit that does not depend on the platform's
cooperation. If nothing is ever delivered, the buyer takes 100% back after the
delivery deadline. If the review window lapses, the seller is paid. If Guardian never
rules, the dispute force-settles at the 25% tier after the dispute deadline. Each of
these can be triggered by anyone, because each can only push a deal past a deadline
that has already passed, into the outcome the rules already dictate.

**Why this priority**: This is the line between escrow and custody. A settlement layer
only the operator can advance is not escrow — it is the platform holding the money
with extra steps. It is P1 because it is the property the product's central claim
rests on.

**Independent Test**: For each of the three timed exits, advance time past the
deadline and trigger the exit from an address holding no role whatsoever. Verify the
funds land with the party the rules dictate.

**Acceptance Scenarios**:

1. **Given** an `Open` deal past the 24-hour delivery deadline, **When** any address
   reclaims it, **Then** the buyer is credited the full amount and the deal becomes
   `Settled`.
2. **Given** an `Open` deal **before** the delivery deadline, **When** anyone tries to
   reclaim it, **Then** the call is rejected.
3. **Given** a `Disputed` deal past the 72-hour dispute deadline, **When** any address
   force-settles it, **Then** the deal settles at the 25% tier — 25% to the buyer, 75%
   to the seller — with an empty ruling reference.
4. **Given** a `Disputed` deal **before** the dispute deadline, **When** anyone tries
   to force-settle it, **Then** the call is rejected.
5. **Given** a `Delivered` deal whose review window has expired, **When** an address
   with no role settles it, **Then** the seller is credited — the seller never depends
   on the platform to be paid.

---

### User Story 4 - Operator manages the agent registry (Priority: P2)

The platform registers each seller's agent with a payout address, a price, and a hash
committing to the agent's definition. Prices and definitions can be updated (which
bumps a version), and an agent can be delisted so no *new* purchases are possible
without affecting deals already running.

**Why this priority**: Required before any deal can be opened, but it is
straightforward bookkeeping with no money at stake — the risk lives in Stories 1–3.

**Independent Test**: Register an agent, update its price and definition hash, verify
the version increments and that a deal opened before the update still carries the old
pinned values, then delist it and verify new purchases are rejected.

**Acceptance Scenarios**:

1. **Given** the operator registers an agent with a valid payout address, **When** the
   registration succeeds, **Then** the agent is assigned the next id, version 1, and
   is active.
2. **Given** a zero payout address, **When** registration is attempted, **Then** it is
   rejected.
3. **Given** an existing agent, **When** the operator updates its price and definition
   hash, **Then** both change and the version increments by one.
4. **Given** a deal opened *before* an update, **Then** that deal still carries the
   definition hash, version, price, and payout address in force at purchase time.
5. **Given** an inactive agent, **When** a deal is opened against it, **Then** the call
   is rejected; deals already running against that agent are unaffected.
6. **Given** an unknown agent id, **When** update or delist is attempted, **Then** the
   call is rejected.
7. **Given** any non-operator address, **When** it attempts registry changes, opening a
   deal, marking delivery, or complaining on a buyer's behalf, **Then** the call is
   rejected.

---

### Edge Cases

- **Double settlement.** Every settlement path marks the deal terminal *before*
  crediting, and every entry point requires a specific prior state — so a deal cannot
  be paid twice, and a settled deal cannot be reopened by any caller in any role.
- **Ownership transferred mid-deal.** The payout address is snapshotted at purchase.
  Changing the agent's owner afterwards does not redirect money for work the previous
  owner performed.
- **Definition softened after a bad delivery.** The definition hash and version are
  pinned on the deal at purchase, so a dispute is judged against the version that
  actually ran.
- **Withdrawal driven by the operator.** A withdrawal triggered by the operator on
  someone's behalf must pay *that account*, never the caller. A caller-pays-caller
  withdrawal would send every operator-driven payout to the operator.
- **Withdrawal with nothing to withdraw.** Rejected.
- **Unknown deal or agent id.** Ids start at 1, so id `0` and any unassigned id return
  a zero-filled record whose state reads as "does not exist" — every entry point
  rejects it via its state precondition.
- **Tokens sent directly to the contract.** They raise the contract's token balance
  with no matching claim and are simply stranded — harmless, but it means solvency is
  a `>=` property, not an equality.
- **Complaint arriving at the exact moment the window closes.** The window is
  inclusive for release and exclusive for complaint: at `deliveredAt + reviewWindow`
  release becomes possible and complaint is no longer possible. There is no instant
  where both or neither are available.

**Accepted risks — deliberately not handled in this MVP** (see Assumptions):
unbounded review window (including `0`), price not pinned against a mid-purchase
update, fee-on-transfer or rebasing tokens, acceptance not being window-gated, and the
absence of an emergency pause.

## Requirements *(mandatory)*

### Functional Requirements

**Escrow and settlement**

- **FR-001**: The system MUST capture the full purchase amount into escrow at the
  moment a deal is opened, pulled from the party opening the deal.
- **FR-002**: The system MUST keep escrowed value untouchable — no participant in any
  role may move it to an address not already recorded on the deal.
- **FR-003**: Settlement MUST move no tokens. Every settlement path MUST only convert
  an escrowed amount into one or two withdrawable balance entries.
- **FR-004**: The system MUST expose exactly one path by which tokens leave, and that
  path MUST zero the balance before transferring.
- **FR-005**: A withdrawal MUST be triggerable both by the balance holder and by any
  other party on the holder's behalf, and in both cases MUST pay **the holder**.
- **FR-006**: The system MUST maintain a running total of all live (unsettled)
  escrowed value, incremented on every purchase and decremented on every one of the
  four settlement paths.
- **FR-007**: The contract's token balance MUST at all times be greater than or equal
  to the live escrow total plus the sum of all withdrawable balances.

**Deal lifecycle**

- **FR-008**: Every deal MUST occupy exactly one of five states: does-not-exist, open,
  delivered, disputed, settled.
- **FR-009**: Settled MUST be terminal — reachable from four paths (accept, lapse,
  ruling, reclaim) and never left.
- **FR-010**: The system MUST record, at purchase time and immutably for the life of
  the deal: the agent purchased, the buyer (refund recipient), the seller (payout
  recipient), the amount, the agent definition hash, the definition version, the
  purchase timestamp, and the review window length.
- **FR-011**: The review window MUST be per-deal, supplied at purchase, not a global
  constant.
- **FR-012**: Marking a deal delivered MUST start the review window from that moment.
- **FR-013**: The buyer MUST be able to accept a delivered deal at any time while it
  is delivered, crediting the seller the full amount.
- **FR-014**: Once the review window has expired, **anyone** MUST be able to settle a
  delivered deal in the seller's favour for the full amount.
- **FR-015**: Once 24 hours have passed since purchase with no delivery, **anyone**
  MUST be able to return the full amount to the buyer.

**Dispute and arbitration**

- **FR-016**: The buyer MUST be able to complain only while the deal is delivered and
  the review window is still open; complaining MUST freeze the deal and move no value.
- **FR-017**: Guardian MUST be able to rule **only** on a disputed deal, and MUST
  select one of exactly five refund tiers: 0%, 25%, 50%, 75%, 100%.
- **FR-018**: Guardian MUST NOT be able to supply an amount, a percentage outside the
  five tiers, or a recipient address. The system MUST compute the split itself from
  the tier and the addresses fixed at purchase.
- **FR-019**: The refund to the buyer and the payout to the seller MUST sum to exactly
  the escrowed amount for every tier and every amount.
- **FR-020**: A ruling MUST record a reference to the off-chain verdict, so the verdict
  text is tamper-evident.
- **FR-021**: Once 72 hours have passed since a complaint with no ruling, **anyone**
  MUST be able to force-settle the deal at the 25% tier with an empty verdict
  reference.

**Registry and access control**

- **FR-022**: The operator MUST be able to register an agent with a payout address, a
  price, and a definition hash; registration MUST reject a zero payout address and MUST
  assign version 1 and active status.
- **FR-023**: The operator MUST be able to update an agent's price and definition hash,
  which MUST increment its version and MUST NOT affect deals already open.
- **FR-024**: The operator MUST be able to activate or deactivate an agent, affecting
  only whether **new** deals may be opened.
- **FR-025**: The system MUST enforce three distinct authority levels: an admin that
  can only grant and revoke the other two roles and can never touch funds or deals; an
  operator that can manage the registry, open deals, mark delivery, and act on a
  buyer's behalf but can never move escrowed funds; and an arbitrator that can only
  split an already-disputed deal between the two addresses fixed at purchase.
- **FR-026**: Settling after a deadline (lapsed review window, delivery deadline,
  dispute deadline) and triggering a withdrawal MUST be permissionless.
- **FR-027**: Agent ids and deal ids MUST start at 1, so that `0` unambiguously means
  "not found".
- **FR-028**: The settlement token MUST be fixed at deployment and MUST NOT be
  changeable afterwards.

**Observability**

- **FR-029**: Every state change MUST emit an event carrying enough detail to
  reconstruct the deal's history off-chain: agent registered, agent updated, deal
  opened, delivered, released, disputed, resolved (tier, both amounts, verdict
  reference), reclaimed, and withdrawn.

**Build**

- **FR-030**: The contract MUST compile cleanly under the toolchain and compiler
  version pinned for the target chain, with optimization enabled.

### Key Entities

- **Agent** — a listed, purchasable service. Carries the seller's payout address (set
  once), a price in the settlement token's base units, a hash committing to the agent's
  definition, a version number that starts at 1 and increments on every update, and an
  active flag gating new purchases only. The definition itself lives off-chain; only
  the commitment is recorded here.
- **Deal** — one purchase. Carries the agent purchased, the buyer (refund recipient),
  a **snapshot** of the seller's payout address, the escrowed amount, the **pinned**
  definition hash and version, the purchase / delivery / complaint timestamps, the
  review window length, and the current state.
- **Balance ledger** — withdrawable funds per address. A single ledger keyed by
  address, so a seller owning several agents accumulates into one balance, and an
  address that both buys and sells uses the same entry.
- **Tier** — the five permitted verdicts (0 / 25 / 50 / 75 / 100 percent refund).
  25% doubles as the inconclusive-evidence default and therefore as the force-settle
  outcome.
- **Deal state** — does-not-exist / open / delivered / disputed / settled.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: All four settlement paths — accept, lapse, ruling, reclaim — end with the
  deal terminal and the correct parties credited, in 100% of cases.
- **SC-002**: For all five tiers, the refund plus the payout equals the escrowed amount
  exactly, with zero rounding loss, at every price used in the demo and at boundary
  amounts.
- **SC-003**: An address holding no role can, after the relevant deadline, complete
  each of the three timed exits — a seller can be paid, a buyer can be refunded, and a
  dispute can be closed, all without the platform's cooperation. 3 of 3.
- **SC-004**: No sequence of calls by any single role — admin, operator, or arbitrator
  — can move escrowed value to an address not recorded on the deal, settle a deal
  twice, or produce a split outside the five tiers. 0 successful attempts.
- **SC-005**: The contract's token holdings never fall below the live escrow total plus
  all withdrawable balances, across every path exercised.
- **SC-006**: Every function's caller restriction matches the documented access-control
  table — 13 of 13 entry points.
- **SC-007**: The contract builds cleanly on the target toolchain with zero errors.
- **SC-008**: A complete purchase-to-payout cycle with a short review window can be
  driven end to end without any manual intervention beyond the scheduled prompts, so
  a live demo can show escrow, dispute, and split settlement in one sitting.

## Assumptions

- **Settlement is in a standard 6-decimal test stablecoin on a test network.** All
  prices and amounts are in the token's base units — never dollars, never floats.
  Conversion happens once, off-chain, at the boundary. No real funds are involved.
- **The platform opens deals and funds them.** The buyer pays by card off-chain; the
  platform performs the fiat conversion and therefore holds the tokens at purchase
  time. This leg is unavoidably trusted; the guarantees begin once value is inside the
  contract. The buyer's wallet is the destination for refunds, never the source of
  payment.
- **Buyers and sellers each have one wallet address**, connected at registration,
  serving as both identity and payout destination. The platform never holds a private
  key on anyone's behalf.
- **Something outside this contract must trigger the timed exits.** A contract cannot
  act on its own; a scheduled sweeper calls the lapsed-window settlement. Because that
  path is permissionless, the sweeper is a convenience, not a trust dependency.
- **Timestamps are approximate** (validators have seconds of latitude). Irrelevant for
  24- and 72-hour windows; review windows below ~30 seconds are not reliable.
- **Deliberately excluded from this feature**: upgradeability, emergency pause, fees,
  reputation, appeals, agent spend limits (those live in the card-issuing integration),
  validation of the review window's bounds, and anything about agent definitions beyond
  storing the hash.
- **Accepted MVP risks** (documented as decisions, not oversights): an unbounded review
  window — including `0`, which is guarded in the backend rather than on-chain; a price
  not pinned against an update landing inside the purchase window; fee-on-transfer or
  rebasing tokens breaking the solvency property; and acceptance not being
  window-gated, which is harmless because accepting only ever does what the lapse
  would have done.

## Dependencies

- A settlement token contract on the target network, and a wallet holding a supply of
  it plus an approval to this contract before any deal can open.
- A standard, audited role-based access-control implementation and a safe token-transfer
  wrapper.
- The off-chain systems that supply the definition hash, the verdict reference, and the
  scheduled trigger for lapsed windows. Those are separate features; this one defines
  only what it stores and enforces.
