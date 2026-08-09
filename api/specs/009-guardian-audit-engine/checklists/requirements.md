# Specification Quality Checklist: Guardian audit engine

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

Validation run 1 found and fixed:

- **Vendor and product names in requirements.** The initial draft named the auditor
  model and the escrow's on-chain function directly. Rewritten as "the auditor" and
  "instruct the escrow" — the model identity is an assumption and a recorded field
  (FR-016), not a requirement.
- **Success criteria carried latency in technical terms.** Restated as "the ruling is
  readable within one minute of the complaint being filed" (SC-003).
- **Two settlement outcomes were conflated.** A failed instruction and an
  indeterminate one now have separate treatment (FR-023, US5 scenario 3).
- **Citation traceability was implied, not required.** Added FR-012 — an untraceable
  quote fails the audit — because "citations are the credibility" is only enforceable
  if a fabricated quote is rejected.

Deliberate divergence from the source spec, recorded in Assumptions and flagged for
confirmation: the source asks the serialiser to **summarise** buyer-facing reasoning
text; the already-built serialiser **omits** it entirely and composes descriptions from
platform-authored fields. The spec requires the stronger existing behaviour (FR-036).

**Amended during `/speckit-plan` (2026-08-09):** FR-006 was reversed. It required the raw
run trace to be given to the auditor; planning found that the auditor's reasoning ships to
the buyer verbatim, so seller-authored step reasoning would reach the buyer through the
auditor. FR-006 now requires the redacted step view. This is the same argument as the
FR-036 divergence above, applied one layer up — which is why both land in the same
direction. See `plan.md` amendment 1 and `research.md` R6.

Items marked incomplete require spec updates before `/speckit-clarify` or `/speckit-plan`.
