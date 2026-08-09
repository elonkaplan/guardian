# Contract: the three seeded agent definitions

**Feature**: `011-demo-seed-fixtures` · Source of truth for `src/demo/seeded-agents.ts`

These are the ten canonical fields per agent, exactly as they are published through
`POST /agents`'s service path. Prices are **whole USD cents** (invariant #2).

⚠️ **Every `object` in every `outputSchema` below sets `additionalProperties: false`,
including the nested one inside `lineItems.items`.** Without it the model service
refuses the run and the act fails for a reason that has nothing to do with the demo —
this is the defect the execution engine's verification run found across all thirteen of
its orders. `structured-output-guard.ts` re-checks it before the first chain call.

---

## 1. LedgerBot — 200 cents

| Field | Value |
| --- | --- |
| `name` | `LedgerBot` |
| `description` | `Turns messy receipt and invoice text into structured line items with a total.` |
| `priceMinor` | `200` |
| `model` | `claude-haiku-4-5` |
| `timeoutSeconds` | `120` |

**capabilities**

1. `Extracts every line item from a receipt with its description and amount.`
2. `Returns the total of the extracted line items.`

**exclusions**

1. `Does not handle handwritten receipts or non-Latin scripts.`
2. `Does not convert between currencies or restate amounts in another currency.`

> The second exclusion is the one Act 2 gets cited (research R9). The first is the
> canonical one from `docs/agent-definition.md` §6 and is kept even though a text
> fixture cannot exercise it.

**inputSchema**

```json
{
  "type": "object",
  "properties": { "receiptText": { "type": "string" } },
  "required": ["receiptText"],
  "additionalProperties": false
}
```

**outputSchema**

```json
{
  "type": "object",
  "properties": {
    "lineItems": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "description": { "type": "string" },
          "amount": { "type": "number" }
        },
        "required": ["description", "amount"],
        "additionalProperties": false
      }
    },
    "total": { "type": "number" }
  },
  "required": ["lineItems", "total"],
  "additionalProperties": false
}
```

> The array is what makes Act 2 countable. Free text here would turn an arithmetic
> ruling into an opinion, which is the whole reason this agent is the centrepiece.

**systemPrompt** *(seller IP — never leaves the boundary; not in any demo response)*

```text
You extract line items from receipt and invoice text.

Return every line item you can identify, each with its description exactly as it
appears on the receipt and its amount as a number without a currency symbol. Return
the total of the line items you extracted.

Do not invent line items that are not present. Do not merge two lines into one. Do not
convert amounts into another currency — report them in the currency they are written
in.
```

---

## 2. TLDR Agent — 100 cents

| Field | Value |
| --- | --- |
| `name` | `TLDR Agent` |
| `description` | `Summarises a long document within a word cap you specify.` |
| `priceMinor` | `100` |
| `model` | `claude-haiku-4-5` |
| `timeoutSeconds` | `120` |

**capabilities**

1. `Summarises a document within a specified word cap.`
2. `Reports the word count of the summary it produces.`

**exclusions**

1. `Does not translate.`
2. `Does not summarise documents over 10,000 words.`

**inputSchema**

```json
{
  "type": "object",
  "properties": {
    "document": { "type": "string" },
    "wordCap": { "type": "integer" }
  },
  "required": ["document", "wordCap"],
  "additionalProperties": false
}
```

**outputSchema**

```json
{
  "type": "object",
  "properties": {
    "summary": { "type": "string" },
    "wordCount": { "type": "integer" }
  },
  "required": ["summary", "wordCount"],
  "additionalProperties": false
}
```

> `wordCount` is what makes Act 1 mechanical: the buyer's own cap was 100 and the
> delivery declares 85, so Guardian can quote the criterion back rather than judge
> whether a summary "felt thin".

**systemPrompt** *(seller IP)*

```text
You summarise documents within a word cap.

Write a single-paragraph summary that stays under the given word cap and covers the
document's most consequential points first. Count the words in the summary you wrote
and report that count exactly — do not estimate it.
```

---

## 3. PolyglotAI — 150 cents

| Field | Value |
| --- | --- |
| `name` | `PolyglotAI` |
| `description` | `Translates text into a target language, preserving product names.` |
| `priceMinor` | `150` |
| `model` | `claude-haiku-4-5` |
| `timeoutSeconds` | `120` |

**capabilities**

1. `Translates text into a target language.`
2. `Preserves product names and other terms you list, unchanged.`

**exclusions**

1. `Does not localise currency, dates, or units.`

**inputSchema**

```json
{
  "type": "object",
  "properties": {
    "text": { "type": "string" },
    "targetLanguage": { "type": "string" },
    "preserveTerms": { "type": "array", "items": { "type": "string" } }
  },
  "required": ["text", "targetLanguage", "preserveTerms"],
  "additionalProperties": false
}
```

**outputSchema**

```json
{
  "type": "object",
  "properties": { "translation": { "type": "string" } },
  "required": ["translation"],
  "additionalProperties": false
}
```

> Act 3's failure is a crash, so this shape barely matters. What matters is that
> nothing conforming to it ever arrives.

**systemPrompt** *(seller IP)*

```text
You translate text into a target language.

Translate the text faithfully into the requested language. Leave every term in the
preserve list exactly as written, including capitalisation. Leave currency amounts,
dates and units in their original form — do not localise them.
```

---

## 4. Rules that hold across all three

- **The definition object in code is the single source.** It is hashed on its way to the
  database and the chain, and hashed again on its way to the fixture registry. There is
  no second copy of a name, a price, or a schema anywhere in `src/demo/`.
- **`systemPrompt` appears in no demo response.** Both routes are unauthenticated
  (FR-010, FR-011), and the response DTOs have nowhere to put it.
- **Editing any field here changes the definition hash**, which means the seed must be
  re-run to publish a new version, and the fixture key changes with it. Both sides move
  together because both are derived from this one object — but a database seeded from
  an older build will not match until the seed is re-run (research R3).
