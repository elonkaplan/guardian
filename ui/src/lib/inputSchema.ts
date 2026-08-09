import type { JsonSchema } from '../api/types';

/**
 * A seller's declared input contract, turned into a form.
 *
 * The schema this reads is arbitrary JSON. It reached the database through a
 * raw textarea on the Create Agent screen, and nothing upstream guarantees it
 * is a schema at all — so **nothing in this module throws**, whatever it is
 * handed. `null`, a string, an array, a schema with fifteen levels of nesting:
 * every one of them resolves to the raw fallback with a reason the buyer can
 * read. A thrown error here would white-screen the detail page for an agent
 * that is otherwise perfectly buyable, which is a far worse failure than an
 * ugly textarea.
 *
 * Deliberately not a JSON Schema implementation. It supports flat objects of
 * primitive properties, which is what the demo agents actually declare, and
 * falls back for everything else. The alternative — a schema-form library —
 * is four dependencies and its own markup to render a case this module handles
 * in a page of code, and it would still need the fallback.
 *
 * The renderable predicate lives here, once. The renderer and the payload
 * builder both read `form.mode`; neither re-derives it, so the two cannot
 * drift into disagreeing about what a form is.
 */

export type InputControl = 'text' | 'textarea' | 'number' | 'checkbox' | 'select';

/** The value a control holds. Numbers stay strings until the payload is built. */
export type FieldValue = string | boolean;

export interface InputField {
  /** The property key this field writes to in the payload. */
  name: string;
  /** `title`, else the property name made readable. */
  label: string;
  /** `description`, shown under the control. */
  help?: string;
  required: boolean;
  control: InputControl;
  /** `select` only. */
  options?: string[];
  /** `number` only — `'1'` for an integer, so the stepper behaves. */
  step?: 'any' | '1';
  default?: string | number | boolean;
}

/**
 * Two shapes, not one array that is sometimes empty.
 *
 * The raw path needs to tell the buyer *why* they are looking at JSON instead
 * of fields, and the payload builder must not be reachable in a state where it
 * cannot tell which it is dealing with.
 */
export type InputForm =
  | { mode: 'fields'; fields: InputField[] }
  | { mode: 'raw'; reason: string; schemaText: string };

/**
 * The value key the raw fallback stores its text under.
 *
 * Shared vocabulary rather than a string literal in two components: the form
 * renderer writes it and the buy panel reads it, and a typo would silently
 * submit an empty document. It starts with a character no JSON Schema property
 * name realistically uses, so it cannot collide with a seller's own field.
 */
export const RAW_FIELD = '__raw';

const SHORT_STRING_FORMATS = new Set(['date', 'date-time', 'email', 'uri', 'uuid']);
const PRIMITIVE_TYPES = new Set(['string', 'number', 'integer', 'boolean']);

/** The longest `maxLength` that still reads as a one-line value rather than a document. */
const SHORT_STRING_MAX_LENGTH = 80;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** `receiptText` / `receipt_text` → `Receipt text`. */
function humanise(name: string): string {
  const spaced = name
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z\d])([A-Z])/g, '$1 $2')
    .trim();
  if (spaced === '') {
    return name;
  }
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
}

function stringify(schema: unknown): string {
  try {
    return JSON.stringify(schema, null, 2) ?? String(schema);
  } catch {
    // Cyclic, or something with a throwing toJSON. The buyer still gets a
    // usable textarea; only the reference copy beside it is lost.
    return '';
  }
}

function declaredType(schema: JsonSchema): string | undefined {
  const { type } = schema;
  if (typeof type === 'string') {
    return type;
  }
  // A union type (`['string', 'null']`) is common for optional fields. Take the
  // first non-null member; if that leaves nothing renderable, the predicate
  // below rejects it and the fallback covers us.
  if (Array.isArray(type)) {
    return type.find((member) => typeof member === 'string' && member !== 'null');
  }
  return undefined;
}

function hasEnum(schema: JsonSchema): boolean {
  return Array.isArray(schema.enum) && schema.enum.length > 0;
}

