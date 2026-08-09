import type { JSX } from 'react';

interface CriteriaPanelProps {
  /**
   * `order.acceptanceCriteria`, exactly as the buyer typed it into
   * `AcceptanceCriteriaField` before the purchase was sent. Whitespace, line
   * breaks and all — this is a quotation, not a value to be tidied.
   */
  criteria: string;
}

/**
 * The buyer's half of the contract, quoted back beside the work it has to judge.
 *
 * This panel is the other end of a promise the buy form made. There, the copy
 * told the buyer these words are one of the two texts an arbiter reads later,
 * that they are fixed the moment the order is created, and that there is no
 * screen afterwards where they get to explain what they really meant. Here is
 * that screen, and the only thing it owes them is the text itself, unchanged.
 * Truncating, summarising, or hiding it behind "read more" would break the
 * promise at the exact moment it comes due — and a buyer who cannot see their
 * own criterion in full cannot check whether a verdict citing it was fair.
 *
 * It is deliberately half of something. The output sits in the other column
 * (`OutputPanel`), and the two side by side are the product's central legibility
 * argument: the buyer wrote these words before any work existed, so holding them
 * next to the result lets a person answer yes-or-no themselves, before Guardian
 * says anything. That is what makes the later verdict read as confirmation
 * rather than as an oracle. Stack the two vertically and the argument evaporates
 * — you are now reading an output, then scrolling away to remember what you
 * asked for, which is the ordinary experience of being told a decision instead
 * of reaching one. Because the effect depends entirely on simultaneity, the
 * layout is a measured requirement rather than a matter of taste: both panels
 * readable at once at the demo viewport, no scrolling between them (FR-022,
 * SC-003).
 *
 * So the internal structure mirrors `OutputPanel`'s: heading and note pinned,
 * the text scrolling within its own bounded box. A long criterion must consume
 * its own overflow rather than growing the column, because a panel that grows is
 * a panel that pushes its neighbour off the fold, and then the two are no longer
 * side by side in the only sense that matters.
 *
 * The empty branch should be unreachable — the buy form refuses an empty
 * criterion — but this is a client of an API that does not exist yet, and an
 * empty box would be read as "the buyer asked for nothing", which is a much
 * stronger claim than "nothing was recorded". It says which one it means.
 */
export function CriteriaPanel({ criteria }: CriteriaPanelProps): JSX.Element {
  // Trimmed only to decide whether there is anything here. What gets rendered
  // below is the original string: leading indentation is part of how a buyer
  // laid out a list, and this component does not get to reformat evidence.
  const hasCriteria = typeof criteria === 'string' && criteria.trim() !== '';

  return (
    <section className="criteria-panel" aria-label="Acceptance criteria">
      <h2 className="criteria-panel__heading">What you said the work had to include</h2>
      <p className="criteria-panel__note">
        Your own words, written before this agent started work and unchanged since. This
        is the text Guardian weighs the output against if you complain.
      </p>
      {hasCriteria ? (
        // Pre-wrapped via the class, so the buyer's line breaks survive; a
        // scrollable region gets a tab stop so a keyboard user can reach the
        // rest of a long criterion.
        <p className="criteria-panel__text" tabIndex={0}>
          {criteria}
        </p>
      ) : (
        <p className="criteria-panel__empty">
          No acceptance criteria were recorded with this order. There is nothing here for
          a verdict to weigh the delivered work against.
        </p>
      )}
    </section>
  );
}
