import { createHash } from 'node:crypto';

import { Injectable, Logger } from '@nestjs/common';

/**
 * What a script does when it matches. Exactly one of two shapes — an output, or
 * a failure. There is no third: a script cannot half-deliver, because the
 * pipeline it feeds has only two exits.
 */
export type DemoScript =
  | { readonly kind: 'output'; readonly output: Record<string, unknown> }
  | { readonly kind: 'failure'; readonly message: string };

/** One seeded act, as registered by the demo-seed work. */
export interface DemoScriptEntry {
  /** `agent_versions.definition_hash` for the seeded version — hex, no `0x`. */
  readonly definitionHash: string;
  /** The seeded input, verbatim. Hashed canonically on registration. */
  readonly input: Record<string, unknown>;
  readonly script: DemoScript;
  /** For the log line when a script fires. e.g. "Act 2 — LedgerBot drops 2 of 5". */
  readonly label: string;
}

/** A registered script that matched the run about to happen. */
export interface MatchedScript {
  readonly label: string;
  readonly script: DemoScript;
}

/**
 * The seam between this feature and the demo-seed work (API-11).
 *
 * This feature builds the mechanism and ships it **empty**; API-11 authors the
 * three agent definitions, the three fixture inputs and the three intended
 * outcomes, and registers them.
 *
 * ## ⚠️ Why any of this exists
 *
 * The three demo acts must produce the same outcome on every rehearsal — a
 * summary that genuinely meets the buyer's criteria, an extraction that returns
 * exactly three of five line items, and a translation that produces nothing at
 * all. `docs/product-workflow.md` §5.5 states the reason plainly: seeded inputs
 * that *reliably* produce the intended output, "rather than hoping a live model
 * misbehaves on schedule". It is a demo-rig decision recorded up front, not
 * something to discover at 4am.
 *
 * ## ⚠️ Where the substitution happens, and where it must never happen
 *
 * A script replaces **the model call** and nothing downstream of it. Everything
 * after — the run record, the trace, the timings, the conformance check, the
 * order's state move — is the ordinary pipeline, so a scripted crash lands as
 * `state = 'failed'` with `runs.output IS NULL` through the real failure path.
 * `docs/specs/API-11-demo-seed.md` is explicit about why that matters: *"A
 * seeded shortcut that writes a verdict directly, or an error row that never
 * reaches `failed`, removes the very thing Guardian reads."* This registry
 * therefore knows nothing about orders, runs, or the chain.
 *
 * ## The key: definition **and** input
 *
 * `definition_hash` already exists on every version, is keccak256 over the
 * canonical definition, and is committed on-chain at listing — so it is the one
 * identifier a third party cannot shadow. Keying on the agent's *name* would let
 * anyone register an agent called "LedgerBot" and inherit the script.
 *
 * The input is half the key because §5.5 describes seeded *inputs*, not seeded
 * agents: a judge who pastes their own receipt into LedgerBot must get a real
 * extraction, not the scripted three-of-five (FR-033).
 *
 * ## Deviation from `contracts/demo-script-registry.md`
 *
 * The contract sketched `MatchedScript.perform()`. It resolves to a plain
 * `{ label, script }` instead: performing a failure means constructing an
 * `AgentRunFailedError`, which needs the order id — and an order id is exactly
 * the kind of thing this class has no business holding. The branch lives in
 * `ScriptedAgentRunner`, which has the request in hand.
 */
@Injectable()
export class DemoScriptRegistry {
  private readonly logger = new Logger(DemoScriptRegistry.name);
  private readonly entries = new Map<string, DemoScriptEntry>();

  get size(): number {
    return this.entries.size;
  }

  /**
   * Register one seeded act.
   *
   * ⚠️ A duplicate key throws **here, at registration**, rather than resolving
   * arbitrarily at run time. A second entry for the same definition and input is
   * a programming error in the seed, and the moment to find out is when the seed
   * runs — not mid-demo, when two scripts disagree about what Act 2 returns.
   */
  register(entry: DemoScriptEntry): void {
    const key = scriptKey(entry.definitionHash, entry.input);

    const existing = this.entries.get(key);
    if (existing !== undefined) {
      throw new Error(
        `demo script already registered for this definition and input ` +
          `("${existing.label}" vs "${entry.label}")`,
      );
    }

    this.entries.set(key, entry);
    this.logger.log(`registered demo script: ${entry.label}`);
  }

  /**
   * Find the script for this run, or `null`.
   *
   * ⚠️ **A miss is the normal case.** Every real purchase from every real agent
   * misses, and an empty registry misses everything — which is precisely why an
   * unseeded deployment behaves as though this class were not here.
   */
  lookup(
    definitionHash: string,
    input: Record<string, unknown>,
  ): MatchedScript | null {
    const entry = this.entries.get(scriptKey(definitionHash, input));
    if (entry === undefined) return null;

    return { label: entry.label, script: entry.script };
  }
}

/** `sha256(definitionHash) ‖ sha256(canonical input)`. Both halves must match. */
function scriptKey(
  definitionHash: string,
  input: Record<string, unknown>,
): string {
  return `${sha256(definitionHash.toLowerCase())}:${sha256(canonicalJson(input))}`;
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/**
 * JSON with object keys sorted, recursively — so the same document typed twice,
 * or serialised by two different clients, produces the same key.
 *
 * Array order is preserved, because an array's order is part of its meaning: a
 * receipt with the same five line items in a different order is a different
 * input, and a judge reordering them should get a real run rather than the
 * scripted one.
 */
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';

  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`);

  return `{${entries.join(',')}}`;
}
