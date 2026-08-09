import type { JSX } from 'react';

interface AmountFieldProps {
  label: string;
  /** The raw text as typed, cents and decimal point included. Never a number. */
  value: string;
  /** A refusal message from `parseUsd`, already worded for the buyer. */
  error?: string;
  /** True while a mutation is in flight, when the amount is already on its way to the backend. */
  disabled: boolean;
  /** Hand the caller each keystroke; this field keeps no state of its own. */
  onChange(value: string): void;
  /** Stable id for label/aria wiring. Defaults to a fixed id, so pass one only when two of these fields share a page. */
  id?: string;
}

/**
 * The one control this feature uses to collect an amount of money, wherever
 * money has to be typed in — adding funds, cashing out.
 *
 * It is a text input, deliberately, never `<input type="number">`. A number
 * input hands back `valueAsNumber`, a float, and floating-point is exactly
 * what `lib/money.ts` forbids for money in this app: cents are integers,
 * always, and a float reintroduces the rounding error the rest of the
 * codebase was written to avoid at the one boundary — user entry — where it
 * is otherwise invisible. A number input also quietly accepts strings like
 * `1e3` as valid numbers, which is not a quantity of dollars a person meant
 * to type. So the value stays a string from keystroke to submit, and the
 * `$` shown beside it is a visual affix only, marked `aria-hidden`, because
 * a buyer typing their own `$` is expected and `parseUsd` strips it.
 *
 * The field holds no parsing and no validation of its own. It does not know
 * what a valid amount looks like, does not know about the treasury ceiling,
 * does not know whether the string in front of it will survive `parseUsd`.
 * All of that judgement is made once, by the caller, using `parseUsd` from
 * `lib/money.ts`, and handed back here as an `error` string to display. This
 * is not a missing feature — it is the reason the component exists as its
 * own file rather than being inlined twice. Add funds and cash out are two
 * separate forms on the same screen, and if each grew its own idea of what a
 * valid dollar amount looks like, they would eventually disagree, and a
 * buyer would learn the app's money rule from whichever form they hit first.
 * Keeping this component dumb keeps the rule in exactly one place.
 */
export function AmountField({
  label,
  value,
  error,
  disabled,
  onChange,
  id = 'amount-field',
}: AmountFieldProps): JSX.Element {
  const hasError = error !== undefined;
  const errorId = `${id}-error`;

  return (
    <div className="amount-field">
      <label className="amount-field__label" htmlFor={id}>
        {label}
      </label>

      <div className="amount-field__control">
        <span className="amount-field__prefix" aria-hidden="true">
          $
        </span>
        <input
          id={id}
          className="amount-field__input"
          type="text"
          inputMode="decimal"
          value={value}
          disabled={disabled}
          aria-invalid={hasError}
          aria-describedby={hasError ? errorId : undefined}
          onChange={(event) => onChange(event.target.value)}
        />
      </div>

      {hasError ? (
        <p className="amount-field__error" id={errorId} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
