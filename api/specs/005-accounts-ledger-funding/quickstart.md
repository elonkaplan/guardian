# Quickstart: Accounts, Ledger & Funding

**Feature**: `005-accounts-ledger-funding` · **Date**: 2026-08-09

**This document is the test suite.** Automated tests are out of scope for `api/`
(`docs/CONTEXT.md`), so every acceptance criterion in [spec.md](./spec.md) is verified by
running the steps below. Treat a failed check the way you would treat a red build.

Everything here is runnable with `curl`, `psql` and `cast` — no UI required.

---

## 0. Prerequisites

```bash
docker compose up -d postgres
npm run migration:run
npm run start:dev            # runs preflight first
```

Boot log must show the chain preflight passing, including the **new sixth check**
reporting the funder's USDC and MON balances. If the funder holds no MON, every top-up in
this document fails at signing — fix it before going further.

```bash
# Session token. Signing wallet must be one you hold the key for.
export ADDR=0xYourWalletAddress
export API=http://localhost:3000

MSG=$(curl -s -X POST $API/auth/nonce -H 'content-type: application/json' \
  -d "{\"address\":\"$ADDR\"}" | jq -r .message)
SIG=$(cast wallet sign --private-key $YOUR_KEY "$MSG")
export TOKEN=$(curl -s -X POST $API/auth/verify -H 'content-type: application/json' \
  -d "{\"address\":\"$ADDR\",\"signature\":\"$SIG\"}" | jq -r .token)

export AUTH="authorization: Bearer $TOKEN"
```

Handy chain reads:

```bash
export USDC=$(grep ^USDC_ADDRESS .env | cut -d= -f2)
export FUNDER=$(grep ^FUNDER_ADDRESS .env | cut -d= -f2)
export OPERATOR=$(grep ^OPERATOR_ADDRESS .env | cut -d= -f2)
export RPC=$(grep ^MONAD_RPC_URL .env | cut -d= -f2)

usdc() { cast call $USDC "balanceOf(address)(uint256)" $1 --rpc-url $RPC; }
```

USDC has 6 decimals; the platform speaks cents. **1 cent = 10,000 base units.**

---

## 1. `GET /me` returns three figures (US1, FR-001…FR-004)

```bash
curl -s $API/me -H "$AUTH" | jq
```

✅ Body has exactly `accountId`, `address`, `availableBalanceMinor`, `inEscrowMinor`,
`settledFundsMinor`.
✅ No `balance` field, no combined figure.
✅ `address` is checksummed — mixed case, identical to `cast to-check-sum-address $ADDR`.
✅ A fresh account reads `0`, `0`, and `0` — not `null`, not absent.

```bash
# The key must be PRESENT even when null. This is the JSON.stringify trap (R2).
curl -s $API/me -H "$AUTH" | jq 'has("settledFundsMinor")'   # → true, always
```

---

## 2. The resilience check — the one this feature exists for (FR-005…FR-007)

**This is the headline acceptance criterion.** Point the API at a dead RPC host and
restart:

```bash
# In .env — a host that accepts nothing.
MONAD_RPC_URL=http://127.0.0.1:9   # discard port; connection refused
npm run start:dev
```

```bash
time curl -s -o /dev/null -w '%{http_code}\n' $API/me -H "$AUTH"
curl -s $API/me -H "$AUTH" | jq
```

✅ **`200`**, not `500`, not a hang.
✅ `availableBalanceMinor` and `inEscrowMinor` are correct.
✅ `settledFundsMinor` is **`null`**.
✅ Wall time well under 2 s.

Now the harder case — a host that accepts the connection and never answers, which is what
bad wifi actually looks like:

```bash
# Black hole. nc listens, reads, and replies with nothing.
while true; do nc -l 9099 >/dev/null; done &
MONAD_RPC_URL=http://127.0.0.1:9099
npm run start:dev
```

```bash
time curl -s $API/me -H "$AUTH" | jq .settledFundsMinor
```

✅ `null` after **~2 s**, not ~40 s. If this takes tens of seconds, the `Promise.race`
budget (R1) is not in place and viem's `timeout: 10_000 × retryCount: 3` is running the
show — the exact failure the widget cannot survive.

Poll it the way the widget does and confirm requests do not stack:

```bash
for i in $(seq 1 6); do curl -s -o /dev/null -w '%{http_code} %{time_total}\n' \
  $API/me -H "$AUTH"; sleep 5; done
```

✅ Six `200`s, each ~2 s. No growth across iterations.

**Restore `MONAD_RPC_URL` before continuing.**

---

## 3. Top-up moves real money (US2, FR-014…FR-019)

