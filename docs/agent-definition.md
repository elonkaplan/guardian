# Guardian — What a Seller Actually Sells

**Status**: proposal, pending approval.
**Last updated**: 2026-08-08
**Companion docs**: [product-workflow.md](./product-workflow.md) ·
[product-block-schema.md](./product-block-schema.md) · [tech-stack.md](./tech-stack.md)

---

## 1. The Memonex contrast

Memonex was read as a reference. It is worth being precise about how it differs,
because the difference **is** the answer to "what does a seller sell?"

| | **Memonex** | **Guardian** |
| --- | --- | --- |
| The sellable unit | A **static artifact** — a JSON package of insights | A **capability** — an agent that runs on demand |
| What transfers | Bytes, unlocked by a decryption key | A *result*, produced fresh per order |
| Delivery | Seller sends the key; buyer decrypts | Platform runs the agent; buyer gets output |
| Can it be inspected before purchase? | Yes — paid eval preview with teasers | No — the output doesn't exist until the order runs |
| Why disputes happen | Content wasn't what the preview implied | The **work** wasn't done properly |

That last row is the whole reason Guardian exists. **You can preview a file. You
cannot preview work that hasn't happened yet.** Memonex solves buyer risk with an
eval fee and a teaser; Guardian solves it after the fact, with an audit.

### Three ideas worth stealing from Memonex

1. **Hash-commit the goods at listing time.** Memonex puts a `contentHash` on-chain
   before anyone pays. We should do the same to the **agent definition** — so a
   seller cannot swap in a cheaper agent after the sale and claim it was always
   that one. It also lets Guardian verify the agent that *ran* is the agent that
   was *sold*.
2. **A delivery window enforced by the contract**, with buyer-claimable refund on
   non-delivery. Cheap, and it means the escrow handles the crash case without
   waking Guardian.
3. **Version lineage on listings** (`prevListingId`). An updated agent is a new
   version, and an order pins the version it ran — see §5.

**Not stealing**: the eval fee, teaser previews, IPFS/encryption, and the ERC-8004
reputation stack. Those solve *"is this file worth buying?"* — a question our
product deliberately answers a different way (§4.6: enforceable recourse instead of
reputation).

---

## 2. The answer: an agent is a Definition, not an endpoint

Because the marketplace runs the agent (§6 of the product doc), **a seller submits a
definition and never hosts anything.** The definition is the product.

It has three parts.

### 2.1 The Listing — public, and half of Guardian's yardstick

Everything a buyer (human or agent) sees before purchase.

| Field | Purpose |
| --- | --- |
| `name` | "LedgerBot" |
| `description` | What it does, in a sentence |
| **`capabilities[]`** | Explicit claims — *"extracts every line item with its amount"* |
| **`exclusions[]`** | Explicit non-claims — *"does not handle handwritten receipts"* |
| `price` | Flat, per purchase |
| `inputContract` | What the buyer must supply, described for a human **and** as a schema |
| `outputContract` | The shape of what comes back, as a schema |

`capabilities` and `exclusions` are the **listing promise** from §4.1 — one half of
what Guardian judges against. They are not marketing copy; they are the seller's
side of the contract, quoted verbatim in verdicts.

### 2.2 The Execution Spec — the seller's actual IP

What the platform executes. Never shown to buyers.

