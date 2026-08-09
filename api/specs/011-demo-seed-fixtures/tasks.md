---

description: "Task list for 011-demo-seed-fixtures"
---

# Tasks: Demo seed & the three seller agents

**Input**: Design documents from `/specs/011-demo-seed-fixtures/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/](./contracts/)

**Tests**: **None.** Automated tests are out of scope for `api/` by standing decision (`docs/CONTEXT.md`). [quickstart.md](./quickstart.md) is the verification suite and every acceptance criterion is checked by hand there.

**Organization**: Grouped by user story. Each story is an independently runnable increment — and for this feature "runnable" is literal: US2, US3 and US4 each end in a purchase you can watch.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1–US5)
- Paths are relative to `api/` (the component root).

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Make a place for the feature to live and give it what it needs to reach the catalogue.

- [X] T001 Create the module skeleton at `src/demo/demo.module.ts` — a `@Module` importing `CatalogModule`, `AccountsModule` and `ExecutionModule`, exporting nothing. Leave providers empty for now.
- [X] T002 Register `DemoModule` in `src/app.module.ts`, last in the imports list, with a docblock line saying why it is registered (its `onModuleInit` is what puts the fixtures in force — an unregistered module means every act runs live).
- [X] T003 [P] Add `DEMO_SELLER_ADDRESS` to `src/config/env.schema.ts` as a **required** key, reusing the `/^0x[a-fA-F0-9]{40}$/` rule and error message the four existing address keys use. Document at the key why it is required rather than optional: a wrong or missing payout address cannot be corrected after `registerAgent` (research R7).
- [X] T004 [P] Add the key to `.env.example` / `docker-compose.yml` env blocks alongside `OPERATOR_ADDRESS`, and to the README's environment table.
- [X] T005 Add `AgentWritesService` and `AgentRepository` to `CatalogModule`'s `exports` in `src/catalog/catalog.module.ts`, and update the "Nothing is exported" docblock to record what now is and why (the seed must publish through the real seller path or the listings are not registered on-chain).

**Checkpoint**: `npm run start:dev` boots with the new key required and the empty module registered.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The three definitions and the guard that stops them being unusable. Everything else keys off these.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete — the definitions are the single source for what is published, what is hashed, and what every fixture keys on.

- [X] T006 Write the three agent definitions in `src/demo/seeded-agents.ts`, verbatim from [contracts/seeded-definitions.md](./contracts/seeded-definitions.md): three exported `SeededAgent` constants with `key` (`'ledgerbot' | 'tldr' | 'polyglot'`) and a `definition` holding exactly the ten `CanonicalDefinition` fields. Export them as an ordered array too. **No second copy of any name, price or schema anywhere in the module.**
- [X] T007 ⚠️ Set `additionalProperties: false` on **every** object in every `outputSchema` and `inputSchema` in T006 — root *and* the nested one inside `lineItems.items`. This is the exact defect that failed all thirteen orders in the execution engine's verification run (research R6).
- [X] T008 [P] Implement `assertStructuredOutputCompatible(schema, field)` in `src/demo/structured-output-guard.ts` — a recursive walk that throws naming the JSON pointer of the first `type: "object"` that omits `additionalProperties: false`. Docblock it with the live error message it prevents and why it is scoped to `demo/` rather than added to `catalog/schema-validation.ts` (research R6).
- [X] T009 [P] Create `src/demo/demo.errors.ts` with the seed-path error types from [contracts/demo-api.md](./contracts/demo-api.md) §1.2 — `DemoAgentUnregisteredError` (→ 409), `DemoDefinitionUnusableError` (→ 500) — following the error-module shape used by `catalog.errors.ts`.

**Checkpoint**: The definitions exist and a deliberately-broken schema makes the guard throw with a useful pointer.

---

## Phase 3: User Story 1 — A seeded marketplace whose agents actually run (Priority: P1) 🎯 MVP

**Goal**: One call produces three listings that a buyer can find and buy from, and a second call changes nothing.

**Independent Test**: Seed an empty system, then purchase once from each of the three and confirm each produces a recorded run — [quickstart §1–§2](./quickstart.md).

### Implementation

- [X] T010 [US1] Implement demo seller resolution in `src/demo/demo-seed.service.ts`: read `DEMO_SELLER_ADDRESS` from config and call `AccountRepository.findOrCreateByAddress()` — the same call the auth flow makes, so the seller is an ordinary account with no demo flag on the row (data-model §1.1).
- [X] T011 [US1] Add the pre-flight guard pass to `demo-seed.service.ts`: run `assertStructuredOutputCompatible` over all three definitions' schemas **before** the first `createAgent` call, so a bad schema costs no row, no gas and no partial seed (FR-005).
- [X] T012 [US1] Implement the create-or-reconcile decision in `demo-seed.service.ts`, one agent at a time, per research R3's table: absent → `createAgent`; present and the active version's `definition_hash` matches → no-op; present and it differs → `publishVersion`; present with `onchain_agent_id IS NULL` → **throw `DemoAgentUnregisteredError`**.
- [X] T013 [US1] ⚠️ In the NULL-`onchain_agent_id` branch, make the error message say explicitly that the agent must be reconciled by hand against the `AgentRegistered` logs and **must not** be re-seeded — calling `registerAgent` again mints a second on-chain agent the seller cannot reach (`agent-writes.service.ts` says so in as many words).
- [X] T014 [US1] Call `createAgent`/`publishVersion` **sequentially**, awaiting each. Comment why: they are operator-key writes and three concurrent transactions from one key is a nonce race (research R2).
- [X] T015 [P] [US1] Write `src/demo/dto/seed-response.dto.ts` per [contracts/demo-api.md](./contracts/demo-api.md) §1.1 — `seller`, `agents[]` with `created`, and the `fixtures[]` array (leave it empty until US2 fills it). ⚠️ Build it field by field so there is nowhere for `systemPrompt` to land (§1.3, FR-010).
- [X] T016 [US1] Implement `POST /demo/seed` in `src/demo/demo.controller.ts` — `@Public()`, no body, returns `200` (not `201`: the call is idempotent and usually creates nothing).
- [X] T017 [US1] Map the seed errors to responses in the controller/filter per contracts §1.2, reusing the existing chain-error mapping for `502`.
- [X] T018 [US1] Wire `DemoSeedService` and `DemoController` into `src/demo/demo.module.ts`.
- [X] T019 [US1] ★ **Verify by purchasing, not by reading** ([quickstart §2](./quickstart.md)): seed an empty database, buy once from each of the three, and confirm three runs exist and no log line contains `'additionalProperties' must be explicitly set to false`. A definition that reads correctly and is refused at execution is the failure this task exists to catch (FR-036).
- [X] T020 [US1] Verify idempotency and the public catalogue: re-seed → three `created: false`, `agents` count still 3, and `GET /agents` shows all three with non-null on-chain ids ([quickstart §1](./quickstart.md), SC-010).

**Checkpoint**: A working three-agent marketplace. No fixture fires yet — every purchase runs live, which is correct and observable.

---

## Phase 4: User Story 2 — Act 2: a shortfall the room can count (Priority: P2)

**Goal**: The receipt fixture returns three of five, every time, and the two dropped items are nameable.

**Independent Test**: Buy the seeded receipt fixture and confirm exactly three of the five line items come back, the same three on repeat — [quickstart §3](./quickstart.md).

**Note**: This story carries the fixture *harness* (type, registration, publication) because it is the first story that needs it. US3 and US4 then add content only.

### Implementation

- [X] T021 [US2] Define the `DemoFixture` type in `src/demo/fixtures.ts` per [data-model §3.2](./data-model.md) — `act`, `agentKey`, `input`, `acceptanceCriteria`, `complaint`, `script`, `expectedTier`. Docblock `expectedTier` as **documentation only**: no runtime code may branch on it, or the demo would be asserting its own verdict.
- [X] T022 [US2] Implement fixture registration in `DemoModule.onModuleInit`: for each fixture, compute `definitionHash(seededAgent.definition).hex`, **strip the leading `0x`**, and call `DemoScriptRegistry.register()` with a label like `Act 2 — LedgerBot drops 2 of 5`.
- [X] T023 [US2] ⚠️ Comment the `0x` strip at the site with the reason: the hash the runner compares against arrives from `execution.repository.ts` as `Buffer.toString('hex')` — bare hex — so registering viem's prefixed form yields a key that never matches and a fixture that silently never fires (research R1).
- [X] T024 [US2] ⚠️ Comment *why registration is at bootstrap and not in the seed service* — the registry is in memory, the listings are not, and a seed-time registration leaves Act 2 running live after any restart with nothing logged as wrong (FR-026, research R1).
- [X] T025 [US2] Write Act 2's fixture in `src/demo/fixtures.ts`, verbatim from [contracts/fixtures.md](./contracts/fixtures.md): the five-item euro receipt, the acceptance criteria, the complaint, and the `{ kind: 'output' }` script returning **three** line items with `total: 300.00`.
- [X] T026 [US2] ⚠️ Check Act 2's acceptance criteria mention **nothing about dollars or conversion** — the currency grievance belongs only in the complaint, where it is unfounded. In the criteria it becomes something the buyer legitimately asked for and the tier moves (research R9).
- [X] T027 [US2] Populate `fixtures[]` in the seed response from the same `fixtures.ts` objects that were registered, so published and registered content cannot drift (FR-028, research R8).
- [X] T028 [US2] Verify ([quickstart §3](./quickstart.md)): buy the fixture five times; exactly three line items each time, the same three, `total: 300.00` against the receipt's printed `362.00`, and `Desk lamp` / `Cable kit` nameable from the receipt (SC-003, FR-017, FR-019).
- [X] T029 [US2] ★ Verify the fixture does **not** fire on anything else ([quickstart §9](./quickstart.md)): a different receipt, and the same receipt with one character changed, both produce a live extraction (FR-024, SC-008).

**Checkpoint**: Act 2 is deterministic and countable. The demo's centrepiece exists.

---

## Phase 5: User Story 3 — Act 1: a complaint that is correctly rejected (Priority: P3)

**Goal**: The summary fixture delivers 85 words that genuinely cover the pricing change, so the complaint against it is unfounded.

**Independent Test**: Buy the seeded summary fixture, confirm the declared word count matches the summary and that a reader agrees the pricing change is covered — [quickstart §4](./quickstart.md).

### Implementation

- [X] T030 [US3] Write Act 1's fixture in `src/demo/fixtures.ts`, verbatim from [contracts/fixtures.md](./contracts/fixtures.md): the 259-word memo as `document`, `wordCap: 100`, the acceptance criteria, the complaint, and the `{ kind: 'output' }` script with the 85-word summary and `wordCount: 85`.
- [X] T031 [US3] ⚠️ Re-count the summary after writing it (`jq -r '.summary' | wc -w`) and confirm it is **85**, matching the declared `wordCount`. A declared count that disagrees with the text hands the complaining buyer a real grievance and inverts the act.
- [ ] T032 [US3] ★ Have someone who did not write it read the summary and confirm it covers the pricing change. **This is the check, not the word count** (FR-015) — if it has drifted, a 0% ruling stops being a fairness demonstration and becomes a visible misfire.
- [X] T033 [US3] Verify ([quickstart §4](./quickstart.md)): buy the fixture, confirm `wordCount: 85`, an actual count of 85, and 85 < the buyer's cap of 100 (SC-004).

**Checkpoint**: The demo's opening argument holds up.

---

## Phase 6: User Story 4 — Act 3: nothing arrived, and the absence was recorded (Priority: P4)

**Goal**: The translation fixture crashes through the ordinary failure path and leaves `runs.output` SQL NULL with the error recorded.

**Independent Test**: Buy the seeded translation fixture and confirm the order reaches `failed` with no output and a recorded error — [quickstart §7](./quickstart.md).

### Implementation

- [X] T034 [US4] Write Act 3's fixture in `src/demo/fixtures.ts`, verbatim from [contracts/fixtures.md](./contracts/fixtures.md): the product description, `targetLanguage: "German"`, `preserveTerms`, the criteria, the complaint, and the `{ kind: 'failure', message }` script.
- [X] T035 [US4] ⚠️ Confirm no code in `src/demo/` writes an order state, a run row, or a verdict. The crash must be thrown by `ScriptedAgentRunner` and travel the ordinary path — a seeded shortcut removes the very thing Guardian reads (FR-022, invariant #7).
- [X] T036 [US4] Verify ([quickstart §7](./quickstart.md)): order `failed`, `runs.output` **SQL NULL and not `{}`**, `runs.error` set, `output_valid` NULL, and **no chain call made** (FR-021, SC-005).
- [X] T037 [US4] Verify array-order sensitivity ([quickstart §9](./quickstart.md)): sending `preserveTerms` reversed produces a live run, because array order is part of the input's identity (research R8).

**Checkpoint**: All three fixtures exist and behave. The acts can be run end to end.

---

## Phase 7: User Story 5 — Reset makes the rehearsal repeatable (Priority: P5)

**Goal**: One call clears the transactional history, keeps the catalogue and the ledger, and lets the acts run again with no re-seed.

**Independent Test**: Run one act to a settled ruling, reset, and confirm the order/run/complaint/verdict are gone while accounts, agents and every ledger entry remain — [quickstart §10](./quickstart.md).

### Implementation

- [X] T038 [US5] Implement `src/demo/demo-reset.service.ts` as **one transaction** in the statement order from [data-model §2](./data-model.md): `UPDATE ledger_entries SET order_id = NULL` → delete `verdicts` → `complaints` → `runs` → `orders`.
- [X] T039 [US5] ⚠️ Docblock the `UPDATE` with the full argument from research R4: `ledger_entries.order_id` has a foreign key with no `ON DELETE`, so something must give; deleting the entries would reverse purchase debits and credit back money already gone to escrow or settlement, breaking solvency. The pointer goes, the row and its amount stay, and every balance is unchanged.
- [X] T040 [US5] ⚠️ Capture counts from the delete results rather than asserting a shape. The execution engine's one verification defect was a raw query whose result shape was asserted and was wrong — `UPDATE … RETURNING` yields `[rows, count]`, a `SELECT` yields bare rows, and a typecheck cannot tell you which you got.
- [X] T041 [P] [US5] Write `src/demo/dto/reset-response.dto.ts` per [contracts/demo-api.md](./contracts/demo-api.md) §2.1 — `cleared` (including `ordersInFlight`), `kept`, and the constant `note` about escrowed and settled money not returning.
- [X] T042 [US5] Count `ordersInFlight` — orders deleted whose state was `purchased`, `running`, `delivered`, `disputed` or `adjudicated` — read **before** the delete, since afterwards there is nothing to count (FR-032).
- [X] T043 [US5] Implement `POST /demo/reset` in `src/demo/demo.controller.ts` — `@Public()`, no body, `200`, no environment guard (recorded decision, `docs/api-design.md` §8).
- [X] T044 [US5] Wire `DemoResetService` into `src/demo/demo.module.ts`.
- [X] T045 [US5] ★ Verify the ledger is whole ([quickstart §10](./quickstart.md)): the buyer's `SUM(amount_minor)` is **identical** before and after, `ledger_entries` count unchanged, and `kind='purchase' AND order_id IS NOT NULL` returns 0 (FR-031, SC-012).
- [X] T046 [US5] Verify repetition and emptiness: reset on a system with no orders → `200`, all counts `0`; reset twice → the second clears nothing and succeeds (FR-033).
- [X] T047 [US5] Verify mid-act behaviour ([quickstart §11](./quickstart.md)): reset while the execution poller is claiming → at most one foreign-key error in the log, no crashed process, `runs` count `0`, and the next purchase works (FR-034, SC-013).

**Checkpoint**: The rehearsal loop is closed. All five stories complete.

---

## Phase 8: Polish & Cross-Cutting

**Purpose**: The checks that only exist across stories, plus the two documentation lines this feature owes an operator.

- [X] T048 ★ **Restart check** ([quickstart §8](./quickstart.md)): restart the API without re-seeding and buy Act 2's fixture. Three line items, not five. Confirm the three `registered demo script:` lines appear on every boot, seeded database or not. **This is the only silent failure in the feature** (FR-026, SC-009).
- [X] T049 ★ **Run all three acts end to end** ([quickstart §5–§7](./quickstart.md)): tiers `none`, `half`, `full`; the $1.00/$1.00 split confirmed on-chain rather than in the database. Acts 1 and 2 have never run before this task (SC-006).
- [X] T050 ★ **Confirm an exclusion is cited** ([quickstart §6](./quickstart.md)): Act 2's ruling carries a citation with `source: "exclusion"` quoting the currency clause. An exclusion the demo claims and never shows is what FR-020 and SC-007 exist for.
- [X] T051 ★ **Rehearse twice** ([quickstart §12](./quickstart.md)): reset, run all three acts again, same three tiers. These are fresh rulings, not replays — a differing tier means that fixture's case file is ambiguous, and the fix is in the fixture (FR-027, FR-037, SC-006).
- [X] T052 [P] Verify the disclosure boundary ([quickstart §13](./quickstart.md)): neither route's response contains any seeded `systemPrompt` text (FR-010, SC-011).
- [X] T053 [P] Document both routes in `README.md` — what they do, that **reset is unguarded and unauthenticated**, and that it does not return spent balance (FR-011, FR-031).
- [X] T054 [P] Add a short "running the demo" section to `README.md`: seed, copy the fixtures from the response, run the three acts in order, reset between rehearsals, and top up when balance runs low.
- [X] T055 Record a verification run at the bottom of this file — what passed, what remains, and any finding for the next feature — following the format the 008 and 009 task lists use.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies.
- **Foundational (Phase 2)**: Needs Setup. **Blocks every story** — the definitions are what everything else is derived from.
- **US1 (Phase 3)**: Needs Foundational. Blocks nothing structurally, but until it runs there is nothing to buy.
- **US2, US3, US4 (Phases 4–6)**: Need Foundational. **US2 also carries the fixture harness** (T021–T024, T027), so US3 and US4 need those five tasks even though they are filed under US2. Verifying any of them end to end needs US1 seeded.
- **US5 (Phase 7)**: Needs Foundational only. Genuinely independent — it can be built first if you want to rehearse US2 repeatedly while tuning the fixture.
- **Polish (Phase 8)**: Needs all five.

### The one cross-story dependency worth naming

US3 and US4 are content-only *because* US2 built the harness. If US2 is deferred, move T021–T024 and T027 into whichever fixture story is built first — they are not Act 2 code, they are fixture code that happens to live in Act 2's phase.

### Parallel Opportunities

- T003, T004 (Setup) — different files.
- T008, T009 (Foundational) — different files.
- T015 can be written while T010–T014 are in progress.
- T041 alongside T038–T040.
- T052, T053, T054 in Polish.
- ⚠️ **T025, T030 and T034 all edit `src/demo/fixtures.ts`** and are deliberately **not** marked `[P]` despite being three separate stories. Three fixtures in one file is the right shape — the content should be readable side by side at 3am — and the cost is that they serialise.

### Within Each Story

Content → registration → response → verify. The verify task is the last one in every story and it is not optional: this component has no automated tests, so an unverified task is an unbuilt task.

---

## Parallel Example: Phase 2

```bash
# After T006–T007 land, these two are independent files:
Task: "Implement assertStructuredOutputCompatible in src/demo/structured-output-guard.ts"
Task: "Create src/demo/demo.errors.ts with DemoAgentUnregisteredError and DemoDefinitionUnusableError"
```

---

## Implementation Strategy

### MVP (US1 only)

Phases 1 → 2 → 3, then **stop and verify by purchasing from all three agents** (T019). That alone is worth having: a marketplace with three real listings, every run live. If T019 fails, nothing downstream is worth building until it passes — it is the failure the previous feature already paid for once.

### Incremental delivery

1. Setup + Foundational → the definitions exist.
2. US1 → three buyable listings. **Demo-able.**
3. US2 → the countable act. The demo's centrepiece.
4. US3 → the opening argument.
5. US4 → the closing act. All three tiers reachable.
6. US5 → rehearsable more than once.
7. Polish → the restart check, two full rehearsals, the README.

### Recommended order if you only have one sitting

US1 → US5 → US2 → US3 → US4. Reset early is worth its place out of priority order: every fixture you tune is a purchase you want to undo, and without it you are editing the database by hand between attempts, which is the thing this feature exists to remove.

---

## Notes

- **No test tasks anywhere.** Verification is by hand, in [quickstart.md](./quickstart.md), and a failed rehearsal is a red build.
- **No migration.** If a task seems to need one, re-read [data-model.md](./data-model.md) — it almost certainly wants the ledger `UPDATE` from T038 instead.
- The ⚠️ tasks are the ones whose failure is silent or expensive: T007 (every act fails for an unrelated reason), T013 (a second on-chain agent), T023/T024 (the fixture never fires), T026 (the tier moves), T039/T040 (the ledger), T048 (the restart).
- Commit after each task or logical group; stop at any checkpoint to validate.

---


## Verification run — 2026-08-09 (live)

**54 of 55 tasks pass. The one that remains needs a person, not a stack.** The
offline pass recorded earlier that day was superseded by a full live run against
a real database, the operator key on Monad, and real model calls. Every ★ task in
the list has now been exercised end to end, including the three that had never
run before: Acts 1 and 2, and the restart check.

The scripts are committed alongside this file and are re-runnable:

| Script | Covers |
| --- | --- |
| `scripts/verify-011-seed.mjs` | §1, §13 — seeding, idempotency, catalogue, disclosure |
| `scripts/verify-011-fixtures.mjs` | §2, §3, §4, §7, §9 — the fixtures fire, and only on their own input |
| `scripts/verify-011-acts.mjs` | §5–§7 — the three acts to a settled ruling, split confirmed on-chain |
| `scripts/verify-011-reset.mjs` | §10, §11 — the ledger survives, and the mid-act race |
| `scripts/verify-011-restart.mjs` | §8 — the silent one |

### Results

| Section | Script result | Notes |
| --- | --- | --- |
| §1, §13 — seed, idempotency, disclosure | **42/42** | Minted on-chain agents **#17, #18, #19**. Re-seed → three `created: false`, still 3 agents and 3 versions, same ids |
| §2 ★ — every seeded agent actually runs | ✅ | Acts 1 and 2 `delivered`, Act 3 `failed`. **No `additionalProperties` error and no `DefinitionUnusableError` anywhere in the logs** — the failure the execution engine's run hit on all thirteen orders did not recur |
| §3 ★ — Act 2 is countable | ✅ | Five purchases, **five identical results**: the same three items, in the same order, `total: 300.00` against the receipt's printed `362.00`. `Desk lamp` and `Cable kit` absent from every one and printed on the receipt |
| §4 — Act 1's numbers | ✅ | Declared `wordCount: 85`, actual count **85**, under the buyer's cap of 100 |
| §7 ★ — Act 3's absence | ✅ | `runs.output` **SQL NULL, not `{}`**; `runs.error` set; `output_valid` NULL; exactly one run row |
| §9 ★ — the fixture fires on its input alone | ✅ | A stranger's receipt → a genuine two-item extraction. The fixture receipt with **one character changed** → live. `preserveTerms` reversed → live |
| §5–§7 ★ — three acts, end to end | **33/33 ×2 clean** | `none` / `half` / `full`, three passes running |
| §6 ★ — the cited exclusion | ✅ | Act 2's ruling cites `source: "exclusion"` quoting *"Does not convert between currencies or restate amounts in another currency."* |
| §6 ★ — the split, **on-chain** | ✅ | Escrow `balances()` read directly: seller **+200¢**, buyer **+250¢** per pass. Act 2 is a clean $1.00/$1.00 |
| §10 ★ — reset keeps the ledger whole | **29/29** | Cleared 46 orders / 37 runs / 7 complaints / 7 verdicts. `ledger_entries` **74 before and 74 after**, total sum **3350 before and after**, and *every per-account balance identical*. `kind='purchase' AND order_id IS NOT NULL` → 0 while the purchase rows themselves survive |
| §11 — reset mid-act | ✅ | `200` with `ordersInFlight: 1`, **zero** foreign-key errors, no crash, `runs` count 0, and the next purchase delivered with the fixture still firing |
| §8 ★ — the restart | **11/11** | Restarted **without re-seeding**; three `registered demo script:` lines on that boot; Act 2 returned **three** line items, not five |
| §12 ★ — repeated rehearsals | ✅ | Three passes, `none` / `half` / `full` every time. Fresh rulings each pass — reset deleted the verdicts, so the auditor decided all three again |

### The one task still open

- **T032** ⚠️ — **an independent reader confirms Act 1's summary covers the pricing
  change.** Left unchecked deliberately, for the same reason the offline pass left
  it: the task asks for someone who did not write the fixture, and neither the
  fixture's author nor the agent that has now read it a dozen times is that person.
  Everything a machine can check about Act 1 passes — 85 declared, 85 counted, under
  the cap, and the ruling has come back `none` with the buyer's own word cap cited
  back at them on three separate audits. That last fact is the strongest available
  evidence that the summary does cover the pricing change, because an auditor that
  disagreed would have moved the tier. It is still not a human reading it.

### Findings

**1. The verdict's `met` flag reads the opposite way round from the obvious guess,
on exclusions.** Act 2's cited exclusion comes back `met: true`, and that is the
grievance being **rejected**, not upheld: `met` means "the delivery met this
clause" (`verdict-response.dto.ts`), so an honoured exclusion protects the seller.
A verification script asserting `met === false` for a rejected complaint will fail
against correct behaviour. Named here because it cost a re-run.

**2. `GET /orders/:id` nests the delivery under `run`, not at the top level** —
`order.run.output`, per `toOrderRun` in `order-serialiser.ts`. quickstart §3 and §4
write it as `order <id> | jq '.output'`, which yields `null` and reads exactly like
a fixture that failed to fire. The quickstart's shorthand is worth correcting the
next time that file is touched.

**3. The demo seller account is created by an unauthenticated route** — carried
forward unchanged from the offline pass. `POST /demo/seed` calls
`findOrCreateByAddress`, so a stranger hitting the route on a deployed instance
creates the demo seller if absent. Still judged acceptable: the address is
operator-configured rather than caller-supplied, the account holds no balance, and
the same row would be created by the first legitimate seed.

### What the run changed on this machine, and what it did not

- **Minted three on-chain agents** (#17, #18, #19) from the operator key. Irreversible
  by design — `registerAgent` mints a new id on every call.
- **Deleted the 46 orders, 37 runs, 7 complaints and 7 verdicts** that existed from the
  008–010 verification runs, via `POST /demo/reset`. Approved before the run. No
  account, agent or ledger entry was touched.
- `REVIEW_WINDOW_SECONDS` was raised to 600 for the duration so a complaint could be
  filed before the sweeper released, then **restored to 30** and the file diffed
  against a backup to confirm it matches.
- The API container was recreated to pick up `DEMO_SELLER_ADDRESS`, which had been
  added to `.env` after the container was last created. It had been failing config
  validation on boot and was down before this run started.
