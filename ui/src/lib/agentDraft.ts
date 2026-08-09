/**
 * The create-agent form's judgement, in one pure module.
 *
 * Pure on the same grounds `ledger.ts`, `verdict.ts`, and `orderState.ts` are
 * here on: no React, no fetch, no module-level mutable state, and rules that
 * more than one caller must not be free to disagree about. The two schema
 * fields are the clearest case — two textareas with two inline copies of the
 * same rule is precisely how they end up refusing different things.
 *
 * Deliberately **not** an addition to `lib/inputSchema.ts` (research R11).
 * That module reads a seller's schema and builds a *buyer's* form out of it;
 * this one writes a seller's schema. They point in opposite directions, and
 * the one function that looks reusable — `parseRawInput` — is wrong here in
 * both its shape check and its wording: it exists for a buyer's input
 * *document* and says "Enter this agent's input as JSON." A seller pasting a
 * broken output schema would be told to enter an input. Generalising it with a
 * subject parameter would couple the buy panel to the authoring form so that
 * every change to one has to be checked against the other, for the sake of
 * four shared lines.
 *
 * **Nothing here throws, for any input.** Same rule as `parseUsd`, for the same
 * reason: every one of these functions sits behind a control a person is
 * actively typing into, where a half-pasted `{ "type":` is an ordinary
 * keystroke rather than exceptional input. Every refusal comes back as a plain
 * sentence meant to be read on screen, not a code meant to be logged.
 */

import type { CreateAgentRequest } from '../api/types';
import { parseUsd } from './money';

/**
 * The seller's ceiling sentence, and the whole reason `parseUsd` grew an
 * options argument (research R14).
 *
 * `TREASURY_CEILING_CENTS` guards the same thing in both places — a slipped
 * decimal point at the same order of magnitude — so the *number* stays shared
 * and no second constant is invented here, which would imply this product has
 * a pricing policy it does not have. Only the sentence differs, because the
 * parser's default one is about the demo treasury and the treasury does not
 * pay for listings. A seller who types `50000` meaning `500.00` should not be
 * corrected with a sentence about somebody else's wallet.
 */
const PRICE_CEILING_MESSAGE =
  'Enter a price under $10,000 — anything higher is almost certainly a slipped decimal.';

export type SchemaParse =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; message: string };

/**
 * A local predicate rather than one imported from `inputSchema.ts`, where the
 * identical three-line check is private. Exporting it from there to reach it
 * from here would put a shared dependency between two modules that R11 keeps
 * apart on purpose, and the cost of the duplication is three lines that cannot
 * change meaning.
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * One of the two contract textareas, checked for **well-formedness and
 * object-ness, and nothing else** (research R12).
 *
 * The object-ness check is not schema validation creeping in. It is the same
 * fact `JsonSchema`'s own comment records: every keyword this app ever reads
 * off a schema — `type`, `properties`, `required` — lives on an object, so an
 * array or a bare string at the top level has nowhere to put any of them. A
 * seller who pastes `[1, 2, 3]` has made a mistake that can be named here,
 * precisely, before it becomes a listing whose buy form renders as an
 * unexplained raw-JSON fallback.
 *
 * Past that, nothing — no `type`, no `properties`, no `$schema`. There is a
 * real JSON Schema validator upstream (`API-06` scopes exactly that work), the
 * `jsonb` column is unvalidated at the database level on purpose, and the
 * backend is the party that knows what a valid contract is. A second opinion
 * in the browser is one that eventually disagrees with the real one — refusing
 * a listing the platform would have accepted, with nothing to override it
 * with, mid-demo. This is the argument `BuyPanel` makes about affordability
 * and `validateFields` makes about input, pointed at schemas.
 *
 * That is FR-016 and FR-017 together, and FR-017 is the sharp half: `{}` is
 * **accepted**. It is well-formed and it is an object; whether it is a
 * *useful* schema is not this form's call to make.
 *
 * `subject` exists so that a broken output contract does not say "input"
 * (quickstart A7). Two textareas that refuse with the same sentence leave the
 * seller hunting for which one they broke, which is the whole failure the
 * parameter is here to prevent.
 */
export function parseSchemaText(text: string, subject: 'input' | 'output'): SchemaParse {
  if (text.trim() === '') {
    return { ok: false, message: `Enter the ${subject} contract as JSON.` };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch (cause) {
    // The parser's own complaint is carried through rather than replaced. It
    // names a position, and on a pasted forty-line schema that position is the
    // difference between fixing a trailing comma and re-reading the document.
    const detail = cause instanceof Error ? cause.message : String(cause);
    return { ok: false, message: `The ${subject} contract is not valid JSON — ${detail}` };
  }

  if (!isPlainObject(parsed)) {
    return {
      ok: false,
      message: `The ${subject} contract must be a JSON object — a value in braces, like { "type": "object" }.`,
    };
  }

  return { ok: true, value: parsed };
}

/**
 * The capability and exclusion rows, as they are actually sent (FR-014).
 *
 * Empty and whitespace-only terms are **dropped, not refused**, and the
 * distinction is the point. A blank row is an artefact of an add button — a
 * seller clicked "add" one more time than they had things to say — not
 * something anybody meant to declare, and turning a stray click into a
 * validation error teaches nothing. What the drop actually prevents is worse
 * than clutter: these are `text[]` columns whose members Guardian quotes
 * verbatim when it rules, and an empty string cited as a clause in a verdict
 * is worse than no clause at all.
 *
 * Trimming, and nothing more. A term containing a comma stays one term — a
 * comma appears inside real clauses and is not a separator here (quickstart
 * A16), which is the same reason FR-012 rules out a single comma-separated
 * input in the first place.
 *
 * The `typeof` guard looks redundant against the declared `string[]` and is
 * kept because this module never throws: a sparse or partly-undefined array
 * arriving from a control's own state would otherwise fault on `.trim()`, and
 * skipping the row is the same answer an empty one already gets.
 */
export function cleanTerms(terms: string[]): string[] {
  const cleaned: string[] = [];
  for (const term of terms) {
    if (typeof term !== 'string') {
      continue;
    }
    const trimmed = term.trim();
    if (trimmed !== '') {
      cleaned.push(trimmed);
    }
  }
  return cleaned;
}

/**
 * Exactly what the nine controls hold — all of it text or lists of text,
 * because that is what an input element has.
 *
 * `price`, `inputSchemaText`, and `outputSchemaText` stay strings all the way
 * to this module rather than being converted where they are typed. The form
 * holds what the seller typed; this file is the only place that decides what
 * it means, which is what stops the page from acquiring a second, partial copy
 * of these rules.
 */
export interface DraftFields {
  name: string;
  description: string;
  price: string;
  capabilities: string[];
  exclusions: string[];
  inputSchemaText: string;
  outputSchemaText: string;
  systemPrompt: string;
  model: string;
}

export type DraftResult =
  | { ok: true; request: CreateAgentRequest }
  | { ok: false; errors: Record<string, string> };

/** Required and non-blank, or the sentence naming what is missing. */
function requireText(value: string, message: string): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? undefined : message;
}

