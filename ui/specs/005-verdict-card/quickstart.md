# Quickstart & Manual Validation: Verdict card & case file

**Feature**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md)

No automated tests exist in this component by decision (`ui/docs/CONTEXT.md`), so this document is the test suite. Parts A–F are the acceptance run; Part G is the boundary sweep; the rehearsal at the end is what "done" actually means.

---

## Prerequisites

- The API's Guardian module is running, with `GET /orders/:id/verdict` and `GET /orders/:id/case-file` implemented per [contracts/internal-api.md §6](./contracts/internal-api.md).
- **Confirm handoff assumption 2 before building anything**: citations arrive as structured objects, not prose. If they arrive as prose, stop — FR-007 cannot be met from the client and the fix is upstream.
- `POST /demo/seed` has been run and the demo agents exist.
- The review window is turned down (a handful of seconds) so a dispute is reachable quickly.
- Chrome at roughly 1280×800 — the demo viewport, and where SC-005's legibility is judged.

## Setup

```
npm install
npm run dev
```

Then take one order all the way to `settled`: buy from LedgerBot, wait for delivery, complain, and let Guardian rule. Keep its id — most parts below reuse it.

---

## Part A — Offline and boundary behaviour (no backend needed)

Hand-craft responses in the network panel, or point at a stub. These are the branches a live demo will never produce and a real user eventually will.

| # | Do | Expect | Ref |
| --- | --- | --- | --- |
| A1 | Serve a verdict with `citations: []`. | The checklist region says no clauses were cited. Not an empty box, and the reasoning is not promoted into its place. | FR-012 |
| A2 | Serve `citations: "the clauses were not met"` (a string). | Same as A1 — treated as no citations, nothing thrown. | R5 |
| A3 | Serve a citation with `met` absent. | The row renders, marked "Not recorded". **Not a ✓.** | FR-013 |
| A4 | Serve a citation with no `clause`. | The row renders, marked "Quote unavailable", keeping its origin and status. | FR-013 |
| A5 | Serve a citation with `source: "listing_term"`. | The row renders, labelled with that raw string. Evidence is not dropped for being unfamiliar. | FR-013 |
| A6 | Serve `citations: [1, null, {…valid…}]`. | One valid row, plus a line saying two citations could not be read. | data-model §2 |
| A7 | Serve `reasoning: ""`. | The card renders in full — badge, split, checklist. It does not collapse. | FR-006 |
| A8 | Serve `tier: "eighth"`. | The badge shows the raw value with no percentage; the money figures are unaffected. | data-model §2 |
| A9 | Serve `refundMinor: 900` on a 200-cent order. | The refund shows as recorded, the seller's figure shows `—`, and a note says the figures do not reconcile. **No negative money.** | R3 |
| A10 | Serve `txHash: "not-a-hash"`. | Shown as text, marked unrecognisable. **No link.** | FR-018, R9 |
| A11 | Make `GET /orders/:id/verdict` return 500. | The concluded region shows a stated error and a retry. Never blank. The case file below it still renders. | FR-034, FR-035 |
| A12 | Make `GET /orders/:id/case-file` return 500. | The panel shows its own error and retry. The verdict card above is unaffected. | FR-035 |

---

## Part B — The ruling and the split (User Story 1)

| # | Do | Expect | Ref |
| --- | --- | --- | --- |
| B1 | Open the settled order. | A verdict card is the conclusion of the record. | FR-001 |
| B2 | Read the badge. | A proportion — "50% · Half refund" — not `half` and not an internal code. | FR-002 |
| B3 | Read the two figures. | Both present, both labelled by who receives them, summing to the order price. | FR-003 |
| B4 | Check the sum against the order header's price. | Exact, to the cent. | SC-003 |
| B5 | Force a `none` verdict. | Two figures still: $0.00 to the buyer, the full price to the seller. | FR-003 |
| B6 | Force a `full` verdict. | The mirror image, same layout. | FR-003 |
| B7 | Read the reasoning. | Present, and positioned as support for the checklist — not above it, not in place of it. | FR-005 |
| B8 | Open an order that was **released uncontested**. | No verdict card at all. The released copy is unchanged from UI-04. | FR-001 |

---

## Part C — The citation checklist (User Story 2) — **the feature**

| # | Do | Expect | Ref |
| --- | --- | --- | --- |
| C1 | Look at the citations. | Discrete rows, visually separated. **Not a paragraph, not a comma-separated sentence.** If this reads as prose, the feature has failed regardless of everything else. | FR-007 |
| C2 | Read a row's origin. | "Promised capability" / "Declared exclusion" / "Your criterion" — readable without a legend. | FR-008 |
| C3 | Read a row's clause. | Quoted verbatim and visibly marked as a quotation. | FR-009 |
| C4 | Take a greyscale screenshot of the card. | Every row's met/unmet state is still unambiguous — glyph and word, not colour. | FR-010, SC-006 |
| C5 | Stand back from the screen, or project it. | Unmet rows draw the eye first; met and unmet are distinguishable at distance. | FR-011, SC-005 |
| C6 | Serve a citation with a 400-character clause. | The row stays readable, the card's layout holds, and the other rows stay in view. | FR-014 |
| C7 | Show the card to someone unfamiliar with the product. | They can name which clauses failed **without reading the reasoning paragraph.** | SC-001 |

---

## Part D — The transaction (User Story 3)

