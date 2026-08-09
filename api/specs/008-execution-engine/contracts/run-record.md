# Contract — the run record

The third internal seam: what this feature *writes*, and what **API-07** (the case file) and
**API-09** (the audit) may rely on when they read it. Nothing here is new schema — see
[`../data-model.md`](../data-model.md) for the columns. This file is the promise.

Producer: `ExecutionService`, once per order, never again.
Consumers: `case-file.service.ts` today; the Guardian audit next.

---

## The pipeline, in order

Each step's failure mode is what makes the ordering non-negotiable.

```text
1. CLAIM          UPDATE orders SET state='running'
                  WHERE state='purchased' AND onchain_deal_id IS NOT NULL … RETURNING
                  → 0 rows: nothing to do, return.

2. LOAD           join agent_version_id → system_prompt, model, output_schema,
                  timeout_seconds, definition_hash
                  → missing: skip to 5 with DefinitionUnusableError.

3. OPEN           INSERT runs (order_id, input, started_at)
                  → unique violation: another worker owns this. Return, touch nothing.

4. RUN            AgentRunner.run(...)  ── resolves ──▶ 5a
                                        └── throws ───▶ 5b

5a. CLOSE (ok)    output_valid = validateAgainstSchema(output_schema, output)
                  UPDATE runs SET output, steps, output_valid, finished_at, duration_ms
                  markDelivered(dealId)
                    ├─ confirmed → UPDATE orders SET state='delivered'
                    └─ refused / unknown → leave state='running', log at error

5b. CLOSE (fail)  UPDATE runs SET steps, error, finished_at, duration_ms
                  (output stays NULL, output_valid stays NULL)
                  UPDATE orders SET state='failed'
                  no chain call at all
```

**Step 3 before step 4** so a crash mid-run leaves a record of the attempt, which is what API-10's
reaper reads (research R3).

**Step 5a's record before its chain call** so a lost response leaves complete evidence and a
missing announcement, never an announced delivery with no record of what was delivered. This is
*not* invariant #1's money ordering — nothing moves here (research R6).

**Step 5b makes no chain call.** Telling the contract a deal was delivered when nothing was would
make it releasable to a seller who delivered nothing (FR-024). The only thing that ever
re-announces it is API-07's complaint path, which pairs `markDelivered` with `dispute` in one
action precisely so that window is one action wide.

---

## What consumers may rely on

1. **Exactly one row per order, ever.** `UNIQUE (order_id)`. No retry, no re-run, no cleanup path
   exists in this feature or is permitted to be added to it.
2. **`output IS NULL` means nothing was delivered.** It is never a not-yet-written placeholder on
   a closed row, never `{}`, never a stand-in string. On an *open* row (`finished_at IS NULL`) it
   means the run is still going or the process died — distinguish by `finished_at`, not by
   `output`.
3. **`output_valid` is answered on every closed row that has an output, and NULL when there is
   none.** `false` means the output failed its own declared contract and was still delivered — a
   fact for the auditor, not a second definition of non-delivery.
4. **`error` is present on every failed row and unredacted.** It may contain model prose that
   paraphrases the seller's system prompt. Redacting it for a buyer is the reader's job, and
   API-07's serialiser already does it.
5. **`steps` is a valid `ExecutionStep[]`, always at least one element**, including on a run that
   produced nothing (FR-016). The type is declared at `src/entities/execution-step.ts` and
   re-exported from `orders/dto/case-file.dto.ts`, so both sides compile against one declaration
   and `case-file.service.ts`'s cast stops being a promise about a hypothetical producer.
6. **`duration_ms` is real wall clock for the whole run**, not the model call alone, and is not
   inflated by hidden SDK retries — there are none (`maxRetries: 0`).
7. **`input` on the run is what was actually sent to the agent.** It equals `orders.input` today;
   the two columns are separate because the case file quotes the order's copy, which exists even
   for an order that never ran.

## What consumers must not assume

- **That a `delivered` order has `output_valid = true`.** It may be `false`. That is the point.
- **That `failed` implies `output IS NULL`.** It normally does — but an order whose delivery
  announcement was lost rests in `running` with a real output, and API-10's reaper will eventually
  flip it to `failed`. Read the output, not the state (research R6).
- **That the trace is long.** A tool-less single-turn agent produces two steps. `kind` is a closed
  union of four and `tool_call` is not produced by anything today.
- **That `steps` is ordered by anything but time.** It is chronological and nothing else.

---

## Ownership boundary

`docs/CONTEXT.md` §3: *"Keep `execution` and `guardian` from importing each other. Execution
produces evidence; Guardian consumes it."*

This file is that boundary written down. `src/execution/` imports nothing from `src/guardian/`
— which does not exist yet, which is exactly when the rule is easy to keep and easy to break —
and exports no service the audit needs. The audit reads the `runs` table.

The one shared declaration is `ExecutionStep`, and it lives in `src/entities/` where both sides can
import it without importing each other.