/**
 * The whole form, validated and assembled — or **every** failure at once.
 *
 * The one-pass rule is the important thing in this function and is why there
 * is not a single early return below. A nine-field form that surfaces one
 * error per submission is a form people submit five times, learning one new
 * complaint each round; by the fifth they have stopped reading the sentences
 * and started guessing. Every check runs, every failure lands in `errors`, and
 * the page draws all of them together (quickstart A17).
 *
 * The keys in `errors` are the form's own field names, so the page hangs each
 * message on its control by lookup and never maintains a translation table
 * that can fall out of step with either side.
 *
 * Two absences are **not** failures. Capabilities and exclusions may both come
 * back empty (FR-015 and the spec's own edge case): the form does not invent
 * contract terms on a seller's behalf, and the hint beside those fields has
 * already said what an empty list costs them in a dispute. Blocking here would
 * be this form overruling a platform that permits it.
 *
 * Never throws — the schema parse is the only operation that could, and it is
 * already guarded inside `parseSchemaText`.
 */
export function buildCreateAgentRequest(fields: DraftFields): DraftResult {
  const errors: Record<string, string> = {};

  const nameError = requireText(fields.name, 'Enter a name for this agent.');
  if (nameError !== undefined) {
    errors.name = nameError;
  }

  const descriptionError = requireText(fields.description, 'Describe what this agent does.');
  if (descriptionError !== undefined) {
    errors.description = descriptionError;
  }

  // FR-019 names the system prompt alongside the name and description, and it
  // is the one of the three a seller can plausibly forget: it is the only
  // field they never see again afterwards (FR-023), so nothing later in the
  // product would reveal that it had been left blank.
  const systemPromptError = requireText(fields.systemPrompt, 'Enter the system prompt this agent runs on.');
  if (systemPromptError !== undefined) {
    errors.systemPrompt = systemPromptError;
  }

  // The model control is pre-filled and offers two documented ids, so a blank
  // one means it was cleared by hand. It is still checked rather than quietly
  // defaulted: `agent_versions.model` is what the backend will actually try to
  // run, and substituting a value nobody chose is the kind of silent invention
  // this module refuses everywhere else.
  const modelError = requireText(fields.model, 'Enter the model this agent runs on.');
  if (modelError !== undefined) {
    errors.model = modelError;
  }

  // FR-018: the same parser and the same rules as the wallet's amount field —
  // integer cents, no float anywhere, at most two decimals, greater than zero.
  // Only the ceiling sentence is this form's own (R14).
  const price = parseUsd(fields.price, { ceilingMessage: PRICE_CEILING_MESSAGE });
  if (!price.ok) {
    errors.price = price.message;
  }

  const inputSchema = parseSchemaText(fields.inputSchemaText, 'input');
  if (!inputSchema.ok) {
    errors.inputSchemaText = inputSchema.message;
  }

  const outputSchema = parseSchemaText(fields.outputSchemaText, 'output');
  if (!outputSchema.ok) {
    errors.outputSchemaText = outputSchema.message;
  }

  if (Object.keys(errors).length > 0) {
    return { ok: false, errors };
  }

  // Narrowing, not re-checking. Each of these was refused above if it failed,
  // so reaching here means all three succeeded; TypeScript cannot carry that
  // across the accumulated-errors object, and re-parsing to satisfy it would
  // put a second copy of the rules one edit away from disagreeing with the
  // first. The guard is unreachable and returns rather than throwing, because
  // this function never throws.
  if (!price.ok || !inputSchema.ok || !outputSchema.ok) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    request: {
      // Trimmed on the way out. Trailing whitespace on a name is an artefact
      // of typing, and a listing called "Receipt auditor " would sort and
      // match as a different thing to the one the seller thought they named.
      // The schemas are not touched — they are already parsed values, not
      // text — and the terms were trimmed by `cleanTerms`.
      name: fields.name.trim(),
      description: fields.description.trim(),
      priceMinor: price.cents,
      capabilities: cleanTerms(fields.capabilities),
      exclusions: cleanTerms(fields.exclusions),
      inputSchema: inputSchema.value,
      outputSchema: outputSchema.value,
      systemPrompt: fields.systemPrompt.trim(),
      model: fields.model.trim(),
    },
  };
}
