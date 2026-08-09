# Quickstart: The Guardian audit engine

**Feature**: `009-guardian-audit-engine` · **Spec**: [spec.md](./spec.md) · **Contracts**: [contracts/](./contracts/)

This is the test suite. Automated tests are out of scope for `api/` (`docs/CONTEXT.md`), so every
acceptance criterion is verified here, by hand, and a failed run is a red build.

**Six checks are load-bearing and must never be skipped**: §3 (a complaint produces a cited,
settled verdict), §5 (a rejected complaint pays the seller in full), §6 (non-delivery reaches
100%), §7 (the audit cannot be repeated), §9 (**the prompt reaches the auditor and not the
buyer**), and §11 (**an undecidable dispute fails visibly rather than spinning forever**).
§7, §9 and §11 cannot be reached by using the product normally — they have to be forced, and
they are the three defects a rehearsal would not otherwise surface.

⚠️ **§9 deserves the most attention of anything here.** It is the only requirement in this
feature enforced by a runtime check on model output rather than by a database constraint, a
closed type, or an exhaustive map — so it is the only one that can pass code review and still
fail in production.

**§10 verifies prompt caching, and it is not optional.** Caching failure here is *silent*: no
error, no warning, `cache_creation_input_tokens: 0`, and a bill.

---

## 0. Prerequisites

```bash
docker compose up -d
npm run migration:run          # ⚠️ ONE new migration: audit_attempts + audit_failed_at on orders
npm run start:dev
```

```bash
export API=http://localhost:3000
export BUYER=<token for wallet A>
export SELLER=<token for wallet B>     # owns the agent; a different account
export STRANGER=<token for wallet C>   # party to nothing
export PSQL="docker compose exec -T db psql -U postgres -d guardian -At"
```

Carried over from the 008 quickstart: a funded buyer, a listed and active seller agent, and the
three demo fixtures (API-11). Set a review window long enough that the sweeper does not release an
order before you can complain about it:

```bash
export ORDER_REVIEW_WINDOW_SECONDS=600
export GUARDIAN_POLL_INTERVAL_MS=2000
export GUARDIAN_AUDIT_TIMEOUT_MS=180000
```

Two helpers used throughout:

```bash
verdict()  { curl -s -H "Authorization: Bearer $1" $API/orders/$2/verdict; }
orderstate() { $PSQL -c "select state from orders where id='$1'"; }
```

---

## 1. The audit does not start on its own

**Covers**: FR-027, FR-028 · **Setup**: a delivered, *uncomplained* order.

```bash
$PSQL -c "select count(*) from verdicts"          # note the number
sleep 10
$PSQL -c "select count(*) from verdicts"          # unchanged
```

✅ **Pass**: no verdict appears for an order nobody disputed. The poller is quiet on an empty
tick — a poller that narrates every second buries the lines that matter.

❌ **Fail**: a verdict row for a `delivered` order means the audit-pending predicate is missing
`state = 'disputed'`.

---

## 2. A `disputed` order with no escrow deal is not audited

**Covers**: FR-027 · **Forced.** No product path reaches this state; make one.

```bash
$PSQL -c "update orders set state='disputed', onchain_deal_id=null where id='$ORDER'"
sleep 10
$PSQL -c "select count(*) from verdicts where order_id='$ORDER'"     # 0
```

✅ **Pass**: `0`. There is nothing to settle, so producing a ruling that can never move money
would be worse than producing none.

Restore the row before continuing.

---

## 3. ⚠️ A complaint produces a cited, tiered, settled verdict

**Covers**: US1, FR-001–FR-022, SC-001, SC-002, SC-003 · **The core check.**

Use the demo fixture whose output falls short of the acceptance criteria (Act 2 — the 50% act).

```bash
ORDER=$(curl -s -X POST $API/orders -H "Authorization: Bearer $BUYER" \
  -H 'content-type: application/json' \
  -d '{"agentId":"'"$AGENT"'","input":{…},"acceptanceCriteria":"…five line items…"}' | jq -r .id)

# wait for delivery, then:
time curl -s -X POST $API/orders/$ORDER/complain -H "Authorization: Bearer $BUYER" \
  -H 'content-type: application/json' -d '{"reason":"Only three of the five line items were extracted."}'
```

