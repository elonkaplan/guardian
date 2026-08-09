---

description: "Task list for 007-orders-purchase-saga"
---

# Tasks: Orders & the Purchase Saga

**Input**: Design documents from `/specs/007-orders-purchase-saga/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[data-model.md](./data-model.md), [contracts/internal-api.md](./contracts/internal-api.md),
[quickstart.md](./quickstart.md)

**Tests**: **No test tasks.** Automated tests are out of scope for `api/` — a recorded,
time-boxed MVP decision in `docs/CONTEXT.md`. Verification tasks reference sections of
[quickstart.md](./quickstart.md) instead, and they are not optional: they are the only thing
standing in for a test suite. In this feature two of them (§4, §5) check branches that
cannot be reached by using the product normally.

**Organization**: Grouped by user story so each is independently implementable and
demonstrable.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on incomplete work)
- **[Story]**: US1–US5, mapping to the user stories in [spec.md](./spec.md)
- Every task names its exact file path

---

## Before you start — five things that will bite

1. **This feature's transaction shape is the OPPOSITE of the catalogue's, and copying the
   wrong one is the single most likely mistake here.** `catalog/agent-writes.service.ts`
   puts its chain call *inside* the uncommitted transaction so a failure records nothing.
   The purchase must commit **first**, then call, then compensate — because a rollback
   would delete the only record of whose money is in escrow ([R2](./research.md)).
   `accept` and `complain` go back to the catalogue's shape ([R8](./research.md)). Three
   flows, two shapes; check which one you are in before you write `dataSource.transaction`.

2. **`ChainOutcomeUnknownError` is not a failure, and compensating it is the one change in
   this feature that breaks solvency unfixably.** A receipt timeout may still confirm. If
   you credit the money back and the transaction lands, the buyer's balance is restored
   *and* their money is escrowed — `pool >= Σ ledger` broken in the direction no later row
   repairs ([R3](./research.md)). The unknown branch leaves everything alone. Quickstart
   **U3** is the check.

3. **`failed` means two different things and `onchain_deal_id` is the only thing that
   separates them.** `failed` + a deal id = the agent ran and produced nothing, money is in
   escrow. `failed` + NULL = the escrow call was refused and the buyer was already
   compensated, nothing is escrowed. Getting this wrong shows a buyer the same cents in two
   figures at once, and makes Act 3 either impossible or applicable to the wrong order
   ([R14](./research.md), [data-model §2](./data-model.md)).

4. **`orders` has no `input` column today.** T002 adds it. If you find yourself creating a
   `runs` row at purchase to hold the input instead, stop — `runs.output IS NULL` is the
   non-delivery evidence (invariant #7) and a run row created at purchase makes every
   pending order look like an agent that returned nothing ([R5](./research.md)).

5. **Field names are literal and the client is already written.**
   `ui/src/api/types.ts` declares `Order`, `OrderRun`, `CaseFile`, `CaseFileStep`, `Sale`,
   `CreateOrderRequest`, `CreateOrderResponse` and `ComplainRequest`, and
   `ui/src/api/orders.ts` and `sales.ts` call them. A rename renders as a missing countdown
   or an empty output panel, not an error. Copy from
   [contracts/internal-api.md](./contracts/internal-api.md), never from memory.

---

## Phase 1: Setup

**Purpose**: The one migration, and the doc-comments that currently describe behaviour this
feature will not have.

- [X] T001 Verify what already exists before writing anything: `orders`, `complaints` (with `order_id UNIQUE`), `runs` (with `order_id UNIQUE`), `ledger_entries.order_id REFERENCES orders(id)`, `CHECK (price_minor > 0)`, `CHECK (review_window_seconds > 0)` and `orders_buyer_idx` are all in `src/migrations/1786238842921-InitialSchema.ts`. Confirm `REVIEW_WINDOW_SECONDS` in `src/config/env.schema.ts` is `.int().min(1)` with **no default** — that is FR-014's zero guard, already discharged at boot ([R6](./research.md)). Produce no migration for any of these.
- [X] T002 Create `src/migrations/<timestamp>-OrderInput.ts` adding `orders.input jsonb NOT NULL` with no default and no backfill (`orders` is empty; this feature writes the first row). `down()` drops the column. This is the feature's only schema change — see warning 4 and [data-model §1](./data-model.md).
- [X] T003 In `src/entities/order.entity.ts`: add the `input` column (`@Column({ type: 'jsonb', name: 'input' }) input!: Record<string, unknown>`), and rewrite the `onchainDealId` doc-comment. It currently says only *"NULL = submitted, not yet confirmed on-chain"*, which describes one of the two situations. Replace with both: in `purchased` a NULL id means mid-saga **or** an unconfirmed receipt and the money may be escrowed, so it is left alone for API-10's confirmation-retry job; in `failed` a NULL id means the call was refused and the buyer was compensated, and nothing is escrowed. ⚠️ Add that `openDeal` must never be retried against a NULL id — the contract mints a second deal, the same trap `agent.entity.ts` documents for `registerAgent`, with money in it.
- [X] T004 [P] Update the closing paragraph of the docblock in `src/catalog/agent-serialiser.ts`. It says the run-step redaction *"belongs in this module"* and attributes it to **API-09**; the case-file route is API-07's, so it lands here. Point it at `src/orders/order-serialiser.ts` by path and state that reasoning prose is **dropped, not truncated** ([R11](./research.md)).

**Checkpoint**: `npm run migration:run` succeeds and `SELECT input FROM orders` resolves.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The errors, the status mapping, the wire types, the ledger refactor, and the
one join every read authorises against.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [X] T005 [P] Create `src/orders/orders.errors.ts` with an abstract `OrdersError` root (`this.name = new.target.name`, matching `catalog.errors.ts` and `chain/errors.ts`) and: `OrderNotVisibleError` (⚠️ **one class for two facts** — the order does not exist, or the caller is party to neither side; they must be indistinguishable, so no subclass may split them, [R7](./research.md)), `InvalidOrderStateError` (carrying the current `OrderState`), `ComplaintWindowClosedError`, `AlreadyComplainedError`, `AgentNotPurchasableError`, `OrderNotDisputableError` and `InsufficientFundsForPurchaseError` (carrying `availableBalanceMinor` and `priceMinor`).
- [X] T006 [P] Create `src/orders/orders-http.ts` exporting `toHttpException(err)`, mirroring `src/catalog/catalog-http.ts`: `OrderNotVisibleError` → **`404` always, never `403`** (a `403` confirms the order exists to someone probing uuids — FR-036); `AgentNotPurchasableError` → `404` with the same body the catalogue uses; `InsufficientFundsForPurchaseError` → **`402`** (well-formed request, refused by state); `InvalidOrderStateError` / `ComplaintWindowClosedError` / `AlreadyComplainedError` / `OrderNotDisputableError` → `409` naming the current state; unmapped `OrdersError` → rethrow; everything else → delegate to `common/chain-http.ts` so the `ChainOutcomeUnknownError`-first ordering stays in one place.
- [X] T007 [P] Create `src/orders/dto/create-order.dto.ts`: zod schema `{ agentId: uuid, input: z.record(z.unknown()), acceptanceCriteria: z.string().trim().min(1) }`. `input` is **passed through** here — its real validation is against the version's `inputSchema` and cannot happen until that row is read (T017). `.trim().min(1)` is FR-004: whitespace-only criteria are blank.
- [X] T008 [P] Create `src/orders/dto/complain.dto.ts`: zod `{ reason: z.string().trim().min(1) }`. Matches `ui/src/api/types.ts`'s `ComplainRequest` — one field, nothing else.
- [X] T009 [P] Create `src/orders/dto/order-response.dto.ts` with **closed** interfaces (no index signature, no `extends` from an entity, so spreading a row is a compile error): `CreateOrderResponse { id }`, `OrderRunResponse { input, output }`, `OrderResponse` (11 fields, transcribed from `ui/src/api/types.ts`'s `Order` — ⚠️ **no `agentId`**, and `reviewWindowSeconds` is the order's snapshot), `BuyerOrderSummary` (7 fields, defined by this feature — [contracts §2](./contracts/internal-api.md)) and `SaleResponse` (6 fields, transcribed from `Sale` — ⚠️ **no `buyerAddress`**).
- [X] T010 [P] Create `src/orders/dto/case-file.dto.ts`: `CaseFileStepResponse { label, summary, durationMs, error }`, `BuyerCaseFileResponse` (6 fields, transcribed from `ui/src/api/types.ts`'s `CaseFile`), and `SellerCaseFileResponse extends BuyerCaseFileResponse { systemPrompt, rawSteps }`. ⚠️ **Two types, not one with optional fields** — an optional `systemPrompt?` is a shape branch, which is exactly what [R10](./research.md) exists to prevent. Also declare the `ExecutionStep` interface from [data-model §5](./data-model.md); nothing here writes it, but API-08 must write against it.
- [X] T011 [P] Add `validateAgainstSchema(schema, data)` to `src/catalog/schema-validation.ts`, returning Ajv's errors rather than throwing. It goes in that file rather than a new one in `orders/` because that file already owns the single `Ajv2020` instance and documents its cache and `$ref`-registration behaviour at length; a second instance would duplicate reasoning that is easy to get subtly wrong. Note in the docblock that `assertValidJsonSchema` checks a document **is** a schema while this one checks data **against** a schema — two different jobs on one instance.
- [X] T012 Refactor `src/ledger/ledger.repository.ts` ([R4](./research.md)): extract the lock/sum/refuse core of `debitWithBalanceCheck` into a private helper taking an `EntityManager`, and add public `debitWithinTransaction(manager, { accountId, amountMinor, kind, orderId })` that runs it inside the caller's transaction. `debitWithBalanceCheck`'s signature and behaviour are unchanged. ⚠️ Add **no** `UPDATE` path — the append-only guarantee (invariant #4) is the property this class exists to hold, and the new method is an insert behind the same lock as the one it was extracted from.
- [X] T013 Create `src/orders/order.repository.ts` with the one join every read authorises against: `findVisibleToAccount(orderId, accountId)` joining `orders → agent_versions → agents`, returning the order, the pinned version's listing fields, `agents.owner_account_id`, and a `LEFT JOIN` of `runs`. Authorisation is `buyer_account_id === accountId || owner_account_id === accountId` and is decided on a row that was fetched anyway — never a second query ([R7](./research.md)). Return `null` for both "no such order" and "not a party", so the caller cannot tell them apart.
- [X] T014 Create `src/orders/orders.module.ts` — replace the existing stub, keeping `EscrowExposureRepository` exported (`AccountsModule` depends on it). Import `TypeOrmModule.forFeature([Order, Complaint])`, `ChainModule` (for `EscrowOperatorService` and `EscrowReadService`) and `LedgerModule`. Providers and controllers are added by each story phase. ⚠️ Do not import any viem client — `chain/` is the only module that talks to Monad.

**Checkpoint**: the app boots, `GET /me` still returns its three figures, nothing is exposed
yet.

---

## Phase 3: User Story 1 — A buyer purchases an agent and the money is locked in escrow (P1)

**Goal**: `POST /orders` validates, writes the order and the debit as one indivisible
operation, opens the escrow deal, and answers with the order id.

**Independent test**: with a funded buyer and a listed agent, place an order and confirm the
buyer's balance drops by exactly the price, the escrow holds the corresponding amount for a
deal whose id is on the order, and the response arrives without waiting for any agent work.
[quickstart §3](./quickstart.md) and [§5](./quickstart.md).

- [X] T015 [US1] Add `findPurchasableVersion(agentId)` to `src/orders/order.repository.ts`: the agent's **latest** version joined to its agent, returning `agent_version_id`, `price_minor`, `input_schema`, `agents.onchain_agent_id` and `agents.active`. Return `null` when the agent is unknown, inactive, **or** carries no on-chain id — one answer for three facts, the same rule `catalog.errors.ts` states (FR-002).
- [X] T016 [US1] Add `insertOrder(manager, {...})` and `setOnchainDealId(orderId, dealId)` to `src/orders/order.repository.ts`. The insert takes an `EntityManager` because it must enlist in the purchase's transaction; the deal-id update runs after the commit, on its own. ⚠️ The insert takes `agent_version_id`, never `agent_id` — there is no such column and adding one would be a defect (invariant #6).
- [X] T017 [US1] Create `src/orders/purchase.service.ts` with the validation half of `createOrder(account, dto)`, all of it **before** any transaction or chain call: resolve the version via T015 (throw `AgentNotPurchasableError` on null), then `validateAgainstSchema(version.inputSchema, dto.input)` (throw a `400` carrying Ajv's message and its JSON Pointer — FR-003). A bad input is a `400` the caller can fix and has no business costing a row lock or gas.
- [X] T018 [US1] Add the Postgres phase to `src/orders/purchase.service.ts` as one `dataSource.transaction`, in this exact order ([R4](./research.md), [data-model §3](./data-model.md)): `SELECT accounts.id … FOR UPDATE` on the buyer → sum the ledger **inside the transaction** → throw `InsufficientFundsForPurchaseError` if it is short (nothing written yet) → `insertOrder` → `debitWithinTransaction(manager, { kind: 'purchase', amountMinor: -price, orderId })`. ⚠️ **The order insert must precede the ledger insert** — `ledger_entries.order_id REFERENCES orders(id)`, so "money first" does not compile. Snapshot `price_minor` from the version row read inside the transaction and `review_window_seconds` from `REVIEW_WINDOW_SECONDS` (FR-011).
- [X] T019 [US1] Add the chain phase to `src/orders/purchase.service.ts`, **after the transaction has committed** (see warning 1): `escrow.openDeal(BigInt(onchainAgentId), account.walletAddress, reviewWindowSeconds)`, then `setOnchainDealId(order.id, Number(tx.value))`. Success path only in this task — the failure branches are US2. Log the order id, the deal id and the tx hash at `log`. ⚠️ Do not pass a price: `openDeal` charges `agent.price` from contract storage, which is what makes the escrowed amount a snapshot rather than a parameter.
- [X] T020 [US1] Create `src/orders/orders.controller.ts` with `@Controller('orders')` and `POST /` → `201 { id }`. `@CurrentAccount()` supplies the buyer (FR-006 — never from the body), `ZodValidationPipe(createOrderSchema)` validates the body pre-handler, and the handler wraps its call in `try/catch` delegating to `orders-http.ts`. ⚠️ No `@Public()` and no `@OptionalAuth()` anywhere in this controller — every route here requires a session.
- [X] T021 [US1] Register `PurchaseService`, `OrderRepository` and `OrdersController` in `src/orders/orders.module.ts`.
- [X] T022 [US1] Verify [quickstart §3](./quickstart.md), P1–P13. **P9 is the one that matters**: `onchain_deal_id` must be non-null on a successful purchase — if it is null, the saga answered before the receipt and every downstream feature inherits an order nobody can settle.
- [X] T023 [US1] Verify [quickstart §5](./quickstart.md), R1–R4 — two simultaneous purchases against a balance covering one. **A negative balance here means the check and the debit were not in one transaction and the same money was spent twice** (FR-008, SC-003). This cannot be reached by using the product normally.

**Checkpoint**: a purchase works end to end and the escrow holds the money. This is the MVP.

---

## Phase 4: User Story 2 — A chain failure leaves the buyer's balance whole (P1)

**Goal**: the escrow call's three outcomes, and the money figures that follow from them.

**Independent test**: force the escrow call to fail, place an order, and confirm the buyer's
balance afterwards is byte-identical to before, the order is visibly failed, and the money is
not reported as escrowed. [quickstart §4](./quickstart.md).

- [X] T024 [US2] Add `markFailed(orderId, manager)` to `src/orders/order.repository.ts`, setting `state = 'failed'` and leaving `onchain_deal_id` NULL. ⚠️ This is the **only** writer of that row shape, which is what makes T027's predicate exact rather than a heuristic ([data-model §2](./data-model.md)).
- [X] T025 [US2] Add the **knowable-failure** branch to `src/orders/purchase.service.ts`: catch everything from `openDeal` that is not `ChainOutcomeUnknownError`, and in one transaction `markFailed(orderId)` plus `appendEntry({ kind: 'adjustment', amountMinor: +price, orderId, externalRef: txHash ?? null })`. ⚠️ The original debit stays — the correction is a **new row**, never an edit (invariant #4, FR-019). Rethrow so the controller answers `502`.
- [X] T026 [US2] Add the **unknown-outcome** branch to `src/orders/purchase.service.ts`: on `ChainOutcomeUnknownError`, change **nothing** — the order stays `purchased`, the deal id stays NULL, no compensating entry is written. Log at `error` with the order id and the tx hash, naming API-10's confirmation-retry job as the owner. Rethrow so the caller gets the same `502` as T025. ⚠️ Read warning 2 before writing this; the tidy-looking version that shares a `catch` with T025 is the bug.
- [X] T027 [US2] Add one predicate to `src/orders/escrow-exposure.repository.ts`: `AND NOT (state = 'failed' AND onchain_deal_id IS NULL)` (FR-020). ⚠️ **That file's existing warning forbids `AND onchain_deal_id IS NOT NULL` and this is deliberately not that predicate** — a mid-saga `purchased` order with a NULL deal id must still count, which is exactly what the warning protects. Update the method's docblock to record the distinction so the next reader meets the refined rule rather than a warning their change appears to violate ([R14](./research.md), [data-model §4](./data-model.md)).
- [X] T028 [US2] Update the `ESCROWED_ORDER_STATES` docblock in `src/orders/order-states.ts`. Its `failed` paragraph is correct for API-08's `failed` (execution produced nothing, deal open, money escrowed) and does not cover this feature's (escrow refused, nothing locked, buyer already compensated). Add the second case and state that `onchain_deal_id` is what separates them. The state list itself is **unchanged** — `failed` stays in it.
- [X] T029 [US2] Verify [quickstart §4](./quickstart.md), F1–F8. **F3 is the check most likely to fail on a first implementation**: a compensated order must contribute nothing to `inEscrowMinor`, or the buyer sees the same cents in two figures at once.
- [X] T030 [US2] Verify [quickstart §4](./quickstart.md), U1–U5 — the unknown branch, by dropping `RECEIPT_TIMEOUT_MS` to `1`. **U3 is the one that matters**: no compensating credit may appear. If one does, the implementation is treating an unknown outcome as a failure.

**Checkpoint**: both money branches are proven, including the one that cannot be reached
normally.

---

## Phase 5: User Story 3 — The buyer settles: accept early, or complain inside the window (P2)

**Goal**: `POST /orders/:id/accept` and `POST /orders/:id/complain`, buyer-only, with the
window boundary and Act 3's non-delivery path.

**Independent test**: accept a delivered order and confirm the escrow settles to the seller;
complain on another and confirm the complaint is recorded and the escrow is disputed; wait
past the window on a third and confirm the complaint is refused.
[quickstart §6](./quickstart.md), [§9](./quickstart.md), [§10](./quickstart.md).

- [X] T031 [US3] Add `findForSettlement(orderId, manager)` to `src/orders/order.repository.ts` — the order with a `FOR UPDATE` lock, plus the buyer id, so a settlement serialises against a concurrent one. Add `markReleased`, `markDisputed(orderId, manager)` and `insertComplaint(orderId, reason, manager)`.
- [X] T032 [US3] Create `src/orders/settlement.service.ts` with `accept(account, orderId)` using the **catalogue's** transaction shape ([R8](./research.md)): open a transaction, load with the lock, refuse if the caller is not the buyer (`OrderNotVisibleError` → `404`) or the state is not `delivered` (`InvalidOrderStateError` → `409`), set `released` + `settled_at`, call `escrow.accept(dealId)` **inside** the transaction, commit. ⚠️ **Write no ledger entry** — settled funds land on-chain under the parties' own addresses (invariant #5, FR-028).
- [X] T033 [US3] Handle `accept`'s failure branches in `src/orders/settlement.service.ts`: **roll back on everything, including `ChainOutcomeUnknownError`**. If the call did not land the order stays `delivered` and the sweeper releases it when the window expires — the flow self-heals and the seller is paid. Committing `released` would take the order out of the sweeper's query, so a call that did not land would leave the seller unpaid indefinitely. Log the unknown case at `error` with the tx hash. ⚠️ This is the opposite of T036's choice, on purpose ([R8](./research.md)).
- [X] T034 [US3] Add `complain(account, orderId, reason)` to `src/orders/settlement.service.ts`: same shape and same buyer-only refusal, plus — refuse if a complaint exists (`AlreadyComplainedError`; the `complaints.order_id UNIQUE` constraint is the real guarantee and will also fire inside the transaction, FR-031), refuse if the order has no deal id (`OrderNotDisputableError` → `409`; nothing was ever escrowed), and refuse once `now() >= delivered_at + review_window_seconds` (`ComplaintWindowClosedError` → `409`, at the same instant the contract refuses, FR-030). Then insert the complaint, set `disputed` + `disputed_at`, call `escrow.dispute(dealId)`, commit.
- [X] T035 [US3] Add the non-delivery branch to `complain` in `src/orders/settlement.service.ts` — **this is Act 3** ([R9](./research.md)). Read the deal's on-chain state with `EscrowReadService.getDeal(dealId)`; if it is `Open` (the run crashed and `markDelivered` was never called), call `escrow.markDelivered(dealId)` **first**, then `dispute(dealId)`. Branch on the **deal's** state, not the order's, so a retried complaint after a partial failure calls only `dispute`. ⚠️ If `dispute` fails after `markDelivered` succeeded, the transaction rolls back the complaint but the on-chain mark stands and the deal becomes releasable when the window expires — log **both** tx hashes at `error`; it is the one irreversible half-step in this feature.
- [X] T036 [US3] Handle `complain`'s unknown-outcome branch in `src/orders/settlement.service.ts`: **commit** the complaint and the `disputed` state, then log at `error`. The complaint is the buyer's testimony and is not reproducible; and if the `dispute` did land, rolling back would leave the buyer locked out of a dispute the chain already believes they filed, with `release` reverting forever and a second complaint failing too. Knowable failures still roll back.
- [X] T037 [US3] Add `POST /:id/accept` and `POST /:id/complain` to `src/orders/orders.controller.ts`, both `202`, both `@Param('id', ParseUUIDPipe)`, complain taking `ZodValidationPipe(complainSchema)`. ⚠️ Both are **buyer-only** and a seller gets `404`, not `403` — the read routes admit them, the writes do not (FR-036, product §7.5: notified, no right of reply).
- [X] T038 [US3] Register `SettlementService` in `src/orders/orders.module.ts`.
- [X] T039 [US3] Verify [quickstart §6](./quickstart.md) A1–A7 and [§9](./quickstart.md) D1–D11, including D3 (the complaint row), D5 (the second complaint refused by the constraint) and D9–D11 (past the window: refused, nothing written, no `dispute` sent).
- [X] T040 [US3] Verify [quickstart §10](./quickstart.md), T1–T6 — Act 3. **T1 must be `202`, not `409`**, and **T5 must still be `409`** for the compensated order from §4: both read `failed`, only one has money in escrow. **T6 is the guard** — `grep markDelivered src/orders/` must return exactly one call site, inside the complaint path (FR-035).

**Checkpoint**: both settling actions work, and the demo's closing act reaches `Disputed`.

---

## Phase 6: User Story 4 — Both sides can follow an order, and the case file is redacted (P2)

**Goal**: `GET /orders/:id` and `GET /orders/:id/case-file`, authorised on buyer **or**
seller, with the disclosure boundary built at the query layer.

**Independent test**: place an order against an agent owned by a different account, open both
routes as the buyer **and as the seller**, and confirm both succeed; set the agent's
`systemPrompt` to a sentinel and confirm it appears nowhere in the buyer's copies and does
appear in the seller's. [quickstart §7](./quickstart.md), [§8](./quickstart.md).

- [X] T041 [US4] Create `src/orders/order-serialiser.ts` with `toOrderResponse(...)` and `toOrderRun(...)`, both taking `Pick<>` parameter types that have **no** `systemPrompt` member — the same construction `agent-serialiser.ts` uses, where the parameter type is the guarantee. Resolve `agentName` from the **pinned** version. ⚠️ Two different kinds of nothing: `run === null` means execution has not started; `run.output === null` means it ran and produced nothing. Collapsing them tells a buyer their agent is still working when it has already given up.
- [X] T042 [US4] Add `toBuyerCaseFileSteps(steps)` to `src/orders/order-serialiser.ts`, mapping `ExecutionStep[]` → `CaseFileStepResponse[]`: `label` and timings pass through, `error` passes through, and **`summary` is composed from `kind` and `label`** — a platform-authored sentence. ⚠️ `reasoning` is **dropped, never truncated and never model-summarised**: the first sentence of a paraphrase is still a paraphrase and the leak is at the start ([R11](./research.md)). There must be no code path from the model's text to a buyer's response.
- [X] T043 [US4] Add **two** case-file queries to `src/orders/order.repository.ts`. The buyer's names its columns explicitly and `system_prompt` is **not among them**, so on a buyer's read the prompt never enters the process — the only layer that also protects a log line and a stack trace. The seller's selects it. ⚠️ Two methods, not one with a boolean ([R10](./research.md)).
- [X] T044 [US4] Create `src/orders/case-file.service.ts` assembling both copies from the **pinned** version's `capabilities` and `exclusions`, `orders.input`, `orders.acceptance_criteria`, and the run's output, steps and timings when a run exists. It is a separate file from `order-serialiser.ts` for the reason `agent-versions.service.ts` is separate from `agent-serialiser.ts`: the seller's mapping is the one that must see `systemPrompt`, and it does not belong behind a boundary defined by not having it. ⚠️ Resolve the promise from the version the order pinned, never the agent's current one (FR-039).
- [X] T045 [US4] Create `src/orders/orders.service.ts` with `getOrder(account, orderId)` using T013's join. Throw `OrderNotVisibleError` when it returns null — one `404` for "no such order" and "not your order", byte-identical bodies.
- [X] T046 [US4] Add `GET /:id` and `GET /:id/case-file` to `src/orders/orders.controller.ts`. The case-file handler resolves the caller's role from the already-fetched row, then calls one of the two service paths. ⚠️ The **route** branches; the **serialiser** does not, and the branch is pushed down into the query. Answer any state, including `purchased`, where `output` is `null` and `steps` is `[]` — the absence is the evidence, not an error (FR-040).
- [X] T047 [US4] Register `OrdersService` and `CaseFileService` in `src/orders/orders.module.ts`.
- [X] T048 [US4] Verify [quickstart §7](./quickstart.md), S1–S7 — **signed in as the seller account, not the buyer**. This is the check the source brief calls out specifically, because authorising on `buyer_account_id` alone is the natural thing to write and silently deletes half the seller experience. S3 and S4 must produce byte-identical bodies.
- [X] T049 [US4] Verify [quickstart §8](./quickstart.md), C1–C6. **C6 is a source check and the strongest of the six**: `grep system_prompt` over the buyer's query in `src/orders/order.repository.ts` must return nothing. A serialiser that omits the field still fetched it.

**Checkpoint**: both parties can follow an order, and the boundary holds under a sentinel
sweep.

---

## Phase 7: User Story 5 — Each side sees their own trades (P3)

**Goal**: `GET /orders` and `GET /sales`.

**Independent test**: with two accounts, place orders from one against agents owned by the
other, and confirm each list shows exactly its own side. [quickstart §7](./quickstart.md)
S5–S7 and [§11](./quickstart.md) E9–E11.

- [X] T050 [US5] Add `findByBuyer(accountId)` to `src/orders/order.repository.ts` — every order this account placed, any state, `ORDER BY created_at DESC`, joined to the pinned version for `agentName`. Uses `orders_buyer_idx (buyer_account_id, created_at DESC)`, which already covers both the predicate and the sort.
- [X] T051 [US5] Add `findBySeller(accountId)` to `src/orders/order.repository.ts` — `orders → agent_versions → agents` filtered on `agents.owner_account_id`. ⚠️ Reached **through the agent**, because an order names a definition and never a seller. Include sales of agents since made unavailable (FR-046) — `active` is not part of this predicate. No index and none needed ([R15](./research.md)).
- [X] T052 [US5] Add `listMine` and `listSales` to `src/orders/orders.service.ts`, mapping through `order-serialiser.ts` to `BuyerOrderSummary[]` and `SaleResponse[]`. Return `[]`, never `404`, for an account with nothing.
- [X] T053 [US5] Add `GET /` to `src/orders/orders.controller.ts` returning a **bare array**, no envelope.
- [X] T054 [US5] Create `src/orders/sales.controller.ts` with `@Controller('sales')` and `GET /`. Its own controller because `/sales` is a different path prefix — the same split `ui/src/api/sales.ts` made. ⚠️ Add a docblock recording that **this endpoint is the seller's only notification mechanism**: there is no email, no push and no bell, so `product-workflow.md` §7.5's *"the seller is notified"* is true only for as long as this list is polled.
- [X] T055 [US5] Register `SalesController` in `src/orders/orders.module.ts`.
- [X] T056 [US5] Verify [quickstart §7](./quickstart.md) S5–S7 and [§11](./quickstart.md) E9–E11, including E11 — sales of a switched-off agent still appear.

**Checkpoint**: every endpoint in the feature exists.

---

## Phase 8: Polish & Cross-Cutting Concerns

- [X] T057 [P] Verify [quickstart §11](./quickstart.md) E1–E12 — every refusal, including **E6** (criteria the listing never promised → `201`, judged at dispute time not checkout, FR-004) and **E12** (buying your own agent → `201`, both reads authorising the same account twice).
- [X] T058 [P] Verify [quickstart §1](./quickstart.md) Z1–Z2 — the process refuses to start with `REVIEW_WINDOW_SECONDS=0`. Nothing in this feature implements that guard; the task is to confirm the boot guard actually fires, because a zero window kills every demo act with no error anywhere.
- [X] T059 [P] Sweep `src/orders/` for unit errors: every amount is whole USD cents and no `toBaseUnits`/`fromBaseUnits` call exists outside `chain/` (invariant #2). `openDeal` takes no amount at all — if one was passed, the escrowed price is no longer a snapshot.
- [X] T060 [P] Raise the UI handoff for `SellerCaseFile`: `ui/src/api/types.ts`'s `CaseFile` declares neither `systemPrompt` nor `rawSteps`, so the seller's screen has nowhere to render them. Sending them is safe — that file states declaring fewer fields than arrive is safe — and `docs/ui-design.md` §7.1 says the seller's view *"stays unredacted"*, so it is worth doing.
- [X] T061 [P] Raise the UI handoff for `GET /orders`: `MyOrdersPage.tsx` is still a `PagePlaceholder` and `ui/src/api/orders.ts` has no list wrapper. `BuyerOrderSummary` is defined in [contracts §2](./contracts/internal-api.md) and `docs/ui-design.md` §205 assigns this endpoint to that page's load.
- [X] T062 [P] Note in [contracts/internal-api.md](./contracts/internal-api.md) §8 that API-12 must transcribe all seven routes, including the `402`/`409`/`502` split — finer than a generic 4xx/5xx, and the client branches on it. `docs/openapi.yaml` still does not exist.
- [X] T063 [P] Confirm the three API-10 queries in [contracts §8](./contracts/internal-api.md) are reachable: `state='delivered'` past its window (sweeper), `state='purchased' AND onchain_deal_id IS NULL` (confirmation retry — ⚠️ **must not** resolve one by calling `openDeal` again), and `state='failed' AND onchain_deal_id IS NOT NULL` (reclaimer).
- [X] T064 Run [quickstart.md](./quickstart.md) end to end, all twelve sections, in order.
- [ ] T065 Run the [quickstart §12](./quickstart.md) rehearsal checklist **twice in a row** with no manual correction to any order or ledger between runs — that is SC-012, and it is the closest thing this component has to a green build.

---

## Dependencies & Execution Order

### Phase dependencies

- **Setup (Phase 1)**: no dependencies. T002 and T003 must land together — the entity and
  the column, or the app will not boot.
- **Foundational (Phase 2)**: depends on Setup (T003 specifically — T013 selects `input`).
  **Blocks every story.**
- **US1 (Phase 3)**: after Foundational. No dependency on other stories.
- **US2 (Phase 4)**: **depends on US1** — it is the failure branch of the method US1 builds,
  not a separate flow. This is the one story pair that is not independent, and pretending
  otherwise would mean writing `openDeal`'s error handling before `openDeal` has a caller.
- **US3 (Phase 5)**: after Foundational; needs US1 for an order to settle.
- **US4 (Phase 6)**: after Foundational; needs US1 for an order to read.
- **US5 (Phase 7)**: after Foundational; needs US1 for anything to list.
- **Polish (Phase 8)**: after every story.

### Files touched by more than one story — these gate concurrency

The stories stay independently *testable*; they are not independently *editable*.

| File | Touched by |
| --- | --- |
| `src/orders/order.repository.ts` | Foundational (T013), US1 (T015, T016), US2 (T024), US3 (T031), US4 (T043), US5 (T050, T051) |
| `src/orders/orders.controller.ts` | US1 (T020), US3 (T037), US4 (T046), US5 (T053) |
| `src/orders/orders.module.ts` | Foundational (T014), US1 (T021), US3 (T038), US4 (T047), US5 (T055) |
| `src/orders/purchase.service.ts` | US1 (T017–T019), US2 (T025, T026) |
| `src/orders/orders.service.ts` | US4 (T045), US5 (T052) |
| `src/orders/order-serialiser.ts` | US4 (T041, T042), US5 (T052 consumes it) |

The repository, the controller and the module are touched by all five. Sequential story
order avoids every collision; parallel work on those three does not.

### Two dependencies worth stating plainly

**US1 is the only story that can be demonstrated on its own.** Every other story reads,
settles or lists an order, and there is no other way to create one — no seed, no fixture, no
admin route. That is what makes US1 the MVP rather than a matter of priority ordering.

**US2 is not optional and is not a follow-up.** It is the other half of one method. Shipping
US1 without it means a chain hiccup takes a buyer's money and leaves no record of it, which
is worse than not shipping the purchase at all.

### Parallel opportunities

- **Phase 1**: T004 alone (T002 and T003 are one change across two files).
- **Phase 2**: T005–T011 in parallel — seven different files. T012, T013 and T014 are
  sequential against the rest and against each other.
- **Phase 8**: T057–T063 in parallel; T064 and T065 are sequential and last.
- **Across stories**: not recommended — see the file table above.

---

## Parallel Example: Phase 2

```bash
# Seven independent files, no shared edits:
Task: "Create src/orders/orders.errors.ts"                # T005
Task: "Create src/orders/orders-http.ts"                  # T006
Task: "Create src/orders/dto/create-order.dto.ts"         # T007
Task: "Create src/orders/dto/complain.dto.ts"             # T008
Task: "Create src/orders/dto/order-response.dto.ts"       # T009
Task: "Create src/orders/dto/case-file.dto.ts"            # T010
Task: "Add validateAgainstSchema to catalog/schema-validation.ts"  # T011

