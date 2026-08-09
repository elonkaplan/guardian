# Phase 1 — Internal contracts: Verdict card & case file

**Feature**: [../spec.md](../spec.md) · **Data model**: [../data-model.md](../data-model.md) · **Research**: [../research.md](../research.md)

Module surfaces this feature adds, and the backend endpoints it consumes. §6 is the handoff list to diff against the API when its Guardian module lands.

---

## 1. `src/api/verdicts.ts` — new

```ts
/** GET /orders/:id/verdict — the ruling, normalised at the boundary. */
export function fetchVerdict(orderId: string): Promise<Verdict>;

/** GET /orders/:id/case-file — the evidence, redacted upstream for a buyer. */
export function fetchCaseFile(orderId: string): Promise<CaseFile>;
```

Both go through `apiGet` in `src/api/client.ts` and inherit the base URL, the bearer token, the 10s timeout, and `ApiError` normalisation. Neither retries; both are reads, and recovery is the caller's explicit retry.

`fetchVerdict` is the only place raw citations exist. It calls `normaliseVerdict` from `src/lib/verdict.ts` before returning, so no component ever sees a `RawCitation`.

Both endpoints are order-scoped reads of the same dispute record and live together for that reason. They are not in `orders.ts` because that file is the order lifecycle — purchase, read, accept, complain — and its long comment about `POST /orders` not being idempotent is a rule about writes that has nothing to say about either of these.

---

## 2. `src/lib/verdict.ts` — new, pure

No React, no fetch, no module-level mutable state. Every function total; nothing throws.

```ts
/** The wire's citations → renderable ones. Drops nothing silently. */
export function normaliseVerdict(payload: unknown): Verdict;

/** Tier → badge percentage and phrase. Exhaustive; assertNever. */
export function tierDisplay(tier: string): { percent: number | null; phrase: string };

/** The split. Never returns a negative figure; never clamps silently. */
export function splitFor(priceMinor: Cents, refundMinor: Cents): SplitResult;

/** /^0x[0-9a-fA-F]{64}$/ — the guard between a string and an href. */
export function isTxHash(value: string): value is Hex;

/** 0x7f3a…9c21, for display only. The full value stays in title, href, and copy. */
export function truncateHash(value: string): string;
```

`SplitResult` is `{ ok: true; buyerMinor: Cents; sellerMinor: Cents } | { ok: false; buyerMinor: Cents }`. The discriminant is what forces the card to handle the irreconcilable case rather than printing whatever the subtraction produced.

Pure because two callers must not disagree and because these are the five things worth being able to reason about without a browser: the tier vocabulary is shared by the badge and any future orders-list chip, and `splitFor` is the one piece of arithmetic in the feature.

---

## 3. Hooks

### `src/hooks/useVerdict.ts` — new

```ts
export interface VerdictView {
  verdict: Verdict | undefined;
  error: ApiError | null;
  /** True while the ruling exists but the transaction has not landed. */
  settlementPending: boolean;
  refetch: () => void;
}

export function useVerdict(orderId: string, state: OrderState): VerdictView;
```

Wraps `usePolling(['verdict', orderId], …)` with `enabled` true only for `adjudicated` and `settled`, a 1s interval, and the stopping rule from research R6:

```ts
isTerminal: (v) => v.txHash !== null || state === 'settled',
isFatalError: (e) => e.kind === 'http' && (e.status === 404 || e.status === 403),
```

`settlementPending` is derived (`verdict !== undefined && verdict.txHash === null && state === 'adjudicated'`) so the card does not re-derive it and the two cannot drift.

### `src/hooks/useCaseFile.ts` — new

```ts
export interface CaseFileView {
  caseFile: CaseFile | undefined;
  error: ApiError | null;
  loading: boolean;
  refetch: () => void;
}

export function useCaseFile(orderId: string, disputed: boolean): CaseFileView;
```

`usePolling(['case-file', orderId], …)` with `enabled: disputed`, `isTerminal: () => true`, `isFatalError: () => true` — one attempt, then the schedule stops whichever way it went. Recovery is `refetch`, wired to the panel's retry button.

---

## 4. Components — `src/components/`

| Component | Props | Responsibility |
| --- | --- | --- |
| `VerdictCard` | `order`, `verdict`, `error`, `settlementPending`, `onRetry` | The card: badge, split, reasoning, checklist, transaction. Owns the never-blank rule — renders a labelled error region with a retry when the verdict could not be read (FR-034). |
| `CitationChecklist` | `citations`, `unreadableCount` | Rows, not prose. Origin label, `<blockquote>` quote, ✓/✗/— with a word beside it. Renders the "no clauses were cited" line when empty (FR-012). |
| `TxHashLink` | `txHash`, `state` | The four renderings in data-model §3. Validates before linking; copy control; `target="_blank" rel="noopener noreferrer"` with a visible external marker. |
| `CaseFilePanel` | `caseFile`, `error`, `loading`, `defaultOpen`, `onRetry` | `<details>` wrapper. Input, criteria, capabilities, exclusions, steps. Own error surface. |
| `ExecutionSteps` | `steps` | Ordered list: label, summary, duration, error. |

`VerdictSlot.tsx` is **deleted** (research R13), along with its `.verdict-slot` CSS block.

`SubmittedInput`, `OutputPanel`, `CriteriaPanel`, `OrderSummaryHeader`, and `LoadState` are reused unchanged. `OutputPanel` in particular is what the case file's own output section renders through — it already handles table, prose, and JSON by inspection, and a second renderer for the same value would be able to disagree with the one above it on the same page.

