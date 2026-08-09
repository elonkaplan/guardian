# API-11 — Demo seed & the three seller agents

**Component:** `api/` · **Depends on:** API-06, API-08 · **Size:** Medium

> **Feed this file to `/speckit-specify`.** Read [`../CONTEXT.md`](../CONTEXT.md)
> first — it carries the nine backend invariants this spec assumes.

## Goal

The catalogue the demo runs on — and the failure modes all **three** acts depend on.
This spec is where the demo gets *designed*, not just implemented.

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
- **Three fixture inputs, one per act** (product-workflow §5.5):

  | Act | Agent | Seeded input | Must reliably produce |
  | --- | --- | --- | --- |
  | 1 | TLDR Agent | Document + *"under 100 words, must cover the pricing change"* | A valid **~85-word summary that does cover it** |
  | 2 | LedgerBot | A receipt with **exactly 5** line items | **3 returned, 2 dropped**, the two nameable |
  | 3 | PolyglotAI | A product description to translate | A **crash returning nothing** → `runs.output IS NULL` |

- Deterministic failure modes:
  - **LedgerBot returns 3 of 5 line items** → the 50% verdict is arithmetic
  - **TLDR Agent returns a valid 85-word summary** covering the required topic → its
    complaint is *correctly rejected*
  - **PolyglotAI crashes and returns nothing** → non-delivery, the 100% tier

## Out of scope

**Automated tests of any kind** (MVP decision — see `../CONTEXT.md`). Plus:

**Act 3′** — the *autonomous* variant of Act 3, where a buying agent files the
complaint itself. Agent buyers are deferred (product-workflow §5.3). **Act 3 itself
is in the demo** with a human buyer; only the machine-buyer framing is cut.

## Acceptance

- **Every seeded agent actually runs** — schemas accepted at execution, not just at
  listing. Verify by purchasing from each of the three, not by re-reading the JSON.
- A seeded database runs **all three acts** end to end
- Running them **twice produces the same verdicts**
- **PolyglotAI's crash lands as `runs.output IS NULL` and `state='failed'`** — through
  the real failure path, not a special case
- `demo/reset` returns the system to a re-runnable state

## Watch out for

- **Act 1's agent must succeed.** Its whole point is Guardian *rejecting* an
  unjustified complaint. If TLDR Agent under-delivers, the demo's opening argument
  inverts and the strongest beat is lost.
- **`wordCount` in the output makes Act 1 mechanical.** Guardian can quote the
  buyer's own 100-word cap back at them against a declared 85.
- **The array in LedgerBot's output is what makes Act 2 countable.** Free-text output
  would turn an arithmetic verdict into an opinion.
- **Act 3's crash must travel the ordinary failure path.** `runs.output IS NULL` is
  evidence, not an error (`../CONTEXT.md` invariant #7) — it is how non-delivery is
  proven. A seeded shortcut that writes a verdict directly, or an error row that
  never reaches `failed`, removes the very thing Guardian reads. The error must also
  be *recorded*, so the case file shows the crash rather than an empty silence.
- ⚠️ **Every `object` in an `output_schema` MUST set `additionalProperties: false`,
  or the agent cannot run at all.** Structured outputs reject a schema without it:

  ```
  output_config.format.schema: For 'object' type,
  'additionalProperties' must be explicitly set to false
  ```

  Ajv is more permissive than structured outputs, so a schema **passes listing
  validation and is refused at execution** (API-08 research R5, confirmed against
  the live API in both directions). API-08 verified this by failing all three
  seeded agents identically. The engine degrades correctly — a recorded failure
  naming the definition — which means the symptom is *every act failing for a
  reason unrelated to what Guardian is judging*. Set it on nested objects too, not
  only the root.
- **Act 1's fixture is the fragile one.** If the seeded summary drifts off the
  pricing change, the buyer's complaint becomes *valid* and a 0% ruling stops being a
  fairness demonstration and becomes a visible misfire. Check the fixture, not just
  the word count.
- Exclusions matter as much as capabilities — *"does not handle handwritten
  receipts"* is how a seller defends itself, and the demo should show one being
  cited.

## Source

`../../../docs/product-workflow.md` §5 · `../../../docs/agent-definition.md` §6.

**Build against [`../../../docs/openapi.yaml`](../../../docs/openapi.yaml)** (API-12) — it is the contract the frontend reconciles against, and a divergence here is a defect there.
