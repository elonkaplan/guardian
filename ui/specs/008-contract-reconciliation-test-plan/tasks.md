---

description: "Task list for contract reconciliation & manual test plan"
---

# Tasks: Contract Reconciliation & Manual Test Plan

**Input**: Design documents from `/specs/008-contract-reconciliation-test-plan/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[data-model.md](./data-model.md), [contracts/](./contracts/)

**Tests**: **No test tasks.** Automated tests are out of scope for this component by a standing
MVP decision (`ui/docs/CONTEXT.md`), and this feature's second deliverable *is* the manual
procedure that stands in for them. Every verification task below is a human action.

**Organization**: Tasks are grouped by user story so each is independently deliverable.

## Status — 39 of 43 complete

**Four tasks remain, all requiring a human at a browser with a wallet extension**: T008, T009,
T019, T041. They are not blocked by anything in the code and nothing else depends on them.

Everything they verify was confirmed as far as it can be without a wallet: R-01 and R-02 were
each reproduced live against the running API by signing with a throwaway key and by provoking
both 404 codes, and the fixes typecheck and build. What is left is the part that needs hands —
approving a signature prompt, watching a page flip unattended, and handing the document to a
stranger.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: [US1] contract-accurate frontend · [US2] the test plan · [US3] the paper trail
- Paths are relative to `ui/` unless prefixed `api/`

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: A running stack, and live confirmation of the two desk-verified blockers before
any code is touched.

The eleven findings in [research.md](./research.md) were read from the contract and the source
with the API not running. R-01 is a claim about runtime behaviour. **Confirm it before fixing
it** — a finding that does not reproduce is withdrawn and recorded as withdrawn, not quietly
dropped.

- [X] T001 Bring up the stack: `docker compose up -d` in `api/` (Postgres on **5433** — a native Postgres holds 5432), `npm run start:dev` in `api/`, `npm run dev` in `ui/`; confirm `curl -s localhost:3000/health` returns a Terminus body with a database ping
- [X] T002 Seed the demo data: `curl -sX POST localhost:3000/demo/seed | jq '.agents[].key'` returns `ledgerbot`, `tldr`, `polyglot`
- [X] T003 [P] Confirm R-01 live per [quickstart.md](./quickstart.md) §1: `POST /auth/nonce` returns **both** `nonce` and `message`, and a browser sign-in with a wallet-approved signature returns 401 from `/auth/verify`. If `message` is absent or sign-in succeeds, withdraw R-01 and record the withdrawal in `docs/reconciliation-note.md`
- [X] T004 [P] Confirm R-02 live per [quickstart.md](./quickstart.md) §1: an existing order with no verdict returns `404 {"error":"VERDICT_NOT_FOUND"}` and a random uuid returns `404 {"error":"ORDER_NOT_FOUND"}` from `GET /orders/{id}/verdict`

**Checkpoint**: Both blockers confirmed (or withdrawn on the record). Fixing can begin.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The two demo-blockers. These are in Foundational rather than in US1 because they
block **every** story, not only the one they belong to.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- **R-01 blocks all three.** Every route but Connect, Marketplace, and Agent Detail sits behind
  `RequireAuth`. Until sign-in works, US1's remaining findings cannot be seen on screen, US2's
  plan cannot be sanity-checked against a running product, and **no seller screen has ever
  rendered at all** — which is why the UI-07 carryovers were never executable.
- **R-02 blocks US1 and US2.** Act 2's verdict card is a US1 acceptance scenario and the
  centrepiece of §2 of the test plan.

- [X] T005 [P] Add `message: string` to `NonceResponse` in `src/api/types.ts`, with a doc comment stating it is signed verbatim and never reconstructed client-side; keep `nonce` (the contract requires it and the failure copy reads better with it)
- [X] T006 Change `src/auth/useSignIn.ts:173` to sign `message` rather than `nonce` — `signMessageAsync({ message: response.message, account: address })` — and update the comment above it, which currently records reasoning that expired (depends on T005)
- [X] T007 [P] Fix R-02 in `src/hooks/useVerdict.ts:72`: branch `isFatalError` on `error.code` (already parsed by `src/api/client.ts:90`) — fatal on `ORDER_NOT_FOUND`, `AUDIT_FAILED`, and 403; **not fatal on `VERDICT_NOT_FOUND`**; keep the status check as the fallback for a 404 carrying no code, treating an unknown-code 404 as fatal so nothing new gains an infinite-poll path
- [ ] T008 Verify T006 in the browser: sign in end to end, land signed in, then reload and confirm the session survives
- [ ] T009 Verify T007 in the browser with the network tab open: file a complaint, watch `VERDICT_NOT_FOUND` responses arrive on a 1s cadence until the ruling lands and the card appears — **then confirm the verdict request stops firing**, since the regression to watch for is a poll that never stops

**Checkpoint**: Sign-in works, the verdict card arrives, and every screen in the product is
reachable for the first time. User stories can now proceed.

---

## Phase 3: User Story 1 - The screen shows what the API actually sent (Priority: P1) 🎯 MVP

**Goal**: Every frontend↔API boundary agrees with the contract, or diverges on purpose with a
reason. No blank row, no missing warning, no page that throws.

**Independent Test**: Open a settled order — the citation checklist renders clause text, not
empty quotation marks. Open a seller's agent list containing an unregistered agent — it is
visibly marked as unbuyable, and stays marked in a desaturated screenshot.

### Implementation for User Story 1

- [X] T010 [US1] Add `listed: boolean` to `OwnedAgent` in `src/api/types.ts` per [data-model.md](./data-model.md) Part 2, with a doc comment naming `active: true, listed: false` as the dangerous pair — reads as healthy, invisible to every buyer
- [X] T011 [US1] Render the unregistered state in `src/components/OwnedAgentList.tsx`: an agent with `listed: false` is visibly distinguished from a buyable one **by a badge or label, not by colour alone**, and says why it cannot be bought (depends on T010)
- [X] T012 [P] [US1] R-04: change the buyer's trace copy in `src/components/ExecutionSteps.tsx` and `src/components/CaseFilePanel.tsx` so an unconditionally empty `steps` reads as *the trace is not available on a buyer's copy*, **not** as "the agent did nothing". No data workaround — do not fetch the seller endpoint, do not synthesise steps, do not hide the section
- [X] T013 [P] [US1] Verify R-05 requires no change: `POST /withdraw` returns `txHash`, `amountMinor`, `explorerUrl`; confirm `WithdrawResponse` in `src/api/types.ts` keeps `txHash: string | null` and that the wallet page uses its own explorer link and re-reads `GET /me` for figures
- [X] T014 [P] [US1] Verify R-06, R-08, R-09 require no change: `accountId` on `GET /me`, `model` on the verdict, `version` on the agent listing all arrive and are correctly not declared in `src/api/types.ts`
- [X] T015 [P] [US1] Verify R-11's enumerations against the contract: `jq -r '.components.schemas.OrderState.enum[]' api/docs/openapi.yaml` against `OrderState` in `src/api/types.ts`, and the same for `LedgerKind`, `VerdictTier`, `CitationSource` — 8/4/5/3 members, same order, no change expected
- [X] T016 [P] [US1] Verify R-11's fatal/retryable rule and per-endpoint auth against [contracts/boundary-inventory.md](./contracts/boundary-inventory.md): `useOrder`'s fatal set is `{404, 403}`, and the three routes that render without a session call only `public` or `optional` endpoints
- [X] T017 [P] [US1] Discharge carryover T033 in `src/lib/verdict.ts`: confirm `VerdictResponse` carries no `sellerMinor`, so `splitFor`'s `priceMinor - refundMinor` and its reconciliation guard **stay unchanged**. Answered, not deferred again
- [X] T018 [US1] Run `npm run build` and confirm `tsc` is clean after T005–T012
- [ ] T019 [US1] Walk US1's six acceptance scenarios in the browser: citation clause text renders; an unregistered agent is marked; an unknown enum member degrades rather than blanks; a seller opens a disputed sale and sees a readable case file and verdict with **no reply control**; a permanently-failing request stops rather than retrying; an unknown settled figure reads `—`, not `$0.00`

**Checkpoint**: The frontend matches the contract. US1 is independently demonstrable without
either document existing.

---

## Phase 4: User Story 2 - A tester runs a full pass without reading code (Priority: P2)

**Goal**: `docs/manual-test-plan.md` — a checklist a human executes with a browser and no
source access, written for someone running it tired.

**Independent Test**: Hand it to someone unfamiliar with the source. Every step passes or
fails; no step needs them to ask what "correct" means.

**Note on parallelism**: §0–§7 are sections of **one file**, so they are sequential by nature.
The `[P]` markers here are sparse and honest rather than decorative.

### Implementation for User Story 2

- [X] T020 [US2] Create `docs/manual-test-plan.md` with the §0–§7 skeleton, a title, a duration estimate, and the four rules from [contracts/test-plan-outline.md](./contracts/test-plan-outline.md) restated at the top for whoever edits it next
- [X] T021 [US2] Write §0 Preconditions in `docs/manual-test-plan.md`: services and ports (**Postgres on 5433**), which wallets need MON and which need test USDC, `POST /demo/seed`, browser wallet on **Monad Testnet chain 10143**, and **two accounts** — the acts need a buyer and a seller and one wallet cannot be both
- [X] T022 [US2] Write §1 Smoke in `docs/manual-test-plan.md`: app loads, `/health` answers, `/docs` renders, sign-in produces a session that survives a reload — with the R-01 symptom note (a 401 after a wallet-approved signature reads as a rejected signature but is a client defect)
- [X] T023 [US2] Write §2 The three acts in `docs/manual-test-plan.md`, each start to finish per `product-workflow.md` §5.3: exact input **posted verbatim from the seeded fixture** (a retyped input produces a live run, not the scripted one), acceptance criteria to type, expected tier, expected split **in dollars**, and the on-screen result of every state change in [data-model.md](./data-model.md) Part 3. Include the four named steps: the countdown flips the page with nobody touching the keyboard · a complaint reaches a verdict without a refresh · the transaction hash lands on a page that exists · balance figures move on settlement. Discharges QS-B…QS-F
- [X] T024 [US2] Write §3 Seller flow in `docs/manual-test-plan.md`: list an agent, see it in the marketplace, toggle inactive, watch it leave, **toggle it back**; a `listed: false` agent visibly distinguished on the seller's own list; a disputed sale opened as the seller with case file and verdict readable and **no reply control**; a settled order opened **as the buyer** confirming the `perspective` prop changed nothing about the verdict card. Note that these have never run before T006. Discharges T040, T029-live, SELLER-DISPUTE
- [X] T025 [US2] Write §4 Money in `docs/manual-test-plan.md`: top-up, cash-out, withdraw, and the ledger explaining all three; **the three figures never collapse into one**; "funded from the demo treasury" stated on screen
- [X] T026 [US2] Write §5 Degradation in `docs/manual-test-plan.md`: a settled figure of `—` rather than `$0.00`, a labelled loading line rather than a blank card, a page that does not move backwards — plus a step for the 502 `ChainOutcomeUnknownResponse`, which is **not a failure**: the expected result is a transaction hash to follow, not an error banner
- [X] T027 [US2] Write §6 Human-judgement checks in `docs/manual-test-plan.md`: greyscale on the verdict card **and the seller screens** (including that a `listed: false` agent stays marked) · legibility at ~3m for tier, refund figure, ✓/✗ · the stranger test · a ~300-character clause not breaking the checklist. State that a greyscale or 3m failure is **wrong, not unpolished**. Discharges T039, GREY-VERDICT, LEGIBILITY-3M, STRANGER, LONG-CLAUSE
- [X] T028 [US2] Write §7 Redaction in `docs/manual-test-plan.md`: inspect the **network response** for a buyer's case file, not the rendering; expect no `systemPrompt` anywhere in the payload; with the R-04 symptom note — the buyer's `steps` is `[]` on every order and that is a **known API defect, not a frontend failure**, distinguished by the seller's case file for the same order carrying the populated trace
- [X] T029 [US2] Add the remaining required items to `docs/manual-test-plan.md`: reset instructions (`POST /demo/reset`, and **what it does and does not clear** — a database reset does not undo on-chain state), and the My Orders step establishing that a titled placeholder is the **expected** result (R-07), so a tester does not file a false failure
- [X] T030 [US2] Add symptom notes wherever a failure is subtle, at minimum: the sign-in 401 (R-01) · citation rows rendering as empty quotation marks (the `quote`/`clause` bug — fixed, but this is what a regression looks like) · the empty buyer trace (R-04) · the My Orders placeholder (R-07) · the 502 that is not a failure
- [X] T031 [US2] Audit `docs/manual-test-plan.md` for the four rules: one expected result per step, a pass/fail box on **every** step, no assertion a browser cannot show, and zero hits from `grep -niE "looks? (right|correct|good|fine)|seems fine|renders properly|works correctly|is displayed correctly" docs/manual-test-plan.md`

**Checkpoint**: The plan exists and passes its own rules. It has not been executed.

---

## Phase 5: User Story 3 - Nothing deferred is lost, nothing absorbed (Priority: P3)

**Goal**: Two paper trails — the reconciliation record, and the carryover index that turns a
deferral into a scheduled check.

**Independent Test**: Read the divergence report's `api-wrong` row and find it in the note with
a resolution. Read the ten-entry carryover register and find each one in the plan.

### Implementation for User Story 3

- [X] T032 [US3] Create `docs/reconciliation-note.md` per [contracts/reconciliation-note.md](./contracts/reconciliation-note.md): header, how-to-read, summary with blockers named in the first line, and the row table — all eleven findings from [research.md](./research.md), each with boundary, what differed **on both sides**, the divergence-report verdict, resolution, and a reason (including on the `no-change` rows)
- [X] T033 [US3] Add the *`api-wrong` rows in full* section to `docs/reconciliation-note.md` for R-04: what the API does, why divergence row 5 calls it wrong, what was escalated and to whom, and what the frontend does meanwhile (copy change, no data workaround). Confirm no `api-wrong` row is resolved `fixed-frontend`
- [X] T034 [P] [US3] Add the *orphan endpoints* section to `docs/reconciliation-note.md`: all six from [contracts/boundary-inventory.md](./contracts/boundary-inventory.md) — `GET /orders`, `POST /onramp/routes`, `POST /offramp/routes`, both `/agents/{id}/versions` routes — each with a reason, noting that the versions GET is an orphan **by design** because it carries `systemPrompt`
- [X] T035 [P] [US3] Add the *fields the contract sends that no frontend type declares* section to `docs/reconciliation-note.md`: `accountId`, `version`, `model`, `explorerUrl`, `amountMinor`, and the buyer's `steps` — each with a reason beyond "the API sends it"
- [X] T036 [P] [US3] Add the *what agrees* section to `docs/reconciliation-note.md` from research R-11 — four enumerations, money and casing conventions, status codes, per-endpoint auth, seller-authorised reads, request-body omissions — so the next pass does not re-derive it
- [X] T037 [P] [US3] Escalate R-04 against the `api/` component, referencing `api/docs/openapi-divergences.md` row 5 and its `DO NOT ADOPT` marker. The row closes in `docs/reconciliation-note.md` and stays open in `api/` — two books
- [X] T038 [US3] Add the carryover index to `docs/manual-test-plan.md`: all ten register entries from [data-model.md](./data-model.md) mapped to their steps, with **T033 marked `answered`** by the reconciliation rather than discharged by a step (depends on T020–T029 for the step numbers to reference)

**Checkpoint**: Every disagreement has a resolution on the record, and every deferral has a
step or an answer.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [X] T039 [P] Run [quickstart.md](./quickstart.md) §3 against `docs/reconciliation-note.md`: the one `api-wrong` row appears with a resolution, no `api-wrong` row is `fixed-frontend`, all six undeclared fields appear with reasons, all six orphans appear, every row has a reason
- [X] T040 [P] Run [quickstart.md](./quickstart.md) §4 rules 1–5 against `docs/manual-test-plan.md`: zero grep hits, a checkbox on every step, §0–§7 all present, all ten carryovers findable, symptom notes on all five named cases
- [ ] T041 Run [quickstart.md](./quickstart.md) §4 rule 6 — the stranger check **on the document itself**: hand it to someone who has not read the source, watch them run §1 and one act, and treat every question they must ask as a defect in the plan. This is the only check here that cannot be automated and the one that matters
- [X] T042 Run `npm run build` and confirm `tsc` is clean across the whole feature
- [X] T043 Confirm the boundary is respected: **no step in `docs/manual-test-plan.md` is reported as passing** as part of this feature, no automated test was added, no page that did not exist was built, and the API was not changed

**Checkpoint**: Both deliverables validated against their own contracts. Ready to hand to a
tester — who executes the plan; this feature does not.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies. T001 → T002 → {T003, T004}
- **Foundational (Phase 2)**: Depends on Setup. **BLOCKS all three user stories** — R-01 makes
  every guarded route unreachable, and no seller screen has ever rendered
- **US1 (Phase 3)**: Depends on Foundational
- **US2 (Phase 4)**: Depends on Foundational. Best written after US1 so the plan describes a
  product that can pass it — a plan written against a build that 401s has never been
  sanity-checked, which is the 3am-ambiguity failure the spec warns about
- **US3 (Phase 5)**: Depends on Foundational for the findings' resolutions; T038 additionally
  depends on US2 for step numbers
- **Polish (Phase 6)**: Depends on US2 and US3 producing their documents

### User Story Dependencies

- **US1 (P1)**: Independent once Foundational is done. Deliverable on its own — a
  contract-accurate frontend with no document written
- **US2 (P2)**: Independent in principle; **sequenced after US1 in practice** for the reason
  above. T038 in US3 writes into US2's file
- **US3 (P3)**: Independent of US2 except T038. T032–T037 can run alongside US2

### Parallel Opportunities

| Where | Tasks | Why |
| --- | --- | --- |
| Setup | T003, T004 | Two independent live confirmations |
| Foundational | T005, T007 | `types.ts` and `useVerdict.ts` — different files |
| US1 | T012, T013, T014, T015, T016, T017 | One component pair and five read-only verifications, all different files |
| US3 | T034, T035, T036, T037 | Three appended sections and an escalation raised elsewhere |
| Polish | T039, T040 | Two documents, two checks |
| Across stories | US1 (T010–T019) ‖ US3 (T032–T037) | Different files entirely — one developer on code, one on the record |

**US2 has almost no parallelism**, and that is real rather than an oversight: §0–§7 are
sections of a single file.

---

## Parallel Example: User Story 1

```bash
# After T010/T011 (both touch types.ts / OwnedAgentList.tsx), launch the rest together:
Task: "R-04 buyer trace copy in src/components/ExecutionSteps.tsx and CaseFilePanel.tsx"
Task: "Verify R-05 withdraw no-change in src/api/types.ts"
Task: "Verify R-06/R-08/R-09 undeclared fields in src/api/types.ts"
Task: "Verify the four enumerations against api/docs/openapi.yaml"
Task: "Verify fatal/retryable and per-endpoint auth against contracts/boundary-inventory.md"
Task: "Discharge T033 — confirm splitFor's subtraction stays in src/lib/verdict.ts"
```

---

## Implementation Strategy

### MVP scope

**Phase 1 + Phase 2 + Phase 3 (US1).** That is a product that signs in, shows a verdict, and
matches its contract — demonstrable end to end with neither document written.

If time collapses entirely, **Phase 2 alone is the floor**: without T006 there is no demo at
all, and it is a one-argument change.

### Incremental delivery

1. Setup + Foundational → **the product works for the first time**; every seller screen becomes
   reachable
2. + US1 → the screens tell the truth → demoable (MVP)
3. + US2 → a tester can verify it without reading code
4. + US3 → nothing deferred is lost, nothing absorbed
5. + Polish → both documents validated against their own contracts

### Parallel team strategy

Two developers, after Foundational: **A** takes US1 (code), **B** takes US3's T032–T037 (the
record) from [research.md](./research.md), which is already written. They converge on US2 —
whoever finishes first writes it, since it is a single file and sequential either way.

---

## Notes

- **Do not generate types from `openapi.yaml`.** Six frontend types encode guarantees by
  omission; a generator would restore the fields and delete the guarantee while everything
  still compiled. T010's `listed` is an addition **with a stated reason**, which is the bar
- **Do not fix the API.** R-04 is escalated (T037), not worked around
- **Do not build My Orders.** It stays a placeholder; T029 makes that the documented expectation
- **Do not execute the test plan.** T043 is the check that this held
- Commit after each task or logical group
- Stop at any checkpoint to validate a story independently
