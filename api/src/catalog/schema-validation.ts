import { Ajv2020 } from 'ajv/dist/2020';
import type { AnySchemaObject } from 'ajv/dist/2020';

import { InvalidJsonSchemaError } from './catalog.errors';

/**
 * The one Ajv instance this module uses, configured once at module load.
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
