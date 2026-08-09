import { keccak256, stringToBytes, type Hex } from 'viem';

/**
 * The exact payload that is hashed and committed on-chain.
 *
 * Ten fields — everything that was **sold** and everything that **runs**, and
 * none of the platform's own bookkeeping. `id`, `agentId`, `ownerAccountId`,
 * `createdAt` and `definitionHash` itself are all absent on purpose: including
 * any of them would mean the same agent definition hashes differently on a
 * reseeded database, and reproducibility is the entire reason the hash exists.
 *
 * ⚠️ **`version` is excluded, and that is a decision rather than an oversight.**
 * `docs/agent-definition.md` §2.3 lists `version` and `definitionHash` as two
 * *separate* integrity fields, and the escrow contract agrees — `updateAgent`
 * bumps its own `version` counter and takes `defHash` as an independent
 * argument. The consequence is that republishing an identical definition
 * produces an identical fingerprint, which is correct: nothing anywhere
 * resolves a version *from* a hash. An order pins `agent_version_id`
 * (`docs/CONTEXT.md` invariant #6) and Guardian verifies by recomputing the
 * pinned version's hash, never by looking one up.
 *
 * ⚠️ **The keys here are the wire names, not the column names** — `priceMinor`,
 * not `price_minor`. A third party re-hashing a definition to check it against
 * the chain has the API contract in front of them, not our schema.
 *
 * (`specs/006-agent-catalogue/research.md` R3)
 */
export interface CanonicalDefinition {
  name: string;
  description: string;
  capabilities: string[];
  exclusions: string[];
  /** Whole USD cents. Cents everywhere outside `chain/` — invariant #2. */
  priceMinor: number;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  /** Seller IP. It is inside the commitment, and never outside the boundary. */
  systemPrompt: string;
  model: string;
  timeoutSeconds: number;
}

/** A definition's fingerprint, in the two representations that are needed. */
export interface DefinitionHash {
  /** For `registerAgent` / `updateAgent`, whose signatures take `Hex`. */
  hex: Hex;
  /** For the `definition_hash bytea` column. */
  bytes: Buffer;
}

/**
 * Recursively sorts object keys and rejects anything JSON cannot represent
 * faithfully.
 *
 * ⚠️ **This is the function the whole on-chain commitment rests on, and there is
 * an obvious wrong version of it that looks right.**
 *
 * ```ts
 * JSON.stringify(obj, Object.keys(obj).sort())   // ❌ WRONG
 * ```
 *
 * The replacer *array* is not a sort — it is a single allow-list applied at
 * **every** nesting level. Any nested object whose keys are absent from the
 * top-level list serialises as `{}`. Applied to an agent definition that
 * silently empties `inputSchema` and `outputSchema`, and the result is a hash
 * that is stable, reproducible, and completely wrong — so every determinism
 * check passes and only a nested-object comparison catches it. That is what
 * `specs/006-agent-catalogue/quickstart.md` B8 exists to do.
 *
 * **Why `.sort()` with no comparator is right.** RFC 8785 specifies ordering by
 * UTF-16 code unit, and JavaScript's default string sort compares exactly that.
 * It also repairs `Object.keys`'s own quirk: integer-like keys come back in
 * ascending *numeric* order (`["9", "10"]`), and JCS wants lexicographic
 * (`["10", "9"]`). Sorting afterwards makes the source order irrelevant.
 *
 * **Arrays are never reordered.** `capabilities` and `exclusions` are ordered
 * lists and their order is part of the definition — reordering them is a
 * different contract with the buyer, and must produce a different hash.
 */
