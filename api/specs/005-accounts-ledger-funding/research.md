# Research: Accounts, Ledger & Funding

**Feature**: `005-accounts-ledger-funding` · **Date**: 2026-08-09

Fifteen decisions. The ones that carry real risk are **R1** (the hot endpoint's chain
read), **R6** (which error must *not* trigger compensation), **R4** (a gas ceiling on a
chain that charges the limit), and **R13** (the field names, written out).

---

## R1 — `settledFundsMinor` is bounded by a `Promise.race`, not by transport config

**Decision**: `AccountsService` wraps `EscrowReadService.balanceOfCents(address)` in
`Promise.race` against a 2000 ms timer, catching every rejection and returning `null`.
The budget lives in `src/accounts/accounts.constants.ts` as
`SETTLED_FUNDS_TIMEOUT_MS = 2_000`.

**Rationale**: viem's `http` transport defaults to `timeout: 10_000` **and**
`retryCount: 3` with exponential backoff. Against a black-holed RPC host — a host that
accepts the connection and never answers, which is what flaky conference wifi actually
produces — that is up to four attempts of ten seconds each before the promise settles.
`GET /me` is polled every 5 s by a widget on every page, so a transport-level failure
would stack requests faster than they drain, and the balance widget would freeze
everywhere. The 2 s budget is enforced on our side of the call, where it cannot be
lengthened by a retry policy set three files away.

2000 ms specifically: Monad blocks are ~300 ms and a healthy `eth_call` round trip is
tens of milliseconds, so 2 s is ~50× the happy path — it fires on a genuinely broken
read, not a slow one. It is also under half the 5 s poll interval, so a timing-out read
never overlaps its own next request.

**What this does not do**: `Promise.race` does not cancel the losing promise. A timed-out
read stays pending inside viem until its own transport timeout expires, holding a socket.
Bounded and acceptable — at one poll per 5 s per client, the worst case is a handful of
abandoned sockets that all expire within 10 s. Fixing it properly means threading an
`AbortSignal` through `readContract`, which viem does not expose on the contract-read
path in 2.55.11. Recorded so nobody rediscovers it as a leak.

**Alternatives considered**: A shorter transport timeout on `PUBLIC_CLIENT` — rejected,
it is shared with the purchase saga and the sweeper, where a 2 s ceiling on a receipt
wait would break `executeWrite` (which budgets 30 s, `RECEIPT_TIMEOUT_MS`). A second
public client just for `/me` — rejected as a whole viem client for one call; the race is
three lines. Caching the settled figure for a few seconds — rejected for the MVP: it adds
a staleness question to a number the user checks *after* clicking Withdraw.

---

## R2 — `null` is always present in the JSON, never an omitted key

**Decision**: the response type is `settledFundsMinor: number | null`, and the service
returns an explicit `null`. Never `undefined`, never an optional property.

**Rationale**: `JSON.stringify` **drops** keys whose value is `undefined`. A handler
returning `{ settledFundsMinor: undefined }` sends a body with no such key at all — which
is a different wire contract from the one the UI was built against, and the difference is
invisible in TypeScript unless the property is typed as non-optional.

`ui/specs/006-wallet-page/research.md` R2 rejected the optional form deliberately, for
the reason that matters here: *"optionality invites `?? 0` and reads as 'sometimes we
don't bother', when the truth is 'sometimes it cannot be known'."* The UI renders `null`
as `—` and disables Withdraw; it must never render `$0.00`, because zero settled funds
and an unreadable chain are different facts and only one of them means "nothing to
withdraw".

**Alternatives considered**: omitting the key on failure — rejected, see above. A
discriminated union — rejected upstream in UI-06 as ceremony for a two-state value.

---

## R3 — "In escrow" is a live `SUM` over six order states

**Decision**: `inEscrowMinor` is `COALESCE(SUM(price_minor), 0)` over the caller's orders
whose `state` is in:

```
purchased · running · delivered · failed · disputed · adjudicated
```

