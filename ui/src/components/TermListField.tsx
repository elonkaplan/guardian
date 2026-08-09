import type { JSX } from 'react';

interface TermListFieldProps {
  /** The group's heading — rendered as a `<legend>`, because the group is the thing being labelled, not any one row. */
  label: string;
  /**
   * The sentence that tells the seller what these lines are for. Always rendered,
   * always visible, never a tooltip or a placeholder (FR-013).
   */
  hint: string;
  /** One string per row, in order. The caller owns this array; the field only shows it. */
  terms: string[];
  /** True while the listing is already on its way to the backend. Disables every row, both controls. */
  disabled: boolean;
  /** Hand the caller the whole next array on every edit; this field keeps no state of its own. */
  onChange(terms: string[]): void;
  /** Wording for the add control, e.g. "Add a capability". The two instances say different things. */
  addLabel: string;
  /**
   * Stable id prefix for label/aria wiring. Defaults to a fixed id, so pass one on
   * each instance when two of these fields share a page — which, on the create
   * form, they always do.
   */
  id?: string;
}

/**
 * The control that collects capabilities and exclusions: an ordered list of
 * single-line terms, each one individually removable, with an add control that
 * appends an empty row. Used twice on the create form, worded differently each
 * time (research R13).
 *
 * It is not a textarea, and that is not an ergonomics preference. `capabilities`
 * and `exclusions` are `text[]` columns, and a verdict cites **one** clause,
 * verbatim. A textarea would have to guess where one clause ends and the next
 * begins — split on newlines and a clause that merely wrapped in the box becomes
 * two clauses; do not split and the whole block becomes one clause no verdict can
 * quote usefully. That is a guess this form has no business making about a
 * document Guardian will later quote back at the seller in front of the buyer who
 * paid them. So the seams are drawn by the person who wrote the terms, at the
 * moment they wrote them, and this component's whole job is to make drawing them
 * cost one click (FR-012).
 *
 * The hint sits on the field, adjacent to the control, permanently visible — not
 * a tooltip, not behind a disclosure, not a placeholder that vanishes on the
 * first keystroke. It has to be read *before* the seller types, not after, and a
 * lede at the top of a nine-field form is read once on the way past and never
 * again. Precise capabilities and precise exclusions are the cheapest lever this
 * product has on the quality of its own evidence: the entire cost is a sentence
 * in the right place, and the entire benefit is a dispute decided on a clause
 * instead of on a shrug (FR-013).
 *
 * The field holds no validation. It does not trim, does not refuse an empty row,
 * does not deduplicate, does not cap the count. Empty and whitespace-only terms
 * are dropped once, by `cleanTerms` in `lib/agentDraft.ts`, at assembly time —
 * an empty row is an artefact of having pressed the add button, not something a
 * seller meant to say, and refusing it mid-typing would mean scolding someone for
 * a row this component itself just created (FR-014). Keeping the rule at assembly
 * keeps it in one place for both instances, which is the same argument
 * `AmountField` makes about `parseUsd`.
 */
export function TermListField({
  label,
  hint,
  terms,
  disabled,
  onChange,
  addLabel,
  id = 'term-list',
}: TermListFieldProps): JSX.Element {
  const hintId = `${id}-hint`;

  // Every handler rebuilds the whole array and hands it back. `map` and `filter`
  // rather than index assignment: under `noUncheckedIndexedAccess` a positional
  // read is `string | undefined`, and there is no reason to reintroduce that
  // doubt when the array methods never lose an element they were given.
  const replaceAt = (index: number, next: string): void => {
    onChange(terms.map((term, position) => (position === index ? next : term)));
  };

  const removeAt = (index: number): void => {
    // Removal takes out exactly one row and leaves every other term as it was.
    // Nothing here renumbers, reorders, or backfills — the seller's ordering is
    // the ordering a verdict will read them in.
    onChange(terms.filter((_, position) => position !== index));
  };

  return (
    <fieldset className="term-list" disabled={disabled} aria-describedby={hintId}>
      <legend className="term-list__label">{label}</legend>

      <p className="term-list__hint" id={hintId}>
        {hint}
      </p>

      {terms.length > 0 ? (
        <ul className="term-list__rows">
          {terms.map((term, index) => {
            const rowId = `${id}-${index}`;
            // A term is free text a seller may repeat on purpose — "does not
            // handle handwritten receipts" can honestly appear twice while it is
            // being edited — and the rows carry no ids of their own, since the
            // prop is a plain `string[]` on its way to a `text[]` column. So the
            // position is the only stable key available, the same conclusion
            // `CaseFilePanel`'s `ClauseList` reaches about the same two arrays.
            return (
              <li className="term-list__row" key={index}>
                <input
                  id={rowId}
                  className="term-list__input"
                  type="text"
                  value={term}
                  // The group's legend names the group, not the row, so each
                  // input carries its own accessible name — otherwise a screen
                  // reader announces nine identically-labelled boxes.
                  aria-label={`${label}, item ${index + 1}`}
                  onChange={(event) => {
                    replaceAt(index, event.target.value);
                  }}
                />
                <button
                  type="button"
                  className="term-list__remove"
                  // The name says which row, because "Remove" repeated down a
                  // column is unusable without sight of it. The term itself is
                  // included when there is one: position alone is correct but
                  // forces a count, and this button destroys text.
                  aria-label={
                    term.trim() === ''
                      ? `Remove empty ${label}, item ${index + 1}`
                      : `Remove ${label}, item ${index + 1}: ${term}`
                  }
                  onClick={() => {
                    removeAt(index);
                  }}
                >
                  ✕
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}

      <button
        type="button"
        className="term-list__add"
        onClick={() => {
          onChange([...terms, '']);
        }}
      >
        {addLabel}
      </button>
    </fieldset>
  );
}
