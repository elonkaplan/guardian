import type { CanonicalDefinition } from '../catalog/definition-hash';

/**
 * The three seller agents the demo publishes — **content, not logic**.
 *
 * Transcribed verbatim from
 * `specs/011-demo-seed-fixtures/contracts/seeded-definitions.md`, which is in
 * turn the concrete form of `docs/agent-definition.md` §6 and
 * `docs/product-workflow.md` §5.2. Nothing in this file computes, formats or
 * decides anything: it is a set of literals, and every consumer derives what it
 * needs from them.
 *
 * ## ⚠️ Why there must never be a second copy
 *
 * Each `definition` object below is the **single source** for three separate
 * things that have to agree:
 *
 *  1. what is **published** — `AgentWritesService.createAgent` writes these ten
 *     fields into `agents` + `agent_versions`;
 *  2. what is **hashed** — `definitionHash()` over the same object becomes
 *     `agent_versions.definition_hash` and the on-chain commitment made by
 *     `registerAgent`;
 *  3. what each demo fixture **keys on** — `DemoScriptRegistry` is keyed by that
 *     same hash plus the input, so a fixture binds to a definition rather than
 *     to a display name.
 *
 * They agree by construction because they are all derived from one object. Retype
 * a name, a price or a schema anywhere else in `src/demo/` and they stop agreeing
 * by construction and start agreeing by luck — and the failure is silent: the
 * agent publishes fine, the fixture registers fine, and Act 2 quietly runs live
 * against the real model instead of the scripted three-of-five
 * (`specs/011-demo-seed-fixtures/data-model.md` §3.1, §4).
 *
 * For the same reason fixtures reference agents by `key`, never by `name`
 * (FR-025). `key` is a stable handle chosen here; `name` is display text that a
 * product decision could change tomorrow.
 *
 * ## ⚠️ `additionalProperties: false` is not optional, on any object
 *
 * Every JSON-Schema `object` below sets it — the root of each `inputSchema`, the
 * root of each `outputSchema`, **and the nested object inside LedgerBot's
 * `lineItems.items`**, which is the one that is easy to miss because the root
 * above it looks complete. Omit it anywhere and the model service refuses the run
 * outright:
 *
 * ```text
 * output_config.format.schema: For 'object' type, 'additionalProperties'
 * must be explicitly set to false
 * ```
 *
 * That is not hypothetical. It is the defect the execution engine's verification
 * run hit across all thirteen of its orders — every act failing for a reason that
 * has nothing to do with what the demo is trying to show. `structured-output-guard.ts`
 * re-checks it before the first chain call, but the fix belongs here, where the
 * schema is written (research R6).
 *
 * ## ⚠️ `systemPrompt` is seller IP
 *
 * It is inside the on-chain commitment — the buyer can prove what they bought —
 * and it leaves the boundary nowhere. Both demo routes are unauthenticated
 * (FR-010, FR-011) and no demo response DTO has a field to put it in. Adding one
 * would publish three sellers' prompts to anyone who can reach the API.
 *
 * ## Editing any string here
 *
 * changes the definition hash, which means the seed must be re-run to publish a
 * new version, and the fixture key moves with it. Both sides move together
 * because both are derived from this object — but a database seeded from an older
 * build will not match until the seed is re-run (research R3).
 */

/**
 * The stable handle for a seeded agent — independent of the display name, so
 * renaming "TLDR Agent" does not silently unbind a fixture.
 */
export type SeededAgentKey = 'ledgerbot' | 'tldr' | 'polyglot';

export interface SeededAgent {
  readonly key: SeededAgentKey;
  /**
   * Exactly the ten `CanonicalDefinition` fields, in the shape `createAgent`
   * accepts — no `id`, no `ownerAccountId`, nothing the hash must not see.
   */
  readonly definition: CanonicalDefinition;
}

/**
 * LedgerBot — the centrepiece, and the reason Act 2's ruling is arithmetic.
 *
 * `outputSchema.lineItems` is an **array of objects**, and that shape is the
 * whole point: the fixture delivers three of the five line items the receipt
 * contains, so "60% of what was bought" is something Guardian counts rather than
 * something it feels. Free text in this field would turn a countable partial
 * delivery into an opinion about thoroughness, and the half tier would stop being
 * defensible (`docs/agent-definition.md` §3, §6).
 */
export const LEDGERBOT: SeededAgent = {
  key: 'ledgerbot',
  definition: {
    name: 'LedgerBot',
    description:
      'Turns messy receipt and invoice text into structured line items with a total.',
    capabilities: [
      'Extracts every line item from a receipt with its description and amount.',
      'Returns the total of the extracted line items.',
    ],
    exclusions: [
      'Does not handle handwritten receipts or non-Latin scripts.',
      // ⚠️ Keep both. The second reads as redundant next to a capability list
      // that never mentions currency conversion — it is not: Act 2 is the act
      // where an *exclusion* gets cited back to the buyer, and this is the one
      // it cites (research R9). The first is the canonical exclusion from
      // `docs/agent-definition.md` §6 and stays even though a text fixture
      // cannot exercise it.
      'Does not convert between currencies or restate amounts in another currency.',
    ],
    /** Whole USD cents — $2.00. Never dollars (invariant #2). */
    priceMinor: 200,
    inputSchema: {
      type: 'object',
      properties: { receiptText: { type: 'string' } },
      required: ['receiptText'],
      additionalProperties: false,
    },
    outputSchema: {
      type: 'object',
      properties: {
        lineItems: {
          type: 'array',
          items: {
            // ⚠️ The nested object. This `additionalProperties: false` is the
            // one the thirteen-order failure was missing.
            type: 'object',
            properties: {
              description: { type: 'string' },
              amount: { type: 'number' },
            },
            required: ['description', 'amount'],
            additionalProperties: false,
          },
        },
        total: { type: 'number' },
      },
      required: ['lineItems', 'total'],
      additionalProperties: false,
    },
    systemPrompt: [
      'You extract line items from receipt and invoice text.',
      '',
      'Return every line item you can identify, each with its description exactly as it',
      'appears on the receipt and its amount as a number without a currency symbol. Return',
      'the total of the line items you extracted.',
      '',
      'Do not invent line items that are not present. Do not merge two lines into one. Do not',
      'convert amounts into another currency — report them in the currency they are written',
      'in.',
    ].join('\n'),
    model: 'claude-haiku-4-5',
    timeoutSeconds: 120,
  },
};