Excluded: `released`, `settled`. Constant: `ESCROWED_ORDER_STATES` in
`src/orders/order-states.ts`.

**Rationale**: the question the figure answers is *"how much of this buyer's money is
locked in the escrow contract right now"*, so the boundary is the on-chain settlement,
not the product's sense of doneness. Walking the state machine
(`src/entities/enums.ts`):

| State | Money is | Counted |
| --- | --- | --- |
| `purchased` | captured into escrow (or about to be — see below) | ✅ |
| `running` | in escrow, agent executing | ✅ |
| `delivered` | in escrow, review window open | ✅ |
| `failed` | **in escrow** — nothing was produced, nothing was reclaimed yet | ✅ |
| `disputed` | in escrow, frozen pending arbitration | ✅ |
| `adjudicated` | **in escrow** — invariant #8 persists the verdict *before* the chain call, so `resolve` may not have landed | ✅ |
| `released` | paid out to `balances[]` on-chain | ❌ |
| `settled` | paid out to `balances[]` on-chain | ❌ |

Two are easy to get wrong. `failed` looks terminal and is not — the money sits in escrow
until the reclaimer sweeps it, and omitting it makes a buyer's money vanish from every
figure at once. `adjudicated` is the invariant-#8 window: the verdict row exists, the
`resolve` transaction may not have confirmed, and the tokens are still escrowed.

**Counted by state, not by `onchain_deal_id`.** An order can exist with a `purchase`
ledger debit and `onchain_deal_id IS NULL` — that is exactly what invariant #1's
Postgres-first ordering produces mid-saga. That money has already left the spendable
balance, so it must appear somewhere; escrow is where it is going and the only honest
place to show it. Filtering on a confirmed deal id would make it disappear from both
figures for the width of the saga.

**Alternatives considered**: reading `deals[].amount` per order from the chain — rejected,
it puts N RPC calls on the hot endpoint and re-introduces the failure mode R1 exists to
avoid, for a number Postgres already knows. `totalEscrowed()` from the contract — that is
the platform-wide total, not per-buyer; wrong number.

---

## R4 — ERC-20 `transfer` needs an ABI entry and a gas ceiling

**Decision**: add `transfer` to `src/chain/abi/erc20.abi.ts`, and a `transfer` entry to
`GAS_LIMITS` in `src/chain/chain.constants.ts`. **Seed it at `65_000n` and replace it
with a `measureGas()` reading before the first top-up runs** — not after a rehearsal.

**Rationale**: neither funding transfer touches the escrow contract. Top-up is
`USDC.transfer(operator, amount)` signed by the funder; cash-out is
`USDC.transfer(funder, amount)` signed by the operator. `erc20Abi` currently carries
`allowance`, `approve`, `balanceOf`, `decimals` and two error entries — no `transfer`, so
neither call is expressible today. `executeWrite` types `functionName` against the ABI's
literal type, so this is a compile error rather than a runtime surprise.

The ceiling matters more than it looks, because **Monad charges the gas limit, not the
usage** (`chain.constants.ts`). Sizing:

```
21,000  base transaction
20,000  recipient balance SSTORE, cold zero → non-zero (worst case)
 2,900  sender balance SSTORE, warm non-zero → non-zero
 1,750  Transfer event (2 topics + 32 bytes)
 ~2,000 OZ ERC20 dispatch, checks, overhead
-------
~47,650 worst case  ×1.36 → 65,000
```

The steady state is the warm case (~35,000) — both the funder and the operator already
hold USDC, so the recipient slot is non-zero on every transfer after the first. 65,000
covers the cold first transfer to a fresh address without over-paying much on the warm
path.

