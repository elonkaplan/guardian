/**
 * Every buyer- and seller-facing response shape in the catalogue
 * (`specs/006-agent-catalogue/contracts/internal-api.md` §1–§6).
 *
 * ⚠️ **What is absent is the guarantee.** Not one of the six interfaces below
 * has `systemPrompt`, `model` or `timeoutSeconds`. That is FR-003 enforced by
 * the shape of the data rather than by anybody remembering it: a handler cannot
 * leak seller IP through these routes because the type it must return gives the
 * prompt nowhere to sit. This is layer 3 of the three described on
 * `AgentVersion.systemPrompt` — the queries do not select those columns, the
 * serialiser's parameter types cannot see them, and these interfaces have no
 * property to hold them. Three independent failures are needed, not one lapse.
 *
 * ⚠️ **Closed, and closed deliberately.** No index signature, and no `extends`
 * from a TypeORM entity anywhere in this file. Both would quietly undo the
 * paragraph above: with either, `return { ...version }` compiles, and the day it
 * compiles is the day the system prompt ships in a public response body with
 * every rule about it still perfectly well documented. The excess-property check
 * on an exact object literal is what turns that mistake into a build failure, so
 * a mapper must name each field it emits.
 *
 * **`AgentVersionDetailResponse` is deliberately NOT here.** §7's owner-only
 * `GET /agents/:id/versions` is the one route that may emit `systemPrompt`, and
 * its type lives in its own file (`agent-version-detail.dto.ts`) for the same
 * reason `agent-serialiser.ts` has no `toAgentVersionDetail`: a shape that is
 * allowed to carry the prompt does not belong in the module whose defining
 * property is not carrying it. Keeping it out is not tidiness — it is the
 * boundary. Do not add it here later "so the DTOs are together".
 *
 * ⚠️ **Field names are literal.** `ui/src/api/types.ts` already declares
 * `AgentSummary` and `AgentListing` against these strings, and a mismatched key
 * does not throw: it renders as an absent value in the catalogue, the same class
 * of bug as commit `67dcf4d`. Copy from the contract, do not retype.
 *
 * (research R9, R12, R13)
 */

/**
 * One row of `GET /agents` — the public catalogue (§1).
 *
 * Four fields, matching `ui/src/api/types.ts`'s `AgentSummary` exactly. Every
 * entry in this list is both `active` and registered on-chain, so there is no
 * availability flag: an agent a buyer can see is an agent a buyer can buy
 * (FR-021), and a flag would imply the list could contain one that is not.
 */
export interface AgentSummaryResponse {
  /**
   * ⚠️ `agents.id` (uuid) — **not** the version id and **not** the on-chain id.
   * It is what `GET /agents/:id` is addressed with. The three ids in this
   * feature are easy to mix up and only one of them routes.
   */
  id: string;

  /** Latest version's `name`. */
  name: string;

  /** Latest version's `description`. */
  description: string;

  /** Whole USD cents, from the latest version. */
  priceMinor: number;
}

/**
 * `GET /agents/:id` — the public detail view (§3).
 *
 * **There is no `systemPrompt`, no `model` and no `timeoutSeconds`, and there
 * is no input under which there could be.** The query behind this route does not
 * select those columns, so they never enter the process; this type is why no
 * future edit to that query can reach a response body.
 *
 * Matches `ui/src/api/types.ts`'s `AgentListing` — except `version`, noted
 * below.
 */
export interface AgentListingResponse {
  /**
   * ⚠️ The **AGENT** id, not the version id. An order pins a version, but a
   * listing addresses an agent: the same uuid a buyer clicked in the catalogue
   * and the same one they will `POST` a purchase against. Emitting
   * `agent_versions.id` here type-checks perfectly and produces a page whose
   * every link 404s.
   */
  id: string;

  name: string;

  description: string;

  /** Whole USD cents. The buyer's price quote for this listing. */
  priceMinor: number;

  /** Half of Guardian's yardstick. May be **empty**, never absent. */
  capabilities: string[];

  /** The other, defensive half. May be **empty**, never absent. */
  exclusions: string[];

  /** The `jsonb` column verbatim — the shape a buyer's input must satisfy. */
  inputSchema: Record<string, unknown>;

  /** The `jsonb` column verbatim — what the run's output is validated against. */
  outputSchema: Record<string, unknown>;

  /**
   * Which version of the definition this listing is (research R13). Always the
   * latest (FR-023).
   *
   * `ui/src/api/types.ts`'s `AgentListing` does not declare this yet. That is
   * safe and costs nothing — a client that declares fewer fields than arrive
   * simply ignores the extra one — and API-12 should add it when the OpenAPI
   * document is written. It is included because a buyer being able to see which
   * version they are looking at is what makes version pinning legible rather
   * than folklore.
   */
  version: number;
}

/**
 * One row of `GET /agents?owner=me` — the seller's own agents (§2).
 *
 * Inactive and unregistered agents are **included** here and nowhere else: this
 * is the only view in the product where they appear (FR-025, FR-026). Filtering
 * them out would make the availability toggle one-way, since an agent hidden
 * from its owner's list can never be switched back on.
 *
 * **What is absent is the point, here too.** No `inputSchema`, no
 * `outputSchema`, and none of the three restricted fields — the seller's list is
 * a list, and giving it the execution spec would mean a component could render
 * one.
 */
