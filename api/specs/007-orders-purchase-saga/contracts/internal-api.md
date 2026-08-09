# Phase 1 — Internal Contracts: Orders & the Purchase Saga

**Feature**: `007-orders-purchase-saga` · **Date**: 2026-08-09 · **Plan**: [plan.md](../plan.md)

Seven endpoints. Field names here are **literal** — `docs/openapi.yaml` still does not exist
(API-12 is written but unbuilt), so this file is the contract the UI reconciles against,
exactly as `005-accounts-ledger-funding` and `006-agent-catalogue` were.

**Six of the seven shapes are transcribed, not designed.** `ui/src/api/types.ts` already
declares `CreateOrderRequest`, `CreateOrderResponse`, `Order`, `OrderRun`, `ComplainRequest`,
`CaseFile`, `CaseFileStep` and `Sale`, and `ui/src/api/orders.ts` and `sales.ts` are written
against them. The client exists and the server does not, so reconciling means matching it
([R12](../research.md)). `GET /orders` is the one shape defined here, because
`MyOrdersPage.tsx` is still a `PagePlaceholder`.

**Casing**: `camelCase` on the wire, everywhere. **Money**: integer USD cents, always
suffixed `Minor`. **Timestamps**: ISO-8601 strings. **Lists**: bare JSON arrays, no envelope.

---

## 0. Route table

| # | Method | Path | Auth | Returns |
| --- | --- | --- | --- | --- |
| 1 | `POST` | `/orders` | required | `CreateOrderResponse` |
| 2 | `GET` | `/orders` | required (buyer) | `BuyerOrderSummary[]` |
| 3 | `GET` | `/orders/:id` | **buyer or seller** | `OrderResponse` |
| 4 | `GET` | `/orders/:id/case-file` | **buyer or seller** | `BuyerCaseFile` \| `SellerCaseFile` |
| 5 | `POST` | `/orders/:id/accept` | **buyer only** | `202` no body read |
| 6 | `POST` | `/orders/:id/complain` | **buyer only** | `202` no body read |
| 7 | `GET` | `/sales` | required (seller) | `Sale[]` |

**Routes 3 and 4 are the two the seller must also reach.** Authorising them on
`buyer_account_id` alone is the natural thing to write and it silently deletes half the
seller experience — a seller notified of a dispute who cannot open the case file has been
told of an accusation they may not see. Verified as the seller account in
[quickstart.md](../quickstart.md) §7, not merely as the buyer.

`GET /orders/:id/verdict` is **not here.** It is API-09's, alongside the audit that produces
a verdict.

---

## 1. `POST /orders` — the purchase saga

```ts
interface CreateOrderRequest {
  agentId: string;                      // the AGENT's uuid — the order pins its latest version
  input: Record<string, unknown>;       // validated against that version's inputSchema
  acceptanceCriteria: string;           // free text, non-blank
}

interface CreateOrderResponse {
  id: string;                           // the order's uuid
}
```

`201`. The response is deliberately thin — `ui/src/api/types.ts` states the client wants
*"an id to navigate to"* and that modelling the order here would mean two type definitions
racing to describe the same resource. `GET /orders/:id` is the authority on everything else.

### ⚠️ Not idempotent, and there is no idempotency key

`ui/src/api/orders.ts` documents at length that a client timeout tells it nothing about
whether the transaction committed, and that this call must never be auto-retried. That rule
depends on there being no key, and this feature adds none. If one is ever added, that comment
and the ambiguous branch in `BuyPanel` can both be deleted — until then they stand.

### Failure table

