# Phase 0 — Research: the Guardian audit engine

Fourteen decisions. Each is *Decision → Rationale → Alternatives rejected*. Nothing here was
marked NEEDS CLARIFICATION in the spec; the open questions are the ones planning surfaced.

**Two entries were corrected after review and both corrections are recorded in place rather than
edited away**: R3's claim that `.min(1)` is stripped from the wire schema (it is not), and R6's
exclusion of the system prompt and raw trace from the case file (a reversal of a settled product
decision, now withdrawn — the containment moved to the output instead, R13).

---

## R1 — The audit trigger is a poller with two passes

**Decision.** `GuardianPoller` runs on an interval and drains two queries per tick, in order:

| Pass | Predicate | Action |
| --- | --- | --- |
| **Audit-pending** | `state = 'disputed' AND onchain_deal_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM verdicts v WHERE v.order_id = o.id)` | assemble → audit → validate → persist → settle |
| **Settle-pending** | `state = 'adjudicated' AND EXISTS (verdict) AND verdict.onchain_tx_hash IS NULL` | settle **from the stored verdict** |

One order per tick per pass, re-entrancy-guarded exactly as `execution.poller.ts` does it
(`draining` / `stopping` flags, `setInterval`, quiet on an empty tick).

**Rationale.** `orders.state` is the queue (invariant #9) and API-08 already established the
shape for a worker whose only trigger is a state predicate. Nothing else claims this trigger:
API-10's cron table is sweeper / reclaimer / reaper, none of which know what a tier is or hold
the guardian key.

The second pass is the load-bearing half, and it is what makes FR-024 structural. The spec
requires that a retried settlement *"MUST use the stored ruling and MUST NOT consult the
auditor again"*. Written as a code path inside the audit flow, that is a rule someone has to
remember. Written as a **second query whose predicate is `verdict exists AND tx_hash IS NULL`**,
the retry has no access to the auditor at all — it starts from a row, and the row is the
verdict. The recovery for R12's failure branch is therefore not an error handler; it is a
different pass with a different input.

Note the audit-pending predicate is also the enforcement point for FR-025 ("refuse to audit an
order that already has a verdict") at *selection* time, so the common case never reaches the
model. The `UNIQUE` (R2) is the guarantee; this is the optimisation.

**Alternatives rejected.**
- *A dispatcher call from `SettlementService.complain`.* An audit started in-process by the
  complaint would not survive a restart between the commit and the model call, and the
  complaint's own doc-comment is explicit that it commits on an unknown chain outcome
  precisely so *"the audit can proceed"* later. It expects a later reader, not a callback.
- *`@nestjs/schedule`.* Same argument API-08 made and it has not changed: `@Interval` fires on
  a fixed cadence regardless of whether the previous tick finished, so the re-entrancy guard is
  hand-written either way. API-10 standardises this and it is a five-line change then.
- *One pass with a branch on `state`.* Two predicates that select disjoint rows and do
  different work are two queries. Merging them would put a `if (verdict === null)` at the top
  of the audit path — which is exactly the remembered rule the split removes.

---

## R2 — No new order state, and the claim is not a state move

**Decision.** There is no `adjudicating` state. The poller does not claim by moving the order;
it selects, audits, and lets `verdicts.order_id UNIQUE` arbitrate. In-process, the poller's
re-entrancy guard means two audits can never overlap.

**Rationale.** API-08's claim works because `running` already existed and already meant
*"a worker has this"* — the claim and the truth were the same word. Nothing plays that role
here. `adjudicated` means, per `order-states.ts`, *"the invariant #8 window"* — the interval
between the verdict row existing and the money moving. Moving an order there **before** the
verdict exists would make the state lie, and worse, it would make R1's settle-pending
predicate match an order with no verdict row to settle from.

Adding a sixth-and-a-half state would mean a migration on `order_state`, a new row in
`ESCROWED_ORDER_STATES` (whose doc-comment warns that adding a member changes what `GET /me`
reports as escrowed), and a new word in a state machine that four other specs already reason
about — all to protect against a race that a `UNIQUE` already covers and that the demo cannot
produce.

The cost of not claiming is bounded and known: under concurrent processes, the loser spends
one model call and then fails the insert. That is a wasted API call, not a wrong verdict, and
the `UNIQUE` is what guarantees the difference. `execution.repository.ts` made the same
trade-off in the other direction for the same reason — it noted that if its `UNIQUE` ever
fires, *"a model call was already wasted"*. Here that is the design, not the regret.

**Alternatives rejected.**
- *`SELECT … FOR UPDATE SKIP LOCKED` held across the model call.* Correct, and it holds a row
  lock open for the tens of seconds an Opus 5 call with thinking takes. A transaction that
  spans a network call to a third party is the thing you spend a career learning not to write.
- *An in-memory `Set<orderId>` of in-flight audits.* Redundant with the re-entrancy guard in
  one process, and worthless across two. It would look like protection while providing exactly
  none of the protection the `UNIQUE` provides.

---

## R3 — `messages.parse()` with Zod, and what the schema cannot enforce

**Decision.** `claude-auditor.ts` calls `client.messages.parse()` with
`output_config: { format: zodOutputFormat(VerdictSchema) }` and reads `response.parsed_output`.
The schema is:

```ts
const Citation = z.object({
  source: z.enum(['capability', 'exclusion', 'criterion']),
  quote:  z.string(),
  met:    z.boolean(),
});
const VerdictSchema = z.object({
  tier:      z.enum(['0', '25', '50', '75', '100']),
  reasoning: z.string(),
  citations: z.array(Citation).min(1),
});
```

**⚠️ Corrected after reading the SDK source.** An earlier draft of this section claimed
`.min(1)` is stripped from the wire schema and enforced client-side only. **That is wrong**, and
the correction changes what is representable.

`zodOutputFormat` runs `z.toJSONSchema()` and then `transformJSONSchema()`, which builds the wire
schema by **whitelist** — copying the keys structured outputs support and silently dropping
everything else. So most constraints (`minLength`, `maximum`, `pattern`) genuinely are dropped.
But `minItems` has an explicit carve-out (`lib/transform-json-schema.js:93`):

```js
const minItems = pop(jsonSchema, 'minItems');
if (minItems !== undefined && (minItems === 0 || minItems === 1)) {
  strictSchema['minItems'] = minItems;      // ← 0 and 1 survive to the wire
}
```

`.min(1)` emits `minItems: 1`, which is exactly the surviving case. **FR-011 is therefore an
API-level guarantee — a zero-citation ruling is not representable**, the same as an invented
tier. Had the requirement been `.min(2)`, it would have been dropped and client-side only.

**⚠️ A second correction, found while implementing and verified by running the SDK.** `enum` is
**also not on the whitelist**. `z.enum([...])` is demoted to a `description` string — the wire
schema for `tier` is literally
`{ "type": "string", "description": "{enum: [\"0\",\"25\",\"50\",\"75\",\"100\"]}" }`.
So the five tiers and the three citation sources are **not** API-enforced; the client-side Zod
parse is what rejects an off-menu value, as gate 3.

That does not change the design — the parse already ran and already failed the audit — but it
changes what may be removed later. **The client-side parse is load-bearing**, not a redundant
belt over an API guarantee, and it is the only thing between a `'37'` tier and a stored ruling.

**Rationale.** Two guarantees are structural and one is not, which is worth stating precisely.
`citations` being an array of objects with `required` keys is enforced on the wire, so FR-032's
*"structured data, not prose containing quotes"* holds by decoding rather than by a regex. So is
`minItems: 1`, which makes "a tier alone is an assertion" unrepresentable rather than merely
rejected. The tier and source vocabularies are enforced by the parse.

Two further facts from the same file, both load-bearing:

- **`additionalProperties: false` is forced onto every object** (`:73`). This feature therefore
  cannot hit the defect the execution layer's verification run found, where **every** seeded
  agent schema was refused at run time for omitting it — because that path passes the *seller's*
  schema through `messages.create` untransformed. An unplanned second justification for choosing
  `messages.parse()` here over a hand-written schema.
- **A client-side validation failure throws `AnthropicError`, not `ZodError`** — the helper
  catches Zod's error and rewraps it with the formatted issues. R7's handling must catch the
  SDK's type, not Zod's.

What remains reachable is `parsed_output === null` and a parse failure on the *shape*. Both are
failed audits, not crashes, and the code must not dereference `parsed_output` without checking.

`tier` is a string enum rather than a number because JSON Schema enums of strings are the
supported shape and because `'25'` maps to `VerdictTier.Quarter` through one table in
`verdict.schema.ts`, mirroring how `chain/tier.ts` refuses to cast between two enums that
agree in order but not in name.

**Alternatives rejected.**
- *`messages.create()` with a hand-written JSON Schema and `JSON.parse`.* This is what
  `claude-agent-runner.ts` does, and correctly so — there the schema is the *seller's*
  `output_schema`, arriving at runtime as an opaque object. Here the schema is ours, known at
  compile time, and `parse()` gives the decoded object typed. Re-deriving the type from a hand
  written schema would be a second source of truth for the verdict shape.
- *A tool call with `strict: true`.* Also guarantees the shape, and adds a tool-use loop to a
  single-turn call that has no tools. Structured outputs are the documented replacement for
  prefill on Opus 5 and the direct fit.
- *Dropping `.min(1)` on the belief that the API ignores it.* This was very nearly done, on the
  strength of the general rule that structured outputs ignore constraints. It would have turned
  FR-011 from an unrepresentable state into a runtime check — a strictly weaker guarantee,
  removed for a reason that a look at the SDK source shows to be false. The rubric still states
  the requirement in prose, which costs nothing and helps the model produce a good answer rather
  than merely a valid one.

---

## R4 — Citation traceability is verified in code, against normalised text

**Decision.** `verdict-validation.ts` rejects any citation whose `quote`, after normalisation,
is not a substring of some clause of the kind named by its `source`:

| `source` | Searched against |
| --- | --- |
| `capability` | each element of the pinned version's `capabilities[]` |
| `exclusion` | each element of the pinned version's `exclusions[]` |
| `criterion` | the order's `acceptanceCriteria` (one prose field, not an array) |

Normalisation: trim, collapse internal whitespace runs to one space, casefold. Nothing else —
no punctuation stripping, no fuzzy distance. A failure is a failed audit (R7), not a dropped
citation.

**Rationale.** The source spec's sharpest sentence is *"Citations are the credibility. A tier
alone is an assertion; a tier plus 'this clause, unmet, here is the quote' is an audit."* That
claim is only true if a **fabricated** quote fails. Without this check, a model that
paraphrases a capability into something that sounds right produces a verdict indistinguishable
from a real one, and the UI renders the paraphrase as a quotation from the seller's listing —
which is a worse failure than no citation, because it is confidently wrong in the seller's
voice.

Normalisation rather than exact equality because the failure modes are asymmetric. A model
reproducing a clause across a line wrap, or with a different run of spaces, is quoting
faithfully; rejecting that would fail honest audits constantly. A model inventing a clause
does not accidentally land inside the real text. Substring rather than equality because a
citation legitimately quotes the relevant sentence of a multi-sentence criterion.

Casefolding is the one debatable relaxation and it is taken deliberately: a quote that differs
only in case is still traceable to its clause, and the UI renders the quote from the response
anyway, so the displayed text is the model's. What must not vary is *which clause it came
from*, and case does not affect that.

**Alternatives rejected.**
- *Exact string equality.* Brittle in the direction that fails real audits, per above.
- *Trigram / Levenshtein similarity above a threshold.* A threshold is a number nobody can
  defend on stage, and a near-miss under it is exactly the paraphrase this check exists to
  reject. Substring-after-normalisation has a yes/no answer with a reason.
- *Dropping the offending citation and keeping the rest.* Silently editing a verdict makes the
  stored ruling differ from what the model produced, which breaks the replay property (R12)
  and means the persisted `reasoning` may reference a citation no longer present.
- *Making the model cite by index into the case file instead of by quote.* Removes the
  fabrication problem entirely and removes the quote from the UI, which is the artefact that
  makes the checklist readable. The spec names `{ source, quote, met }` literally.

---

## R5 — The verdict fingerprint: SHA-256 over a canonical projection

**Decision.** `verdict-hash.ts` builds a canonical byte string from the verdict's *content*
and hashes it with `node:crypto` SHA-256, yielding exactly 32 bytes:

```
sha256(JSON.stringify({
  orderId, tier, refundMinor, reasoning,
  citations: [{ source, quote, met }, …],   // in the order the model returned them
  model,
}))
```

Field order is fixed by the literal, not by key sorting, and the citation array keeps the
model's ordering. The result is stored in `verdicts.verdict_hash` (`bytea`) and passed to
`resolve` as `0x`-prefixed hex. **It is computed once, at persist time, and never recomputed** —
the settle-pending pass reads the stored bytes.

**Rationale.** The contract's parameter is `bytes32` (`escrow-resolve.abi.ts`), so the output
width is not a choice. SHA-256 is in the standard library and needs no dependency.

The properties that matter are that the hash covers everything a reader would call "the
ruling" — so that the on-chain anchor is a commitment to the tier *and its justification*, not
just to the tier — and that the exact bytes are reproducible from the stored row, so that
anyone can verify the anchor later.

"Computed once, never recomputed" is the part that is easy to get wrong and is load-bearing
under R12. A settle-retry that recomputed the hash from the row would produce the same bytes
today and a different anchor the day someone adds a field to the projection, changes JSON
serialisation of a unicode escape, or normalises the reasoning text. Reading the stored
`bytea` makes the anchor a fact about what was signed, not a function that must keep agreeing
with itself across deploys. `EscrowGuardianService.resolve`'s own doc-comment anticipates this:
it takes the hash from the caller precisely so that *"a service that computed the hash itself
could be called before anything was written down."*

**Alternatives rejected.**
- *keccak256, for EVM idiom.* Would need viem's `keccak256` imported outside `chain/` or a hash
  computed inside the chain adapter — the second is the thing the `resolve` doc-comment
  forbids. The contract stores an opaque `bytes32`; it does not interpret it.
- *Sorting object keys.* Deterministic, and it makes the projection's field set invisible at
  the call site. A literal you can read top-to-bottom is the artefact a reviewer checks against
  "does this cover the whole ruling?".
- *Hashing the raw model response body.* Would include SDK-added fields, usage counts, and
  ordering the persisted row does not carry — so the anchor would commit to something not
  reproducible from the database.
- *Sorting citations before hashing.* Their order is part of what the buyer reads; a verdict
  whose checklist reorders is a different verdict on screen.

---

## R6 — ⚠️ Guardian IS shown the prompt and the raw trace; the containment moved to the output

**Decision.** `GuardianCaseFile` carries the order input, the acceptance criteria, the complaint,
the pinned version's `capabilities[]` and `exclusions[]`, **the pinned version's `system_prompt`**,
the output (or an explicit non-delivery statement), the run's `error`, its timings, and **the raw
`runs.steps` including each step's `reasoning`**.

Containment sits on the **output**: before a ruling is persisted, `verdict-validation.ts` rejects
it if its `reasoning` reproduces a verbatim run of the system prompt (R13).

**⚠️ This reverses an earlier draft of this section, which excluded both inputs.** That draft is
withdrawn, and the reason it was wrong is worth recording rather than deleting.

**Rationale.** The earlier draft reasoned from a real observation — Guardian's `reasoning` and
`quote`s are returned to the buyer through no serialiser, which makes them the one unredacted
buyer-facing text in the product — and concluded that nothing prompt-derived should enter the
audit. The observation is correct. The conclusion reversed a settled product decision, and did so
without noticing.

`docs/agent-definition.md` §4 is a table with a row per party:

| Party | Sees the system prompt? |
| --- | --- |
| Platform / execution workspace | Yes — it runs it |
| **Guardian** | **Yes — needed for intent-vs-effort judgment** |
| Seller | Yes — it's theirs |
| **Buyer** | **No — redacted**, even in a dispute |

and it anticipates the exact risk the earlier draft "found", stating the containment as an
instruction: *"Guardian's reasoning may describe execution behaviour ('the agent made one
extraction attempt and stopped') but must never quote the prompt."* `docs/product-workflow.md`
§6.3 does the same for the trace: the execution steps *"are what lets Guardian distinguish 'the
agent genuinely tried and the task was impossible' from 'the agent returned a stub without
attempting the work'. Those deserve different verdicts, and only the trace can tell them
apart."*

So the earlier draft did not close a hole the product had missed. It removed the two inputs the
tried-versus-stub distinction depends on — and that distinction is the main input to the
difference between a **severe shortfall** and **inconclusive evidence**, which is 75% versus 25%
of the buyer's money.

**Excluding one input and not the other is incoherent, which is the sharpest argument here.** The
earlier draft's stated reason for dropping step `reasoning` was that it is *derived from* the
prompt and could be paraphrased into buyer-facing verdict prose. That reasoning only has force if
the prompt itself is absent. With the prompt in the payload — as §4 requires — redacting a
derivative while shipping the original buys nothing and costs the trace. There were only ever two
coherent positions: both inputs in with containment on the output, or both out as an explicit
product change. The first is what §4 already chose.

**What survives from the earlier draft, and it is the load-bearing half:** the containment cannot
be a prompt instruction alone, because the thing being contained is model output that reaches a
buyer with nothing in between. §4 wrote the rule as an instruction because it was describing a
product requirement, not a mechanism. R13 turns it into a check.

**What is not contained, deliberately:** paraphrase. §4 explicitly *permits* reasoning that
describes execution behaviour, so a paraphrase detector would reject legitimate rulings — the
sentence §4 offers as a good example (*"the agent made one extraction attempt and stopped"*) is
itself a paraphrase of what the prompt told the agent to do. Verbatim reproduction is the failure
that leaks the seller's actual words, and it is the one that can be caught without false
positives.

**A second guard already exists and is worth naming:** a citation's `source` may only be
`capability`, `exclusion`, or `criterion` (FR-010, and an enum on the wire). The prompt is not a
citable source, so the `quote` field — the one place text is reproduced verbatim *by design* —
structurally cannot carry it. The risk is entirely in `reasoning`, which is free text, and R13
covers exactly that field.

**Alternatives rejected.**
- *Both inputs excluded (the earlier draft).* Strongest IP position, and a product change to two
  documents that would need making explicitly rather than as a side effect of a redaction
  argument. It also gives up the 25%-versus-75% judgment for a risk that a check addresses.
- *Prompt in, raw steps out.* Incoherent, per above.
- *Prompt in, containment by instruction only (§4 as literally written).* This is the documented
  product and would be defensible. R13 costs one function that reuses R4's normaliser, and it
  converts the product's stated rule from a hope into a rejection.
- *Redacting Guardian's reasoning after the fact.* Editing a ruling means the stored verdict
  differs from the one that was made, which breaks replay (R12) and can leave the reasoning
  arguing from text that is no longer there. Rejecting and retrying preserves both.

---

## R7 — Failure handling: check `stop_reason` before `content`, and `maxRetries: 0`

**Decision.** `claude-auditor.ts` throws a typed `AuditFailedError` — never a partial verdict —
for all of:

| Cause | Detection |
| --- | --- |
| Safety refusal | `response.stop_reason === 'refusal'` (an HTTP **200**) |
| Truncation | `response.stop_reason === 'max_tokens'` |
| Unusable structure | `parsed_output === null`, or the parse throws `AnthropicError` (**not** `ZodError` — the helper rewraps it) |
| Untraceable citation | R4's check fails |
| Non-delivery floor breached | R10's assertion fails |
| **Prompt leak** | **R13's containment check fails** |
| Deadline exceeded | R14's `AbortController` fires |
| Transport / API error | any `Anthropic.APIError`, timeout, or abort |

Both `stop_reason` checks run **before any content block is read**. The SDK is constructed with
`maxRetries: 0`. `GuardianService` catches `AuditFailedError`, logs it with the order id and
the reason class, writes nothing, increments the order's attempt counter, and leaves the order
`disputed` — where R1's audit-pending pass finds it again on the next tick, until the bound in
R14 is reached (FR-017, FR-043).

**Rationale.** A refusal is a normal HTTP 200 with an empty or partial `content` array and a
`stop_details.category` — **not** a thrown error. Opus 5 ships elevated cybersecurity
safeguards, and this feature feeds it buyer-authored complaint prose and seller-authored
listing text, neither of which the platform controls; a dispute over, say, a security-scanning
agent is exactly the benign-but-adjacent case that trips a classifier. Code that reads
`content[0]` unconditionally throws on `undefined` and reports "the audit crashed" for what is
really "the auditor declined." `claude-agent-runner.ts` learned this one turn earlier and its
`buildOutcome` checks `refusal` and `max_tokens` first for the same reason.

`maxRetries: 0` follows the argument `claude-agent-runner.ts` already wrote down — hidden SDK
retries make durations a lie and spend the caller's money three times — and here there is a
second reason. An audit is the one operation in the product that is *supposed* to happen once
(product §4.4, invariant #8). Retry logic buried in an HTTP client is the wrong place for
anything with that property, even when the retried call produced no verdict. The poller is the
retry, it is visible, and its interval is configured.

**⚠️ Superseded on the retry bound.** This section originally continued: *"There is no bounded
retry count. An order that repeatedly fails audit stays `disputed`, which is the honest-looking
state for a dispute that could not be decided."* That is wrong — `disputed` with no verdict is
indistinguishable from an audit in progress, and nothing in the system ever changes it. **R14
bounds attempts at three and stamps a terminal marker.** The rest of this section stands: the
poller is still the retry, and it is still visible.

**Alternatives rejected.**
- *Persist a "failed audit" marker row.* `verdicts.order_id` is UNIQUE and a marker would
  consume the one slot, permanently blocking the real verdict. The absence of a row is already
  the marker.
- *Bounded retries then move to a terminal **state**.* Still rejected, and R14 takes the bound
  without the state: a new `order_state` member would migrate the enum and force a decision about
  `ESCROWED_ORDER_STATES`, to say what two columns already say. The order *is* still disputed —
  what failed is our ability to rule on it.
- *Catching refusals and re-prompting with softened text.* Re-prompting a declined audit to get
  a different answer is precisely what "verdicts are final" forbids, and it would be doing it
  before the first verdict even existed.

---

## R8 — Prompt caching: a frozen prefix that must clear 512 tokens

**Decision.** The request is built as:

```ts
system: [{ type: 'text', text: GUARDIAN_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
messages: [{ role: 'user', content: JSON.stringify(caseFile) }],
```

`GUARDIAN_SYSTEM_PROMPT` is a module-level `const` in `verdict-prompt.ts` containing the role,
the two-yardstick standard, the five-tier rubric, the citation requirements, and the
inconclusive-evidence rule. **No interpolation of any kind** — no date, no order id, no agent
name, no tier count computed at runtime. The case file is the *entire* user turn.

**Rationale.** Caching is a prefix match, and `tools` → `system` → `messages` is the render
order, so a breakpoint on the last system block caches everything stable and nothing else. The
case file differs on every audit, so it belongs after the breakpoint. That much is mechanical.

Two things are not mechanical and both fail silently:

1. **The minimum cacheable prefix on `claude-opus-5` is 512 tokens** — halved from the 1024 of
   Opus 4.8 and well below Opus 4.6's 4096. Below the minimum, nothing caches, no error is
   raised, and `cache_creation_input_tokens` is simply `0`. The rubric plus the citation rules
   comfortably clears 512, but "comfortably" is an assumption to *verify*, not assert.
2. **Any interpolation into the prefix voids the whole thing.** A `Date.now()` in a header line,
   an order id in a "you are auditing order X" preamble, a `${TIERS.length}` — each makes every
   request's prefix unique and turns caching into a pure 1.25× write premium paid forever.
   This is the single most common way to build this feature and get zero caching while
   believing otherwise.

Hence the verification step, which is in `quickstart.md` as an acceptance item rather than a
nice-to-have: run two audits and confirm the second reports a non-zero
`usage.cache_read_input_tokens`. If it is zero, the prefix is either too short or not frozen.

**Alternatives rejected.**
- *Top-level `cache_control` on the request (automatic placement).* Places the breakpoint on
  the last cacheable block, which is the user turn — the one part that changes every time. It
  would write a fresh cache entry per audit and read none.
- *Putting the case file in `system` too.* Same failure, one layer up.
- *`ttl: '1h'`.* Doubles the write premium to 2× and needs three reads to break even. A demo
  rehearsal runs a handful of audits minutes apart; the default 5-minute TTL fits the cadence,
  and the honest expectation is that caching helps within a rehearsal run and not across the
  gaps between them.

---

## R9 — `refund_minor` is a record of the ruling, not the instrument of payment

**Decision.** `refund.ts` holds the one tier→amount function in the codebase:

```ts
const REFUND_BPS: Record<VerdictTier, number> = {
  none: 0, quarter: 2500, half: 5000, three_quarter: 7500, full: 10_000,
};
refundMinor = Math.floor(priceMinor * REFUND_BPS[tier] / 10_000);
```

USD cents in, USD cents out (invariant #2). The value is persisted for display and record. The
**contract** computes and pays the actual split.

**Rationale.** `chain/tier.ts` is unusually explicit about not owning this — *"What this file
is NOT: it does not compute refund amounts. The percentages in the table below … are restated
here only as documentation."* So the arithmetic has no home until this feature, and it needs
one because `verdicts.refund_minor` is `NOT NULL`.

`Record<VerdictTier, number>` rather than a `switch` or a lookup by index, for the reason
`tier.ts` spends forty lines on: `Record<K, V>` requires every key, so a sixth tier fails to
compile here rather than silently producing `undefined` and then `NaN` cents. The basis points
are the contract's own `_refundBps` values, and `GuardianEscrow.sol` carries the warning that
*"an off-by-one here would be invisible until a live demo and is the exact number an audience
watches."*

`Math.floor` because a partial cent cannot be a ledger amount and the `CHECK (refund_minor >= 0)`
wants an integer. Rounding direction is a display-only concern — the chain's payout is computed
on-chain from basis points over the escrowed token amount and is not derived from this number.
Recording it anyway is what lets the verdict screen and the order screen agree without either
re-deriving it.

**Alternatives rejected.**
- *Reading the split back from the settlement receipt.* Correct in the strongest sense and
  unavailable at the moment the row is written, which is before the chain call (invariant #8).
  It would also make `refund_minor` nullable, and the column is not.
- *Storing basis points instead of cents.* Introduces a second money unit into the database,
  which invariant #2 exists to prevent.
- *Putting the function in `chain/`.* That module's one conversion is token base units ↔ cents.
  A tier percentage is a product rule, not a unit conversion, and `tier.ts` says so.

---

## R10 — Non-delivery is decided by the model and asserted by code

**Decision.** No short-circuit. An order with `runs.output IS NULL` (or no run at all) goes
through the same audit as any other, with the absence stated explicitly in the case file
(`output: null` plus a `delivered: false` flag) and with the rubric naming it as the
full-refund case. **Then** `verdict-validation.ts` asserts the floor: if the case file reported
no output and the returned tier is not `full`, the audit fails (R7) and is retried.

**Rationale.** FR-014 makes the full tier a MUST, so trusting the model alone does not satisfy
it. But a code short-circuit that writes `tier: full` without a model call produces a verdict
with **no reasoning and no citations** — the bare, uncited tier that FR-011 forbids and that
the entire feature exists to avoid. It would also make Act 3 of the demo the one act where
Guardian does not explain itself, which is the act where explanation is most persuasive:
*"nothing was produced; the listing promised X; here is the clause, unmet."*

Asserting rather than overriding, because an override would silently pair a `full` tier with
reasoning arguing for something else — a verdict that contradicts itself on screen. A failed
audit is retried and stays visible; a self-contradicting verdict is permanent (UNIQUE) and
looks like a bug in the product's core claim.

The assertion is expected never to fire. `runs.output IS NULL` is unambiguous evidence, the
rubric states the rule, and `docs/tech-stack.md` §5's mitigation is exactly this — make the
demo case files unambiguous, because *"ambiguity is where non-determinism bites."* It is a
floor under a case that should not need one, which is the appropriate amount of belt-and-braces
for the number an audience watches.

**Alternatives rejected.**
- *Short-circuit in code before the model call.* Uncited tier; see above.
- *Trust the model with no assertion.* Leaves FR-014 as a hope. `temperature` is unavailable on
  Opus 5, so there is no sampling control to lean on.
- *Override the tier to `full` and keep the model's reasoning.* Ships a verdict whose stated
  reasoning does not support its stated tier.

---

## R11 — The buyer-facing serialiser work is already done

**Decision.** This feature writes no changes to `orders/order-serialiser.ts` or
`orders/case-file.service.ts`. FR-036 is a **regression check**, not a task.

**Rationale.** The source brief asks to *"extend the serialiser: summarise reasoning text for
buyer-facing case files."* API-07 and API-08 already resolved that requirement — in the
opposite direction, and for a better reason. `toBuyerCaseFileSteps` composes each step's
`summary` from the platform-authored `kind` and `label` via an exhaustive switch and drops
`reasoning` entirely. `case-file.dto.ts` records the argument:

> *"Model prose is DROPPED — never truncated, never model-summarised. The first sentence of a
> paraphrase is still a paraphrase and the leak is at the start, so shortening would look like
> compliance and would not be; and asking a model to summarise reasoning means feeding the
> prose to a model whose output ships to the buyer, which is the same disclosure with an extra
> step in front of it."*

Omission is strictly stronger than summarisation, it is already built, and R6 is the same
argument applied one layer up — which is why both amendments point the same way. Re-opening it
here would weaken a boundary to satisfy the letter of a sentence.

What this feature *does* build is a **verdict** serialiser (`verdict-serialiser.ts`), which is
new and is this route's choke point.

**Alternatives rejected.**
- *Add a model-summarisation step to satisfy the brief literally.* Feeds seller prose to a
  model whose output reaches the buyer — the exact disclosure the existing code refuses, and
  the exact shape R6 rejects.
- *Truncate `reasoning` to N characters for the buyer.* "The leak is at the start."

---

## R12 — Persist in its own transaction, then settle; the failure branch is a query

**Decision.** Three steps, deliberately not one transaction:

1. **Transaction A** — insert the `verdicts` row and move the order `disputed → adjudicated`.
   Commit.
2. **Outside any transaction** — `escrow.resolve(dealId, tier, verdictHash)`.
3. **Transaction B** — on success, write `onchain_tx_hash` and move `adjudicated → settled`.

A failure or unknown outcome at step 2 or 3 leaves a committed verdict on an `adjudicated`
order, which R1's settle-pending pass retries from the stored row.

**Rationale.** This is `purchase.service.ts`'s shape rather than `settlement.service.ts`'s, and
here it is **mandated rather than chosen**. Invariant #8 is unambiguous: *"The verdict is
persisted before the chain call, and re-auditing an order that already has one is refused. That
is what makes the demo replayable."*

`settlement.service.ts` uses the opposite shape — chain call inside the transaction, rollback if
the chain disagrees — and explains exactly when that is right: *"A rollback loses nothing but
the attempt."* That is false here, and it is the whole point. Rolling back a verdict on a chain
failure destroys a ruling that a model produced non-deterministically and that cannot be
reproduced — `temperature` does not exist on Opus 5, so a re-audit is a *different* audit.
The stored verdict is the only copy of what was decided. Committing it first is what makes the
dispute decided-once rather than decided-per-attempt.

Step 3 being its own transaction rather than part of step 2's is what makes the retry
idempotent-enough: the settle-pending predicate keys on `onchain_tx_hash IS NULL`, so a retry
after a lost receipt re-sends `resolve`, and the contract — not our database — is the authority
on whether the deal is already `Settled`. A revert there is a safe, informative failure; a
verdict lost to a rollback is not.

Nothing here writes a ledger entry (invariant #5, FR-026). The contract credits `balances[]` at
each party's own address, where the platform cannot recapture it, and `LedgerKind` has no
`settlement` member.

**Alternatives rejected.**
- *One transaction spanning the chain call (the `settlement.service.ts` shape).* Directly
  violates invariant #8 and loses the non-reproducible ruling on any chain hiccup.
- *Move to `settled` optimistically and reconcile later.* Takes the order out of the
  settle-pending predicate, so a call that did not land would strand escrowed money with
  nothing left to settle it — the same failure `settlement.service.ts`'s `accept` doc-comment
  reasons through and rejects.
- *Write `onchain_tx_hash` in transaction A, before the call.* A hash for a transaction that
  may never exist, on the row the demo links to as *"the clickable proof."*

---

## R13 — The prompt-leak containment: a verbatim-run check on the ruling's reasoning

**Decision.** Before a verdict is persisted, `verdict-validation.ts` rejects it as a failed audit
(R7) if its `reasoning` reproduces a verbatim run of the pinned version's `system_prompt`:

```
normalise(s)  = casefold(collapse_whitespace(trim(s)))          // R4's normaliser, reused
leak(reasoning, prompt) ⟺
    ∃ window of ≥ LEAK_RUN_WORDS consecutive words in normalise(prompt)
      such that that window occurs in normalise(reasoning)
```

`LEAK_RUN_WORDS = 8`, a module constant. The check runs over `reasoning` only. It does not need
to run over `citations[].quote`, and the reason is structural: a citation's `source` is an enum of
`capability | exclusion | criterion` (FR-010, enforced on the wire), so the prompt is not a
citable source — and a quote that *did* carry prompt text would already fail R4's traceability
check, because it would not be found in any capability, exclusion, or criterion.

**Rationale.** `agent-definition.md` §4 puts the system prompt in Guardian's case file and states
the containment as an instruction to the auditor: *"Guardian's reasoning may describe execution
behaviour … but must never quote the prompt."* That is the right product rule with the wrong
enforcement mechanism, for the reason invariant #3 gives about itself: *"One serialiser, not a
rule to remember."* Here there is no serialiser to put the rule in — verdict reasoning is model
output that reaches the buyer with nothing in between — so the rule becomes a check on the way to
storage. §4's requirement is unchanged; only its enforcement is.

**Why a word-run rather than a similarity score.** A threshold on a similarity metric is a number
nobody can defend, and a near-miss under it is exactly the leak this exists to catch. A run of
eight consecutive normalised words is a yes/no question with a quotable answer: *"this ruling
reproduced eight consecutive words of the seller's instructions, so it was rejected."*

**Why eight.** Long enough that ordinary overlap between a prompt and a description of what the
agent did — *"extract the line items from the receipt"* appearing in both — does not trip it.
Short enough that a sentence lifted from the prompt does. The failure mode of getting it wrong is
asymmetric in the safe direction: too low rejects legitimate rulings, which a rehearsal surfaces
immediately; too high leaks, which it does not. Start at eight and lower it if a rehearsal shows
leaks, rather than raising it to make a rejection go away.

**⚠️ Paraphrase is explicitly not covered, and that is a product decision rather than an
oversight.** §4 permits reasoning that describes execution behaviour, and its own example — *"the
agent made one extraction attempt and stopped"* — is a paraphrase of what the prompt instructed. A
detector that caught paraphrase would reject the sentences §4 holds up as correct. The residual
risk is an auditor that closely restates the instructions without quoting them, and it is the same
risk the product doc accepted when it wrote the rule as an instruction. What changes is that the
**verbatim** path — the one that leaks the seller's actual words, and the one a seller would
recognise on sight — is closed structurally.

**Alternatives rejected.**
- *Instruction only, as §4 literally specifies.* Defensible, and one function cheaper. It leaves
  the product's single unredacted buyer-facing text protected by a sentence in a prompt.
- *Redact the offending span and persist the rest.* Editing a ruling makes the stored verdict
  differ from the one that was made — breaking replay (R12) — and can leave reasoning that argues
  from text no longer present.
- *Withhold the prompt from the auditor instead.* R6's withdrawn draft. Costs the
  intent-versus-effort judgment §4 requires.
- *Check at serialisation time rather than before persisting.* Then the leaked text is in the
  database and in the seller's copy, and every later read has to be filtered. Rejecting before the
  write means it never exists.

---

## R14 — Bounded attempts, a visible terminal failure, and the one migration

**Decision.** Three parts.

1. **Bound.** `GUARDIAN_MAX_AUDIT_ATTEMPTS = 3`. Each failed audit increments
   `orders.audit_attempts`; the audit-pending predicate gains `AND audit_attempts < 3`.
2. **Terminal, visible failure.** On the attempt that reaches the bound, `orders.audit_failed_at`
   is set. The order stays `disputed`. `GET /orders/:id/verdict` returns an explicit audit-failed
   body to both parties instead of the in-progress not-found (FR-044).
3. **Deadline.** Each audit is bounded by `GUARDIAN_AUDIT_TIMEOUT_MS` (default 180 000), armed as
   both the SDK's `timeout` request option and an `AbortController` on the same deadline — the
   two-timer construction `claude-agent-runner.ts` already uses, for the same reason: the first
   bounds the HTTP request, the second bounds the whole call including SDK-side work around it.

**⚠️ This costs the plan's "no migration" headline.** Two columns on `orders`:
`audit_attempts smallint NOT NULL DEFAULT 0` and `audit_failed_at timestamptz NULL`. That is the
honest price of FR-043 and FR-044, and it is better named than absorbed.

**Rationale.** The spec's original position was that an order which repeatedly fails audit stays
`disputed`, which *"is the correct-looking outcome for a dispute that could not be decided."*
That is wrong, and checking the surrounding system is what shows it:

- **No scheduled job touches a stuck dispute.** API-10's cron table is sweeper, reclaimer, and
  reaper; the reaper moves a `running` order past its timeout to `failed` and nothing else.
  `disputed` has no reaper.
- **The only backstop is the contract, and it is deliberately slow.**
  `DISPUTE_DEADLINE = 72 hours`, after which `forceResolve` is permissionless and settles at a
  fixed `Tier.Quarter`. That is the right answer for *"Guardian never ruled"* and it is
  unreachable during a rehearsal.
- **So the buyer's screen says a ruling is being prepared, forever, with nothing behind it.** An
  unbounded retry does not produce an order that looks *undecided*; it produces one that looks
  *in progress*. Those are different, and the second is the worse failure to have on stage,
  because nothing distinguishes it from a slow audit.

**Why the money is not freed.** The obvious alternative is to write a platform-authored ruling at
the quarter tier and settle — it matches `product-workflow.md` §7.4 (*"inconclusive evidence
resolves toward the seller — at 25%"*) and it matches what `forceResolve` does. Rejected because a
row in `verdicts` that Guardian did not author undermines the one claim the product makes, and it
would render on the verdict screen as a tier with an empty citation checklist: *"a tier alone is
an assertion"* wearing the costume of an audit. FR-041 and SC-013 state the rule positively —
**every ruling in the record was produced by the auditor.** An exhausted audit therefore leaves
the money escrowed until the contract's own deadline permits anyone to force-settle it, which is
the contract's existing answer for exactly this case.

**Why three attempts.** Enough that a transient refusal or a rate limit does not terminate a
dispute; few enough that a deterministically-failing case — a case file that always trips a safety
classifier, a schema the API always rejects — becomes visible in well under a minute at a
two-second poll interval, rather than burning model calls indefinitely.

**Retrying is not re-auditing, and invariant #8 is not in tension with this.** The invariant
refuses to re-audit an order *that already has a verdict*. A failed audit persists none, so
nothing was decided and nothing is being reopened. The `UNIQUE (order_id)` remains the guarantee
that a *decided* order is never audited again.

**Alternatives rejected.**
- *Unbounded retry (the original spec).* The silent forever-spinner, per above.
- *A fallback ruling at the quarter tier.* Frees the money and fabricates a verdict; see above.
- *A new terminal order state.* Would mean a migration on the `order_state` enum, a decision about
  whether the new state belongs in `ESCROWED_ORDER_STATES`, and a new word in a state machine four
  other specs reason about. Two columns carry the same information without touching the state
  machine — and the order genuinely *is* still disputed: the dispute is real and unresolved; what
  failed is our ability to rule on it.
- *Tracking attempts in memory.* Resets on restart, so a crash-looping order retries forever and
  the terminal state vanishes from the API on the next deploy — turning a visible failure back
  into a spinner. The thing being tracked has to outlive the process.
