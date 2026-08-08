# API-05 — Accounts, ledger & funding

**Component:** `api/` · **Depends on:** API-02, API-03, API-04 · **Size:** Medium

> **Feed this file to `/speckit-specify`.** Read [`../CONTEXT.md`](../CONTEXT.md)
> first — it carries the nine backend invariants this spec assumes.

## Goal

Money in and money out, plus the Rain stubs that document what we would have called.

## In scope

- `GET /me` — **available balance and in-escrow as separate figures**
- `GET /me/ledger` — statement
- `POST /topup` — funder wallet → operator pool on-chain, then a `kind='onramp'`
  ledger credit
- `POST /withdraw` — `withdrawFor(wallet)`; settled funds to the user's own wallet
- `POST /offramp` — unspent balance: operator pool → funder, `kind='offramp'` debit
- `POST /onramp/routes` and `POST /offramp/routes` — **stubs**: log the exact Rain
  request body at `warn`, return a response saying no call was made

## Out of scope

**Automated tests of any kind** (MVP decision — see `../CONTEXT.md`). Plus:

Live Rain calls, webhooks, deposit polling, bank accounts, per-user Rain records.

## Acceptance

- A top-up moves real test USDC and the ledger reflects it
- A cash-out returns tokens to the funder and debits the ledger
- `GET /me` never collapses the two figures into one
- Stub responses are visibly stubs

## Watch out for

- **Never fake a `200 OK` from the Rain stubs.** A mock that returns success is a
  thing you forget about and then accidentally demo.
- **Two numbers, not one.** Money lives in four places; a single "balance" would be
  wrong in three of them.
- **Settlement writes no ledger entry.** Settled funds are on-chain under the user's
  own address — we can't recapture them, by design.
- The funder wallet is the outside world: money enters from it and returns to it. Its
  balance drifting in one direction only is a signal something's wrong.

## Source

`../../../docs/api-design.md` §3.2 · `../../../docs/rain-integration.md` §0 ·
`../../../docs/database-schema.md` §3.
