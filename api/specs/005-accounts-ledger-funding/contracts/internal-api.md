# Contract: Accounts, Ledger & Funding — HTTP surface

**Feature**: `005-accounts-ledger-funding` · **Date**: 2026-08-09

**Every identifier in this file is literal.** Paths, field names and casing are the
contract, not a description of one — `ui/specs/006-wallet-page/` is already written
against them. A renamed field does not throw; it renders as an absent value
(`67dcf4d`). Copy from here rather than retyping.

All seven endpoints are **protected**. The global `JwtAuthGuard` (API-04) is fail-closed,
so no `@Public()` marker appears anywhere in this feature — including on the two stubs,
which move no money but are not open either.

---

## 1. `GET /me`

The hottest endpoint in the product: polled every 5 s by the balance widget on every
page.

**Request**: no body, no params.

**`200` response** — `AccountSummaryResponse`:

```ts
{
  accountId: string;                 // uuid
  address: string;                   // EIP-55 checksummed, exactly as stored
  availableBalanceMinor: number;     // cents, ≥ 0 in practice, never null
  inEscrowMinor: number;             // cents, never null
  settledFundsMinor: number | null;  // cents, or null = COULD NOT BE READ
}
```

### The three rules that make this endpoint correct

1. **Never fewer than three figures.** No combined `balance` field is added, ever. Money
   lives in four places; one number would be wrong in three of them.
2. **`settledFundsMinor` is `null`, and the key is always present.** `JSON.stringify`
   drops `undefined`, so returning `undefined` silently changes the wire contract. Return
   an explicit `null`.
3. **`null` ≠ `0`.** `null` means the chain could not be read; `0` means the chain was
   read and the user has nothing settled. The UI renders `—` for the first and `$0.00`
   for the second, and disables Withdraw for both with different wording.

### Failure behaviour — the acceptance test for this feature

A failed, slow, or unreachable chain **must not fail this request**. Point
`MONAD_RPC_URL` at a dead host and this endpoint still returns `200` with correct
`availableBalanceMinor` and `inEscrowMinor`, and `settledFundsMinor: null`, within the
2 s budget.

| Condition | Status | `settledFundsMinor` |
| --- | --- | --- |
| Chain healthy, user has settled funds | `200` | the amount in cents |
| Chain healthy, nothing settled | `200` | `0` |
| Chain unreachable / errors / > 2 s | `200` | `null` |
| Postgres unreachable | `500` | — the request legitimately fails |
| No or invalid token | `401` | — |

---

## 2. `GET /me/ledger`

**Request**: no body, no params. No pagination (out of scope).

**`200` response** — `LedgerEntryResponse[]`, newest first:

```ts
Array<{
  id: string;                  // uuid
  amountMinor: number;         // SIGNED cents — positive credit, negative debit
  kind: 'onramp' | 'purchase' | 'offramp' | 'adjustment';
  orderId: string | null;      // set on 'purchase' only
  externalRef: string | null;  // tx hash on 'onramp'; ALWAYS null on 'offramp' — see below
  createdAt: string;           // ISO 8601
}>
```

`[]` for an account with no movements — not `404`, not an error.

**The sum of `amountMinor` over this list equals `availableBalanceMinor` from `GET /me`.**
That is the contract; if it ever does not hold, one of the two is wrong.

Ordered `created_at DESC, id DESC`. The `id` tiebreak is not decoration — two rows written
in one transaction share a timestamp, and an unstable order reshuffles the list between
the refetches the UI issues after every mutation.

