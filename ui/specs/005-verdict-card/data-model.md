# Phase 1 — Data Model: Verdict card & case file

**Feature**: [spec.md](./spec.md) · **Research**: [research.md](./research.md) · **Contracts**: [contracts/internal-api.md](./contracts/internal-api.md)

No database, no persisted client state. This document defines the payload types entering through `src/api/verdicts.ts`, the normalisation the boundary performs, the derived figures, and the query keys.

---

## 1. Payload types — `src/api/types.ts` (extended)

### `VerdictTier`

```ts
export type VerdictTier = 'none' | 'quarter' | 'half' | 'three_quarter' | 'full';
```

The five values of the backend's `verdict_tier` enum, in its declaration order (`docs/database-schema.md` §5, `api/specs/002-entities-migrations/data-model.md` §8). Kept character-for-character identical to that list for the same reason `OrderState` is: a diff between the two files is the only mechanism either side has for noticing a change.

A union rather than `string`, so the tier switch in `src/lib/verdict.ts` can be exhaustively checked and a sixth tier becomes a compile error rather than a blank badge.

### `Citation` — as it arrives

```ts
export interface RawCitation {
  source?: unknown;
  clause?: unknown;
  met?: unknown;
}
```

Every field optional and `unknown`, because the column is `jsonb NOT NULL DEFAULT '[]'` with no schema behind it and the API's own model types it `unknown[]` (research R5). A type that promised three present, correctly-typed fields would be describing a document Postgres never validated.

This type is not exported past the boundary. Components see `Citation` below.

### `Citation` — as it renders

```ts
export type CitationSource = 'capability' | 'exclusion' | 'criterion';
export type CitationStatus = 'met' | 'unmet' | 'unrecorded';

export interface Citation {
  /** A known origin, or the raw string the payload used, or null when absent. */
  source: CitationSource | string | null;
  /** The clause quoted verbatim; null when the payload carried none. */
  clause: string | null;
  status: CitationStatus;
}
```

`status` is three-valued rather than `met: boolean`, and that is the type carrying FR-013. A boolean has no way to say "the payload did not record this", so a normaliser producing one has to choose between `true` (fabricating a passed clause — never) and `false` (fabricating a failed one, defaming a seller). The third value is the honest answer and it renders as its own row treatment.

### `Verdict`

```ts
export interface Verdict {
  tier: VerdictTier;
  refundMinor: Cents;
  reasoning: string;
  citations: Citation[];
  txHash: string | null;
  createdAt: string;
  /** Elements of `citations` that were not objects and could not be read. */
  unreadableCitations: number;
}
```

`citations` is a required array, never optional — the column defaults to `[]`, so it may be empty but is never absent, and FR-012 needs an empty array to be a statement the screen makes rather than a section that fails to render. Same argument as `AgentListing.capabilities`.

`txHash` is `string`, not viem's `Hex`. It is an arbitrary string from a database column until `isTxHash` in `src/lib/verdict.ts` says otherwise (research R9); typing it `Hex` at the boundary would assert the validation this feature exists to perform. It is narrowed to `Hex` at the point `explorerTxUrl` is called and nowhere earlier.

`unreadableCitations` is produced by the normaliser, not the wire. It exists so a dropped element is counted rather than silently vanishing.

**Not on this type**: `verdictHash`, `model`, `id` (research R2). The absent properties are the guarantee — no component can render "adjudicated by claude-opus-5" because there is nowhere for it to come from.

### `CaseFile`

```ts
export interface CaseFile {
  input: Record<string, unknown>;
  acceptanceCriteria: string;
  capabilities: string[];
  exclusions: string[];
  steps: CaseFileStep[];
  output: unknown | null;
}

export interface CaseFileStep {
  /** What the step did — a tool call, an extraction pass, a model turn. */
  label: string;
  /** The API's summary of the step's reasoning. Never raw reasoning text. */
  summary: string | null;
  durationMs: number | null;
  error: string | null;
}
```

`capabilities` and `exclusions` are the clauses the citations quote, taken from the version that ran rather than from today's listing (research R15).

**`CaseFileStep` has no `prompt`, no `systemPrompt`, no `reasoning`, and no `raw`.** This is the same enforcement-by-absence used on `AgentListing` and `OrderRun`, applied to the one payload in the system whose route is documented as "redacted for a buyer, full for the seller". `summary` holds what `docs/api-design.md` §1.3 says the serialiser produces — a summary, because a raw step can paraphrase its own instructions. See research R8 for why this does not reverse `OrderRun`'s decision to have no steps at all.

---

## 2. Normalisation — the boundary's rules

Performed in `src/lib/verdict.ts`, called from `src/api/verdicts.ts`. Total: every input produces a `Verdict`, and nothing throws.

| Input | Output |
| --- | --- |
| `citations` not an array | `[]`, `unreadableCitations: 0` |
| Element not an object | Dropped; `unreadableCitations` incremented |
| `source` one of the three known strings | `source` set to it |
| `source` some other non-empty string | `source` set to that raw string; the row labels itself with it |
| `source` absent or not a string | `null`; the row labels itself "Clause" |
| `clause` a non-empty string | Used verbatim |
| `clause` absent, empty, or not a string | `null`; the row shows "Quote unavailable" |
| `met === true` | `status: 'met'` |
| `met === false` | `status: 'unmet'` |
| `met` anything else | `status: 'unrecorded'` — **never** `'met'` |
| `reasoning` absent or not a string | `''`; the card renders without it (FR-006) |
| `tier` not one of the five | Treated as unknown: the badge shows the raw value and no percentage |

