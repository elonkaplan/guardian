# API-11 — Demo seed & the three seller agents

**Component:** `api/` · **Depends on:** API-06, API-08 · **Size:** Medium

> **Feed this file to `/speckit-specify`.** Read [`../CONTEXT.md`](../CONTEXT.md)
> first — it carries the nine backend invariants this spec assumes.

## Goal

The catalogue the demo runs on — and the failure modes both acts depend on. This
spec is where the demo gets *designed*, not just implemented.

## In scope

- `POST /demo/seed` — creates three agents with full definitions:

  | Agent | Price | Output contract |
  | --- | --- | --- |
  | **LedgerBot** | $2.00 | `{ lineItems: [{ description, amount }], total }` |
  | **TLDR Agent** | $1.00 | `{ summary, wordCount }` |
  | **PolyglotAI** | $1.50 | `{ translation }` |

  each with capabilities, exclusions, input/output schemas, prompt, model
- `POST /demo/reset` — clears orders, runs, complaints, verdicts (keeps accounts and
  agents)
- Fixture inputs: the 5-line receipt for Act 2, the summarisable document for Act 1
- Deterministic failure modes:
  - **LedgerBot returns 3 of 5 line items** → the 50% verdict is arithmetic
  - **TLDR Agent returns a valid 85-word summary** covering the required topic → its
    complaint is *correctly rejected*

## Out of scope

**Automated tests of any kind** (MVP decision — see `../CONTEXT.md`). Plus:

Act 3 and PolyglotAI's crash path (agent buyers are deferred — PolyglotAI is seeded
for catalogue realism only).

## Acceptance

- A seeded database runs Acts 1 and 2 end to end
- Running them **twice produces the same verdicts**
- `demo/reset` returns the system to a re-runnable state

## Watch out for

- **Act 1's agent must succeed.** Its whole point is Guardian *rejecting* an
  unjustified complaint. If TLDR Agent under-delivers, the demo's opening argument
  inverts and the strongest beat is lost.
- **`wordCount` in the output makes Act 1 mechanical.** Guardian can quote the
  buyer's own 100-word cap back at them against a declared 85.
- **The array in LedgerBot's output is what makes Act 2 countable.** Free-text output
  would turn an arithmetic verdict into an opinion.
- Exclusions matter as much as capabilities — *"does not handle handwritten
  receipts"* is how a seller defends itself, and the demo should show one being
  cited.

## Source

`../../../docs/product-workflow.md` §5 · `../../../docs/agent-definition.md` §6.
