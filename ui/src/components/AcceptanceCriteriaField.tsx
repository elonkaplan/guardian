interface AcceptanceCriteriaFieldProps {
  /** The criteria as written so far. The caller owns this text; the field only shows it. */
  value: string;
  /** A validation failure the buyer has to fix before the purchase can be sent. */
  error?: string;
  /** A soft note — usually that the criterion looks too brief. It never blocks the buy. */
  warning?: string;
  /** True while a purchase is in flight, when the text is already on its way to the backend. */
  disabled: boolean;
  /** Hand the caller each keystroke; this field keeps no state of its own. */
  onChange(value: string): void;
}

const guidanceId = 'acceptance-criteria-guidance';
const errorId = 'acceptance-criteria-error';
const warningId = 'acceptance-criteria-warning';
const fieldId = 'acceptance-criteria';

/**
 * The one place in the product where the buyer writes their half of the contract.
 *
 * Everything else on this screen is the seller talking: what the agent claims to
 * do, what it declares it will not do, what it costs. This box is the buyer's
 * only reply, and it is not a preference or a note to the seller — it is one of
 * the two texts an arbiter reads later, held next to the delivered work, with the
 * seller's declared capabilities as the other. It is written before any work
 * exists and it is fixed the moment the order is created; there is no edit
 * afterwards, and no later screen where the buyer gets to explain what they
 * really meant.
 *
 * That is why the copy around the field is not decoration. A buyer who types
 * "do a good job" here has, months later, a case with nothing in it, and this
 * form is the only thing standing between them and that outcome at the moment it
 * can still be changed. So the consequence is stated plainly and a worked example
 * sits beside the box, permanently — as text, not as placeholder, because a
 * placeholder vanishes on the first keystroke, which is precisely when the
 * example becomes useful (FR-015, FR-016).
 *
 * The tone is deliberately level. A warning box would read as legal throat-
 * clearing and get skipped; what is wanted is a buyer who understands the stakes
 * and writes a better sentence, not one who is alarmed into clicking past.
 *
 * Whether a criterion is too thin to check is the caller's judgement, not this
 * component's — it arrives as `warning` and is shown as a nudge that leaves the
 * purchase available, kept visually apart from `error`, which is a stop.
 */
export function AcceptanceCriteriaField({
  value,
  error,
  warning,
  disabled,
  onChange,
}: AcceptanceCriteriaFieldProps) {
  const hasError = error !== undefined;

  const describedBy = [guidanceId, hasError ? errorId : null, warning !== undefined ? warningId : null]
    .filter((id): id is string => id !== null)
    .join(' ');

  return (
    <div className="criteria">
      <label className="criteria__label" htmlFor={fieldId}>
        What the finished work has to include (required)
      </label>

      <div id={guidanceId}>
        <p className="criteria__consequence">
          If this order is ever disputed, Guardian weighs the delivered work against two
          texts: what the seller promised above, and what you write here. These words are
          fixed once you buy — they travel with the order and cannot be edited later.
        </p>

        <div className="criteria__example">
          <p>
            The criteria that hold up are the ones someone can hold next to a result and
            answer yes or no.
          </p>
          <p className="criteria__example-good">
            Specific: “Every line item from the receipt, each with its amount, and a total.”
          </p>
          <p className="criteria__example-weak">
            Too vague to check: “Do a good job.”
          </p>
        </div>
      </div>

      <textarea
        id={fieldId}
        className="criteria__input"
        rows={5}
        value={value}
        disabled={disabled}
        // Marked required for assistive technology rather than with the native
        // attribute: the form runs its own validation and says which field is at
        // fault in its own words, and the browser's constraint bubble would talk
        // over it.
        aria-required="true"
        aria-invalid={hasError}
        aria-describedby={describedBy}
        onChange={(event) => onChange(event.target.value)}
      />

      {hasError ? (
        <p className="criteria__error" id={errorId} role="alert">
          {error}
        </p>
      ) : null}

      {warning !== undefined ? (
        <p className="criteria__warning" id={warningId}>
          {warning}
        </p>
      ) : null}
    </div>
  );
}
