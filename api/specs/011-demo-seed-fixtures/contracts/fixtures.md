# Contract: the three fixtures

**Feature**: `011-demo-seed-fixtures` · Source of truth for `src/demo/fixtures.ts`

One per act. A fixture is **four** things — the input, the acceptance criteria, the
complaint, and the intended outcome — because the ruling is computed from the first
three and seeding only the input would leave two thirds of the demo's reproducibility
to whoever is typing on stage (FR-013).

⚠️ **The `input` object is half the registry key.** It must be sent byte-for-byte as
published. Object key order does not matter (the canonical form sorts keys) but **array
order does** — `preserveTerms` reordered is a different input and produces a live run.

---

## Act 1 — TLDR Agent — the complaint that is correctly rejected

**Expected tier: `none` (0%). Seller paid in full: $1.00.**

### `input`

```json
{
  "wordCap": 100,
  "document": "NordWind Supplies — Internal Operations Memo\nTo: All account managers\nFrom: Operations\nDate: 12 March 2026\n\n1. Pricing. Effective 1 May 2026 list prices across the hardware catalogue rise by six percent. This is the first increase since March 2024 and is driven by sustained component cost rises and higher freight rates on the Rotterdam route. Existing annual contracts are not affected until their renewal date, and any quote issued before 15 April will be honoured at the old prices for thirty days from its issue date. Account managers should contact their twenty largest customers directly before the public announcement on 20 April rather than letting them read it in the newsletter.\n\n2. Warehouse. The move from the Antwerp site to the new Rotterdam warehouse completes in June. Picking and packing continue from Antwerp until 5 June; orders placed after that date ship from Rotterdam. Expect two days of slower dispatch in the changeover week and set customer expectations accordingly.\n\n3. Support. Two additional staff join the returns desk on 1 April, which should bring the average return acknowledgement back under one working day. The returns policy itself is unchanged.\n\n4. Catalogue redesign. The redesign planned for Q2 is postponed to Q3 so that the new pricing is reflected in the first printed run rather than being corrected by an insert. No customer-facing dates have been announced, so nothing needs retracting.\n\n5. Reminder. The quarterly forecast is due on 31 March. Use the updated template in the shared drive; the previous one does not have the freight surcharge line."
}
```

*(259 words. Well under the agent's stated 10,000-word exclusion, so that exclusion is
not in play.)*

### `acceptanceCriteria`

```text
Under 100 words, must cover the pricing change.
```

### `script` — `{ kind: 'output' }`

```json
{
  "summary": "Effective 1 May 2026, NordWind Supplies raises hardware list prices by six percent, its first increase in two years, driven by component costs and freight. Existing annual contracts keep their current rates until renewal, and quotes issued before 15 April will be honoured for thirty days. The memo also confirms the Rotterdam warehouse move completes in June, adds two staff to the returns desk, and postpones the catalogue redesign to the third quarter. Account managers should brief their twenty largest customers before the public announcement.",
  "wordCount": 85
}
```

⚠️ **The summary is exactly 85 words and `wordCount` says 85.** Both were counted, not
estimated. If the text is ever edited, re-count it — a declared count that disagrees
with the summary hands the complaining buyer a real grievance and inverts the act.

### `complaint`

```text
This is far too short. I paid for a summary of a multi-section memo and got one
paragraph — it cannot possibly cover a document this size properly.
```

### Why this reaches `none`

The buyer set the cap at 100 words and required the pricing change to be covered. The
delivery is 85 words, declares 85, and opens with the six-percent increase, its
effective date, its cause, and the contract and quote carve-outs. The complaint asks
for *more* than the criterion the buyer themselves wrote.

**This is the fragile fixture** (FR-015). Word count is not the check — the check is
that a reader who was not involved in writing it agrees the pricing change is covered.
If the summary ever drifts off it, the complaint becomes valid and a 0% ruling stops
being a fairness demonstration and becomes a visible misfire.

---

## Act 2 — LedgerBot — the shortfall the room can count

**Expected tier: `half` (50%). Split: $1.00 back to the buyer, $1.00 to the seller.**

### `input`

