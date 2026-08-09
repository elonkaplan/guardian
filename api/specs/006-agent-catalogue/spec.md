# Feature Specification: Catalogue & the Serialisation Boundary

**Feature Branch**: `006-agent-catalogue`

**Created**: 2026-08-09

**Status**: Draft

**Input**: User description: "docs/specs/API-06-catalogue.md — Sellers list agents; buyers browse them — and the redaction rule that every later spec depends on gets built once, here. Creating an agent with its first version, publishing further immutable versions, toggling availability, the public listing views, the owner's own views including inactive agents and the full execution spec, validation that the input and output schemas are real schemas, and the one serialiser that structurally cannot emit a seller's system prompt."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A seller lists an agent, and the listing is committed publicly (Priority: P1)

A signed-in person describes an agent they want to sell: what it is called, what it does, the explicit things it can do, the explicit things it will not do, the price, the shape of input it needs, the shape of output it returns — and, privately, the instructions that make it work and the model it runs on. The platform checks that the two shapes are real, usable schemas, records the agent together with its first version, reduces the whole definition to a single fingerprint in a way that anyone with the same definition would arrive at the same fingerprint, and publishes that fingerprint to the escrow contract so the definition is committed before anybody pays for it.

The fingerprint is the point. It is what later lets an auditor confirm that the agent that ran is the agent that was sold, and it is what stops a seller quietly swapping in something cheaper after the sale and claiming it was always that one.

The listing does not finish early. The escrow contract is what assigns an agent its on-chain identifier, and a purchase cannot be opened without one — so the platform waits for the contract to confirm and hands back an agent that is genuinely on sale, rather than one that will fail at the moment somebody tries to buy it.

**Why this priority**: Nothing else in the catalogue exists until an agent can be listed, and nothing anywhere downstream — purchases, execution, audit — has anything to point at. It is also where the on-chain commitment is made, which is the property the whole dispute story rests on.

**Independent Test**: List an agent through the platform and confirm the response carries the on-chain identifier the contract assigned. Independently re-derive the fingerprint from the stored definition and confirm it matches the value the escrow contract holds for that agent. Confirm the agent then appears in the public catalogue.

**Acceptance Scenarios**:

1. **Given** a signed-in seller and a complete agent definition, **When** the agent is listed, **Then** the agent and a version numbered 1 are recorded, the definition's fingerprint is stored, and the escrow contract is asked to register the agent with that fingerprint, that price, and the seller's own wallet address as the payout address.
2. **Given** a listed agent, **When** its fingerprint is recomputed from the stored definition by any independent means, **Then** the result is identical to the stored value and to the value held on-chain.
3. **Given** two definitions that differ only in the order their fields were written, **When** each is fingerprinted, **Then** both produce the same fingerprint.
4. **Given** two definitions that differ in any field's value — including a field that is never shown to buyers — **When** each is fingerprinted, **Then** the fingerprints differ.
5. **Given** a definition whose input shape or output shape is not a valid schema, **When** the agent is listed, **Then** the request is refused with a reason naming the offending field, and no agent, version, or on-chain registration is created.
6. **Given** a definition missing any required part — name, description, capabilities, exclusions, price, both shapes, the private instructions, the model, or the timeout — **When** it is submitted, **Then** it is refused as invalid.
7. **Given** a price that is not a positive whole number in the platform's money unit, **When** the agent is listed, **Then** it is refused.
8. **Given** a listing request from a caller with no valid session, **When** it is submitted, **Then** it is refused as unauthenticated.
9. **Given** a successful listing, **When** the response is read, **Then** it identifies the new agent and its version, carries the on-chain identifier the contract assigned, and contains no part of the private instructions.
10. **Given** a listing in progress, **When** the escrow contract has not yet confirmed the registration, **Then** the request has not returned — the platform waits for the confirmation rather than answering with an agent whose on-chain identifier is still missing.
11. **Given** a listing whose on-chain registration fails or never confirms, **When** the caller is answered, **Then** they are told the listing did not complete, and the agent does not appear in the public catalogue at any point.

