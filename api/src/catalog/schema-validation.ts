import { Ajv2020 } from 'ajv/dist/2020';
import type { AnySchemaObject } from 'ajv/dist/2020';

import { InvalidJsonSchemaError } from './catalog.errors';

/**
 * The one Ajv instance this module uses, configured once at module load.
 *
 * ⚠️ **One instance, two callers, standing on opposite sides of a purchase.**
 * `assertValidJsonSchema` is the *seller's* gate: it runs when an agent is
 * listed or a new version is published, and it asks "is this document a JSON
 * Schema this platform can execute against?". `validateAgainstSchema` is the
 * *buyer's* gate: it runs when an order is being placed, and it asks "does this
 * submitted input satisfy that already-stored schema?". Different questions,
 * different failure meanings, different HTTP statuses — but deliberately the
 * same Ajv, because everything below about the dialect, the compile cache and
 * `$id` registration applies identically to both and is not worth writing down
 * twice. The reasons this instance is configured the way it is are the reasons
 * both callers need; see each function for how they diverge.
 *
 * ⚠️ **`Ajv2020` from `ajv/dist/2020`, never the default `ajv` export.** The
 * default export is draft-07; this one is draft 2020-12, and the dialect here
 * follows the schema's *next* consumer rather than its first. API-08 hands
 * `outputSchema` to the Anthropic API to constrain a seller agent's output, and
 * that ecosystem is 2020-12. Validating against a dialect the execution engine
 * will not honour lets a definition pass listing and then fail at run time — on
 * a paid order, where a failed run is indistinguishable from non-delivery and
 * therefore becomes evidence in a dispute (invariant #7). A seller's typo would
 * turn into a refund. (research R5)
 *
 * The two dialects are close enough that the mistake would not surface in
 * testing: `$defs`/`$ref`, `prefixItems`, and `dependentRequired` are the sort
 * of thing that quietly means something different, or nothing at all, under
 * draft-07. That is exactly why this import is spelled out rather than left to
 * whichever export happened to be convenient.
 *
 * **`strict: false`**, because a seller's schema is theirs. Ajv's strict mode
 * rejects unknown keywords and several legal-but-unusual constructions —
 * annotations a seller's own tooling emits, a `type` Ajv thinks is redundant
 * next to a `const`. Refusing a seller's schema over a keyword Ajv has an
 * opinion about is the platform overreaching into a document it does not own.
 * The bar this module enforces is "the execution engine will be able to use
 * this", not "Ajv approves of the style".
 */
const ajv = new Ajv2020({ strict: false });

/**
 * Throws `InvalidJsonSchemaError` unless `value` is a JSON Schema this platform
 * can actually execute against. Returns nothing on success — an assertion, not
 * a predicate, because every call site wants the failure to abort the request
 * rather than to be branched on.
 *
 * `field` is the name of the body property being checked and is carried
 * straight through to the error, so the controller can produce the `400`
 * naming the offending schema that FR-008 requires without re-validating to
 * find out which of the two it was.
 *
 * ---
 *
 * **Three checks, in this order, each catching something the others do not.**
 *
 * **1. Is it a plain object?** Refused up front, before Ajv sees it.
 *
 * ⚠️ A bare `true` (and a bare `false`) *is* a valid JSON Schema — `true`
 * accepts everything, `false` accepts nothing — and Ajv will happily compile
 * either. We refuse them anyway, deliberately. The column is `jsonb` holding an
 * object; the UI's form builder reads `properties` off the stored document to
 * render an order form, and there is no form to render for `true`. An agent
 * whose `outputSchema` is `true` also constrains the model to nothing at all,
 * which is the opposite of why API-08 is handed the schema. So the narrower
 * rule — a plain object, always — is the honest one: everything this platform
 * does with these documents assumes an object, and accepting a boolean here
 * would only move the failure to a place with less context to explain it.
 *
 * `null` (`typeof null === 'object'`), arrays, strings and numbers are refused
 * by the same guard, for the ordinary reason that none of them is usable as an
 * agent's input/output contract.
 *
 * **2. `validateSchema` — the document against the meta-schema.** This is the
 * check that catches `{ "type": "strig" }` and `{ "required": "name" }`.
 * It returns `false` and populates `ajv.errors` rather than throwing, which is
 * what lets the message below carry Ajv's JSON Pointer to the exact offending
 * keyword instead of a stack trace.
 *
 * (Ajv's `compile` meta-validates internally too, so step 2 is not the only
 * thing standing between a malformed document and the database. It is here to
 * run *first* and to fail *cleanly*: a document that is both malformed and has
 * a broken `$ref` should be reported as malformed, and `errorsText` is a better
 * sentence than the error `compile` throws on the way past.)
 *
 * **3. `compile` inside a `try` — the operation API-08 will actually perform.**
 * This is what resolves `$ref`. A schema with an unresolvable
 * `$ref: "#/$defs/Missing"` passes step 2 — the meta-schema only says a `$ref`
 * must be a URI reference, not that it must point at anything — and throws
 * here. Learning that at listing time is worth a great deal more than learning
 * it mid-order.
 *
 * ---
 *
 * ⚠️ **Why `removeSchema` is called and is not optional hygiene.**
 * `compile()` stores the compiled result in the instance's cache keyed by the
 * schema *object identity*, and every request body is a freshly parsed object,
 * so nothing is ever a cache hit and nothing is ever evicted — one retained
 * entry per schema ever submitted, for the life of the process. At demo scale
 * that is a rounding error; at real scale it is a leak, and it is the kind that
 * only shows up in a long-lived process under load.
 *
 * The second half is sharper than the leak. `compile()` also registers the
 * schema under its `$id` when it has one, and a *second* schema arriving with
 * the same `$id` makes Ajv throw
 * `schema with key or id "…" already exists` — which is not a validation
 * failure at all, but which would be reported to the second seller as though
 * their schema were invalid. Two sellers both starting from the same
 * copy-pasted example is not an exotic scenario; it is the likely one.
 *
 * `removeSchema(schema)` — the object form, not the no-argument form — deletes
 * exactly this schema's cache entry and `$id` registration. The no-argument
 * form clears the *whole* cache, which would also discard the compiled
 * meta-schemas and make every subsequent call pay to rebuild them. It runs in a
 * `finally` so a schema that threw during compilation is cleaned up too;
 * failing to remove it on the throw path is precisely how the duplicate-`$id`
 * error above would start firing on retries of a schema that never succeeded.
 */
