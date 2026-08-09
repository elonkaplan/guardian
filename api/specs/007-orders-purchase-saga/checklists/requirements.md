# Specification Quality Checklist: Orders & the Purchase Saga

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-08-09
**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] No implementation details (languages, frameworks, APIs)
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders
- [x] All mandatory sections completed

## Requirement Completeness

- [x] No [NEEDS CLARIFICATION] markers remain
- [x] Requirements are testable and unambiguous
- [x] Success criteria are measurable
- [x] Success criteria are technology-agnostic (no implementation details)
- [x] All acceptance scenarios are defined
- [x] Edge cases are identified
- [x] Scope is clearly bounded
- [x] Dependencies and assumptions identified

## Feature Readiness

- [x] All functional requirements have clear acceptance criteria
- [x] User scenarios cover primary flows
- [x] Feature meets measurable outcomes defined in Success Criteria
- [x] No implementation details leak into specification

## Notes

**Iteration 2 — all items pass.** 5 user stories, 52 functional requirements,
14 success criteria.

**The one clarification raised, and its answer.** Iteration 1 held a single open
question: whether a buyer can complain about an order whose agent produced nothing.
The source documents contradicted each other — the product workflow makes that the
demo's closing act and puts a Complain action on the failed order screen, while the
escrow contract refuses a dispute against a deal never marked delivered and maps a
failed order to a reclaim backstop with no dispute path at all.

Resolved in favour of the product: the complaint records the concluded delivery
attempt and opens the dispute as one action, so non-delivery ends in a verdict rather
than a timeout. Captured in FR-029, FR-034, and FR-035, in User Story 3 scenarios 9–11,
and in the Assumptions. FR-035 is the constraint that makes the choice safe — a
crashed deal must not be marked as concluded at any other moment, because release is
permissionless and a deal sitting deliverable through a whole review window could be
released to a seller who delivered nothing.

**Two places the spec states storage-level guarantees**, both deliberate: the
indivisible order-and-debit write (FR-007, FR-008) and one-complaint-per-order
enforced in storage (FR-031). Both are the substance of the requirement rather than an
implementation choice — a double-spend window and a re-filed complaint are the defects
being specified against, and a requirement that permitted them to be checked in a way
that can be bypassed would not be testable.

**Amended during planning (2026-08-09).** `/speckit-plan` found that FR-017's phrase
"fails or does not confirm" collapsed two different events. A chain call known to have
failed escrowed nothing, so compensating restores the buyer completely; a call whose receipt
never arrived may still confirm, and compensating it would restore a balance whose money is
simultaneously locked on-chain — breaking solvency in the direction no later entry can fix.
FR-017 and FR-021 were narrowed, **FR-017a** was added for the unknown branch, and US2
gained two scenarios. See [research.md](../research.md) R3. SC-002 stands: a *forced* failure
is a knowable one.

**Not in this feature**, and stated in the Assumptions so the boundary is explicit:
the verdict read, running the agent, the audit itself, and every background job
including automatic release, reclaim, and reaping.
