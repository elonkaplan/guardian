# Phase 0 — Research: Orders & the Purchase Saga

**Feature**: `007-orders-purchase-saga` · **Date**: 2026-08-09 · **Plan**: [plan.md](./plan.md)

Fifteen decisions. Two of them change files this feature does not own, and both are recorded
in full because the code they touch carries a ⚠️ comment warning against the naive version
of the change.

---

## R1 — The module already exists, and it is extended in place

**Decision**: `src/orders/` gains the controllers, services, repository, serialiser, errors
and DTOs. Nothing is relocated. `GET /sales` lives in a second controller inside the same
module.

**Rationale**: `orders.module.ts` was created by API-05 with a single query
(`EscrowExposureRepository`) and a doc-comment that says in writing *"API-06 (the purchase
saga) extends this module in place; it does not relocate it."* The numbering in that comment
is off by one — the saga is API-07 — but the instruction is the module's own and it is
correct. `docs/CONTEXT.md` §3 assigns orders to `orders`.

`/sales` is a different path root from `/orders`, and Nest's `@Controller('sales')` takes a
path prefix, so it cannot share a controller with `/orders` without dropping the prefix and
hand-writing full paths on every route. Two controllers, one module — the same split
`ui/src/api/sales.ts` made for the same reason, and it keeps the seller's one read away from
the buyer's five.

**Alternatives considered**: a `sales/` module of its own. Rejected: it would own no table,
no entity and no invariant, and `docs/CONTEXT.md` §3 has no such module. The sales list is a
different projection of `orders`, not a different resource.

---

## R2 — The purchase does **not** use 006's chain-inside-the-transaction shape

**Decision**: `POST /orders` commits the Postgres transaction **before** calling the escrow,
and compensates on failure. This is the opposite of the shape
`catalog/agent-writes.service.ts` uses for all three of its writes.

**Rationale**: 006 R8 wraps the chain call inside the uncommitted transaction, so a chain
failure rolls back and records nothing — which deletes the compensation path rather than
having to get it right. That is the better shape wherever it applies, and it does not apply
here.

The difference is what a rollback destroys. In the catalogue, a rolled-back `registerAgent`
loses an agent row that nobody has paid for. In a purchase, a rolled-back transaction loses
**the only record that a particular buyer's money entered escrow**. If `openDeal` was
broadcast and later confirms, the contract holds real tokens against a deal whose order row
was rolled away — money locked with no record of whose it is, recoverable only by reading
event logs by hand. `docs/CONTEXT.md` invariant #1 ranks exactly this outcome as the one
worth paying a compensation path to avoid: *"a bad DB write is one compensating row, a stray
on-chain deal is recoverable only by hand."*

So the rule is not "chain calls go inside transactions". It is **whichever side is
unrecoverable goes second, and the recoverable side is committed first so it survives to
describe what happened.** For the catalogue that produces one shape; for a purchase it
produces the other.

`escrow-exposure.repository.ts` already assumes this ordering in writing — its ⚠️ note
describes *"an order that legitimately exists with a `purchase` ledger debit already written
and a null deal id"* as *"precisely what invariant #1's Postgres-first ordering produces
mid-saga"*. That comment was written against a design that had not been built yet. This
feature builds it.

**Alternatives considered**: the 006 shape, as above. Also an outbox — the correct
production answer, and a table, a poller and a delivery-guarantee argument for a flow that
runs three times per rehearsal.

---

## R3 — `openDeal` has three outcomes, not two, and only one of them compensates

**Decision**:

| Chain result | Order | Ledger | Response |
| --- | --- | --- | --- |
| **Success** | `onchain_deal_id` set, state stays `purchased` | debit stands | `201` |
| **Knowable failure** — revert, gas, connectivity, insufficient funds | `state = 'failed'`, deal id stays NULL | **+ compensating `adjustment` credit** | `502` |
| **`ChainOutcomeUnknownError`** — broadcast, receipt never arrived | **unchanged**: `purchased`, deal id NULL | **debit stands, nothing compensated** | `502` |

**Rationale**: `chain/errors.ts` calls `ChainOutcomeUnknownError` *"THE MOST IMPORTANT ERROR
IN THIS MODULE"* and states the rule this decision applies: the transaction may still
confirm, so it is not a failure and must not be treated as one.