---

### User Story 2 - Buyers browse a catalogue that cannot leak the seller's craft (Priority: P1)

Anyone — signed in or not — can list the agents on sale and open any one of them. What comes back is the listing: name, description, the capabilities claimed, the exclusions declared, the price, and the shapes of input and output so a buyer knows what to supply and what to expect. What never comes back, through any of these routes, under any input, is the seller's private instructions.

That last guarantee is not a rule each route remembers. There is exactly one function that turns a stored agent into something a buyer may see, every buyer-facing response goes through it, and it has no way of emitting the private instructions at all. The property holds because there is nowhere for the field to come out, not because five endpoints each got it right.

**Why this priority**: This is the half of the catalogue that everything the buyer does begins with, and it is where the disclosure boundary is actually built. Every later feature — the order case file, the execution record, the audit verdict — routes its buyer-facing output through the same choke point. Getting it wrong here means a frivolous complaint becomes a way to steal a seller's work, and getting it right here means the later features inherit the property for free.

**Independent Test**: With at least one agent listed, request the public catalogue and each individual agent, then search every byte of every response for any fragment of the seller's private instructions. Confirm none appears. Then attempt the same against an agent whose instructions were deliberately made to look like listing copy, and confirm it still does not appear.

**Acceptance Scenarios**:

1. **Given** listed agents, **When** the public catalogue is requested, **Then** each entry carries the listing fields — identity, name, description, capabilities, exclusions, price, input shape, output shape, and version number — and nothing more.
2. **Given** any public catalogue or agent response, **When** it is inspected, **Then** it contains no private instructions, no model identifier, no timeout, and nothing else belonging to the execution side of the definition.
3. **Given** a mix of available and unavailable agents, **When** the public catalogue is requested, **Then** only the available ones are listed.
4. **Given** an unavailable agent, **When** it is requested directly by its identifier without a session, **Then** it is reported as not found.
5. **Given** an agent left behind by a failed registration, with no on-chain identifier, **When** the public catalogue is requested, **Then** it is not listed; **and when** it is requested directly by its identifier, **Then** it is reported as not found — a buyer is never shown an agent that cannot be bought.
6. **Given** an agent with several versions, **When** it is viewed publicly, **Then** the listing shown is the one from its latest version.
7. **Given** any request to the public catalogue or a public agent view, **When** it arrives without a session, **Then** it is served normally — these views require no sign-in.
8. **Given** the private instructions of a listed agent are changed to an unmistakable marker string, **When** every buyer-facing route in this feature is exercised with every combination of inputs it accepts, **Then** the marker appears in no response.
9. **Given** an agent identifier that does not exist or is malformed, **When** it is requested, **Then** the response is a clean not-found or invalid-input answer rather than an error.

---

### User Story 3 - A seller manages availability without losing the agent (Priority: P2)

A seller asks for their own agents and gets all of them — the ones currently on sale and the ones they have taken down. From that list they can switch any agent's availability on or off, which both updates the platform's records and tells the escrow contract, so no new purchase can be opened against an agent that is off. Purchases already running are untouched: taking an agent down stops new sales, it does not cancel work in flight.

The list including unavailable agents is the whole point. If the seller's own list were filtered the same way the public one is, switching an agent off would remove it from the only place its owner could switch it back on, and the toggle would be one-way.

This list is also the only place an agent whose registration failed is visible at all. Buyers must never see one, because it cannot be bought — but its owner must, marked as not yet listed, because they are the only person who can do anything about it.

**Why this priority**: The seller-facing surface of the product depends on this list, and the one-way-toggle trap is the kind of defect that is invisible until someone tries the second half of the round trip on stage. It sits below the public views because a catalogue that cannot be curated is still a working catalogue.

