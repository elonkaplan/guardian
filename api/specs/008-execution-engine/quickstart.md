# Quickstart: The execution engine

**Feature**: `008-execution-engine` · **Spec**: [spec.md](./spec.md) · **Contracts**: [contracts/](./contracts/)

This is the test suite. Automated tests are out of scope for `api/` (`docs/CONTEXT.md`), so every
acceptance criterion is verified here, by hand, and a failed run is a red build.

**Four checks are load-bearing and must never be skipped**: §3 (a purchase runs and delivers),
§4 (a crash lands as `output IS NULL` and `failed`), §6 (the run cannot be repeated), and §8 (no
prompt escapes into a log). §4 and §6 cannot be reached by using the product normally — they have
to be forced, and they are the two defects a rehearsal would not otherwise surface.

**This feature has no HTTP endpoints.** Every check drives it through `POST /orders` and observes
`orders`, `runs`, and the log.

---

## 0. Prerequisites

```bash
docker compose up -d
npm run migration:run          # no new migration in this feature — this should be a no-op
npm run start:dev
```

```bash
export API=http://localhost:3000
export BUYER=<token for wallet A>
export SELLER=<token for wallet B>     # owns the agent; a different account
export PSQL="docker compose exec -T db psql -U postgres -d guardian -At"
```

The buyer must be funded (`POST /topup`) and a seller agent listed and active (006 quickstart §1).

```bash
export AGENT=<agent uuid from GET /agents>
```

Set a review window long enough that the sweeper does not release an order before you inspect it,
and a short poll interval so pickup is immediate:

```bash
# .env
REVIEW_WINDOW_SECONDS=600
EXECUTION_POLL_INTERVAL_MS=1000
```

`ANTHROPIC_API_KEY` must be a working key — §3 makes a real model call. Confirm the process
refuses to boot without it (it is already required by `env.schema.ts`).

A helper used throughout:

```bash
order() { $PSQL -c "SELECT state, onchain_deal_id FROM orders WHERE id='$1'"; }
run()   { $PSQL -c "SELECT output IS NULL AS no_output, output_valid, error IS NOT NULL AS errored,
                           finished_at IS NOT NULL AS closed, duration_ms,
                           jsonb_array_length(steps) AS steps
                    FROM runs WHERE order_id='$1'"; }
```

---

## 1. The poller starts and stays quiet

Boot with no purchasable orders.

**Expect**: one startup line naming the interval, and then nothing. A poller that logs every empty
tick makes the rehearsal log unreadable and hides the lines that matter.

```bash
$PSQL -c "SELECT count(*) FROM orders WHERE state='purchased'"   # 0
```

Stop the process. **Expect** a clean exit — no dangling handle, no "process did not exit" warning.
The interval must be cleared in `onModuleDestroy`.

---

## 2. An order is claimed, and only once

Place an order (007 quickstart §3) and watch the state within one poll interval.

```bash
ORDER=<id from POST /orders>
order $ORDER      # purchased → running, within ~1s
run $ORDER        # a row exists: closed=f, no_output=t, steps=0
```

✅ **US1 1, 4, 9** — an open record exists while the run is in flight, carrying the input and a
start time.

Check the input was copied rather than referenced:

```bash
$PSQL -c "SELECT (r.input = o.input) AS input_copied
          FROM runs r JOIN orders o ON o.id=r.order_id WHERE r.order_id='$ORDER'"   # t
```

---

## 3. A successful run delivers ★ load-bearing

Let §2's order finish.

```bash
order $ORDER   # delivered
run   $ORDER   # no_output=f, output_valid=t, errored=f, closed=t, duration_ms>0, steps=2
```

Confirm the chain agrees, and that the review window is running:

```bash
cast call $ESCROW "deals(uint256)" $(order $ORDER | cut -d'|' -f2)   # state = Delivered
```

✅ **US2 1–4** · **SC-002** · **SC-004**

Then confirm the ordering (US2 3) from the log: the line recording the closed run must appear
**before** the `markDelivered` line. If they are the other way round, a lost chain response would
leave an announced delivery with nothing recorded.

### 3a. The pinned definition, not the current one ★

Before the run finishes, publish a new version of the same agent as the seller (`POST
/agents/:id/versions` with a different `system_prompt` and `model`).

**Expect**: the run completes against the *pinned* version. Verify from the log's model line and:

```bash
$PSQL -c "SELECT v.version FROM orders o JOIN agent_versions v ON v.id=o.agent_version_id
          WHERE o.id='$ORDER'"     # the version that was current at purchase
```

