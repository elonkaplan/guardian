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

Plus: `GET /orders`, `GET /orders/:id`, `GET /sales`,
`POST /orders/:id/accept`, `POST /orders/:id/complain`,
`GET /orders/:id/case-file`.

## Out of scope

**Automated tests of any kind** (MVP decision — see `../CONTEXT.md`). Plus:

Running the agent (API-08), auditing (API-09), the cron jobs (API-10).

## Acceptance

- A purchase completes end to end and the escrow holds the money
- A forced chain failure leaves the buyer's balance whole
- Complaining creates the complaint row, calls `dispute`, and moves state
- The case file is redacted for the buyer and complete for the seller

## Watch out for

- **Step 2 must be a single transaction.** Any gap between the order insert and the
  ledger debit is a window where the same balance is spent twice.
- **Postgres first, chain second.** A bad DB write is one compensating row; a stray
  on-chain deal is recoverable only by hand.
- **`reviewWindowSeconds` comes from config and must never be `0`.** Zero means the
  complaint button never works and the order auto-releases instantly — no error
  anywhere, and both demo acts die on stage.
- The complaint window closes exactly when the review window does; `dispute` after
  it must fail.

## Source

`../../../docs/api-design.md` §4 · `../../../docs/product-workflow.md` §2.
