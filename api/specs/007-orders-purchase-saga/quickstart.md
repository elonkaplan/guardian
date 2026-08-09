# Quickstart: Orders & the purchase saga

**Feature**: `007-orders-purchase-saga` · **Spec**: [spec.md](./spec.md) · **Contracts**: [contracts/internal-api.md](./contracts/internal-api.md)

This is the test suite. Automated tests are out of scope for `api/` (`docs/CONTEXT.md`), so
every acceptance criterion in the spec is verified here, by hand, and a failed run is a red
build.

**Five checks are load-bearing and must never be skipped**: §3 (a purchase escrows the
money), §4 (a forced chain failure leaves the buyer whole), §5 (two purchases cannot spend
one balance), §7 (the seller can open a sale they did not buy), and §8 (no prompt escapes).
The first four correspond to the source brief's acceptance criteria; the fifth is the
invariant this feature extends.

**§4 and §5 cannot be reached by using the product normally.** They have to be forced, and
they are the two defects in this feature that a rehearsal would not otherwise surface.

---

## 0. Prerequisites

```bash
docker compose up -d
npm run migration:run          # includes the new orders.input migration
npm run start:dev
```

```bash
export API=http://localhost:3000

export BUYER=<token for wallet A>
export SELLER=<token for wallet B>     # must own the agent — a different account
export STRANGER=<token for wallet C>   # party to neither side
```

All three wallets must have signed in once so their accounts exist. The buyer must be
funded — `POST /topup` — and a seller agent must be listed and active (006 quickstart §1).

```bash
export AGENT=<agent uuid from GET /agents>
```

**Set the review window long enough to act inside it**, or the sweeper releases every order
before you can accept or complain:

```bash
# .env — restart after changing
REVIEW_WINDOW_SECONDS=300
```

---

## 1. The zero-window guard (FR-014, [R6](./research.md))

Before anything else, prove the guard exists. Set `REVIEW_WINDOW_SECONDS=0` and restart.

| # | Check | Pass |
| --- | --- | --- |
| Z1 | The process | **refuses to start**, naming `REVIEW_WINDOW_SECONDS` |
| Z2 | The message | says an integer ≥ 1 was expected |

A zero window means the complaint button never works and every order auto-releases
instantly, with no error anywhere. If the process starts, stop and fix it — every demo act
dies on stage and nothing tells you why. Restore `300` and restart.

---

## 2. Record the starting figures

```bash
curl -s $API/me -H "Authorization: Bearer $BUYER" | tee /tmp/before.json
```

Note `availableBalanceMinor` and `inEscrowMinor`. Every money check below is a comparison
against these two numbers.

---

## 3. ⚠️ A purchase completes and the escrow holds the money (US1, FR-001…FR-016)

```bash
curl -s -X POST $API/orders \
  -H "Authorization: Bearer $BUYER" -H 'Content-Type: application/json' -d "{
  \"agentId\": \"$AGENT\",
  \"input\": {\"receiptText\": \"Coffee 3.50\\nPastry 2.25\"},
  \"acceptanceCriteria\": \"Every line item with its amount, and a correct total.\"
}" | tee /tmp/order.json

export ORDER=$(jq -r .id /tmp/order.json)
```

| # | Check | Pass |
| --- | --- | --- |
| P1 | Status | `201` |
| P2 | Body | `{ "id": "<uuid>" }` and nothing the client needs |
| P3 | Wall-clock | seconds, not milliseconds — it waited for a receipt |
| P4 | `GET /orders/$ORDER` → `state` | `purchased` |
| P5 | `GET /me` → `availableBalanceMinor` | fell by **exactly** the agent's price |
| P6 | `GET /me` → `inEscrowMinor` | rose by **exactly** the same amount |
| P7 | `GET /me/ledger` | one new entry: `kind: "purchase"`, negative, `orderId` set |
| P8 | Response returned before the agent finished | yes — nothing runs yet (API-08 unbuilt), so `run` is `null` |

Then check the row directly — the deal id is the whole point of P3:

```sql
SELECT state, onchain_deal_id, price_minor, review_window_seconds, input
FROM orders WHERE id = '<ORDER>';
```

| # | Check | Pass |
| --- | --- | --- |
| P9 | `onchain_deal_id` | **not null** — if null, the saga answered before the receipt |
| P10 | `price_minor` | equals the version's price at purchase, as a snapshot |
| P11 | `review_window_seconds` | `300` — the snapshot, not read live |
| P12 | `input` | the document you sent. **This column is new** ([R5](./research.md)) — if it does not exist, the migration did not run |

And on-chain:

