# API-08 — Execution engine

**Component:** `api/` · **Depends on:** API-07 · **Size:** Large

> **Feed this file to `/speckit-specify`.** Read [`../CONTEXT.md`](../CONTEXT.md)
> first — it carries the nine backend invariants this spec assumes.

## Goal

The wrapped workspace: the platform runs the seller's agent and keeps the receipts.
This is what makes the evidence trustworthy — the audited party never authors it.

## In scope

- Load the **pinned** `agent_version` for the order
- Call Claude (`claude-haiku-4-5`) with the seller's `system_prompt` and the buyer's
  input, output constrained by the agent's `output_schema` (structured outputs)
- Write the `runs` row: `input`, `steps`, `output`, `error`, `started_at`,
  `finished_at`, `duration_ms`
- `output_valid` — does the output satisfy its own declared schema?
- Success → `markDelivered` on-chain → `state='delivered'`
- Crash or timeout → `state='failed'`, `output` stays NULL
- **Deterministic demo mode** for seeded agents

## Out of scope

**Automated tests of any kind** (MVP decision — see `../CONTEXT.md`). Plus:

Auditing, tools for seller agents, sandboxing untrusted code, retries.

## Acceptance

- A purchase produces an output and a delivered order
- A deliberately failing agent produces a `failed` order with a NULL-output run
- `output_valid` is populated on every completed run

## Watch out for

- **`output` NULL is the evidence of non-delivery.** Never retry over it, never
  clean it up — the `runs` UNIQUE on `order_id` makes that structural.
- **Capture `steps`, not just the answer.** They're what separates "genuinely tried,
  task was impossible" from "returned a stub without trying" — different verdicts,
  and only the trace can tell them apart.
- **Schema conformance is a pre-audit check.** An output that fails its own contract
  has already failed, and Guardian can say so without deliberating.
- Demo mode must fail **on cue** — seeded inputs that reliably produce the intended
  output, not a live model hoped to misbehave on schedule.

## Source

`../../../docs/product-workflow.md` §6 · `../../../docs/agent-definition.md` §2.2 ·
`../../../docs/tech-stack.md` §3.
