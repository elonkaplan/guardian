# Specification Quality Checklist: Cron jobs — the three timers that make the deadlines fire

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

Validation notes from the first pass:

- **Implementation names removed by design.** The source brief names the scheduling
  library and the exact chain functions; the spec describes the behaviour instead
  ("tells the escrow to pay the seller") so the acceptance criteria survive a change
  of either.
- **One scope decision was resolved rather than left open.** The source brief's
  in-scope table lists three jobs, but two other authoritative documents assign the
  reconciliation of purchases still awaiting escrow confirmation to this feature.
  FR-030 takes the minimal reading — make the order visible, change nothing — which
  is recorded here because it is the one place this spec extends its brief.
  **Confirmed with the author (2026-08-09): visibility only.** A full reconciler that
  scans the chain for the deal the transaction produced was considered and rejected
  as Medium-sized work this feature does not need; reconciliation stays manual.
- **Two derived decisions are load-bearing** and are written up in Assumptions rather
  than buried: the resting state of a reclaimed order, and the reclaimer covering
  failed orders. Both follow from the escrowed-money figure double-counting if they
  went the other way.
- **SC-008 is deliberately qualitative** ("a handful of seconds, not a wait"). The
  underlying number is a deployment setting, so pinning a figure here would be
  specifying configuration rather than an outcome.
