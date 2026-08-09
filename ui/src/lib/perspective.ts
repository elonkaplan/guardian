/**
 * Which side of a trade is reading the screen.
 *
 * A dispute has two parties and one record. The buyer and the seller are shown
 * the same verdict, the same citations, and the same case file — but four
 * sentences inside those components are written from a chair: "You get back",
 * "Your criterion", "What you submitted". Read by the seller, each of them is
 * simply wrong about who did what.
 *
 * This type is how the three components that carry those sentences are told who
 * is looking. It selects **copy and nothing else** — never layout, never which
 * fields render, never the arithmetic. If a branch on this value ever changes
 * what the screen *shows* rather than what it *says*, the two parties have
 * stopped seeing the same ruling, and the even-handedness the seller's screen
 * exists to demonstrate is gone.
 *
 * Its own module because `VerdictCard`, `CitationChecklist`, `CaseFilePanel`,
 * and the two pages that compose them all share it and none of them owns it.
 *
 * **The prop is required everywhere it appears, and must stay required.** A
 * default of `'buyer'` would be a component that silently addresses a seller as
 * the buyer whenever somebody forgets to pass it — wrong, entirely plausible on
 * screen, and invisible in review. Required makes the omission a compile error
 * instead.
 */
export type Perspective = 'buyer' | 'seller';
