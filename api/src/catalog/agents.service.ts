import { Injectable } from '@nestjs/common';

import type { Account } from '../entities/account.entity';
import {
  toAgentListing,
  toAgentSummary,
  toOwnedAgent,
  type ListingFields,
} from './agent-serialiser';
import {
  AgentRepository,
  type OwnedListingRow,
  type PublicListingRow,
} from './agent.repository';
import { AgentNotFoundError } from './catalog.errors';
import type {
  AgentListingResponse,
  AgentSummaryResponse,
  OwnedAgentResponse,
} from './dto/agent-listing.dto';

/**
 * The catalogue's reads.
 *
 * Three of them, and every one produces its result through
 * `agent-serialiser.ts`. Nothing in this file constructs a response object by
 * hand, which is what makes the boundary a property of the module rather than a
 * habit of whoever wrote the last handler.
 *
 * Separate from `AgentWritesService` on purpose: those three methods each hold
 * a row lock across a chain call, and keeping them in another file means a lock
 * is never one careless edit away from the hottest query here.
 */
@Injectable()
export class AgentsService {
  constructor(private readonly agents: AgentRepository) {}

  /**
   * The public catalogue. Active and registered agents only, each as its latest
   * version.
   *
   * Returns `[]` rather than a `404` for an empty marketplace — "there is
   * nothing on sale" is an answer, not a missing resource.
   */
  async listPublic(): Promise<AgentSummaryResponse[]> {
    const rows = await this.agents.findPublicListings();

    return rows.map((row) => toAgentSummary(toListingFields(row), row.agentId));
  }

  /**
   * One agent's public listing.
   *
   * @throws {AgentNotFoundError} when the agent does not exist, is inactive, or
   * has no on-chain id. ⚠️ **All three are the same answer on purpose.** An
   * inactive agent answering `403` would tell a stranger it exists, and a
   * distinguishable "temporarily unavailable" would invite a client to cache
   * and re-show a listing that cannot be bought. The filter lives in the query
   * (`findPublicListing`), so this method has no way to tell the cases apart
   * even if someone later wanted it to.
   */
  async getPublicListing(agentId: string): Promise<AgentListingResponse> {
    const row = await this.agents.findPublicListing(agentId);

    if (row === null) {
      throw new AgentNotFoundError(`agent ${agentId} is not publicly listed`, agentId);
    }

    return toAgentListing(toListingFields(row), row.agentId);
  }

  /**
   * The caller's own agents — including the ones they have switched off and the
   * ones whose registration never confirmed.
   *
   * Scoped by the session's account, never by anything in the request. There is
   * no parameter for a caller to name an account with, which is the same reason
   * `GET /me` takes none: a route that accepted one would let any seller read
   * any other seller's catalogue, inactive listings and all.
   */
  async listOwned(account: Account): Promise<OwnedAgentResponse[]> {
    const rows = await this.agents.findOwnedListings(account.id);

    return rows.map((row: OwnedListingRow) =>
      toOwnedAgent(toListingFields(row), row.agentId, {
        active: row.active,
        // The raw row carries the `bigint` as a string or null; the serialiser
        // only asks whether it is present, but the type must still line up.
        onchainAgentId: row.onchainAgentId === null ? null : Number(row.onchainAgentId),
      }),
    );
  }
}

/**
 * Raw row → the serialiser's input type.
 *
 * The one job here is the `priceMinor` conversion. `SELECT` on a `bigint`
 * column hands back a **string** from the `pg` driver, and the raw-row queries
 * bypass the entity's `bigintTransformer` that would otherwise do this — so
 * without this line `priceMinor` reaches the wire as `"200"`, and any
 * arithmetic on it concatenates. `entities/transformers.ts` makes the same
 * argument for the same reason: cents in a JS number are exact to about $90
 * trillion, so the conversion is safe and the string is not.
 *
 * ⚠️ Note what this function cannot do: `PublicListingRow` has no
 * `systemPrompt`, `model` or `timeoutSeconds` — the query never selected them —
 * so this conversion step cannot reintroduce a field the boundary excluded.
 */
function toListingFields(row: PublicListingRow): ListingFields {
  return {
    name: row.name,
    description: row.description,
    capabilities: row.capabilities,
    exclusions: row.exclusions,
    priceMinor: Number(row.priceMinor),
    inputSchema: row.inputSchema,
    outputSchema: row.outputSchema,
    version: row.version,
  };
}
