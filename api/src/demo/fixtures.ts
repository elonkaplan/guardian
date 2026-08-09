import type { DemoScript } from '../execution/demo-script.registry';
import type { SeededAgentKey } from './seeded-agents';

/**
 * The three demo acts, as content.
 *
 * ## What a fixture is, and why it is four things
 *
 * An act's outcome is computed from the buyer's **input**, the buyer's
 * **acceptance criteria**, and the buyer's **complaint** — Guardian's case file
 * is assembled from all three. Seeding only the input would leave two thirds of
 * the demo's reproducibility to whoever is typing on stage, so all three are
 * fixture content and all three are published in the seed response for pasting
 * back verbatim. The fourth field, the script, is what the seller's agent does.
 *
 * ## ⚠️ The input is half a lookup key
 *
 * `DemoScriptRegistry` keys on `(definitionHash, canonical input)`. The
 * canonical form sorts object keys, so key order here is free — but **array
 * order is preserved**, deliberately, because a receipt's rows in a different
 * order is a different receipt. `preserveTerms` retyped in another order is a
 * different input and gets a live run. That is correct behaviour and a
 * confusing five minutes if it happens by accident.
 *
 * ## ⚠️ These strings are not decorative
 *
 * Each one was chosen to make one verdict unarguable, and the failure mode of
 * editing them is not an error — it is a wrong number on stage:
 *
 * | Edit | What breaks |
 * | --- | --- |
 * | Act 1's summary drifts off the pricing change | The complaint becomes *valid*; a 0% ruling stops being a fairness demonstration and becomes a visible misfire |
 * | Act 1's summary changes length | `wordCount` must be re-counted to match, or the buyer has a real grievance |
 * | Act 2 returns a different number of items | The 50% tier stops being arithmetic |
 * | Act 2's criteria mention currency | The rejected grievance becomes a legitimate request and the tier moves |
 * | Act 3's script returns an output | There is no non-delivery left to rule on |
 *
 * (`specs/011-demo-seed-fixtures/contracts/fixtures.md` is the source of truth
 * for every string below; `docs/product-workflow.md` §5.5 is why they exist.)
 */
export interface DemoFixture {
  /** 1, 2 or 3 — the demo's running order, which is also its argument. */
  readonly act: 1 | 2 | 3;

  /**
   * Which seeded definition this fixture belongs to.
   *
   * ⚠️ A key into `seeded-agents.ts`, **never an agent name**. The registry
   * keys on the definition hash for the same reason: a stranger who lists their
   * own agent called "LedgerBot" must not inherit Act 2's script.
   */
  readonly agentKey: SeededAgentKey;

  /** The buyer's input, verbatim. Half the registry key, and published as-is. */
  readonly input: Record<string, unknown>;

  /** What the buyer said "done right" means. Half of Guardian's yardstick. */
  readonly acceptanceCriteria: string;

  /** The buyer's testimony, which opens the dispute this act is about. */
  readonly complaint: string;

  /** What the seller's agent does: deliver this output, or fail this way. */
  readonly script: DemoScript;

  /**
   * The tier this act is designed to reach.
   *
   * ⚠️ **Documentation and nothing else. No runtime code may read this.** It is
   * the expected value in the quickstart and the answer a reader wants without
   * re-deriving it — but a branch on it anywhere would mean the demo asserting
   * its own verdict, which is precisely the seam the audit engine forbids
   * (`specs/009-guardian-audit-engine/spec.md` FR-041). Guardian decides; this
   * field records what we expect it to decide.
   */
  readonly expectedTier: 'none' | 'half' | 'full';

  /** For the registration log line, and for a human scanning a failure. */
  readonly label: string;
}

/**
 * Act 1 — the complaint that is correctly rejected (0%).
 *
 * The demo opens here because it front-loads the answer to the question every
 * audience is already forming: *"isn't this just a free-refund button?"* No —
 * Guardian says no first, and it says no by quoting the buyer's own word cap.
 *
 * ⚠️ **This is the fragile fixture.** Its whole point is that the agent
 * *succeeded*: 85 words, under the buyer's cap of 100, genuinely covering the
 * pricing change. The check is not the word count — it is reading the summary
 * and agreeing the pricing change is covered. If it ever drifts, the buyer's
 * complaint becomes legitimate and the strongest beat in the demo inverts.
 */