**`externalRef` is asymmetric between the two funding kinds, and that asymmetry is forced
by the write-order rule.** A top-up transfers *before* it credits, so the hash exists by
the time the `onramp` row is written and is stored on it. A cash-out debits *before* it
transfers, so at the moment the `offramp` row is written the transaction has not been
broadcast and no hash exists — and the ledger is append-only (invariant #4, FR-011), so it
cannot be added afterwards. The `offramp` row therefore always carries `null`, and the
hash reaches the caller in the response and the log instead.

Recording this because it looks like a missing write. Backfilling it would mean either
updating a written row (breaking append-only) or transferring before debiting (breaking
solvency in the unsafe direction). Both are worse than a null.

---

## 3. `POST /topup`

Funder wallet → operator pool, then an `onramp` credit. **Transfer first** (R7).

**Request**:

```ts
{ amountMinor: number }   // positive safe integer, cents
```

**`200` response** — the updated `AccountSummaryResponse` (§1), so the widget is correct
without a second round trip. `ui/specs/006-wallet-page/data-model.md` assumes this shape
and degrades gracefully if it changes, but this is the shape.

| Condition | Status | Body |
| --- | --- | --- |
| Success | `200` | updated summary |
| `amountMinor` ≤ 0, fractional, or not a number | `400` | `{ message: 'Validation failed', errors }` |
| Funder wallet short of USDC | `409` | `{ message: 'Funder wallet holds $X, cannot transfer $Y' }` |
| Funder wallet short of MON for gas | `502` | `{ message }` naming the funder address |
| Transfer reverted | `502` | `{ message }` carrying the decoded reason |
| Transfer broadcast, no receipt in 30 s | `502` | `{ message, txHash }` — outcome **unknown**, no credit written |

**No credit is written unless the transfer confirmed.** On the unknown-outcome branch the
hash is logged at `error` and returned; a human replays the credit as an `adjustment` if
the transaction later lands.

---

## 4. `POST /withdraw`

`withdrawFor(wallet)` — settled funds to the account's own address. **Writes no ledger
entry** (invariant #5).

**Request**: no body. There is no partial withdrawal; the contract moves the whole
balance.

**`200` response** — `WithdrawResponse`:

```ts
{
  txHash: string;        // 0x-prefixed
  amountMinor: number;   // cents moved, from the pre-read
  explorerUrl: string;   // EscrowReadService.explorerTxUrl(txHash)
}
```

`txHash` is requested explicitly by `ui/specs/006-wallet-page/contracts/internal-api.md`
handoff item 6 — it is the one part of the wallet screen a sceptic can verify.

| Condition | Status | Notes |
| --- | --- | --- |
| Success | `200` | `settledFundsMinor` reads `0` afterwards; statement unchanged |
| Nothing settled | `409` | `{ message: 'No settled funds to withdraw' }` — **no transaction submitted** (gas is charged at the limit on Monad even for a no-op) |
| Settled-funds read fails | `502` | fail-fast here, unlike `GET /me` — see R9 |
| Transaction reverts | `502` | decoded reason |
| No receipt in 30 s | `502` | `{ message, txHash }` |

**The destination is never in the request.** It is `account.walletAddress` from the
session. A caller-supplied address would let anyone redirect anyone's payout.

---

## 5. `POST /offramp`

Unspent platform balance → funder wallet. **Debit first** (R7), inside a row-locked
transaction (R8).

**Request**:

```ts
{ amountMinor: number }   // positive safe integer, cents
```

**Partial cash-out is supported** — this answers the open question in
`ui/specs/006-wallet-page/` R7: the amount field stays editable, ceiling
`availableBalanceMinor`.

**`200` response** — the updated `AccountSummaryResponse` (§1).

| Condition | Status | Body |
| --- | --- | --- |
| Success | `200` | updated summary |
| Invalid amount | `400` | validation errors |
| Exceeds available balance | `409` | `{ message: 'Available balance is $X, cannot cash out $Y' }` — **no debit written** |
| Operator pool short of USDC | `409` | `{ message }` — no debit written |
| Transfer failed **definitely** after the debit | `502` | `{ message }` — compensating `adjustment` written, balance restored |
| Transfer outcome **unknown** after the debit | `502` | `{ message, txHash }` — **debit stands, no compensation** (R6) |

That last row is the most dangerous branch in the feature. Compensating an unknown
outcome that later confirms means the user cashed out *and* kept the balance, which breaks
`pool >= Σ ledger` in the unsafe direction.

Escrowed money cannot be cashed out this way — it is not part of
`availableBalanceMinor`, so the ceiling excludes it by construction.

---

## 6. `POST /onramp/routes` and `POST /offramp/routes` — stubs

**These make no Rain call.** They assemble the request body Rain would have received, log
it at `warn`, and return.

**Request**: `{ amountMinor: number }` (both). Validated the same way, so the logged
payload is realistic.

**`200` response**:

```ts
{
  stub: true,
  rainCallMade: false,
  reason: string,               // why: Monad is not a supported rail; RAIN_ENABLED value
  wouldHaveSent: {
    method: 'POST',
    url: string,                // RAIN_BASE_URL + path
    body: Record<string, unknown>
  },
  depositAddress?: string       // POST /offramp/routes ONLY — the funder address
}
```

`stub` and `rainCallMade` are the first two keys so the shape is unmistakable at a glance
in a terminal. There is no `id`, `status`, or `routeId` field — nothing that could be
skimmed as a Rain success.

**`200`, not an error status.** "Never fake a `200 OK`" governs the body; the object of
that rule is the fake success payload. A `4xx`/`5xx` would report a working endpoint as
broken. No screen calls these — they exist so the demo can show the exact call that
cannot complete, and why.

**Never logged**: `RAIN_API_KEY` (a header, not a body field), private keys, session
tokens. FR-035 holds by construction — the logged object is the body, and the body has no
secret in it.

---

## 7. Errors — one shape

Every refusal carries a human-readable `message`.
`ui/specs/006-wallet-page/contracts/internal-api.md` handoff item 8: *"each is shown
verbatim to the person, so the wording is the backend's to get right."*

```ts
{ statusCode: number, message: string, error?: string }
```

Validation failures keep the existing `ZodValidationPipe` shape:
`{ message: 'Validation failed', errors: { formErrors, fieldErrors } }`.

**Amounts in messages are formatted as dollars** (`$12.34`), not raw cents — the message
is read by a person mid-demo, and "cannot cash out 1234" invites the wrong reading.

**Chain-failure messages must not leak** private keys, RPC URLs, or raw viem stack text.
`decodeRevert` already produces named, safe messages; pass those through and log the raw
error.

---

## 8. Status code summary

| Code | Means | Used by |
| --- | --- | --- |
| `200` | done, or a stub that honestly did nothing | all |
| `400` | malformed amount | `/topup`, `/offramp`, both `/routes` |
| `401` | no/expired/invalid session | all |
| `409` | preconditions unmet — nothing was attempted | `/topup`, `/withdraw`, `/offramp` |
| `502` | the chain leg failed or is unknown | `/topup`, `/withdraw`, `/offramp` |
| `500` | Postgres or a bug | any |

`409` over `422`: every case is a *state* conflict (not enough funds, nothing settled),
not a malformed payload. The distinction is load-bearing for the UI — `409` is retryable
after the user changes something, `400` means the request was never valid.