export function assertValidJsonSchema(
  value: unknown,
  field: 'inputSchema' | 'outputSchema',
): void {
  // 1. Shape. See the note on bare booleans above — this is narrower than
  //    JSON Schema allows, on purpose.
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new InvalidJsonSchemaError(
      `${field} must be a JSON Schema object`,
      field,
      `expected a JSON object, received ${describe(value)}`,
    );
  }

  const schema = value as AnySchemaObject;

  // 2. Meta-schema. `validateSchema` returns a promise rather than a boolean
  //    for an `$async` schema, so the test is against the literal `true` — a
  //    promise is not a passing result here, it is a document this platform
  //    has no way to execute.
  if (ajv.validateSchema(schema) !== true) {
    throw new InvalidJsonSchemaError(
      `${field} is not a valid JSON Schema (draft 2020-12)`,
      field,
      ajv.errorsText(ajv.errors, { dataVar: field }),
    );
  }

  // 3. Compilation. The `$ref`-resolving step, and the one API-08 repeats.
  try {
    ajv.compile(schema);
  } catch (err) {
    throw new InvalidJsonSchemaError(
      `${field} is a well-formed schema that cannot be compiled`,
      field,
      err instanceof Error ? err.message : String(err),
    );
  } finally {
    // Both on success and on the throw path — see the warning above.
    ajv.removeSchema(schema);
  }
}