```json
{
  "receiptText": "NORDWIND SUPPLIES\nInvoice 4471 — 2 March 2026\n\nErgonomic keyboard      EUR 89.00\nUSB-C dock              EUR 149.00\nMonitor stand           EUR 62.00\nDesk lamp               EUR 38.00\nCable kit               EUR 24.00\n\nTOTAL                   EUR 362.00"
}
```

Five line items, five short descriptions, one printed total. Countable from the back of
a room (FR-018).

### `acceptanceCriteria`

```text
Extract all line items with their amounts, and give the correct total.
```

⚠️ **The criteria must not mention dollars or conversion.** The currency grievance
belongs in the complaint, where it is unfounded. Put it here and it becomes something
the buyer legitimately asked for, and the tier moves (research R9).

### `script` — `{ kind: 'output' }`

```json
{
  "lineItems": [
    { "description": "Ergonomic keyboard", "amount": 89.00 },
    { "description": "USB-C dock", "amount": 149.00 },
    { "description": "Monitor stand", "amount": 62.00 }
  ],
  "total": 300.00
}
```

**Three of five. The two dropped are `Desk lamp` (38.00) and `Cable kit` (24.00)**, and
both are named on the receipt, so the ruling can name them (FR-017).

The total is the sum of the three returned — `300.00` against the receipt's printed
`362.00` — so the shortfall is visible twice: in the row count and in the money
(FR-019).

### `complaint`

```text
Two line items are missing — the desk lamp and the cable kit — so the total is 62.00
short. It also left everything in euros instead of converting the amounts to dollars.
```

### Why this reaches `half`

Two of five line items were not returned, against a capability that promises *every*
line item and criteria that ask for *all* of them: countable, arithmetic, 40% of the
rows missing. The second grievance — the currency — is answered by the seller's stated
exclusion *"Does not convert between currencies or restate amounts in another
currency."*, which is the exclusion this demo shows being cited in the seller's defence
(FR-020, SC-007). The defence does not rescue the omission, so the tier stays at half.

---

## Act 3 — PolyglotAI — nothing arrived

**Expected tier: `full` (100%). The whole $1.50 returns to the buyer.**

### `input`

```json
{
  "targetLanguage": "German",
  "preserveTerms": ["NordWind", "AeroDock Pro"],
  "text": "The AeroDock Pro is NordWind's compact USB-C docking station for hybrid desks. It drives two 4K displays at 60Hz, delivers 100W of charging over a single cable, and adds Gigabit Ethernet, three USB-A ports and an SD card reader. The aluminium housing runs cool without a fan, and the detachable stand lets it sit flat or upright."
}
```

⚠️ `preserveTerms` is an array and its **order is part of the key**. Send it as
published.

### `acceptanceCriteria`

```text
Translate the product description into German, keeping the product names unchanged.
```

### `script` — `{ kind: 'failure' }`

```text
translation backend unavailable: connection reset while streaming the response
```

This message is recorded as `runs.error` and travels the ordinary failure path:
`ScriptedAgentRunner` throws `AgentRunFailedError`, `ExecutionService` records the run
with **`output` SQL NULL** and `output_valid` NULL, the order moves to `failed`, and
**no chain call is made**. Nothing in `src/demo/` writes any of that (FR-021, FR-022).

### `complaint`

```text
Nothing came back at all. There is no translation in the order — I paid $1.50 and
received an empty result.
```

### Why this reaches `full`

There is no output to judge. The absence *is* the evidence (invariant #7), the case
file states it explicitly, and the audit engine's non-delivery floor puts it at the full
tier. This is the one act already verified end to end by the previous feature's
verification run — the other two have never run.

---

## Summary table

| Act | Agent | Price | Script | Tier | Escrow path |
| --- | --- | --- | --- | --- | --- |
| 1 | TLDR Agent | $1.00 | 85-word summary, `wordCount: 85` | `none` | full release |
| 2 | LedgerBot | $2.00 | 3 of 5 line items, total 300.00 | `half` | split |
| 3 | PolyglotAI | $1.50 | crash, no output | `full` | full refund |

Three acts, three tiers, three different escrow paths — which is what makes the
contract completely demonstrated by the end of the run.