The last row is the one asymmetry with `VerdictTier` being a closed union: the type is closed so the *switch* must be exhaustive, but the runtime value arrived over a wire and may not be a member. `tierDisplay` returns a fallback for an unrecognised string rather than throwing, because a card that crashes on an unexpected tier takes the whole concluded face down with it.

---

## 3. Derived figures

### The split (FR-003, FR-004, research R3)

```
buyerMinor  = verdict.refundMinor
sellerMinor = order.priceMinor - verdict.refundMinor
```

Computed in `splitFor(order.priceMinor, verdict.refundMinor)`, which returns a discriminated result:

| Condition | Result |
| --- | --- |
| `refundMinor` a finite integer in `[0, priceMinor]` | `{ ok: true, buyerMinor, sellerMinor }` |
| Anything else | `{ ok: false, buyerMinor }` — the card shows the refund as recorded, `—` for the seller, and a reconciliation note |

Integer cents throughout; no floating-point arithmetic. The tier percentage is never an operand.

### The tier display (FR-002, research R4)

| `tier` | `percent` | `phrase` |
| --- | --- | --- |
| `none` | `0` | No refund |
| `quarter` | `25` | Quarter refund |
| `half` | `50` | Half refund |
| `three_quarter` | `75` | Three-quarter refund |
| `full` | `100` | Full refund |
| *(unrecognised)* | `null` | The raw string |

### Whether the transaction can be linked (FR-015, FR-018, research R9)

`isTxHash(value)` — `/^0x[0-9a-fA-F]{64}$/`. Three renderings follow from it and the order's state:

| `txHash` | Order state | Rendered |
| --- | --- | --- |
| Valid hash | any | Truncated hash, external link, copy control |
| `null` | `adjudicated` | "Settlement is completing" — no link, no control |
| `null` | `settled` | "No transaction reference was recorded" — no link |
| Non-empty, not a hash | any | The value as text, marked unrecognisable — no link |

---

## 4. Query keys and cadence

| Key | Fetcher | Enabled when | Interval | Stops when |
| --- | --- | --- | --- | --- |
| `['order', id]` | `fetchOrder` | always *(existing, unchanged)* | 1s | `released` or `settled` |
| `['verdict', id]` | `fetchVerdict` | state is `adjudicated` or `settled` | 1s | `txHash !== null`, or state is `settled`, or 404/403 |
| `['case-file', id]` | `fetchCaseFile` | `order.disputedAt !== null` | — | after the first attempt, success or failure |

Both new queries go through the existing `usePolling`; neither needs a change to it (research R6, R14). The case file's "read once" is expressed as `isTerminal: () => true` with `isFatalError: () => true`, so a success stops the schedule and a failure stops it too, leaving recovery to the panel's explicit retry.

**One key per resource, never keyed on state.** Keying the verdict `['verdict', id, state]` would unmount and rebuild the card on the `adjudicated → settled` transition — visible flicker on the demo's closing beat, and FR-031 forbids it.

**Cache invalidation**: none. Nothing in this feature writes, and a verdict is immutable once settled (one row per order, no appeals). `useOrder`'s existing `['me']` nudge on reaching a terminal state already covers the balance movement.

---

## 5. Component state

| Component | State | Why |
| --- | --- | --- |
| `VerdictCard` | none | Everything is derived from two props |
| `CitationChecklist` | none | Pure render of `Citation[]` |
| `TxHashLink` | one boolean, "copied" | Two-second acknowledgement after a copy; nothing else |
| `CaseFilePanel` | none | Disclosure is `<details>`'s, not React's (research R11) |
| `ExecutionSteps` | none | Pure render of `CaseFileStep[]` |

One `useState` in the whole feature. No `localStorage`, no context, no refs.

---

## 6. Validation rules

- The split figures MUST sum to `order.priceMinor` when they render as figures at all (FR-003); the guard in §3 is what makes that unconditional rather than usually-true.
- A citation whose `met` was not recorded MUST NOT render as met (FR-013).
- A `txHash` MUST be shape-validated before it becomes an `href` (FR-015, FR-018).
- The explorer origin MUST come from `src/chain/chains.ts` (FR-019).
- No type in this feature MUST carry a field capable of holding seller instructions (FR-026).

---

## 7. What this feature does not model

- **Appeals, amendments, re-audits.** One verdict per order, enforced by a UNIQUE constraint upstream; there is no mutation surface here at all (FR-028).
- **The seller's unredacted case file.** A different consumer of the same route; not this screen.
- **`verdict_hash` and the on-chain anchoring.** The API's reproducibility mechanism, meaningless to a buyer who cannot recompute it.
- **The agent listing as it stands today.** Deliberately not read (research R15).
- **Any chain state.** The transaction hash is a string to link, not a receipt to fetch (FR-029).
