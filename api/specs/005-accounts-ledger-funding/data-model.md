# Data Model: Accounts, Ledger & Funding

**Feature**: `005-accounts-ledger-funding` · **Date**: 2026-08-09

**No migration.** Every table, column, index and enum this feature needs was created by
API-02's `1786238842921-InitialSchema`. This feature is the first thing that writes
`ledger_entries` rows and the first thing that reads them per-account. If a task in
`tasks.md` proposes a migration, something has been misread.

---

## 1. Tables touched

| Table | This feature | Owner |
| --- | --- | --- |
| `accounts` | read; row-locked during cash-out (R8) | `accounts` (API-04) |
| `ledger_entries` | **read + insert** — the only writer in the codebase so far | `ledger` |
| `orders` | read only, `SUM(price_minor)` by state | `orders` (API-06 extends) |

Nothing is updated. Nothing is deleted. `ledger_entries` is append-only (invariant #4) and
this feature's only correction path is a new `adjustment` row.

---

## 2. `ledger_entries` — the four kinds, and which this feature writes

`LedgerKind` (`src/entities/enums.ts`) has four members. This feature writes three of
them and never the fourth.

| Kind | Sign | Written by | `order_id` | `external_ref` |
| --- | --- | --- | --- | --- |
| `onramp` | **+** | `POST /topup` | `null` | transfer tx hash |
| `offramp` | **−** | `POST /offramp` | `null` | **always `null`** — see below |
| `adjustment` | ± | cash-out compensation (R6/R7); by hand | `null` | the failed tx hash, when there is one |
| `purchase` | − | **API-06, not here** | the order | `null` |

There is deliberately **no `settlement` kind**, and `enums.ts` says so in a comment.
Settled funds land on-chain under the user's own address and cannot be recaptured, so
settlement — and therefore `POST /withdraw` — writes nothing at all (invariant #5,
FR-022).

**`external_ref` carries the transaction hash on `onramp`, and is always `null` on
`offramp`.** The asymmetry is forced by the write-order rule and is not an oversight.

A top-up transfers *before* it credits, so the hash exists when the row is written — which
is what makes "a top-up moves real test USDC and the ledger reflects it" checkable rather
than asserted. A cash-out debits *before* it transfers, so when the `offramp` row is
written the transaction has not been broadcast and there is no hash to store. The ledger
is append-only (invariant #4), so it cannot be added later.

The two alternatives are both worse: updating the written row breaks append-only, and
transferring before debiting breaks `pool >= Σ ledger` in the unsafe direction. The hash
reaches the caller in the response and the log instead. **Verified on a live run** — see
the ledger dump in the implementation notes: `onramp` rows carry `0x…`, `offramp` rows
carry `NULL`.

### The compensation row

Written only on a **definite** cash-out transfer failure (R6):

```
kind          = adjustment
amount_minor  = +<the amount of the debit that is being reversed>
external_ref  = the failed transaction hash, or null if nothing was broadcast
```

The original debit **stays**. Two rows, summing to zero, and a statement that shows what
was attempted — which is the whole reason the ledger is append-only.

---

## 3. Derived figures — three reads, three sources

None of these is stored. There is no balance column anywhere in the schema, deliberately
(invariant #4, and `database-schema.md` §3.1 records that `cached_balance_minor` was
dropped as "a whole class of drift bug for nothing").

### 3.1 `availableBalanceMinor` — exists already

`BalanceRepository.getAvailableBalanceMinor(accountId)`, unchanged from API-02:

```sql
SELECT COALESCE(SUM(amount_minor), 0) FROM ledger_entries WHERE account_id = $1
```

Returns `0`, never `null`, for an account with no entries. May be negative if the entries
say so — it reports, it does not judge.

### 3.2 `inEscrowMinor` — new, in `orders/`

```sql
SELECT COALESCE(SUM(price_minor), 0) FROM orders
WHERE buyer_account_id = $1
  AND state IN ('purchased','running','delivered','failed','disputed','adjudicated')
```

Six states, not eight. The exclusions are `released` and `settled`; the two easy mistakes
are dropping `failed` (money is still escrowed until the reclaimer sweeps) and dropping
`adjudicated` (invariant #8 writes the verdict *before* `resolve` confirms). Full walk of
the state machine in [research.md](./research.md) R3.

Covered by the existing `orders_buyer_idx ON (buyer_account_id, created_at)` for the
buyer predicate.

### 3.3 `settledFundsMinor` — new, from the chain, nullable

`EscrowReadService.balanceOfCents(account.walletAddress)` — already exists, already
returns cents, so no conversion happens outside `chain/` (invariant #2).

Wrapped in a 2 s `Promise.race`; every rejection and every timeout becomes `null`
(R1). **`null` means unknown and is always present in the JSON** — never omitted, never
`0` (R2).

---

## 4. The four places money can be, and which figure shows each

From `database-schema.md` §3.3, mapped onto this feature's output:

| Location | Figure | Source | Moves on |
| --- | --- | --- | --- |
| Platform balance | `availableBalanceMinor` | `ledger_entries` sum | top-up, purchase, cash-out |
| Escrow | `inEscrowMinor` | open orders sum | purchase, settlement |
| Settled | `settledFundsMinor` | chain `balances[]` | settlement, withdraw |
| Own wallet | — **shown by none of these** | the chain | withdraw |

The fourth row is the honest gap: once withdrawn, the money is in the user's wallet and
the platform stops tracking it. That is the design, not an omission.

**The consequence that looks like a bug**: a refund moves money from *escrow* to
*settled*, so `availableBalanceMinor` does not change. Act 3 of the demo ends this way
(`database-schema.md` §3.3). Against one collapsed number the refund would appear not to
have happened.

---

## 5. Entities and constants introduced

No new TypeORM entities. Five new non-entity artifacts:

| Artifact | Location | Purpose |
| --- | --- | --- |
| `ESCROWED_ORDER_STATES` | `src/orders/order-states.ts` | the six states in §3.2, as a typed tuple |
| `SETTLED_FUNDS_TIMEOUT_MS` | `src/accounts/accounts.constants.ts` | `2_000` (R1) |
| `amountMinorSchema` | `src/common/amount.schema.ts` | positive safe integer cents (R14) |
| `GAS_LIMITS.transfer` | `src/chain/chain.constants.ts` | `65_000n`, ESTIMATED (R4) |
| `FUNDER_CLIENT` | `src/chain/chain.tokens.ts` | fourth injection token (R5) |

---

## 6. Invariants this model must not break

| # | Invariant | How this feature holds it |
| --- | --- | --- |
| 1 | Two-phase order by direction | top-up transfers then credits; cash-out debits then transfers (R7) |
| 2 | One money unit — cents outside `chain/` | every figure and body field is cents; `balanceOfCents` and `toBaseUnits` are the only conversions, both inside `chain/` |
| 4 | Ledger is append-only | inserts only; corrections are `adjustment` rows |
| 5 | Settlement writes no ledger entry | `POST /withdraw` touches no table |
| — | `pool >= Σ ledger` | preserved at every intermediate point by R7's ordering; checkable by hand per quickstart §7 |