Watch the state walk:

```bash
watch -n1 "$PSQL -c \"select state from orders where id='$ORDER'\""
# disputed → adjudicated → settled
```

Then:

```bash
verdict $BUYER $ORDER | jq
```

✅ **Pass**, all of:

- [ ] `tier` is one of the five enum values (SC-001)
- [ ] `citations` has **at least one** element (SC-001, FR-011)
- [ ] every citation has exactly `source`, `quote`, `met` — **not** `clause` (FR-033)
- [ ] every `source` is `capability`, `exclusion`, or `criterion` (FR-010)
- [ ] **every `quote` appears in the clause it names** — check by eye against
      `GET /orders/$ORDER/case-file` (SC-001, FR-012)
- [ ] `reasoning` is non-empty and argues from those clauses
- [ ] `onchainTxHash` is present and the order is `settled`
- [ ] the whole thing took **under a minute** from the complaint returning (SC-003)

Then verify the money on-chain, **not** in the database (SC-002):

```bash
# read balances[buyer] / balances[seller] from the escrow at the tx block
```

- [ ] the split matches the tier — 50% ⇒ half the escrowed amount to each side (SC-002)

❌ **Fail — a tier with zero citations**: this should be **unreachable**. `.min(1)` becomes
`minItems: 1` on the wire and survives the SDK's schema transform (`verdict-schema.md` §2), so
the API cannot return one. If you see it, either `.min(1)` was dropped from the Zod schema or
something is writing `verdicts` other than the persist path — check FR-041/SC-013 before
anything else.

❌ **Fail — a quote that is not in any clause**: R4's traceability check is missing or too
lenient. This is the failure that matters most: a paraphrase rendered in the seller's voice is
worse than no citation.

---

## 4. Order the write against the chain call

**Covers**: US5, FR-018, FR-023, FR-024, SC-010, invariant #8 · **Forced.**

Break the chain call — point `ESCROW_CONTRACT_ADDRESS` at a non-contract address, or stop the
RPC — then dispute a fresh order.

```bash
$PSQL -c "select o.state, v.id is not null as has_verdict, v.onchain_tx_hash
          from orders o left join verdicts v on v.order_id=o.id where o.id='$ORDER'"
```

✅ **Pass**: `adjudicated | t | <null>` — the verdict is **committed** and the order rests where
a retry can act on it.

```bash
verdict $BUYER $ORDER | jq '{tier, citations: (.citations|length), onchainTxHash}'
```

- [ ] the ruling is fully readable, with `onchainTxHash: null` (SC-010)

Now restore the chain and **watch the settle-pending pass finish it without a second audit**:

```bash
$PSQL -c "select created_at from verdicts where order_id='$ORDER'"   # note it
sleep 10
$PSQL -c "select state, created_at from orders o join verdicts v on v.order_id=o.id where o.id='$ORDER'"
```

- [ ] state is now `settled`, `onchainTxHash` is set
- [ ] **`verdicts.created_at` is unchanged** and there is still exactly one row (FR-024)
- [ ] the settled split matches the **stored** tier

❌ **Fail — no verdict row after the chain failure**: the verdict is inside the same transaction
as the chain call. That is `settlement.service.ts`'s shape and it is wrong here — it destroys a
ruling that cannot be reproduced (research R12).

❌ **Fail — `created_at` moved**: the retry re-audited. The settle-pending pass must start from
the row, not from the auditor.

---

## 5. ⚠️ A frivolous complaint is rejected, and the seller is paid in full

**Covers**: US1 scenarios 3–4, FR-013, SC-007 · Demo Act 1.

Use the fixture whose output **meets** both yardsticks, then complain anyway.

```bash
curl -s -X POST $API/orders/$ORDER/complain -H "Authorization: Bearer $BUYER" \
  -H 'content-type: application/json' -d '{"reason":"I did not like it."}'
```

✅ **Pass**:

- [ ] `tier` is `none`
- [ ] citations show the **met** clauses — `met: true` (SC-007)
- [ ] the order reaches `settled` — a rejected complaint still settles; it is not a no-op
- [ ] the seller's on-chain balance receives the full amount

