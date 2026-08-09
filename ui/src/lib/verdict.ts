/**
 * The verdict's data transformations: the tier vocabulary, the split, the
 * citation normaliser, and the guard between a string and a link.
 *
 * Pure. No React, no fetch, no module-level mutable state — the same grounds
 * `orderState.ts` and `money.ts` are here on. Every function is total and
 * nothing throws, because every one of them runs while rendering the screen that
 * concludes a dispute, and a card that crashes on an odd payload takes the
 * outcome, the evidence, and the transaction link down with it.
 *
 * Two rules in this file are worth more than the rest of it put together:
 *
 * 1. **The tier never touches the money** (`splitFor`, FR-004).
 * 2. **An unrecorded citation is never rendered as met** (`normaliseVerdict`,
 *    FR-013).
 */

import type { Hex } from 'viem';

import type {
  CaseFile,
  CaseFileStep,
  Citation,
  CitationSource,
  CitationStatus,
  RawCitation,
  Verdict,
  VerdictTier,
} from '../api/types';
import type { Cents } from './money';

/**
 * Same device as `orderState.ts`: the throw is not the point, the type error is.
 * Every switch below falls through to a call here rather than carrying a
 * `default`, so an unhandled member leaves the argument something other than
 * `never` and the build fails.
 */
function assertNever(value: never): never {
  throw new Error(`Unhandled verdict tier: ${String(value)}`);
}

export interface TierDisplay {
  /** The badge figure. `null` when the tier is not one this app knows. */
  percent: number | null;
  phrase: string;
}

/**
 * The one place the five tiers get words and a number.
 *
 * It lives here rather than in the card so that the badge and any later
 * orders-list chip cannot invent two vocabularies for the same ruling.
 *
 * **`percent` is a display string in waiting, never an operand.** The
 * temptation — `priceMinor * percent / 100` — is the defect FR-004 exists to
 * prevent: it is a second, independent calculation of a figure the backend
 * already computed, hashed, and settled on-chain, and on an odd-cent price the
 * two disagree. `splitFor` below is the only function in this feature allowed to
 * touch money.
 */
export function tierDisplay(tier: string): TierDisplay {
  if (isKnownTier(tier)) {
    return displayForKnownTier(tier);
  }
  /*
   * A tier the backend added and this app has not learned yet. The badge shows
   * the raw value with no percentage rather than throwing or guessing: the money
   * figures beside it come from `refundMinor` and are unaffected, so the card is
   * still correct about the thing that matters, and an unfamiliar word beside
   * two right numbers is a far better failure than a blank concluded face.
   */
  return { percent: null, phrase: tier };
}

const KNOWN_TIERS: readonly VerdictTier[] = [
  'none',
  'quarter',
  'half',
  'three_quarter',
  'full',
];

function isKnownTier(tier: string): tier is VerdictTier {
  return (KNOWN_TIERS as readonly string[]).includes(tier);
}

/**
 * Exhaustive over `VerdictTier`. This switch is the compile-time gate: add a
 * sixth value to the union and this function stops building.
 */
function displayForKnownTier(tier: VerdictTier): TierDisplay {
  switch (tier) {
    case 'none':
      return { percent: 0, phrase: 'No refund' };
    case 'quarter':
      return { percent: 25, phrase: 'Quarter refund' };
    case 'half':
      return { percent: 50, phrase: 'Half refund' };
    case 'three_quarter':
      return { percent: 75, phrase: 'Three-quarter refund' };
    case 'full':
      return { percent: 100, phrase: 'Full refund' };
  }
  return assertNever(tier);
}

export type SplitResult =
  | { ok: true; buyerMinor: Cents; sellerMinor: Cents }
  | { ok: false; buyerMinor: Cents };

