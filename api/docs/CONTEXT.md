# `api/` — Context Briefing

Everything needed to build the backend. Read this first; the root docs have the
detail.

**Root docs that matter here:**

| Doc | Why |
| --- | --- |
| [`../../docs/api-design.md`](../../docs/api-design.md) | **The specification.** Modules, endpoints, the purchase saga, cron jobs. |
| [`../../docs/database-schema.md`](../../docs/database-schema.md) | 8 tables, full DDL, the money model |
| [`../../docs/smart-contract.md`](../../docs/smart-contract.md) | The contract this talks to — functions, roles, events |
| [`../../docs/agent-definition.md`](../../docs/agent-definition.md) | What a seller sells; what Guardian judges against |
| [`../../docs/product-workflow.md`](../../docs/product-workflow.md) | The product rules the code enforces (tiers, windows, finality) |
| [`../../docs/rain-integration.md`](../../docs/rain-integration.md) | Why Rain is stubbed; the funder-wallet model |
| [`../../docs/tech-stack.md`](../../docs/tech-stack.md) | LLM choices, structured outputs, prompt caching |
| [`../../docs/project-structure.md`](../../docs/project-structure.md) | Docker, migrations, viem, Monad gas |

---

## 1. What this component is

The whole backend: marketplace, execution host, audit engine, and the only thing
that talks to the chain. NestJS + TypeORM + PostgreSQL, viem for chain access,
Anthropic SDK for both LLM roles.

**It is also the trusted party.** It runs the seller's agents, produces the evidence,
holds the pooled funds, and signs every transaction. Most of the design decisions
below exist to keep that trust narrow and visible.

## 2. Nine invariants — break these and something subtle goes wrong

1. **Order two-phase money flows so a crash leaves the pool over-funded.** The
   solvency invariant is `operator pool >= Σ ledger balances` (database-schema §3.3)
   — note the `>=`. **Whichever write increases what we owe goes second.**

   | Flow | Ledger | Chain | Order |
   | --- | --- | --- | --- |
   | Purchase | ↓ | ↓ into escrow | Postgres first |
   | Cash-out | ↓ | ↓ pool → funder | Postgres first |
   | **Top-up** | ↑ | ↑ funder → pool | **chain first** |

   In practice that reads as **"Postgres first, chain second"** for everything that
   *reduces* the ledger, which is most of it — a bad DB write is trivial to
   compensate, a stray on-chain deal is not. **Top-up is the one flow that inverts**,
   because crediting before the tokens land promises money the pool does not hold.
   Do not apply the short version to a flow that increases a balance. Every two-phase
   flow has an explicit failure branch.
2. **One money unit in the database: USD cents.** Token base units (6 decimals)
   exist **only** inside `chain/`. One `× 10⁴` conversion, one file.
3. **`system_prompt` never reaches a buyer** — and the boundary is wider than one
   column: execution steps can paraphrase the prompt, so reasoning text is
   summarised, not passed through. One serialiser, not a rule to remember.
4. **The ledger is append-only.** Balance is `SUM(amount_minor)`. No mutable balance
   column anywhere.
5. **Settlement writes no ledger entry.** Settled funds are on-chain under the
   user's own address; we cannot recapture them, by design.
6. **Orders point at `agent_version_id`, never `agent_id`.** A dispute is judged
   against the definition that actually ran.
7. **`runs.output IS NULL` is evidence, not an error.** It is how non-delivery is
   proven. Never retry over it, never clean it up.
8. **The verdict is persisted before the chain call**, and re-auditing an order that
   already has one is refused. That is what makes the demo replayable.
9. **`orders.state` is the queue.** No Redis, no BullMQ; a cron reaper catches
   anything stuck.

## 3. Module map

| Module | Owns |
| --- | --- |
| `auth` | Wallet nonce/verify, JWT, account creation on first sign-in |
| `accounts` | Balance, ledger, `/me` |
| `funding` | Funder wallet → operator pool, top-up, offramp |
| `rain` | **Stubbed** — logs the request it would send, makes no call |
| `catalog` | Agents, versions, definition hashing, the serialisation boundary |
| `orders` | Purchase saga, accept, complain, case file |
| `execution` | The wrapped workspace — runs seller agents, writes run records |
| `guardian` | Case-file assembly, audit, verdict, on-chain `resolve` |
| `chain` | viem adapter — three clients, the only unit conversion |
| `jobs` | Sweeper · reclaimer · reaper |

**Keep `execution` and `guardian` from importing each other.** Execution produces
evidence; Guardian consumes it. That separation is what makes "the platform produced
the evidence, not the audited party" true in code and not just in prose.

## 4. LLM usage

| Role | Model | Notes |
| --- | --- | --- |
| Guardian's audit | `claude-opus-5` | Structured output → `{ tier, reasoning, citations }`. Cache the system prompt + rubric. |
| Seller agents | `claude-haiku-4-5` | Output constrained by the agent's own `output_schema` |

SDK: `@anthropic-ai/sdk`. Use `client.messages.parse()` with a Zod schema — it fits
the Nest/TypeScript idiom and guarantees the verdict shape.

**Note:** `temperature` is not available on Opus 5, so verdicts are not
reproducible by sampling control. That is why verdicts are persisted and replayed
rather than re-computed.

## 5. Chain access

Three viem clients, because there are three keys:

| Client | Key | May call |
| --- | --- | --- |
| `publicClient` | — | reads, receipts, `totalEscrowed` |
| `operatorClient` | `OPERATOR_PRIVATE_KEY` | `registerAgent`, `updateAgent`, `openDeal`, `markDelivered`, `accept`, `dispute`, `release`, `withdrawFor` |
| `guardianClient` | `GUARDIAN_PRIVATE_KEY` | **`resolve` only** |

Give `guardianClient` an ABI containing only `resolve`. The role separation is only
real if signing an `openDeal` with the guardian key is a compile error rather than a
code-review question.

**Monad gas:** you are charged the gas **limit**, not usage. Don't estimate-and-pad
on the operator's hot paths.

## 6. Out of scope

Agent buyers and Rain cards (deferred) · live Rain calls · webhooks · job queues ·
pagination · rate limiting · reputation · appeals · offramp to a real bank.

## Automated tests — out of scope

**No unit, integration, or e2e tests in this component.** Time-boxed MVP decision:
the only test suite we keep is the escrow contract's (`sc/` SC-02), because a
contract bug means money moving wrong and costs a redeploy to fix.

**Acceptance criteria in these specs are therefore verified by hand.** Which makes
the demo rehearsal the real test suite — run all three acts end to end more than once,
and treat a failed rehearsal the way you'd treat a red build.