/**
 * Which control a property gets.
 *
 * The string default is the one that looks backwards and isn't: an
 * *unconstrained* string gets a textarea, and only an explicitly short one gets
 * a single-line input. The realistic input to these agents is a pasted receipt
 * or invoice, and schemas rarely bother to say "this is long". Pasting four
 * hundred characters into a one-line box is a small indignity that makes a
 * demo look unfinished, so the unconstrained case defaults the other way and
 * `enum`, `maxLength`, and `format` opt back down.
 */
function controlFor(schema: JsonSchema, type: string | undefined): InputControl {
  if (hasEnum(schema)) {
    return 'select';
  }
  if (type === 'boolean') {
    return 'checkbox';
  }
  if (type === 'number' || type === 'integer') {
    return 'number';
  }
  const short =
    (typeof schema.maxLength === 'number' && schema.maxLength <= SHORT_STRING_MAX_LENGTH) ||
    (typeof schema.format === 'string' && SHORT_STRING_FORMATS.has(schema.format));
  return short ? 'text' : 'textarea';
}

function defaultFor(schema: JsonSchema): string | number | boolean | undefined {
  const value = schema.default;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  return undefined;
}

function raw(reason: string, schema: unknown): InputForm {
  return { mode: 'raw', reason, schemaText: stringify(schema) };
}

/**
 * The four conditions for a schema to render as fields. Failing any one of
 * them is not an error — it is the fallback, with a reason attached.
 */
export function buildInputForm(schema: unknown): InputForm {
  if (!isPlainObject(schema)) {
    return raw('This agent does not describe its input as a set of fields.', schema);
  }

  const root = schema as JsonSchema;
  const rootType = declaredType(root);
  const properties = root.properties;

  if (rootType !== undefined && rootType !== 'object') {
    return raw(`This agent expects a single ${rootType} value rather than a set of fields.`, schema);
  }

  if (!isPlainObject(properties)) {
    return raw('This agent does not list the fields its input contains.', schema);
  }

  const names = Object.keys(properties);
  if (names.length === 0) {
    return raw('This agent does not list the fields its input contains.', schema);
  }

  const required = new Set(Array.isArray(root.required) ? root.required : []);
  const fields: InputField[] = [];

  for (const name of names) {
    const property = properties[name];
    if (!isPlainObject(property)) {
      return raw('One of this agent’s input fields is not described in a way this form can read.', schema);
    }

    // Nesting is the line. A nested object or an array of anything is a
    // structure a flat form would have to invent an editor for, and inventing
    // one is scope with no demo behind it.
    if (property.properties !== undefined || 'items' in property) {
      return raw('This agent’s input has a nested structure, so it is entered as JSON.', schema);
    }

    const type = declaredType(property);
    if (!hasEnum(property) && (type === undefined || !PRIMITIVE_TYPES.has(type))) {
      return raw('This agent’s input includes a value this form cannot lay out as a field.', schema);
    }

    const field: InputField = {
      name,
      label: typeof property.title === 'string' && property.title.trim() !== '' ? property.title : humanise(name),
      required: required.has(name),
      control: controlFor(property, type),
    };

    if (typeof property.description === 'string' && property.description.trim() !== '') {
      field.help = property.description;
    }
    if (field.control === 'select' && Array.isArray(property.enum)) {
      field.options = property.enum.map((option) => String(option));
    }
    if (field.control === 'number') {
      field.step = type === 'integer' ? '1' : 'any';
    }
    const fallback = defaultFor(property);
    if (fallback !== undefined) {
      field.default = fallback;
    }

    fields.push(field);
  }

  return { mode: 'fields', fields };
}

/**
 * The prose a buyer reads above the form, taken from the schema's own `title`
 * and `description`.
 *
 * There is no separate human-readable field on a listing to read instead — the
 * database carries only the schema — and inventing one would immediately be
 * free to contradict what the form actually asks for.
 */
