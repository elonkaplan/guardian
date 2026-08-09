# UI-06 — Wallet page

**Component:** `ui/` · **Depends on:** UI-02 · **Size:** Medium

> **Feed this file to `/speckit-specify`.** Read [`../CONTEXT.md`](../CONTEXT.md)
> first — it carries the frontend conventions and the six things that must be visible.

## Goal

Money in, money out — and make the two different kinds of money legible.

## In scope

- `GET /me` → **three separate figures**, never collapsed:
  `availableBalanceMinor`, `inEscrowMinor`, `settledFundsMinor`
- **`settledFundsMinor` may be `null`** — the backend reads it from the chain and
  returns `null` rather than failing when that read fails (api-design §3.2.1). Render
  a dash and disable *Withdraw*; the page keeps working.
- `GET /me/ledger` → statement, poll at 5s
- **Add funds** → `POST /topup`; balance updates immediately (sub-second finality)
- **Withdraw** → `POST /withdraw` — settled funds to your own wallet
- **Cash out** → `POST /offramp` — unspent balance back to the treasury
- Copy: *"Funded from the demo treasury — Rain's onramp has no Monad rail yet."*

## Out of scope

**Automated tests of any kind** (MVP decision — see `../CONTEXT.md`). Plus:

Rain route UI, bank details, transaction history beyond the ledger.

## Acceptance

- Top-up, withdraw, and cash-out each work
- The ledger explains every balance change
- Available balance and settled funds are never shown as one number
- A `null` `settledFundsMinor` renders as a dash with *Withdraw* disabled, and
  **blanks neither the wallet page nor the header balance widget**

## Watch out for

- **Two exits, because there are two kinds of money.** Available balance lives in
  the platform ledger and leaves via cash-out; settled funds live on-chain under your
  own address and leave via withdraw. One combined number would be wrong in both
  directions — and would make the ledger look broken.
- **Volunteer where the money came from.** A judge seeing "$100 added" with no bank
  transfer will ask. Answering first is much better than being asked.
- **Settled funds are on-chain, but the page still reads them from `GET /me`.** The
  frontend never calls the escrow contract and this figure is not the exception — the
  backend does the chain read (api-design §3.2.1).
- **Read the field names literally**: `availableBalanceMinor`, `inEscrowMinor`,
  `settledFundsMinor`, all in cents. A name that doesn't match renders as an absent
  value rather than an error, which is exactly how `67dcf4d` happened.

## Source

`../../../docs/ui-design.md` §3 Flow E, §4 · `../../../docs/database-schema.md` §3.3.
