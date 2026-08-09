# Contract: the structured-output schema

**Module**: `src/guardian/verdict.schema.ts` · **Used by**: `claude-auditor.ts` (request),
`verdict-validation.ts` (post-decode gates), `guardian.repository.ts` (insert)

This is the contract between the model and the database. It is enforced in three places, and it
is worth being precise about which guarantee comes from which — because **most of the Zod schema
never reaches the API**, and which parts survive is not what you would guess. §2 has the verified
answer.

---

## 1. The schema

```ts
import { z } from 'zod';

export const CitationSchema = z.object({
  source: z.enum(['capability', 'exclusion', 'criterion']),
  quote:  z.string(),
  met:    z.boolean(),
});

export const VerdictSchema = z.object({
  tier:      z.enum(['0', '25', '50', '75', '100']),
  reasoning: z.string(),
  citations: z.array(CitationSchema).min(1),
});

export type AuditedVerdictRaw = z.infer<typeof VerdictSchema>;
```

Sent as:

```ts
const response = await client.messages.parse({
  model: GUARDIAN_MODEL,                 // 'claude-opus-5'
  max_tokens: GUARDIAN_MAX_TOKENS,
  system: [{ type: 'text', text: GUARDIAN_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
  messages: [{ role: 'user', content: JSON.stringify(caseFile) }],
  output_config: { format: zodOutputFormat(VerdictSchema) },
});
```

