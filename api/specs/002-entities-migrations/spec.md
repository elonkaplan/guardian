# Feature Specification: Entities & Initial Migration

**Feature Branch**: `002-entities-migrations`

**Created**: 2026-08-08

**Status**: Draft

**Input**: User description: "docs/specs/API-02-entities-migrations.md — The eight tables, as typed data models plus a hand-written initial migration. Enums, indexes, the lowercased-address unique index, and a balance helper computed by summation."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A cold database becomes the full schema in one step (Priority: P1)

Someone starts the stack against an empty database and, without any manual SQL, ends up with every table, enum, index, and constraint the platform needs — created by a single reviewable migration artifact.

**Why this priority**: Nothing else in the backend can be built or demonstrated until the schema exists. It is also the one piece that every later feature reads from and writes to, so getting it wrong is expensive to correct once data exists. On its own it delivers a database that later work can be developed against.

**Independent Test**: Destroy the database entirely, run the migration step, and inspect the result: eight tables, three enum types, every documented index, and every constraint present.

**Acceptance Scenarios**:

1. **Given** a database with no tables, **When** the migration step runs, **Then** it completes successfully and creates all eight tables, all three enum types, and every documented index.
2. **Given** the migration has already been applied, **When** the migration step runs again, **Then** it completes successfully and changes nothing.
3. **Given** the migration has been applied, **When** the revert command runs, **Then** every object the migration created is removed and the database returns to its previous state.
4. **Given** a freshly built schema, **When** a row is inserted into any table without supplying an identifier or creation timestamp, **Then** the database generates both.

---

### User Story 2 - The database refuses to break the product's rules (Priority: P2)

The rules that must never be violated — one complaint per order, one verdict per order, one execution per purchase, one account per wallet regardless of letter casing — are enforced by the database itself, so no amount of application-layer forgetfulness can produce a violating row.

**Why this priority**: Each of these is a product rule with money attached: a second complaint means re-litigating a settled dispute, a second verdict means an appeal the product does not offer, a second execution destroys the non-delivery evidence. Enforcing them in one place beats trusting every future code path to remember. Independently valuable and independently testable the moment the schema exists.

**Independent Test**: For each rule, insert a valid row, then attempt a duplicate, and confirm the database rejects the second one.

**Acceptance Scenarios**:

1. **Given** an order with a complaint, **When** a second complaint for the same order is inserted, **Then** the database rejects it.
2. **Given** an order with a verdict, **When** a second verdict for the same order is inserted, **Then** the database rejects it.
3. **Given** an order with an execution record, **When** a second execution record for the same order is inserted, **Then** the database rejects it.
4. **Given** an account registered with a wallet address, **When** a second account is inserted with the same address in different letter casing, **Then** the database rejects it.
5. **Given** the catalogue, **When** a second entry with the same agent and version number is inserted, **Then** the database rejects it.
6. **Given** a listed price or purchase amount of zero or less, **When** the row is inserted, **Then** the database rejects it.
7. **Given** a record that references an account, agent version, or order that does not exist, **When** it is inserted, **Then** the database rejects it.

---

### User Story 3 - Every stored definition is pinned and immutable (Priority: P3)

A purchase records the exact agent definition that will run, not the agent in general — so a seller editing their listing after a sale cannot change what the sale was for, and a dispute is judged against the definition that actually ran.

**Why this priority**: This is the structural property that makes the whole arbitration story credible. It costs nothing to get right now and is nearly impossible to retrofit once orders exist. It ranks below the constraints only because it is enforced by the shape of the relationships rather than by a rule that can be tested with a rejected insert.

**Independent Test**: Inspect the purchase record's references — it points at a specific version, and there is no path from a purchase to a mutable presentation field.

**Acceptance Scenarios**:

1. **Given** a purchase, **When** its references are inspected, **Then** it points at a specific agent version and never at an agent alone.
2. **Given** a purchase, **When** the seller adds a new version of that agent, **Then** the existing purchase still resolves to the version that was current at purchase time.
3. **Given** a purchase, **When** its recorded price is compared to the listing price, **Then** the purchase carries its own snapshot of the price rather than reading it live.
4. **Given** an agent, **When** its presentation fields are located, **Then** they live on the version rather than on the agent, so nothing a buyer was shown can change without producing a new version.

---

### User Story 4 - Balance is derived, never stored (Priority: P4)

Anyone asking "what can this account spend?" gets an answer computed by summing an append-only record of every movement — so the number always traces to the events that produced it, and there is no stored total that can silently disagree.