/**
 * The two money figures, from the amount that actually settled.
 *
 * `buyerMinor` is `refundMinor` verbatim — the figure the API computed, hashed
 * into `verdict_hash`, and passed to `resolve()`. `sellerMinor` is the price
 * less that figure, which is the only arithmetic this feature performs. Both
 * operands are integer cents, so there is no floating point here.
 *
 * **The discriminant is the interesting part.** When the recorded refund cannot
 * be reconciled with the price — not an integer, negative, or larger than what
 * was paid — this returns `ok: false` and the card shows the refund as recorded
 * with a dash where the seller's share would go, plus a note. It deliberately
 * does *not* clamp. Clamping is the seductive option and the worst one
 * available: it invents two plausible figures that sum neatly to the price and
 * quietly contradict the chain, which is precisely the "trust us" failure this
 * whole screen was built to make impossible. A visible dash sends someone to
 * look at the data; a tidy wrong number does not.
 *
 * `ok: false` should be unreachable against a correct backend. It is here
 * because this is a client of an API that does not exist yet, and because the
 * cost of being wrong is a card claiming the wrong split on stage.
 */
export function splitFor(priceMinor: Cents, refundMinor: Cents): SplitResult {
  const reconcilable =
    Number.isInteger(priceMinor) &&
    Number.isInteger(refundMinor) &&
    refundMinor >= 0 &&
    refundMinor <= priceMinor;

  if (!reconcilable) {
    return { ok: false, buyerMinor: refundMinor };
  }

  return { ok: true, buyerMinor: refundMinor, sellerMinor: priceMinor - refundMinor };
}

/**
 * A 32-byte transaction hash, and the gate between a database column and an
 * `href`.
 *
 * The transaction is the one claim on this page that can be checked without
 * trusting anything else in the product, which makes a link that 404s worse than
 * no link at all: it fails in front of exactly the person who came to verify.
 * So a value that is not shaped like a hash is rendered as text and never linked
 * (FR-018).
 */
export function isTxHash(value: string): value is Hex {
  return /^0x[0-9a-fA-F]{64}$/.test(value);
}

/**
 * `0x7f3a1b9c…5c6d7e8` — for display only.
 *
 * The full value stays in the `href`, in the `title`, and behind the copy
 * control, because a truncation is a convenience and a hash someone wants to
 * check elsewhere has to survive being copied (FR-016).
 */
export function truncateHash(value: string): string {
  if (value.length <= 20) {
    return value;
  }
  return `${value.slice(0, 10)}…${value.slice(-8)}`;
}

const KNOWN_SOURCES: readonly CitationSource[] = ['capability', 'exclusion', 'criterion'];

/**
 * The wire's verdict into one this screen can render, tolerantly.
 *
 * **This is a deliberate exception to a rule stated elsewhere in this codebase.**
 * `fetchOrder` in `api/orders.ts` has no shape tolerance at all, and the comment
 * there argues that a tolerant read converts a broken contract into a plausible,
 * silent, wrong answer. That reasoning is right there and wrong here, for two
 * reasons particular to this payload.
 *
 * First, `verdicts.citations` is `jsonb` with no schema behind it and is typed
 * `unknown[]` by the API's own data model. Postgres will store any JSON document
 * in that column. There is no upstream validation to be strict on behalf of, so
 * tolerance is not a workaround for a contract — it *is* the contract.
 *
 * Second, the failure modes are not comparable. A tolerantly-read agent list
 * renders as "no agents are listed yet" — plausible, silent, and wrong. A
 * tolerantly-read citation renders as a row that says what is missing from it:
 * loudly wrong, impossible to mistake for a clean ruling, and still carrying the
 * part of the evidence that survived. Between an ugly row and a deleted row, on
 * the one screen whose purpose is showing evidence, the ugly row is the honest
 * one.
 *
 * The single asymmetry, and it is absolute: a citation whose `met` was not
 * recorded becomes `unrecorded`, never `met`. Guessing in that direction
 * manufactures a passed clause — a fabricated fact about somebody's contract —
 * and guessing the other way defames a seller. The third value is what lets this
 * function decline to do either.
 */