Then the sharper case (FR-013): complain about something the listing **never promised** and the
buyer **never asked for**.

- [ ] `tier` is `none`

❌ **Fail**: a non-zero tier for work that met the promise means Guardian is a refund button,
not an auditor — and the rejected complaint is exactly as important to the demo as the upheld
one.

---

## 6. ⚠️ Non-delivery reaches the full-refund tier

**Covers**: US3, FR-004, FR-005, FR-014, SC-006 · Demo Act 3 · invariant #7.

Use the fixture that produces nothing.

```bash
$PSQL -c "select output is null as no_output, error from runs where order_id='$ORDER'"   # t
curl -s -X POST $API/orders/$ORDER/complain -H "Authorization: Bearer $BUYER" -d '{"reason":"Nothing was delivered."}'
```

✅ **Pass**:

- [ ] `tier` is `full` (SC-006)
- [ ] the buyer's on-chain balance receives 100%
- [ ] the verdict still carries **≥ 1 citation and real reasoning** — not a bare tier

Then the harder variant (FR-005): an order that **never ran at all**.

```bash
$PSQL -c "delete from runs where order_id='$ORDER2'"
$PSQL -c "update orders set state='disputed' where id='$ORDER2'"
```

- [ ] the case file still assembles and the audit still runs
- [ ] `tier` is `full`

❌ **Fail — the audit crashes on a missing run**: the assembler is treating an absent run as an
error. The absence *is* the evidence.

❌ **Fail — `tier: full` with empty citations**: someone short-circuited non-delivery in code.
That produces the uncited tier the feature exists to avoid (research R10) — the model must rule,
and code must only assert the floor.

---

## 7. ⚠️ The audit cannot be repeated

**Covers**: US4, FR-025, FR-021, SC-004, SC-005 · **Forced.**

On the settled order from §3:

```bash
$PSQL -c "update orders set state='disputed' where id='$ORDER'"    # force it back
sleep 15
$PSQL -c "select count(*) from verdicts where order_id='$ORDER'"   # still 1
```

✅ **Pass**: `1`. The audit-pending predicate's `NOT EXISTS (verdict)` excluded it, so no model
call was even made.

Now defeat the predicate and prove the **constraint** is the real guarantee:

```bash
$PSQL -c "insert into verdicts (order_id, tier, refund_minor, reasoning, citations, verdict_hash, model)
          values ('$ORDER','full',999,'x','[]'::jsonb,'\\x00','m')"
```

- [ ] Postgres rejects it: `duplicate key value violates unique constraint` (FR-021)

And replay (SC-005):

```bash
for i in 1 2 3; do verdict $BUYER $ORDER | sha256sum; done
```

- [ ] three identical hashes — byte-for-byte, every read

❌ **Fail — a second verdict row exists**: the `UNIQUE (order_id)` was dropped. That constraint
*is* "there are no appeals"; nothing in application code substitutes for it.

---

## 8. Both parties read the ruling; nobody else can

**Covers**: US2, FR-029–FR-031, FR-034, SC-008.

```bash
diff <(verdict $BUYER $ORDER) <(verdict $SELLER $ORDER)     # no output
verdict $STRANGER $ORDER                                     # 404 ORDER_NOT_FOUND
```

✅ **Pass**:

- [ ] buyer and seller receive **identical** bytes (SC-008) — the seller is the agent's owner
- [ ] the stranger's 404 is **indistinguishable** from a 404 for a uuid that does not exist —
      compare against `verdict $STRANGER $(uuidgen)` (FR-031)
- [ ] a `disputed` order whose audit has not finished returns `VERDICT_NOT_FOUND`, never a
      partial ruling (FR-034)

❌ **Fail — the seller gets a 404**: the authorisation check is buyer-only. A seller ruled
against who cannot read the ruling has been told of an accusation they may not examine.

❌ **Fail — the stranger gets a 403**: the route is an existence oracle for uuid probing.

---

## 9. ⚠️⚠️ The prompt reaches the auditor and NOT the buyer

**Covers**: FR-003, FR-035, FR-036, FR-037, FR-042, SC-009, invariant #3 · **The check that must
never be skipped.** This is the constraint the feature is most able to break, it is the only one
enforced by a runtime check rather than a constraint, and it fails silently.