**Why this priority**: A stored balance that drifts from its history is the kind of defect that surfaces mid-demo and cannot be diagnosed quickly. Deriving it costs nothing at this scale. Last in priority only because nothing can move money yet — this feature provides the shape and the query, not the transactions.

**Independent Test**: Insert a series of credits and debits, ask for the balance, and confirm it equals their sum; then search the schema and confirm no stored balance total exists anywhere.

**Acceptance Scenarios**:

1. **Given** an account with several recorded movements, **When** its available balance is requested, **Then** the result equals the signed sum of those movements.
2. **Given** an account with no recorded movements, **When** its balance is requested, **Then** the result is zero rather than empty or undefined.
3. **Given** the complete schema, **When** it is searched for a stored balance total, **Then** none exists on any table.
4. **Given** a recorded movement, **When** any attempt is made to model it as editable, **Then** the design offers no such path — corrections are new entries, not edits.

---

### Edge Cases

- **The migration runs against a partially-created schema**: it fails loudly rather than half-applying, and the failure prevents the service from starting.
- **Wallet address casing**: the same address in upper, lower, and mixed case is one identity; whatever casing was supplied is preserved for display and payout.
- **An identifier that exists off-chain but not yet on-chain**: records that live in both worlds carry both identifiers, and the on-chain one is legitimately absent until its transaction confirms — absence means "submitted, not yet confirmed", not "error".
- **A missing execution result**: an execution record with no output is a valid, meaningful row — it is how non-delivery is evidenced — not a failure to be cleaned up or retried.
- **Empty list-valued fields**: an agent version with no stated capabilities or no stated exclusions is storable; the lists may be empty but not absent.
- **A very large execution trace**: reasoning steps can be substantial and must be storable without a size ceiling imposed by the schema.
- **Deleting an account that has activity**: the database prevents orphaning dependent records.

## Requirements *(mandatory)*

### Functional Requirements

**Schema creation**

- **FR-001**: The system MUST provide a single, hand-written, reviewable migration artifact that builds the entire schema from an empty database.
- **FR-002**: The migration MUST create exactly eight tables: accounts, agents, agent versions, orders, execution runs, complaints, verdicts, and ledger entries.
- **FR-003**: The migration MUST create three enumerated types: ledger entry kind (onramp, purchase, offramp, adjustment), order state (purchased, running, delivered, failed, released, disputed, adjudicated, settled), and verdict tier (none, quarter, half, three-quarter, full).
- **FR-004**: The migration MUST be reversible — a revert removes every object it created.
- **FR-005**: Applying the migration when it has already been applied MUST succeed and change nothing.
- **FR-006**: Every table MUST generate its own identifier and creation timestamp when not supplied.

**Uniqueness and integrity**

- **FR-007**: The system MUST enforce at most one complaint per order.
- **FR-008**: The system MUST enforce at most one verdict per order.
- **FR-009**: The system MUST enforce at most one execution run per order.
- **FR-010**: The system MUST enforce one account per wallet address, treating addresses that differ only in letter casing as the same address, while preserving the supplied casing for display and payout.
- **FR-011**: The system MUST enforce that an agent's version numbers are unique within that agent.
- **FR-012**: The system MUST enforce uniqueness of each on-chain identifier where one is recorded, while permitting it to be absent.
- **FR-013**: The system MUST reject listing prices and purchase amounts that are not greater than zero, refund amounts below zero, and review windows not greater than zero.
- **FR-014**: The system MUST enforce referential integrity between records and the accounts, agent versions, and orders they reference.

**Money and balance**

- **FR-015**: The system MUST store every monetary amount as a whole number of US cents. No monetary column may hold token base units.
- **FR-016**: The system MUST record balance movements as signed entries — credits positive, debits negative — in an append-only record.
- **FR-017**: The system MUST provide a way to obtain an account's available balance as the signed sum of its entries, returning zero when there are none.
- **FR-018**: The system MUST NOT contain any stored or cached balance total on any table.
- **FR-019**: The system MUST support attributing a balance entry to the order that caused it, while permitting entries with no associated order.

**Pinning and disclosure**

- **FR-020**: Orders MUST reference a specific agent version, never an agent alone.
- **FR-021**: Orders MUST carry their own snapshot of price and review window rather than reading them from the listing at read time.
- **FR-022**: All buyer-visible presentation attributes of an agent MUST live on the version rather than on the agent.
- **FR-023**: The seller's private instruction text MUST be stored on the version and MUST be identifiable in the data model as restricted, so the disclosure boundary built in a later feature has something unambiguous to key on.

**Query support**