| Case | Status | Body | State left behind |
| --- | --- | --- | --- |
| No session | `401` | — | nothing |
| `agentId` malformed | `400` | `fieldErrors.agentId` | nothing |
| Agent unknown, inactive, or unregistered on-chain | `404` | `Agent not found` | nothing — one answer for three facts, as `catalog.errors.ts` requires |
| `input` fails the version's `inputSchema` | `400` | `fieldErrors.input` — Ajv's message, with its JSON Pointer | nothing |
| `acceptanceCriteria` blank or whitespace | `400` | `fieldErrors.acceptanceCriteria` | nothing |
| Balance below price | `402` | `availableBalanceMinor`, `priceMinor` | nothing |
| Escrow call **known** to have failed | `502` | `Purchase did not complete` | order `failed`, deal id NULL, **compensating credit written** |
| Escrow outcome **unknown** | `502` | `Purchase did not complete` | order **`purchased`**, deal id NULL, **nothing compensated** ([R3](../research.md)) |

**The last two rows are the same answer to the caller and different states in the
database.** The caller cannot act on the difference; the platform must. Compensating an
unknown outcome would restore a balance whose money may simultaneously be locked on-chain.

`402` rather than `400` for insufficient funds: the request was well-formed and the state is
what refused it, the same distinction `catalog-http.ts` makes load-bearing between `400`,
`409` and `502`.

---

## 2. `GET /orders` — the buyer's orders

Required auth. Every order this account placed, in any state, newest first.

```ts
interface BuyerOrderSummary {
  id: string;
  agentName: string;                    // resolved through the PINNED version
  priceMinor: number;
  state: OrderState;
  createdAt: string;
  deliveredAt: string | null;
  disputedAt: string | null;
}
```

