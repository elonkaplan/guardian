# Phase 1 — Data Model: Marketplace & Agent Detail

**Feature**: 003-marketplace-buy · **Date**: 2026-08-08

Client-side types only. This feature persists nothing — no new `localStorage` keys, no new environment variables. Everything below lives in memory or in the TanStack Query cache.

---

## 1. Payload types — `src/api/types.ts` (extended)

Field names are **provisional**, for the same reason `AccountSummary`'s are: API-06 and API-07 are unbuilt and no OpenAPI document exists yet. camelCase is chosen because `docs/api-design.md` §3.4 spells the purchase body that way (research R2). If the backend lands different names, this file plus `api/agents.ts` and `api/orders.ts` are the whole blast radius.

### `AgentSummary` — one catalogue card

```
AgentSummary {
  id:          string
  name:        string
  description: string
  priceMinor:  Cents     // integer USD cents, per lib/money
}
```

### `AgentListing` — the detail screen's whole world

```
AgentListing extends AgentSummary {
  capabilities: string[]        // may be empty, never absent
  exclusions:   string[]        // may be empty, never absent
  inputSchema:  JsonSchema      // what the buyer must supply
  outputSchema: JsonSchema      // the shape of the result
}
```

Three properties of this type are load-bearing:

- **`capabilities` and `exclusions` are `string[]`, not optional.** `api/specs/002-entities-migrations/data-model.md` §4 makes both `text[] NOT NULL` — "may be empty, never absent". Typing them as optional would invite `?.map()` and quietly hide a seller who declared nothing behind a missing section, which FR-009 forbids.
- **There is no `systemPrompt`, `model`, or `timeoutSeconds` field, and adding one would be a defect.** FR-011 asks for a screen with no code path capable of rendering seller IP. The type is that guarantee: with no property to read, no component can render one even if API-06's serialiser were to regress. This mirrors the backend's own choke point rather than duplicating it.
- **There is no separate human-readable input description.** `agent-definition.md` §2.1 describes `inputContract` as "described for a human **and** as a schema", but the database carries only `input_schema`. The human-readable text is therefore derived from the schema's own `title` / `description` keywords (§2), not from a second field.

### `JsonSchema` — the narrow slice we actually read

```
JsonSchema {
  type?:        string | string[]
  title?:       string
  description?: string
  properties?:  Record<string, JsonSchema>
  required?:    string[]
  enum?:        unknown[]
  format?:      string
  maxLength?:   number
  default?:     unknown
}
```

Deliberately structural and partial. It is not a JSON Schema implementation — it is the set of keywords `lib/inputSchema.ts` consults, and every one of them is optional because a seller's schema is arbitrary JSON that arrived through a raw textarea.

### Purchase

```
CreateOrderRequest {
  agentId:            string
  input:              Record<string, unknown>
  acceptanceCriteria: string
}

CreateOrderResponse {
  id: string          // everything else about the order belongs to UI-04
}
```

`CreateOrderRequest` carries **no price and no review window**. Both are the backend's to set — `reviewWindowSeconds` comes from config and never from the client (`api-design.md` §4), and the order's price is a snapshot the backend takes. FR-021 is enforced by the type having nowhere to put them.

---

## 2. Form model — `src/lib/inputSchema.ts`

The pure layer between an arbitrary seller schema and a form. No React, no fetch.

### `InputField` — one rendered control

```
InputField {
  name:      string                  // the property key in the payload
  label:     string                  // title, else humanised name
  help?:     string                  // description
  required:  boolean                 // from the parent's required[]
  control:   'text' | 'textarea' | 'number' | 'checkbox' | 'select'
  options?:  string[]                // select only
  step?:     'any' | '1'             // number only; '1' for integer
  default?:  string | number | boolean
}
```

### `InputForm` — the whole form, one of two shapes

```
InputForm =
  | { mode: 'fields'; fields: InputField[] }
  | { mode: 'raw';    reason: string; schemaText: string }
```

A discriminated union rather than a `fields` array that is sometimes empty: the raw path needs a *reason* to show the buyer ("this agent's input is a nested structure"), and the payload builder must not be reachable with an ambiguous state.

### The renderable predicate

`buildInputForm(schema)` returns `mode: 'fields'` when **all** of these hold:

| # | Condition |
| --- | --- |
| 1 | `schema.type === 'object'` (or `type` is absent and `properties` is present) |
| 2 | `schema.properties` is a non-empty object |
| 3 | Every property's `type` is `string`, `number`, `integer`, or `boolean` — or the property has an `enum` |
| 4 | No property declares `properties` or `items` (i.e. nothing nested) |

Otherwise `mode: 'raw'`, with `reason` naming which condition failed and `schemaText` the schema pretty-printed for the buyer to read beside the textarea.

### Control selection (research R5, R6)

```
enum present                                    → select
type boolean                                    → checkbox
type number | integer                           → number   (step '1' for integer)
type string, and (maxLength ≤ 80 | format in
  {date,date-time,email,uri,uuid})              → text
type string, otherwise                          → textarea
```

