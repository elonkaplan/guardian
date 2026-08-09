# Contract: `GET /orders/:id/verdict`

**Module**: `src/guardian/verdict.controller.ts` → `verdict.service.ts` →
`verdict-serialiser.ts` · **Spec**: `docs/api-design.md` §3.4 · **Client**: `ui/src/api/types.ts`

The one route this feature adds. It is the screen the whole product argues toward: a tier, its
reasoning, and a ✓/✗ checklist of clauses.

---

## 1. Request

```
GET /orders/:id/verdict
Authorization: Bearer <jwt>
```

No query parameters, no pagination, no body. One order, one verdict, forever.

---

## 2. Response — `200 OK`

```ts
export interface CitationResponse {
  /** ⚠️ Literal. Not `clause`, not `type`, not `kind`. */
  source: 'capability' | 'exclusion' | 'criterion';
  /** ⚠️ Literal. The clause text as the auditor quoted it. */
  quote: string;
  /** ⚠️ Literal. `true` = the delivery met this clause. Drives the ✓/✗. */
  met: boolean;
}

export interface VerdictResponse {
  tier: 'none' | 'quarter' | 'half' | 'three_quarter' | 'full';
  refundMinor: number;
  reasoning: string;
  /** Never empty. FR-011 guarantees at least one, before the row is ever written. */
  citations: CitationResponse[];
  /** `null` while the order is `adjudicated` — the verdict exists, the chain call has not landed. */
  txHash: string | null;
  model: string;
  createdAt: string;
}
```

### ⚠️ Corrected: the settlement field is `txHash`

An earlier draft of this section named it `onchainTxHash`, after the column. The client reads
`raw.txHash` (`ui/src/lib/verdict.ts`) and declares `txHash: string | null`
(`ui/src/api/types.ts`). Found while implementing; the API now matches the client. This is the
same failure the rule below describes — a mismatch renders as an absent proof link rather than
an error — and it very nearly shipped.

### ⚠️ The three field names that are read literally

`source`, `quote`, `met`. The source brief calls this out because it is the failure that does
not announce itself:

> *"Field names are read literally by the UI: `{ source, quote, met }`, not `clause`."*

A renamed field does not throw. `citation.clause` arrives as `undefined`, the checklist row
renders blank or the panel disappears, and the demo shows a tier with no evidence under it —
which is precisely the "assertion, not an audit" the feature exists to avoid. The same rule
governs `case-file.dto.ts` and for the same reason.

`tier` is the **database** vocabulary (`none` … `full`), not the wire percentages the model
emitted. The client renders the percentage from the tier; the enum is the value.

