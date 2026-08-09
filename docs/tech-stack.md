# Guardian — Technical Stack

**Status**: in progress — LLM choice proposed, awaiting approval.
**Last updated**: 2026-08-08
**Companion docs**: [product-workflow.md](./product-workflow.md) ·
[product-block-schema.md](./product-block-schema.md) · [discovery-notes.md](./discovery-notes.md)

---

## 1. Stack — decided by the user

| Layer               | Choice                            |
| ------------------- | --------------------------------- |
| **Frontend**        | React + TypeScript + Vite         |
| **Backend**         | NestJS + TypeScript + TypeORM     |
| **Database**        | PostgreSQL                        |
| **Smart contracts** | Solidity — **Monad Testnet** (chain 10143) |
| **LLM**             | Anthropic Claude — see §2         |

---

## 2. LLM selection

### 2.1 Guardian's audit — `claude-opus-5`

Guardian **is** the product, and its job is exactly the one where model capability
shows: reading a case file, weighing an output against a promise and a set of
criteria, and defending the call in writing. This is the judgment-critical path and
the thing judges will scrutinise — do not economise here.

- **Model ID**: `claude-opus-5`
- **Pricing**: $5 / $25 per million tokens (input / output)
- **Context**: 1M tokens, 128K max output
- **Thinking**: adaptive, **on by default** — no configuration needed
- **Effort**: defaults to `high`; sweep `medium` → `xhigh` on a few real case files

A dispute case file is small — an input, an output, a short execution trace, a
listing. Even at Opus pricing, a single audit costs **fractions of a cent**. Model
cost is not a hackathon constraint.

### 2.2 Seller agents — `claude-haiku-4-5`

The three demo sellers (LedgerBot, TLDR Agent, PolyglotAI) do straightforward
extraction, summarisation, and translation.

- **Model ID**: `claude-haiku-4-5`
- **Pricing**: $1 / $5 per million tokens
- Fast, cheap, and entirely adequate for the tasks in §5 of the product doc.

*(Alternative if a seller needs more quality: `claude-sonnet-5`, $3/$15 — currently
**$2/$10 introductory through 2026-08-31**, which covers the hackathon.)*

### 2.3 SDK

`@anthropic-ai/sdk` — the official TypeScript SDK. Same package for the NestJS
backend and any agent-side code. No provider shims.

---

## 3. Structured verdicts — the API feature that carries the product

Guardian's verdict is **machine-readable** by design — an agent buyer would consume
it with no human in the loop (product §2.4, deferred), and structured output costs
nothing to keep either way. The Claude API guarantees this via
**structured outputs** — a JSON schema the response is constrained to satisfy.

In TypeScript this is `client.messages.parse()` with a Zod schema, which fits the
NestJS + TypeORM + Zod idiom directly.

```ts
const Verdict = z.object({
  tier: z.enum(["0", "25", "50", "75", "100"]),
  reasoning: z.string(),
  citations: z.array(z.object({
    source: z.enum(["capability", "exclusion", "criterion"]),
    quote:  z.string(),
    met:    z.boolean(),
  })),
});
```

Two things this buys us:

1. **The tier is an enum, not a number the model invents.** §4.2's fixed tiers become
   a schema constraint rather than a prompt instruction the model might drift from.
2. **Citations are structured**, so the UI can render "this clause, unmet" next to
   the evidence — which is the whole reason the verdict is credible rather than
   assertive.

> **Note:** assistant prefill is removed on Claude Opus 5 (returns 400). Structured
> outputs are the supported replacement — which is what we want anyway.

---

## 4. Prompt caching — near-free after the first audit

Guardian's system prompt (its role, the tier rubric, how to weigh promise vs.
criteria) is **identical on every audit**. Only the case file changes.

Put a `cache_control: {type: "ephemeral"}` breakpoint at the end of the system
prompt and every subsequent audit reads that prefix at **~0.1× input cost**. Claude
Opus 5's minimum cacheable prefix is **512 tokens** — low enough that a realistic
Guardian system prompt qualifies.

Order matters: **stable content first** (role, rubric), **volatile content last**
(the case file). Never interpolate a timestamp or case ID into the system prompt —
that invalidates the cache on every request.

---

## 5. ⚠️ Demo risk: verdicts are not deterministic

**`temperature`, `top_p`, and `top_k` are removed on Claude Opus 5 — sending any of
them returns a 400.** There is no way to pin sampling for reproducibility.