Compensating an unknown outcome is the one branch that can break solvency. If the credit is
written and the transaction then confirms, the buyer's spendable balance has been restored
*and* their money is escrowed on-chain — the pool now holds less than the ledger claims,
which is `pool >= Σ ledger` broken in the direction no row can fix.

Leaving the order at `purchased` with a NULL deal id is not a loose end. It is the exact row
shape `escrow-exposure.repository.ts` already describes as legitimate, it keeps the money
visible in `inEscrowMinor` (which is where it probably is), and api-design §6 already
assigns it an owner: the **confirmation-retry** cron job, *"`onchain_deal_id IS NULL` past a
grace period → retry or fail"*, which is API-10's.

### ⚠️ Spec amendment

**FR-017 as written said "when the escrow call fails or does not confirm"**, and US2
scenario 1 said *"an escrow call that fails or never confirms"*. Read literally, both put
the unknown outcome in the compensating branch. FR-017, FR-021, US2 scenario 1 and the
Assumptions in [spec.md](./spec.md) are amended to separate the two, and a new US2 scenario
covers the unknown branch. `SC-002` stands unchanged — a *forced* failure is a knowable one.

**Alternatives considered**: compensating on unknown and reversing later if the deal turns
up. The reversal needs a reconciler that does not exist, and until it runs the platform is
insolvent by the price of the order. Retrying `openDeal` on unknown is worse still and for
the reason `chain/errors.ts` spells out — the retry opens a second deal against the same
order.

---

## R4 — One transaction, one lock, and an ordering the foreign key forces

**Decision**: the purchase's Postgres phase is one `dataSource.transaction`, in this order:

```text
BEGIN
  SELECT accounts.id WHERE id = :buyer FOR UPDATE   -- serialise this buyer's writers
  SELECT COALESCE(SUM(amount_minor),0) FROM ledger_entries WHERE account_id = :buyer
  refuse if the sum < price                          -- nothing written yet
  INSERT INTO orders (...)                           -- must precede the ledger row
  INSERT INTO ledger_entries (kind='purchase', -price, order_id)
COMMIT
```

**Rationale**: FR-007 and FR-008 require the affordability check and the debit to be one
indivisible operation, and `ledger.repository.ts` already argues at length why the lock goes
on the `accounts` row rather than on `ledger_entries` — the competing writer is an `INSERT`,
so there is nothing in `ledger_entries` for a lock to cover. That argument transfers
unchanged; this feature is its second caller.

**The order insert must precede the ledger insert** because `ledger_entries.order_id`
carries `REFERENCES orders(id)`. Writing the debit first would fail the foreign key. This is
not a preference and it is worth stating, because the spec's phrasing ("record the order and
debit the price") reads as simultaneous and the natural implementation of "money first" does
not compile against the schema.

