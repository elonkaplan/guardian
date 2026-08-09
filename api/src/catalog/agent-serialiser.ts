import type { AgentVersion } from '../entities/agent-version.entity';
import type { Agent } from '../entities/agent.entity';
import type {
  AgentListingResponse,
  AgentSummaryResponse,
  OwnedAgentResponse,
} from './dto/agent-listing.dto';

/**
 * ⚠️ **The serialisation boundary. `docs/CONTEXT.md` invariant #3 lives here.**
 *
 * `agent_versions.system_prompt` is the seller's craft — the thing they are
 * actually selling — and a buyer must never see it, not even in a dispute
 * (`docs/agent-definition.md` §4). Otherwise filing a frivolous complaint
 * becomes a way to extract a competitor's work for the price of one order.
 *
 * **This is not a rule that every endpoint remembers. It is a shape.** Three
 * independent things have to fail before a prompt reaches a buyer:
 *
 * **1. The column is never read.** The buyer-facing queries in
 * `agent.repository.ts` name their columns explicitly, and `system_prompt`,
 * `model` and `timeout_seconds` are not among them. On a public read the prompt
 * does not enter the process at all — which is the only layer that also
 * protects a log line, an error message, and a stack trace, none of which pass
 * through this file.
 *
 * **2. This module cannot see the field.** Every function below takes
 * `ListingFields`, a `Pick<>` that has no `systemPrompt` property. Passing a
 * whole `AgentVersion` is allowed by structural typing and is still safe: no
 * expression inside these functions can read a property the parameter type does
 * not declare. Emitting the prompt would require editing that type — one line,
 * visible in review, sitting under this comment.
 *
 * **3. The return types are closed.** `AgentSummaryResponse` and friends are
 * exact interfaces with no index signature and no `extends` from an entity, so
 * spreading a row into a response is a compile error rather than a leak.
 *
 * ---
 *
 * ## On "one function"
 *
 * The spec asks for one function. This is one *module* with three mappers,
 * because the three buyer-facing routes return three genuinely different
 * shapes. What the spec is actually asking for — one place that owns every
 * buyer-facing projection, so the next sensitive field is handled once — is
 * what this module is.
 *
 * ⚠️ **Do not reconcile the wording by merging these into one mapper with a
 * mode flag.** That would be a shape branch: a conditional deciding what a
 * caller is allowed to see, which is exactly the construct spec FR-030 exists
 * to prevent. Three small functions with no branches between them is the point.
 *
 * ## What is deliberately absent
 *
 * There is no `toAgentVersionDetail` here. The owner's full view is mapped in
 * `agent-versions.service.ts`, and its absence from this file is structural: a
 * mapper that must see `systemPrompt` cannot live behind a boundary defined by
 * not having it. Keeping the two physically apart is what makes this file
 * greppable: `grep systemPrompt` over it returns this comment and no code, and
 * that is the assertion. Across the whole module the field appears in exactly
 * five files — the request DTO that accepts it, `definition-hash.ts` which
 * commits it, `agent-writes.service.ts` which stores it,
 * `dto/agent-version-detail.dto.ts`, and `agent-versions.service.ts` which maps
 * it for its owner. None of those is on a buyer's path.
 *
 * ## The wider boundary — built by API-07, in `orders/`
 *
 * Execution steps are shown to buyers, and a reasoning step can paraphrase the
 * prompt it was given without ever touching this column — so the boundary is
 * wider than one field. This comment used to say that redaction belonged "in
 * this module" and to attribute it to API-09; both were slightly wrong.
 * `GET /orders/:id/case-file` is the route that shows steps, it is **API-07's**,
 * and its mapper is `src/orders/order-serialiser.ts`.
 *
 * That is a sibling of this file rather than an addition to it, for the reason
 * `agent-versions.service.ts` is a sibling too: the case file has a *seller's*
 * copy that must carry `systemPrompt`, and a mapper that needs the field cannot
 * live behind a boundary defined by not having it. What carries across is the
 * construction, not the code — `Pick<>` parameter types with no such member,
 * closed return interfaces, and queries that never name the column.
 *
 * ⚠️ **The step redaction drops model prose; it does not shorten it.** The first
 * sentence of a paraphrase is still a paraphrase and the leak is at the start,
 * so the buyer's `summary` is composed by the platform from a step's structure
 * (`ui/docs`'s `ui-design.md` §7.1, `specs/007-orders-purchase-saga/research.md`
 * R11). Truncating would look like compliance and would not be.
 *
 * (`specs/006-agent-catalogue/research.md` R9;
 *  `specs/007-orders-purchase-saga/research.md` R10, R11)
 */

