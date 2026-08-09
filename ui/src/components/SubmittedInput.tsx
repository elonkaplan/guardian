import type { JSX } from 'react';
import type { OrderRun } from '../api/types';

interface SubmittedInputProps {
  /**
   * The whole run, not just `run.input`, because `null` here is a sentence this
   * component has to say out loud: a `purchased` order has no run row yet, and
   * that is a different fact from a run whose input happened to be empty.
   * Passing the input alone would collapse the two into the same blank.
   */
  run: OrderRun | null;
}

/**
 * The longest string still shown beside its label. Past this it is a document,
 * not a value, and it moves under the label as a block. The demo's own input is
 * a pasted receipt, so the block path is the common one, not the exotic one.
 */
const INLINE_MAX_LENGTH = 200;

/**
 * What the buyer sent with their purchase, quoted back to them.
 *
 * This is on the page for two reasons that arrive at different times. While the
 * agent is working there is nothing else to look at — no output, no verdict, no
 * progress worth believing — and the one useful question a buyer can answer in
 * that window is "did I actually paste the right receipt?". A page that only
 * says "working…" leaves them waiting out the whole run to discover a mistake
 * they could have seen in the first second. So the input is shown on the
 * working face, in full, unsummarised.
 *
 * Then it stops being a check and becomes evidence. When a delivery is disputed,
 * Guardian reads the work against two texts: the acceptance criteria and what
 * was actually submitted. A verdict that a buyer cannot reconstruct reads as
 * arbitrary, and half of that reconstruction is this block — which is why it
 * stays on the delivered, failed, arbitration and concluded faces too (FR-003)
 * rather than being working-face furniture that disappears once there is
 * something more interesting to show.
 *
 * Because it is a record rather than a form, nothing here is edited, truncated,
 * or prettified beyond layout. Property order is the order the API sent, since
 * any sort this component invented would scramble a form the buyer filled in
 * top to bottom.
 *
 * It also assumes nothing about the shape. `run.input` is whatever JSON the
 * seller's input schema described and the buyer's payload produced — the buy
 * form has a raw-JSON fallback precisely because that can be anything — and
 * this is a client of an API that does not exist yet. Every branch below is a
 * shape this component refuses to throw on, because a malformed input value
 * turning the order screen into a blank error page would hide the state, the
 * countdown, and the actions along with it.
 */
export function SubmittedInput({ run }: SubmittedInputProps): JSX.Element {
  return (
    <section className="submitted-input" aria-label="Submitted input">
      <h2 className="submitted-input__heading">What you submitted</h2>
      <p className="submitted-input__note">
        The input sent with this order. It cannot be changed, and Guardian reads it
        alongside your acceptance criteria if the order is ever disputed.
      </p>
      {renderBody(run)}
    </section>
  );
}

function renderBody(run: OrderRun | null): JSX.Element {
  // Not an empty box and not silence: an order that has not started executing is
  // a state the buyer is entitled to be told about, and one that resolves on its
  // own within a poll or two.
  if (run === null || run === undefined) {
    return (
      <p className="submitted-input__pending">
        This order has not started running yet, so the input has not been recorded.
        It appears here as soon as the agent picks the order up.
      </p>
    );
  }

  const input: unknown = run.input;

  // `input` is typed as an object, but the type is a claim about an unbuilt
  // backend. If a response ever sends a string, an array, or null, printing it
  // is strictly better than crashing the page around it.
  if (!isPlainObject(input)) {
    if (input === null || input === undefined) {
      return (
        <p className="submitted-input__empty">
          No input was recorded with this order.
        </p>
      );
    }
    return <pre className="submitted-input__json">{toJson(input)}</pre>;
  }

  const names = Object.keys(input);
  if (names.length === 0) {
    return (
      <p className="submitted-input__empty">
        This order was submitted with no input values.
      </p>
    );
  }

  return (
    <dl className="submitted-input__rows">
      {/* Property names are unique within an object, so the name is a stable key. */}
      {names.map((name) => (
        <InputRow key={name} name={name} value={input[name]} />
      ))}
    </dl>
  );
}

interface InputRowProps {
  name: string;
  value: unknown;
}

/**
 * One property. Private: the section's copy is what makes the rows mean
 * anything, and a caller able to render a bare row could put the buyer's input
 * on screen without saying that it is the buyer's input.
 */
function InputRow({ name, value }: InputRowProps): JSX.Element {
  const label = humanise(name);

  if (typeof value === 'string') {
    // A receipt, an article, a prompt — anything with newlines or any real
    // length gets the full width beneath its label. Squeezed into a row it
    // becomes one unreadable line, and this is the value the buyer most needs
    // to actually read.
    if (value.length > INLINE_MAX_LENGTH || value.includes('\n')) {
      return (
        <div className="submitted-input__row submitted-input__row--block">
          <dt className="submitted-input__label">{label}</dt>
          <dd className="submitted-input__value">
            <pre className="submitted-input__block">{value}</pre>
          </dd>
        </div>
      );
    }

    return (
      <div className="submitted-input__row">
        <dt className="submitted-input__label">{label}</dt>
        <dd className="submitted-input__value">
          {value === '' ? (
            <span className="submitted-input__blank">(empty)</span>
          ) : (
            value
          )}
        </dd>
      </div>
    );
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return (
      <div className="submitted-input__row">
        <dt className="submitted-input__label">{label}</dt>
        {/* Printed as it was sent — `true`, not "Yes". This is a transcript of a
            JSON payload, and translating it would put words in the buyer's
            mouth in the one place that has to match what the arbiter reads. */}
        <dd className="submitted-input__value">{String(value)}</dd>
      </div>
    );
  }

  // Arrays, nested objects, null, and anything else: shown as indented JSON.
  // Not pretty, but complete, and completeness is the point of the block.
  return (
    <div className="submitted-input__row submitted-input__row--block">
      <dt className="submitted-input__label">{label}</dt>
      <dd className="submitted-input__value">
        <pre className="submitted-input__json">{toJson(value)}</pre>
      </dd>
    </div>
  );
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * `JSON.stringify` is not total: it throws on a cycle or a BigInt and returns
 * `undefined` for a function or an `undefined`. None of those should survive a
 * JSON response, but "should" is doing the work there and the cost of being
 * wrong is a blank order screen, so every one of them has an answer.
 */
function toJson(value: unknown): string {
  try {
    const text = JSON.stringify(value, null, 2);
    return text === undefined ? String(value) : text;
  } catch {
    return String(value);
  }
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
