# Implementation Plan: Orders & the Purchase Saga

**Branch**: `007-orders-purchase-saga` | **Date**: 2026-08-09 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/007-orders-purchase-saga/spec.md`

## Summary

Seven endpoints in the existing `src/orders/` module, **one migration**, and two edits to
files this feature does not own.

**Most of what this feature needs is already built, and better than the brief assumes.**
`EscrowOperatorService` wraps `openDeal`, `markDelivered`, `accept` and `dispute` in the
platform's own vocabulary, recovers the deal id from the `DealOpened` log rather than from
the function's declared return value, and maps a receipt timeout to
`ChainOutcomeUnknownError`. `LedgerRepository` already owns an account-row lock that makes a
check-then-insert safe. `REVIEW_WINDOW_SECONDS` is already `.int().min(1)` with no default,
so FR-014's zero guard is discharged at boot rather than at runtime. `agent-serialiser.ts`
already exists and already names this feature's extension in its own doc-comment.

Four decisions carry the feature, all argued in [research.md](./research.md):

- **The purchase inverts 006's transaction shape** (R2). The catalogue puts its chain call
  *inside* the uncommitted transaction so a failure records nothing. A purchase must do the
  opposite — commit first, then call, then compensate — because a rollback here would delete
  the only record of whose money is in escrow.
- **`openDeal` has three outcomes and only one of them compensates** (R3). A receipt timeout
  is not a failure. Compensating it is the single change in this feature that could break
  solvency in the direction no later row can fix.
- **`accept` and `complain` go back to 006's shape** (R8), because neither can strand money
  — and they differ from each other on the unknown branch, for a reason stated there.
- **The case file is one route, two queries, two closed mappers** (R10). The route branches
  on the caller; the serialiser does not, and the buyer's path never fetches the column.

### The migration this feature needs, and why it is not optional

**`orders` has no `input` column.** (R5) `POST /orders` accepts the buyer's input, and the
only place in the schema that can hold it today is `runs.input` — a row written by
execution, which is API-08 and does not exist. Between the purchase committing and execution
starting, there is nowhere for the input to live.

Creating the `runs` row early is the tempting fix and it destroys invariant #7:
`runs.output IS NULL` is the non-delivery evidence, and a run row created at purchase makes
every not-yet-started order look like an agent that returned nothing. Holding the input in
memory does not survive the restart the reaper exists for. So: `orders.input jsonb NOT NULL`,
one migration, no backfill — `orders` is empty and this feature writes the first row.

### One spec correction, made during planning

**FR-017 as written compensated a purchase whose escrow call "fails or does not confirm".**
Those are two different events. A call known to have failed escrowed nothing, so restoring
the balance restores the buyer completely; a call whose receipt never arrived may still
confirm, and crediting the money back while it is simultaneously locked on-chain breaks
`pool >= Σ ledger` — the solvency relationship every other guarantee rests on, broken in the
direction no row can repair. `chain/errors.ts` calls this distinction *"THE MOST IMPORTANT
ERROR IN THIS MODULE"* and states the rule in the class comment.

FR-017, FR-021, US2 scenario 1 and the Assumptions are amended in [spec.md](./spec.md);
FR-017a and two US2 scenarios are added for the unknown branch. SC-002 stands unchanged — a
*forced* failure is a knowable one.

### ⚠️ Two edits to files this feature does not own

Both carry existing ⚠️ comments, and in one case the comment warns against a change that
looks like the one being made.

- **`orders/escrow-exposure.repository.ts`** (R14). FR-020 requires a purchase whose escrow
  call failed to contribute nothing to `inEscrowMinor`. Today it contributes its full price,
  because `failed` is in `ESCROWED_ORDER_STATES` — and that membership is *correct*, because
  API-08's `failed` (execution produced nothing, deal open, money escrowed) is a different
  situation from this feature's `failed` (escrow call refused, nothing locked, balance
  already restored). The two are told apart by `onchain_deal_id`, and the added predicate is
  **`state = 'failed' AND onchain_deal_id IS NULL`** — narrower than the
  `AND onchain_deal_id IS NOT NULL` the file's ⚠️ forbids, and it does not touch the
  mid-saga `purchased` row that warning protects. Both doc-comments are updated so the next
  reader meets the refined rule rather than a warning their change appears to violate.
- **`ledger/ledger.repository.ts`** (R4). `debitWithBalanceCheck` opens its own transaction
  and hardcodes `LedgerKind.Offramp`, so a purchase cannot enlist the debit in the same
  transaction as the order insert. The lock/sum/refuse core moves to a private helper taking
  an `EntityManager`; a new `debitWithinTransaction` exposes it with a caller-supplied `kind`
  and `orderId`. The offramp path's signature and behaviour are unchanged.

### One handoff this plan creates, and one it declines to create

**Creates**: the execution step shape (R11). The buyer's case file summarises steps from
their structure rather than from model prose, which fixes what API-08 must write into
`runs.steps` — a `kind`, an optional label, timings, an optional error, and any model text in
a field the buyer's mapper does not read. Fixed in [data-model.md](./data-model.md) §5.

**Declines**: a dispatcher (R13). `POST /orders` answers and leaves the order in `purchased`
with a confirmed deal id, which is already a queue entry under invariant #9. No port, no
no-op implementation — a no-op dispatcher is indistinguishable from a broken one, and API-08
should choose its own trigger.

### What this plan deliberately does not build

Running the agent (API-08), the audit and the verdict read (API-09), and every cron job
including the sweeper, the reclaimer, the reaper and the confirmation retry (API-10). No
pagination, no search, no idempotency key — `ui/src/api/orders.ts` documents the
no-auto-retry rule that depends on there being none, and that rule stands.

## Technical Context

**Language/Version**: TypeScript 6.0.3 on Node ≥22, NestJS 11. No `tsconfig.json` change.

**Primary Dependencies**: **none added.** `ajv` (added by 006) validates the buyer's input
against the version's `inputSchema` — `compile()` rather than `validateSchema()`, the other
half of the library 006 already brought in. viem, TypeORM, zod, `@nestjs/*` all present.

**Storage**: PostgreSQL via TypeORM. **One migration**: `orders.input jsonb NOT NULL` (R5).
Tables touched: `orders` (insert, update, read), `ledger_entries` (insert), `complaints`
(insert), `accounts` (row lock), `agent_versions` + `agents` (read, join), `runs` (read only
— nothing here writes one).

**Testing**: **None.** Automated tests are out of scope for `api/` (`docs/CONTEXT.md`).
[quickstart.md](./quickstart.md) is the verification procedure, written to be run by hand
before every rehearsal.

**Target Platform**: Linux container, Docker Compose, against Monad testnet.

**Project Type**: Web service (NestJS REST API).

**Performance Goals**: none that bind. `POST /orders` is allowed to take as long as a
receipt takes — up to `RECEIPT_TIMEOUT_MS` = 30 s — and the UI's client timeout is 10 s,
which is why that call is documented as non-idempotent on both sides. `GET /orders/:id` is
polled at 1 s by the order screen and is a single joined read.

**Constraints**: cents outside `chain/` (invariant #2). Ledger append-only (#4). Settlement
writes no ledger entry (#5). Orders pin `agent_version_id` (#6). `runs.output IS NULL` is
evidence (#7). `orders.state` is the queue (#9). `system_prompt` never reaches a buyer (#3),
now extended to reasoning text in the case file.

**Scale/Scope**: demo scale — a handful of orders per rehearsal, one concurrent buyer except
where the double-spend check is deliberately exercised.

## Constitution Check

`.specify/memory/constitution.md` is an **unfilled template** — every principle is still a
`[PRINCIPLE_N_NAME]` placeholder. There are no ratified gates to evaluate, so this section
cannot pass or fail on its own terms.

The project's real governing document is `api/docs/CONTEXT.md` §2, and this plan is checked
against its nine invariants instead:

| # | Invariant | Status |
| --- | --- | --- |
| 1 | Two-phase flows ordered so a crash leaves the safe side | ✅ **This is the feature.** R2 — Postgres commits first because it is the recoverable side; R3 — the unknown branch does not compensate, which is the same invariant applied to the case where "did it happen" is unanswered |
| 2 | One money unit: cents outside `chain/` | ✅ `priceMinor` is cents from the version row to the ledger to `openDeal`. No `toBaseUnits` outside the existing calls inside `EscrowOperatorService` |
| 3 | `system_prompt` never reaches a buyer | ✅ R10 — the buyer's case-file query does not select the column; R11 — reasoning prose is dropped, not truncated, so the wider boundary `ui-design.md` §7.1 describes is built here rather than promised |
| 4 | Ledger append-only | ✅ The compensating credit is a **new** `adjustment` row beside the standing debit. No `UPDATE` path is added to `LedgerRepository` (FR-019) |
| 5 | Settlement writes no ledger entry | ✅ `accept` and `complain` write no ledger row at all (FR-028). `LedgerKind` has no `settlement` member and none is added |
| 6 | Orders point at `agent_version_id` | ✅ The insert takes the version id; `agentName` and the case file's promise are resolved *through* it (R7, R12). No `agent_id` column is added |
| 7 | `runs.output IS NULL` is evidence | ✅ **R5 is this invariant defended.** Nothing here writes a `runs` row, which is why `orders.input` had to exist |
| 8 | Verdict persisted before the chain call | ➖ not touched — API-09 |
| 9 | `orders.state` is the queue | ✅ R13 — no dispatcher, no broker. `purchased` + non-null deal id is the queue entry API-08 consumes |

**Module boundaries** (`docs/CONTEXT.md` §3) hold: `orders` owns the saga, accept, complain
and the case file — exactly its assigned scope — and `chain` remains the only module that
talks to Monad. No viem client is imported; only `EscrowOperatorService` and
`EscrowReadService`, both already exported by `ChainModule`.

**One boundary is crossed deliberately**: `ledger/ledger.repository.ts` is refactored to let
a purchase's debit enlist in the caller's transaction (R4). That module's own doc-comment
anticipates it in writing — *"API-06 will add the `purchase` debit through the same
`appendEntry`"* — and the change adds no `UPDATE` path, which is the property that module
exists to guarantee.

**One gate genuinely fails, and it is the project's own choice**: no automated tests. A
recorded, time-boxed MVP decision in `docs/CONTEXT.md`, not a gap this plan introduces. See
Complexity Tracking.

## Project Structure

### Documentation (this feature)

```text
specs/007-orders-purchase-saga/
├── plan.md              # This file
├── research.md          # Phase 0 — 15 decisions
├── data-model.md        # Phase 1 — the migration, the state machine, the step shape
├── quickstart.md        # Phase 1 — the manual test suite, including the forced failure
├── contracts/
│   └── internal-api.md  # Phase 1 — seven routes, literal fields, failure tables
├── checklists/
│   └── requirements.md
├── spec.md
└── tasks.md             # /speckit-tasks — NOT created here
```

### Source Code (repository root)

```text
api/src/
├── orders/                                 # EXISTING MODULE — extended in place (R1)
│   ├── orders.module.ts                    # MODIFIED — controllers, services, imports
│   ├── orders.controller.ts                # NEW — /orders: create, list, get, case-file,
│   │                                       #   accept, complain
│   ├── sales.controller.ts                 # NEW — /sales, the seller's side (R1)
│   ├── purchase.service.ts                 # NEW — the saga; owns the commit-then-chain
│   │                                       #   ordering and the three outcomes (R2, R3)
│   ├── settlement.service.ts               # NEW — accept + complain; chain inside the
│   │                                       #   transaction, two unknown branches (R8, R9)
│   ├── orders.service.ts                   # NEW — the four reads
│   ├── case-file.service.ts                # NEW — assembly; two paths that do not meet (R10)
│   ├── order.repository.ts                 # NEW — the saga's transaction, the join that
│   │                                       #   resolves buyer-or-seller, the two case-file
│   │                                       #   queries (one selects system_prompt, one
│   │                                       #   cannot)
│   ├── order-serialiser.ts                 # NEW — buyer-facing mappers; closed types,
│   │                                       #   no branch (R10, R11)
│   ├── orders.errors.ts                    # NEW — OrderNotVisibleError, InvalidOrderState-
│   │                                       #   Error, ComplaintWindowClosedError,
│   │                                       #   AlreadyComplainedError, AgentNotPurchasable-
│   │                                       #   Error, InvalidOrderInputError
│   ├── orders-http.ts                      # NEW — the one place those become statuses
│   ├── order-states.ts                     # MODIFIED — ⚠️ the failed/NULL distinction (R14)
│   ├── escrow-exposure.repository.ts       # MODIFIED — ⚠️ one predicate (R14)
│   └── dto/
│       ├── create-order.dto.ts             # zod; input is passed through, validated
│       │                                   #   against the version's inputSchema by ajv
│       ├── complain.dto.ts                 # { reason }, non-blank
│       ├── order-response.dto.ts           # Order, BuyerOrderSummary, Sale — closed
│       └── case-file.dto.ts                # BuyerCaseFile, SellerCaseFile — two types,
│                                           #   not one with optionals (R10)
│
├── ledger/
│   └── ledger.repository.ts                # MODIFIED — debitWithinTransaction (R4)
│
├── entities/
│   └── order.entity.ts                     # MODIFIED — the `input` column, and a
│                                           #   doc-comment on what a NULL deal id now
│                                           #   means in each state (R3, R14)
│
├── migrations/
│   └── <ts>-OrderInput.ts                  # NEW — orders.input jsonb NOT NULL (R5)
│
└── app.module.ts                           # unchanged — OrdersModule is already registered
```

**Structure Decision**: single NestJS project, one module per `docs/CONTEXT.md` §3
responsibility. `orders/` already exists and is extended in place, as its own doc-comment
instructs.

Four structural judgements worth flagging:

**The saga is its own service, separate from the reads and from settlement.** Three services
rather than one `OrdersService`, on the split `catalog/` already made: `purchase.service.ts`
holds an account-row lock across a transaction that commits before a chain call,
`settlement.service.ts` holds chain calls inside transactions that roll back, and
`orders.service.ts` holds no transaction at all. Those are three different disciplines and
mixing them puts a `FOR UPDATE` one careless edit away from the read the order screen polls
every second.

**`case-file.service.ts` is separate from `order-serialiser.ts`**, for the reason
`agent-versions.service.ts` is separate from `agent-serialiser.ts`: the seller's copy is the
one mapping that must see `systemPrompt`, and it does not belong behind a boundary defined
by not having it.

**`orders-http.ts` mirrors `catalog-http.ts`.** The services throw plain errors and one file
maps them to statuses, because this feature has the same non-obvious asymmetry the catalogue
does — `OrderNotVisibleError` is always `404`, never `403`, and the reason is that a `403`
would confirm the order exists to someone who is party to neither side (FR-036, R7).

**`GET /sales` gets its own controller**, not a second route on `/orders`. Different path
prefix, different side of the trade, and `ui/src/api/sales.ts` made the same split for the
same reason.

## Phase 0 — Research

Complete. 15 decisions in [research.md](./research.md). No `NEEDS CLARIFICATION` markers
survived: the spec's one open question was resolved with the user at spec time (R9), and
this phase resolved the implementation-level ones. One decision (R3) resolved a conflict
between the spec's wording and a safety property of the chain adapter, and the spec was
amended.

## Phase 1 — Design & Contracts

Complete:

- **[data-model.md](./data-model.md)** — the one migration and why it is not optional; the
  order state machine with the on-chain state beside each row; what a NULL `onchain_deal_id`
  means in each state; the escrow-exposure predicate; the execution step shape API-08 must
  write.
- **[contracts/internal-api.md](./contracts/internal-api.md)** — seven routes with
  **literal** paths, field names transcribed from `ui/src/api/types.ts`, a failure table per
  endpoint, and the handoffs to API-08, API-09, API-10 and API-12.
- **[quickstart.md](./quickstart.md)** — the manual verification procedure. Four sections are
  load-bearing: the forced chain failure with a before/after balance comparison, the
  concurrent double-spend attempt, the seller opening a sale they did not buy, and the
  sentinel sweep for the seller's prompt across every buyer-facing response.

### Post-design constitution re-check

No change. No new dependency, no new module boundary beyond the `ledger/` refactor already
declared, no invariant weakened.

Three things the design added were re-checked and hold:

**Invariant #4** against the compensating branch — the credit is an `INSERT` of kind
`adjustment` and the original debit is untouched, so a statement shows both. No `UPDATE`
path was added to `LedgerRepository`; `debitWithinTransaction` is an insert behind the same
lock as the method it was extracted from.

**Invariant #3** against the case file — verified at the query layer, not only the mapper.
The buyer's case-file query names its columns and `system_prompt` is not among them, so on a
buyer's read the prompt does not enter the process; R11 then removes the second, wider leak
by dropping model prose rather than shortening it.

**Invariant #1** against R14 — the escrow-exposure predicate was checked in both directions.
A mid-saga `purchased` order with a NULL deal id still counts (the case that file's ⚠️
protects), and a compensated `failed` order with a NULL deal id does not (FR-020). The two
are reachable only through different branches of the saga, which is what makes the predicate
exact rather than approximate.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| No automated tests | Time-boxed MVP decision recorded in `docs/CONTEXT.md`; only `sc/` keeps a suite | Not this feature's call to reverse — and this is the feature where it costs most, since the compensating branch and the double-spend guard are both invisible in normal use. Mitigated by [quickstart.md](./quickstart.md) §4 and §5 being explicit forced-failure procedures with before/after figures |
| A compensation path instead of 006's rollback | R2 — a rollback would delete the only record of whose money is in escrow, which invariant #1 names as the unrecoverable side | The 006 shape is genuinely better where it applies and is used here for accept and complain (R8). It cannot be used for the purchase, and pretending the two flows are the same shape is how the wrong one gets copied |
| A schema migration in a feature that expected none | R5 — `orders` cannot hold the buyer's input, and the two alternatives destroy invariant #7 or do not survive a restart | Creating the `runs` row at purchase is the change that looks free and silently converts every pending order into evidence of non-delivery |
| Editing `ledger/` from an orders feature | R4 — the debit must enlist in the order insert's transaction, and the existing method opens its own | Duplicating the lock-and-sum logic in `orders/` would put a second implementation of the solvency guard in the codebase, and the two would drift. The refactor keeps one |
| Editing `escrow-exposure.repository.ts` against its own ⚠️ | R14 — FR-020, and the file's warning addresses a different predicate than the one added | Leaving it produces a buyer who sees compensated money in two figures at once. Adding the predicate the ⚠️ actually forbids would make mid-saga money vanish from both. The distinction is narrow and is recorded in both doc-comments |
| Two chain calls in one complaint, not atomic (R9) | The escrow refuses `dispute` on a deal never marked delivered, and Act 3's whole point is a verdict on non-delivery | Having execution mark a crashed deal delivered leaves it releasable to a seller who delivered nothing for a full review window, and `release()` is permissionless. Confining it to the complaint bounds the exposure to two sequential calls |