---

## 5. `src/pages/OrderDetailPage.tsx` — edited

Two call sites change and one is added:

- `ArbitrationFace` — `<VerdictSlot state="adjudicated" />` becomes `<VerdictCard …>` when the state is `adjudicated`; the case-file panel is added for the whole face, `defaultOpen`.
- `ConcludedFace` — `<VerdictSlot state="settled" />` becomes `<VerdictCard …>`; the case-file panel is added below it, collapsed. The `released` branch is untouched — an uncontested release has no verdict and no case file (FR-001, FR-025).
- Both faces call `useVerdict` / `useCaseFile`; the hooks' own `enabled` flags decide whether a request happens, so no face needs a conditional call.

Everything else on the page — the header, the stale notice, the face switch, the polling — is unchanged.

---

## 6. Consumed backend endpoints — **the handoff list**

Neither is built. This is the section to diff against the API when the Guardian module lands.

### `GET /orders/:id/verdict` — authenticated, buyer-scoped

```json
{
  "tier": "half",
  "refundMinor": 100,
  "reasoning": "The listing promises every line item with its amount. The receipt contains 5; the output returned 3.",
  "citations": [
    { "source": "capability", "clause": "extracts every line item with its amount", "met": false },
    { "source": "exclusion",  "clause": "no handwritten receipts",                   "met": true  },
    { "source": "criterion",  "clause": "all line items with totals",                "met": false }
  ],
  "txHash": "0x7f3a…c21",
  "createdAt": "2026-08-08T12:04:31.000Z"
}
```

Assumptions to confirm:

1. **camelCase**, as in the documented `POST /orders` body and every existing type.
2. **Citations are structured objects** with `source` · `clause` · `met` — not pre-formatted text and not a single prose blob. **This is the one assumption that can invalidate the feature rather than cost an edit.** FR-007 requires a checklist; if the citations arrive as a paragraph there is no client-side recovery, because splitting model prose into clauses would be inventing evidence. Confirm this one first.
3. **`source` values are `capability` · `exclusion` · `criterion`.** An unknown string still renders (research R5), but the three known values are what get human labels.
4. **`clause` is the seller's or buyer's text quoted verbatim**, not the model's restatement of it — FR-009 and FR-023 both depend on the quote matching the case file's own text.
5. **`refundMinor` is integer USD cents**, the same `refund_minor` the API hashed and the contract settled — not a percentage, not dollars.
6. **`txHash` is `null` until settlement completes**, then the full `0x`-prefixed 32-byte hash. A truncated or non-hex value renders as unlinkable text (research R9).
7. **404 before a verdict exists**, and 403 or 404 for another buyer's order. Both stop the poll; a 500 does not and would keep it running.
8. **No `verdictHash`, no `model`, no `systemPrompt` anywhere in this payload.**

**Requested (not blocking): `sellerMinor` alongside `refundMinor`.** If the API sends both figures the client stops subtracting and `splitFor`'s reconciliation guard becomes dead code to delete (research R3). One field; it removes the only arithmetic in the feature.

### `GET /orders/:id/case-file` — authenticated, buyer-scoped, **redacted**

```json
{
  "input": { "receipt": "…" },
  "acceptanceCriteria": "all line items with totals",
  "capabilities": ["extracts every line item with its amount"],
  "exclusions": ["no handwritten receipts"],
  "output": [{ "item": "Coffee", "amount": 3.5 }],
  "steps": [
    { "label": "extract_line_items", "summary": "One extraction pass over the receipt image.", "durationMs": 2140, "error": null }
  ]
}
```

Assumptions to confirm:

9. **`capabilities` and `exclusions` are the text of the agent version that ran**, not today's listing (research R15). If they are resolved from the live listing, say so — the citation quotes would then be able to disagree with the panel beneath them.
10. **`steps[].summary` is the serialiser's summary, never raw reasoning text.** `docs/api-design.md` §1.3 and `docs/ui-design.md` §7.1 both require this, and it is the reason the buyer's step type has a `summary` field and no `reasoning` field. The UI performs no redaction of its own (FR-027).
11. **No `systemPrompt`, and no field that could carry one** — including on steps. The buyer's copy is redacted at the serialiser; this type has nowhere to put one either way (FR-026).
12. **404 for an order that was never disputed.** The client only calls this when `disputedAt` is set, so a 404 here means the two disagree.
13. **The same route serves the seller unredacted**, keyed on who is asking. Not consumed by this feature, but it is the reason the redaction lives upstream rather than here.

### Not requested

No CORS change (UI-04 already asked for `Access-Control-Expose-Headers: Date`, and this feature adds nothing to it). No new headers, no websocket, no SSE.

---

## 7. Unchanged surfaces

- **`src/hooks/usePolling.ts`** — untouched. Its `isTerminal` and `isFatalError` predicates express both of this feature's cadences, including read-once (research R6, R14).
- **`src/api/client.ts`**, **`src/api/errors.ts`**, **`src/api/orders.ts`**, **`src/lib/queryClient.ts`**, **`src/lib/money.ts`**, **`src/hooks/useOrder.ts`**, **`src/lib/orderState.ts`** — all reused as-is.
- **`src/chain/chains.ts`** — reused, not edited. `explorerTxUrl` was written for this feature.
- **`src/routes/paths.ts`**, **`src/routes/AppRoutes.tsx`** — no new route; the card lives on the order screen.
- **`package.json`**, **`.env.example`**, **`vite.config.ts`** — no additions.
