import { Injectable } from '@nestjs/common';

import type { Account } from '../entities/account.entity';
import type { AgentVersion } from '../entities/agent-version.entity';
import { AgentRepository } from './agent.repository';
import { AgentNotFoundError } from './catalog.errors';
import type { AgentVersionDetailResponse } from './dto/agent-version-detail.dto';

/**
 * `GET /agents/:id/versions` — the seller's own definitions, complete
 * (`specs/006-agent-catalogue/contracts/internal-api.md` §7).
 *
 * The only read in the product that emits `systemPrompt`, `model` and
 * `timeoutSeconds`, and the only one whose caller is guaranteed to be the
 * author of what it returns.
 *
 * ## ⚠️ Why this mapping is NOT in `agent-serialiser.ts`
 *
 * That module is the choke point every buyer-facing agent shape passes through,
 * and what makes it a choke point is not that mappers live there — it is that
 * its parameter types are a `Pick<AgentVersion, …>` with **no `systemPrompt`
 * property**. No expression inside that module can read the field, whatever a
 * future edit does to its bodies; emitting the prompt from it requires editing
 * the type on the line whose comment explains what the type is for (research
 * R9, layer 2).
 *
 * A mapper that must see the prompt cannot be written against a type defined by
 * not having it. Putting one there means widening `ListingFields` — or adding a
 * second, wider parameter type beside it — and either way the module stops
 * being "the place that structurally cannot leak" and becomes "the place that
 * mostly does not leak, depending which function you are in". So the one mapper
 * that is allowed to see the field lives out here, next to the route that
 * needs it, and `agent-serialiser.ts` keeps its guarantee intact. Contracts §9
 * records this in the module surface as a deliberate absence.
 *
 * This is also why the write services and the read services are separate
 * classes in the first place: it costs a file and it makes each file's
 * invariant a property of the file rather than of a reviewer's attention.
 */
@Injectable()
export class AgentVersionsService {
  constructor(private readonly agents: AgentRepository) {}

  /**
   * Every version of one agent, newest first, complete — provided the caller
   * owns it.
   *
   * ## ⚠️ The refusal is `AgentNotFoundError`, and it is not a mistake
   *
   * A caller who is not the owner gets the *same* error, and therefore the same
   * `404` and the same body, as a caller who asked for a uuid that was never
   * issued. Not `NotAgentOwnerError`, not a `403`, and this is the single most
   * important decision in the file (FR-029, contracts §7).
   *
   * A `403` here would say: *this uuid names a real agent, and it belongs to
   * somebody who is not you.* That sentence is an existence oracle. Any seller
   * with a session could probe ids and learn which are real and which are
   * theirs to be curious about — and the endpoint they would be probing is the
   * one whose entire purpose is to disclose the execution spec, so the oracle
   * sits directly on top of the most valuable thing in the database. "Not
   * yours" and "does not exist" must be indistinguishable **here**.
   *
   * ⚠️ **This is the opposite rule to the write routes, on purpose.**
   * `POST /agents/:id/versions` and `PATCH /agents/:id/active` answer `403`,
   * because a seller reaching those routes already holds the id from their own
   * list — confirming the agent exists tells them nothing they did not arrive
   * with, and a `404` there would tell a seller their own agent had vanished.
   * The asymmetry is deliberate and is documented on both error classes in
   * `catalog.errors.ts`. It is not an inconsistency to be tidied up in either
   * direction.
   *
   * The indistinguishability is enforced one layer down as well: the repository
   * scopes by owner **in the SQL** and returns `[]` for both cases, so this
   * method never learns which one happened and cannot leak the difference by
   * accident — not through a branch, not through a log line, not through a
   * timing difference worth measuring. Empty means empty.
   *
   * ⚠️ `[]` is therefore always a refusal, never an ordinary empty result. An
   * agent that exists has at least one version by construction —
   * `insertAgentWithFirstVersion` writes the agent and version 1 in the same
   * statement pair, and versions are never deleted (FR-032). There is no such
   * thing as a versionless agent to report an empty list for.
   *
   * An **inactive** agent returns `200` here as normal. Availability is the
   * seller's switch for buyers; it was never a restriction on the owner's own
   * view, and hiding a paused agent from its author is how a paused agent
   * becomes an unrecoverable one.
   */
  async listForOwner(
    account: Account,
    agentId: string,
  ): Promise<AgentVersionDetailResponse[]> {
    const versions = await this.agents.findVersionsForOwner(agentId, account.id);

    if (versions.length === 0) {
      // The message is for the log, not for the caller. Whatever the controller
      // renders must be identical to what an unknown uuid produces — including
      // the words — or the oracle is back with extra steps.
      throw new AgentNotFoundError(
        `agent ${agentId} not found for account ${account.id}`,
        agentId,
      );
    }

    return versions.map(toVersionDetail);
  }
}

/**
 * One `agent_versions` row as §7's response object.
 *
 * ⚠️ **Not exported, and not a candidate for the serialiser module.** It reads
 * `systemPrompt`, so it belongs to this file and this route; a second import
 * site would be the beginning of a second disclosure path (research R9).
 *
 * ⚠️ **Field by field, never `{ ...version }`.** A spread compiles away the
 * whole point: it would carry `agentId` today and every column added to the
 * entity tomorrow into a body that is already the widest one in the product.
 * The response interface is closed, so an excess-property check catches the
 * literal form — but only the literal form. This is the single response type
 * where a stray field costs the most, and naming all fourteen is what makes
 * "what does this route disclose?" answerable by reading fourteen lines.
 */
function toVersionDetail(version: AgentVersion): AgentVersionDetailResponse {
  return {
    // The VERSION row's id. Its `agentId` is deliberately not emitted — the
    // caller supplied it on the path and §7 does not list it.
    id: version.id,
    version: version.version,
    name: version.name,
    description: version.description,
    capabilities: version.capabilities,
    exclusions: version.exclusions,
    priceMinor: version.priceMinor,
    inputSchema: version.inputSchema,
    outputSchema: version.outputSchema,
    // The restricted three. Legitimate here and nowhere else in a response
    // body — see the header, and `AgentVersion.systemPrompt`.
    systemPrompt: version.systemPrompt,
    model: version.model,
    timeoutSeconds: version.timeoutSeconds,
    // ⚠️ `bytea` is a `Buffer`, and `JSON.stringify` turns one into
    // `{"type":"Buffer","data":[…]}` — no throw, no warning, and a seller
    // quietly unable to check their commitment against the chain, which is the
    // only reason this field is in the payload. The `0x` prefix is written
    // here rather than stored, matching `definitionHash().hex` exactly so the
    // two representations can be compared as strings.
    definitionHash: `0x${version.definitionHash.toString('hex')}`,
    createdAt: version.createdAt.toISOString(),
  };
}
