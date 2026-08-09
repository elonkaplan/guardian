# Phase 0 — Research: Catalogue & the serialisation boundary

**Feature**: `006-agent-catalogue` · **Date**: 2026-08-09 · **Spec**: [spec.md](./spec.md)

Sixteen decisions. Four of them are the feature: how a definition becomes a reproducible
fingerprint (R2, R3), how the buyer-facing boundary is made structural rather than
remembered (R9), and what happens when the chain call in the middle of a write does not
come back (R8).

One decision **contradicts the spec as written** and the spec is being corrected: R3.

---

## R1 — The module is `src/catalog/`, and the controller carries an `agents` prefix

**Decision**: New module `src/catalog/`, one controller `AgentsController` with
`@Controller('agents')`, holding all six routes.

**Rationale**: `docs/CONTEXT.md` §3 and `api-design.md` §2 both name the module `catalog`
and assign it "agents + versions, definition hashing, the serialisation boundary". The
module is named for what it owns; the routes are named for what they address. Those are
allowed to differ, and here they must — API-07 adds `GET /sales` to `orders`, which is
also not `/orders`.

`AccountsController` carries no prefix at all because its routes are `/me` and
`/me/ledger`; that was a deliberate exception documented in its own header, not a house
style to copy.

**Alternatives rejected**: `src/agents/` — reads more obviously against the URL, and puts
the module map out of step with the two documents that define it, for one feature's
convenience.

---

## R2 — Canonical JSON is RFC 8785 (JCS), hand-written, no dependency

**Decision**: A ~20-line `canonicalise(value): string` in `src/catalog/definition-hash.ts`
implementing JSON Canonicalisation Scheme:

1. Object keys sorted by UTF-16 code unit — JavaScript's default `Array.prototype.sort()`
   on strings, which is exactly the ordering JCS specifies.
2. Arrays never reordered.
3. `JSON.stringify` with no `space` argument, so no insignificant whitespace.
4. Numbers left to `JSON.stringify`, which is ES `Number::toString` — the serialisation
   JCS itself mandates for doubles.
5. Strings left to `JSON.stringify`, which since ES2019 emits well-formed UTF-16 and
   escapes lone surrogates. JCS-compatible.

The output is then encoded UTF-8 and hashed (R4).

**Rationale**: JCS exists precisely for hash-commitment over JSON and is short enough to
implement correctly in the space its own specification would take to cite. For our value
domain it reduces to *sort keys recursively, then `JSON.stringify`*, because points 3–5
are what `JSON.stringify` already does.

Non-finite numbers would break JCS, and cannot arise: every value in the hashed payload
either comes from `JSON.parse` of a request body (which cannot produce `NaN` or
`Infinity`) or is a validated integer.

**⚠️ The obvious wrong implementation.** `JSON.stringify(obj, Object.keys(obj).sort())`
looks like it sorts keys and does not: the replacer *array* is a single allow-list applied
at **every** nesting level, so a nested object whose keys are not in the top-level list
serialises as `{}`. Applied to an agent definition it would silently empty `inputSchema`
and `outputSchema` — producing a stable, reproducible, and completely wrong hash. The
recursive sort is the only correct form.

**Alternatives rejected**:

- The `canonicalize` npm package — a production dependency, a supply-chain surface, and an
  audit obligation, for twenty lines whose correctness we have to understand anyway
  because the hash is the feature.
- `JSON.stringify` with insertion order and a documented "always build the object
  literally in this order" rule. It reproduces only as long as every future writer
  preserves the order, in a language where object key order is easy to disturb and
  impossible to see in a diff. The spec's requirement is that the hash reproduce *outside*
  the running system; insertion order is not a rule an outside party can follow.

---

## R3 — The hashed payload excludes `version` — and this corrects the spec

**Decision**: The canonical definition is exactly these ten fields, and nothing else:

```text
capabilities, description, exclusions, inputSchema, model,
name, outputSchema, priceMinor, systemPrompt, timeoutSeconds
```

Listed alphabetically because that is the order they canonicalise into. Excluded: `id`,
`agentId`, `version`, `createdAt`, `definitionHash`, `ownerAccountId`.