/**
 * Checks a buyer's submitted `input` against a seller's stored `inputSchema`,
 * and reports the verdict instead of enforcing it.
 *
 * ⚠️ **Not the same job as `assertValidJsonSchema`, despite the shared file and
 * the shared Ajv.** That function validates a *document as a schema* — is this
 * thing a JSON Schema at all — and runs when a seller lists an agent or
 * publishes a version. This one validates *data against a schema* — does this
 * order's payload fit the contract the seller already published — and runs when
 * a buyer purchases. The two are one keystroke apart in Ajv's API
 * (`validateSchema` vs `compile` + call) and worlds apart in meaning: a failure
 * of the first is the seller's mistake, a failure of the second is the buyer's,
 * and confusing them produces a `400` blaming the wrong party. They sit
 * together anyway because they need the same instance, not because they are
 * variations on one idea.
 *
 * This completes the module's use of Ajv. `validateSchema` was the seller's
 * half; `compile()` + calling the result is the buyer's. `compile()` appears in
 * both, for different reasons: there it is a *check* whose return value is
 * discarded (does the schema's `$ref` resolve), here it is the thing we
 * actually want.
 *
 * ---
 *
 * **It returns rather than throws, unlike its neighbour.**
 * `assertValidJsonSchema` is an assertion because every caller wants the
 * request aborted. This one has exactly one caller — the purchase flow in
 * `orders/` — and that caller must turn a failure into a `400` naming the
 * request field the input arrived on, which is a decision only it can make:
 * `input` is *its* body property, not the catalogue's, and the catalogue has no
 * business inventing a field name for a DTO it never sees. Handing back a
 * discriminated result keeps that ownership where it belongs, and lets the
 * caller decide the failure is worth a metric or a log line before it turns it
 * into a status code. (FR-003)
 *
 * `dataVar: 'input'` makes Ajv's message read `input/quantity must be integer`
 * rather than `data/quantity must be integer`, and the pointer is the entire
 * value of returning Ajv's own text unedited: it tells a buyer *where* in a
 * nested payload the mismatch is. A rewritten "invalid input" would be a
 * shorter sentence that costs the buyer the debugging session. (Same reasoning
 * as `InvalidJsonSchemaError`'s `detail`.)
 *
 * ---
 *
 * ⚠️ **Why this lives in `catalog/` and shares the instance, rather than in
 * `orders/` with an Ajv of its own.** The docblock on `ajv` above reasons
 * carefully about three things that are each easy to get subtly wrong and
 * silently: the 2020-12 dialect (a draft-07 instance would *accept* the same
 * schemas while quietly ignoring `prefixItems` and friends, so a buyer's
 * malformed input would sail past validation and fail later, mid-order, on a
 * paid escrow), `strict: false`, and the `removeSchema` discipline below. A
 * second instance in `orders/` would be a second copy of that reasoning, kept
 * in sync by nobody, and its divergence would show up as *accepted bad orders*
 * rather than as a crash.
 *
 * The cross-module import that buys this is a pure function, not a provider —
 * `orders/` imports a function, not `CatalogModule`, and takes on no DI edge,
 * no circular-module risk and nothing to mock. That is a cheap enough coupling
 * to prefer over a duplicated Ajv.
 *
 * ---
 *
 * ⚠️ **A `compile()` throw here means a stored schema, not a submitted one.**
 * The schema arrives from the `agent_versions` row, and it only got there by
 * passing all three of `assertValidJsonSchema`'s checks — including `compile()`
 * — at listing time. So a throw at *this* point is not "the seller sent
 * rubbish"; it is a schema that compiled once and does not any more: an Ajv
 * upgrade that tightened a keyword, a hand-edited row, a restore from a dump.
 * It is a real defect and it is nobody's fault in this request.
 *
 * It is still returned as `{ valid: false }` rather than allowed to escape,
 * because the alternative is a `500` on a purchase. A `500` tells the buyer to
 * retry, and the retry will fail identically forever, while the seller — the
 * only person who can fix it, by republishing the version — never learns. A
 * `400` carrying Ajv's compile message is the honest answer to "can this order
 * be placed": no, and here is the reason. The message is prefixed so nobody
 * reading a support ticket mistakes an unusable stored schema for a buyer's
 * typo, since those two need opposite remedies.
 *
 * The `catch` also covers a throw from `validate()` itself (an `$async` schema
 * that slipped through returns a promise rather than a boolean, and a rejected
 * one would surface here). Same argument: on a purchase path, no schema problem
 * of any shape should become a `500`.
 *
 * ⚠️ **`removeSchema` in a `finally`, for the reasons spelled out under
 * `assertValidJsonSchema` — and they bite harder here.** Every request loads
 * this schema fresh from Postgres, so it is a new object each time and never a
 * cache hit; without the removal the instance accumulates one compiled entry
 * per order placed, forever. Worse, the `$id` registration is per-instance and
 * this instance is shared: two sellers who both started from the same
 * copy-pasted example share an `$id`, and the second agent purchased would fail
 * to compile with `schema with key or id "…" already exists` — a buyer refused
 * because of an unrelated seller's document. The object form of the call, never
 * the no-argument form, which would drop the compiled meta-schemas too.
 */
export function validateAgainstSchema(
  schema: Record<string, unknown>,
  data: unknown,
): { valid: true } | { valid: false; errors: string } {
  // The cast is the same one `assertValidJsonSchema` makes: Ajv's `SchemaObject`
  // declares `$id?: string`, which an index signature of `unknown` does not
  // satisfy. Sound in practice because this document already passed that
  // function's three checks before it was stored.
  const schemaObject = schema as AnySchemaObject;

  try {
    const validate = ajv.compile(schemaObject);

    if (validate(data)) {
      return { valid: true };
    }

    return {
      valid: false,
      errors: ajv.errorsText(validate.errors, { dataVar: 'input' }),
    };
  } catch (err) {
    // Not a buyer error — see the warning above. Prefixed so it cannot be read
    // as one.
    return {
      valid: false,
      errors: `the agent's stored input schema could not be compiled: ${
        err instanceof Error ? err.message : String(err)
      }`,
    };
  } finally {
    // On the throw path too: a schema left half-registered under its `$id` is
    // exactly how the duplicate-`$id` failure starts firing on retries.
    ajv.removeSchema(schemaObject);
  }
}

/**
 * Names what arrived instead of an object, for the `detail` on the shape
 * refusal. `typeof` alone reports `"object"` for both `null` and an array,
 * which are the two cases a seller is most likely to have actually sent, so
 * this spells those out rather than leaving the message technically true and
 * practically useless.
 */
function describe(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'an array';
  return `a ${typeof value}`;
}
