import type { SeededAgentKey } from '../seeded-agents';

/**
 * One seeded listing, as reported by `POST /demo/seed`
 * (`specs/011-demo-seed-fixtures/contracts/demo-api.md` §1.1).
 *
 * ⚠️ **There is no `systemPrompt` field here, and its absence is the
 * enforcement** — not a rule someone has to remember while editing the service.
 * `/demo/seed` is unauthenticated by recorded decision (`docs/api-design.md`
 * §8), so this object is a public surface; the seller's operating instructions
 * are inside the on-chain commitment and never outside the serialisation
 * boundary (`docs/CONTEXT.md` invariant #3). The catalogue's own listing DTO
 * makes the same argument for the same reason.
 */
export interface SeededAgentResponse {
  /** Stable handle — `ledgerbot`, `tldr`, `polyglot`. Independent of the display name. */
  key: SeededAgentKey;

  /** `agents.id` (uuid) — what a purchase is placed against. */
  agentId: string;

  /**
   * The id the escrow contract assigned.
   *
   * ⚠️ Never null in a successful response. A seeded agent without one cannot be
   * bought, and the seed refuses rather than reporting one.
   */
  onchainAgentId: number;

  name: string;
  /** Whole USD cents — 200, 100, 150. Never dollars (invariant #2). */
  priceMinor: number;
  /** The active version number. `1` unless a definition was edited and re-seeded. */
  version: number;
  /** `0x`-prefixed keccak256 of the canonical definition, verifiable on-chain by hand. */
  definitionHash: string;

  /**
   * `true` if **this call** published it; `false` if it was already there.
   *
   * The field exists so an operator can confirm idempotency from the response
   * instead of counting rows in psql: a re-seed answers with three `false`s.
   */
  created: boolean;
}

/**
 * One act, published so it can be driven without re-typing.
 *
 * ⚠️ **`input` must be posted to `POST /orders` byte for byte.** It is half the
 * key the script registry looks up, so a retyped receipt is a different receipt
 * and gets a real extraction. Object key order is free (the canonical form sorts
 * keys); **array order is not** — `preserveTerms` reordered is a different
 * input.
 *
 * `acceptanceCriteria` and `complaint` are here for the same reason the input
 * is: Guardian's case file is assembled from all three, so publishing only the
 * input would leave two thirds of the demo's reproducibility to whoever is
 * typing on stage.
 */
export interface SeededFixtureResponse {
  act: 1 | 2 | 3;
  agentKey: SeededAgentKey;
  /** Resolved to the seeded row, so a caller does not have to look it up by name. */
  agentId: string;
  input: Record<string, unknown>;
  acceptanceCriteria: string;
  complaint: string;
  /**
   * The tier this act is designed to reach — documentation for the operator.
   *
   * ⚠️ It is what we *expect* Guardian to decide, never an instruction to it.
   * Nothing in the audit path reads this field, and nothing may.
   */
  expectedTier: 'none' | 'half' | 'full';
}

/**
 * `POST /demo/seed` — the `200` body.
 *
 * `200` and not `201`: the call is idempotent and, on every run after the first,
 * creates nothing.
 */
export interface SeedResponse {
  seller: {
    accountId: string;
    /** The configured payout address every seller payout in the demo lands on. */
    walletAddress: string;
  };
  /** Always three, ordered `ledgerbot`, `tldr`, `polyglot`. */
  agents: SeededAgentResponse[];
  /** Always three, ordered by act. */
  fixtures: SeededFixtureResponse[];
}
