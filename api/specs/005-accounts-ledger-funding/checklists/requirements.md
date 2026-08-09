# Specification Quality Checklist: Accounts, Ledger & Funding

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

- Items marked incomplete require spec updates before `/speckit-clarify` or `/speckit-plan`

### Validation notes (iteration 1)

- **Endpoint paths and field names deliberately omitted from the spec body.** The spec
  expresses the constraint behaviourally — "named consistently with the other two ...
  because the consuming interface reads the name literally" (FR-008). That is the right
  altitude for a spec, but a constraint without the string does not prevent the bug it
  names: `RawCitation.clause` carried a perfectly good rule and still shipped wrong,
  because nobody wrote `quote` where the implementer would type it (`67dcf4d`).
  **The plan's contract MUST therefore carry these three literal strings, verbatim:**

  | Field | Unit | Source | Nullable |
  | --- | --- | --- | --- |
  | `availableBalanceMinor` | cents | Postgres — `SUM(amount_minor)` | no |
  | `inEscrowMinor` | cents | Postgres — open orders | no |
  | `settledFundsMinor` | cents | chain — `balances(address)` | **yes** |

  Endpoints, likewise verbatim: `GET /me`, `GET /me/ledger`, `POST /topup`,
  `POST /withdraw`, `POST /offramp`, `POST /onramp/routes`, `POST /offramp/routes`.
- **Six user stories, all independently testable.** P1 (summary) delivers value alone as an
  honest, always-available account picture; P2 (top-up) is verifiable purely by comparing
  three balances before and after; each of P3–P6 is demonstrable without the others.
- **No open clarifications.** Nine judgement calls that the source left implicit — chain-read
  deadline, operation ordering for top-up versus cash-out, stub status code, whole-number
  amounts, session requirement on the stubs — are recorded as explicit entries in
  Assumptions rather than as markers.
- **One deliberate near-technical phrase retained**: "written to the logs at warning level"
  (FR-031, US6). The source treats the log level as a product requirement — the payload has
  to be readable off the console during the demo — so it is stated rather than abstracted.

### Validation notes (iteration 2 — source docs revised after first draft)

- **Write ordering restated as the general rule.** `api/docs/CONTEXT.md` invariant #1 and
  `docs/database-schema.md` §3.3 now both tabulate all three flows: the solvency
  relationship is `>=`, so whichever write increases what the platform owes goes second.
  The first draft framed adding funds as an exception to a "records first" default; it is
  instead the one flow in this feature whose ledger side *increases*. FR-019 and the
  Assumptions entry now carry the direction rule, with "records first" named as its
  consequence rather than as the rule.
- **The closing demo act is back in scope and ends in a full refund**, which lands in
  settled funds and leaves the spendable figure flat (`docs/database-schema.md` §3.3).
  Added to US1's rationale and as an edge case: this is the scenario where a correct
  system most resembles a broken one, and the whole argument for the third figure.
- **Stub status code settled at 200 with an honest body.** 501 would satisfy both readings
  of "never fake a 200" but was judged not worth a revision; nothing consumes these
  endpoints. Assumptions entry unchanged.