function canonicaliseValue(value: unknown, path: string): unknown {
  if (Array.isArray(value)) {
    return value.map((item, index) => canonicaliseValue(item, `${path}[${index}]`));
  }

  if (value !== null && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};

    for (const key of Object.keys(source).sort()) {
      sorted[key] = canonicaliseValue(source[key], `${path}.${key}`);
    }

    return sorted;
  }

  // Everything below is a guard against JSON.stringify silently changing the
  // document rather than failing on it. Each of these would produce a hash for
  // a definition that is not the definition we were given.
  //
  //   undefined / function / symbol → the KEY DISAPPEARS from an object, or
  //                                   becomes `null` inside an array
  //   NaN / ±Infinity               → serialise as `null`
  //   bigint                        → JSON.stringify throws, but with a message
  //                                   that names no field
  //
  // In practice none of these can arrive: every value here has been through
  // `JSON.parse` of a request body or is a validated integer. That is exactly
  // why they are worth asserting — an impossible input reaching this function
  // means an assumption upstream has changed, and a thrown error naming the
  // path is how that gets noticed instead of quietly re-anchoring the hash.
  if (value === undefined) {
    throw new TypeError(`canonicalise: ${path} is undefined; JSON would drop the key`);
  }

  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw new TypeError(`canonicalise: ${path} is ${String(value)}; JSON would emit null`);
  }

  if (typeof value === 'bigint' || typeof value === 'function' || typeof value === 'symbol') {
    throw new TypeError(`canonicalise: ${path} is a ${typeof value}, which JSON cannot represent`);
  }

  return value;
}

/**
 * The canonical text of a definition — RFC 8785 (JSON Canonicalisation Scheme).
 *
 * Four properties, and `JSON.stringify` already provides three of them:
 *
 *  1. **Sorted keys, recursively** — `canonicaliseValue` above.
 *  2. **No insignificant whitespace** — no `space` argument.
 *  3. **Pinned number formatting** — `JSON.stringify` uses ECMAScript
 *     `Number::toString`, which is the serialisation JCS itself mandates.
 *  4. **Well-formed UTF-16 strings** — since ES2019 `JSON.stringify` escapes
 *     lone surrogates rather than emitting them raw, which is JCS-compatible.
 *
 * The ten fields are listed explicitly rather than spread from the argument.
 * That is deliberate: callers pass whole `AgentVersion` entities, and a spread
 * would quietly pull `id`, `agentId` and `createdAt` into the commitment — a
 * bug whose only symptom is that the hash stops reproducing, months later, on
 * a machine that is not this one.
 *
 * Exported alongside `definitionHash` so the exact bytes can be logged or
 * printed when a fingerprint fails to reproduce. That is the only way to tell a
 * canonicalisation bug from a data difference.
 */
export function canonicalise(definition: CanonicalDefinition): string {
  const payload: CanonicalDefinition = {
    name: definition.name,
    description: definition.description,
    capabilities: definition.capabilities,
    exclusions: definition.exclusions,
    priceMinor: definition.priceMinor,
    inputSchema: definition.inputSchema,
    outputSchema: definition.outputSchema,
    systemPrompt: definition.systemPrompt,
    model: definition.model,
    timeoutSeconds: definition.timeoutSeconds,
  };

  return JSON.stringify(canonicaliseValue(payload, 'definition'));
}

/**
 * `keccak256` of the canonical definition, in both representations the rest of
 * the feature needs.
 *
 * **Why this lives in `catalog/` rather than `chain/`.** Canonicalisation is a
 * statement about what the *product* considers a definition to be — that
 * `exclusions` is part of the sold contract and `createdAt` is not. `chain/`
 * has no business knowing that. `keccak256` and `stringToBytes` are pure
 * functions over bytes: no client, no RPC, and no unit conversion, so importing
 * them here crosses no boundary that matters. `priceMinor` enters as cents and
 * stays cents; the single `toBaseUnits` call remains inside
 * `EscrowOperatorService`, so invariant #2 is untouched.
 *
 * The entity's *"hex conversion belongs in the chain adapter"* note is about
 * the column being `bytea` rather than `text`. Returning both forms from one
 * function is what keeps the stored bytes and the committed hex from drifting.
 *
 * (`specs/006-agent-catalogue/research.md` R2, R4)
 */
export function definitionHash(definition: CanonicalDefinition): DefinitionHash {
  // stringToBytes is UTF-8, which is what JCS specifies for the octet stream.
  const hex = keccak256(stringToBytes(canonicalise(definition)));

  return { hex, bytes: Buffer.from(hex.slice(2), 'hex') };
}
