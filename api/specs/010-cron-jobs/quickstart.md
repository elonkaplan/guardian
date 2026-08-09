# Quickstart: Cron jobs — the three timers

**Feature**: `010-cron-jobs` · **Spec**: [spec.md](./spec.md) · **Contracts**: [contracts/](./contracts/)

This is the test suite. Automated tests are out of scope for `api/` (`docs/CONTEXT.md`), so every
acceptance criterion is verified here, by hand, and a failed run is a red build.

**Four checks are load-bearing and must never be skipped**: §2 (an untouched order releases on its
own — this is Act 1's ending and the only thing on this page an audience sees), §5 (a reaped order's
already-recorded output survives), §7 (a reclaim moves the money without writing a ledger entry),
and §9 (the jobs survive an unreachable chain without taking the process down).

⚠️ **§5 and §7 are the two that can pass code review and still be wrong.** §5 is a single SQL
predicate standing between the reaper and the destruction of evidence (invariant #7). §7 is an
absence — the bug is a line of code that *is not there*, and the only way to catch it is to look.

**§3, §5, §6 and §8 cannot be reached by using the product normally.** They have to be forced with
SQL, and they are exactly the defects a rehearsal would not otherwise surface.

---

## 0. Prerequisites

```bash
docker compose up -d
npm run migration:run          # ⚠️ NO new migration in this feature — this should be a no-op
npm run start:dev
```

```bash
export API=http://localhost:3000
export BUYER=<token for wallet A>
export SELLER=<token for wallet B>     # owns the agent
export PSQL="docker compose exec -T db psql -U postgres -d guardian -At"
```

Set a short sweeper cadence and a review window you can outlast in a coffee break:

```bash
export SWEEPER_INTERVAL_MS=3000
export REVIEW_WINDOW_SECONDS=45        # ⚠️ do NOT go below ~30 (smart-contract §6.5)
```

Helpers used throughout:

```bash
orderstate() { $PSQL -c "select state, settled_at from orders where id='$1'"; }
runrow()     { $PSQL -c "select finished_at is null as open, output is null as no_output, error from runs where order_id='$1'"; }
ledger()     { $PSQL -c "select count(*) from ledger_entries where order_id='$1'"; }
dealstate()  { $PSQL -c "select onchain_deal_id from orders where id='$1'"; }
```

⚠️ **A review window below about 30 seconds makes block-timestamp jitter visible.** Validators have
a few seconds of latitude, so the platform will ask to release before the chain agrees and log a
"not yet" every tick until it catches up. That is the designed behaviour (research R6), but at 10
seconds it stops looking designed.

---

## 1. Startup is three lines and then silence

**Covers**: FR-001, FR-006 · **Setup**: an empty or idle database.

```bash
# in the server log, at boot:
#   sweeper started, interval=3000ms
#   reclaimer started, interval=300000ms
#   reaper started, interval=60000ms
sleep 120                              # ~40 sweeps, 2 reaps, 0 reclaims
```

✅ **Pass**: nothing further from any of the three. Two minutes of idle produces zero job lines.

❌ **Fail**: any per-tick output. A job that narrates every three seconds buries the lines that
matter — the release, the reap, the reclaim — and SC-007 is measured over ten minutes, not two.

---

## 2. ⭐ An untouched delivered order releases on its own

**Covers**: FR-010, FR-011, FR-012, US1 · **Setup**: buy from a succeeding agent, then **touch
nothing**.

```bash
ORDER=<order id from POST /orders>
orderstate $ORDER                       # delivered
SELLER_ADDR=$($PSQL -c "select wallet_address from accounts where id='<seller account>'")

# note the seller's on-chain settled funds before the window closes
curl -s -H "Authorization: Bearer $SELLER" $API/me | jq .settledFundsMinor

sleep 60                                # the 45s window plus a couple of sweeps
orderstate $ORDER                       # released
curl -s -H "Authorization: Bearer $SELLER" $API/me | jq .settledFundsMinor
curl -s -H "Authorization: Bearer $BUYER"  $API/me | jq .inEscrowMinor
```

✅ **Pass**: the order reads `released` with **no request made and no key pressed**. The seller's
`settledFundsMinor` rose by exactly the order's price; the buyer's `inEscrowMinor` fell by exactly
the same amount. The log carries one line naming the order and its transaction hash.

**This is Act 1's ending.** Watch it once with the screen up — if the gap between the window closing
and the state changing is long enough that you would narrate over it, `SWEEPER_INTERVAL_MS` is too
high (SC-008).

❌ **Fail**: still `delivered` after two cadences past the window → check the log for a repeated
`window open` revert, which means the platform's clock is ahead of block time by more than the
margin the window allows.

```bash
ledger $ORDER                           # unchanged from before the release
```

✅ **Pass**: no new ledger row. The payout is on-chain under the seller's own address — invariant #5.

---

## 3. A released order is never swept twice

**Covers**: FR-007, FR-016, SC-004 · **Setup**: the order from §2.

```bash
sleep 30                                # ~10 more sweeps
$PSQL -c "select count(*) from orders where id='$ORDER' and state='released'"   # 1
```

✅ **Pass**: no second `release` transaction in the log, no further state write. The selection
predicate is `state = 'delivered'`, so a released order is not a candidate at all.

Force the harder version — an order the chain has already settled but the database has not caught up
with:

```bash
$PSQL -c "update orders set state='delivered' where id='$ORDER'"
sleep 10
orderstate $ORDER                       # released, again
```

✅ **Pass**: the sweep's `release` reverted `not delivered`, the reconciler read the deal, found
`Settled`, and wrote `released` (research R6). **Nothing was retried forever and no gas was spent** —
`simulateContract` catches the revert before broadcasting.

---

## 4. The reaper closes an order left mid-run

**Covers**: FR-017, FR-018, FR-020, US2 · **Setup**: kill the backend during a run.

```bash
# start a purchase against a slow agent, then, while it is running:
docker compose kill api      # or Ctrl-C the dev server
orderstate $ORDER            # running — nobody is on it
npm run start:dev

# timeout_seconds for the pinned version, plus the 60s grace, plus up to one 60s tick
sleep 180
orderstate $ORDER            # failed
runrow $ORDER                # open=f, no_output=t, error='abandoned: ...'
```

✅ **Pass**: the order reads `failed`, the run is closed with a finish time and an abandonment
reason, and `output` is still NULL — which is the non-delivery evidence, not a gap (invariant #7).

```bash
$PSQL -c "select count(*) from runs where order_id='$ORDER'"      # 1, always
```

✅ **Pass**: exactly one run record. The reaper never re-runs and never writes a second row.

❌ **Fail**: the escrow shows the deal as `Delivered` → the reaper made a chain call it must never
make (FR-018). Nothing was delivered, so nothing is announced.

Then confirm the buyer's position is not a dead end:

```bash
curl -s -X POST -H "Authorization: Bearer $BUYER" $API/orders/$ORDER/complain -d '{...}'
```

✅ **Pass**: accepted. A reaped order is an ordinary non-delivery and reaches Guardian (FR-021).

---

## 5. ⭐ A reaped order's existing output is not destroyed

**Covers**: FR-019 · **Forced.** This is the lost-delivery-announcement case: the run succeeded and
`markDelivered` failed, leaving a `running` order whose run holds a real output.

```bash
# take a completed, delivered order and put it back into the shape the bug produces
$PSQL -c "update orders set state='running' where id='$DELIVERED_ORDER'"
runrow $DELIVERED_ORDER      # open=f (already closed), no_output=f (has an output)
$PSQL -c "select output, finished_at, error from runs where order_id='$DELIVERED_ORDER'" > /tmp/before.txt

sleep 180                    # let the reaper find it
orderstate $DELIVERED_ORDER  # failed
$PSQL -c "select output, finished_at, error from runs where order_id='$DELIVERED_ORDER'" > /tmp/after.txt
diff /tmp/before.txt /tmp/after.txt
```

✅ **Pass**: `diff` is **empty**. The order moved to `failed` — correct, because the chain never
learned of the delivery — and the run record was not touched at all. The guard is
`WHERE finished_at IS NULL`, and this row's `finished_at` is set (research R8).

❌ **Fail — and this is the worst failure on this page**: any change to `output`, `finished_at`, or
`error`. An overwritten output is evidence destroyed, and there is no recovery. If `error` now reads
`abandoned: …` on a run that produced something, the `finished_at IS NULL` predicate is missing.

---

## 6. The reaper leaves a live run alone

**Covers**: FR-021's grace margin, FR-022 · **Setup**: a run in progress against a long
`timeout_seconds`.

```bash
$PSQL -c "select v.timeout_seconds from orders o join agent_versions v on v.id=o.agent_version_id where o.id='$ORDER'"
# start the run, then watch for the full timeout_seconds
orderstate $ORDER            # still running, throughout
```

✅ **Pass**: the order survives its entire declared budget plus the grace margin. A run using its
full time limit is never killed out from under itself.

❌ **Fail**: an order reaped while the agent is still working → the grace margin is missing, or the
clock is `orders.created_at` on a row that has a run (`COALESCE` argument reversed, research R7).

---

## 7. ⭐ The reclaimer returns the money and writes no ledger entry

**Covers**: FR-024, FR-026, FR-027, FR-028, US3 · **Forced.** The deadline is 24 hours; backdate it.

```bash
# an order that never delivered — either purchased-and-never-run, or failed
$PSQL -c "update orders set created_at = now() - interval '25 hours' where id='$ORDER'"
BEFORE_ESCROW=$(curl -s -H "Authorization: Bearer $BUYER" $API/me | jq .inEscrowMinor)
BEFORE_SETTLED=$(curl -s -H "Authorization: Bearer $BUYER" $API/me | jq .settledFundsMinor)
LEDGER_BEFORE=$($PSQL -c "select count(*) from ledger_entries where order_id='$ORDER'")

sleep 300                    # one reclaimer cadence
orderstate $ORDER            # settled, with a settled_at
```

⚠️ The contract measures from its own `openedAt`, which is a real block timestamp — backdating
`created_at` does **not** move it. Against a deal opened minutes ago the reclaim will revert
`too early` and reconcile to "not yet", which is the correct behaviour and proves §8 for free. To
see a reclaim actually land, the deal itself has to be 24 hours old, so **this check runs in two
parts**: the state-and-ledger half below can be verified by pointing at a deal opened yesterday, and
the "not yet" half is §8.

```bash
curl -s -H "Authorization: Bearer $BUYER" $API/me | jq '.inEscrowMinor, .settledFundsMinor'
ledger $ORDER                # ⚠️ SAME as LEDGER_BEFORE
```

✅ **Pass, and check all three**:
1. `state = 'settled'` with `settled_at` set — **not `failed`**. If it stayed `failed` the money is
   counted in `inEscrowMinor` *and* in `settledFundsMinor` at once (research R9).
2. `inEscrowMinor` fell by exactly the price; `settledFundsMinor` rose by exactly the price. The
   money is in **one** of the two figures, never both and never neither.
3. **`ledger_entries` is unchanged.** This is the check that catches the most tempting bug on this
   page — a "refund" credit that looks like kindness and leaves the pool owing more than it holds.

```bash
grep -rn "ledger" src/jobs/ ; echo "exit=$?"
```

✅ **Pass**: no match. Worth grepping as well as observing.

---

## 8. Both jobs tolerate being early, quietly

**Covers**: FR-013, FR-029, SC-005 · **Setup**: an order whose deadline has passed in the database
but not on the chain — which §7's backdate produces for free.

```bash
sleep 600                    # two reclaimer cadences
orderstate $ORDER            # unchanged — still purchased or failed
```

✅ **Pass**: the order is untouched, and the log shows the "not yet" at **debug**, not error. A
premature call is a legitimate outcome of two clocks disagreeing, not a fault, and logging it at
error level would fill the rehearsal log with red for a system working correctly.

❌ **Fail**: an error-level line per tick, or a state write. Either means the revert reason is being
treated as a failure rather than reconciled against the deal.

---

## 9. ⭐ An unreachable chain does not take anything down

**Covers**: FR-004, FR-005, SC-005, US4 · **Setup**: break the RPC.

```bash
# point MONAD_RPC_URL at an unroutable host and restart
export MONAD_RPC_URL=http://127.0.0.1:9   # nothing listening
npm run start:dev
# ensure at least one order is due for each of the sweeper and the reclaimer
sleep 600                                  # ~200 sweeps, 2 reclaims, 10 reaps
```

✅ **Pass, all four**:
1. The process is still up.
2. All three timers are still firing — the reaper, which makes no chain call, is still moving stuck
   orders to `failed` throughout.
3. Every failure is logged at error level and **names an order id**.
4. No order was written into a state the chain does not share.

```bash
# restore the real RPC and restart
sleep 60
orderstate $ORDER            # released / settled — the backlog cleared on its own
```

✅ **Pass**: no restart of anything, no manual step, no queue to drain by hand. The next tick was
the retry.

❌ **Fail**: an unhandled rejection in the log, or the process exiting → `runOnce`'s throw reached
the `setInterval` callback and the base class's `try/catch` is missing (contract `polling-job.md`,
guarantee 2).

---

## 10. Shutdown is clean

**Covers**: FR-005 · **Setup**: any running instance.

```bash
# Ctrl-C the dev server
```

✅ **Pass**: the process exits promptly. A dangling `setInterval` keeps the event loop alive and
turns `Ctrl-C` into what looks like a hang — `ExecutionPoller` documents having been bitten by
exactly this.

❌ **Fail**: the process hangs → `onModuleDestroy` is not clearing a timer.

---

## 11. Nothing here touches a dispute

**Covers**: FR-009, FR-023 · **Setup**: a `disputed` order and an `adjudicated` one.

```bash
$PSQL -c "select id, state from orders where state in ('disputed','adjudicated')"
sleep 300                    # a cadence of each job
$PSQL -c "select id, state from orders where state in ('disputed','adjudicated')"
```

✅ **Pass**: unchanged. Including an order whose `audit_failed_at` is set — a dispute Guardian could
not rule on is left to the escrow's 72-hour `DISPUTE_DEADLINE` and permissionless `forceResolve`, by
design (research R14).

```bash
grep -rnE "disputed|adjudicated|forceResolve|markDelivered|resolve\(" src/jobs/ ; echo "exit=$?"
```

✅ **Pass**: no match. The module's only chain writes are `release` and `reclaim`.

---

## 12. An unconfirmed purchase is visible, once

**Covers**: FR-030, SC-009 · **Forced.**

```bash
$PSQL -c "update orders set state='purchased', onchain_deal_id=null, created_at=now()-interval '10 minutes' where id='$ORDER'"
sleep 600                    # two reclaimer cadences
```

✅ **Pass**: **exactly one** error-level line naming the order and its buyer, not one per cadence.
The order's state, its deal id, and its ledger rows are all unchanged — the deal may still confirm,
and `order.entity.ts` is unambiguous that retrying `openDeal` against a NULL id is how one purchase
ends up with two deals escrowing two prices.

Restart the process:

```bash
# Ctrl-C, then npm run start:dev
sleep 300
```

✅ **Pass**: it is reported again after the restart. The dedupe is per-process, on purpose — a
restart is when somebody is most likely to be reading the log (research R12).

---

## 13. The full rehearsal

**Covers**: SC-010 · The real test suite.

Run all three acts end to end, twice, in one session:

1. **Act 1** — buy, deliver, touch nothing, watch §2 release it on stage.
2. **Act 2** — buy, deliver, complain inside the window, watch Guardian rule and settle. Confirm the
   sweeper did **not** race the complaint (§11: the disputed order was never touched).
3. **Act 3** — buy from the failing agent, confirm `failed` with a NULL output, complain, watch the
   full refund.

✅ **Pass**: both passes complete with no order left in a state a human has to correct, and the log
between acts is quiet.

❌ **Fail**: treat exactly as a red build. This component has no other test suite.