**Independent Test**: List two agents, switch one off, and confirm it vanishes from the public catalogue but remains in the owner's list marked unavailable. Then switch it back on from that list and confirm it returns to the public catalogue.

**Acceptance Scenarios**:

1. **Given** a signed-in seller with both available and unavailable agents, **When** they request their own agents, **Then** every agent they own is listed regardless of availability, each carrying its current availability state.
2. **Given** an owner's list, **When** any other account's agents exist, **Then** none of them appear in it.
3. **Given** an agent whose registration failed and which therefore has no on-chain identifier, **When** its owner requests their own agents, **Then** it appears in the list, distinguishable as not yet listed — the one view in the product where it is visible.
4. **Given** a request for the owner's own agents without a session, **When** it is submitted, **Then** it is refused as unauthenticated rather than falling back to the public list.
5. **Given** an available agent, **When** its owner switches it off, **Then** the platform's record is updated, the escrow contract is told, and the agent no longer appears in the public catalogue.
6. **Given** an unavailable agent, **When** its owner switches it back on, **Then** it reappears in the public catalogue with its current listing.
7. **Given** an agent with purchases already running, **When** its owner switches it off, **Then** those purchases continue unaffected and their outcome is unchanged.
8. **Given** an agent owned by someone else, **When** a caller attempts to switch its availability, **Then** the attempt is refused as not permitted and nothing changes.
9. **Given** a request to switch availability to the state the agent is already in, **When** it is submitted, **Then** the result is the same state, reported as success, without side effects.

---

### User Story 4 - A new version supersedes without rewriting history (Priority: P2)

A seller improves an agent — better instructions, sharper capabilities, a different price — and publishes it as a new version. The previous version is not edited and not removed; it stays exactly as it was, because purchases made against it must still be judged against what it actually said. The new version gets the next number, its own fingerprint, and the escrow contract is told the agent's current fingerprint and price have changed. Purchases already running keep pointing at the version they were bought under.

**Why this priority**: Without versioning, a seller could soften their own capability claims after a bad delivery and win a dispute retroactively — which would hollow out the audit story completely. It ranks below listing and browsing only because a demo can be run on first versions alone.

**Independent Test**: List an agent, buy nothing, publish a second version with different capabilities and a different price, and confirm the first version is byte-for-byte unchanged, the public listing now shows the second, and the escrow contract holds the second version's fingerprint and price.

**Acceptance Scenarios**:

1. **Given** an agent at version 1, **When** its owner publishes a new definition, **Then** a version numbered 2 is recorded with its own fingerprint, and version 1 is unchanged in every field.
2. **Given** a new version, **When** it is published, **Then** the escrow contract is told the agent's new fingerprint and price, and its recorded version number advances.
3. **Given** an existing version, **When** anything attempts to modify or delete it, **Then** the attempt does not succeed — versions are written once.
4. **Given** an agent with several versions, **When** the public catalogue is consulted, **Then** it shows the latest version's listing and no earlier one.
5. **Given** an agent owned by someone else, **When** a caller attempts to publish a version of it, **Then** the attempt is refused as not permitted.
6. **Given** a new version whose input or output shape is not a valid schema, or whose price is not a positive whole number, **When** it is submitted, **Then** it is refused and no version is recorded.
7. **Given** a purchase running against version 1, **When** version 2 is published, **Then** the purchase still refers to version 1 and everything derived from it — what was promised, what ran, what it is judged against — comes from version 1.
8. **Given** a new version identical in every field to the current one, **When** it is published, **Then** it is recorded as a new version with the same fingerprint rather than refused.

---

### User Story 5 - An owner can read their own definitions in full (Priority: P3)

A seller asks for the versions of an agent they own and gets every version, complete — including the private instructions, the model, the timeout, and the fingerprint. This is the one view where the execution side of the definition is returned, and it is returned only to the account that owns the agent. It is a different route from anything a buyer can reach, not the same route behaving differently.

