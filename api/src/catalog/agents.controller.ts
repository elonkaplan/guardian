import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UnauthorizedException,
} from '@nestjs/common';

import { CurrentAccount } from '../auth/current-account.decorator';
import {
  OptionalAccount,
  OptionalAuth,
} from '../auth/optional-auth.decorator';
import { Public } from '../auth/public.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { Account } from '../entities/account.entity';
import { AgentWritesService } from './agent-writes.service';
import { AgentsService } from './agents.service';
import { AgentVersionsService } from './agent-versions.service';
import { toHttpException } from './catalog-http';
import type {
  AgentListingResponse,
  AgentSummaryResponse,
  CreateAgentResponse,
  CreateVersionResponse,
  OwnedAgentResponse,
  SetActiveResponse,
} from './dto/agent-listing.dto';
import type { AgentVersionDetailResponse } from './dto/agent-version-detail.dto';
import { createAgentSchema, type CreateAgentDto } from './dto/create-agent.dto';
import { setActiveSchema, type SetActiveDto } from './dto/set-active.dto';

/**
 * The catalogue's HTTP surface — the marketplace a buyer browses and the
 * listings a seller manages.
 *
 * **Public and owner views are separate routes, never one route branching on
 * who is asking.** `GET /agents/:id` returns the listing; the execution spec is
 * only ever reachable through `GET /agents/:id/versions`, a different path with
 * a different guard. That separation *is* spec FR-030: there is no conditional
 * anywhere in this file deciding whether a system prompt is included, because
 * the two shapes are produced by two different services from two different
 * queries. A future refactor that unifies them behind a flag would undo the
 * feature.
 *
 * The one branch that does exist — `?owner=me` on `GET /` — selects a row
 * filter and two status fields, not a shape. Both sides go through a serialiser
 * that structurally cannot emit a prompt.
 *
 * **`@Public()` appears only on the buyer-facing reads.** The global
 * `JwtAuthGuard` is fail-closed, so every write in this file is protected by
 * saying nothing, and `@CurrentAccount()` is the whole contract with `auth/`.
 * ⚠️ `@Public()` must never migrate to the class: it would apply to every
 * handler here, including ones added later by someone who never read this.
 */
@Controller('agents')
export class AgentsController {
  constructor(
    private readonly agents: AgentsService,
    private readonly versions: AgentVersionsService,
    private readonly writes: AgentWritesService,
  ) {}

  /**
   * The catalogue, or the caller's own agents when `?owner=me` is supplied.
   *
   * ## Why one route with a branch here is not the branch FR-030 forbids
   *
   * The conditional this feature must not have is the one that decides whether
   * a **system prompt** is included. That decision is made by *routing*:
   * `GET /agents/:id` is the listing and `GET /agents/:id/versions` is the
   * execution spec, two paths with two guards and two services.
   *
   * What `?owner=me` selects is a row filter and two status fields — `active`
   * and `listed`, facts about availability that a seller can act on and a buyer
   * cannot. Both sides go through `agent-serialiser.ts`, which structurally
   * cannot emit a prompt, so the property FR-030 protects does not depend on
   * which way this `if` goes. The two sides also call two different repository
   * methods, and the owner one takes an account id as a required argument, so
   * the public path cannot reach owner rows and the owner path cannot run
   * unscoped.
   *
   * ## Why `@OptionalAuth()` and not `@Public()`
   *
   * `@Public()` returns before the token is read, so `request.account` would
   * never be set and the owner query could not learn who is asking. This
   * decorator allows a request with no credential through and refuses a bad one
   * — a lapsed session gets a `401` telling it to sign in again, rather than an
   * anonymous catalogue that renders as "you have no agents".
   */
  @Get()
  @OptionalAuth()
  async list(
    @OptionalAccount() account: Account | undefined,
    @Query('owner') owner?: string,
  ): Promise<AgentSummaryResponse[] | OwnedAgentResponse[]> {
    if (owner === undefined) {
      return this.agents.listPublic();
    }

    // ⚠️ Any other value is a `400`, never a silent fallback to the public
    // list. `?owner=0xabc…` quietly returning the marketplace would look like
    // a working filter that ignores its argument.
    if (owner !== 'me') {
      throw new BadRequestException(
        `owner must be 'me' if supplied; received '${owner}'`,
      );
    }

    if (account === undefined) {
      throw new UnauthorizedException('Authentication required');
    }

    return this.agents.listOwned(account);
  }