const ACT_1: DemoFixture = {
  act: 1,
  agentKey: 'tldr',
  input: {
    wordCap: 100,
    document: [
      'NordWind Supplies — Internal Operations Memo',
      'To: All account managers',
      'From: Operations',
      'Date: 12 March 2026',
      '',
      '1. Pricing. Effective 1 May 2026 list prices across the hardware catalogue rise by six percent. This is the first increase since March 2024 and is driven by sustained component cost rises and higher freight rates on the Rotterdam route. Existing annual contracts are not affected until their renewal date, and any quote issued before 15 April will be honoured at the old prices for thirty days from its issue date. Account managers should contact their twenty largest customers directly before the public announcement on 20 April rather than letting them read it in the newsletter.',
      '',
      '2. Warehouse. The move from the Antwerp site to the new Rotterdam warehouse completes in June. Picking and packing continue from Antwerp until 5 June; orders placed after that date ship from Rotterdam. Expect two days of slower dispatch in the changeover week and set customer expectations accordingly.',
      '',
      '3. Support. Two additional staff join the returns desk on 1 April, which should bring the average return acknowledgement back under one working day. The returns policy itself is unchanged.',
      '',
      '4. Catalogue redesign. The redesign planned for Q2 is postponed to Q3 so that the new pricing is reflected in the first printed run rather than being corrected by an insert. No customer-facing dates have been announced, so nothing needs retracting.',
      '',
      '5. Reminder. The quarterly forecast is due on 31 March. Use the updated template in the shared drive; the previous one does not have the freight surcharge line.',
    ].join('\n'),
  },
  acceptanceCriteria: 'Under 100 words, must cover the pricing change.',
  complaint:
    'This is far too short. I paid for a summary of a multi-section memo and got ' +
    'one paragraph — it cannot possibly cover a document this size properly.',
  script: {
    kind: 'output',
    output: {
      // ⚠️ Exactly 85 words, counted rather than estimated, and `wordCount`
      // below declares 85. The two must agree: a declared count that disagrees
      // with the text hands the complaining buyer a real grievance against the
      // agent's own stated capability ("Reports the word count of the summary
      // it produces"), and Act 1 stops being a rejected complaint.
      //
      // It also opens with the pricing change — the percentage, the date, the
      // cause, and the contract and quote carve-outs — because that is the
      // buyer's other criterion and the one a word count cannot verify.
      summary:
        'Effective 1 May 2026, NordWind Supplies raises hardware list prices by six ' +
        'percent, its first increase in two years, driven by component costs and ' +
        'freight. Existing annual contracts keep their current rates until renewal, ' +
        'and quotes issued before 15 April will be honoured for thirty days. The memo ' +
        'also confirms the Rotterdam warehouse move completes in June, adds two staff ' +
        'to the returns desk, and postpones the catalogue redesign to the third ' +
        'quarter. Account managers should brief their twenty largest customers before ' +
        'the public announcement.',
      wordCount: 85,
    },
  },
  expectedTier: 'none',
  label: 'Act 1 — TLDR Agent delivers 85 words that cover the pricing change',
};

/**
 * Act 2 — the shortfall the room can count (50%).
 *
 * The centrepiece. Five line items on the receipt, three returned, two dropped
 * and both nameable — so the audience reaches the verdict *before* Guardian
 * announces it, which is what makes the ruling feel trustworthy rather than
 * magic. The returned total (300.00) is short of the receipt's printed 362.00,
 * so the shortfall is visible twice: in the rows and in the money.
 *
 * ⚠️ **The buyer's complaint carries a second, unfounded grievance** — that the
 * amounts were not converted to dollars — and it is there on purpose. It is
 * answered by the seller's stated exclusion, so this is the act where the demo
 * shows an exclusion being cited in a seller's defence rather than merely
 * claiming that exclusions matter. It does not move the tier: two of five items
 * are still missing.
 *
 * ⚠️ **The acceptance criteria must never mention currency or conversion.** In
 * the complaint the grievance is unfounded; in the criteria it becomes something
 * the buyer legitimately asked for, and the arithmetic 50% becomes an argument.
 */