**Why this priority**: A seller needs to see what they actually published in order to publish a better version, and the fingerprint has to be readable somewhere to be verifiable by hand. It sits last because it is the only view in this feature nothing else depends on.

**Independent Test**: As the owner, request an agent's versions and confirm every version comes back with its private instructions and fingerprint. Then request the same thing as a different account and confirm it is refused.

**Acceptance Scenarios**:

1. **Given** a signed-in owner, **When** they request their agent's versions, **Then** every version is returned, each complete with listing fields, private instructions, model, timeout, version number, fingerprint, and creation time.
2. **Given** an agent owned by someone else, **When** a caller requests its versions, **Then** the request is refused as not permitted and no definition content is returned.
3. **Given** a request for an agent's versions without a session, **When** it is submitted, **Then** it is refused as unauthenticated.
4. **Given** an unavailable agent, **When** its owner requests its versions, **Then** they are returned normally — availability does not restrict the owner's own view.
5. **Given** the routes in this feature, **When** they are compared, **Then** the full-definition view is reached by an address of its own, distinct from every buyer-facing view, so that no single address can return either shape depending on who asks.

---

### Edge Cases

- **A seller's private instructions are pasted into the description, or into a capability.** The platform cannot detect this and does not try. The disclosure boundary protects the field that holds the instructions; a seller who copies them into a field designed to be public has published them deliberately. Worth stating so it is not mistaken for a hole in the boundary.
- **A definition contains characters that serialise differently depending on the encoder** — non-Latin text, escapes, very large or fractional numbers. The fingerprint is worthless if it is not reproducible, so the canonical form must be fully pinned: fixed key order, fixed encoding, no incidental whitespace, and no reliance on the language's default number formatting.
- **Array order inside a definition.** Capabilities and exclusions are ordered lists and their order is part of the definition — reordering them is a different definition and produces a different fingerprint. Only object keys are sorted; arrays are never reordered.
- **The record is written but the on-chain registration does not confirm.** This is a crash state, not a stage in a normal flow — an agent nobody can buy. The listing request reports failure, the agent is filtered out of every buyer-facing view, and it surfaces only on its owner's own list marked as not yet listed. Leaving it in the public catalogue would park a listing that fails at purchase time, on a buyer's screen, which is the worst place to discover it.
- **The on-chain registration confirms but recording the identifier fails.** An agent exists on-chain that the platform cannot match to a row. Logged at error level with the transaction reference so it can be reconciled by hand. From the buyer's side it behaves identically to the case above: absent identifier, absent from the catalogue.
- **The registration transaction is slow to confirm.** The listing request waits. It is a seller action performed once, not a polled read, so a slow answer is acceptable where a wrong one is not — and the identifier only exists once the contract has assigned it.
- **An agent is taken down while a buyer is on its page.** The next public request reports it as not found. This is correct — but a purchase already opened against it proceeds to completion.
- **A buyer holds a link to an agent that was taken down.** Public views report not found rather than serving a stale listing, because a listing shown is a listing that can be bought.
- **Two versions published in quick succession for the same agent.** Version numbers must remain unique and consecutive per agent, and the on-chain fingerprint must end up matching the version that actually came last.
- **A schema that is valid as a schema but describes something unusable** — an empty object, a bare `true`, a schema that permits anything. Accepted at listing time; it is the seller's contract to write, and the consequence lands on them when their output is judged against it.
- **A version is published with an unchanged price.** The escrow contract is still told, because the fingerprint changed even if the price did not.
- **The owner's list is requested by an account that owns nothing.** An empty list, not an error.
- **An agent identifier that belongs to a different account is used on an owner-only route.** Refused as not permitted, and the refusal must not differ in a way that reveals whether the agent exists.

## Requirements *(mandatory)*

### Functional Requirements

**The serialisation boundary**