**No `temperature`, `top_p`, or `top_k`** — all three return **400** on Opus 5. This is not a
style preference; it is the reason verdicts are persisted and replayed rather than recomputed
(`docs/tech-stack.md` §5, invariant #8).

---

## 2. ⚠️ What the wire schema does and does not enforce

`zodOutputFormat` runs `z.toJSONSchema()` then `transformJSONSchema()`, which builds the wire
schema by **whitelist**: it copies the keys structured outputs support and silently drops the
rest. So `minLength`, `maximum`, and `pattern` never reach the API. **`minItems` is the
exception** — `lib/transform-json-schema.js:93` passes it through when its value is `0` or `1`,
which is exactly our case.

| Constraint | Where it is actually enforced | Failure mode |
| --- | --- | --- |
| `tier` is one of five | ⚠️ **The client-side Zod parse.** `enum` is **not** on the transform's whitelist — it is demoted to a `description` string (see below) | **Reachable.** `'37'` can be returned; the parse rejects it as gate 3 |
| `source` is one of three | ⚠️ **The client-side Zod parse.** Same demotion | **Reachable**, same as above |
| `citations` is an array of objects with those three keys | **The API.** Object shape and `required` are supported | Not representable |
| `reasoning` is a string | **The API** | Not representable |
| **`citations` has ≥ 1 element** | **The API.** `.min(1)` → `minItems: 1`, which survives the transform | **Not representable.** A zero-citation ruling cannot be returned |

**Verified against `@anthropic-ai/sdk@0.116.0` by running `zodOutputFormat` on the real schema.**
The emitted wire schema for `tier` is:

```json
{ "type": "string", "description": "{enum: [\"0\",\"25\",\"50\",\"75\",\"100\"]}" }
```

The permitted values survive **only as prose in a description**. The transform's whitelist is
`type` / `anyOf` / `oneOf` / `allOf` / `description` / `title` / `properties` /
`additionalProperties` / `required` / `format` / `items` / `minItems` — and `enum` is not in it.

⚠️ **So the client-side parse is load-bearing and must never be removed as redundant.** It is the
only thing standing between an off-menu tier and a stored ruling.

> ⚠️ **An earlier draft of this section said the opposite** — that `.min(1)` is stripped and
> client-side only, making a zero-citation response a reachable runtime failure. That was wrong,
> and it nearly led to dropping `.min(1)` from the schema as decorative. `.min(2)` *would* have
> been dropped; `.min(1)` is not. Read the transform, don't reason from the general rule.

Two consequences the implementation still carries:

1. **`response.parsed_output` can be `null`,** and the parse can still throw on the *shape*.
   Neither is a crash — both are `AuditFailedError` (§5). Do not dereference `parsed_output`
   without checking.
2. **A client-side validation failure throws `AnthropicError`, not `ZodError`.** The helper
   catches Zod's error and rewraps it with formatted issues. Catch the SDK's type.

`transformJSONSchema` also **forces `additionalProperties: false` onto every object** (`:73`).
That matters here for a reason discovered elsewhere: the execution engine's verification run
found **every** seeded agent schema refused at run time for omitting exactly that, because that
path hands the *seller's* schema to `messages.create` untransformed. Generating our schema
through the helper means this feature cannot hit that defect — an unplanned second justification
for choosing `messages.parse()` over a hand-written schema.

Operationally: a new schema incurs a one-time compilation cost on first use, then is cached for
24 hours. The first audit after a deploy is slower than the rest. That is latency, not failure —
do not mistake it for a hang during a rehearsal.

---

## 3. `tier` is a string enum, mapped through a table

The wire value is `'0' | '25' | '50' | '75' | '100'`. The database value is `VerdictTier`. The
mapping is an exhaustive `Record`, not a cast:

```ts
const VERDICT_TIER_BY_WIRE: Record<AuditedVerdictRaw['tier'], VerdictTier> = {
  '0':   VerdictTier.None,
  '25':  VerdictTier.Quarter,
  '50':  VerdictTier.Half,
  '75':  VerdictTier.ThreeQuarter,
  '100': VerdictTier.Full,
};
```

This is the same construction — and the same argument — as `src/chain/tier.ts`. `Record<K, V>`
requires every member of `K`, so a sixth tier fails to compile here rather than producing
`undefined` and a wrong-but-plausible ruling. That file's warning applies verbatim: the two
enumerations agree in *order* but not in *name*, and *"a tier silently shifted by one produces
a real, wrong refund percentage, and nothing about the mistake looks wrong until someone is
watching the number land."*

The wire enum uses percentage strings rather than `'none' | 'quarter' | …` because the rubric
the model reads is written in percentages (product §4.2), and the value it emits should be the
value it was asked to choose.

**Three enumerations now describe the same five outcomes**, each in its own vocabulary:

| Wire (`verdict.schema.ts`) | Database (`entities/enums.ts`) | Contract (`chain/types.ts`) | Refund |
| --- | --- | --- | --- |
| `'0'` | `none` | `Tier.NoRefund` | 0% |
| `'25'` | `quarter` | `Tier.Quarter` | 25% |
| `'50'` | `half` | `Tier.Half` | 50% |
| `'75'` | `three_quarter` | `Tier.ThreeQuarter` | 75% |
| `'100'` | `full` | `Tier.Full` | 100% |

Wire → database is this file. Database → contract is `chain/tier.ts`. **Neither hop is a cast**,
and there is no direct wire → contract path.

---

## 4. Citation traceability (FR-012)

After decoding, `verdict-validation.ts` checks every citation against the case file. A citation
whose quote cannot be traced to the clause it names fails the **whole audit** — it is not
dropped, and the verdict is not repaired.

| `source` | Matched against |
| --- | --- |
| `capability` | each element of `caseFile.capabilities` |
| `exclusion` | each element of `caseFile.exclusions` |
| `criterion` | `caseFile.acceptanceCriteria` (**one string**, not an array) |

```
normalise(s) = casefold(collapse_whitespace(trim(s)))
pass ⟺ ∃ clause of the named kind : normalise(quote) ⊆ normalise(clause)
```

Normalised substring rather than exact equality, because the failure modes are asymmetric: a
model reproducing a clause across a line wrap is quoting faithfully and must not be rejected,
while a model inventing a clause does not accidentally land inside the real text. Substring
rather than equality, because a citation legitimately quotes the relevant sentence of a
multi-sentence criterion. Full argument in `research.md` R4.

**Why the whole audit fails rather than the citation being dropped:** silently editing a
verdict makes the stored ruling differ from what the model produced — which breaks the replay
property that invariant #8 exists to provide — and the surviving `reasoning` may still argue
from the citation that was removed.

---

## 5. The gates, in order

Every one of these produces `AuditFailedError`. **None produces a partial verdict, and none is
repaired.** `GuardianService` catches it, writes nothing, leaves the order `disputed`, and the
next poller tick retries (FR-017).

| # | Gate | Detection |
| --- | --- | --- |
| 1 | **Refusal** | `response.stop_reason === 'refusal'` — an HTTP **200**, checked **before any content block is read**. Opus 5 ships elevated safety classifiers and the inputs here are buyer- and seller-authored prose |
| 2 | **Truncation** | `response.stop_reason === 'max_tokens'`. Thinking is on by default on Opus 5 and `max_tokens` bounds thinking + output together |
| 3 | **Unusable structure** | `parsed_output === null`, or the parse throws `AnthropicError`. ⚠️ Carries more than shape: the **tier and source enums** are enforced here, not on the wire (§2). The citation *count* is the wire's job |
| 4 | **Untraceable citation** | §4 |
| 5 | **Non-delivery floor** | `caseFile.delivered === false` and `tier !== full` (FR-014, R10) |
| 6 | **Deadline** | `GUARDIAN_AUDIT_TIMEOUT_MS` exceeded — armed as both the SDK `timeout` option and an `AbortController` on the same deadline (R14) |
| 7 | **⚠️ Prompt leak** | `reasoning` reproduces a run of ≥ 8 consecutive normalised words from `caseFile.systemPrompt` (FR-042, R13) |
| 8 | **Transport** | any `Anthropic.APIError` or abort |

Gates 1 and 2 run before `content` is touched. A refusal is a normal 200 with an empty or
partial `content` array; indexing `content[0]` unconditionally throws on `undefined` and
reports "the audit crashed" for what is really "the auditor declined."

**Gate 7 is the containment for showing the auditor the seller's prompt** (`guardian-case-file.md`
§3). It reads `reasoning` only: `quote` is structurally safe because a citation's `source` enum
does not admit the prompt, and a quote carrying prompt text would already fail gate 4. It matches
verbatim runs, not paraphrase — `agent-definition.md` §4 explicitly permits reasoning that
describes execution behaviour, so a paraphrase detector would reject legitimate rulings.