const ACT_2: DemoFixture = {
  act: 2,
  agentKey: 'ledgerbot',
  input: {
    receiptText: [
      'NORDWIND SUPPLIES',
      'Invoice 4471 — 2 March 2026',
      '',
      'Ergonomic keyboard      EUR 89.00',
      'USB-C dock              EUR 149.00',
      'Monitor stand           EUR 62.00',
      'Desk lamp               EUR 38.00',
      'Cable kit               EUR 24.00',
      '',
      'TOTAL                   EUR 362.00',
    ].join('\n'),
  },
  acceptanceCriteria:
    'Extract all line items with their amounts, and give the correct total.',
  complaint:
    'Two line items are missing — the desk lamp and the cable kit — so the total ' +
    'is 62.00 short. It also left everything in euros instead of converting the ' +
    'amounts to dollars.',
  script: {
    kind: 'output',
    output: {
      // Three of the receipt's five. The two omitted — "Desk lamp" (38.00) and
      // "Cable kit" (24.00) — are printed on the receipt, which is what lets a
      // ruling *name* them instead of gesturing at a shortfall.
      lineItems: [
        { description: 'Ergonomic keyboard', amount: 89.0 },
        { description: 'USB-C dock', amount: 149.0 },
        { description: 'Monitor stand', amount: 62.0 },
      ],
      // The sum of what was returned, not the receipt's printed total. An agent
      // that dropped two rows and still reported 362.00 would be contradicting
      // itself; one that reports 300.00 is consistently wrong, which is the
      // countable failure this act needs.
      total: 300.0,
    },
  },
  expectedTier: 'half',
  label: 'Act 2 — LedgerBot returns 3 of 5 line items',
};

/**
 * Act 3 — non-delivery (100%).
 *
 * The closing act, and the one the audience can check without reading anything:
 * there is no output to compare against anything.
 *
 * ⚠️ **The crash travels the ordinary failure path and nothing here shortcuts
 * it.** `ScriptedAgentRunner` turns this script into the same
 * `AgentRunFailedError` a real crash throws, so `ExecutionService` records the
 * run with `output` SQL NULL, sets `runs.error` to the message below, moves the
 * order to `failed`, and makes no chain call. That NULL *is* the evidence
 * Guardian reads (`docs/CONTEXT.md` invariant #7) — a fixture that wrote a
 * failed row, or a verdict, directly would remove the very thing being
 * demonstrated while appearing to work.
 *
 * The message is recorded rather than swallowed, so the case file shows a crash
 * rather than an empty silence.
 */
const ACT_3: DemoFixture = {
  act: 3,
  agentKey: 'polyglot',
  input: {
    targetLanguage: 'German',
    // ⚠️ Array order is part of this input's identity — the canonical form sorts
    // object keys but never reorders an array. Reversed, this is a different
    // input and gets a live translation.
    preserveTerms: ['NordWind', 'AeroDock Pro'],
    text:
      "The AeroDock Pro is NordWind's compact USB-C docking station for hybrid " +
      'desks. It drives two 4K displays at 60Hz, delivers 100W of charging over a ' +
      'single cable, and adds Gigabit Ethernet, three USB-A ports and an SD card ' +
      'reader. The aluminium housing runs cool without a fan, and the detachable ' +
      'stand lets it sit flat or upright.',
  },
  acceptanceCriteria:
    'Translate the product description into German, keeping the product names unchanged.',
  complaint:
    'Nothing came back at all. There is no translation in the order — I paid $1.50 ' +
    'and received an empty result.',
  script: {
    kind: 'failure',
    message:
      'translation backend unavailable: connection reset while streaming the response',
  },
  expectedTier: 'full',
  label: 'Act 3 — PolyglotAI crashes and returns nothing',
};

/**
 * The three acts in demo order, which is also the order of the argument they
 * make: **fair** (it rules against the buyer first), then **precise** (the room
 * counts to 50% before Guardian does), then **decisive** (nothing delivered,
 * everything back). Each also exercises a different escrow path — full release,
 * split, full refund — so the contract is completely demonstrated by the end of
 * the run (`docs/product-workflow.md` §5.4).
 */
export const DEMO_FIXTURES: readonly DemoFixture[] = [ACT_1, ACT_2, ACT_3];