- **FR-001**: System MUST route every buyer-facing representation of an agent through a single serialisation function, such that no endpoint constructs a buyer-facing shape by any other means.
- **FR-002**: The serialisation function MUST be structurally incapable of emitting a seller's private instructions — the property MUST hold by construction rather than by each caller omitting the field.
- **FR-003**: System MUST exclude from every buyer-facing representation the private instructions, the model identifier, and the timeout, together with any other field belonging to the execution side of the definition.
- **FR-004**: System MUST expose in buyer-facing representations exactly the listing fields: identity, name, description, capabilities, exclusions, price, input shape, output shape, and version number.
- **FR-005**: The serialisation function MUST be the designated place where future sensitive fields are handled, so that extending the boundary to cover execution records later is a change in one place.

**Listing an agent**

- **FR-006**: System MUST let a signed-in caller list an agent by supplying a complete definition, creating the agent and its first version, numbered 1, in a single operation.
- **FR-007**: System MUST require every part of a definition to be present: name, description, capabilities, exclusions, price, input shape, output shape, private instructions, model, and timeout.
- **FR-008**: System MUST validate that the declared input shape and output shape are each a valid schema, and MUST refuse the request naming the offending field when either is not.
- **FR-009**: System MUST refuse a price that is not a positive whole number in the platform's single money unit, and MUST NOT convert that unit anywhere outside the chain-access boundary.
- **FR-010**: System MUST record the seller who listed the agent as its owner, taking the owner from the authenticated session and never from the request body.
- **FR-011**: System MUST ask the escrow contract to register the agent with its fingerprint, its price, and the owner's own wallet address as the payout address.
- **FR-012**: System MUST wait for the escrow contract to confirm the registration before answering the listing request, and MUST return the on-chain identifier the contract assigned. It MUST NOT answer early with the identifier still absent.
- **FR-013**: System MUST treat a recorded agent with no on-chain identifier as a failure state rather than a pending one — an agent that cannot be purchased, never presented to a buyer, and reported to its owner as not yet listed.
- **FR-014**: System MUST tell the caller that a listing did not complete when the registration fails or does not confirm, and MUST NOT report such a listing as successful.
- **FR-015**: System MUST return the created agent's identity, version, and on-chain identifier in a response that contains no part of the private instructions.

**The definition fingerprint**

- **FR-016**: System MUST reduce each version's definition to a single fingerprint computed over a canonical form of the whole definition — listing fields and execution fields alike — so that no field of the definition can change without changing the fingerprint. Platform bookkeeping that is not part of the definition — identifiers, ownership, timestamps, and the version number — MUST be excluded, so that the same definition always fingerprints the same regardless of where or when it was recorded.
- **FR-017**: The canonical form MUST be deterministic: object keys in a fixed order, a fixed text encoding, no incidental whitespace, and a pinned representation for numbers and strings, such that the same definition always produces the same fingerprint regardless of how or when it is serialised.
- **FR-018**: System MUST preserve the order of ordered lists within the definition, canonicalising key order only.
- **FR-019**: System MUST store each version's fingerprint alongside the version, and the stored fingerprint MUST equal the value committed on-chain for that version.
- **FR-020**: System MUST make the fingerprint reproducible from the stored definition alone, by any party holding that definition and the canonicalisation rule.

**Public views**

- **FR-021**: System MUST expose a public catalogue listing agents, requiring no session, showing only agents whose availability is on **and** which carry an on-chain identifier, so that nothing a buyer can see is unbuyable.
- **FR-022**: System MUST expose a public view of a single agent, requiring no session, returning listing fields only and reporting as not found any agent whose availability is off or which carries no on-chain identifier.
- **FR-023**: System MUST present, in every public view, the listing carried by the agent's latest version.
- **FR-024**: System MUST answer an unknown or malformed agent identifier with a not-found or invalid-input result rather than an error.

**Owner views**