**Gate 6 exists because one audit occupies the worker's only slot.** An unbounded call does not
just lose one dispute; it stops every later dispute from being decided (SC-012).

The SDK is constructed with **`maxRetries: 0`**. An audit is the one operation in the product
that is supposed to happen exactly once (product §4.4); retry logic buried in an HTTP client is
the wrong place for anything with that property. The poller is the retry, it is visible, and it
is **bounded at three attempts** (R14) — after which the order is marked audit-failed and
reported as such rather than retried forever.

---

## 6. ⚠️ Logging discipline

Every log line this module writes carries the order id, the model, the duration, and the failure
class — and **never** the case file, the request body, the response body, or `reasoning`.

`claude-agent-runner.ts` states why this matters more here than almost anywhere else: a
`logger.error(err)` goes *around* every serialiser the system has. This module's inputs are
already redacted (`guardian-case-file.md`), so the exposure is smaller than execution's — but
`reasoning` and `quote` are the buyer's and seller's dispute correspondence, and a rehearsal log
is not a place to reproduce it. When mapping an SDK error, log the error's class name and HTTP
status only: the API's error body can echo fragments of the request that produced it. The raw
message stays attached as `cause` on the thrown `AuditFailedError` for local debugging.

---

## 7. From decoded verdict to row

Once all six gates pass:

```ts
{
  orderId,
  tier:        VERDICT_TIER_BY_WIRE[raw.tier],
  refundMinor: refundMinorFor(tier, order.priceMinor),   // refund.ts — a record, not a payment
  reasoning:   raw.reasoning,                            // VERBATIM
  citations:   raw.citations,                            // VERBATIM, in the model's order
  verdictHash: verdictHash({ … }),                       // 32 bytes, computed ONCE (R5)
  model:       GUARDIAN_MODEL,
  onchainTxHash: null,                                   // until settlement lands
}
```

**`reasoning` and `citations` are stored exactly as returned.** No trimming, no reordering, no
normalisation — the normalisation in §4 is used for *comparison* and never written. The stored
row must be the ruling that was made, because it is the ruling that will be replayed and the
ruling the fingerprint commits to.
