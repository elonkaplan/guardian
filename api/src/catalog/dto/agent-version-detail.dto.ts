/**
 * The one response shape in the codebase that may carry a system prompt —
 * `GET /agents/:id/versions`, owner only
 * (`specs/006-agent-catalogue/contracts/internal-api.md` §7).
 *
 * ## ⚠️ Why this interface has a file to itself
 *
 * `agent-listing.dto.ts` holds six response types and makes one promise about
 * all of them at once: **not one of them has anywhere to put `systemPrompt`,
 * `model` or `timeoutSeconds`.** That promise is checkable in a second — open
 * the file, read it, done — and it is layer 3 of the three described on
 * `AgentVersion.systemPrompt`.
 *
 * Adding this interface beside them would not weaken the other six by a single
 * property, and it would still destroy the promise, because the promise is
 * about the *file*. "None of these can carry the prompt" is a guarantee; "one
 * of these seven can carry the prompt, check which before you copy a mapper
 * from its neighbour" is a caveat, and a caveat is a thing people stop reading.
 * Physical separation is what keeps the boundary greppable: `grep -l
 * systemPrompt src/catalog` returns the files that are allowed to say the word,
 * and that list is short precisely because this one is not folded into the
 * other.
 *
 * `agent-listing.dto.ts` already carries a comment asking that this type not be
 * moved in there "so the DTOs are together". This is the other half of it. The
 * same argument is why `agent-serialiser.ts` has no `toAgentVersionDetail`
 * (research R9, contracts §9).
 *
 * ## This is not a leak, and the distinction is the whole feature
 *
 * The boundary that `systemPrompt` sits behind is about **BUYERS**. Here the
 * caller is the seller, reading their own IP: the route is owner-scoped in SQL,
 * and a seller who cannot retrieve the prompt they wrote cannot audit what they
 * published, cannot see which version of it a running order pinned, and cannot
 * check the fingerprint they are committed to. Withholding it from its author
 * would be theatre. What FR-003 forbids is the prompt reaching someone who
 * bought the *output* of the agent, and no field of this interface ever travels
 * that way — the routes that do use the six closed types next door.
 *
 * ⚠️ **Closed, like its neighbours.** No index signature, no `extends` from
 * `AgentVersion`. This type is allowed to carry three restricted fields; it is
 * not allowed to carry a field nobody named. `agentId` in particular has no
 * business here (§7 does not list it), and an exact interface is what turns
 * `return { ...version }` into a build failure rather than a wider disclosure
 * than the contract describes.
 *
 * ⚠️ **Field names are literal**, copied from §7. A mismatched key does not
 * throw — it renders as an absent value on the seller's screen, which for
 * `definitionHash` means a seller silently unable to verify their commitment.
 */
export interface AgentVersionDetailResponse {
  /**
   * ⚠️ The **`agent_versions.id`**, not the agent id. This route returns a list
   * of siblings that all share one `agentId` and differ by this, so it is the
   * only id that identifies a row here. Emitting the agent id would give every
   * entry in the list the same value and make the response useless in a way
   * that type-checks perfectly.
   */
  id: string;

  /**
   * The seller's own counter, `1` upwards, unique per agent. The list is
   * ordered newest-first, so this descends — it is what tells the seller which
   * definition is live and which a running order pinned (FR-035).
   */
  version: number;

  name: string;

  description: string;

  /** Half of Guardian's yardstick. May be **empty**, never absent. */
  capabilities: string[];

  /** The other, defensive half. May be **empty**, never absent. */
  exclusions: string[];

  /** Whole USD cents, as this version was sold at. */
  priceMinor: number;

  /** The `jsonb` column verbatim. */
  inputSchema: Record<string, unknown>;

  /** The `jsonb` column verbatim — what a run's output is validated against. */
  outputSchema: Record<string, unknown>;

  /**
   * ⚠️ **The restricted column** — see `AgentVersion.systemPrompt` for the
   * three layers that keep it away from buyers. This property is the single
   * documented exception to all of them, and it exists because the seller
   * reading their own agent is not one of the parties those layers protect
   * against (FR-028).
   *
   * ⚠️ Never widen a buyer-facing type by copying this line. If a future
   * response needs "the definition", it needs the eight listing fields, and
   * `agent-serialiser.ts` already produces them.
   */
  systemPrompt: string;

  /** e.g. `'claude-haiku-4-5'`. Restricted, for the same reason. */
  model: string;

  /** Beyond this a run counts as non-delivery. Restricted, likewise. */
  timeoutSeconds: number;

  /**
   * keccak256 of the canonical definition, `0x`-prefixed 32-byte hex.
   *
   * ⚠️ Hex here, `bytea` in the column. `AgentVersion.definitionHash` is a
   * `Buffer`, and `JSON.stringify` renders one as
   * `{"type":"Buffer","data":[…]}` — not a hash, not comparable to anything,
   * and not something a client would throw on. The conversion belongs to the
   * mapper in `agent-versions.service.ts`; the template-literal type is what
   * makes forgetting it a compile error.
   *
   * This is the field the whole route earns its keep with: it is what lets a
   * seller re-hash their definition by hand and check it against what the
   * escrow holds.
   */
  definitionHash: `0x${string}`;

  /**
   * ISO 8601, from `created_at`. A string rather than a `Date`, so the payload
   * says the same thing whether it was produced by this process or replayed
   * from a log.
   */
  createdAt: string;
}
