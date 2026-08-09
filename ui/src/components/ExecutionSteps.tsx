import type { JSX } from 'react';
import type { CaseFileStep } from '../api/types';
import type { Perspective } from '../lib/perspective';

interface ExecutionStepsProps {
  /**
   * `caseFile.steps`, in the order the API sent them. Not sorted, not filtered,
   * not deduplicated here: the sequence is the claim being made, and any reorder
   * this component invented would be a different account of what happened.
   */
  steps: CaseFileStep[];
  /**
   * Which party is reading. Needed only for the empty state, where an empty list
   * means two different things depending on who is asking — see the note there.
   */
  perspective: Perspective;
}

/**
 * What the agent actually did, step by step (FR-022, research R8).
 *
 * This list is what makes a partial refund legible. A tier on its own is an
 * assertion — "50%" is a number a buyer can only accept or resent. "The agent
 * made one extraction pass and stopped" is a fact, and once it is on screen the
 * half refund stops being a ruling handed down and becomes a conclusion the
 * reader reaches a beat before Guardian states it. That is the difference
 * between an arbiter that explains itself and an oracle, and it is worth a list.
 *
 * **The redaction boundary, and why showing steps widens it.** The seller's
 * system prompt is their intellectual property and the buyer must never see it.
 * This is not squeamishness about secrets: if filing a complaint were a way to
 * read the instructions behind an agent, then filing a frivolous complaint would
 * be a way to *steal a seller's work*, and the dispute mechanism would be a
 * scraping tool wearing a courthouse's clothes. No seller would list.
 *
 * Steps are the easiest place in the system to lose that boundary by accident,
 * because a reasoning step can quote its own instructions verbatim while
 * describing what it was doing — the leak arrives inside a field nobody thought
 * of as sensitive. That is why the API's case-file serialiser does not merely
 * strip `system_prompt` but **summarises** reasoning text before it leaves the
 * server (api-design §1.3, ui-design §7.1), and why `CaseFileStep` therefore
 * carries `summary` and has no `reasoning`, no `prompt`, no `raw` field at all.
 *
 * This component performs no redaction of its own, deliberately (FR-027). It
 * could not do it correctly if it tried: it has no way to tell a summarised
 * sentence from a leaked one, so any client-side filter would be theatre — and
 * worse than theatre, because a filter that scrubbed a leak on its way to the
 * screen would also hide the fact that the serialiser had failed, turning a
 * loud, fixable bug into a silent one that keeps shipping. So this renders
 * exactly what it is given, and the *type* is the guarantee: there is nowhere
 * for a prompt to land, even if a future API regression started sending one
 * (FR-026).
 *
 * Errors are shown, not swallowed (FR-022). A step that failed is often the
 * single most explanatory line in the whole case file — it is the reason the
 * output is short — and hiding it to keep the list looking tidy would suppress
 * evidence in favour of the party whose agent broke.
 */
export function ExecutionSteps({ steps, perspective }: ExecutionStepsProps): JSX.Element {
  // Not an empty region. "No steps were recorded" and "the agent did nothing"
  // are different claims, and a bare gap invites the reader to supply whichever
  // one suits their mood. It says which it means.
  //
  // **And which it means depends on who is reading.** The API returns
  // `steps: []` to a buyer *unconditionally* — `findCaseFileForBuyer` does not
  // select the trace at all, so a buyer's empty list carries no information
  // about the run whatsoever. The seller's copy of the same order carries the
  // populated trace. Telling a buyer "no execution steps were recorded" is
  // therefore a false statement about their order, and the worst kind: it reads
  // as evidence that the agent did nothing, on the screen where they are
  // deciding whether they were treated fairly.
  //
  // This is a known API defect, not a frontend one — `api-wrong` row 5 of
  // `api/docs/openapi-divergences.md`, marked `DO NOT ADOPT`. It is escalated
  // rather than worked around: this app does not fetch the seller's endpoint, does
  // not synthesise steps, and does not hide the section as though the design never
  // called for it. It says what is true, which is that the trace is not in what
  // the server sent. When the API starts populating a buyer's trace, this branch
  // simply stops being reached.
  if (steps.length === 0) {
    return (
      <p className="exec-steps__empty">
        {perspective === 'buyer'
          ? 'The execution trace is not included in a buyer’s copy of the case file. This is not a statement about what the agent did.'
          : 'No execution steps were recorded for this order.'}
      </p>
    );
  }

  return (
    // `<ol>` rather than `<ul>`: the order is the argument. A screen reader
    // announcing "3 of 5" is reading out the same thing the numbering shows a
    // sighted reader — where in the run this happened.
    <ol className="exec-steps">
      {steps.map((step, index) => (
        // Steps carry no id and the list is rebuilt wholesale on every poll, so
        // the position is the honest key — it is also the only identity a step
        // genuinely has.
        <li key={index} className="exec-steps__item">
          <span className="exec-steps__label">{step.label}</span>
          {step.summary !== null && step.summary !== '' ? (
            <p className="exec-steps__summary">{step.summary}</p>
          ) : null}
          {step.durationMs !== null ? (
            <span className="exec-steps__duration">{formatStepDuration(step.durationMs)}</span>
          ) : null}
          {step.error !== null && step.error !== '' ? (
            <p className="exec-steps__error">{step.error}</p>
          ) : null}
        </li>
      ))}
    </ol>
  );
}

/**
 * Step durations are formatted here rather than through `formatElapsed`, and the
 * reason is a genuine mismatch rather than a preference.
 *
 * `lib/duration.ts` is built for the review window — a countdown measured in
 * seconds on stage and in hours in principle — so its smallest unit is one
 * second and it floors. Run every step of an agent call through it and a 40ms
 * database read and a 900ms model call both print `0s`, which is not a rounding
 * error but the erasure of the exact contrast this list exists to show: which
 * step was expensive. Sub-second resolution is the information here.
 *
 * So: milliseconds below a second, one decimal place of seconds above it. Never
 * throws and never prints a negative — a clock skew or a garbled timing field
 * gets an em dash, matching what the shared formatter does with a value it
 * cannot render.
 */
function formatStepDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) {
    return '—';
  }
  if (ms < 1000) {
    return `${Math.round(ms)}ms`;
  }
  return `${(ms / 1000).toFixed(1)}s`;
}