**Defined here, not transcribed** — `MyOrdersPage.tsx` is a placeholder and no UI type
exists. Mirrors `Sale` field for field and adds `deliveredAt`, because the My Orders list is
where a buyer sees which orders are waiting on them (`docs/ui-design.md` §205 assigns this
endpoint to that page's load).

| Case | Response |
| --- | --- |
| No orders | `200 []` — never `404` |
| `failed`, `released`, `settled` orders | **included** — every state (FR-045) |
| Another account's orders | never present |
| No session | `401` — never a public fallback |

---

## 3. `GET /orders/:id` — the order screen's poll

**Buyer or the owner of the agent the order was placed against.** Polled at 1 s by
`useOrder`.

```ts
interface OrderRun {
  input: Record<string, unknown>;
  output: unknown | null;               // null = the agent produced nothing
}

interface OrderResponse {
  id: string;
  state: OrderState;
  agentName: string;
  priceMinor: number;
  acceptanceCriteria: string;
  reviewWindowSeconds: number;          // the SNAPSHOT, not the live config
  createdAt: string;
  deliveredAt: string | null;
  disputedAt: string | null;
  settledAt: string | null;
  run: OrderRun | null;                 // null = execution has not started
}
```

Transcribed from `ui/src/api/types.ts`'s `Order`. Four properties of it are load-bearing and
are repeated here because getting any of them wrong is a defect on the client:

- **No `agentId`.** Nothing on the order screen navigates back to the listing.
- **`reviewWindowSeconds` is the order's own column**, not a config read. The countdown is
  computed from it and nothing else; reading live config would retime orders already sold.
- **`run` and `run.output` are different kinds of nothing.** `run === null` means execution
  has not started; `run.output === null` means it ran and produced nothing. Collapsing them
  tells a buyer their agent is still working when it has already given up.
- **No `steps`.** The UI's comment calls the absent property the guarantee. Steps appear only
  in the case file, redacted.

Until API-08 exists, `run` is always `null`.

| Case | Response |
| --- | --- |
| Caller is the buyer | `200` |
| Caller owns the agent | `200` — **verified as the seller, quickstart §7** |
| Caller is neither | **`404`** — never `403` ([R7](../research.md)) |
| Order does not exist | `404` — the same body, byte for byte |
| `:id` malformed | `400` |
| No session | `401` |

**`404` and not `403` for a non-party** is a security decision, not an inconsistency: a `403`
would confirm the order exists to anyone probing uuids (FR-036). One error class covers both
facts so no controller can accidentally distinguish them.

---

## 4. `GET /orders/:id/case-file` — two shapes, one route

**Buyer or seller.** The one route in the product that returns different content to
different callers.

```ts
interface CaseFileStep {
  label: string;
  summary: string | null;               // PLATFORM-authored — never model prose
  durationMs: number | null;
  error: string | null;
}

interface BuyerCaseFile {
  input: Record<string, unknown>;
  acceptanceCriteria: string;
  capabilities: string[];               // from the PINNED version
  exclusions: string[];                 // from the PINNED version
  output: unknown | null;
  steps: CaseFileStep[];
}

interface SellerCaseFile extends BuyerCaseFile {
  systemPrompt: string;                 // it is theirs
  rawSteps: ExecutionStep[];            // as recorded, reasoning included
}
```

`BuyerCaseFile` is `ui/src/api/types.ts`'s `CaseFile`, field for field. `SellerCaseFile` adds
two fields the UI does not yet declare — safe, since that file states declaring fewer fields
than arrive is safe, and flagged in §8 as a handoff.

### ⚠️ The route branches; the serialiser does not

006 FR-030 forbade one route branching on the caller. This feature's FR-035 requires exactly
that, and `useCaseFile` reads one path for both parties. The tension is resolved by being
precise about what must not branch ([R10](../research.md)):

| Layer | Branches? |
| --- | --- |
| The route | **yes** — after the caller's role is already resolved and checked |
| The query | **yes** — the buyer's `SELECT` does not name `system_prompt` |
| The mapper | **no** — two closed functions, neither with a mode flag; the buyer's parameter type has no such member |

What 006 was protecting is the mapper: a conditional deciding what a caller may see is a
disclosure bug waiting to happen. That property holds. Pushing the branch down into the query
is stronger than the mapper guarantee alone — on a buyer's read the prompt never enters the
process, so it cannot reach a log line or a stack trace either.

### The redaction, stated as a contract

| Content | Seller | Buyer |
| --- | --- | --- |
| `systemPrompt` | ✅ | **never, under any input** |
| Model reasoning text | ✅ verbatim in `rawSteps` | **dropped** — not truncated, not model-summarised ([R11](../research.md)) |
| Tool names, phases, timings, errors | ✅ | ✅ in full |
| `capabilities` / `exclusions` | the pinned version's | the pinned version's |

**`capabilities` and `exclusions` come from the version the order pinned, never the agent's
current one.** A seller who lost a dispute has every reason to edit the capability cited
against them, and explaining a ruling with today's listing would break the trace from a
citation to its source in the one direction that looks like the platform covering for the
seller.

| Case | Response |
| --- | --- |
| Order in any state | `200` — including `purchased`, where `output` is `null` and `steps` is `[]` |
| Order has no run | `200` with `output: null`, `steps: []` — the absence **is** the evidence (FR-040) |
| Caller is neither party | `404` |
| No session | `401` |

---

## 5. `POST /orders/:id/accept` — the buyer releases the money early

**Buyer only.** No request body — the id in the path is the whole request.

`202`. `ui/src/api/orders.ts` types this `apiPost<unknown>` and discards the response on
purpose: the poll one second later is the authority on what the order now is. A body is sent
and the client chooses not to read it.

| Case | Status | Note |
| --- | --- | --- |
| Order is `delivered`, caller is the buyer | `202` | escrow `accept`, order → `released`, `settled_at` set. **No ledger entry** (FR-028, invariant #5) |
| Caller is the **seller** | `404` | Only the buyer settles. The read routes admit them; the writes do not |
| Caller is neither party | `404` | same body |
| Order not `delivered` | `409` | body names the current state |
| Chain call fails, or outcome unknown | `502` | **transaction rolled back** — the order stays `delivered` and the sweeper remains its backstop ([R8](../research.md)) |

**Rolling back on an unknown outcome is deliberate.** If the call did not land, the sweeper
releases the order when the window expires and the seller is paid. Committing `released`
would take the order out of the sweeper's query, so a call that did not land would leave the
seller unpaid indefinitely.

---

## 6. `POST /orders/:id/complain` — the buyer disputes

**Buyer only.**

```ts
interface ComplainRequest {
  reason: string;                       // non-blank
}
```

`202`. Response discarded by the client, same as accept.

| Case | Status | Note |
| --- | --- | --- |
| Order is `delivered`, within the window | `202` | complaint row, escrow `dispute`, order → `disputed`, `disputed_at` set |
| Order is **`failed` with a deal id** | `202` | `markDelivered` **then** `dispute` ([R9](../research.md)) — this is Act 3 |
| Order is `failed` with **no** deal id | `409` | nothing was ever escrowed; there is no deal to dispute |
| Review window elapsed | `409` | the platform refuses at the same instant the contract does |
| A complaint already exists | `409` | `complaints.order_id UNIQUE` — enforced in storage, not by a check (FR-031) |
| `reason` blank | `400` | `fieldErrors.reason` |
| Caller is the seller | `404` | notification without right of reply (FR-036, product §7.5) |
| Order in any other state | `409` | body names the current state |
| Chain call fails | `502` | transaction rolled back; nothing recorded |
| Chain outcome **unknown** | `502` | **complaint committed**, order `disputed`, logged at `error` ([R8](../research.md)) |

**Committing on an unknown outcome is deliberate, and the opposite of accept's choice.** The
complaint is the buyer's testimony and is not reproducible; and if the `dispute` did land,
rolling back would leave the buyer locked out of a dispute the chain already believes they
filed, with `release` reverting forever and a second complaint failing too.

**The window boundary is the contract's, not ours.** The platform refuses at
`delivered_at + review_window_seconds` and the escrow refuses at the same instant. Where the
two race — a complaint against the sweeper's release — the contract decides and the platform
reports the actual outcome rather than the hoped-for one.

---

## 7. `GET /sales` — the seller's side

Required auth. Every order placed against any agent this account owns.

```ts
interface Sale {
  id: string;                           // the ORDER's id, not a separate sale id
  agentName: string;
  priceMinor: number;
  state: OrderState;
  createdAt: string;
  disputedAt: string | null;
}
```

Transcribed from `ui/src/api/types.ts`. Three of its comments are contracts:

- **`id` is the order id.** It is what `/sell/sales/:id` carries and what all three of the
  dispute screen's reads are keyed on.
- **`disputedAt` is carried as a fact, not inferred from `state`.** It is true from the
  moment a complaint is filed and stays true through every state after it, so a state added
  later cannot silently mislabel a row.
- **There is no `buyerAddress`.** The seller learns what was ordered, what it cost, and what
  was ruled — not who bought it.

**This endpoint is the seller's notification mechanism.** There is no email, no push and no
bell in the header: a seller learns a complaint was filed because a row here changes state,
which is why `useSales` polls. `product-workflow.md` §7.5's *"the seller is notified"* is
true only for as long as this list is re-read.

| Case | Response |
| --- | --- |
| Owns nothing, or nothing sold | `200 []` |
| Agents since made unavailable | sales **still listed** (FR-046) |
| Another account's sales | never present |
| No session | `401` |

---

## 8. Handoffs

**To API-08 (execution)** — three things are fixed here:
1. The queue entry is `state = 'purchased' AND onchain_deal_id IS NOT NULL`. There is no
   dispatcher and no port to implement ([R13](../research.md)).
2. The buyer's input is on **`orders.input`**, not on a `runs` row. Execution reads it from
   there and writes its own `runs.input` (data-model §1).
3. `runs.steps` must be written in the `ExecutionStep` shape (data-model §5), with model
   prose confined to `reasoning`. The buyer's mapper does not read that field, and that is
   the whole redaction.

**To API-09 (audit)** — it consumes `state = 'disputed'`, reads the complaint by `order_id`,
and assembles the auditor's own view of the case file. The seller-facing assembly built here
is the closest thing to it and should be reused rather than rebuilt. `GET /orders/:id/verdict`
is API-09's route, not defined here.

**To API-10 (jobs)** — three queues this feature creates:
- `state = 'delivered' AND now() >= delivered_at + review_window_seconds` → the sweeper.
- `state = 'purchased' AND onchain_deal_id IS NULL` past a grace period → the confirmation
  retry. **This is the resting state of an unknown-outcome purchase** ([R3](../research.md)),
  and it is the job that owns it. ⚠️ It must not resolve one by calling `openDeal` again.
- `state = 'failed' AND onchain_deal_id IS NOT NULL` → the reclaimer's population, once the
  delivery deadline passes and no complaint was filed.

**To API-12 (openapi.yaml)** — every shape above, and the `402`/`409`/`502` split, which is
finer than a generic 4xx/5xx and which the client branches on.

**To the UI** — one addition, one gap:
- `SellerCaseFile` carries `systemPrompt` and `rawSteps`, which `ui/src/api/types.ts`'s
  `CaseFile` does not declare. Safe to send; the seller's screen has nowhere to render them
  until that type is extended. `ui-design.md` §7.1 says the seller's view *"stays
  unredacted"*, so this is worth doing.
- `GET /orders` returns `BuyerOrderSummary[]`, defined here. `MyOrdersPage.tsx` is a
  `PagePlaceholder` and needs a type and a hook before it can render.

---

## 9. Verification — what was actually run

Four scripts in `api/scripts/`, following the precedent `verify-005.mjs` set: with no test
suite in this component, the manual verification is a script you run and read.

| Script | Covers | Result |
| --- | --- | --- |
| `verify-007.mjs` | §3 purchase, §5 double-spend race, §7 visibility, §8 case file, §11 refusals | **61/61** |
| `verify-007-failure.mjs` | §4 the forced chain failure, both halves | **10/10** |
| `verify-007-seller.mjs` | §7 the **seller** opening a sale they did not buy, §8 sentinel sweep | **30/30** |
| `verify-007-settlement.mjs` | §6 accept, §9 complain, **§10 Act 3** | **22/22** |

All four run against the live Monad testnet escrow and a real Postgres, and they spend real
testnet funds.

### Two defects they caught that reading the code did not

**`InsufficientBalanceError` was never translated.** `PurchaseService` documented that it
throws `InsufficientFundsForPurchaseError`, and it never did — `LedgerRepository` throws its
own module's error, `orders-http.ts` does not map it, and the chain mapper rethrows what it
does not recognise. The single most ordinary refusal in the product — a buyer who cannot
afford what they clicked — answered `500 Internal server error` and carried neither figure.
Nothing in the type system related the declared throw to the actual one.

**`openDeal`'s two pre-reads escaped the chain module's error vocabulary.**
`EscrowOperatorService.readAgentPriceCents` and `ensureAllowance` called
`publicClient.readContract` directly rather than through a wrapper, so with the RPC
unreachable they raised a raw viem `HttpRequestError`. Not being a `ChainError`, it fell
through `common/chain-http.ts`'s final `throw err` to a bare `500` — for a condition the
saga had already handled correctly by compensating the buyer. **The money was right and only
the status code lied**, which is the kind of defect a manual click-through never finds.
Fixed at the source in `chain/`, where `EscrowReadService` had always wrapped its reads with
a comment saying the requirement *"is not limited to writes"*.

### Not covered by any script, and why

- **§4's unknown-outcome branch (U1–U5).** Needs a transaction that is broadcast and whose
  receipt never arrives — `RECEIPT_TIMEOUT_MS=1` plus a restart, and even then the timing is
  not reliably reproducible. The knowable-failure branch beside it is fully covered.
- **§9's D9–D11, complaining past the review window.** Needs a short window and a wait; the
  window check itself is exercised by the state refusals.
- **§12's two consecutive rehearsals.** A human gate by definition.