| # | Check | Pass |
| --- | --- | --- |
| P13 | `totalEscrowed()` | rose by the price, converted to base units |

### The snapshot holds when the seller republishes

Publish a new version of the agent at a different price (006 quickstart §5), then re-read
the order.

| # | Check | Pass |
| --- | --- | --- |
| P14 | `priceMinor` on the order | **unchanged** |
| P15 | `GET /orders/$ORDER/case-file` → `capabilities` | the **old** version's, not the new one (FR-039) |

---

## 4. ⚠️ A forced chain failure leaves the buyer whole (US2, FR-017…FR-022)

**This is the check that cannot be reached by using the product.** Force `openDeal` to fail
cleanly — the cheapest way is to point `MONAD_RPC_URL` at a dead port so the call fails fast
and *knowably*, and restart.

```bash
curl -s $API/me -H "Authorization: Bearer $BUYER" | tee /tmp/before-fail.json

curl -s -i -X POST $API/orders \
  -H "Authorization: Bearer $BUYER" -H 'Content-Type: application/json' -d "{
  \"agentId\": \"$AGENT\",
  \"input\": {\"receiptText\": \"x\"},
  \"acceptanceCriteria\": \"anything\"
}"

curl -s $API/me -H "Authorization: Bearer $BUYER" | tee /tmp/after-fail.json
```

| # | Check | Pass |
| --- | --- | --- |
| F1 | Status | `502`, saying the purchase did not complete |
| F2 | `availableBalanceMinor` | **byte-identical** to `/tmp/before-fail.json` — SC-002 |
| F3 | `inEscrowMinor` | **also unchanged** — the failed order contributes nothing (FR-020, [R14](./research.md)) |
| F4 | `GET /me/ledger` | **two** new entries: the `purchase` debit **and** an `adjustment` credit of the same magnitude, both carrying the order id |
| F5 | The debit | still present — the history is corrected, never rewritten (FR-019) |
| F6 | The order row | `state = 'failed'`, `onchain_deal_id IS NULL` |
| F7 | `GET /orders` | the failed order **is listed** — a buyer sees what happened |
| F8 | `POST /orders/<id>/accept` and `/complain` | both refused — nothing is escrowed to settle |

**F3 is the check most likely to fail on a first implementation.** `failed` is in
`ESCROWED_ORDER_STATES` and belongs there — a *run* that produced nothing still has money in
escrow. Only `failed` **with a NULL deal id** is excluded. If F3 shows the money still in
escrow, the buyer is seeing the same cents in two figures at once.

Restore `MONAD_RPC_URL` and restart.

### The unknown-outcome branch ([R3](./research.md))

Harder to force — it needs a broadcast transaction whose receipt does not arrive within
`RECEIPT_TIMEOUT_MS`. If you can produce one (throttle the RPC, or drop `RECEIPT_TIMEOUT_MS`
to `1`):

| # | Check | Pass |
| --- | --- | --- |
| U1 | Status | `502` — the same answer as F1 |
| U2 | The order row | `state = 'purchased'`, deal id NULL — **not** `failed` |
| U3 | Ledger | the debit only. **No compensating credit** |
| U4 | `inEscrowMinor` | **still includes** this order — the money may genuinely be escrowed |
| U5 | Logs | one `error` line carrying the tx hash |

**U3 is the one that matters.** Compensating here restores a balance whose money may be
locked on-chain, which breaks `pool >= Σ ledger` in the direction no later row can fix. If a
credit appears, the implementation is treating an unknown outcome as a failure.

---

## 5. ⚠️ Two purchases cannot spend one balance (FR-008, SC-003)

Top the buyer up to **exactly** one agent price, then fire two purchases at once:

```bash
for i in 1 2; do
  curl -s -o /tmp/race-$i.json -w "%{http_code}\n" -X POST $API/orders \
    -H "Authorization: Bearer $BUYER" -H 'Content-Type: application/json' -d "{
    \"agentId\": \"$AGENT\",
    \"input\": {\"receiptText\": \"race\"},
    \"acceptanceCriteria\": \"anything\"
  }" &
done; wait
```

| # | Check | Pass |
| --- | --- | --- |
| R1 | Statuses | exactly one `201` and one `402` |
| R2 | `SELECT COUNT(*) FROM orders` | rose by **one** |
| R3 | `SELECT SUM(amount_minor) FROM ledger_entries WHERE account_id = <buyer>` | **≥ 0**, never negative |
| R4 | `availableBalanceMinor` | `0`, not a negative number |

A negative balance here means the check and the debit were not in one transaction, and the
same money has been spent twice. Re-fund the buyer before continuing.