export function describeSchema(schema: unknown): string | undefined {
  if (!isPlainObject(schema)) {
    return undefined;
  }
  const { title, description } = schema as JsonSchema;
  const parts = [title, description].filter(
    (part): part is string => typeof part === 'string' && part.trim() !== '',
  );
  return parts.length > 0 ? parts.join(' — ') : undefined;
}

/** The starting values for a form, so a declared `default` is honoured. */
export function initialValues(form: InputForm): Record<string, FieldValue> {
  if (form.mode === 'raw') {
    return {};
  }
  const values: Record<string, FieldValue> = {};
  for (const field of form.fields) {
    if (field.control === 'checkbox') {
      values[field.name] = field.default === true;
    } else {
      values[field.name] = field.default === undefined ? '' : String(field.default);
    }
  }
  return values;
}

function asText(value: FieldValue | undefined): string {
  return typeof value === 'string' ? value : '';
}

/**
 * Local validation, and deliberately only this much.
 *
 * Required-and-non-blank, plus a guard against sending `NaN` where a number
 * belongs. Nothing else: no `minLength`, no `pattern`, no bounds, no checking
 * the object against the schema. The backend validates the input against
 * `input_schema` before any money moves, and that validation is the one that
 * counts. A second, partial implementation in the browser would eventually
 * drift from it and refuse something the backend would have accepted — the
 * worst outcome available, because the buyer cannot argue with it.
 */
export function validateFields(
  form: InputForm,
  values: Record<string, FieldValue>,
): Record<string, string> {
  const errors: Record<string, string> = {};
  if (form.mode === 'raw') {
    return errors;
  }

  for (const field of form.fields) {
    const value = values[field.name];

    // A checkbox is never "missing": false is an answer, not an absence, and
    // requiring one to be ticked would make "no" unrepresentable.
    if (field.control === 'checkbox') {
      continue;
    }

    const text = asText(value).trim();
    if (field.required && text === '') {
      errors[field.name] = `${field.label} is required.`;
      continue;
    }
    if (field.control === 'number' && text !== '' && Number.isNaN(Number(text))) {
      errors[field.name] = `${field.label} must be a number.`;
    }
  }

  return errors;
}

/**
 * The `input` object sent to the backend.
 *
 * Blank **optional** fields are omitted rather than sent as `""`. An empty
 * string is a value, and a value can fail a seller's `minLength`; an absent
 * optional property cannot. Booleans are the exception and are always sent,
 * for the same reason they are never required: `false` is an answer.
 */
export function buildPayload(
  form: InputForm,
  values: Record<string, FieldValue>,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  if (form.mode === 'raw') {
    // Raw input is parsed by `parseRawInput`, which is the only thing that can
    // tell a malformed document from an empty one.
    return payload;
  }

  for (const field of form.fields) {
    const value = values[field.name];

    if (field.control === 'checkbox') {
      payload[field.name] = value === true;
      continue;
    }

    // Trailing whitespace only. A pasted receipt can legitimately begin with a
    // blank line, and silently eating it changes what the agent was given.
    const text = asText(value).replace(/\s+$/, '');
    if (text === '' && !field.required) {
      continue;
    }

    payload[field.name] = field.control === 'number' ? Number(text) : text;
  }

  return payload;
}

/**
 * The raw fallback's input, checked before anything is sent.
 *
 * Two failures are worth telling apart: text that is not JSON at all, and
 * valid JSON that is not an object. The second is the one people hit — pasting
 * an array of items when the agent wants `{ items: [...] }` — and "unexpected
 * token" would be an unhelpful thing to say about it.
 */
export function parseRawInput(
  text: string,
): { ok: true; value: Record<string, unknown> } | { ok: false; message: string } {
  if (text.trim() === '') {
    return { ok: false, message: 'Enter this agent’s input as JSON.' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    return { ok: false, message: `This is not valid JSON — ${detail}` };
  }

  if (!isPlainObject(parsed)) {
    return {
      ok: false,
      message: 'The input must be a JSON object — a value in braces, like { "field": "value" }.',
    };
  }

  return { ok: true, value: parsed };
}
