# API-05 — Accounts, ledger & funding

**Component:** `api/` · **Depends on:** API-02, API-03, API-04 · **Size:** Medium

> **Feed this file to `/speckit-specify`.** Read [`../CONTEXT.md`](../CONTEXT.md)
> first — it carries the nine backend invariants this spec assumes.

## Goal

Money in and money out, plus the Rain stubs that document what we would have called.

## In scope

- `GET /me` — **three separate money figures**, never collapsed:
  `availableBalanceMinor` and `inEscrowMinor` from Postgres, and
  **`settledFundsMinor` from the chain** via API-03's `balances(address)`, which
  already returns cents. **Nullable** — see "Watch out for".
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
- `GET /me` never collapses the **three** figures into fewer
- **`GET /me` still returns 200 with both Postgres figures when the chain read
  fails** — verify by pointing `MONAD_RPC_URL` at a dead host
- Stub responses are visibly stubs

## Watch out for

- **Never fake a `200 OK` from the Rain stubs.** A mock that returns success is a
  thing you forget about and then accidentally demo.
- **Three numbers, not one.** Money lives in four places; a single "balance" would be
  wrong in three of them.
- **Settlement writes no ledger entry.** Settled funds are on-chain under the user's
  own address — we can't recapture them, by design. That is *why* the third figure
  needs a chain read: there is no database representation of this money and there
  never will be.
- **`settledFundsMinor` must be best-effort.** `GET /me` is polled every 5s by the
  balance widget on every page, so this adds an RPC round trip to the app's hottest
  endpoint. On a failed or slow chain read, **return `null` and serve the other two
  figures** — never fail the request. A missing third number is a dash on one page; a
  failing `/me` is a broken balance widget everywhere. Bad connectivity is a demo-day
  condition, not a hypothetical.
- **Name the field `settledFundsMinor`**, matching `availableBalanceMinor` and
  `inEscrowMinor`, and in cents like every figure outside `chain/`. The UI reads this
  name literally; a mismatch renders as an absent value rather than an error (see
  `67dcf4d` — the same class of bug, already paid for once).
- The funder wallet is the outside world: money enters from it and returns to it. Its
  balance drifting in one direction only is a signal something's wrong.

## Source

`../../../docs/api-design.md` §3.2 · `../../../docs/rain-integration.md` §0 ·
`../../../docs/database-schema.md` §3.