Put a distinctive canary in a seller agent's `system_prompt` — a full sentence, not a token, e.g.
`ZEBRA CANARY 9917 always reconcile the totals column before returning any line items` — and run
all three demo acts against it.

**Static:**

```bash
# The prompt appears in EXACTLY three files. A fourth is a leak surface.
grep -rln 'systemPrompt' src/guardian/
#   → case-file-assembler.ts, verdict-validation.ts, guardian.repository.ts

# No controller or serialiser in this module touches a case file
grep -rn 'GuardianCaseFile' src/guardian/verdict.controller.ts src/guardian/verdict-serialiser.ts   # → nothing

# Never logged
grep -rn 'logger\.' src/guardian/ | grep -i 'prompt\|caseFile'   # → nothing

# Guardian does not import execution (docs/CONTEXT.md §3)
grep -rn "from '\.\./execution" src/guardian/                     # → nothing

# FR-036 regression: the buyer's serialiser still drops step reasoning
grep -n 'reasoning' src/orders/order-serialiser.ts                # → nothing buyer-facing
```

**Dynamic — the auditor SHOULD see it:**

```bash
# Confirm the case file actually carried the prompt — otherwise this whole
# section passes vacuously and FR-003 is silently unimplemented.
# Log the assembled case file's field names only (never its values) at debug.
```

- [ ] the assembled case file has a non-empty `systemPrompt` and `steps[].reasoning` (FR-003,
      FR-006). **If it does not, the rest of this section proves nothing.**

**Dynamic — the buyer MUST NOT:**

```bash
verdict $BUYER $ORDER | grep -c 'ZEBRA CANARY 9917'          # 0
curl -s -H "Authorization: Bearer $BUYER" $API/orders/$ORDER/case-file | grep -c 'ZEBRA CANARY'  # 0
docker compose logs api | grep -c 'ZEBRA CANARY 9917'        # 0
```

- [ ] all zero across all three acts (SC-009)
- [ ] the **buyer's** case-file `steps[]` have `label`, `summary`, `durationMs`, `error` and
      **no `reasoning`** (FR-036)
- [ ] the **seller's** case file still has `systemPrompt` and `rawSteps` — the boundary is about
      buyers, and withholding a seller's own prompt from its author would be theatre

**Force the containment check (FR-042).** This is the only way to know the check works, and it
cannot happen by accident:

```bash
# Temporarily instruct the auditor to quote the seller's instructions verbatim
# in its reasoning, then dispute an order.
```

- [ ] the audit **fails** rather than persisting (gate 7)
- [ ] the log names the order id and the leak-detected failure class, **without reproducing the
      matched text**
- [ ] no verdict row is written
- [ ] restoring the prompt lets the next attempt decide normally

❌ **Fail — the leaking verdict persists**: FR-042 is missing or is reading the wrong field. It
reads `reasoning`; `quote` is covered structurally by the `source` enum plus §3's traceability
check.

❌ **Fail — legitimate rulings are rejected as leaks**: `LEAK_RUN_WORDS` is too low, or the
normaliser differs from the one the traceability check uses. Lower it further only with evidence;
raising it to silence a rejection is how the check stops working.

---

## 10. ⚠️ Prompt caching actually works

**Covers**: FR-007 · **Silent failure.** Nothing errors when this is wrong.

Log `usage` from each audit (order id, `cache_creation_input_tokens`,
`cache_read_input_tokens`), then run **two** audits a minute apart.

✅ **Pass**:

- [ ] audit 1: `cache_creation_input_tokens > 0`
- [ ] audit 2: **`cache_read_input_tokens > 0`**