- **FR-024**: The system MUST index the order lookup used to find deliveries whose review window may have elapsed — this is the highest-frequency repeated query in the product.
- **FR-025**: The system MUST index the lookups for undelivered orders by age, orders by their on-chain identifier, a buyer's order history, an account's balance entries in time order, a seller's listings, and an order's execution record.

**Data model fidelity**

- **FR-026**: The application's data models MUST agree with the migrated schema — same tables, columns, types, nullability, and constraints — with no drift between the two.
- **FR-027**: The system MUST NOT alter the database schema by inferring it from the application's data models; the migration artifact remains the only mechanism that changes schema.
- **FR-028**: Records that exist both off-chain and on-chain MUST carry both identifiers, with the on-chain identifier permitted to be absent until its transaction confirms.

### Key Entities

- **Account**: One per registered wallet. Holds the wallet address (its identity and payout destination) and when it registered. No role — the same account both buys and sells.
- **Ledger Entry**: One per movement of platform balance. Signed amount in cents, a kind, optionally the order that caused it, and an optional external reference. Append-only; a balance is their sum.
- **Agent**: One per listed agent. Owned by an account, optionally carries its on-chain identifier, and can be active or inactive. Holds nothing a buyer sees.
- **Agent Version**: One per definition edit, immutable once written. Carries everything a buyer is shown plus everything the arbitration is judged against: name, description, capabilities, exclusions, price, input and output shapes, the seller's private instructions, the model, a timeout, and a hash of the canonical definition.
- **Order**: One per purchase. References the buyer and the exact agent version, snapshots price and review window, carries free-text acceptance criteria, a state from the order lifecycle, and timestamps for creation, delivery, dispute, and settlement.
- **Run**: Exactly one per order — the execution evidence. Carries the buyer's input, the output (absent if it failed, which is itself the non-delivery signal), the reasoning steps, an error, whether the output satisfied the declared shape, and timing.
- **Complaint**: At most one per order. The buyer's stated reason and when it was filed.
- **Verdict**: At most one per order. Tier, computed refund, human-readable reasoning, citations, a hash anchored on-chain, the model that produced it, and the settling transaction reference once known.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A developer goes from an empty database to the complete schema with no manual SQL and no steps beyond the ones already used to start the stack.
- **SC-002**: The schema contains exactly 8 tables and 3 enumerated types — no more, no fewer.
- **SC-003**: All 5 uniqueness rules reject their duplicate, verified by attempting each violation in turn; 100% are rejected by the database rather than by application code.
- **SC-004**: Wallet addresses differing only in letter casing are rejected as duplicates in 100% of casing variations tried.
- **SC-005**: A balance computed over a set of entries equals their arithmetic sum in every case tried, including the empty case, which returns zero.
- **SC-006**: A search of the entire schema for a stored balance total returns zero results.
- **SC-007**: Every monetary column holds whole cents; a search for any column storing token base units returns zero results.
- **SC-008**: Applying the migration to an already-migrated database changes nothing, and reverting it removes every object it created — verified by comparing the database's structure before and after a full apply-revert-apply cycle.
- **SC-009**: A comparison between the application's data models and the migrated schema reports no differences.

## Assumptions

- **Verification is manual.** Automated tests remain out of scope for this component per the project's standing decision; every scenario above is checked by hand, most of them as a handful of insert statements.
- **Schema only.** No services, controllers, endpoints, or business rules are delivered. The balance helper is a query, not a funding feature — nothing in this feature can move money.
- **The disclosure boundary is marked here, enforced later.** This feature identifies the seller's private instruction text as restricted; the serialiser that keeps it away from buyers belongs to the catalogue feature.
- **Written from the schema definition, not inferred from the data models.** The enumerated types, the case-insensitive unique index, and the value constraints are all specified directly rather than derived, because deriving them is where the fidelity is lost.
- **Eight tables is the settled count.** The source schema document says "eight tables" in one place and "nine tables" in a later summary line; the actual definition contains eight, and the two tables cut for the MVP (agent buyers, payment cards) plus payment routes account for the discrepancy. Eight is correct.
- **Identifier generation is available from the database.** Both identifier generation and current-time defaults are expected from the database rather than the application, so a row inserted by hand during debugging is as valid as one inserted by the application.
- **Sizeable stored values are acceptable.** Execution traces and schema documents are stored as structured values with no application-imposed size ceiling; the database's own handling of large values is relied upon.
- **No event-log table.** On-chain history is re-read from the chain rather than mirrored into a table, so nothing here records chain events.
- **Settlement writes no balance entry.** Settled money lives on-chain under the user's own address and cannot be recaptured, so it is deliberately absent from the ledger's kinds.
