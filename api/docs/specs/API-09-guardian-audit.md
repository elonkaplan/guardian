# API-09 — Guardian audit engine

**Component:** `api/` · **Depends on:** API-07, API-08 · **Size:** Large

> ⚠️ **This is the product.** Everything else is scaffolding around it.

> **Feed this file to `/speckit-specify`.** Read [`../CONTEXT.md`](../CONTEXT.md)
> first — it carries the nine backend invariants this spec assumes.

## Goal

Turn a complaint into a cited, tiered verdict, and settle it on-chain.

## In scope

- **Case file assembly**: buyer input · acceptance criteria · **pinned** listing
  promise and exclusions · run steps · output · errors · timings
- Guardian system prompt and the tier rubric (0 / 25 / 50 / 75 / 100), with prompt
  caching on the stable prefix
- Claude (`claude-opus-5`) with structured output →
  `{ tier, reasoning, citations[] }`, each citation
  `{ source, quote, met }` where source is capability · exclusion · criterion
- Persist the verdict and `verdict_hash` **before** the chain call
- `guardianClient.resolve(dealId, tier, verdictHash)` → `state='settled'`
- Refuse to re-audit an order that already has a verdict
- `GET /orders/:id/verdict` — authorised for the **buyer *or* the agent's owner**.
  A seller ruled against who cannot read the ruling has no idea what they were
  found to have done (api-design §3.4). Field names are read literally by the UI:
  `{ source, quote, met }`, not `clause`.
- Extend the serialiser: **summarise reasoning text** for buyer-facing case files

## Out of scope

**Automated tests of any kind** (MVP decision — see `../CONTEXT.md`). Plus:

Appeals, multi-round arbitration, human review, reputation effects.

## Acceptance

- A complaint produces a persisted verdict with at least one citation
- The on-chain split matches the tier
- A second audit attempt on the same order is refused
- Non-delivery (NULL output) resolves at the full-refund tier

## Watch out for

- **Citations are the credibility.** A tier alone is an assertion; a tier plus *"this
  clause, unmet, here is the quote"* is an audit. They must be structured data — the
  UI renders them as a ✓/✗ checklist — not prose containing quotes.
- **Persist before settling, and never re-audit.** `temperature` isn't available on
  Opus 5, so a second audit could differ. Storing and replaying is what makes the
  demo reproducible — and it matches the product rule that verdicts are final.
- **Guardian judges against two yardsticks**: the listing promise *and* the buyer's
  acceptance criteria. A complaint about something never promised should reach 0%.
- **The redaction boundary is wider than `system_prompt`.** A reasoning step can
  paraphrase its own instructions, so buyer-facing steps get summarised, not passed
  through raw.

## Source

`../../../docs/product-workflow.md` §4.1–§4.3, §7.4 · `../../../docs/tech-stack.md`
§3, §5.

**Build against [`../../../docs/openapi.yaml`](../../../docs/openapi.yaml)** (API-12) — it is the contract the frontend reconciles against, and a divergence here is a defect there.