✅ **US1 2–3** · **SC-007**

---

## 4. A crash lands as non-delivery ★ load-bearing

Force it. The cheapest forcing function before API-11 exists: list an agent whose `output_schema`
the model API will refuse (a schema with `additionalProperties` left unset on a nested object), or
point a version's `model` at a string no model serves.

```bash
order $ORDER   # failed
run   $ORDER   # no_output=t, output_valid IS NULL, errored=t, closed=t, steps=2
```

Three things must all hold, and each is a separate rule:

```bash
$PSQL -c "SELECT output IS NULL AS null_not_empty, output::text FROM runs WHERE order_id='$ORDER'"
# null_not_empty = t, and output::text is NULL — not '{}', not '""'
```

✅ **US3 1, 3** · **FR-023**

```bash
cast call $ESCROW "deals(uint256)" <dealId>    # state must still be Open, NOT Delivered
```

✅ **US3 4** · **FR-024** — a failed run must never make the deal releasable to the seller.

```bash
$PSQL -c "SELECT jsonb_array_length(steps), steps->0->>'kind', steps->1->>'kind'
          FROM runs WHERE order_id='$ORDER'"   # 2 | model_turn | error
```

✅ **US3 6** · **FR-016** — the attempt is on record even though nothing was produced.

### 4a. Timeout

Set a version's `timeout_seconds` to `1` and buy it.

**Expect**: `failed` within a second or two, `error` naming the limit, `output` NULL, and
`duration_ms` close to 1000 — not the model's full latency. Whatever the model had produced is
discarded.

✅ **US3 2** · **FR-026** · **SC-008**

### 4b. The failed order still reaches the auditor

Complain against the failed order (007 quickstart §6). **Expect** it to succeed: the complaint
path marks the deal delivered and disputes it in one action, so the order reaches `disputed`.

✅ **US3 7** · **SC-012**

---

## 5. Conformance is recorded, both ways

Two runs against schemas the model will satisfy and violate respectively — the second is easiest to
force by editing `agent_versions.output_schema` directly *after* purchase so the stored schema no
longer matches what the constraint produced.

```bash
$PSQL -c "SELECT order_id, output IS NOT NULL AS delivered, output_valid FROM runs"
# one row t | t   and one row t | f  — and BOTH orders are 'delivered'
```

✅ **US5 1–3** · **FR-029** · **SC-004** — a non-conforming output is still a delivery.

```bash
$PSQL -c "SELECT output_valid FROM runs WHERE output IS NULL"    # NULL, never f
```

✅ **US5 4** · **FR-028**

---

## 6. The run cannot be repeated ★ load-bearing

With a finished order, force a second attempt — reset its state by hand and let the poller find it:

```bash
$PSQL -c "UPDATE orders SET state='purchased' WHERE id='$ORDER'"
```

**Expect**: the poller claims it, the run insert raises a unique violation, and the service returns
**without touching the order and without calling the model**. The log must say so.

```bash
$PSQL -c "SELECT count(*) FROM runs WHERE order_id='$ORDER'"    # still 1
$PSQL -c "SELECT output IS NULL, error, finished_at FROM runs WHERE order_id='$ORDER'"  # unchanged
```

✅ **US1 5** · **US3 5** · **FR-012, FR-025** · **SC-001**

Restore the state afterwards.

### 6a. Two claimants

Start a second process against the same database (`PORT=3001 npm run start:dev`) and place an
order.

**Expect**: exactly one process logs the claim; the other never sees the order. One run row.

✅ **US1 6** · **FR-004**

---

## 7. Orders that must never be picked up

```bash
# an order whose openDeal was refused — API-07 left it failed with a NULL deal id
$PSQL -c "SELECT count(*) FROM orders WHERE state='failed' AND onchain_deal_id IS NULL"
# an order whose openDeal outcome was unknown — purchased, NULL deal id
$PSQL -c "UPDATE orders SET state='purchased', onchain_deal_id=NULL WHERE id='$SOME_ORDER'"
```

**Expect**: neither is ever claimed, no run row appears for either, and both stay exactly as they
were across many poll intervals.

✅ **US1 7–8** · **FR-002, FR-003** — the second is the one that matters: its money may genuinely be
escrowed, and running work against it would be acting on an unconfirmed purchase.

---

## 8. No prompt escapes ★ load-bearing

Set a seller agent's `system_prompt` to an unmistakable marker and buy it.