The string default is multi-line on purpose: the realistic input to these agents is a pasted receipt, and an unconstrained `string` is far more often a document than a name.

### Payload construction

`buildPayload(form, values)` produces the `input` object:

| Control | Value in the payload |
| --- | --- |
| `text` / `textarea` | the string, trimmed of trailing whitespace only |
| `number` | `Number(value)`; a blank optional field is omitted entirely |
| `checkbox` | `true` / `false` — always present, never omitted |
| `select` | the chosen option string |

**Blank optional fields are omitted, not sent as `""`.** An empty string is a value that can fail a seller's `minLength`; an absent optional property cannot. Booleans are the exception because `false` is an answer, not an absence.

In `raw` mode the payload is the parsed JSON, used as-is.

---

## 3. Buy panel state

One `useMutation` plus local form state. The panel is a small state machine, and the transitions matter more than the shape:

```
             ┌──────────────────────────────────────────┐
             │                                          │
  editing ──validate──▶ invalid ──edit──▶ editing       │
     │                                                  │
     └──valid──▶ submitting ──201──▶ navigating(replace)│
                     │                                  │
                     ├──refused (kind 'http')──▶ editing + inline reason
                     └──no answer (connectivity)──▶ ambiguous ──▶ link to /orders
```

| State | Buy action | Notes |
| --- | --- | --- |
| `editing` | enabled if affordable and signed in | Values live in component state, never in the query cache |
| `invalid` | enabled | Blocking happens on activation, not by permanently disabling — a disabled button with no message is the worst version of FR-019 |
| `submitting` | **disabled**, labelled as working | The `isPending` flag is the whole of FR-020's duplicate guard |
| `navigating` | — | `navigate(paths.orderDetail(id), { replace: true })`, so back cannot re-submit (FR-022) |
| `ambiguous` | **not re-enabled** | The purchase is not idempotent; research R12 |

Entered values survive every failure branch, because they are component state and nothing resets them. That is FR-023 by construction rather than by handler discipline.

### Affordability, derived not stored

```
affordability =
  no session          → 'sign-in-required'   (FR-030, research R10)
  balance unknown     → 'unknown'            → allow, defer to backend (FR-028)
  available < price   → 'short'              → block, show shortfall  (FR-026)
  otherwise           → 'ok'
```

`shortfall = priceMinor - availableBalanceMinor`, in cents, formatted by `lib/money`. It is the one subtraction this feature performs on money, and it is on integers — `lib/money` still only formats.

---

## 4. Query keys and cache

| Key | Source | Refresh | Owner |
| --- | --- | --- | --- |
| `['agents']` | `fetchAgents()` | on mount (`staleTime: 0`), plus manual retry | this feature |
| `['agents', id]` | `fetchAgent(id)` | on mount | this feature |
| `['me']` | `fetchMe()` | **already polled at 5s by `BalanceWidget`** | UI-02; read-only here |

`['me']` is subscribed to, never re-fetched independently (research R8). The buy panel's balance and the header's balance are the same cache entry and therefore cannot disagree.

**After a successful purchase**, invalidate `['me']` so the header's available balance reflects the debit immediately rather than up to five seconds later. This is the only cache write this feature performs.

---

## 5. Validation rules

Everything checked in the browser, and nothing else (research R7).

| Rule | Applies to | On failure | Requirement |
| --- | --- | --- | --- |
| Required field non-blank | `fields` mode, `required: true` | Message on the field; no request sent | FR-019 |
| Acceptance criteria non-empty | always | Message on the field; no request sent | FR-015 |
| Raw input parses as JSON | `raw` mode | Message with the parser's position | FR-014 |
| Raw input is a JSON object | `raw` mode | "must be an object" — an array or scalar is not a valid `input` | FR-014 |
| Acceptance criteria looks checkable | always | **Warning only**, purchase proceeds | FR-017 |

**The "checkable" threshold**: fewer than 15 characters or fewer than 3 words, after trimming. It exists to catch `"good"` and `"fast please"`, not to grade prose. It never blocks, it never fires twice for the same text, and it is stated as a consequence ("a criterion this short gives Guardian little to check against") rather than as an error.

Not validated here, by decision: `minLength`, `maxLength`, `pattern`, numeric bounds, `format` correctness, and whether the object satisfies the schema at all. API-07 step 1 owns that, and a second partial implementation would eventually refuse something the backend would have accepted.

---

## 6. What this feature does not model

- **Orders.** A successful purchase yields an id and a navigation. Order state, output, countdown, and verdict are UI-04's.
- **Agent versions.** The listing is the current version; the order pins one server-side. Nothing on these screens exposes version identity.
- **Ownership.** `agents.owner_account_id` exists, but no behaviour on these screens branches on whether the signed-in user owns the listing (spec Edge Cases).
- **Settled funds.** The wallet's second money figure has no bearing on affordability — a purchase spends available balance only.
