import type { JSX } from 'react';

interface SchemaTextAreaProps {
  /** The field's heading, e.g. "What buyers send this agent". */
  label: string;
  /** Guidance rendered adjacent to the box and always visible, not a placeholder. */
  hint: string;
  /** The raw text as typed or pasted. Never a parsed object, never re-serialised. */
  value: string;
  /** A refusal from `parseSchemaText`, already worded for the seller and already naming which contract. */
  error?: string;
  /** True while the listing is already on its way to the backend. */
  disabled: boolean;
  /** Hand the caller each keystroke; this field keeps no state of its own. */
  onChange(value: string): void;
  /** Stable id for label/aria wiring. Required, because the form always renders two of these. */
  id: string;
}

/**
 * The input and output contracts, collected as raw text the seller writes or
 * pastes into a box (FR-015).
 *
 * There is no schema builder here. No field adder, no type picker, no row of
 * name/type/required controls, no structured editor of any kind — and that
 * absence is the decision, not an unfinished corner of it. A schema builder is a
 * day of work for a control that would then sit between the seller and a value
 * they almost certainly already have in a file somewhere; it invents an opinion
 * about which JSON Schema keywords exist, an opinion this application has no
 * standing to hold, and it makes pasting — the actual path a seller takes —
 * strictly worse than a plain textarea. Nothing in the demo touches it. So the
 * box takes text, and text is what goes to the backend.
 *
 * The field holds no parsing. It does not call `JSON.parse`, does not know what
 * a well-formed contract looks like, does not know that a top-level array is
 * refused while an empty object is fine. All of that judgement is made once, by
 * the page, using `parseSchemaText` from `lib/agentDraft.ts`, and handed back
 * here as an `error` string to display — exactly as `AmountField` delegates to
 * `parseUsd`, and for exactly the same reason. This component is rendered twice
 * on one form, and two fields that each grew their own idea of valid JSON would
 * eventually disagree, so a seller would learn the rule from whichever contract
 * they filled in first. One rule, one place.
 *
 * That rule is also deliberately shallow: well-formed JSON and a plain object,
 * nothing more (research R12). The backend is the party that validates a JSON
 * Schema, and a second validator in the browser is a second opinion that
 * eventually refuses a listing the platform would have accepted, with no way to
 * override it mid-demo (FR-017).
 *
 * `spellCheck` is off because red underlines under every key in a JSON payload
 * are noise pretending to be a finding. Monospacing is a CSS concern and lives
 * on the class, not here.
 */
export function SchemaTextArea({
  label,
  hint,
  value,
  error,
  disabled,
  onChange,
  id,
}: SchemaTextAreaProps): JSX.Element {
  const hasError = error !== undefined;
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;

  // The hint is part of the field's description whether or not anything is
  // wrong, so it stays in `aria-describedby` alongside the error rather than
  // being displaced by it.
  const describedBy = hasError ? `${hintId} ${errorId}` : hintId;

  return (
    <div className="schema-field">
      <label className="schema-field__label" htmlFor={id}>
        {label}
      </label>

      <p className="schema-field__hint" id={hintId}>
        {hint}
      </p>

      <textarea
        id={id}
        className="schema-field__input"
        rows={10}
        value={value}
        disabled={disabled}
        spellCheck={false}
        aria-invalid={hasError}
        aria-describedby={describedBy}
        onChange={(event) => onChange(event.target.value)}
      />

      {hasError ? (
        <p className="schema-field__error" id={errorId} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