```bash
$PSQL -c "UPDATE agent_versions SET system_prompt='CANARY_7f3a9 do not echo this'
          WHERE id='<version id>'"
```

Then, after a successful run and after a forced failed run:

```bash
npm run start:dev 2>&1 | tee /tmp/exec.log       # for the duration of both runs
grep -c CANARY_7f3a9 /tmp/exec.log               # must be 0
```

✅ **FR-015 boundary** · **SC-006 (log half)** — the runner may hold the prompt and must never
print it. A log line goes around every serialiser in the system.

Then the buyer-facing half, which is API-07's boundary and must still hold now that something
writes prose into `steps`:

```bash
curl -s $API/orders/$ORDER -H "Authorization: Bearer $BUYER"          | grep -c CANARY_7f3a9  # 0
curl -s $API/orders/$ORDER/case-file -H "Authorization: Bearer $BUYER" | grep -c CANARY_7f3a9 # 0
curl -s $API/orders/$ORDER/case-file -H "Authorization: Bearer $SELLER" | grep -c CANARY_7f3a9 # 1+
```

✅ **SC-006** · **US4 5**

Also confirm no step's `label` carries model output — it is the one field a buyer sees verbatim:

```bash
$PSQL -c "SELECT DISTINCT jsonb_array_elements(steps)->>'label' FROM runs"
# only: the model id, 'output', and failure kinds. Never a sentence.
```

---

## 9. A restart mid-run leaves a legible corpse

Buy from a slow agent and kill the process mid-run (`Ctrl-C` during the model call).

```bash
order $ORDER   # running
run   $ORDER   # closed=f, no_output=t, started_at set
```

**Expect** exactly that shape: an open row with a start and no finish. This is what API-10's reaper
will read to decide the order is past its timeout — nothing here recovers it, and that is correct.
On restart, the poller must **not** pick this order up again (it is `running`, not `purchased`).

✅ Edge case *"the process dies mid-run"* · **FR-002**

---

## 10. Deterministic demo mode (once API-11 exists)

Until API-11 registers fixtures the registry is empty and this section is a no-op — confirm that
much now:

```bash
# with no entries registered, every run is live
grep -c "scripted" /tmp/exec.log      # 0
```

✅ **FR-033** (vacuously) — an empty registry changes nothing.

After API-11 lands, run all three acts twice and diff:

```bash
for i in 1 2; do
  curl -s -XPOST $API/demo/reset -H "Authorization: Bearer $BUYER"
  # …place the three seeded orders…
  $PSQL -c "SELECT o.state, r.output, r.output_valid FROM orders o JOIN runs r ON r.order_id=o.id
            ORDER BY o.created_at" > /tmp/acts-$i.txt
done
diff /tmp/acts-1.txt /tmp/acts-2.txt      # must be empty
```

**Expect**: identical outputs, identical conformance answers, identical states. Act 3's row must
show `failed` with a NULL output, reached through §4's ordinary path — not a special case.

✅ **US6 1–4, 7** · **SC-009**

---

## Sign-off

| # | Check | Criteria |
| --- | --- | --- |
| 1 | Poller quiet, clean shutdown | — |
| 2 | Claim opens a record | US1 1, 4, 9 |
| 3 ★ | Success delivers, in the right order | US2 1–4 · SC-002 |
| 3a | Pinned version, not current | US1 2–3 · SC-007 |
| 4 ★ | Crash → NULL output, `failed`, no chain call | US3 1, 3, 4, 6 · SC-003 |
| 4a | Timeout | US3 2 · SC-008 |
| 4b | Failed order reaches the auditor | US3 7 · SC-012 |
| 5 | Conformance both ways | US5 1–4 · SC-004 |
| 6 ★ | One run per order, forever | US1 5 · US3 5 · SC-001 |
| 6a | Two claimants, one winner | US1 6 |
| 7 | Ineligible orders never claimed | US1 7–8 |
| 8 ★ | No prompt in logs or buyer responses | SC-006 |
| 9 | Restart leaves a legible open row | edge case |
| 10 | Three acts, twice, identical | US6 · SC-009 |

**SC-005** (every record carries a trace with more than the answer) is covered by the `steps=2`
assertions in §3 and §4. **SC-010** is §3's ordering check plus a forced chain failure — reuse
007's chain-failure harness (`scripts/verify-007-failure.mjs`) pointed at `markDelivered`, and
confirm the order stays `running` with its output intact and the agent not re-run. **SC-011** is
007's escrow-exposure check, unchanged: this feature adds no state that alters it.