`refundMinor` is USD cents (invariant #2) and is **a record of the ruling, not a payment
instruction** — the escrow computes and pays the real split on-chain from basis points. It is
here so the verdict screen and the order screen agree without either re-deriving it.

`txHash` is nullable and its null is meaningful: the verdict exists and is final, the
settlement has not confirmed yet. The client should render the ruling and omit the proof link,
never withhold the ruling. This is the invariant #8 window, visible.

---

## 3. Authorisation — buyer **or** the agent's owner

Both parties get the **identical** response. There is no redacted variant, and there must not
be one.

`docs/api-design.md` §3.4 states the reason, and the source brief repeats it:

> *"A seller ruled against who cannot read the ruling has no idea what they were found to have
> done."*

The narrow check — buyer only — is the natural one to write and it silently removes half the
seller experience. A seller is notified of a dispute and has **no right of reply**
(product §7.5); being unable to *read* the ruling as well would make the platform's core claim
indefensible. The three reads (`GET /orders/:id`, `/case-file`, `/verdict`) admit both parties;
the three writes stay buyer-only.

**Implementation: reuse `OrderRepository.findVisibleToAccount`.** It already resolves the
seller through `order → agent_version → agent → owner_account_id` — never through a stored
seller column, which would freeze the owner as of purchase time — and it already returns one
`null` for both "no such order" and "you are party to neither side."

**Do not write a second authorisation query for this route.** The rule belongs in the query
that fetched the row anyway; five call sites each re-deriving it is how one of them ends up
wrong.

### Why this route is a `guardian` controller on the `orders` path

`@Controller('orders')` in `src/guardian/`. Nest permits two controllers on one prefix. The
alternative — adding the route to `orders.controller.ts` — would make `orders` import
`guardian`, and would put the verdict's shape two modules away from the code that writes it.
`docs/CONTEXT.md`'s module map assigns the verdict to `guardian`. Guardian importing `orders`
for the authorisation query is fine and creates no cycle; the forbidden edge is
`execution ↔ guardian`.

---

## 4. Errors

| Condition | Status | Body |
| --- | --- | --- |
| No such order | `404` | `{ error: 'ORDER_NOT_FOUND' }` |
| Caller is neither the buyer nor the agent's owner | `404` | **Identical.** See below |
| Visible order, no verdict, audit still being attempted | `404` | `{ error: 'VERDICT_NOT_FOUND' }` |
| Visible order, no verdict, **audit attempts exhausted** | `409` | `{ error: 'AUDIT_FAILED', attempts, failedAt }` — ⚠️ see §4.1 |
| No / invalid JWT | `401` | Standard guard response |

### ⚠️ Not-yours and not-found must be indistinguishable

A `403` for the second row would confirm an order exists to anyone probing uuids, turning the
route into an existence oracle. `findVisibleToAccount` returns one `null` for both facts, so no
caller **can** tell them apart — rather than the code being trusted not to reveal it.
`order.repository.ts` already makes this argument for the other two reads.

### 4.1 ⚠️ `AUDIT_FAILED` is the difference between an error and a spinner

Both parties get it, and it is deliberately **not** a 404, because the client must be able to
tell *"the ruling is still coming"* from *"no ruling is coming"* without polling forever.

```json
{ "error": "AUDIT_FAILED", "attempts": 3, "failedAt": "2026-08-09T04:31:07.882Z" }
```

Read from `orders.audit_failed_at` and `orders.audit_attempts` (`data-model.md` §7). It is
terminal: nothing retries after it, and no verdict will ever appear for this order through this
feature. The money remains escrowed until the escrow's 72-hour `DISPUTE_DEADLINE` allows anyone
to call `forceResolve`, which settles at a fixed quarter tier.

**Why this exists at all.** Without it the order rests in `disputed` with no verdict, which is
byte-identical to an audit in progress — so the buyer's screen says a ruling is being prepared,
indefinitely, with nothing behind it. No scheduled job in the system touches a stuck dispute
(API-10's reaper covers `running` only), so nothing would ever change that answer. R14.

**Why there is no fabricated ruling here.** The obvious alternative — write a quarter-tier
ruling and settle, matching `product-workflow.md` §7.4 — would free the money and put a row into
`verdicts` that Guardian did not author, rendering as a tier with an empty citation checklist.
FR-041 and SC-013: every ruling in the record was produced by the auditor.

### The third row is a different 404, and that is correct

*"You may see this order; it has no verdict yet"* is a distinguishable answer, because the
caller has already proven they are a party to the order. That is the polling state: a buyer
watching a disputed order sees `VERDICT_NOT_FOUND` until the audit lands, then the ruling
(FR-034). It must never be a partial or provisional verdict — there is no such thing.

---

## 5. Replay: the same bytes, every time

Repeated reads of a decided order return byte-identical `tier`, `reasoning`, and `citations`
(FR-025, SC-005). This is not a caching behaviour — it is the absence of any recomputation
path. The route reads one row; the row was written once; `UNIQUE (order_id)` means there can
never be a second.

This is what makes a rehearsal reproducible. `temperature` does not exist on Opus 5, so a
re-audit would be a genuinely *different* audit — and `docs/tech-stack.md` §5 is explicit that
the mitigation *"is not a demo trick: it falls straight out of the product rule that verdicts
are final."*

---

## 6. The serialiser

`verdict-serialiser.ts` is the only mapper for this route and it takes a row type, not the
entity.

**Why a separate file rather than a method on the service:** the same reason
`orders/order-serialiser.ts` is one — the guarantee comes from the *parameter type having no
dangerous member*, not from the mapper being careful. A `Verdict` entity carries nothing
sensitive today, but this response is the one place Guardian's prose reaches a buyer, and

```ts
return { ...verdictRow, ...orderRow };
```

must remain a compile error here above all: an order row carries `buyerAccountId` and an agent
version row carries `systemPrompt`. The mapper names its fields.

**`citations` passes through with no reshaping.** It was validated on the way in
(`verdict-schema.md` §4) and stored verbatim. Any transformation here — renaming, filtering by
`met`, sorting — would mean the buyer and the seller read something other than the ruling that
was made, and would break §5.

---

## 7. Reconciling with the published contract

The source brief says to build against `docs/openapi.yaml` (API-12). **That file does not exist
in the repository yet** — it belongs to a later feature. Until it does, the contract is
`docs/api-design.md` §3.4 plus `ui/src/api/types.ts`, and this document.

When API-12 lands, this route is one of the ones it must reconcile: **a divergence there is a
defect here.** The three field names in §2 are the highest-risk entries, because a mismatch
renders as an absent panel rather than an error.
