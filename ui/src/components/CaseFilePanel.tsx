import type { JSX } from 'react';
import type { CaseFile } from '../api/types';
import type { ApiError } from '../api/errors';
import type { Perspective } from '../lib/perspective';
import { ExecutionSteps } from './ExecutionSteps';
import { OutputPanel } from './OutputPanel';

interface CaseFilePanelProps {
  /** The case file once it has loaded; `undefined` while it has not. */
  caseFile: CaseFile | undefined;
  /**
   * Which party is reading. Required, never defaulted — see `lib/perspective`.
   *
   * Three sentences in this panel name whose input and whose criteria are being
   * shown, and read by the seller each of them is simply wrong about who did
   * what. Nothing else varies: the same sections, in the same order, quoting the
   * same text. Both parties are looking at one record.
   */
  perspective: Perspective;
  /** The last fetch failure, if the fetch failed. Owned and reported here (FR-035). */
  error: ApiError | null;
  loading: boolean;
  /**
   * Whether the panel starts expanded. An *initial* value, not a controlled one
   * — see the note on `<details>` below.
   */
  defaultOpen: boolean;
  /** Refetch the case file. Wired to this panel's own retry button. */
  onRetry: () => void;
}

/**
 * The evidence Guardian was handed, exactly as it was handed over (FR-020,
 * FR-021, research R11).
 *
 * The verdict card above states a conclusion and quotes clauses in support of
 * it. This panel is where those quotes acquire provenance. A citation reading
 * *"extracts every line item"* is, on its own, a sentence the product is asking
 * the reader to take on trust; the same sentence found again in the capabilities
 * list below — in the listing text of the agent version that actually ran — is a
 * thing the reader has verified for themselves. That traceability is the whole
 * job of this panel (FR-023), and it is why the sections quote rather than
 * summarise: the moment this component rewords a clause, the reader's eye can no
 * longer match the checklist's text to its source, and the checklist goes back
 * to being an assertion.
 *
 * **Native `<details>`, not a state-managed accordion.** Disclosure has correct
 * platform behaviour that is tedious and easy to get subtly wrong by hand:
 * keyboard activation, the focus model, the expanded/collapsed state exposed to
 * assistive technology, and find-in-page reaching text inside a closed section.
 * All of that is free here and none of it costs a `useState` — the same
 * reasoning that made the complaint dialog a native `<dialog>` (UI-04's R16).
 * This feature adds no disclosure state anywhere.
 *
 * Note that `open` on `<details>` is an *uncontrolled default*: React writes it
 * on mount and the element owns it thereafter. That is exactly what is wanted.
 * A controlled `open` bound to a prop would slam the panel shut under the
 * reader's hands on the next poll — and this screen polls — which is the classic
 * way a live-updating page fights the person using it. Here the reader's own
 * toggling always wins.
 *
 * The default itself is contextual (FR-024). Under arbitration there is no
 * verdict card yet and this panel is the only thing on the page to read, so it
 * opens. Once the order has concluded the ruling is the answer and the case file
 * is the working, so it starts collapsed and one click away — the card stays the
 * first thing read, and a large input or a long step list cannot push it off the
 * screen.
 *
 * **This panel fails alone (FR-035).** The case file is a second request, and a
 * second request is a second thing that can fail. If it does, that failure is
 * reported inside this panel with a retry button and goes no further: a verdict
 * — the ruling, the refund, the settlement link — must never be withheld from a
 * buyer because a supporting evidence fetch 500'd. The error surface lives here
 * rather than at the page level precisely so that it cannot blank the card above
 * it, and the same holds in reverse.
 *
 * Headings inside are `<h3>`. The verdict card above owns `<h2>`, and the case
 * file is subordinate to it in the document outline as much as it is on screen.
 */
export function CaseFilePanel({
  caseFile,
  error,
  loading,
  defaultOpen,
  onRetry,
  perspective,
}: CaseFilePanelProps): JSX.Element {
  return (
    <details className="case-file" open={defaultOpen}>
      {/* The summary has to stand on its own while collapsed — it is all a
          reader has to decide whether the thing is worth opening. "Case file"
          alone names a container; this says what is inside it and who read it. */}
      <summary className="case-file__summary">
        {perspective === 'buyer'
          ? 'The case file Guardian read — your input, your criteria, the listing’s promises, and what the agent did'
          : 'The case file Guardian read — the buyer’s input, their criteria, your listing’s promises, and what your agent did'}
      </summary>
      <div className="case-file__body">
        {renderBody(caseFile, error, loading, onRetry, perspective)}
      </div>
    </details>
  );
}