**But do not ship the estimate.** `measureGas()` in `src/chain/execute-write.ts` wraps
`eth_estimateGas`, which is free and needs no transaction — it is how API-03 right-sized
`updateAgent`, `setAgentActive` and `approve` (tasks T045). Unlike the four ceilings still
marked ESTIMATED in that table, `transfer` needs **no special chain state to measure**: any
funder-to-operator transfer of any amount can be estimated at any time. There is no reason
for this entry to stay a guess, and one strong reason not to let it — `approve`'s old
80,000 ceiling cleared its measured value by only 1.13× and would likely have failed on a
fresh deployment, and `openDeal`'s pre-deployment estimate of 400,000 sat *below* the
measured 408,072, which would have made every purchase in the product revert out-of-gas
while looking fine in review. Reasoning from storage costs has now been wrong twice in
this table.

Measure both directions (funder→operator and operator→funder, cold and warm recipient),
take the maximum, apply ~1.3×, and record it as MEASURED with the figure — matching the
comment convention already in that file.

**One entry, not two.** Both directions are the same call with the same cost. The
direction is already recoverable from `InsufficientFundsError.address` (which names the
short signer) and from the calling service method, so a second identical-valued entry
would only be a thing that drifts.

**Alternatives considered**: routing funding through the escrow contract — rejected, the
escrow has no such function and adding one is an `sc/` redeploy. `transferFrom` with an
allowance — rejected, it needs an approval step and a second transaction for no benefit
when the sender is the signer.

---

## R5 — A fourth viem client for the funder, with `nonceManager`

**Decision**: add `FUNDER_CLIENT` to `chain.tokens.ts` and
`src/chain/clients/funder.client.ts`, built exactly like the operator's — including
`privateKeyToAccount(..., { nonceManager })`. Provided by `ChainModule`, **not exported**,
consistent with the existing three.

**Rationale**: the top-up transfer moves the funder's own tokens, so the funder must
sign it. `FUNDER_PRIVATE_KEY` and `FUNDER_ADDRESS` are already in `env.schema.ts` — the
schema anticipated this; only the client is missing.

`nonceManager` for the same reason the operator has it, and it is newly load-bearing
here: two users clicking "Add funds" at once are two independent writes from one key, and
viem's default fetches the pending nonce per write, so both would fetch the same nonce
and the second would silently replace the first in the mempool. One top-up disappears and
the user is short with no error anywhere. A demo with two laptops is exactly this
scenario.

Worth noting the operator key now has a **third** writer — purchase saga, sweeper cron,
and cash-out. Its existing `nonceManager` already covers this; no change needed, but the
comment in `operator.client.ts` naming two senders is now out of date.

**Alternatives considered**: reusing `OPERATOR_CLIENT` and pre-funding the pool by hand —
rejected, it deletes the funder wallet as the "outside world" and with it the health
signal that the wallet's balance should fall on top-ups and rise on cash-outs. Exporting
the client for the funding module to use directly — rejected, it is the exact hole
`chain.tokens.ts` documents: a consumer holding a raw `WalletClient` can name any function
on any ABI.

---

## R6 — `ChainOutcomeUnknownError` must **not** trigger the cash-out compensation

**Decision**: the cash-out compensating entry (FR-028) is written **only** for errors that
prove the transfer did not happen — `ContractRevertError`, `InsufficientFundsError`,
`InsufficientAllowanceError`, `UnitConversionError`, and `ChainConnectivityError`. On
`ChainOutcomeUnknownError` the debit **stands**, the transaction hash is logged at
`error`, and the caller is told the outcome is unknown.

**Rationale**: this is the single most dangerous branch in the feature, and the existing
error hierarchy was built to make it expressible. `ChainOutcomeUnknownError` means the
transfer was **broadcast** but no receipt arrived within 30 s. It may still confirm.

| | Compensate | Do not compensate |
| --- | --- | --- |
| **Transfer later confirms** | 🔴 Tokens left the pool **and** the balance was restored — the user cashed out and kept the money. Solvency breaks in the unsafe direction. | ✅ Correct. |
| **Transfer never confirms** | ✅ Correct. | ⚠️ User is short by the amount. Pool holds more than the ledger claims — the **safe** direction, fixable by hand with an `adjustment`. |