- **FR-025**: System MUST expose the calling seller's own agents, requiring a session, including agents whose availability is off, each carrying its current availability state.
- **FR-026**: System MUST include in the owner's list agents that carry no on-chain identifier, distinguishable as not yet listed — the only view in which such an agent is visible to anyone.
- **FR-027**: System MUST scope the owner's list to agents owned by the calling account and MUST refuse the request when no session is present rather than degrading to the public list.
- **FR-028**: System MUST expose an owner-only view of an agent's versions returning every version complete with private instructions, model, timeout, version number, fingerprint, and creation time.
- **FR-029**: System MUST refuse the owner-only views to any caller who is not the agent's owner, without revealing whether the agent exists.
- **FR-030**: System MUST implement the public and owner views as separate routes rather than one route branching on the caller, so that no conditional decides which shape is returned.

**Versions**

- **FR-031**: System MUST let an agent's owner publish a new version by supplying a complete definition, assigning it the next consecutive version number for that agent.
- **FR-032**: System MUST treat recorded versions as immutable — never modified, never deleted — with a corrected definition expressed only as a further version.
- **FR-033**: System MUST apply the same completeness, schema, and price validation to a new version as to a first one, recording nothing when validation fails.
- **FR-034**: System MUST tell the escrow contract the agent's new fingerprint and price when a version is published, including when the price is unchanged.
- **FR-035**: System MUST leave purchases already in progress pointing at the version they were opened against, such that publishing a version changes nothing about what a running purchase promised, ran, or is judged against.
- **FR-036**: System MUST keep version numbers unique and consecutive per agent under concurrent publication.

**Availability**

- **FR-037**: System MUST let an agent's owner switch its availability on or off, updating the platform's record and telling the escrow contract.
- **FR-038**: System MUST ensure switching availability off prevents new purchases while leaving purchases already running entirely unaffected.
- **FR-039**: System MUST keep the availability switch reversible from the owner's own list, which is why that list includes unavailable agents.
- **FR-040**: System MUST refuse an availability change from any caller who is not the agent's owner.

**Cross-cutting**

- **FR-041**: System MUST treat capabilities and exclusions as contract terms preserved verbatim, storing and returning them unaltered so they can be quoted exactly in a later verdict.
- **FR-042**: System MUST match the published HTTP contract for every endpoint in this feature — path, method, auth rule, field names, and casing — since the frontend is built against that contract and any divergence is a defect there.

### Key Entities

- **Agent**: A sellable capability owned by one seller. Carries only what does not change between versions: who owns it, whether it is available, and its identifier in the escrow contract. Everything a buyer was shown lives on a version, so nothing presented can change without producing a new version. The on-chain identifier is assigned by the contract, not chosen by the platform — an agent lacking one is a failed listing, not a pending one.
- **Agent version**: One immutable definition of an agent, numbered from 1 and unique per agent. Has three parts: the **listing** a buyer sees (name, description, capabilities, exclusions, price, input shape, output shape), the **execution spec** only the platform, the owner, and the auditor see (private instructions, model, timeout, and the two shapes again as validation), and its **fingerprint**. Written once, never edited.
- **Capabilities and exclusions**: The seller's explicit claims and explicit non-claims. Not marketing copy — one half of what a later audit judges a delivery against, quoted verbatim in verdicts.
- **Output shape**: The declared structure of what the agent returns. The field that turns a later dispute from an opinion into arithmetic, because a delivery can be checked against it mechanically.
- **Definition fingerprint**: A single value derived from the whole canonical definition — everything sold and everything that runs, and none of the platform's own bookkeeping — stored with the version and committed to the escrow contract before anyone can buy. What makes "the agent that ran is the agent that was sold" checkable rather than asserted. Two versions carrying identical definitions fingerprint identically, which is correct: nothing resolves a version *from* a fingerprint, because an order pins the version itself.
- **The serialiser**: The one function that converts a stored agent into something a buyer may see. Not a rule, a place. It is the only path to a buyer-facing shape, and it has no access to the fields it must not emit.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A listed agent appears on-chain carrying a fingerprint that can be re-derived from the stored definition by an independent computation, matching exactly, for every agent listed.
- **SC-002**: Every agent visible in the public catalogue can be bought: across a full demo rehearsal, no purchase ever fails because the agent it names was never registered on-chain.
- **SC-003**: A successful listing always returns an agent that is already registered on-chain — every listing response carries the identifier the contract assigned, with no case where it is absent or filled in later.
- **SC-004**: No public response contains a seller's private instructions, under any input — verified by searching every buyer-facing response across every route in this feature for any fragment of the stored instructions, with zero matches.
- **SC-005**: Publishing a new version leaves every purchase already running pointing at the version it was opened against, with no change to what that purchase promised or is judged against.
- **SC-006**: An agent switched off disappears from the public catalogue and remains in its owner's own list, from which switching it back on restores it to the public catalogue — a full round trip completed without any other intervention.
- **SC-007**: Every recorded version, once written, is identical when read back at any later point, including after further versions of the same agent are published.
- **SC-008**: A definition submitted twice with its fields written in different orders produces the same fingerprint both times; a definition differing in any single field, public or private, produces a different one.
- **SC-009**: An agent whose input or output shape is not a valid schema is never listed, and the refusal names which of the two was at fault.
- **SC-010**: Owner-only views are unreachable by any account other than the owner, and unreachable without a session, across every owner-only route.
- **SC-011**: Every endpoint in this feature matches the published HTTP contract exactly on path, method, auth rule, and field names, so a frontend built only from that contract works against it unchanged.
- **SC-012**: The three demo agents can be listed, browsed, versioned, and toggled through a full demo rehearsal without a single manual correction to the catalogue.