**Rationale**: the hash commits to *what was sold and what runs*. Platform bookkeeping —
which UUID a row got, when it was written, which seller owns it — is not part of the
definition and its inclusion would mean the same agent definition hashes differently on a
reseeded database, breaking the one property the hash exists to provide.

`version` is the interesting exclusion. `agent-definition.md` §2.3 lists `version` and
`definitionHash` as two *separate* integrity fields, which reads as: the hash is of the
definition, and the version is tracked beside it. The contract agrees — `updateAgent`
bumps its own `version` counter and takes `defHash` as an independent argument.

**⚠️ This contradicts spec FR-016 as written**, which requires the hash to cover "listing
fields, execution fields, **and version number** alike". That clause and spec scenario
US4 #8 — "a new version identical in every field is recorded with **the same
fingerprint**" — cannot both hold. One of them has to go, and the version number is the
one with no argument behind it: nothing verifies a definition *by* its version, and
including it would make a republished-identical definition produce a different commitment
for no stated benefit.

Duplicate hashes across versions are harmless because nothing resolves a version *from* a
hash. An order pins `agent_version_id` (invariant #6), and Guardian verifies by
recomputing the pinned version's hash — not by looking a hash up.

**Action taken**: spec FR-016 amended to drop "and version number alike"; the Key Entities
entry for the fingerprint amended to match. US4 #8 stands as written.

---

## R4 — `keccak256` lives in `catalog/`, and the `bytea` ⇄ `Hex` conversion happens at each edge

**Decision**: `src/catalog/definition-hash.ts` exports

```ts
canonicalise(definition): string          // the JCS text — logged, never stored
definitionHash(definition): DefinitionHash // { hex: Hex; bytes: Buffer }
```

using viem's `keccak256(toBytes(json))`. The repository persists `.bytes` into
`agent_versions.definition_hash` (`bytea`); `EscrowOperatorService.registerAgent` and
`.updateAgent` take `.hex`, which is the `Hex` their signatures already declare.

**Rationale**: canonicalisation is a statement about *what the product considers the
definition to be*. That is a catalogue concern, not a chain concern — `chain/` should not
have to know that `exclusions` is part of the sold contract and `createdAt` is not.
viem's `keccak256` is a pure function with no client, no RPC, and no unit conversion, so
importing it here crosses no boundary that matters.

**On the entity comment that says otherwise.** `agent-version.entity.ts` says of
`definition_hash`: *"raw bytes, not a hex string; hex conversion belongs in the chain
adapter."* That is about **storage** — the column is `bytea` and must not become a
`text` of `"0x…"`. It is not a claim that computing the digest belongs in `chain/`, and
returning both representations from one function is what stops the two from drifting.

**Invariant #2 is untouched.** The invariant is about *money units* — cents outside
`chain/`, base units inside. `priceMinor` enters the hashed payload as cents and stays
cents; the only `toBaseUnits` call remains the one already inside
`EscrowOperatorService`.

---

## R5 — `ajv` is added, targeting draft 2020-12

**Decision**: add `ajv` (v8) as the feature's one new production dependency. Validate with
`Ajv2020` from `ajv/dist/2020`, `strict: false`, and check a submitted schema in two
steps: `validateSchema(schema)` then `compile(schema)` inside a `try`.

**Rationale**: FR-008 requires refusing a definition whose `inputSchema` or `outputSchema`
is not a valid schema, naming which one. `ajv.validateSchema` is that check, exactly.

The dialect follows the schema's next consumer rather than its first: API-08 hands
`outputSchema` to the Anthropic API to constrain a seller agent's output, and that
ecosystem is draft 2020-12. Validating here against a dialect the execution engine will
not honour would let a definition pass listing and fail at run time — on a paid order.

`strict: false` because a seller's schema is theirs. Ajv's strict mode rejects unknown
keywords and several legal-but-unusual constructions; refusing a seller's schema for a
keyword Ajv has an opinion about is the platform overreaching into a document it does not
own.

**Two steps, not one**, because they catch different things: `validateSchema` checks the
document against the meta-schema, while `compile` is what resolves `$ref` and is the
operation API-08 will actually perform. A schema with an unresolvable `$ref` passes the
first and throws on the second, and it is better to learn that at listing time than
mid-order.

**Alternatives rejected**:

- A hand-rolled zod check ("is an object, has a `type`…"). It would accept documents Ajv
  rejects and reject documents Ajv accepts, which is the worst of both: a validation gate
  that does not agree with the validator that matters later. Spec SC-009 asks for a
  refusal naming the offending field; it does not ask for a home-made JSON Schema
  implementation.
- Deferring validation to API-08. That moves a `400` at listing time into a failed run on
  a paid order, and the run failure is indistinguishable from non-delivery — which is
  evidence in a dispute (invariant #7). A seller's typo would become a refund.

---

## R6 — `@OptionalAuth()` — a third state for the global guard

**Decision**: add `@OptionalAuth()` to `src/auth/`, a second metadata key the existing
`JwtAuthGuard` understands, with these semantics:

| Request | Behaviour |
| --- | --- |
| No `Authorization` header | Allowed through. `request.account` stays `undefined`. |
| Header present and valid | Allowed through, `request.account` set, exactly as a protected route. |
| Header present and invalid, expired, or naming a deleted account | **401**, exactly as a protected route. |

Applied to `GET /agents` only. Read in the handler through a new `@OptionalAccount()`
param decorator returning `Account | undefined` — never through `@CurrentAccount()`, which
throws a 500 by design when the guard did not populate the request.

**Rationale**: `GET /agents` is public and `GET /agents?owner=me` is owner-scoped, on the
same path and method, so Nest routes both to one handler. `@Public()` returns `true`
before the token is extracted, so on a `@Public()` route `request.account` can never be
set — the owner query would have no way to learn who is asking.

The third row is the one worth stating: a *bad* credential is refused even though the
route tolerates *no* credential. Silently ignoring an expired token would serve the
public catalogue to a seller whose session just lapsed, and the seller's screen would show
an empty list of their own agents rather than a prompt to sign in again.

**Alternatives rejected**:

- `GET /agents/mine` as a separate route. Cleanest against the guard, and it is not the
  contract: `api-design.md` §3.3 spells `?owner=me`, this feature's spec spells it, and
  `ui/src/api/agents.ts`'s `fetchOwnedAgents` is already written against it. Changing an
  endpoint two documents and one built component agree on, to avoid ten lines in a guard,
  is the wrong trade.
- `@Public()` plus decoding the token in the catalogue controller.
  `current-account.decorator.ts` says in writing that nothing outside `auth/` reads the
  `Authorization` header or injects `JwtService`. This would be the first violation, and
  it would reimplement expiry handling in a module with no reason to know about it.

**⚠️ This is a change to a security-critical file this feature does not otherwise own.**
It widens what the global guard can do. The guard's default — closed unless annotated —
is unchanged, and `@OptionalAuth()` needs the same scrutiny `@Public()` documents for
itself: it belongs on reads that are legitimately browsable, never on anything that moves
money or writes.

---

## R7 — `?owner=me` is a filter branch, not the shape branch FR-030 forbids

**Decision**: `GET /agents` and `GET /agents?owner=me` share a route and split at one `if`
in the controller, which selects between two repository methods and two mappers and does
nothing else. `GET /agents/:id` (public) and `GET /agents/:id/versions` (owner, full
definition) remain genuinely separate routes.

**Rationale**: FR-030 and the source brief both warn against "one route with a branch"
because of what the branch would be deciding — whether to include the execution spec.
That decision is the disclosure boundary, and it is the one that must never be a
conditional. It is not this one.

What `?owner=me` selects is a row filter (`owner_account_id = me`, inactive included, no
on-chain id required) and two extra **status** fields, `active` and `listed`. Neither is
seller IP; both are facts about the listing's availability that the owner already knows.
Both branches produce their result through a serialiser that structurally cannot emit
`systemPrompt` (R9), so the property FR-030 protects does not depend on which side the
`if` takes.

**Being honest about the residue**: there is still a branch, and a bug in it would show a
seller someone else's agents. It is mitigated by the two sides calling different
repository methods — the owner method takes an account id as a required argument, so the
public path cannot accidentally reach owner rows, and the owner path cannot accidentally
run unscoped.

---

## R8 — The chain call goes inside the database transaction, and only `ChainOutcomeUnknownError` leaves a row behind

The feature's three writes each pair a Postgres write with an escrow call. This is the
decision that governs all three.

### The ordering analysis, and why it collapses

Taken as a strict before/after, the safe order is asymmetric:

| Write | Postgres-first failure leaves | Chain-first failure leaves |
| --- | --- | --- |
| Deactivate | Hidden but still buyable — **inert**, nobody can find it | Visible but unbuyable — **the defect the catalogue filter exists to prevent** |
| Activate | Visible but unbuyable — bad | Buyable but hidden — inert |
| New version | Listed at a price the chain will not honour — bad | Chain holds a hash for a definition that was never stored — bad |

Which reads as *whichever write increases the agent's exposure goes second* — structurally
the same rule as `docs/CONTEXT.md` invariant #1, where whichever write increases what the
platform owes goes second.

**But a transaction subsumes it.** Wrapping the pair so the chain call sits *inside* an
uncommitted Postgres transaction removes the Postgres-first row entirely:

```text
BEGIN
  SELECT … FOR UPDATE          -- the agent row; serialises publishes and toggles
  write the Postgres change    -- not visible to anyone yet
  call the escrow              -- may take up to RECEIPT_TIMEOUT_MS = 30 s
COMMIT                          -- only if the chain agreed; ROLLBACK otherwise
```

A chain failure rolls back and nothing was recorded. A commit failure after a chain
success leaves the chain ahead of Postgres, logged at error — the rarer and more
recoverable of the two, and the direction in which a stale listing is merely stale rather
than wrong about price.

**Decision**: `POST /agents/:id/versions` and `PATCH /agents/:id/active` both use this
shape. The `FOR UPDATE` lock on the agent row also delivers FR-036 (version numbers unique
and consecutive under concurrency), because `MAX(version) + 1` is computed inside it.

**The cost, stated plainly**: a Postgres transaction is held open across an RPC that can
take 30 seconds. At demo scale — one seller, three agents, no concurrent publishing — this
costs nothing. At real scale it is a connection-pool exhaustion waiting to happen and the
answer would be an outbox. This is a scale-bounded decision, not a pattern to copy.

### `POST /agents` is different, and this is where a null id comes from

Registration cannot use the same shape, because `registerAgent` *returns* the id — the
contract assigns it — so the row must be updated after the chain call, not before.

| Chain result | Postgres | Response |
| --- | --- | --- |
| Success | Commit agent + version 1 + `onchain_agent_id` | `201` with the id (FR-012, FR-015) |
| Clean failure — simulation revert, `ContractRevertError`, `InsufficientFundsError`, `GasExhaustedError` | **Rollback.** The transaction provably did not land | `502`, nothing recorded |
| **`ChainOutcomeUnknownError`** — receipt timeout | **Commit with `onchain_agent_id` NULL**, log the tx hash at `error` | `502`, "did not complete" |

**Rationale**: this is the same branch 005's R6 identified as the most dangerous one in
that feature, in a different costume. A receipt timeout does not mean the transaction
failed — it means we stopped waiting. Rolling back there would delete the only record of
an agent that may be registered on-chain moments later, leaving a live on-chain agent with
no row anywhere and no way to find it except by scanning logs.

So a NULL `onchain_agent_id` has exactly one cause, and it is *"we do not know"* — which
is why the public views filter on it (FR-021, FR-022) and why the owner's list shows it
(FR-026). Every other failure leaves no row at all.

**⚠️ Never blind-retry `registerAgent` for a row with a NULL id.** A second call does not
retry the first — the contract assigns a *new* `agentId` and the seller ends up with two
on-chain agents, one of them unreachable and one of them attached to a row that may now
disagree with it. Reconciliation means matching `AgentRegistered` logs to the stored
`defHash`, which is why the hash is logged alongside the tx hash. No automatic recovery
is in scope; the row is visible to its owner and the fix is to list again.

**The entity's doc-comment is now wrong and is being corrected.**
`agent.entity.ts` currently reads: *"NULL means 'submitted, not yet confirmed' — an honest
state, not an error… makes the retry query `WHERE onchain_agent_id IS NULL` trivial."*
That was written against the earlier reading of `POST /agents` as an async contract. The
brief was revised to make it synchronous, and the comment now describes behaviour the
code will not have — including a retry that R8 forbids.

---

## R9 — The boundary is structural in three independent layers

**Decision**: `src/catalog/agent-serialiser.ts` is the only module that produces a
buyer-facing agent shape, and three separate mechanisms have to fail before a prompt
escapes.

**Layer 1 — the column is never read.** The public repository methods use an explicit
TypeORM `select` naming the eight listing columns. `system_prompt`, `model` and
`timeout_seconds` are not fetched, so on a public read the prompt never enters the
process. This is the only layer that also protects a log line, a stack trace, or an error
serialiser.

**Layer 2 — the serialiser cannot see the field.** Its parameter type is

```ts
type ListingFields = Pick<AgentVersion,
  'name' | 'description' | 'capabilities' | 'exclusions' |
  'priceMinor' | 'inputSchema' | 'outputSchema' | 'version'>;
```

Passing a whole `AgentVersion` is permitted by structural typing and still safe: the
function's parameter has no `systemPrompt` property, so no expression inside it can read
one. Emitting the prompt requires editing that type — a visible, reviewable change to a
line whose comment says what it is for.

**Layer 3 — the return types are closed.** `AgentSummaryResponse`, `AgentListingResponse`
and `OwnedAgentResponse` are exact interfaces with no index signature and no `extends` from
the entity, and every mapper is annotated with its return type. A spread of an entity into
a response is a compile error rather than a leak.

**On "one function".** The spec says one function; the truthful implementation is one
*module* with three mappers over a shared listing core, because the three routes return
three genuinely different shapes. What the spec is actually asking for — one place that
owns every buyer-facing projection, so the next sensitive field is handled once — is what
the module is. API-09 extends the same module for execution steps rather than adding a
second boundary somewhere else. Stated here so nobody reconciles the wording by merging
three mappers into one with a mode flag, which would be a shape branch and would undo R7.

**The entity comment gets updated too.** `agent-version.entity.ts` says of
`system_prompt`: *"Enforcement is a dedicated serialiser built in a later feature (API-06
catalogue) — this doc-comment exists so that serialiser has something unambiguous to key
on. Nothing enforces it yet."* The last sentence stops being true in this feature, and the
comment should point at the module by path.

---

## R10 — The public list is one `DISTINCT ON` query, not a join plus a loop

**Decision**:

```sql
SELECT DISTINCT ON (v.agent_id) …
FROM agent_versions v JOIN agents a ON a.id = v.agent_id
WHERE a.active = true AND a.onchain_agent_id IS NOT NULL
ORDER BY v.agent_id, v.version DESC
```

**Rationale**: the public catalogue shows each agent's *latest* version (FR-023), which is
a greatest-per-group problem. `DISTINCT ON` is Postgres's direct answer and keeps the
whole listing to one round trip. Fetching agents and then their versions is the N+1 that
looks fine with three agents and is a habit worth not forming.

Both filter predicates are in the same `WHERE`, which is the point: FR-021's two
conditions — active, and registered — are one clause that cannot be half-applied. The
owner query is the same statement with `a.owner_account_id = $1` and both filters dropped.

No new index. `agents_owner_idx` covers the owner query and the public one is a sequential
scan over a table with three rows.

---

## R11 — Responses are bare arrays

**Decision**: `GET /agents` and `GET /agents?owner=me` return a bare JSON array.
`GET /agents/:id/versions` likewise.

**Rationale**: `GET /me/ledger` already returns `LedgerEntryResponse[]`, and the UI's
`unwrapList` accepts a bare array or a single-key envelope under `agents`/`items`/`data` —
so a bare array satisfies the client that exists without asking it to change. Matching the
one precedent in the codebase beats inventing an envelope for the second list endpoint.

---

## R12 — `OwnedAgent` gains `listed`, and that is a handoff to UI-07

**Decision**: the owner's list entries carry `listed: boolean`, true exactly when
`onchain_agent_id IS NOT NULL`.

**Rationale**: FR-026 requires an agent whose registration outcome is unknown to be
distinguishable in its owner's list. Without a field for it the row renders identically to
a healthy one — `active: true`, a name, a price — and the seller is shown an agent that no
buyer can see and no buyer can buy, with nothing to indicate why.

**⚠️ `ui/specs/007-seller-pages/data-model.md` §1.3 declares
`OwnedAgent extends AgentSummary { active: boolean }` and nothing else.** Sending
`listed` is safe — that spec states in writing that "declaring fewer fields than arrive is
safe" — but the seller's screen has nowhere to render it until `OwnedAgent` and
`OwnedAgentList` are edited. That edit is a UI change this feature cannot make and should
not be assumed.

It is small: one field on one interface, one badge in one cell. It is worth doing, because
the state it reports is the only silent failure this feature can produce.

**Alternatives rejected**: `onchainAgentId: number | null` — the same information and it
puts a chain id into a seller-facing payload that has no use for one, inviting a component
to render it. `listed` says what the seller needs to know in the vocabulary they already
have.

---

## R13 — `version` is included in the public detail response

**Decision**: `GET /agents/:id` returns `version` alongside the listing fields.

**Rationale**: FR-004 lists it, and a buyer being able to see which version they are
looking at is what makes the pinning story legible. `ui/src/api/types.ts`'s `AgentListing`
does not declare it, which costs nothing — the same rule that makes R12 safe — and API-12
should add it when the OpenAPI document is written.

---

## R14 — No migration, and no new index

**Decision**: no migration file. Every table, column, constraint and index this feature
needs comes from `1786238842921-InitialSchema` — `agents` with its `UNIQUE` on
`onchain_agent_id` and `agents_owner_idx`, `agent_versions` with `UNIQUE (agent_id,
version)` and `CHECK (price_minor > 0)`.

This feature is the first thing that writes either table.

**Note on the price check**: `CHECK (price_minor > 0)` is already in the database, so
FR-009's rejection of a non-positive price has a backstop below the application. The
request-level check still belongs in the DTO — a constraint violation surfacing as a 500
from deep in TypeORM names no field, which is the identical argument
`common/amount.schema.ts` makes for validating money at the boundary.

---

## R15 — `amountMinorSchema` is reused for `priceMinor`

**Decision**: the create-agent and create-version DTOs validate `priceMinor` with the
existing `amountMinorSchema` from `src/common/amount.schema.ts`.

**Rationale**: it is already exactly the rule FR-009 states — positive, whole, safe
integer, cents — with a written argument for each clause. A second, subtly different money
schema in a second module is how two money rules start disagreeing.

Its doc-comment describes itself as guarding top-up and cash-out specifically and should
gain a line naming this third caller, since "no minimum and no maximum" now also governs
what a seller may charge.

---

## R16 — No preflight check is added

**Decision**: `chain-preflight.service.ts` is untouched.

**Rationale**: its existing checks already cover everything this feature needs — the
operator key is configured, the escrow is reachable, the operator holds gas. Registration
is operator-signed and moves no tokens, so there is no new precondition to assert at boot.
A check that adds no failure mode is noise in the one place noise is expensive.

---

## Open items carried into implementation

| Item | Why it is not a blocker |
| --- | --- |
| `OwnedAgent.listed` needs a UI-07 edit (R12) | The API side is complete and correct without it; the field arrives and is ignored until the UI declares it |
| No `docs/openapi.yaml` exists yet (API-12) | [contracts/internal-api.md](./contracts/internal-api.md) carries the literal names, as 005 did. API-12 transcribes it |
| Reconciling an agent left with a NULL id (R8) | Out of scope by decision, not by omission. The tx hash and `defHash` are logged; the row is visible to its owner |