The two wrong outcomes are not symmetric. Compensating wrongly creates money and breaks
`pool >= Σ ledger`, which is the invariant everything else rests on. Not compensating
wrongly leaves a user short in the direction the system is designed to tolerate, visible
in the statement, and correctable with the `adjustment` kind that exists for exactly this.

This is the reasoning `src/chain/errors.ts` already spells out for `openDeal` ("do not
'fix' this hierarchy later by moving this class under a failure supertype"). The same
class, the same trap, a different flow — so `catch (e) { if (e instanceof ChainError) }`
is **not** sufficient here; the handler must check `ChainOutcomeUnknownError` first.

Same rule on the top-up side, pointing the other way: an unknown-outcome top-up transfer
writes **no** credit (R7), because crediting a transfer that never lands promises money
the pool does not hold.

---

## R7 — Ordering per flow, from the direction rule

**Decision**:

| Flow | First | Second | On failure of the second |
| --- | --- | --- | --- |
| **Top-up** | chain transfer (funder → pool) | ledger credit | log at `error` with the tx hash; replay by hand as an `adjustment` |
| **Cash-out** | ledger debit | chain transfer (pool → funder) | compensating `adjustment` — unless the outcome is unknown (R6) |
| **Withdraw** | — | `withdrawFor` | nothing to undo; no ledger entry exists |

**Rationale**: `docs/database-schema.md` §3.3 and `api/docs/CONTEXT.md` invariant #1
state the rule directly — the solvency relationship is `>=`, so a crash between the halves
must leave the pool holding *more* than the ledger claims, and **whichever write increases
what we owe goes second**. Top-up increases the ledger, so the transfer goes first;
cash-out decreases it, so the debit goes first. "Postgres first, chain second" is the
shorthand for the second case only and must not be pattern-matched onto the first.

The top-up failure branch is deliberately *not* automated. Having confirmed a transfer and
failed to write one row, the correct move is a loud log carrying the hash, not a retry loop
that might double-credit. `LedgerKind.Adjustment` exists because "at a hackathon something
*will* need correcting by hand" (`enums.ts`).

**Withdraw writes nothing**, per invariant #5 — settled funds have no database
representation, so there is no state to compensate and the flow is single-phase.

---

## R8 — Cash-out serialises on a row lock over the account

**Decision**: `POST /offramp` runs its balance check and debit inside one transaction that
first takes `SELECT … FOR UPDATE` on the caller's `accounts` row (TypeORM:
`setLock('pessimistic_write')`), then sums the ledger, then inserts the debit.