## Assumptions

- **All acceptance criteria here are verified by hand.** Automated tests of every kind are out of scope for this component — a time-boxed decision recorded in the component context. The demo rehearsal is the test suite.
- **The canonical form is a deterministic text serialisation of the definition with object keys sorted, a fixed encoding, and no insignificant whitespace**, and the fingerprint is the same cryptographic digest the escrow contract expects. The exact serialisation rule is a decision for planning; what this spec requires is that it be pinned, documented, and reproducible outside the running system.
- **The fingerprint covers the entire definition**, execution spec included. Hashing only the public listing would let a seller change the instructions that actually run without changing the commitment, which defeats the purpose.
- **The public single-agent view treats an unavailable agent as not found** rather than as forbidden or as a visible-but-disabled listing, because a listing that can be seen is a listing that can be bought.
- **Listing an agent is synchronous and waits for the chain.** The escrow contract assigns the on-chain identifier and a purchase cannot be opened without it, so returning before the registration confirms would hand back an agent nobody can buy. An absent identifier therefore means the listing *failed*, not that it is still in flight — which is why the public views filter on it and why the owner's list is the only place such an agent appears. Whether a failed listing is retried, deleted, or left for the seller to resubmit is a decision for planning; what this spec fixes is that it is never shown to a buyer.
- **The owner's list is reached by the same path as the public catalogue with an explicit owner filter**, and supplying that filter makes the request an authenticated one. The full-definition view remains an entirely separate route.
- **Price lives on the version, not on the agent**, so changing price means publishing a version — which is also what keeps the on-chain price and fingerprint moving together.
- **Tools available to seller agents are not populated in this feature.** The field exists in the definition shape so adding it later is not a schema change, but no agent uses it and nothing validates an allowlist.
- **Search, pagination, sorting, ratings, and reputation are out of scope**, as are orders, execution, and anything that consumes a listing rather than producing one.
- **The serialiser built here is extended later** to cover execution steps, whose reasoning text can paraphrase the private instructions without ever touching that field. It is built as the single choke point now specifically so that extension is one change in one place.
- **This feature depends on** the agent and version storage from the entities and migrations work, the chain-access layer that owns the escrow contract calls and the single money-unit conversion, and the wallet authentication that establishes who is calling and supplies the owner's payout address.