  /**
   * One agent's public listing — the buyer's detail screen.
   *
   * `404` for an agent that is inactive or unregistered, exactly as for one
   * that never existed: a listing that can be seen is a listing that can be
   * bought, and the query cannot tell the three cases apart.
   *
   * `ParseUUIDPipe` makes a malformed id a `400` before Postgres is asked to
   * compare a uuid column against `not-a-uuid`, which would surface as a driver
   * error and be rendered as a `500` — a client mistake reported as ours.
   */
  @Get(':id')
  @Public()
  async getOne(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<AgentListingResponse> {
    try {
      return await this.agents.getPublicListing(id);
    } catch (err) {
      throw toHttpException(err);
    }
  }

  /**
   * Every version of an agent, in full — **the one route that returns the
   * execution spec**, and only to the account that owns it.
   *
   * ⚠️ **A non-owner gets `404`, not `403`, and that asymmetry with the write
   * routes is deliberate.** A `403` asserts "this uuid is real and belongs to
   * someone else", which turns the one endpoint whose purpose is disclosing
   * seller IP into an existence oracle for other sellers' agent ids (FR-029).
   * The write routes answer `403` because the caller already holds the id from
   * their own list, so confirming it exists tells them nothing they did not
   * supply.
   *
   * The `404` is not produced by a check in this handler. It falls out of the
   * query: `findVersionsForOwner` scopes by owner in its `WHERE`, so a
   * non-owner and an unknown uuid both come back as `[]`, and
   * `AgentVersionsService` renders both as `AgentNotFoundError`. Nothing in
   * this path ever *learns* which case occurred, so nothing can leak the
   * difference through a branch, a message, or a log line. That is a stronger
   * guarantee than remembering to answer `404` here would have been.
   */
  @Get(':id/versions')
  async listVersions(
    @CurrentAccount() account: Account,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<AgentVersionDetailResponse[]> {
    try {
      return await this.versions.listForOwner(account, id);
    } catch (err) {
      throw toHttpException(err);
    }
  }

  /**
   * List an agent. Creates the agent and its version 1, hashes the definition,
   * and registers it on-chain.
   *
   * ⚠️ **Synchronous, and slow on purpose.** It does not answer until
   * `registerAgent` has confirmed and the id the contract assigned is in hand,
   * because an agent without one cannot be bought (see
   * `AgentWritesService.createAgent`). Seconds, not milliseconds. The seller's
   * form has nothing to poll for afterwards, which is the point.
   *
   * The response carries `definitionHash` so a seller can check the commitment
   * against the chain themselves without asking us for it — the whole argument
   * for anchoring it in the first place.
   */
  @Post()
  async create(
    @CurrentAccount() account: Account,
    @Body(new ZodValidationPipe(createAgentSchema)) body: CreateAgentDto,
  ): Promise<CreateAgentResponse> {
    try {
      return await this.writes.createAgent(account, body);
    } catch (err) {
      // `toHttpException` either returns an exception describing a catalogue or
      // chain failure, or rethrows what is nobody's to translate. Written this
      // way both paths end in a throw and the rethrow is invisible here.
      throw toHttpException(err);
    }
  }

  /**
   * Publish a new version. The previous one is left exactly as it was.
   *
   * Same body as `POST /agents` — one schema, two routes — because a version
   * *is* a complete definition. There is no partial-update shape here on
   * purpose: a patch would let a seller change `capabilities` without restating
   * the prompt those capabilities describe, and the fingerprint covers both.
   */
  @Post(':id/versions')
  async createVersion(
    @CurrentAccount() account: Account,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(createAgentSchema)) body: CreateAgentDto,
  ): Promise<CreateVersionResponse> {
    try {
      return await this.writes.publishVersion(account, id, body);
    } catch (err) {
      throw toHttpException(err);
    }
  }

  /**
   * Switch an agent's availability.
   *
   * Idempotent: `active` is an absolute value, never a toggle instruction, so
   * sending the value the agent already holds succeeds and changes nothing.
   * `ui/specs/007-seller-pages` R9 relies on that in writing — it is why this
   * call is exempt from that app's non-idempotency doctrine.
   *
   * ⚠️ Switching an agent off stops **new** purchases and does nothing to ones
   * already running. That is a property of the contract, not of this handler.
   */
  @Patch(':id/active')
  async setActive(
    @CurrentAccount() account: Account,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(setActiveSchema)) body: SetActiveDto,
  ): Promise<SetActiveResponse> {
    try {
      return await this.writes.setActive(account, id, body.active);
    } catch (err) {
      throw toHttpException(err);
    }
  }
}