That means **running the same audit twice on stage can, in principle, produce
different reasoning** — and in a marginal case, a different tier.

Three mitigations, in order of importance:

1. **Tiers already do most of the work.** A discrete 5-value enum is far more stable
   than a free-form percentage. Act 2's "3 of 5 line items" lands on 50% because the
   arithmetic is unambiguous, not because the model is pinned.
2. **Make the demo case files unambiguous.** Every act should have an answer a human
   would also reach — which §5's design principle ("countable, not a matter of
   taste") already enforces. Ambiguity is where non-determinism bites.
3. **Persist the verdict on first run.** The verdict is written to Postgres (and
   settled on-chain) the first time. A re-run during the demo **replays the stored
   verdict** rather than re-auditing. This is honest — a real dispute is decided
   once (§4.4, verdicts are final) — and it removes live-model variance from the
   stage entirely.

Mitigation 3 is not a demo trick: it falls straight out of the product rule that
verdicts are final.

---

## 6. Cost estimate for the hackathon

| Item                                | Estimate                      |
| ----------------------------------- | ----------------------------- |
| One Guardian audit (small case file) | Fractions of a cent           |
| Hundreds of dev + demo runs          | Single-digit dollars, at most |

**Model spend is not a constraint on this project.** Do not trade verdict quality
for token cost.

---

## 7. Storage: PostgreSQL only — no file store needed

**Everything Guardian handles is text or JSON.** There is no blob in the system.

| Data | Shape | Column type |
| --- | --- | --- |
| Agent definition (listing + execution spec) | JSON, a few KB | `jsonb` |
| Buyer input | Text (receipt text, document text) | `text` |
| Agent output | Structured JSON | `jsonb` |
| Run record / execution trace | JSON, tens of KB worst case | `jsonb` |
| Verdict (tier, reasoning, citations) | JSON, a few KB | `jsonb` |

Postgres stores up to **1 GB per field** and transparently compresses and offloads
anything over ~2 KB via TOAST. Our largest realistic object — a run record for a
long document — is orders of magnitude below that. No object storage, no S3, no
IPFS.

### 7.1 Why Memonex needs IPFS and we don't

Memonex is **decentralised**: the encrypted package must be retrievable by any agent
on the network, from anywhere, without trusting a server. That forces content
addressing.

Guardian is **centralised by design** — the platform already runs every agent (§6 of
the product doc), so it is already the trusted execution host. Adding IPFS would buy
nothing it doesn't already have. It would be architecture theatre.

### 7.2 The hash commitment does **not** require file storage

A common misread of the Memonex pattern: `contentHash` on-chain does not imply the
content lives on IPFS. The hash is a **commitment**, not a pointer.

```
definitionHash = keccak256(canonical JSON)   →  stored ON-CHAIN
the definition itself                         →  stored in POSTGRES
```

Anyone can re-hash the Postgres row and check it against the chain. Same pattern
applies if we later anchor verdicts (§7.4 of discovery-notes).

**Be honest about what this proves.** A hash held only in Postgres is worthless
against a malicious platform operator — the operator could rewrite both. The hash
is meaningful **only because it is on-chain**, where the platform cannot revise it
after the fact. That's the entire argument for anchoring, and it costs one field.

### 7.3 When a file store would become necessary

Out of MVP scope, but worth naming so the boundary is deliberate:

- **Buyers uploading real files** — PDF receipts, images, `.docx`. Our demo takes
  receipt *text* and document *text*, so this doesn't arise.
- **Agent-produced artifacts** — an agent that returns a generated spreadsheet or
  image rather than JSON.

Either would mean adding object storage. Neither is in the three demo acts.

---

## 8. Decisions and build tasks

### Confirmed

- ~~LLM choices~~ **Approved**: `claude-opus-5` for Guardian's audit,
  `claude-haiku-4-5` for the three seller agents.

### Build tasks, not open questions

These need doing, not deciding. Resolve them while writing the code.

- **Effort sweep** (`medium` / `high` / `xhigh`) once real case files exist — needs
  actual disputes to measure against, so it can't be settled in advance.
- **Guardian's system prompt and rubric wording** — a deliverable to draft, not a
  fork in the road.
- **Serialising the run record into the audit prompt** — a format decision best made
  against a real run record.
- **The concrete Postgres schema** (tables, relations, indexes) — the next design
  artifact.