/**
 * Everything a buyer may be shown, and nothing else.
 *
 * ⚠️ **This type is the guarantee.** It is a `Pick<>` rather than a hand-written
 * interface so that a renamed column is a compile error here rather than a
 * silently absent field on the wire — but the eight members are chosen, not
 * inherited, and adding a ninth is a decision about disclosure.
 *
 * `inputSchema` and `outputSchema` are on both sides of the boundary: a buyer
 * needs them to know what to supply and what to expect, and the execution
 * engine validates against them. That is why this is a field list rather than
 * "the version, minus three columns".
 */
export type ListingFields = Pick<
  AgentVersion,
  | 'name'
  | 'description'
  | 'capabilities'
  | 'exclusions'
  | 'priceMinor'
  | 'inputSchema'
  | 'outputSchema'
  | 'version'
>;

/**
 * The availability facts that live on the agent rather than the version.
 *
 * Only the owner ever sees these — the public catalogue contains exclusively
 * agents for which both are true, so publishing them there would be a column of
 * `true`. They are not seller IP; they are facts a seller can act on and a
 * buyer cannot.
 */
export type AgentStatusFields = Pick<Agent, 'active' | 'onchainAgentId'>;

/**
 * One card in the public catalogue.
 *
 * Four fields, matching `ui/src/api/types.ts`'s `AgentSummary` exactly. The
 * list is deliberately thinner than the detail response rather than the same
 * object with fields left out — a card answers one question ("is this the agent
 * I want, and can I afford it?") and everything beyond that is weight the grid
 * does not carry.
 *
 * ⚠️ `agentId` is the AGENT's id, passed separately because `ListingFields`
 * comes off a version row and a version's own id is not what a listing is
 * addressed by. An order pins a version; a listing addresses an agent.
 */
export function toAgentSummary(
  version: ListingFields,
  agentId: string,
): AgentSummaryResponse {
  return {
    id: agentId,
    name: version.name,
    description: version.description,
    priceMinor: version.priceMinor,
  };
}

/**
 * The public detail view — everything the buyer's screen is allowed to know.
 *
 * `capabilities` and `exclusions` are passed through **verbatim** (spec
 * FR-041). They are not marketing copy: they are one half of what Guardian
 * judges a delivery against and get quoted word for word in a verdict, so
 * anything this function did to them — trimming, sorting, filtering empties —
 * would change the contract between buyer and seller after it was agreed. They
 * arrive as `text[] NOT NULL` and may be empty; an empty array is a statement a
 * buyer should see, and is not the same as an absent one.
 */
export function toAgentListing(
  version: ListingFields,
  agentId: string,
): AgentListingResponse {
  return {
    id: agentId,
    name: version.name,
    description: version.description,
    priceMinor: version.priceMinor,
    capabilities: version.capabilities,
    exclusions: version.exclusions,
    inputSchema: version.inputSchema,
    outputSchema: version.outputSchema,
    version: version.version,
  };
}

/**
 * One row in the seller's own list — the summary, plus the two facts only they
 * can act on.
 *
 * `listed` is `onchain_agent_id !== null`, and it is the only place in the
 * product where a failed registration is visible to anyone. An agent whose
 * registration outcome is unknown cannot be bought and is filtered out of every
 * buyer-facing query, so without this flag its owner would see it rendered
 * identically to a healthy listing — a row that looks fine and that no buyer
 * can see. That is the single silent failure this feature can produce.
 *
 * ⚠️ **`listed` is not yet declared by `ui/specs/007-seller-pages`'s
 * `OwnedAgent`.** Sending it is safe — that spec states declaring fewer fields
 * than arrive is safe — but until `OwnedAgent` and `OwnedAgentList` are edited
 * the seller's screen has nowhere to render it. One field, one badge, and it is
 * worth doing.
 *
 * Note this returns the summary fields, not the listing fields: the seller's
 * list has no use for schemas, and giving it none means no component on that
 * screen can render an execution spec even if this function regressed.
 */
export function toOwnedAgent(
  version: ListingFields,
  agentId: string,
  status: AgentStatusFields,
): OwnedAgentResponse {
  return {
    id: agentId,
    name: version.name,
    description: version.description,
    priceMinor: version.priceMinor,
    active: status.active,
    listed: status.onchainAgentId !== null,
  };
}
