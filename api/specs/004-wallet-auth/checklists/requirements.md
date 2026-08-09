# Specification Quality Checklist: Wallet Auth

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-08-08
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

- **Verification is manual.** Per `docs/CONTEXT.md`, automated tests are out of scope for `api/`. Every acceptance scenario in the spec is a hand-check, and the demo rehearsal is the regression suite. This is a deliberate project decision, not a gap in the spec.
- **Zero clarification markers.** Every gap in the source brief had a defensible default (challenge lifetime, credential lifetime, challenge-supersession behaviour, signed-message format, challenge durability). All five are recorded in Assumptions rather than deferred to `/speckit-clarify`.
- **Deliberately technology-agnostic vocabulary.** The source brief names the concrete mechanisms; the spec says "challenge", "session credential", and "canonical checksummed address" so the requirements stay verifiable independently of how they are built. Reviewers reading the brief alongside this spec should expect that substitution.
- **Out of scope, restated from the brief**: passwords, email, roles, refresh tokens, sign-out/revocation, rate limiting, and any Rain provisioning. FR-018 and FR-020 make the role and credential exclusions testable rather than leaving them as prose.
- **Depends on API-02** for the account record and its case-insensitive uniqueness guarantee.

## Revisions after planning

- **FR-016 was reversed during `/speckit-plan` (2026-08-08).** It originally read
  "endpoints MUST be public unless explicitly marked as protected". It now requires the
  opposite default: protected unless explicitly marked public. US2 scenario 6 was
  reworded to match. The trigger was a comment already in the codebase —
  `src/health/health.controller.ts` warns that the health check "must stay unauthenticated
  once auth lands", which is a warning that only makes sense if a global guard is
  expected. Full argument in [research.md R8](../research.md); the deviation is also
  recorded in [plan.md](../plan.md) under Complexity Tracking.
