import type { JSX } from 'react';

interface ContractTermsProps {
  /** The seller's claims, verbatim as `AgentListing.capabilities`. May be empty; never absent. */
  capabilities: string[];
  /** The seller's carve-outs, verbatim as `AgentListing.exclusions`. May be empty; never absent. */
  exclusions: string[];
}

/**
 * The seller's half of the contract, put in front of the buyer before they pay.
 *
 * Capabilities and exclusions are not marketing copy and this component does not
 * treat them as such. They are contract text, quoted verbatim in a later dispute
 * verdict, and the exclusions in particular are how a seller defends itself —
 * "does not handle handwritten receipts" is the line that makes a verdict fair
 * rather than a trap. A buyer who paid without having read it will experience
 * that same verdict as a stitch-up, and the fairness argument the whole product
 * rests on stops holding. So both lists are rendered in full, on first paint,
 * above the buy action (FR-006, FR-007).
 *
 * Which is why the props are two arrays and nothing else. There is no collapse
 * flag, no item cap, no expansion switch, no initially-open setting — and that
 * absence is the guarantee, not an oversight. A disclosure control is how "just
 * show the first three" arrives six months from now, one reasonable-sounding
 * prop at a time; with nowhere to put it, no caller can hide a term and no later
 * edit can quietly acquire the habit. Truncating this list is a product defect,
 * so the interface makes it unavailable rather than merely discouraged. Nothing
 * of that kind may be added to this component's props.
 *
 * An empty list still renders its section, with copy saying the seller declared
 * none (FR-009). A section that vanishes when `exclusions` is empty reads as "a
 * seller with no limits", which is the exact opposite of what an empty exclusion
 * list means — it means nothing is carved out and no verdict can cite one. That
 * is a fact the buyer is entitled to, so silence is not an option.
 *
 * The two groups are told apart by heading, modifier class, and marker glyph,
 * because a buyer skimming a merged wall of lines can read a limit as a promise.
 */
export function ContractTerms({ capabilities, exclusions }: ContractTermsProps): JSX.Element {
  return (
    <section className="terms" aria-label="Contract terms">
      <TermsGroup
        modifier="capabilities"
        heading="What this agent commits to"
        note="Contract terms. Guardian quotes these back when it judges a dispute over your order."
        marker="✓"
        items={capabilities}
        emptyText="The seller declared no capabilities. There is nothing here for a verdict to hold this agent to."
      />
      <TermsGroup
        modifier="exclusions"
        heading="What this agent excludes"
        note="Contract terms. Work that falls under one of these lines is outside the deal, and a verdict may cite it."
        marker="✕"
        items={exclusions}
        emptyText="The seller declared no exclusions. Nothing is carved out, so no verdict can cite an exclusion in this agent's defence."
      />
    </section>
  );
}

interface TermsGroupProps {
  /** Suffix for the `.terms__group--*` class, so the two groups can diverge in CSS. */
  modifier: 'capabilities' | 'exclusions';
  heading: string;
  /** The line that says out loud these are terms judged against, not sales copy. */
  note: string;
  /** Purely decorative; `aria-hidden`, because a screen reader announcing "check" per row is noise. */
  marker: string;
  items: string[];
  /** Shown in place of the list when the seller declared nothing — never in place of the section. */
  emptyText: string;
}

/**
 * One labelled group. Private on purpose: exporting it would hand a caller a way
 * to render exclusions without capabilities, which is half a contract.
 *
 * It maps the whole array. There is no branch here that can render fewer items
 * than it was given.
 */
function TermsGroup({
  modifier,
  heading,
  note,
  marker,
  items,
  emptyText,
}: TermsGroupProps): JSX.Element {
  return (
    <div className={`terms__group terms__group--${modifier}`}>
      <h2 className="terms__heading">{heading}</h2>
      <p className="terms__note">{note}</p>
      {items.length === 0 ? (
        <p className="terms__empty">{emptyText}</p>
      ) : (
        <ul className="terms__list">
          {items.map((term, index) => (
            // Contract text is static for the life of the screen and never
            // reorders, so the position is a stable key — and two sellers'
            // terms can repeat word for word, which rules out the term itself.
            <li className="terms__item" key={`${index}-${term}`}>
              <span className="terms__marker" aria-hidden="true">
                {marker}
              </span>
              {term}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