**Before the first top-up**, measure the transfer ceiling rather than trusting the seeded
estimate (R4). `measureGas()` is `eth_estimateGas` — free, no transaction:

```bash
npx ts-node scripts/measure-transfer-gas.ts    # both directions, cold and warm
```

✅ `GAS_LIMITS.transfer` is at least 1.3× the larger reading, and its comment says
MEASURED with the figure. Monad charges the **limit**, so this number is spent on every
top-up and every cash-out for the rest of the demo — and an under-sized limit reverts the
transaction *and* charges in full.


```bash
usdc $FUNDER; usdc $OPERATOR                       # before
curl -s $API/me -H "$AUTH" | jq .availableBalanceMinor

curl -s -X POST $API/topup -H "$AUTH" -H 'content-type: application/json' \
  -d '{"amountMinor":500}' | jq                     # $5.00

usdc $FUNDER; usdc $OPERATOR                       # after
```

✅ Funder down by **5,000,000** base units (500 ¢ × 10,000).
✅ Operator up by the same.
✅ `availableBalanceMinor` up by `500`.
✅ Response is the updated summary.

The ledger row carries the transaction:

```bash
curl -s $API/me/ledger -H "$AUTH" | jq '.[0]'
```

✅ `kind: "onramp"`, `amountMinor: 500`, `externalRef` is a `0x…` hash, `orderId: null`.

```bash
cast tx $(curl -s $API/me/ledger -H "$AUTH" | jq -r '.[0].externalRef') --rpc-url $RPC
```

✅ A real transfer, funder → operator, for 5,000,000 base units.

### Refusals (FR-017, FR-018)

```bash
for amt in 0 -100 1.5 '"abc"'; do
  curl -s -o /dev/null -w "$amt → %{http_code}\n" -X POST $API/topup \
    -H "$AUTH" -H 'content-type: application/json' -d "{\"amountMinor\":$amt}"
done
```

✅ All four `400`. ✅ Funder balance **unchanged** — nothing was attempted.

```bash
# More than the funder holds.
curl -s -X POST $API/topup -H "$AUTH" -H 'content-type: application/json' \
  -d '{"amountMinor":99999999}' | jq
```

✅ `409`, message names the shortfall in dollars. ✅ No transaction on chain.

---

## 4. The statement explains the balance (US3, FR-009…FR-013)

```bash
curl -s $API/me/ledger -H "$AUTH" | jq '[.[].amountMinor] | add'
curl -s $API/me -H "$AUTH" | jq .availableBalanceMinor
```

✅ **Identical.** This is the contract.

✅ Newest first. ✅ Credits positive, debits negative. ✅ An account with no movements
returns `[]`, not `404`.

Scoping (FR-013) — sign in as a second wallet and confirm its statement is its own:

```bash
curl -s $API/me/ledger -H "authorization: Bearer $TOKEN2" | jq length   # → 0
```

Append-only (FR-011):

```bash
psql $DATABASE_URL -c "select count(*) from ledger_entries where account_id = '<id>'"
```

✅ Count only ever grows across everything in this document. No `UPDATE`, no `DELETE`
anywhere in the feature's source:

```bash
grep -rn "\.update(\|\.delete(\|\.remove(" src/ledger src/funding src/accounts
```

✅ No hits.

---

## 5. Cash-out returns money the way it came (US5, FR-025…FR-030)

```bash
usdc $OPERATOR; usdc $FUNDER
curl -s -X POST $API/offramp -H "$AUTH" -H 'content-type: application/json' \
  -d '{"amountMinor":200}' | jq
usdc $OPERATOR; usdc $FUNDER
```

✅ Operator down 2,000,000 base units, funder up the same.
✅ `availableBalanceMinor` down by `200`.
✅ New ledger row: `kind: "offramp"`, `amountMinor: -200`, **`externalRef: null`**.

That null is correct, not a missing write. The debit is written before the transfer is
broadcast, so no hash exists yet, and the ledger is append-only so it cannot be added
afterwards (contracts §2). The hash is in the response and the log. `onramp` rows *do*
carry a hash, because a top-up transfers first.

**The round trip** (SC-002) — note the funder balance, top up $5, cash out $5, and:

✅ The funder balance returns to **exactly** where it started.

### Overdraw is refused (FR-026)

```bash
BAL=$(curl -s $API/me -H "$AUTH" | jq .availableBalanceMinor)
curl -s -X POST $API/offramp -H "$AUTH" -H 'content-type: application/json' \
  -d "{\"amountMinor\":$((BAL + 1))}" | jq
```

✅ `409`, message names both figures in dollars. ✅ No debit written, no transfer sent.

