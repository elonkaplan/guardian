import type { JSX } from 'react';
import type { Citation, CitationStatus } from '../api/types';

interface CitationChecklistProps {
  /**
   * `verdict.citations`, already normalised at the boundary (research R5). Every
   * element renders as a row — including the ragged ones. Nothing here filters.
   */
  citations: Citation[];
  /**
   * `verdict.unreadableCitations`: elements of the payload's `citations` array
   * that were not objects and so could not be turned into rows.
   */
  unreadableCount: number;
}

/**
 * The clauses the ruling weighed, one row each, quoted and marked (FR-007–FR-014).
 *
 * A verdict can be presented two ways that carry the identical information to
 * opposite effect. Written as prose — "Guardian determined that a 50% refund was
 * appropriate given the shortfall in delivery" — it is a sentence that asks the
 * reader to trust a model, and the only move available to a reader who doubts it
 * is to doubt the whole product. Written as a list of clauses, each one quoted
 * from a document that existed before the work started and each one marked met
 * or unmet, it hands the reader the evidence and lets them reach the same
 * conclusion themselves. Two clauses failed out of four; the refund is half.
 * Nobody had to be trusted for that to land.
 *
 * This component is the second one, and it is the single reason the feature
 * exists (User Story 2). A beautifully typeset paragraph in this slot would be a
 * failure even if every word in it were correct — the failure would be structural
 * rather than factual, which is exactly why it is easy to ship by accident. Hence
 * FR-007's shape requirement is stated as a prohibition and honoured here as a
 * `<ul>`: discrete rows, visually separated, never a comma-joined sentence.
 *
 * Three consequences follow from that job and each one costs something that looks
 * like polish on a diff:
 *
 * The origin label is spelled out in full — "Promised capability", "Declared
 * exclusion", "Your criterion" — rather than being an icon, a colour, or a short
 * code with a key somewhere (FR-008). A legend is a second thing to read, and a
 * reader who has to learn a notation before they can check a ruling is being
 * asked to trust again by a different route.
 *
 * The clause is a `<blockquote>` containing the string exactly as it arrived
 * (FR-009). The point of a citation is that the words are somebody else's and
 * predate the dispute; a paraphrase, an ellipsis, or a tidied line break would
 * make it this app's sentence about the contract instead of the contract's own.
 * Marking it visibly as a quotation is what tells the reader which is which.
 *
 * The met/unmet mark carries a glyph *and* a word (FR-010, R10, SC-006). Colour
 * sits on top of both and never carries meaning alone, because all three of this
 * feature's real viewing conditions are hostile to colour and none of them is an
 * edge case: a projector with crushed contrast, a screenshot pasted into a deck,
 * and a colour-blind reader. An argument that only works on a good monitor is not
 * an argument. The glyph is `aria-hidden` so a screen reader hears the word once
 * rather than hearing punctuation read aloud in front of it.
 */