# T012 (ledger refactor), T013 (the join) and T014 (module) run sequentially after.
```

---

## Implementation Strategy

### MVP first (US1 + US2)

1. Phase 1: Setup — the migration and the entity.
2. Phase 2: Foundational — **blocks everything**.
3. Phase 3: US1.
4. Phase 4: US2 — **not optional**, see above.
5. **STOP and VALIDATE**: quickstart §3, §4 and §5. If §4's F3 fails, a buyer sees the same
   money twice; if §5's R3 fails, two buyers can spend one balance.

### Incremental delivery

1. Setup + Foundational → the schema and the primitives exist.
2. US1 + US2 → money moves correctly in both directions **(MVP; unblocks API-08)**.
3. US4 → the order read **(unblocks UI-04's poll and UI-08's seller dispute screen)**.
4. US3 → accept and complain **(unblocks Acts 1 and 3)**.
5. US5 → the two lists **(unblocks My Orders and the seller's notification loop)**.

US4 before US3 is deliberate if you are optimising for the UI: the order screen cannot render
anything without the read, and the buttons it renders are US3's.

### Notes

- `[P]` = different files, no dependency on incomplete work.
- Commit after each task or logical group.
- Stop at any checkpoint to validate a story independently.
- The verification tasks are not documentation — with no test suite, skipping one means that
  requirement was never checked by anything. In this feature, T023, T029 and T030 check
  branches no amount of ordinary use will reach.