`LedgerRepository.debitWithBalanceCheck` cannot be reused as-is: it opens its own
transaction (so it cannot enlist in the order insert's) and it hardcodes
`LedgerKind.Offramp`. It is refactored — the lock/sum/refuse core moves to a private helper
taking an `EntityManager`, and a new public `debitWithinTransaction(manager, {...})` exposes
it with a caller-supplied `kind` and `orderId`. The existing offramp signature and behaviour
are unchanged.

**Alternatives considered**: `SERIALIZABLE` isolation, an advisory lock, and an in-process
mutex — all three already rejected with reasons in `ledger.repository.ts`, and nothing about
a purchase changes those reasons.

---

## R5 — `orders` has no `input` column, and this feature needs one

**Decision**: **a migration.** Add `orders.input jsonb NOT NULL`.

**Rationale**: this is a real gap in the schema rather than a design choice, and it blocks
the feature.

`POST /orders` accepts `input` (the UI's `CreateOrderRequest` declares it, and FR-003
validates it against the version's `inputSchema`). The only column in the database that can
hold it today is `runs.input` — and the run row is written by **execution**, which is API-08
and does not exist. So between the purchase committing and execution starting there is
nowhere for the buyer's input to live.

The three ways out, and why this one:

| Option | Why not |
| --- | --- |
| Create the `runs` row at purchase | `runs.output IS NULL` is the **non-delivery evidence** (invariant #7). A run row created at purchase makes every not-yet-started order indistinguishable from an agent that produced nothing. It also contradicts the UI's `Order.run: OrderRun \| null`, whose comment states `null` means *"a `purchased` order has not started"* |
| Hold the input in memory and pass it at dispatch | Does not survive a restart, which is the exact case the reaper exists for (api-design §6). An order the reaper re-picks would have no input to run |
| **Add `orders.input`** | ✅ The order becomes a self-contained record of what was bought — which is what it is |

`runs.input` stays. It is not made redundant: it records what was actually sent to the
agent, which is evidence, while `orders.input` records what the buyer paid for. In the MVP
they will be equal; the case file quotes the order's copy, so an order that never ran still
has an input to show (FR-038, FR-040).

`NOT NULL` with no default, matching `acceptance_criteria` beside it. There is no existing
row to backfill — `orders` is empty, this feature writes the first one.

**Alternatives considered**: `jsonb` vs `text`. `jsonb` matches `runs.input`,
`input_schema` and `output_schema`, and lets the column be read back as an object without a
parse step.

---

## R6 — The zero-review-window guard already exists, twice

**Decision**: no new validation. Snapshot `REVIEW_WINDOW_SECONDS` onto `orders.review_window_seconds`
at purchase and pass the same value to `openDeal`.

**Rationale**: FR-014 requires the platform to refuse a zero or absent review window rather
than open a deal with one. Both halves are already built:

- `config/env.schema.ts` declares `REVIEW_WINDOW_SECONDS` with `.int().min(1)` and **no
  default**, and the schema is parsed once at boot. A missing or zero value is a startup
  failure, not a runtime branch — which is stronger than what FR-014 asks for, since there
  is no running process in which the bad value exists.
- `orders` carries `CHECK (review_window_seconds > 0)` independently.

`smart-contract.md` §11.3 lists an unbounded `reviewWindow` as an accepted on-chain risk
and §11.2 step 5 assigns the guard to the backend. This is where that guard was assigned,
and it is already discharged by configuration rather than by code — which is the right place
for it, because a config guard cannot be bypassed by a caller.

The snapshot matters separately (FR-011): the demo turns this value down to seconds and back
up between rehearsals, and an order must show the window it was actually sold under. The
UI's `Order.reviewWindowSeconds` comment makes the same point from the other side — *"the
countdown must be computed from this field and nothing else"*.

---

## R7 — Buyer-or-seller authorisation is one join, and every refusal is a `404`

**Decision**: one repository method resolves an order together with its version, its agent
and that agent's `owner_account_id`. The caller is authorised if
`order.buyerAccountId === account.id || agent.ownerAccountId === account.id`. Every other
outcome — no such order, malformed id, a party to neither side — is `404`.

**Rationale**: `orders` has no seller column, deliberately: it points at
`agent_version_id`, and the owner is reached `order → agentVersion → agent`
(invariant #6). Copying a seller id onto the order would make ownership a snapshot, and the
two reads would then authorise against who owned the agent at purchase rather than who owns
it now.

FR-036 requires the refusal not to reveal whether the order exists, which rules out `403`.
This is the same reasoning `catalog.errors.ts` gives for `AgentNotFoundError` covering three
distinct facts behind one `404`, and the same asymmetry it flags: a `403` here would make
the route an existence oracle for other people's order ids.

`OrderNotVisibleError` is therefore one error class for two facts, by construction, so no
controller can accidentally say which applied.

**Alternatives considered**: two queries (load, then authorise). Same result, one extra
round trip, and it puts the ownership resolution at each of the five call sites instead of
one.

---

## R8 — `accept` and `complain` **do** use the chain-inside-the-transaction shape

**Decision**: both wrap their Postgres write and their escrow call in one transaction, 006
R8 style. They differ only in what they do with `ChainOutcomeUnknownError`:

| | Knowable failure | Unknown outcome |
| --- | --- | --- |
| `accept` | rollback | **rollback** |
| `complain` | rollback | **commit** |

**Rationale**: R2's argument does not apply to either, because neither moves money into a
place we could lose track of — the escrow already holds it, and the order row already exists
to describe it. A rollback here loses nothing but the attempt.

The asymmetry on the unknown branch is deliberate, and the rule behind it is **choose the
branch whose bad case is a stale label rather than stranded money**:

- **`accept`, rolled back.** If the call did not land, the order stays `delivered` and the
  sweeper releases it when the window expires — the flow self-heals and the seller is paid.
  If it did land, the deal is `Settled`, the sweeper's `release` reverts, and the order sits
  at `delivered` with a stale label over money that already reached the seller correctly.
  Committing instead would mark the order `released`, which takes it out of the sweeper's
  query — so if the call had *not* landed, nothing would ever settle it and the seller would
  go unpaid.
- **`complain`, committed.** The complaint is the buyer's testimony and it is not
  reproducible: rolling it back discards what they wrote. Worse, if the `dispute` did land,
  the deal is `Disputed`, `release` reverts forever, and a second complaint fails too —
  the buyer is locked out of a dispute the chain already thinks they filed. Committing
  keeps the complaint, lets the audit proceed, and if the dispute did *not* land the
  audit's `resolve` reverts loudly rather than silently.

Both unknown branches log at `error` with the tx hash, following
`agent-writes.service.ts`'s precedent for the same class of event.

---

## R9 — Complaining about a `failed` order marks it delivered first

**Decision**: `POST /orders/:id/complain` against an order in `failed` calls
`markDelivered(dealId)` and then `dispute(dealId)`, inside the same transaction, before
committing the complaint.

**Rationale**: this is the spec's resolved clarification (FR-034, FR-035). The contract
requires state `Delivered` before `dispute` (`smart-contract.md` §4.4) and a failed run
never called `markDelivered`, so without this the demo's closing act — a crashed agent, a
buyer complaining, a 100% verdict — cannot be driven through the endpoint at all.

**FR-035's constraint is what makes it safe**: `markDelivered` is called here and nowhere
else on a failed order. Marking a crashed deal delivered at the moment of the crash would
start the on-chain review window with the deal in `Delivered`, and `release()` is
permissionless — anyone could pay a seller who delivered nothing. Confining it to the
complaint keeps that window to the width of two sequential calls in one transaction.

The order between them is forced: `dispute` requires `Delivered`. If `dispute` fails after
`markDelivered` succeeded, the transaction rolls back the complaint but the on-chain
`markDelivered` stands — the deal is now `Delivered` and releasable when the window expires.
That is the one genuinely irreversible half-step in this feature. It is logged at `error`
with both tx hashes, and the buyer can retry the complaint, whose `markDelivered` will
revert harmlessly (the deal is no longer `Open`) — so the retry path is to call `dispute`
alone when the deal is already `Delivered`. The service therefore branches on the **deal's**
state read from chain, not on the order's, before deciding whether `markDelivered` is
needed.

**Alternatives considered**: having execution call `markDelivered` on crash (moves the
change to API-08 and leaves every crashed deal releasable for a full review window), and
refusing complaints on failed orders (costs Act 3 its verdict). Both were put to the user at
spec time and this branch was chosen.

---

## R10 — The case file is one route, two repository methods, two closed mappers

**Decision**: `GET /orders/:id/case-file` resolves the caller's role, then takes one of two
paths that do not meet. The buyer's path uses a repository method whose `SELECT` does not
name `system_prompt`; the seller's uses one that does. Each feeds a mapper whose parameter
type matches, and the two response interfaces are separate closed types.

**Rationale**: 006 FR-030 forbade one route branching on the caller, and this feature's
FR-035 requires exactly that — the UI reads one path for both parties
(`ui/src/api/sales.ts`: *"the dispute screen follows the order directly through
`GET /orders/:id`"*, and `useCaseFile` likewise). The tension is real and it is resolved by
being precise about *what* must not branch.

What 006 was protecting was the **serialiser**: a mapper with a mode flag is a conditional
deciding what a caller may see, and a bug in it is a disclosure. That property is preserved
here — no mapper branches, and the buyer's mapper is structurally unable to emit a prompt
because its parameter type has no such member, exactly as `agent-serialiser.ts`'s
`ListingFields` does.

What does branch is the **route**, one level above, at the point where the caller's identity
is already known and has already been checked. And the branch is pushed down into the query
so the buyer's path never has the field in-process at all — layer 1 of `agent-serialiser.ts`'s
three, which is the only layer that also protects a log line and a stack trace.

**Alternatives considered**: two routes (`/case-file` and `/case-file/full`). It would
match 006 exactly and it contradicts api-design §3.4, this feature's spec, and the UI's
already-written `useCaseFile`. Rejected on the contract, not on the design.

---

## R11 — The buyer's step summary is platform-authored, never model prose

**Decision**: the buyer's `CaseFileStep.summary` is built from the step's structured fields
— what kind of action it was, whether it produced output, whether it errored. Model-authored
reasoning text is **dropped**, not shortened. The seller's copy carries steps as recorded.

**Rationale**: FR-042 requires reasoning to be summarised rather than passed through,
because a reasoning turn can quote the instructions it was given (`ui-design.md` §7.1, and
`agent-serialiser.ts` already flags this as the extension the boundary would need). The
question is what "summarise" may be implemented as, and truncation is the trap: the first
two hundred characters of a paraphrase are still a paraphrase, and the leak is at the
start of the sentence, not the end.

An LLM summarisation pass would be faithful to the word and costs a model call inside a read
the dispute screen polls. Dropping the prose and describing the step from its own structure
is cheap, deterministic, and safe by construction — there is no code path from the model's
text to the buyer's response, which is the same standard invariant #3 is held to everywhere
else.

The UI's `CaseFileStep` already types `summary` as `string | null` and states that the type
*"has no `prompt`, no `systemPrompt`, no `reasoning`, and no `raw` field, and that absence
is the guarantee"* — so a null or a terse platform sentence is what the screen is built to
render.

**This decision creates a contract API-08 must write against**: steps are objects carrying
a `kind`, an optional `label`, timings, and an optional `error`, with any model prose in a
field the buyer's mapper does not read. The shape is fixed in
[data-model.md](./data-model.md) §5. Until API-08 exists, `runs` has no rows and every case
file returns `steps: []`.

---

## R12 — Four of the five wire shapes are already declared by the UI

**Decision**: `CreateOrderRequest`, `CreateOrderResponse`, `Order`, `CaseFile`,
`CaseFileStep`, `ComplainRequest` and `Sale` are transcribed field-for-field from
`ui/src/api/types.ts`. `GET /orders` is the one shape this feature defines, because
`MyOrdersPage.tsx` is still a `PagePlaceholder` and no type exists for it.

**Rationale**: `docs/openapi.yaml` still does not exist — API-12 is written but unbuilt — so
`ui/src/api/types.ts` is the contract in force, exactly as it was for 005 and 006. Those
types carry `NOTE: field names are provisional` on the order shapes, which is an invitation
to reconcile rather than to diverge; reconciling means matching them, since the client is
built and the server is not.

Two consequences worth naming:

- **`Order` has no `agentId`.** It carries `agentName`, which the backend resolves through
  the pinned version. Nothing on the order screen navigates back to the listing.
- **`Order.run` is `{ input, output }` and carries no steps**, on purpose — the UI comment
  calls the absent property the guarantee. Steps appear only in the case file, redacted.

For `GET /orders` this feature defines `BuyerOrderSummary`, mirroring `Sale` field for field
and adding `deliveredAt` (FR-045 asks for the timings, and the My Orders list is where a
buyer sees which orders are waiting on them).

---

## R13 — There is no dispatcher; `purchased` with a deal id **is** the queue

**Decision**: `POST /orders` answers as soon as the deal id is stored, and leaves the order
in `purchased`. It calls nothing to start execution and defines no dispatcher interface.
API-08 consumes `state = 'purchased' AND onchain_deal_id IS NOT NULL` and owns the move to
`running`.

**Rationale**: invariant #9 — *"`orders.state` is the queue. No Redis, no BullMQ; a cron
reaper catches anything stuck."* An order sitting in `purchased` with a confirmed deal id is
already, exactly, a queue entry. Adding a dispatcher port with a no-op implementation would
be inventing an interface for a consumer that does not exist yet and that will be free to
design its own, and the no-op would be indistinguishable from a broken dispatch.

FR-023 requires that the handoff not be a condition of answering, which this satisfies in
the strongest available form: there is nothing to await.

api-design §4's diagram shows step 4 setting `state = running`. That is the same handoff
described from execution's side; which module performs the transition is not fixed by the
diagram, and putting it in API-08 keeps the state that means *"a worker has picked this up"*
under the control of the worker that picked it up.

**Alternatives considered**: emitting a Nest event, or injecting an `ExecutionDispatcher`
token. Both add a seam this feature cannot exercise and API-08 would inherit rather than
choose.

---

## R14 — ⚠️ `ESCROWED_ORDER_STATES` is correct and its query is about to become wrong

**Decision**: `EscrowExposureRepository.sumOpenOrderValueMinor` gains one predicate —
it excludes orders where `state = 'failed' AND onchain_deal_id IS NULL`. The state list is
unchanged.

**Rationale**: FR-020 requires an order whose escrow call failed to contribute nothing to
`inEscrowMinor`. Today it would contribute its full price, because `failed` is in
`ESCROWED_ORDER_STATES` — and that membership is correct and must stay.

`failed` covers two situations this feature is the first to be able to tell apart:

| Situation | Deal id | Ledger | Escrowed? |
| --- | --- | --- | --- |
| Execution ran and produced nothing (API-08) | **set** | debit stands | ✅ yes — tokens are in escrow until the reclaimer sweeps them |
| `openDeal` failed and we compensated (this feature) | **NULL** | debit + compensating credit | ❌ **no** — nothing was ever escrowed, and the balance is already whole |

Counting the second would show the buyer the same cents twice: restored to
`availableBalanceMinor` by the compensating credit *and* still sitting in `inEscrowMinor`.
`order-states.ts`'s existing comment argues at length that dropping `failed` from the state
list would make a buyer's money vanish from every figure at once; that argument is about the
first row of the table and it stands. This is the second row, which did not exist when that
comment was written.

**⚠️ This is deliberately not the change that file warns against.** Its ⚠️ says: *"Filter by
STATE only. Never add `AND onchain_deal_id IS NOT NULL`."* The warning is right — that
predicate would drop a mid-saga `purchased` order whose debit is written and whose deal id
has not landed yet, and the buyer would watch their balance fall with nothing rising. R3
makes that row shape not merely possible but the defined unknown-outcome resting state.

The predicate added here is narrower and does not touch it: **`failed` *and* NULL**, which is
reachable only through the compensating branch, because that branch is the only writer of
`state = 'failed'` with a NULL deal id. A `purchased` order with a NULL deal id still counts,
which is exactly what the warning protects. Both `order-states.ts` and the repository's
doc-comment are updated to record the distinction, so the next reader meets the refined rule
rather than a warning their change appears to violate.

---

## R15 — No new indexes

**Decision**: none. `GET /sales` runs a two-hop join with no supporting index.

**Rationale**: `orders_buyer_idx ON (buyer_account_id, created_at DESC)` already covers
`GET /orders` including its sort. `GET /sales` joins `orders → agent_versions → agents` and
filters on `agents.owner_account_id`, for which nothing exists — but the join is over primary
keys on both hops and the outer filter is over a table holding three rows at demo scale.
`docs/CONTEXT.md` §6 puts pagination out of scope, so the query is unbounded by design and
still returns tens of rows.

An index on `agents (owner_account_id)` would be the right first move if this were ever
slow. It is not, and adding it now would be a migration carrying an index nothing measured.

---

## Open items — deliberately not resolved here

- **Reconciling an unknown-outcome `openDeal`.** R3 leaves the order in `purchased` with a
  NULL deal id and names api-design §6's confirmation-retry job as its owner. That job is
  API-10. Until it exists, such an order is inert and its money shows as escrowed.
- **The `markDelivered`-succeeded-`dispute`-failed half-step** (R9). Recovery is by retrying
  the complaint, which the service handles by reading the deal's on-chain state first. No
  automatic reconciler.
- **`GET /orders/:id/verdict`** is API-09's, and out of scope here by the spec's Assumptions.
- **Idempotency keys on `POST /orders`.** `ui/src/api/orders.ts` documents at length that the
  call is not idempotent and must never be auto-retried, and offers to delete that comment
  *"if API-07 ever accepts a client-supplied idempotency key"*. It does not. Out of scope by
  the spec's silence, and the UI's rule stands.