### The concurrency check — do not skip this

```bash
BAL=$(curl -s $API/me -H "$AUTH" | jq .availableBalanceMinor)
# Two simultaneous cash-outs, each for the FULL balance.
for i in 1 2; do
  curl -s -X POST $API/offramp -H "$AUTH" -H 'content-type: application/json' \
    -d "{\"amountMinor\":$BAL}" &
done; wait
curl -s $API/me -H "$AUTH" | jq .availableBalanceMinor
```

✅ Exactly one `200` and one `409`.
✅ Final balance is **`0`, never negative**. A negative figure means the row lock (R8) is
missing and the check-then-insert race is live.

---

## 6. Withdraw settled funds (US4, FR-020…FR-024)

Needs a settled order, so run this after a purchase has released — or check the two
refusal paths, which need nothing:

```bash
curl -s -X POST $API/withdraw -H "$AUTH" | jq
```

With nothing settled:
✅ `409`, `"No settled funds to withdraw"`.
✅ **No transaction on chain** — verify the operator's MON balance did not move. On Monad
the gas *limit* is charged even for a no-op, so a submitted transaction here is money
spent for nothing.

With settled funds present:
✅ `200` with `txHash`, `amountMinor`, `explorerUrl`.
✅ `cast tx $txHash` shows USDC arriving at **your own wallet**, not the pool.
✅ `settledFundsMinor` afterwards reads `0`.
✅ `availableBalanceMinor` and `inEscrowMinor` **unchanged**.
✅ **The statement gained no new row** (FR-022, invariant #5):

```bash
curl -s $API/me/ledger -H "$AUTH" | jq length   # same before and after
```

That last check is the one most likely to be "fixed" into a bug by someone who thinks a
withdrawal should appear in the statement. It must not.

---

## 7. Solvency holds throughout (SC-009, FR-019)

At any point in this document:

```bash
psql $DATABASE_URL -tAc \
  "select coalesce(sum(amount_minor),0) from ledger_entries"    # total owed, cents
usdc $OPERATOR                                                   # held, base units
```

✅ `operator_base_units >= total_owed_cents × 10000`, **always**, including immediately
after any failure. Kill the process mid-top-up (between the transfer and the credit) and
re-check: the pool holds more than the ledger claims, which is the safe direction the
write ordering (R7) exists to guarantee.

---

## 8. The stubs are visibly stubs (US6, FR-031…FR-035)

```bash
curl -s -X POST $API/onramp/routes -H "$AUTH" -H 'content-type: application/json' \
  -d '{"amountMinor":1000}' | jq
curl -s -X POST $API/offramp/routes -H "$AUTH" -H 'content-type: application/json' \
  -d '{"amountMinor":1000}' | jq
```

✅ `200`. ✅ `stub: true` and `rainCallMade: false` are the first two keys.
✅ `reason` explains Monad is not a supported rail.
✅ `wouldHaveSent` carries method, URL and the full body.
✅ The offramp route returns `depositAddress` equal to `FUNDER_ADDRESS`.
✅ Nothing named `id`, `status` or `routeId` — nothing skimmable as a Rain success.

In the server log:

✅ One `WARN` per call carrying the complete payload.
✅ **No `RAIN_API_KEY`, no private key, no bearer token** anywhere in it:

```bash
RAIN_KEY=$(grep ^RAIN_API_KEY .env | cut -d= -f2)
# Should print nothing.
docker compose logs api 2>&1 | grep -F "$RAIN_KEY"
```

✅ No outbound request to `RAIN_BASE_URL` — confirm with `tcpdump`, or simply that the
host is unreachable from the container and the endpoints still answer `200`.

---

## 9. Auth (FR-036)

```bash
for p in /me /me/ledger /topup /withdraw /offramp /onramp/routes /offramp/routes; do
  curl -s -o /dev/null -w "$p → %{http_code}\n" -X POST $API$p
done
```

✅ Every one `401` without a token — including the two stubs. The guard is global and
fail-closed; no `@Public()` belongs anywhere in this feature.

---

## 10. Rehearsal checklist

Run before the demo, more than once:

- [ ] §2 dead-host check — `200` with `null`, under 2 s
- [ ] §3 top-up — three balances agree
- [ ] §4 statement sums to the figure
- [ ] §5 round trip — funder returns to its starting balance
- [ ] §5 concurrency — one `200`, one `409`, never negative
- [ ] §6 withdraw — no new ledger row
- [ ] §7 solvency — pool ≥ ledger
- [ ] §8 stubs — obviously stubs, no secret in the log
- [ ] Funder holds MON **and** USDC; operator and guardian hold MON
