# Specification Quality Checklist: Catalogue & the Serialisation Boundary

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

- **Iteration 1 findings, resolved.** Two acceptance scenarios asserted a property by
  inspecting source ("when the code is inspected, there is exactly one path"). Both
  were rewritten as observable outcomes — a marker string that must appear in no
  buyer-facing response (US2 #7), and route addresses that differ (US5 #5). The
  structural intent survives; the verification no longer requires reading code.
- **Deliberately retained**: the requirement that the buyer-facing shape come from a
  single place (FR-001, FR-002) and that public and owner views be separate addresses
  (FR-027). These read as design constraints, but they are the feature's actual
  subject — the source spec's stated deliverable is a boundary that holds by
  construction rather than by five endpoints each remembering. Stating only the
  outcome ("no response leaks the prompt") would specify a property nobody owns.
- **No [NEEDS CLARIFICATION] markers were raised.** Two candidates existed — whether
  an unavailable agent is not-found or forbidden to the public, and the exact
  canonical serialisation rule. Both had a defensible default derivable from the
  project's own documentation and are recorded as assumptions instead. The
  canonicalisation rule in particular is a planning decision; what this spec fixes is
  that it must be pinned and reproducible outside the running system.
- **Iteration 2 — the source spec changed under the spec.** `API-06-catalogue.md`
  was revised to state that `POST /agents` awaits the registration receipt and
  returns with the on-chain identifier set, and that a missing identifier is a
  **crash state** rather than an async contract. The first draft had guessed the
  opposite: an assumption describing it as "submitted, not yet confirmed", kept
  queryable for retry. That guess was wrong in a way that mattered — it would have
  left an unbuyable agent sitting in the public catalogue, failing at purchase time
  on a buyer's screen. Reworked across the spec: the listing is synchronous
  (FR-012→015), public views filter on the identifier's presence (FR-021, FR-022),
  the owner's list is the sole place such an agent is visible (FR-026), and SC-002
  and SC-003 now measure both halves. The old assumption is replaced rather than
  amended.
- **Testability note carried from the component context**: automated tests of every
  kind are out of scope here, so every criterion above is verified by hand during
  demo rehearsal. That does not weaken the requirements, but it does mean each
  acceptance scenario had to be phrased as something a person can actually perform.
