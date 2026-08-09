# Quickstart: Demo seed & the three seller agents

**Feature**: `011-demo-seed-fixtures` · **Spec**: [spec.md](./spec.md) · **Contracts**: [contracts/](./contracts/)

This is the test suite. Automated tests are out of scope for `api/` (`docs/CONTEXT.md`), so every
acceptance criterion is verified here, by hand, and a failed run is a red build. This feature is
also the thing the *rehearsal* runs on, so §5–§7 are the rehearsal itself rather than a rehearsal
of it.

**Five checks are load-bearing and must never be skipped**: §2 (**every seeded agent actually
runs** — the failure the previous feature found), §5–§7 (the three acts, end to end, which have
never all run), §8 (**the acts survive a restart**), §9 (a stranger's input gets a live run), and
§10 (reset keeps the ledger whole).

⚠️ **§8 deserves the most attention.** It is the only check here whose failure is *silent*: the
fixtures are in memory, the listings are not, and if registration ever moves to seed time, Act 2
returns a live five-item extraction on stage with nothing logged as wrong. A passing §5–§7 tells
you nothing about §8 — you have to restart.

⚠️ **§4 is the fragile fixture, and it is not a word count.** Read the summary. If it has drifted
off the pricing change, the buyer's complaint becomes valid and Act 1 inverts.

---

## 0. Prerequisites

```bash
docker compose up -d
npm run migration:run          # ⚠️ NO new migration in this feature — this is a no-op re-run
npm run start:dev
```

```bash
export API=http://localhost:3000
export BUYER=<token for a funded buyer wallet>
export PSQL="docker compose exec -T db psql -U postgres -d guardian -At"
```

One new environment key, **required at boot**:

```bash
DEMO_SELLER_ADDRESS=0x…      # the payout address every seller payout in the demo lands on
```

Keep the review window long enough to complain before the sweeper releases, and the pollers
brisk:

```bash
REVIEW_WINDOW_SECONDS=600
EXECUTION_POLL_INTERVAL_MS=2000
GUARDIAN_POLL_INTERVAL_MS=2000
```

Helpers used throughout:

```bash
seed()       { curl -s -X POST $API/demo/seed; }
reset()      { curl -s -X POST $API/demo/reset; }
buy()        { curl -s -X POST $API/orders -H "Authorization: Bearer $BUYER" \
                 -H 'content-type: application/json' -d "$1"; }
order()      { curl -s -H "Authorization: Bearer $BUYER" $API/orders/$1; }
verdict()    { curl -s -H "Authorization: Bearer $BUYER" $API/orders/$1/verdict; }
complain()   { curl -s -X POST $API/orders/$1/complain -H "Authorization: Bearer $BUYER" \
                 -H 'content-type: application/json' -d "$2"; }
```

**Save the seed response** — every act below posts its `input` and `acceptanceCriteria` back
verbatim, and retyping them is the one thing guaranteed to break determinism:

```bash
seed > /tmp/seed.json
jq -r '.fixtures[] | "act \(.act) → \(.agentKey) → \(.expectedTier)"' /tmp/seed.json
```

---

## 1. Seeding, from empty

```bash
$PSQL -c "select count(*) from agents"     # expect 0 before
seed | jq '{seller: .seller.walletAddress, agents: [.agents[] | {name, onchainAgentId, created}]}'
```

**Expect**: three agents, every `created: true`, every `onchainAgentId` a number — never null.

```bash
curl -s $API/agents | jq '[.[] | {name, priceMinor}]'
```

**Expect**: all three visible in the public catalogue, priced 200 / 100 / 150. A missing one means
its `onchain_agent_id` is NULL, and the public query is hiding it on purpose.

⚠️ **`GET /agents` is the real check, not the seed response.** An agent whose registration outcome
was unknown leaves a row and no on-chain id, and it will fail at purchase on a buyer's screen.

**Idempotency (FR-007, SC-010)**:

```bash
seed | jq '[.agents[] | .created]'         # expect [false, false, false]
$PSQL -c "select count(*) from agents"     # expect 3, not 6
$PSQL -c "select count(*) from agent_versions"  # expect 3
```

**Config guard (FR-006)**: unset `DEMO_SELLER_ADDRESS` and restart. **Expect the process to refuse
to boot**, naming the key in the existing preflight report — not a seed-time failure.

---

## 2. ★ Every seeded agent actually runs

**This is the check the previous feature's verification run failed**, on all thirteen of its
orders, for a schema constraint the local validator does not impose. It is verified by purchasing,
never by re-reading the stored definitions (FR-036).

```bash
for act in 1 2 3; do
  jq -c ".fixtures[] | select(.act==$act) | {agentId, input, acceptanceCriteria}" /tmp/seed.json
done
```

Buy from each in turn, then:

```bash
$PSQL -c "select o.state, r.output is null as no_output, r.error is not null as has_error
          from orders o left join runs r on r.order_id = o.id order by o.created_at"
```

**Expect**: acts 1 and 2 `delivered` with output; act 3 `failed` with no output and an error.

**Expect NOT to see**, anywhere in the logs:

```text
DefinitionUnusableError … 'additionalProperties' must be explicitly set to false
```

That message means a seeded `outputSchema` is missing the flag on some object — check the nested
one inside `lineItems.items` first, it is the easiest to miss and it fails Act 2 specifically.

---

## 3. ★ Act 2's output is countable

```bash
order <act2-order-id> | jq '.run.output'
```

⚠️ **`.run.output`, not `.output`.** The delivery is nested under `run`
(`toOrderRun` in `order-serialiser.ts`). `.output` yields `null` and reads exactly
like a fixture that failed to fire.

**Expect exactly**:

| Check | Expected |
| --- | --- |
| `lineItems` length | **3** |
| descriptions | `Ergonomic keyboard`, `USB-C dock`, `Monitor stand` |
| `total` | `300.00` (the receipt prints `362.00`) |
| the two dropped | `Desk lamp` (38.00), `Cable kit` (24.00) — both named on the receipt |

Repeat the purchase five times (SC-003). **Expect the same three, five times.** Three different
items on any run means the fixture did not fire and a live model answered.

---

## 4. ⚠️ Act 1's output — read it, do not count it

```bash
order <act1-order-id> | jq -r '.run.output.summary'
order <act1-order-id> | jq '.run.output.wordCount'
```

| Check | Expected | How |
| --- | --- | --- |
| declared count | `85` | `jq` |
| actual count | `85` | `jq -r '.run.output.summary' | wc -w` — **they must agree** |
| under the buyer's cap | 85 < 100 | arithmetic |
| **covers the pricing change** | **yes** | ★ **read it** |

★ **Hand the summary to someone who did not write it** and ask whether it covers the pricing
change. If they hesitate, the fixture is broken even though every number above passed. This is
FR-015, and it is the check that a word count cannot make.

---

## 5. ★ Act 1 end to end — the rejected complaint (0%)

Buy with the fixture's `acceptanceCriteria` verbatim, wait for `delivered`, then complain with the
fixture's `complaint` verbatim.

```bash
complain <order-id> "$(jq -c '.fixtures[]|select(.act==1)|{reason: .complaint}' /tmp/seed.json)"
sleep 20 && verdict <order-id> | jq '{tier, refundMinor, citations: [.citations[] | {source, met}]}'
```

**Expect**: `tier: "none"`, `refundMinor: 0`, the seller paid $1.00 in full, and at least one
citation whose `source` is `criterion` — Guardian quoting the buyer's own 100-word cap back at
them.

**This act has never run.** Only Act 3's tier has been exercised end to end; the audit engine's
verification names 0% and 50% as its largest gap.

---

## 6. ★ Act 2 end to end — the split (50%), and the cited exclusion

```bash
complain <order-id> "$(jq -c '.fixtures[]|select(.act==2)|{reason: .complaint}' /tmp/seed.json)"
sleep 20 && verdict <order-id> | jq '{tier, refundMinor, citations}'
```

**Expect**: `tier: "half"`, `refundMinor: 100` — $1.00 back to the buyer, $1.00 to the seller.

★ **Expect at least one citation with `source: "exclusion"`** quoting *"Does not convert between
currencies or restate amounts in another currency."* (SC-007). That is the buyer's second
grievance being rejected while the first still carries the tier. An exclusion the demo claims and
never shows is the requirement this check exists for.

⚠️ **That citation comes back `met: true`, and `true` is the rejection.** `met` reads *"the
delivery met this clause"* (`verdict-response.dto.ts`) — the seller stated it does not convert
currencies, the delivery honoured that, so the currency complaint fails while the missing
line items still carry the tier. Expecting `met: false` here is asserting that the demo
misfires.

Confirm the split on-chain rather than in the database:

```bash
# the escrow's Resolved event / deal state for this dealId
```

---

## 7. ★ Act 3 end to end — non-delivery (100%)

```bash
$PSQL -c "select state, (select output is null from runs where order_id=o.id) as output_is_null,
          (select error from runs where order_id=o.id) from orders o where id='<order-id>'"
```

**Expect**: `failed`, `output_is_null = t`, and the error text recorded — the crash on the record
rather than an empty silence (FR-021).

⚠️ **`output` must be SQL NULL, not `{}`.** An empty object is a delivery of nothing; NULL is the
evidence Guardian reads.

Complain, then expect `tier: "full"`, `refundMinor: 150`, the whole payment back.

---

## 8. ★ The acts survive a restart

The silent one.

```bash
docker compose restart api      # or ^C and npm run start:dev
```

**Do not re-seed.** Immediately buy Act 2's fixture again.

**Expect**: three line items. **If five come back, the fixtures are being registered at seed time
instead of at bootstrap** — the listings survived the restart and the registry did not (FR-026,
research R1).

Confirm the registration happened on the way up:

```text
registered demo script: Act 1 — TLDR Agent delivers 85 words
registered demo script: Act 2 — LedgerBot drops 2 of 5
registered demo script: Act 3 — PolyglotAI crashes
```

**Expect these three lines on every boot, seeded database or not.**

---

## 9. ★ A stranger's input gets a real run

Buy from LedgerBot with your own receipt — anything other than the fixture:

```bash
buy '{"agentId":"<ledgerbot>","input":{"receiptText":"Coffee 3.50\nBagel 2.25\nTOTAL 5.75"},
      "acceptanceCriteria":"Extract all line items."}'
```

**Expect a genuine extraction of two items** — not the scripted three (FR-024, SC-008). This is
also the honest answer to *"is this thing actually running?"* from the audience.

Then try the fixture receipt with **one character changed**. **Expect a live run too** — the key
is exact. And send `preserveTerms` in reverse order to PolyglotAI: **expect a live run**, because
array order is part of the input's identity.

---

## 10. ★ Reset keeps the ledger whole

Before:

```bash
$PSQL -c "select coalesce(sum(amount_minor),0) from ledger_entries where account_id='<buyer>'"
$PSQL -c "select count(*) from ledger_entries"
```

```bash
reset | jq
```

After:

```bash
$PSQL -c "select count(*) from orders"          # 0
$PSQL -c "select count(*) from runs"            # 0
$PSQL -c "select count(*) from complaints"      # 0
$PSQL -c "select count(*) from verdicts"        # 0
$PSQL -c "select count(*) from agents"          # 3   ← kept
$PSQL -c "select count(*) from accounts"        # unchanged ← kept
$PSQL -c "select count(*) from ledger_entries"  # unchanged ← ★ kept
$PSQL -c "select coalesce(sum(amount_minor),0) from ledger_entries where account_id='<buyer>'"
```

★ **The balance must be identical before and after** (FR-031, SC-012). A balance that went *up* means
purchase entries were deleted or reversed, which credits back money that has already left for an
escrow or a settlement.

```bash
$PSQL -c "select count(*) from ledger_entries where kind='purchase' and order_id is not null"  # 0
```

**Expect `0`** — the pointers are cleared, the rows are not.

**Repetition**: `reset` again. **Expect `200` and every count `0`.**

---

## 11. Reset mid-act

Buy Act 3's fixture and reset within the same second, while the execution poller is claiming.

**Expect**:

- `200`, with `ordersInFlight ≥ 1` in the response (FR-032).
- At most one error in the log, recognisable as a foreign-key failure against a deleted order —
  **not** a crashed process (FR-034).
- `select count(*) from runs` → `0`. No orphan, because the constraint refused the write.
- The next purchase works normally (SC-013).

---

## 12. ★ Two rehearsals, same three tiers

The acceptance criterion the whole feature exists for (FR-037, SC-006).

```bash
reset
# run §5, §6, §7 again, in order, without re-seeding
```

**Expect `none`, `half`, `full` — again.**

⚠️ These are **fresh rulings, not replays.** Reset deleted the verdicts, so the auditor decided
each one again, and it cannot be pinned by sampling controls. A different tier on the second pass
is not an audit defect — it means that fixture's case file is ambiguous, and the fix is here, in
the fixture (FR-027).

Repeat once more if time allows. The third pass is the one that catches a fixture that is
*usually* unambiguous.

---

## 13. The disclosure boundary

```bash
seed | grep -i -c "You extract line items\|You summarise documents\|You translate text"
reset | grep -i -c "You extract line items\|You summarise documents\|You translate text"
```

**Expect `0` from both** (FR-010, SC-011). Both routes are unauthenticated, so their responses are
public surfaces and the seller's operating instructions are in neither.

```bash
curl -s $API/agents/<ledgerbot> | jq 'has("systemPrompt")'    # false
```

---

## What a failed run looks like

| Symptom | Almost certainly |
| --- | --- |
| Every act fails, `DefinitionUnusableError` | An `outputSchema` object missing `additionalProperties: false` — check nested first |
| Act 2 returns five items | The fixture did not fire: wrong key. Check the `0x` prefix on the registered hash, or that the input was posted verbatim |
| Act 2 returns five items **only after a restart** | Fixtures registered at seed time instead of bootstrap (§8) |
| Act 1 rules 25% or 50% | The summary drifted off the pricing change — §4, read it |
| Act 2 rules 25% or 75% | The acceptance criteria or the complaint were retyped rather than pasted |
| Act 3 `delivered` with `output = {}` | Something wrote a record for the crash instead of letting it throw |
| Buyer balance rose after a reset | Ledger entries were deleted — §10 |
| Purchase fails with agent not found | An agent has a NULL `onchain_agent_id`; do **not** re-seed to fix it |