| # | Do | Expect | Ref |
| --- | --- | --- | --- |
| D1 | Find the transaction on a settled order. | A truncated hash, presented as proof the money moved. | FR-015 |
| D2 | Follow it. | MonadVision opens **in a new tab**, on that exact transaction, first try. The order page is still open behind it. | FR-017, SC-004 |
| D3 | Copy the hash. | The full 66-character value lands on the clipboard, not the truncation. | FR-016 |
| D4 | Look at an order in `adjudicated`. | "Settlement is completing" where the transaction goes. **No link, no placeholder, no dead control.** | FR-018 |
| D5 | Serve `txHash: null` on a `settled` order. | States that no transaction reference was recorded. Still no link. | FR-018 |
| D6 | `grep -rn "monadvision\|monadexplorer" src/components src/pages` | Zero hits — the URL comes from `src/chain/chains.ts`. | FR-019 |

---

## Part E — The case file (User Story 4)

| # | Do | Expect | Ref |
| --- | --- | --- | --- |
| E1 | Open a `disputed` order (ruling not yet in). | The case-file panel is present and **open**, with no verdict card above it. | FR-020, R11 |
| E2 | Read the panel. | Submitted input, acceptance criteria, promised capabilities, declared exclusions, execution steps. | FR-021 |
| E3 | Read the steps. | In order, each with what it did, its timing, and any error shown rather than hidden. | FR-022 |
| E4 | Compare a citation's quote to the panel's listing text. | Character-for-character the same clause. Traceable in under 15 seconds. | FR-023, SC-009 |
| E5 | Open the settled order. | The panel is present and **collapsed** — the card is the first thing read. | FR-024, R11 |
| E6 | Expand it with a very large input and many steps. | Each region scrolls within itself; the card above stays put. | FR-024 |
| E7 | Open a released, never-disputed order. | No case-file panel offered. | FR-025 |
| E8 | Read every field of the panel and the card. | Nothing describing the seller's instructions to their agent, anywhere. | FR-026, SC-007 |

---

## Part F — It arrives on its own (User Story 5) — **the closing beat**

Hands off the keyboard for all of these.

| # | Do | Expect | Ref |
| --- | --- | --- | --- |
| F1 | Sit on a `disputed` order until Guardian rules. | The verdict card appears with no refresh and no click, within about 2 seconds of the ruling. | FR-031, SC-002 |
| F2 | Keep sitting until settlement completes. | The transaction link appears **in place**. The badge, figures, and checklist do not flicker or rebuild. | FR-031 |
| F3 | Watch the network panel through F1–F2. | `['verdict']` polls at 1s only between `adjudicated` and the hash landing. | R6 |
| F4 | Leave the settled page open for five minutes. | Zero further requests for the order, the verdict, or the case file. | FR-033 |
| F5 | Reload directly onto the settled order. | The complete card on first paint — no intermediate state missing the ruling. | FR-032 |
| F6 | Reload directly onto an `adjudicated` order. | The card renders with the settlement-pending note, and one verdict request per second until the hash lands. | FR-031, R6 |

---

## Part G — Boundaries (the checks that are not clicking)

| # | Check | Command | Why |
| --- | --- | --- | --- |
| G1 | No route to render seller IP. | `grep -rn "systemPrompt\|prompt\|reasoning" src/api/types.ts` | FR-026. `reasoning` appears on `Verdict` (Guardian's own, buyer-facing) and must **not** appear on `CaseFileStep`, which has `summary`. No `prompt` anywhere. |
| G2 | No chain call, no signature. | `grep -rn "useSignMessage\|writeContract\|readContract\|useAccount\|createPublicClient" src/components/Verdict* src/components/CaseFile* src/components/TxHash* src/hooks/useVerdict.ts src/hooks/useCaseFile.ts` | FR-029, `CONTEXT.md` §2. Expect zero. |
| G3 | One explorer host. | `grep -rn "monadvision\|monadexplorer\|/tx/" src --include=*.tsx --include=*.ts \| grep -v chain/chains.ts` | FR-019. Expect zero. |
| G4 | No new dependencies. | `git diff --stat package.json package-lock.json` | R14. Expect no change. |
| G5 | Shared machinery untouched. | `git diff src/hooks/usePolling.ts src/lib/queryClient.ts src/api/client.ts` | R14 — this feature changes none of it. Expect no change. |
| G6 | The tier switch is exhaustive. | Add a sixth value to `VerdictTier` locally and run `npm run typecheck` | R4. Expect a compile error in `src/lib/verdict.ts`. |
| G7 | No percentage arithmetic on money. | `grep -rn "0.25\|0.5\|0.75\|percent \*\|\* percent" src/lib/verdict.ts src/components/Verdict*` | FR-004, R3. The percentage is a display string; expect zero arithmetic hits. |
| G8 | The placeholder is gone. | `grep -rn "VerdictSlot" src` | R13. Expect zero — the file and its CSS block are deleted. |
| G9 | Types clean. | `npm run typecheck` | — |

---

## What "done" means

Parts A–G pass, and then the part that decides it:

**Run Act 2 end to end, twice, from `POST /demo/reset`, without touching anything outside the browser** (SC-010). Buy from LedgerBot, read the three returned rows against the five the receipt contains, complain, and watch the page reach a fully populated card on its own.

Then the check no table can encode: **show the finished card to someone who has not seen the product and ask them why the refund was 50%.** If they answer by reading the checklist back to you, this feature is done. If they answer "because the AI decided", it is not — whatever the tables above say.
