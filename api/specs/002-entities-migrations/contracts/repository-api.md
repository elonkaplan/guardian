# Contract: Balance Repository

The only behavior this feature ships. Everything else is schema.

## `BalanceRepository`

Provided by `LedgerModule`, which exports it for API-05 to build on.

### `getAvailableBalanceMinor(accountId: string): Promise<number>`

The signed sum of an account's ledger entries, in **USD cents**.

```sql
SELECT COALESCE(SUM(amount_minor), 0) FROM ledger_entries WHERE account_id = $1
```

| Aspect | Contract |
| --- | --- |
| **Returns** | Whole cents as a `number`. Never a string, never `null`, never `undefined` |
| **Empty account** | **`0`** — not `null`. The `COALESCE` is part of the contract, not an optimisation: "this account has nothing" and "this account does not exist" are different facts, and only the first is true here |
| **Unknown account id** | Also `0`. This method answers a balance question, not an existence question — callers that need existence ask `accounts` |
| **Sign** | Credits positive, debits negative; the result is their arithmetic sum and may be negative if entries say so. This method does not judge, it sums |
| **Reads** | `ledger_entries` only. Never `orders`, never chain state |
| **Writes** | None, ever |

### What it deliberately does not do

- **No caching.** Recomputed per call. At demo scale the sum is free, and a cache is a
  class of drift bug bought for nothing.
- **No "in escrow" figure.** That is `SUM(price_minor)` over the buyer's unsettled
  orders — a different question against a different table, and it belongs to whichever
  feature first needs to display it.
- **No settled-funds figure.** Settled money is on-chain under the user's own address
  and is not represented in the ledger at all.
- **No spend authorisation.** Whether a balance is *sufficient* for a purchase is a
  decision for the purchase saga, not for the thing that reports a number.

### Numeric note

`SUM(bigint)` returns `numeric`, which the driver hands back as a **string**. The
repository converts once, at this boundary. Cents in a JavaScript `number` are exact
to about $90 trillion — see [research.md R1](../research.md).

## Index support

Served by `ledger_account_idx ON ledger_entries (account_id, created_at)`, which also
serves statement-style reads in time order.