**Rationale**: FR-026 requires that concurrent cash-outs cannot draw an account below
zero. Check-then-insert without a lock is a textbook race: two requests both read a $100
balance and both insert a $100 debit, and the ledger sums to −$100 with $200 of tokens
gone. There is no balance column to constrain, by design (invariant #4), so a `CHECK` is
not available — the constraint is over an aggregate, which Postgres cannot express
declaratively.

Locking the `accounts` row rather than the ledger rows is what makes this work: the
entries being counted do not exist yet, so there is nothing in `ledger_entries` for a lock
to cover. The account row is the natural serialisation point, it is already loaded on
every request by the auth guard, and contention is per-account — two different users never
block each other.

**Alternatives considered**: `SERIALIZABLE` isolation — correct, but it turns the race into
a retryable serialisation failure the caller must handle, and it applies to the whole
transaction rather than the one place that needs it. Postgres advisory locks — equivalent,
but keyed by a hashed uuid rather than by the row the lock actually protects, so the
relationship is invisible to the next reader. An in-process mutex — wrong layer; it does
not survive a second instance and would read as sufficient when it is not.

Top-up needs none of this: it only ever increases a balance, and concurrent credits cannot
conflict.

---

## R9 — Withdraw reads the settled balance first, and that read is *not* best-effort

**Decision**: `POST /withdraw` calls `balanceOfCents(address)` before submitting. Zero →
`409` with a clear message and no transaction. A failed read → the request fails with the
chain error.

**Rationale**: FR-023 forbids submitting a transaction when there is nothing to withdraw,
and on Monad that is money — the gas **limit** is charged whether or not the call does
anything, so a no-op `withdrawFor` costs the full 140,000 ceiling every time. The read
also supplies the amount reported back to the caller, which the UI shows on the receipt.

**The contrast with R1 is the point.** The same read is best-effort on `GET /me` and
fail-fast here, and that is not an inconsistency. On `/me` the read is one of three
figures on a widget polled every 5 s, and a dash costs nothing. On `/withdraw` the read is
a **precondition for spending money** — proceeding without it means submitting a paid
transaction on a guess. Best-effort is a property of the call site, not of the method.

A pre-read is not a lock: a settlement landing between the read and the transaction makes
the reported amount slightly stale. Harmless — `withdrawFor` moves whatever the balance is
at execution time, so the money is right even when the receipt's number is a moment old.

---

## R10 — The Rain stubs answer `200` with a body that cannot be mistaken for Rain

**Decision**: both route endpoints return HTTP `200` with

```jsonc
{
  "stub": true,
  "rainCallMade": false,
  "reason": "Monad is not a supported payment-route rail; RAIN_ENABLED=false",
  "wouldHaveSent": { "method": "POST", "url": "…", "body": { … } },
  "depositAddress": "0x…"   // offramp route only
}
```

and log the full would-be request at `warn` via `Logger.warn`.

**Rationale**: the spec's Assumptions settled this — "never fake a `200 OK`" governs the
**body**, not the status line, and the object of that sentence is the fake success. A
non-2xx would misrepresent a working endpoint as broken, and
`ui/specs/006-wallet-page/contracts/internal-api.md` confirms no screen calls these at
all, so there is no client to mislead either way. `stub: true` and `rainCallMade: false`
are the first two keys so the shape is unmistakable in a terminal, and there is no
`id`/`status`/`routeId` field that could be mistaken for a Rain response.

`RAIN_ENABLED` is read and reported but does not branch: the live path is not written, so
a `true` value would otherwise silently change nothing. The stub logs the flag's value in
its reason string, which makes the config visible rather than decorative.

**Secrets**: `RAIN_API_KEY` is a header, never a body field, and the logged payload is
built from the body only. FR-035 is satisfied by construction rather than by a redaction
pass — there is no key in the object being logged.

---

## R11 — A minimal `OrdersModule` owns the escrow read

**Decision**: create `src/orders/` with `orders.module.ts` and
`escrow-exposure.repository.ts` (one method, `sumOpenOrderValueMinor(accountId)`), plus
`order-states.ts`. API-06 extends this module; it does not move it.

**Rationale**: `docs/CONTEXT.md` §3 assigns orders to `orders`. Putting an order query in
`accounts/` would state something untrue about ownership and would be moved by API-06 with
every import rewritten. This is the house pattern, twice precedented: API-02 created
`LedgerModule` with exactly one read for this feature to build on, and `AccountsModule`
with one repository, both with module docblocks explaining that a whole module for one
class is the ownership boundary rather than ceremony.

**Alternatives considered**: `AccountsModule` importing `Order` directly via
`TypeOrmModule.forFeature([Order])` — technically works, and is the thing that looks
cheapest today and is wrong in three weeks.

---

## R12 — The statement is the whole list, ordered newest-first

**Decision**: `GET /me/ledger` returns every entry for the caller, `ORDER BY created_at
DESC, id DESC`. No pagination, no filtering.

**Rationale**: pagination is explicitly out of scope (`docs/CONTEXT.md` §6). At demo scale
an account has tens of entries. Newest-first is what a statement is; the `id DESC`
tiebreak matters because `created_at` is `timestamptz` and a top-up's credit can share a
millisecond with nothing else — but two hand-made `adjustment` rows inserted in one
transaction genuinely can collide, and an unstable order there would make the list
reshuffle between polls. The UI refetches this list after every mutation
(`ui/specs/006-wallet-page/data-model.md` §4), so stability across refetches is visible.

The existing index `ledger_account_idx ON (account_id, created_at)` covers this query.

---

## R13 — The field names, written out

**Decision**: the response bodies use exactly these strings. No abbreviation, no
`balance`, no `escrow`, no `settled`.

```ts
// GET /me
{
  accountId: string;
  address: string;              // EIP-55 checksummed, as stored
  availableBalanceMinor: number;      // cents, never null
  inEscrowMinor: number;              // cents, never null
  settledFundsMinor: number | null;   // cents, null = unknown (R1, R2)
}
```

**Rationale**: a constraint without the literal string does not prevent the bug it names.
`RawCitation.clause` shipped wrong with a perfectly good rule attached, because nobody
wrote `quote` at the place an implementer would type it (`67dcf4d`) — and the failure mode
is the quiet one: a mismatched key renders as an absent value, not an error.

These are not a proposal. `ui/specs/006-wallet-page/data-model.md` already declares the
consuming type with these names and `settledFundsMinor: Cents | null`, and
`ui/specs/001-ui-foundation/contracts/internal-api.md` marked the first two "provisional,
pending API-01" — this plan is what makes them final. UI-06's quickstart F6 tests exactly
this: rename the field in the API response and the page must show `—`, not `$0.00`.

`address` is the checksummed form straight off the entity — `AccountRepository` guarantees
it is `getAddress()` output, and it is the payout destination, so it must not be
lower-cased on the way out.

---

## R14 — Amounts are validated as positive safe integers at the HTTP boundary

**Decision**: one shared Zod schema, `amountMinorSchema`, in
`src/common/amount.schema.ts`:

```ts
z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
```

applied via the existing `ZodValidationPipe` on `POST /topup` and `POST /offramp`.

**Rationale**: `toBaseUnits` already throws `UnitConversionError` on a non-integer,
negative, or unsafe value — but that is a 500-shaped failure deep in `chain/`, reached
after a database read and possibly after a ledger write. Rejecting at the boundary turns
the same three cases into a `400` with a field-level message before anything happens,
which is the reasoning `zod-validation.pipe.ts` gives for validating pre-handler
("no challenge row written, no nonce minted"). The `units.ts` guards stay as the
backstop they were designed to be; this is not a substitute for them.

`.positive()` rather than `.nonnegative()`: a zero-amount top-up would burn gas to move
nothing, and a zero cash-out would write a meaningless ledger row.

**No minimum or maximum beyond the safe-integer bound.** The real ceiling is what the
funder wallet holds, checked against the chain in R15, and a hardcoded cap is a thing that
gets hit on stage during a demo of larger numbers than rehearsal used.

---

## R15 — Preconditions are checked against the chain before the transfer

**Decision**: top-up reads `USDC.balanceOf(funder)` and refuses with `409` and a message
naming the shortfall if it is below the requested amount. Cash-out does the same against
`USDC.balanceOf(operator)`. Both are free `eth_call`s. Additionally,
`ChainPreflightService` gains a sixth check reporting the funder's USDC and MON balances
at boot.

**Rationale**: FR-018 requires the shortfall to be named. Without the pre-read, an
underfunded funder surfaces as `ERC20InsufficientBalance` decoded through
`decodeRevert` — accurate but arriving as a chain error, after a transaction was
attempted, on a chain that charges the limit for a revert. A free read turns it into a
clear refusal that costs nothing.

The boot check exists because the funder wallet is the health signal
(`docs/rain-integration.md` §0.3) and because the same doc warns that **three** wallets
need MON for gas and "easy to forget the guardian one" — the funder is now a fourth signer
and inherits the same trap. The preflight warns and never throws, matching the existing
convention in that file.

The operator-side check for cash-out is the same read against a different address, and it
is genuinely independent of the escrow allowance `ensureAllowance` manages — that
allowance governs what the escrow may pull, and says nothing about what the operator
holds.