/**
 * TLDR Agent — the reason Act 1's `none` verdict is mechanical rather than
 * aesthetic.
 *
 * `wordCount` in the output is the load-bearing field. The buyer's own acceptance
 * criterion names a cap of 100 words and the delivery declares 85, so Guardian
 * quotes the criterion back and rules that it was met. Without a declared count
 * the same act would ask an adjudicator whether a summary "felt thin", which is
 * exactly the judgement the product refuses to make (`docs/product-workflow.md`
 * §5.3).
 */
export const TLDR_AGENT: SeededAgent = {
  key: 'tldr',
  definition: {
    name: 'TLDR Agent',
    description: 'Summarises a long document within a word cap you specify.',
    capabilities: [
      'Summarises a document within a specified word cap.',
      'Reports the word count of the summary it produces.',
    ],
    exclusions: ['Does not translate.', 'Does not summarise documents over 10,000 words.'],
    /** Whole USD cents — $1.00. */
    priceMinor: 100,
    inputSchema: {
      type: 'object',
      properties: {
        document: { type: 'string' },
        wordCap: { type: 'integer' },
      },
      required: ['document', 'wordCap'],
      additionalProperties: false,
    },
    outputSchema: {
      type: 'object',
      properties: {
        summary: { type: 'string' },
        wordCount: { type: 'integer' },
      },
      required: ['summary', 'wordCount'],
      additionalProperties: false,
    },
    systemPrompt: [
      'You summarise documents within a word cap.',
      '',
      'Write a single-paragraph summary that stays under the given word cap and covers the',
      "document's most consequential points first. Count the words in the summary you wrote",
      'and report that count exactly — do not estimate it.',
    ].join('\n'),
    model: 'claude-haiku-4-5',
    timeoutSeconds: 120,
  },
};

/**
 * PolyglotAI — Act 3, where nothing conforming to this shape ever arrives.
 *
 * The act's outcome is a crash: `ScriptedAgentRunner` raises `AgentRunFailedError`
 * from a `{ kind: 'failure' }` script, the run lands with `output IS NULL`, and
 * the full refund follows from there. So the output shape barely matters to the
 * ruling — but it still has to be a definition a seller could plausibly have
 * published, because the buyer bought *this* contract and Guardian reads it when
 * deciding that nothing satisfying it was delivered.
 */
export const POLYGLOT_AI: SeededAgent = {
  key: 'polyglot',
  definition: {
    name: 'PolyglotAI',
    description: 'Translates text into a target language, preserving product names.',
    capabilities: [
      'Translates text into a target language.',
      'Preserves product names and other terms you list, unchanged.',
    ],
    exclusions: ['Does not localise currency, dates, or units.'],
    /** Whole USD cents — $1.50. */
    priceMinor: 150,
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string' },
        targetLanguage: { type: 'string' },
        preserveTerms: { type: 'array', items: { type: 'string' } },
      },
      required: ['text', 'targetLanguage', 'preserveTerms'],
      additionalProperties: false,
    },
    outputSchema: {
      type: 'object',
      properties: { translation: { type: 'string' } },
      required: ['translation'],
      additionalProperties: false,
    },
    systemPrompt: [
      'You translate text into a target language.',
      '',
      'Translate the text faithfully into the requested language. Leave every term in the',
      'preserve list exactly as written, including capitalisation. Leave currency amounts,',
      'dates and units in their original form — do not localise them.',
    ].join('\n'),
    model: 'claude-haiku-4-5',
    timeoutSeconds: 120,
  },
};

/**
 * All three, in the order the seed publishes them and the order they appear in
 * the contract: LedgerBot, TLDR Agent, PolyglotAI.
 *
 * The order is stable rather than meaningful — nothing depends on it — but a
 * stable order makes the seed's log output and the reseed diff readable, and
 * makes `onchain_agent_id` assignment reproducible across a fresh chain.
 */
export const SEEDED_AGENTS: readonly SeededAgent[] = [LEDGERBOT, TLDR_AGENT, POLYGLOT_AI];

/**
 * One seeded agent by key.
 *
 * ⚠️ The throw is unreachable through the type system — `SeededAgentKey` has
 * exactly three members and all three are in `SEEDED_AGENTS`. It is here because
 * the array and the union are two declarations that could drift if a fourth agent
 * is added to one and not the other, and because callers reach this function from
 * fixture data whose `agentKey` may have been widened somewhere upstream. A named
 * throw at that moment is cheaper than a `undefined.definition` several frames
 * later, mid-seed.
 */
export function seededAgent(key: SeededAgentKey): SeededAgent {
  const agent = SEEDED_AGENTS.find((candidate) => candidate.key === key);

  if (agent === undefined) {
    throw new Error(`unknown seeded agent key: ${key}`);
  }

  return agent;
}