| Field | Notes |
| --- | --- |
| `systemPrompt` | The seller's craft — the thing they're really selling |
| `model` | Which Claude model to run on (cost/quality is the seller's call) |
| `inputSchema` | Validates the buyer's input **before** money moves |
| `outputSchema` | Constrains the agent's output — see §3, this one is load-bearing |
| `tools[]` | Optional, from a platform allowlist |
| `timeoutSeconds` | Beyond which the run is non-delivery (§4.3) |

### 2.3 Integrity

| Field | Notes |
| --- | --- |
| `version` | Increments on every edit |
| `definitionHash` | keccak256 of the canonical definition, **committed on-chain at listing** |

---

## 3. Why `outputSchema` is the most important field in the product

Guardian's credibility rests on verdicts being **checkable rather than felt**
(§5.1: *"countable, not a matter of taste"*). A structured output contract is what
makes that possible.

Compare:

```
Free-text output           →  "the summary felt thin"        → an opinion
Schema'd output            →  "5 line items promised, 3 returned" → arithmetic
```

**LedgerBot's output contract is what turns Act 2's verdict into a row count.**
Without it, Guardian is comparing prose to prose and the 50% tier looks like a
judgment call. With it, the audience does the arithmetic before Guardian announces
it — which is exactly the effect §5.3 is designed to produce.

This also means schema conformance is a **pre-audit check**: an output that doesn't
satisfy its own declared contract has already failed, and Guardian can say so
without deliberation.

---

## 4. What Guardian sees, and what the buyer sees

The case file (§6.3) includes the seller's `systemPrompt` — Guardian needs it to
tell *"tried hard, task was impossible"* from *"returned a stub without trying."*

But the buyer also receives the case file (§7.9). **The seller's prompt must be
redacted from the buyer's copy.** Otherwise every dispute is a free way to steal a
seller's IP — and a buyer could file a frivolous complaint purely to extract it.

| Party | Sees the system prompt? |
| --- | --- |
| Platform / execution workspace | Yes — it runs it |
| **Guardian** | **Yes** — needed for intent-vs-effort judgment |
| Seller | Yes — it's theirs |
| **Buyer** | **No — redacted**, even in a dispute |

Guardian's *reasoning* may describe execution behaviour ("the agent made one
extraction attempt and stopped") but must never quote the prompt.

---

## 5. Versioning: an order pins the version that ran

A seller can edit their agent. Disputes must be judged against **the definition that
actually executed**, never the current one — otherwise a seller could weaken their
own `capabilities` after a bad delivery and win the dispute retroactively.

So: an order stores `definitionVersion` and `definitionHash` at purchase time, and
the case file resolves the listing promise from **that** version.

This is the same reason Memonex carries `prevListingId`, and the same reason the
hash goes on-chain before payment.

---

## 6. The three demo agents, concretely

### LedgerBot — $2.00

- **capabilities**: *"Extracts every line item from a receipt with its amount and
  returns the total."*
- **exclusions**: *"Does not handle handwritten receipts or non-Latin scripts."*
- **input**: `{ receiptText: string }`
- **output**: `{ lineItems: [{ description: string, amount: number }], total: number }`

The array makes the shortfall countable. This is the workhorse of the demo.

### TLDR Agent — $1.00

- **capabilities**: *"Summarises a document within a specified word cap."*
- **exclusions**: *"Does not translate; does not summarise documents over 10,000
  words."*
- **input**: `{ document: string, wordCap: number }`
- **output**: `{ summary: string, wordCount: number }`

`wordCount` in the output contract is what lets Guardian reject Act 1's complaint
mechanically — the buyer's own cap was 100, the output declares 85.

### PolyglotAI — $1.50

- **capabilities**: *"Translates text to a target language, preserving product
  names."*
- **exclusions**: *"Does not localise currency, dates, or units."*
- **input**: `{ text: string, targetLanguage: string, preserveTerms: string[] }`
- **output**: `{ translation: string }`

Act 3's failure is a crash, so the output shape barely matters — what matters is
that **nothing** conforming to it arrived.

---

## 7. Consequences to accept

- **Sellers are limited to prompt-and-schema agents.** No custom code, no arbitrary
  runtimes. Real-world that's a serious catalogue limit; for the MVP — where we
  author all three sellers — it costs nothing, and it's what makes the whole
  platform-runs-the-agent guarantee (§6.2) affordable to build.
- **The output schema is a burden on sellers.** Worth it: it is simultaneously the
  buyer's guarantee, the platform's validation, and Guardian's evidence.

---

## 8. Decisions

### Confirmed by the user

1. ~~Approve the three-part definition shape~~ **Approved.** §2 is settled:
   Listing / Execution Spec / Integrity.

2. ~~Acceptance criteria format~~ **Free text.** The checkability that matters comes
   from the **output schema** (§3), not from the criteria format — so free text
   costs nothing in rigour and buys the thing that makes Guardian look intelligent
   on stage: it reads a human sentence and rules against it. A constraint-picker UI
   would have made the product look like a form validator.

### Resolved — no user input needed

3. ~~Tool allowlist for seller agents~~ **Not in the MVP.** None of the three demo
   agents use tools, so the allowlist would be dead code. `tools[]` stays in the
   execution spec as a field we don't populate, so adding it later isn't a schema
   change.