function renderBody(
  caseFile: CaseFile | undefined,
  error: ApiError | null,
  loading: boolean,
  onRetry: () => void,
  perspective: Perspective,
): JSX.Element {
  // The error is reported before anything else and in place of the sections,
  // because a half-drawn case file is worse than a stated failure: a reader who
  // sees an empty exclusions list has no way to tell "the listing declared none"
  // from "this section never loaded", and that ambiguity lands on the evidence
  // in a dispute.
  if (error !== null) {
    return (
      <div className="case-file__error" role="alert">
        <p>
          The case file could not be loaded. The ruling above is unaffected — this is
          only the evidence behind it.
        </p>
        <button type="button" className="case-file__retry" onClick={onRetry}>
          Try again
        </button>
      </div>
    );
  }

  if (loading && caseFile === undefined) {
    return (
      <p className="case-file__loading" role="status">
        Loading the case file…
      </p>
    );
  }

  if (caseFile === undefined) {
    return (
      <p className="case-file__empty">
        The case file for this order is not available.
      </p>
    );
  }

  return (
    <>
      {/* Order matters, and it is the order of the story: what the buyer asked
          for, what they agreed to accept, what the listing promised and ruled
          out, what came back, and finally how it was produced. A reader
          following it top to bottom has assembled the dispute by the end. */}
      <section className="case-file__section">
        <h3 className="case-file__heading">
          {perspective === 'buyer' ? 'What you submitted' : 'What the buyer submitted'}
        </h3>
        {renderInput(caseFile.input)}
      </section>

      <section className="case-file__section">
        <h3 className="case-file__heading">
          {perspective === 'buyer'
            ? 'Your acceptance criteria'
            : 'The buyer’s acceptance criteria'}
        </h3>
        {caseFile.acceptanceCriteria.trim() !== '' ? (
          // Pre-wrapped by the class so the buyer's own line breaks survive.
          // This is one of the two texts the checklist quotes from; reflowing it
          // would break the match between a citation and its source.
          <pre className="case-file__input">{caseFile.acceptanceCriteria}</pre>
        ) : (
          <p className="case-file__empty">
            No acceptance criteria were recorded with this order.
          </p>
        )}
      </section>

      <section className="case-file__section">
        <h3 className="case-file__heading">What the listing promised</h3>
        <ClauseList
          clauses={caseFile.capabilities}
          emptyText="The listing declared no capabilities."
        />
      </section>

      <section className="case-file__section">
        <h3 className="case-file__heading">What the listing ruled out</h3>
        <ClauseList
          clauses={caseFile.exclusions}
          emptyText="The listing declared no exclusions."
        />
      </section>

      <section className="case-file__section">
        {/* Rendered through the component the page above already uses. A second
            renderer for the same value is a second opinion about what was
            delivered, and the two would eventually disagree — on the one screen
            where disagreeing about the delivery is fatal. `OutputPanel` brings
            its own heading, so this section adds none. */}
        <OutputPanel output={caseFile.output} />
      </section>

      <section className="case-file__section">
        <h3 className="case-file__heading">What the agent did</h3>
        {/* `perspective` reaches the trace because an empty list means two
            different things depending on who is asking: the API never sends a
            buyer their trace, so a buyer's empty list is silence rather than
            evidence. See the note in `ExecutionSteps`. */}
        <ExecutionSteps steps={caseFile.steps} perspective={perspective} />
      </section>
    </>
  );
}

interface ClauseListProps {
  clauses: string[];
  emptyText: string;
}

/**
 * Capabilities and exclusions, rendered verbatim.
 *
 * An empty array gets a sentence rather than a blank region (FR-023's practical
 * half): "the listing declared none" is a real and sometimes decisive fact in a
 * dispute — an agent cannot be excused by an exclusion that was never written —
 * and a missing section reads as a rendering failure, which invites the reader
 * to assume the clause existed and got lost.
 */
function ClauseList({ clauses, emptyText }: ClauseListProps): JSX.Element {
  if (clauses.length === 0) {
    return <p className="case-file__empty">{emptyText}</p>;
  }

  return (
    <ul className="case-file__list">
      {clauses.map((clause, index) => (
        // Listing clauses have no ids and may legitimately repeat, so the
        // position is the only stable key available.
        <li key={index}>{clause}</li>
      ))}
    </ul>
  );
}

function renderInput(input: Record<string, unknown>): JSX.Element {
  if (input === null || input === undefined) {
    return <p className="case-file__empty">No input was recorded with this order.</p>;
  }

  if (typeof input === 'object' && !Array.isArray(input) && Object.keys(input).length === 0) {
    return <p className="case-file__empty">This order was submitted with no input values.</p>;
  }

  // Indented JSON, property order untouched. This is a transcript of a payload,
  // not a form to be tidied — any key sort invented here would scramble a form
  // the buyer filled in top to bottom, and put this copy of the input out of
  // step with the one on the order screen above.
  return <pre className="case-file__input">{toJson(input)}</pre>;
}

/**
 * `JSON.stringify` is not total: it throws on a cycle or a BigInt and returns
 * `undefined` for a function or an `undefined`. None of those should survive a
 * JSON response, but "should" is doing the work there and the cost of being
 * wrong is a thrown render that takes the verdict card down with the evidence
 * panel — the exact coupling FR-035 forbids. Same guard as `OutputPanel`'s.
 */
function toJson(value: unknown): string {
  try {
    const text = JSON.stringify(value, null, 2);
    return text === undefined ? String(value) : text;
  } catch {
    return String(value);
  }
}
