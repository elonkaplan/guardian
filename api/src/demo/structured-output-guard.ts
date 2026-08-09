import { DemoDefinitionUnusableError } from './demo.errors';

/**
 * Throws `DemoDefinitionUnusableError` unless every `"type": "object"` subschema
 * anywhere in `schema` sets `"additionalProperties": false` explicitly. Returns
 * nothing on success — an assertion, not a predicate, because the only caller
 * wants the whole seed aborted rather than a boolean to branch on.
 *
 * ---
 *
 * **Why this exists.** The Anthropic structured-outputs API refuses such a
 * schema at run time, with exactly this:
 *
 * ```
 * output_config.format.schema: For 'object' type, 'additionalProperties' must be explicitly set to false
 * ```
 *
 * Ajv — which `catalog/schema-validation.ts` runs at listing time — is more
 * permissive and accepts the same document happily. The gap between the two
 * acceptance sets is the whole problem: a definition **passes listing validation
 * and is refused at execution**, on a paid order, where the refusal arrives as a
 * failed run rather than as a validation error anybody can act on.
 *
 * ⚠️ **This project has already hit it, at full cost.** The execution engine's
 * verification run failed all thirteen of its orders identically on this message
 * — confirmed against the live service in both directions. The engine behaved
 * correctly (a recorded failure naming the definition), which is what made it
 * expensive to read: every act failed for a reason unrelated to what the act was
 * demonstrating. This guard is that finding turned into a check that runs before
 * the first `createAgent`, so the same mistake costs a `500` on a seed call
 * instead of thirteen orders (research R6, FR-004, FR-005).
 *
 * ⚠️ **It applies to nested objects, not only the root.** The root is the one
 * everybody remembers. The object schema inside `lineItems.items` is the one
 * that gets missed — it is a `type: "object"` two levels down whose sibling
 * keywords all look complete — and missing it fails Act 2 specifically, which is
 * the act that reads a list of line items. That is why this walks the document
 * rather than checking the top-level keys.
 *
 * ---
 *
 * ⚠️ **Why this lives in `demo/` and is deliberately NOT added to
 * `catalog/schema-validation.ts`.** That is the obvious home for it, and putting
 * it there would be a real improvement — every seller would get the check, not
 * just this feature's three fixtures. It is left undone here on purpose: doing it
 * there changes **what the marketplace accepts from every seller**, which is a
 * decision belonging to the catalogue feature and its listing contract, not to a
 * feature whose job is authoring demo content. A content-authoring change that
 * silently tightens the platform's public acceptance rules is a blast radius
 * nobody asked for. Worth raising as its own change; not worth widening this one.
 * (research R6.)
 *
 * `guardian/verdict.schema.ts` solves the identical problem from the other end,
 * for a schema the platform authors rather than validates: its Zod-to-JSON-Schema
 * transform *forces* the flag onto every object it emits. Same answer, applied
 * where the schema is generated instead of where it is checked. Neither helps the
 * seller-authored path, which hands a hand-written schema to `messages.create`
 * untransformed — which is why that path is where the thirteen failures came
 * from.
 *
 * ---
 *
 * `field` names the schema being checked (`'outputSchema'`) and is carried
 * straight to the error alongside the pointer, so the refusal reads
 * `outputSchema at #/properties/lineItems/items` — the field says which document
 * and the pointer says where inside it. A message without the pointer is the
 * thing this function exists to avoid: "a seeded schema is invalid" at 3am, with
 * three hand-written fixtures to read.
 *
 * ⚠️ **It reports the first offender, not all of them.** The walk throws on the
 * first object it finds in document order, so a fixture with two missing flags
 * takes two runs to fix. That is deliberate — the alternative is an error type
 * carrying a list, for a call site whose response to any non-empty list is the
 * same — but it does mean "the guard passed after I fixed the pointer it named"
 * is the only proof that a schema is clean, not "I fixed the one it named".
 */
export function assertStructuredOutputCompatible(
  schema: Record<string, unknown>,
  field: string,
): void {
  walk(schema, '#', field);
}

/**
 * Depth-first, root before children, so the reported pointer is the outermost
 * offender on any path rather than whichever leaf the recursion reached first.
 *
 * `node` is `unknown` because every value reached below arrives from a `jsonb`
 * document: a subschema position may legally hold a boolean (`true` and `false`
 * are both valid schemas — `true` accepts anything, `false` nothing), and it may
 * illegally hold a string somebody typed by hand. Both are skipped rather than
 * refused. This function's job is one specific incompatibility with one specific
 * API, not a second opinion on whether the document is a schema at all — that is
 * `assertValidJsonSchema`'s job, it has already run, and duplicating it here
 * would produce two different sentences for the same defect.
 */
