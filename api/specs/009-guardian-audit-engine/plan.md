# Implementation Plan: The Guardian audit engine — the cited verdict

**Branch**: `009-guardian-audit-engine` | **Date**: 2026-08-09 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/009-guardian-audit-engine/spec.md`

## Summary

One new module — `src/guardian/` — plus one HTTP route, two new environment keys, **one
two-column migration**, and **no new dependency**. This is the feature the other eight exist to
make possible, and almost all of its plumbing was built ahead of it.

> **The migration was not in the first draft of this plan.** It is the price of bounding audit
> attempts and making an exhausted audit visible (R14), a decision taken in review after
> checking what actually recovers a stuck dispute: nothing does. Two columns on `orders`,
> no change to the state machine.

**The schema, the chain adapter, and the SDK are already in place.** `verdicts` exists with
its `UNIQUE (order_id)`, its `CHECK (refund_minor >= 0)`, `verdict_hash bytea`, and `model`
— created by API-02's `InitialSchema` and never touched since. `EscrowGuardianService.resolve`
exists, is paired with a one-entry ABI, and already takes `(dealId, VerdictTier, verdictHash)`
in exactly that shape, with a doc-comment explaining that it never computes the hash because
the verdict "must already exist and be persisted before this runs". `tier.ts` already maps
`VerdictTier ↔ Tier` exhaustively. `OrderState.Adjudicated` already exists and
`order-states.ts` already documents it as *"the invariant #8 window"*. `@anthropic-ai/sdk` is
installed and `ANTHROPIC_API_KEY` is required at boot. The work here is the pipeline, the
prompt, and the two validations — not the plumbing.

Fourteen decisions carry the feature, all argued in [research.md](./research.md):

- **The audit trigger is a poller with two passes** (R1) — audit-pending and settle-pending —
  because `orders.state` is the queue (invariant #9) and the second pass is what makes FR-024
  ("a retry uses the stored verdict") structural rather than remembered.
- **No new order state is added, and the claim is not a state move** (R2). API-08 could claim
  by moving `purchased → running`; there is no equivalent word between `disputed` and
  `adjudicated`, and `adjudicated` must keep meaning *"a verdict row exists"*. The
  `UNIQUE (order_id)` on `verdicts` is the concurrency guarantee, and the poller's
  re-entrancy guard is what stops a wasted model call.
- **`messages.parse()` with a Zod schema, and read the SDK rather than the general rule** (R3).
  The transform drops most constraints but **passes `minItems` through when it is 0 or 1** — so
  `.min(1)` *is* enforced on the wire and a zero-citation ruling is not representable. It also
  forces `additionalProperties: false` on every object, which is why this feature cannot hit the
  defect that refused every seeded schema in the execution engine's verification run.
- **Citation traceability is verified in code, against normalised text** (R4). FR-012 is the
  requirement that turns "citations are the credibility" into something a fabricated quote
  actually fails.
- **The verdict fingerprint is a SHA-256 over a canonically-ordered projection of the
  persisted row** (R5) — 32 bytes, because the contract's parameter is `bytes32` — computed
  once, stored, and never recomputed at settle time.
- **⚠️ Guardian IS shown the seller's prompt and the raw trace, and the containment sits on the
  output** (R6, R13). A first draft of this plan excluded both; that reversed a settled product
  decision and is withdrawn. See below.
- **`refusal` and `max_tokens` are checked before `content`, and `maxRetries: 0`** (R7).
  Opus 5 ships elevated cybersecurity safeguards and can decline with an HTTP 200; a
  complaint whose prose trips a classifier must look like an undecided dispute, not a crash.
- **The cached prefix is a frozen constant with no interpolation, and it must clear 512
  tokens** (R8). Opus 5 halves the cacheable minimum from 1024 to 512 — below it, caching
  fails *silently*, with no error and `cache_creation_input_tokens: 0`.
- **`refund_minor` is a record of the ruling, not the instrument of payment** (R9), and this
  feature adds the codebase's only tier→amount arithmetic — which `tier.ts` explicitly
  declines to own.
- **Non-delivery is decided by the model and asserted by code** (R10). A code short-circuit
  would produce the bare, uncited tier the whole feature exists to avoid.
- **The buyer-facing serialiser work is already done** (R11) — and was done *better* than the
  source spec asked for. Nothing to build; see amendment 3.
- **The verdict commits in its own transaction, before any chain call** (R12). This is
  `purchase.service.ts`'s shape rather than `settlement.service.ts`'s, and here it is
  mandated by invariant #8 rather than chosen.
- **⚠️ The containment for showing Guardian the prompt is a check on the ruling** (R13) — a
  verbatim word-run rejection before persistence, turning `agent-definition.md` §4's instruction
  into something a leak actually fails.
- **Attempts are bounded and an exhausted audit is visible** (R14), because nothing else in the
  system recovers a stuck dispute inside 72 hours. This is what costs the migration.

### Three spec amendments — one withdrawn, two made in review

**1. ⚠️ WITHDRAWN: the earlier amendment excluding the system prompt and the raw trace.**

A first draft of this plan replaced FR-003 and FR-006 so that Guardian saw neither the seller's
`system_prompt` nor `runs.steps[].reasoning`. The reasoning was that Guardian's own `reasoning`
reaches the buyer through no serialiser, so nothing prompt-derived should enter the audit.

**The observation was right and the conclusion reversed a settled product decision.**
`agent-definition.md` §4 is a per-party table whose Guardian row reads *"Yes — needed for
intent-vs-effort judgment"*, and it already anticipates the risk, stating the containment as an
instruction: *"Guardian's reasoning may describe execution behaviour … but must never quote the
prompt."* `product-workflow.md` §6.3 says the same of the trace: the execution steps *"are what
lets Guardian distinguish 'the agent genuinely tried and the task was impossible' from 'the agent
returned a stub without attempting the work.' Those deserve different verdicts, and only the
trace can tell them apart."* In tier terms that is 25% versus 75% of the buyer's money.

Excluding one input while shipping the other was also incoherent: the draft dropped step
`reasoning` because it is *derived from* the prompt, which only matters if the prompt is absent.

**FR-003 and FR-006 are restored, and the containment moved from the input to the output.**
FR-042 rejects any ruling whose reasoning reproduces a verbatim run of the prompt, before it is
stored — turning §4's instruction into a check, which is the half of the original argument that
survives. Paraphrase is deliberately not covered: §4 explicitly permits reasoning that describes
execution behaviour, and its own example sentence is a paraphrase. R6 and R13 carry it in full.

**2. Retries are bounded, and an exhausted audit is visible (FR-043, FR-044).** The spec's
Assumptions said a repeatedly-failing audit stays `disputed`, which *"is the correct-looking
outcome for a dispute that could not be decided."* Checking the surrounding system shows it is
not: API-10's reaper covers `running` past its timeout and nothing else, so **no scheduled job
touches a stuck dispute**, and the only backstop is the escrow's 72-hour `DISPUTE_DEADLINE` plus
permissionless `forceResolve` at a fixed quarter tier — unreachable in a rehearsal. Unbounded
retry does not produce an order that looks *undecided*; it produces one that looks *in progress*,
forever, with nothing behind it. Three attempts, then a stamped `audit_failed_at` the verdict
route reports. The money is **not** freed by a fabricated fallback ruling (FR-041, SC-013); it
waits for the contract. R14.

**3. "Summarise reasoning text for buyer-facing case files" is already satisfied — by omission,
which is stronger.** Unchanged from the first draft and confirmed. `toBuyerCaseFileSteps` drops
model reasoning outright and composes each step's description from platform-authored fields;
`case-file.dto.ts` records why in writing — *"asking a model to summarise reasoning means feeding
the prose to a model whose output ships to the buyer, which is the same disclosure with an extra
step in front of it."* FR-036 is therefore a **regression check**, not a task. Note this leaves
the buyer's step view *stricter* than FR-035 is about verdict prose, and the asymmetry is
deliberate: a step's `reasoning` is raw seller-side model output with no reader in between,
whereas verdict prose is written by an auditor that was instructed not to quote and is checked
before it is stored.

## Technical Context

**Language/Version**: TypeScript 6.0 on Node 22 (`engines.node >= 22`)

**Primary Dependencies**: NestJS 11 · TypeORM 1.1 · `@anthropic-ai/sdk` 0.116 (already
installed by API-08 — **this feature adds no dependency**) · Zod 4, already used for the env
schema and now for the structured-output schema · viem, via the existing chain adapter. Not
added: `@nestjs/schedule`, no queue, no broker, no retry framework.

**Storage**: PostgreSQL. `verdicts`, `complaints`, `orders`, `runs`, `agent_versions`,
`agents` — all six already exist. **No migration in this feature.**

**Testing**: None. Automated tests of every kind are out of scope for this component
(`docs/CONTEXT.md`). Acceptance is by hand, via [quickstart.md](./quickstart.md), and the
demo rehearsal is the test suite.

**Target Platform**: Single Linux container, one process. Multi-process is safe — the
`UNIQUE (order_id)` is the real guarantee — but the poller's serialisation is per-process.

**Project Type**: Backend web service. One route (`GET /orders/:id/verdict`) plus a worker.

**Performance Goals**: Demo scale. One audit in flight per process; a poll every
`GUARDIAN_POLL_INTERVAL_MS` (default 2000). One non-streaming Opus 5 call per audit, with
thinking on by default — expect tens of seconds, dominated by the model. SC-003's
"within one minute of the complaint" is the budget: poll interval + one model call + one
Monad transaction.

**Constraints**: Exactly one verdict per order, forever, enforced by `UNIQUE (order_id)`.
No sampling parameters — `temperature`/`top_p`/`top_k` all return 400 on Opus 5. No SDK
retry (`maxRetries: 0`, R7). No streaming — a structured output has nothing to render
incrementally. The system prefix must be byte-identical across audits or prompt caching
silently does nothing.

**Scale/Scope**: ~16 new files in one module, ~3 edited files elsewhere (app module, env
schema, chain module export). One route. Three orders per rehearsal, one of which is
disputed twice — once upheld, once rejected.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

`.specify/memory/constitution.md` is the **unmodified Spec Kit template** — no principles have
been ratified, so there are no constitution gates to evaluate and none are asserted here.

The binding constraints for this component are `docs/CONTEXT.md`'s nine invariants and its
module map, checked here because they are what a reviewer will hold this feature to.

| Constraint | Applies here? | How this design satisfies it |
| --- | --- | --- |
| #1 Two-phase money ordering | **Partly** | Settlement moves money **on-chain only** and writes no ledger row, so the Postgres-first/chain-second table does not apply directly. What does apply is its spirit, and invariant #8 states the ordering explicitly: the verdict commits first, the chain call runs second, and the failure branch is explicit (R12). |
| #2 One money unit (USD cents) | **Yes** | `refund_minor` is USD cents (R9). No token base unit appears outside `chain/`; `resolve` takes a tier and a hash, not an amount. |
| #3 `system_prompt` never reaches a **buyer** | **Yes — the constraint this feature is most able to break** | Guardian *is* shown the prompt (`agent-definition.md` §4) and its reasoning *is* buyer-facing with no serialiser in front of it — so the guarantee cannot hold at the input, and holds at the **output** instead: FR-042 rejects any ruling reproducing a verbatim run of the prompt, before it is stored (R6, R13). This is the single most important line in the plan. |
| #4 Ledger append-only | No | No ledger writes. |
| #5 Settlement writes no ledger entry | **Yes** | FR-026. `LedgerKind` has no `settlement` member and this feature does not add one. The contract credits `balances[]` at each party's own address. |
| #6 Orders point at `agent_version_id` | **Yes** | The case file's capabilities and exclusions come from the join through `orders.agent_version_id` (FR-002). A citation must trace to text that was live when the buyer paid; today's listing is never read. |
| #7 `runs.output IS NULL` is evidence | **Yes** | FR-004 and FR-014. The assembler states the absence as an explicit fact in the case file rather than omitting a field, and R10 asserts the resulting tier floor in code. |
| #8 Verdict persisted before the chain call | **Yes — the feature that implements it** | R12. The verdict's transaction commits before `resolve` is called, and a chain failure leaves a readable verdict on an `adjudicated` order. FR-018, FR-023, FR-025. |
| #9 `orders.state` is the queue | **Yes** | R1. Two state predicates, no broker, no Redis. |
| §3 `guardian` must not import `execution` | **Yes** | Nothing in `src/guardian/` imports `src/execution/`. Guardian **reads the `runs` table** through its own repository, which is not the same thing — execution produces the evidence, Guardian consumes it, and the one-way direction is what makes *"the platform produced the evidence, not the audited party"* true in code. |
| §3.4 Three reads authorised on buyer **or** agent owner | **Yes** | FR-030. The verdict read reuses `OrderRepository.findVisibleToAccount`, which already resolves the seller through `order → agent_version → agent → owner_account_id` and already returns one indistinguishable `null` for both "no such order" and "not your order" (FR-031). |
| Tests out of scope | **Yes** | No test files are produced. `quickstart.md` is a manual script. |

**Result: pass, with one thing to watch, and it is #3.** Every other invariant this feature
touches is enforced by a constraint that already exists — a UNIQUE, a CHECK, an exhaustive
`Record<K, V>`, a one-entry ABI. #3 is the odd one out: it is enforced by a **runtime check on
model output**, which is the weakest enforcement mechanism in this plan and the only one that
could pass a review and still fail in production. It is that way because the thing being
contained is free prose written by a model, and there is no type that excludes a paraphrase.
The check catches verbatim reproduction; §4 accepts the paraphrase residue explicitly.

Two review obligations follow, and both belong in every review of this module:

> `grep -rn 'systemPrompt' src/guardian/` must return hits in **exactly three files** — the
> assembler, the validator, and the repository query. Any fourth is a leak surface.
>
> The canary check in `quickstart.md` §9 must be run against all three demo acts. It is the
> only thing that exercises FR-042 end to end.

**Post-design re-check (after Phase 1): pass, unchanged.** The design produced no new
violation, but it did move one and add one. #3's enforcement moved from the input to the output
after review restored FR-003 (R6, R13). `data-model.md` gained **two columns** — the cost of R14 —
and still adds no state. The one route reuses the existing authorisation query rather than
writing a second one.

## Project Structure

### Documentation (this feature)

```text
specs/009-guardian-audit-engine/
├── plan.md                          # This file
├── research.md                      # Phase 0 — R1–R12
├── data-model.md                    # Phase 1 — entities, state moves, the one migration
├── quickstart.md                    # Phase 1 — the manual acceptance script
├── contracts/                       # Phase 1
│   ├── guardian-case-file.md        # What the auditor is shown (and what it is not)
│   ├── verdict-schema.md            # The structured-output contract
│   └── verdict-api.md               # GET /orders/:id/verdict
├── checklists/
│   └── requirements.md              # Written by /speckit-specify
└── tasks.md                         # NOT created by /speckit-plan
```

### Source Code (repository root)

```text
api/src/
├── guardian/                         # NEW — the whole feature
│   ├── guardian.module.ts
│   ├── guardian.constants.ts         # model id, max tokens, tier basis points
│   ├── guardian.errors.ts            # AuditFailedError + the four reasons
│   ├── guardian.poller.ts            # two passes: audit-pending, settle-pending
│   ├── guardian.service.ts           # assemble → audit → validate → persist → settle
│   ├── guardian.repository.ts        # claim predicates, verdict insert, state moves
│   ├── case-file-assembler.ts        # ⚠️ carries the prompt + raw trace; never leaves the module
│   ├── auditor.ts                    # abstract port, mirroring execution/agent-runner.ts
│   ├── claude-auditor.ts             # messages.parse + zodOutputFormat + cache_control
│   ├── verdict.schema.ts             # the Zod schema; the wire contract
│   ├── verdict-prompt.ts             # FROZEN system prompt + rubric — the cached prefix
│   ├── verdict-validation.ts         # traceability + non-delivery floor + ⚠️ prompt-leak check
│   ├── verdict-hash.ts               # canonical projection → sha256 → 32 bytes
│   ├── refund.ts                     # tier → refund_minor (a record, not a payment)
│   ├── verdict.controller.ts         # @Controller('orders'), one GET
│   ├── verdict.service.ts            # read path + authorisation
│   ├── verdict-serialiser.ts         # row → response; the choke point for this route
│   └── dto/
│       └── verdict-response.dto.ts   # field names read literally by the UI
├── app.module.ts                     # EDIT — register GuardianModule
├── migrations/<ts>-AuditAttempts.ts  # NEW — two columns on `orders` (R14)
├── config/env.schema.ts              # EDIT — GUARDIAN_POLL_INTERVAL_MS, GUARDIAN_AUDIT_TIMEOUT_MS
└── chain/chain.module.ts             # EDIT (if needed) — export EscrowGuardianService
```

**Structure Decision**: One module, matching `docs/CONTEXT.md`'s module map, which assigns
`guardian` exactly this scope: *"Case-file assembly, audit, verdict, on-chain `resolve`"*.

Two placement calls worth stating:

- **`GET /orders/:id/verdict` lives in `guardian/`, not `orders/`,** on a
  `@Controller('orders')`. Nest permits two controllers on one path prefix, and the
  alternative — adding the route to `orders.controller.ts` — would make `orders` import
  `guardian` and put the verdict's shape two modules from the thing that writes it. The
  module map is explicit that the verdict is Guardian's.
- **Guardian has its own repository rather than importing `execution`'s.** It reads `runs`,
  `orders`, and `agent_versions` directly. Reading a table another module writes is not the
  import the §3 rule forbids, and `execution.repository.ts` set this precedent by owning the
  one query that selects `system_prompt` rather than sharing `orders`'.

## Complexity Tracking

No constitution violations to justify — the constitution is an unratified template, and the
`CONTEXT.md` invariant table above records a pass on every applicable row.

Three costs are worth recording anyway, because each is the kind of thing a reviewer would
otherwise flag:

| Cost | Why it is accepted | Simpler alternative rejected because |
| --- | --- | --- |
| **A migration, after the plan opened by claiming none** | It is what FR-043 and FR-044 need. Attempt counts and a terminal marker have to outlive the process, or a crash-loop retries forever and the visible failure disappears on the next deploy. Two columns on `orders`; the `order_state` enum is untouched. | Tracking attempts in memory resets on restart — turning a visible failure back into the spinner it was added to remove. A new terminal *state* would migrate the enum, force a decision about `ESCROWED_ORDER_STATES`, and add a word four other specs reason about, to say something two columns already say. |
| **A second query in the codebase that selects `system_prompt`** | `execution.repository.ts` is the first and its header explains the same inversion: the module needs the field and has no controller that returns anything built from it. `agent-definition.md` §4 requires Guardian to see it. | Withholding it costs the intent-versus-effort judgment §4 and §6.3 require — 25% versus 75% of the buyer's money — and was the withdrawn amendment 1. |
| **A runtime check as the enforcement for invariant #3 here** | Every other guarantee in this plan is a constraint, a `Record<K, V>`, or a one-entry ABI. FR-042 is an `if`, because the thing being contained is free prose from a model and no type excludes a paraphrase. | A paraphrase detector would reject the sentences §4 holds up as *correct* — its own example, *"the agent made one extraction attempt and stopped"*, is a paraphrase. Verbatim reproduction is what can be caught without false positives, and it is the failure a seller would recognise on sight. |