❌ **Fail — both are 0 on every audit**: the prefix is **under 512 tokens**. Opus 5's minimum is
512 (halved from Opus 4.8's 1024); below it nothing caches and no error is raised. Lengthen the
rubric or accept that it will not cache — but know which.

❌ **Fail — `cache_creation` is non-zero every time and `cache_read` is always 0**: the prefix
is **not frozen**. Something is interpolated into `GUARDIAN_SYSTEM_PROMPT` — a date, an order
id, an agent name, a computed count. Diff the rendered `system` block between two audits; the
bytes must be identical (research R8).

> ⏱️ **Timebox this to ten minutes.** Caching is cost, not correctness. A rehearsal runs on the
> order of fifty audits, so a total cache miss costs cents. This check exists so that caching
> cannot *silently* fail — not to justify chasing it. If it does not resolve quickly, write down
> what you observed, move on, and treat it as a known cost rather than a blocker.

---

## 11. A failed audit looks undecided — then, at the bound, looks FAILED

**Covers**: FR-017, FR-038, FR-039, FR-040, FR-043, FR-044, SC-011, SC-012 · **Forced.**

Point `ANTHROPIC_API_KEY` at an invalid value, then dispute an order.

```bash
sleep 8
$PSQL -c "select o.state, o.audit_attempts, o.audit_failed_at is null as still_trying,
                 count(v.id) as verdicts
          from orders o left join verdicts v on v.order_id=o.id
          where o.id='$ORDER' group by 1,2,3"
```

✅ **Pass, in two phases.**

**Phase 1 — attempts 1 and 2:**

- [ ] state stays **`disputed`**, `verdicts` count is **0** (FR-040 — no placeholder row)
- [ ] `audit_attempts` increments once per tick
- [ ] the log names the order id and the failure class, and contains **no** case file, request
      body, or response body (`verdict-schema.md` §6)
- [ ] the poller keeps ticking — one failed audit does not wedge the worker (SC-012)

**Phase 2 — attempt 3 reaches the bound:**

- [ ] `audit_attempts = 3` and `audit_failed_at` is **set** (FR-043)
- [ ] the poller **stops** selecting the order — `audit_attempts` does not keep climbing
- [ ] `verdict $BUYER $ORDER` returns an explicit **audit-failed** body, not the in-progress
      not-found (FR-044, SC-011)
- [ ] `verdict $SELLER $ORDER` returns the same
- [ ] `verdicts` count is still **0** — nothing was fabricated to free the money (FR-041, SC-013)

❌ **Fail — `audit_attempts` keeps climbing past 3**: the bound is missing from the audit-pending
predicate. The order will retry forever and the buyer's screen will say a ruling is coming,
indefinitely.

❌ **Fail — a verdict row appears at the bound**: someone added a fallback ruling. Every row in
`verdicts` must have been produced by the auditor (SC-013).

❌ **Fail — the endpoint still 404s after the bound**: FR-044 is unimplemented, and the failure is
invisible — which is the exact defect the bound was added to remove.

Repeat for the other reachable gates:

| Force | Expect |
| --- | --- |
| A refusal (`stop_reason: 'refusal'` — HTTP **200**) | `AuditFailedError`, not a crash on `content[0]` |
| `GUARDIAN_MAX_TOKENS` set very low | `stop_reason: 'max_tokens'` → failed audit, **not** a truncated verdict (FR-039) |
| `GUARDIAN_AUDIT_TIMEOUT_MS=2000` | Audit abandoned at the deadline; **the next tick still picks up work** (FR-038, SC-012) |

❌ **Fail — an unhandled rejection inside a poller tick**: `stop_reason` is being read after
`content`. A refusal is a normal 200 with an empty `content` array.

❌ **Fail — the worker stops picking up work after a timeout**: the `AbortController` is not
clearing, or the deadline is not armed at all. One hung audit must not end every later dispute.

---

## 12. The full rehearsal

Run **all three acts end to end, twice**, in one session:

| Act | Fixture | Expected tier | On-chain |
| --- | --- | --- | --- |
| 1 | meets promise + criteria; complained anyway | `none` (0%) | seller paid in full |
| 2 | three of five line items | `half` (50%) | split |
| 3 | produced nothing | `full` (100%) | buyer refunded in full |

- [ ] each act produces citations a human would agree with
- [ ] the **second** run through returns byte-identical verdicts for the same orders — the
      figures on stage do not move between rehearsals (SC-005)
- [ ] every settled order links to a real transaction hash

**Treat a failed rehearsal the way you'd treat a red build.** The demo rehearsal is this
component's test suite, and `temperature` does not exist on Opus 5 — the only thing making these
numbers stable is that they are stored.