function walk(node: unknown, pointer: string, field: string): void {
  if (!isSchemaObject(node)) {
    return;
  }

  if (declaresObjectType(node) && node['additionalProperties'] !== false) {
    throw new DemoDefinitionUnusableError(
      `${field} at ${pointer} declares "type": "object" without ` +
        `"additionalProperties": false; the structured-output API refuses such a ` +
        `schema at execution time, after the order has been paid for`,
      field,
      pointer,
    );
  }

  walk(node['items'], `${pointer}/items`, field);

  // `additionalProperties` is a subschema position too, and the interesting case
  // is `{ "type": "object", "additionalProperties": { "type": "object", … } }`:
  // the outer object passes nothing (it is not `false`) — so it throws above and
  // this line is never reached for it — but a valid outer form such as an
  // `allOf` branch can still carry a nested object schema here. Booleans fall out
  // in `isSchemaObject`.
  walk(node['additionalProperties'], `${pointer}/additionalProperties`, field);

  walkValues(node['properties'], `${pointer}/properties`, field);
  walkValues(node['patternProperties'], `${pointer}/patternProperties`, field);
  walkValues(node['$defs'], `${pointer}/$defs`, field);
  walkValues(node['definitions'], `${pointer}/definitions`, field);

  walkItems(node['allOf'], `${pointer}/allOf`, field);
  walkItems(node['anyOf'], `${pointer}/anyOf`, field);
  walkItems(node['oneOf'], `${pointer}/oneOf`, field);
  walkItems(node['prefixItems'], `${pointer}/prefixItems`, field);

  // Draft-07's tuple form: `items` as an array rather than a single schema. The
  // single-schema call above skipped it (an array is not a schema object), so it
  // is handled here. 2020-12 spells this `prefixItems`, but the seller-authored
  // documents this guard protects are hand-written and the older spelling is what
  // most examples on the internet still show.
  walkItems(node['items'], `${pointer}/items`, field);

  // ⚠️ **This keyword list is not exhaustive, and the miss direction is a false
  // pass.** `not`, `if`/`then`/`else`, `contains`, `propertyNames` and
  // `unevaluatedProperties` are subschema positions too, and an object hidden in
  // one of them sails through here and is refused at execution — exactly the
  // failure this file exists to prevent, just rarer. They are left out because
  // nothing in `fixtures.ts` uses them, and adding one is a single line here. If
  // this guard is ever promoted out of `demo/` and applied to seller-authored
  // schemas (see the scope note above), completing the list stops being
  // optional: a seller will eventually write one of them.
}

/**
 * A keyword position holding a map of caller-chosen name → subschema, hence the
 * pointer escaping.
 */
function walkValues(node: unknown, pointer: string, field: string): void {
  if (!isSchemaObject(node)) {
    return;
  }

  for (const [key, value] of Object.entries(node)) {
    walk(value, `${pointer}/${escapePointerToken(key)}`, field);
  }
}

function walkItems(node: unknown, pointer: string, field: string): void {
  if (!Array.isArray(node)) {
    return;
  }

  node.forEach((element, index) => walk(element, `${pointer}/${index}`, field));
}

/**
 * ⚠️ `"type": ["object", "null"]` is an object as far as the API's rule is
 * concerned — the union form is how a nullable object is spelled, it is a shape
 * a hand-written fixture reaches for, and reading only the string form would let
 * precisely that schema through.
 */
function declaresObjectType(node: Record<string, unknown>): boolean {
  const type = node['type'];

  return type === 'object' || (Array.isArray(type) && type.includes('object'));
}

/**
 * Excludes `null` (`typeof null === 'object'`), arrays, and the booleans that are
 * legal subschemas — see the note on `walk`'s `node` parameter for why none of
 * those is an error here.
 */
function isSchemaObject(node: unknown): node is Record<string, unknown> {
  return typeof node === 'object' && node !== null && !Array.isArray(node);
}

/**
 * RFC 6901 escaping, in this order: `~` before `/`, because doing it the other
 * way round would re-escape the tildes the first pass just introduced and turn
 * `a/b` into `a~01b`.
 *
 * Property names containing either character are unlikely in a schema somebody
 * wrote by hand, which is the argument for doing this properly rather than
 * concatenating: an unescaped pointer is not a *wrong* pointer in an obvious
 * way, it is one that silently stops resolving in whatever tool the reader
 * pastes it into.
 */
function escapePointerToken(token: string): string {
  return token.replace(/~/g, '~0').replace(/\//g, '~1');
}
