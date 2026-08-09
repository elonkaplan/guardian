import type { FieldValue, InputField, InputForm } from '../lib/inputSchema';
import { RAW_FIELD } from '../lib/inputSchema';

interface SchemaFieldsProps {
  /** Already decided by `buildInputForm`. This component never re-derives the mode. */
  form: InputForm;
  values: Record<string, FieldValue>;
  /** Keyed by field name, or by `RAW_FIELD` in the fallback. */
  errors: Record<string, string>;
  /** True while a purchase is in flight. */
  disabled: boolean;
  onChange(name: string, value: FieldValue): void;
}

/**
 * The seller's declared input, as something a buyer can actually fill in.
 *
 * Two shapes, and which one you get was decided in `lib/inputSchema`. Flat
 * objects of primitive properties become labelled controls; anything nested or
 * otherwise unusual becomes one JSON box with the schema printed beside it and
 * a sentence saying why.
 *
 * The fallback is not an apology, it is the reason the fields path is allowed
 * to be narrow. A seller can put any JSON at all in their input schema — the
 * Create Agent screen takes it as raw text — so a renderer that tried to
 * handle everything would either be enormous or would eventually meet a schema
 * it could not draw and leave the listing unbuyable. With the fallback there,
 * the worst case is an ugly form, never a dead one.
 */
export function SchemaFields({ form, values, errors, disabled, onChange }: SchemaFieldsProps) {
  if (form.mode === 'raw') {
    const error = errors[RAW_FIELD];
    return (
      <div className="raw-input">
        <label className="field__label" htmlFor={RAW_FIELD}>
          Input (JSON)
        </label>
        <p className="raw-input__reason">{form.reason}</p>
        <textarea
          id={RAW_FIELD}
          className="raw-input__control"
          rows={8}
          spellCheck={false}
          value={typeof values[RAW_FIELD] === 'string' ? (values[RAW_FIELD] as string) : ''}
          disabled={disabled}
          aria-invalid={error !== undefined}
          onChange={(event) => onChange(RAW_FIELD, event.target.value)}
        />
        {error !== undefined ? (
          <p className="field__error" role="alert">
            {error}
          </p>
        ) : null}
        {form.schemaText !== '' ? (
          <>
            <p className="raw-input__caption">The shape this agent expects:</p>
            <pre className="raw-input__schema">{form.schemaText}</pre>
          </>
        ) : null}
      </div>
    );
  }

  return (
    <div className="fields">
      {form.fields.map((field) => (
        <SchemaField
          key={field.name}
          field={field}
          value={values[field.name]}
          error={errors[field.name]}
          disabled={disabled}
          onChange={onChange}
        />
      ))}
    </div>
  );
}

interface SchemaFieldProps {
  field: InputField;
  value: FieldValue | undefined;
  error: string | undefined;
  disabled: boolean;
  onChange(name: string, value: FieldValue): void;
}

function SchemaField({ field, value, error, disabled, onChange }: SchemaFieldProps) {
  const id = `input-${field.name}`;
  const helpId = field.help !== undefined ? `${id}-help` : undefined;
  const text = typeof value === 'string' ? value : '';
  const invalid = error !== undefined;

  // A checkbox carries its label to the right of the control, and is never
  // marked required — `false` is an answer, so there is nothing to enforce.
  if (field.control === 'checkbox') {
    return (
      <div className="field field--checkbox">
        <label className="field__label" htmlFor={id}>
          <input
            id={id}
            className="field__control"
            type="checkbox"
            checked={value === true}
            disabled={disabled}
            aria-describedby={helpId}
            onChange={(event) => onChange(field.name, event.target.checked)}
          />
          {field.label}
        </label>
        {field.help !== undefined ? (
          <p className="field__help" id={helpId}>
            {field.help}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>
        {field.label}
        {field.required ? <span className="field__required"> (required)</span> : null}
      </label>
      {field.help !== undefined ? (
        <p className="field__help" id={helpId}>
          {field.help}
        </p>
      ) : null}

      {field.control === 'select' ? (
        <select
          id={id}
          className="field__control"
          value={text}
          disabled={disabled}
          aria-invalid={invalid}
          aria-describedby={helpId}
          onChange={(event) => onChange(field.name, event.target.value)}
        >
          {/* An unselected state has to exist, or an optional enum silently
              submits its first option as though the buyer had chosen it. */}
          <option value="">Choose…</option>
          {(field.options ?? []).map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      ) : field.control === 'textarea' ? (
        <textarea
          id={id}
          className="field__control"
          rows={5}
          value={text}
          disabled={disabled}
          aria-invalid={invalid}
          aria-describedby={helpId}
          onChange={(event) => onChange(field.name, event.target.value)}
        />
      ) : (
        <input
          id={id}
          className="field__control"
          type={field.control === 'number' ? 'number' : 'text'}
          {...(field.control === 'number' ? { step: field.step } : {})}
          value={text}
          disabled={disabled}
          aria-invalid={invalid}
          aria-describedby={helpId}
          onChange={(event) => onChange(field.name, event.target.value)}
        />
      )}

      {invalid ? (
        <p className="field__error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