export function CitationChecklist({
  citations,
  unreadableCount,
}: CitationChecklistProps): JSX.Element {
  return (
    <section className="citation-checklist" aria-label="Cited clauses">
      <h3 className="citation-checklist__heading">The clauses this ruling weighed</h3>
      <p className="citation-checklist__note">
        Quoted from the agent's listing and from the criteria you wrote before the work
        started. Each one is marked with whether it held.
      </p>

      {citations.length === 0 ? (
        // Not an empty region, and not a gap for something else to fill. "The
        // ruling cited nothing" is itself a finding a reader is entitled to see
        // stated (FR-012) — a blank space would read as a loading bug and quietly
        // spare the ruling from being judged on the evidence it failed to give.
        //
        // The card must not respond to this branch by promoting the reasoning
        // paragraph into the checklist's place. Reasoning is the model's own prose
        // about its decision; dressing it as citation would put the one thing this
        // component exists to prevent into the one slot built to prevent it.
        <p className="citation-checklist__empty">
          This ruling did not cite any clauses. There is nothing here to check it against.
        </p>
      ) : (
        <ul className="citation-checklist__list">
          {citations.map((citation, index) => (
            // Citations carry no id — they are anonymous entries in a `jsonb`
            // array — and the list is rebuilt wholesale from every poll rather
            // than mutated in place, so the index is the honest key. Same
            // reasoning, same situation, as the output table's rows.
            <li key={index} className={rowClassName(citation.status)}>
              <span className="citation-checklist__mark">
                {/* Hidden from assistive tech: the word beside it says the same
                    thing in a form a screen reader can pronounce. */}
                <span className="citation-checklist__glyph" aria-hidden="true">
                  {statusGlyph(citation.status)}
                </span>
                <span className="citation-checklist__word">{statusWord(citation.status)}</span>
              </span>
              <p className="citation-checklist__source">{sourceLabel(citation.source)}</p>
              {citation.clause !== null && citation.clause.trim() !== '' ? (
                <blockquote className="citation-checklist__quote">{citation.clause}</blockquote>
              ) : (
                // Deliberately not an empty `<blockquote>`. Quotation marks around
                // nothing read as a rendering fault; this says what actually
                // happened — the ruling named a clause and did not quote it — and
                // wears a treatment that cannot be mistaken for a quotation, so
                // nobody reads this app's apology as somebody's contract text.
                <p className="citation-checklist__missing">Quote unavailable</p>
              )}
            </li>
          ))}
        </ul>
      )}

      {unreadableCount > 0 && (
        // Counted rather than dropped. A citation this app could not parse still
        // happened; if it vanished silently the checklist would show less evidence
        // than the ruling actually rested on, and would look complete while doing
        // it. A reader who can see "1 citation could not be read" knows the list
        // is short and knows by how much.
        <p className="citation-checklist__unreadable">
          {unreadableCount} {unreadableCount === 1 ? 'citation' : 'citations'} could not be
          read and {unreadableCount === 1 ? 'is' : 'are'} not shown above.
        </p>
      )}
    </section>
  );
}

/**
 * The origin, in words a reader understands without a legend (FR-008).
 *
 * The `default` branch is the load-bearing one. An origin string this build has
 * never heard of is not a reason to drop a row from a checklist whose entire job
 * is showing the evidence — the ruling called it something, and the reader gets
 * to see what. `null` means the citation arrived with no origin at all, which is
 * a weaker statement than any of the three labels and so gets the bare noun.
 */
function sourceLabel(source: string | null): string {
  switch (source) {
    case 'capability':
      return 'Promised capability';
    case 'exclusion':
      return 'Declared exclusion';
    case 'criterion':
      return 'Your criterion';
    case null:
      return 'Clause';
    default:
      return source;
  }
}

/**
 * The word, which is what carries the meaning — to a screen reader, to a
 * greyscale screenshot, and to somebody squinting from the back of a room.
 *
 * `unrecorded` says "Not recorded" and is never rounded to a pass (FR-013). The
 * asymmetry is on purpose: guessing "Met" here fabricates a clause that held,
 * which is a fabricated fact about somebody's contract, invented by the one
 * screen whose whole claim is that every mark on it came from the ruling.
 */
function statusWord(status: CitationStatus): string {
  switch (status) {
    case 'met':
      return 'Met';
    case 'unmet':
      return 'Not met';
    case 'unrecorded':
      return 'Not recorded';
  }
}

/** The glyph half of the same mark — decorative, and useless on its own by design. */
function statusGlyph(status: CitationStatus): string {
  switch (status) {
    case 'met':
      return '✓';
    case 'unmet':
      return '✗';
    // No tick, no cross, nothing that could be misread at distance as either.
    case 'unrecorded':
      return '—';
  }
}

function rowClassName(status: CitationStatus): string {
  return `citation-checklist__row ${statusModifier(status)}`;
}

function statusModifier(status: CitationStatus): string {
  switch (status) {
    case 'met':
      return 'citation-checklist__row--met';
    case 'unmet':
      return 'citation-checklist__row--unmet';
    case 'unrecorded':
      return 'citation-checklist__row--unrecorded';
  }
}