export function normaliseVerdict(payload: unknown): Verdict {
  const raw = isRecord(payload) ? payload : {};

  const { citations, unreadable } = normaliseCitations(raw.citations);

  return {
    tier: typeof raw.tier === 'string' ? raw.tier : '',
    // Not a number → NaN, which `splitFor` rejects as unreconcilable and the
    // card reports. Coercing a missing refund to 0 would state that the buyer
    // got nothing back, which is a claim about money and not a default.
    refundMinor: typeof raw.refundMinor === 'number' ? raw.refundMinor : Number.NaN,
    reasoning: typeof raw.reasoning === 'string' ? raw.reasoning : '',
    citations,
    txHash: typeof raw.txHash === 'string' && raw.txHash !== '' ? raw.txHash : null,
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : '',
    unreadableCitations: unreadable,
  };
}

function normaliseCitations(value: unknown): { citations: Citation[]; unreadable: number } {
  // Not an array at all — a string, an object, a null. Treated as no citations,
  // which the checklist states in words rather than rendering an empty region.
  if (!Array.isArray(value)) {
    return { citations: [], unreadable: 0 };
  }

  const citations: Citation[] = [];
  let unreadable = 0;

  for (const element of value) {
    if (!isRecord(element)) {
      // A number, a string, a null where a clause should be. There is nothing to
      // render, but the count is kept: a citation that silently disappears
      // shrinks the evidence, and the reader is entitled to know the ruling
      // cited something this screen could not read.
      unreadable += 1;
      continue;
    }
    citations.push(normaliseCitation(element));
  }

  return { citations, unreadable };
}

function normaliseCitation(raw: RawCitation): Citation {
  return {
    source: normaliseSource(raw.source),
    clause:
      typeof raw.clause === 'string' && raw.clause.trim() !== '' ? raw.clause : null,
    status: normaliseStatus(raw.met),
  };
}

/**
 * A known origin, an unfamiliar one kept verbatim, or nothing.
 *
 * The middle case is the one with an opinion in it: a `source` this app does not
 * recognise is passed through as its own label rather than dropped or bucketed
 * into "criterion". The row still carries a quote and a mark, which is most of
 * what makes it evidence, and an unfamiliar word beside them costs a reader far
 * less than a missing clause does.
 */
function normaliseSource(value: unknown): CitationSource | string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed === '') {
    return null;
  }
  if ((KNOWN_SOURCES as readonly string[]).includes(trimmed)) {
    return trimmed as CitationSource;
  }
  return trimmed;
}

/** Booleans only. Everything else is `unrecorded` — never `met`. */
function normaliseStatus(value: unknown): CitationStatus {
  if (value === true) {
    return 'met';
  }
  if (value === false) {
    return 'unmet';
  }
  return 'unrecorded';
}

/**
 * The case file, normalised on the same terms.
 *
 * Less argument needed here than for citations — these fields have real columns
 * behind them — but the panel renders during a dispute, and a missing array
 * should read as "nothing was recorded" rather than crash a `.map()`.
 *
 * Note what this function cannot do: it copies named fields, so a
 * `systemPrompt` arriving on a step or at the top level is dropped on the floor
 * here regardless of what the serialiser upstream did. That is not this app
 * performing redaction (FR-027 says it must not) — it is this app having nowhere
 * to put a prompt, which is the guarantee the types were shaped for.
 */
export function normaliseCaseFile(payload: unknown): CaseFile {
  const raw = isRecord(payload) ? payload : {};

  return {
    input: isRecord(raw.input) ? raw.input : {},
    acceptanceCriteria:
      typeof raw.acceptanceCriteria === 'string' ? raw.acceptanceCriteria : '',
    capabilities: stringArray(raw.capabilities),
    exclusions: stringArray(raw.exclusions),
    output: raw.output ?? null,
    steps: Array.isArray(raw.steps) ? raw.steps.map(normaliseStep) : [],
  };
}

function normaliseStep(value: unknown): CaseFileStep {
  const raw = isRecord(value) ? value : {};
  return {
    label: typeof raw.label === 'string' && raw.label !== '' ? raw.label : 'Step',
    summary: typeof raw.summary === 'string' && raw.summary !== '' ? raw.summary : null,
    durationMs: typeof raw.durationMs === 'number' ? raw.durationMs : null,
    error: typeof raw.error === 'string' && raw.error !== '' ? raw.error : null,
  };
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === 'string' && item.trim() !== '');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