export interface OwnedAgentResponse {
  /** `agents.id` (uuid). */
  id: string;

  name: string;

  description: string;

  /** Whole USD cents, from the latest version. */
  priceMinor: number;

  /** `agents.active` — the seller's availability switch. */
  active: boolean;

  /**
   * `onchain_agent_id !== null` — whether registration actually landed
   * (research R12).
   *
   * ⚠️ **Known handoff to UI-07.** `ui/specs/007-seller-pages/data-model.md`
   * §1.3 declares `OwnedAgent extends AgentSummary { active: boolean }` and
   * nothing more, so this field arrives and is ignored until `OwnedAgent` and
   * `OwnedAgentList` gain it and a badge. Sending it is safe — that document
   * states in writing that declaring fewer fields than arrive is safe — but
   * until the edit lands, an agent whose registration outcome is unknown renders
   * in the seller's list as a healthy one: a name, a price, `active: true`, and
   * no buyer anywhere able to see it. That is the only silent failure this
   * feature can produce, which is exactly why the field exists.
   *
   * ⚠️ Not `onchainAgentId: number | null`. That carries the same information
   * and puts a chain id into a seller-facing payload with no use for one,
   * inviting a component to render it. `listed` says what the seller needs to
   * know in the vocabulary they already have.
   */
  listed: boolean;
}

/**
 * `POST /agents` — the `201` body (§4).
 *
 * **Synchronous by contract**: the route does not return until `registerAgent`
 * has confirmed (FR-012), which is what lets `onchainAgentId` be a plain
 * `number` here rather than `number | null`. A `201` carrying this shape means
 * the agent is on-chain. The receipt-timeout case does not produce this body at
 * all — it is a `502`, with a row left behind because the transaction may still
 * confirm.
 *
 * `ui/specs/007-seller-pages/data-model.md` §1.4 declares no `CreateAgentResponse`
 * — the seller's client discards the body and refetches. Returning it anyway
 * costs nothing and gives the seller something to verify against the chain.
 */
export interface CreateAgentResponse {
  /** `agents.id` (uuid). */
  id: string;

  /** Always `1`. A newly listed agent has exactly one version by construction. */
  version: number;

  /**
   * The id the escrow contract assigned. **Never null on a `201`** — that is
   * the contract, not an observation about the happy path.
   *
   * ⚠️ Never re-register a `listed: false` agent by calling `registerAgent`
   * again: the contract assigns a *new* id and the seller ends up owning two
   * on-chain agents, one of them unreachable.
   */
  onchainAgentId: number;

  /**
   * keccak256 of the canonical definition, as a `0x`-prefixed 32-byte hex
   * string, so the seller can verify it on-chain by hand.
   *
   * ⚠️ Hex here, `bytea` in the column. `AgentVersion.definitionHash` is a
   * `Buffer` of raw bytes and serialising one directly yields
   * `{"type":"Buffer","data":[…]}`, which is not this. The conversion belongs to
   * the mapper.
   */
  definitionHash: `0x${string}`;

  /** Always `true` — `agents.active` defaults to `true` and the body cannot set it. */
  active: boolean;
}

/**
 * `POST /agents/:id/versions` — the `201` body (§5).
 *
 * No `onchainAgentId`: the agent is already registered (a `listed: false` agent
 * is a `409` on this route), so this call runs `updateAgent` and mints no new
 * chain id.
 *
 * An identical resubmission is accepted and returns a **new** `id` and `version`
 * carrying **the same `definitionHash`** (research R3). That is correct — the
 * hash is over the definition, not over the submission — and it must not be
 * "fixed" by refusing the duplicate.
 */
export interface CreateVersionResponse {
  /**
   * ⚠️ The new `agent_versions.id`. This is the one response in the file whose
   * `id` is a **version** id — §1, §2, §3 and §4 all carry agent ids. The
   * agent's own id is alongside it as `agentId`, which is what makes the
   * difference readable at the call site rather than guessable.
   */
  id: string;

  /** `agents.id` — the agent this version belongs to. */
  agentId: string;

  /**
   * Previous + 1. Existing versions are never updated or deleted (FR-032), and
   * a running order keeps pointing at the version it opened against (FR-035).
   */
  version: number;

  /** `0x…` 32 bytes, as on `CreateAgentResponse`. */
  definitionHash: `0x${string}`;
}

/**
 * `PATCH /agents/:id/active` — the `200` body (§6).
 *
 * The request is an absolute value, never a toggle, so this response is a
 * confirmation rather than a discovery: `active` is what the caller asked for.
 * Applying it twice leaves the world as applying it once did, and
 * `ui/specs/007-seller-pages` R9 depends on that idempotence in writing.
 *
 * Running orders are never affected (FR-038) — `setAgentActive` gates `openDeal`
 * and nothing else — which is why there is no order count or warning field here
 * for a caller to misread as one.
 */
export interface SetActiveResponse {
  /** `agents.id` (uuid). */
  id: string;

  /** The state now in force, on-chain and in the database both. */
  active: boolean;
}