---

## 6. Accept releases the money early (US3, FR-025…FR-028)

Accept needs a `delivered` order, and API-08 does not exist. Move one by hand:

```sql
UPDATE orders SET state = 'delivered', delivered_at = now() WHERE id = '<ORDER>';
```

Then call `markDelivered` on-chain for that deal id so the contract agrees, and:

```bash
curl -s -i -X POST $API/orders/$ORDER/accept -H "Authorization: Bearer $BUYER"
```

| # | Check | Pass |
| --- | --- | --- |
| A1 | Status | `202` |
| A2 | Order state | `released`, `settled_at` set |
| A3 | `GET /me/ledger` | **no new entry** — settlement writes none (FR-028, invariant #5) |
| A4 | `settledFundsMinor` on the **seller's** `/me` | rose by the price |
| A5 | `inEscrowMinor` on the buyer's `/me` | fell by the price |
| A6 | Accepting again | `409`, naming the current state |
| A7 | Accepting as `$SELLER` | **`404`** — the writes are buyer-only |

---

## 7. ⚠️ The seller can open a sale they did not buy (US4, FR-035, FR-036)

**Verify as `$SELLER`, not as the buyer.** This is the check the source brief calls out
specifically because the narrow authorisation is the natural one to write.

```bash
curl -s -o /dev/null -w "order:%{http_code}\n"     $API/orders/$ORDER    -H "Authorization: Bearer $SELLER"
curl -s -o /dev/null -w "casefile:%{http_code}\n"  $API/orders/$ORDER/case-file -H "Authorization: Bearer $SELLER"
curl -s -o /dev/null -w "stranger:%{http_code}\n"  $API/orders/$ORDER    -H "Authorization: Bearer $STRANGER"
curl -s -o /dev/null -w "nonexist:%{http_code}\n"  $API/orders/00000000-0000-0000-0000-000000000000 -H "Authorization: Bearer $BUYER"
```

| # | Check | Pass |
| --- | --- | --- |
| S1 | Seller → `GET /orders/:id` | `200` |
| S2 | Seller → `GET /orders/:id/case-file` | `200` |
| S3 | Stranger → both | **`404`**, never `403` |
| S4 | Non-existent id, as the buyer | `404` with a **byte-identical** body to S3 |
| S5 | `GET /sales` as `$SELLER` | contains this order, keyed by the **order** id |
| S6 | `GET /sales` as `$BUYER` | does **not** contain it |
| S7 | `GET /orders` as `$SELLER` | does **not** contain it |

S3 and S4 producing the same body is the requirement, not a nicety: a distinguishable
refusal makes the route an existence oracle for other people's order ids.

---

## 8. ⚠️ The case file is redacted for the buyer and complete for the seller (FR-041…FR-044)

The agent's `systemPrompt` was seeded with `SENTINEL-PROMPT-DO-NOT-LEAK` in the 006
quickstart. Sweep for it:

```bash
for path in "/orders" "/orders/$ORDER" "/orders/$ORDER/case-file"; do
  echo -n "$path: "
  curl -s "$API$path" -H "Authorization: Bearer $BUYER" | grep -c SENTINEL
done
curl -s $API/sales -H "Authorization: Bearer $SELLER" | grep -c SENTINEL
```

| # | Check | Pass |
| --- | --- | --- |
| C1 | Every buyer-facing response | `0` matches — SC-006 |
| C2 | `GET /orders/:id/case-file` as `$SELLER` | **contains** the sentinel — it is their prompt |
| C3 | Buyer's case file | `capabilities`, `exclusions`, `input`, `acceptanceCriteria` all present |
| C4 | Buyer's case file `steps` | `[]` while API-08 is unbuilt — and `200`, not an error |
| C5 | Buyer's case file `output` | `null` and **present as a field**, not omitted (FR-040) |
| C6 | `grep system_prompt` over the buyer's query in `order.repository.ts` | no match — the column is never selected on that path |

**C6 is a source check, not a runtime one, and it is the strongest of the six.** A serialiser
that omits the field still fetched it; a query that never names it means the prompt did not
enter the process, which is the only layer that also protects a log line and a stack trace.

Once API-08 exists, add: the buyer's `steps[].summary` contains no fragment of the
`systemPrompt` and no model-authored prose, and the seller's `rawSteps` carry `reasoning` in
full ([R11](./research.md)).

---

## 9. Complaining, inside the window and outside it (US3, FR-029…FR-034)

Move a fresh order to `delivered` as in §6, and:

```bash
curl -s -i -X POST $API/orders/$ORDER2/complain \
  -H "Authorization: Bearer $BUYER" -H 'Content-Type: application/json' \
  -d '{"reason":"The total is wrong and two line items are missing."}'
```

| # | Check | Pass |
| --- | --- | --- |
| D1 | Status | `202` |
| D2 | Order state | `disputed`, `disputed_at` set |
| D3 | `complaints` | one row, carrying the reason |
| D4 | On-chain deal state | `Disputed` |
| D5 | Complaining again | `409` — `complaints.order_id UNIQUE` refuses it |
| D6 | Complaining as `$SELLER` | `404` — notification, no right of reply |
| D7 | Blank `reason` | `400` |
| D8 | `GET /sales` as `$SELLER` | the row now shows `state: "disputed"` and a `disputedAt` — **this is the seller's only notification** |

### Outside the window

Set `REVIEW_WINDOW_SECONDS=5`, restart, buy, mark delivered, wait ten seconds:

| # | Check | Pass |
| --- | --- | --- |
| D9 | Complaining | `409` |
| D10 | The complaint row | **not** created |
| D11 | On-chain deal state | still `Delivered` — no `dispute` was sent |

---

## 10. ⚠️ Act 3 — complaining about an order that produced nothing (FR-034, FR-035)

The demo's closing act. An order whose agent crashed has **no on-chain delivery**, so the
escrow would refuse a dispute against it; the complaint must mark it delivered first
([R9](./research.md)).

Simulate the crash — a `failed` order that **has** a deal id (unlike §4's, which has none):

```sql
UPDATE orders SET state = 'failed' WHERE id = '<ORDER3>';   -- onchain_deal_id stays SET
```

```bash
curl -s -i -X POST $API/orders/$ORDER3/complain \
  -H "Authorization: Bearer $BUYER" -H 'Content-Type: application/json' \
  -d '{"reason":"The agent returned nothing at all."}'
```

| # | Check | Pass |
| --- | --- | --- |
| T1 | Status | `202` — **not** a `409` |
| T2 | On-chain deal state | `Disputed` |
| T3 | Two transactions were sent | `markDelivered`, then `dispute` |
| T4 | Order state | `disputed` |
| T5 | The **compensated** failed order from §4 | complaining still returns `409` — no deal id, nothing to dispute |

**T5 is the distinction that makes T1 safe.** Both orders read `failed`; only one has money
in escrow, and `onchain_deal_id` is what tells them apart.

| # | Check | Pass |
| --- | --- | --- |
| T6 | No **other** order was ever marked delivered by this API | `grep markDelivered` in `src/orders/` returns exactly one call site, inside the complaint path (FR-035) |

T6 is the guard, not a style check. Marking a crashed deal delivered anywhere else leaves it
releasable to a seller who delivered nothing for a full review window, and `release()` is
permissionless.

---

## 11. Everything else refuses correctly

| # | Request | Pass |
| --- | --- | --- |
| E1 | `POST /orders` with no session | `401` |
| E2 | `POST /orders` for an inactive agent | `404` |
| E3 | `POST /orders` for an agent with no on-chain id | `404` — same body as E2 |
| E4 | `POST /orders` with `input` violating `inputSchema` | `400`, `fieldErrors.input` naming the path |
| E5 | `POST /orders` with blank `acceptanceCriteria` | `400` |
| E6 | `POST /orders` asking for something the listing never promised | **`201`** — judged at dispute time, not checkout (FR-004) |
| E7 | `POST /orders` with balance below price | `402` |
| E8 | `GET /orders/:id` with a malformed uuid | `400` |
| E9 | `GET /orders` for an account with none | `200 []` |
| E10 | `GET /sales` for an account owning nothing | `200 []` |
| E11 | `GET /sales` after the agent is switched off | sales **still listed** (FR-046) |
| E12 | Buying your own agent | `201` — allowed, and both reads authorise you twice |

---

## 12. Before every rehearsal

| # | Check |
| --- | --- |
| ✅ | `REVIEW_WINDOW_SECONDS` is short enough for the sweeper to fire on stage, and **not zero** (§1) |
| ✅ | The buyer is funded for every act, with margin |
| ✅ | The operator wallet holds gas and the escrow's USDC allowance covers every purchase |
| ✅ | §3 passes end to end — one purchase, escrow up, balance down |
| ✅ | §4 passes — the forced failure, both figures unchanged |
| ✅ | §7 passes **as the seller account**, not as the buyer |
| ✅ | §10 passes — Act 3 reaches `Disputed`, not `409` |
| ✅ | No order is left in `purchased` with a NULL deal id from a previous run |
