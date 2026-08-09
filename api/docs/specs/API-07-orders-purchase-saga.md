# API-07 — Orders & the purchase saga

**Component:** `api/` · **Depends on:** API-05, API-06 · **Size:** Large

> ⚠️ **The riskiest spec in the backend** — money, chain, and async in one request.

> **Feed this file to `/speckit-specify`.** Read [`../CONTEXT.md`](../CONTEXT.md)
> first — it carries the nine backend invariants this spec assumes.

## Goal

Purchase through to acceptance or complaint, with a failure branch that never leaves
a buyer out of pocket.

## In scope

`POST /orders` as an explicit saga:

1. **Validate** — agent active; input matches `input_schema`; acceptance criteria
   non-empty; balance sufficient
2. **One Postgres transaction** — insert order (`state='purchased'`,
   `onchain_deal_id` NULL) **and** insert the negative ledger entry
3. **Chain** — `openDeal(agentId, buyerWallet, reviewWindowSeconds)`; on receipt
   store `onchain_deal_id`
4. **On chain failure** — `state='failed'` plus a compensating `adjustment` ledger
   entry
5. **Dispatch execution** async, return 201

Plus: `GET /orders` (buyer's), `GET /sales` (seller's),
`POST /orders/:id/accept` and `POST /orders/:id/complain` (**buyer only**),
and two reads authorised for **the buyer *or* the agent's owner**:
`GET /orders/:id` and `GET /orders/:id/case-file`.

## Out of scope

**Automated tests of any kind** (MVP decision — see `../CONTEXT.md`). Plus:

Running the agent (API-08), auditing (API-09), the cron jobs (API-10).

## Acceptance

- A purchase completes end to end and the escrow holds the money
- A forced chain failure leaves the buyer's balance whole
- Complaining creates the complaint row, calls `dispute`, and moves state
- The case file is redacted for the buyer and complete for the seller
- **A seller can open `GET /orders/:id` and `GET /orders/:id/case-file` for a sale
  they did not buy** — verify as the seller account, not just the buyer

## Watch out for

- **Step 2 must be a single transaction.** Any gap between the order insert and the
  ledger debit is a window where the same balance is spent twice.
- **Postgres first, chain second** — correct *here* because a purchase reduces the
  ledger. It is not a universal rule: see `../CONTEXT.md` invariant #1, which orders
  every two-phase flow so a crash leaves the pool holding more than the ledger
  claims. A bad DB write is one compensating row; a stray on-chain deal is
  recoverable only by hand.
- **Authorise the two order reads on buyer *or* agent owner.** Checking
  `buyer_account_id` alone is the natural thing to write and it silently removes half
  the seller experience — a seller notified of a dispute who cannot open the case
  file has been told of an accusation they may not see. The writes stay buyer-only.
- **`reviewWindowSeconds` comes from config and must never be `0`.** Zero means the
  complaint button never works and the order auto-releases instantly — no error
  anywhere, and every demo act dies on stage.
- The complaint window closes exactly when the review window does; `dispute` after
  it must fail.

## Source

`../../../docs/api-design.md` §4 · `../../../docs/product-workflow.md` §2.

**Build against [`../../../docs/openapi.yaml`](../../../docs/openapi.yaml)** (API-12) — it is the contract the frontend reconciles against, and a divergence here is a defect there.
