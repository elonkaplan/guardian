import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { type EntityManager, Repository } from 'typeorm';

import { Agent } from '../entities/agent.entity';
import { AgentVersion } from '../entities/agent-version.entity';
import { Complaint } from '../entities/complaint.entity';
import { OrderState } from '../entities/enums';
import { Order } from '../entities/order.entity';
import { Run } from '../entities/run.entity';

/**
 * Everything the orders module reads and writes against `orders`, `complaints`
 * and the two tables an order is resolved *through*.
 *
 * ## Why so many methods select columns by name
 *
 * `agent_versions.system_prompt` is the seller's craft and a buyer must never
 * see it, not even in a dispute (`docs/CONTEXT.md` invariant #3). The
 * catalogue's serialiser makes that true at the mapping layer; this class makes
 * it true one layer earlier, by not fetching the column at all on any path a
 * buyer can reach. That is the only layer that also protects a log line, an
 * error message and a stack trace, none of which pass through a serialiser.
 *
 * It is why `findCaseFileForBuyer` and `findCaseFileForSeller` are two methods
 * rather than one with a boolean. A flag would put the disclosure decision
 * inside a query builder, where a later edit could flip it without touching
 * anything that looks like a security boundary
 * (`specs/007-orders-purchase-saga/research.md` R10).
 *
 * ## Transactions
 *
 * The write methods take an `EntityManager` because their transaction belongs
 * to a service, and the two services own it for **opposite** reasons:
 * `purchase.service.ts` commits before it calls the chain, so a rollback cannot
 * destroy the record of whose money is in escrow; `settlement.service.ts` calls
 * the chain inside its transaction, so a chain failure records nothing (R2, R8).
 * A repository method that opened a transaction of its own would be a way to
 * opt out of either guarantee by accident.
 */
@Injectable()
export class OrderRepository {
  constructor(
    @InjectRepository(Order)
    private readonly orders: Repository<Order>,
  ) {}

  // -------------------------------------------------------------------
  // Reads
  // -------------------------------------------------------------------

  /**
   * The one join every order read authorises against: the order, the listing of
   * the version it pinned, the agent's current owner, and the run if there is
   * one.
   *
   * ## ⚠️ The seller is resolved through the version, never stored on the order
   *
   * `orders` has no seller column and must not grow one. An order points at
   * `agent_version_id` (invariant #6); the owner is reached
   * `order → agent_version → agent → owner_account_id`. Copying a seller id onto
   * the order at purchase time would freeze it, and the two reads would then
   * authorise against whoever owned the agent *when the order was placed* rather
   * than whoever owns it now.
   *
   * ## ⚠️ Authorisation is decided here, on a row that was fetched anyway
   *
   * The caller passes `accountId` and gets `null` for **both** "no such order"
   * and "you are party to neither side". Those two facts must be
   * indistinguishable from outside (FR-036): a `403` for the second would
   * confirm the order exists to anyone probing uuids, which turns the route into
   * an existence oracle. Returning one `null` means no caller *can* tell them
   * apart, rather than being trusted not to.
   *
   * A second query — load, then check ownership — would produce the same answer
   * and put the ownership rule at each of the five call sites instead of here.
   *
   * `system_prompt` is deliberately absent from the selected columns: this row
   * feeds `GET /orders/:id`, which is a buyer-facing read.
   */
  async findVisibleToAccount(
    orderId: string,
    accountId: string,
  ): Promise<VisibleOrderRow | null> {
    const row = await this.orders
      .createQueryBuilder('o')
      .innerJoin(AgentVersion, 'v', 'v.id = o.agent_version_id')
      .innerJoin(Agent, 'a', 'a.id = v.agent_id')
      .leftJoin(Run, 'r', 'r.order_id = o.id')
      .select([
        'o.id AS "id"',
        'o.state AS "state"',
        'o.price_minor AS "priceMinor"',
        'o.acceptance_criteria AS "acceptanceCriteria"',
        'o.review_window_seconds AS "reviewWindowSeconds"',
        'o.input AS "input"',
        'o.onchain_deal_id AS "onchainDealId"',
        'o.buyer_account_id AS "buyerAccountId"',
        'o.created_at AS "createdAt"',
        'o.delivered_at AS "deliveredAt"',
        'o.disputed_at AS "disputedAt"',
        'o.settled_at AS "settledAt"',
        'v.name AS "agentName"',
        'a.owner_account_id AS "ownerAccountId"',
        'r.id AS "runId"',
        'r.input AS "runInput"',
        'r.output AS "runOutput"',
      ])
      .where('o.id = :orderId', { orderId })
      // Both sides of the trade, in one predicate. Keeping it in SQL rather than
      // comparing in TypeScript afterwards means there is no branch between
      // "fetched" and "allowed" for a later edit to get wrong.
      .andWhere('(o.buyer_account_id = :accountId OR a.owner_account_id = :accountId)', {
        accountId,
      })
      .getRawOne<VisibleOrderRow>();

    return row ?? null;
  }

  /**
   * The agent's latest version, with the two facts that decide whether it can be
   * bought at all.
   *
   * Returns `null` when the agent is unknown, **inactive**, or carries no
   * `onchain_agent_id` — one answer for three facts, on the same reasoning
   * `catalog.errors.ts` gives for `AgentNotFoundError`. Splitting them would
   * invite a caller to say which applied, and "this agent is currently inactive"
   * confirms to a stranger that the id is real and that a seller paused it.
   *
   * ⚠️ **`onchain_agent_id IS NOT NULL` is a purchase precondition, not a
   * tidiness check.** `openDeal` takes the on-chain agent id; an agent without
   * one cannot be bought, and letting the purchase get as far as the chain call
   * would spend a transaction to discover it.
   *
   * `ORDER BY version DESC LIMIT 1` rather than the `DISTINCT ON` the catalogue's
   * listing queries use: those resolve the latest version of *many* agents in one
   * pass, and `DISTINCT ON` is the right tool there. This resolves one, where the
   * simpler form says exactly what it means.
   *
   * The price and schema come off that row and are snapshotted onto the order by
   * the caller, inside its transaction — a seller republishing a second later
   * cannot move what this buyer was charged.
   */
  async findPurchasableVersion(agentId: string): Promise<PurchasableVersionRow | null> {
    const row = await this.orders.manager
      .createQueryBuilder(AgentVersion, 'v')
      .innerJoin(Agent, 'a', 'a.id = v.agent_id')
      .select([
        'v.id AS "agentVersionId"',
        'v.price_minor AS "priceMinor"',
        'v.input_schema AS "inputSchema"',
        'a.onchain_agent_id AS "onchainAgentId"',
      ])
      .where('a.id = :agentId', { agentId })
      .andWhere('a.active = true')
      .andWhere('a.onchain_agent_id IS NOT NULL')
      .orderBy('v.version', 'DESC')
      .limit(1)
      .getRawOne<PurchasableVersionRow>();

    return row ?? null;
  }

  /**
   * Every order this account placed, newest first, in any state.
   *
   * Uses `orders_buyer_idx (buyer_account_id, created_at DESC)`, which covers
   * both the predicate and the sort. No pagination — `docs/CONTEXT.md` §6 puts
   * it out of scope and demo scale makes the whole list cheap.
   *
   * `failed` orders are included on purpose (FR-045): a buyer must be able to see
   * that a purchase did not complete, and hiding it would leave a debit and a
   * compensating credit in their statement with nothing to explain them.
   */
  async findByBuyer(accountId: string): Promise<OrderSummaryRow[]> {
    return this.orders
      .createQueryBuilder('o')
      .innerJoin(AgentVersion, 'v', 'v.id = o.agent_version_id')
      .select([
        'o.id AS "id"',
        'o.state AS "state"',
        'o.price_minor AS "priceMinor"',
        'o.created_at AS "createdAt"',
        'o.delivered_at AS "deliveredAt"',
        'o.disputed_at AS "disputedAt"',
        'v.name AS "agentName"',
      ])
      .where('o.buyer_account_id = :accountId', { accountId })
      .orderBy('o.created_at', 'DESC')
      // The same tiebreak `ledger.repository.ts` documents: `now()` is the
      // transaction's start time, so rows written together carry identical
      // timestamps and their relative order would otherwise be unspecified —
      // visible as a list that reshuffles between polls with no data changing.
      .addOrderBy('o.id', 'DESC')
      .getRawMany<OrderSummaryRow>();
  }

  /**
   * Every order placed against any agent this account owns.
   *
   * ⚠️ **Reached through the agent, because an order names a definition and
   * never a seller.** Two hops — `orders → agent_versions → agents` — filtered on
   * `agents.owner_account_id`.
   *
   * ⚠️ **`agents.active` is deliberately not in this predicate.** A seller who
   * takes an agent down still sold what they sold; filtering on availability
   * would erase their own sales history the moment they curate their catalogue
   * (FR-046).
   *
   * No index supports the outer filter and none is added: both joins are over
   * primary keys and `agents` holds a handful of rows at demo scale
   * (`specs/007-orders-purchase-saga/research.md` R15).
   */
  async findBySeller(accountId: string): Promise<OrderSummaryRow[]> {
    return this.orders
      .createQueryBuilder('o')
      .innerJoin(AgentVersion, 'v', 'v.id = o.agent_version_id')
      .innerJoin(Agent, 'a', 'a.id = v.agent_id')
      .select([
        'o.id AS "id"',
        'o.state AS "state"',
        'o.price_minor AS "priceMinor"',
        'o.created_at AS "createdAt"',
        'o.delivered_at AS "deliveredAt"',
        'o.disputed_at AS "disputedAt"',
        'v.name AS "agentName"',
      ])
      .where('a.owner_account_id = :accountId', { accountId })
      .orderBy('o.created_at', 'DESC')
      .addOrderBy('o.id', 'DESC')
      .getRawMany<OrderSummaryRow>();
  }

  /**
   * The buyer's case file.
   *
   * ⚠️ **`system_prompt` is not in the select list, and that absence is the
   * point.** On this path the seller's prompt never enters the process — not
   * into a variable, not into a log line, not into a stack trace. A serialiser
   * that omits the field still fetched it; this does not fetch it.
   *
   * That is why this is a separate method from `findCaseFileForSeller` rather
   * than one query with a flag. A boolean would put the disclosure decision
   * inside a query builder, where a later edit could flip it without touching
   * anything that looks like a security boundary (R10).
   *
   * ⚠️ **`runs.steps` IS selected, raw, and the redaction happens above.** It
   * used to be a seller-only column, so the prompt-adjacent prose in `reasoning`
   * could not reach a buyer's log line or stack trace either. That layer is
   * deliberately given up here: `reasoning` shares a jsonb column with the fields
   * a buyer's summary is composed from, so the choice was the whole trace or none
   * of it, and none of it meant a buyer disputing an order saw no evidence at
   * all. The disclosure boundary for the buyer's copy is now
   * `toBuyerCaseFileSteps` plus `CaseFileStepResponse`, not this select list.
   *
   * `capabilities` and `exclusions` come off the **pinned** version, never the
   * agent's current one: a seller who lost a dispute has every reason to edit the
   * capability that was cited against them, and explaining a ruling with today's
   * listing would break the trace from a citation to its source.
   */
  async findCaseFileForBuyer(
    orderId: string,
    accountId: string,
  ): Promise<CaseFileRow | null> {
    const row = await this.caseFileQuery(orderId, accountId).getRawOne<CaseFileRow>();

    return row ?? null;
  }

  /**
   * The seller's case file — the buyer's, plus the two things that are theirs.
   *
   * `system_prompt` is selected here because the prompt belongs to the seller,
   * and it is now the **only** column that separates the two case files. Both
   * select `runs.steps` raw; what differs is what the mapping above them emits —
   * the seller's copy carries the unredacted trace beside the redacted one
   * (`docs/ui-design.md` §7.1: *"the seller's own view of the case file stays
   * unredacted; it's their prompt"*), the buyer's carries only the redaction.
   *
   * ⚠️ The caller must have already established that the requester **is** the
   * agent's owner. The `accountId` predicate below admits the buyer too — it is
   * the visibility check, not the disclosure check — so calling this for a buyer
   * would hand them the prompt. `case-file.service.ts` owns that decision and is
   * the only caller.
   */
  async findCaseFileForSeller(
    orderId: string,
    accountId: string,
  ): Promise<SellerCaseFileRow | null> {
    const row = await this.caseFileQuery(orderId, accountId)
      .addSelect('v.system_prompt', 'systemPrompt')
      .getRawOne<SellerCaseFileRow>();

    return row ?? null;
  }

  /**
   * The columns both case files share. Kept private so neither public method can
   * drift from the other on anything except the two disclosure columns.
   */
  private caseFileQuery(orderId: string, accountId: string) {
    return this.orders
      .createQueryBuilder('o')
      .innerJoin(AgentVersion, 'v', 'v.id = o.agent_version_id')
      .innerJoin(Agent, 'a', 'a.id = v.agent_id')
      .leftJoin(Run, 'r', 'r.order_id = o.id')
      .select([
        'o.input AS "input"',
        'o.acceptance_criteria AS "acceptanceCriteria"',
        'v.capabilities AS "capabilities"',
        'v.exclusions AS "exclusions"',
        'r.id AS "runId"',
        'r.output AS "runOutput"',
        'r.error AS "runError"',
        'r.duration_ms AS "runDurationMs"',
        // ⚠️ Shared, not a seller-only column any more. The raw jsonb — reasoning
        // included — now enters the process on a buyer's read too, because a
        // buyer is owed the summarised trace (`api-design.md` §1.3) and
        // `reasoning` lives in the same column as the fields the summary is
        // composed from, so no select list can separate them. What protects the
        // buyer's copy is `toBuyerCaseFileSteps`, which reads four fields by
        // name, and `CaseFileStepResponse`, which has nowhere to put a fifth.
        // See `case-file.service.ts` `getForBuyer` for the full argument.
        'r.steps AS "runSteps"',
      ])
      .where('o.id = :orderId', { orderId })
      .andWhere('(o.buyer_account_id = :accountId OR a.owner_account_id = :accountId)', {
        accountId,
      });
  }

  // -------------------------------------------------------------------
  // Writes
  // -------------------------------------------------------------------

  /**
   * Insert the order. Takes a manager because it must share the purchase's
   * transaction with the ledger debit that pays for it.
   *
   * ⚠️ **Takes `agentVersionId`, never an agent id.** There is deliberately no
   * `agent_id` column on `orders`, and adding one would be a defect rather than
   * a convenience: pinning the version is what makes "judged against the
   * definition that actually ran" true by construction (invariant #6).
   *
   * ⚠️ **The caller must insert this BEFORE the ledger debit.**
   * `ledger_entries.order_id` references this row, so a debit written first
   * fails the foreign key.
   *
   * `priceMinor` and `reviewWindowSeconds` are snapshots the caller read inside
   * the same transaction, not live reads. `onchain_deal_id` is left NULL — the
   * escrow contract assigns it and has not been called yet.
   */
  async insertOrder(
    manager: EntityManager,
    input: {
      buyerAccountId: string;
      agentVersionId: string;
      priceMinor: number;
      reviewWindowSeconds: number;
      input: Record<string, unknown>;
      acceptanceCriteria: string;
    },
  ): Promise<Order> {
    const repo = manager.getRepository(Order);

    return repo.save(
      repo.create({
        buyerAccountId: input.buyerAccountId,
        agentVersionId: input.agentVersionId,
        priceMinor: input.priceMinor,
        reviewWindowSeconds: input.reviewWindowSeconds,
        input: input.input,
        acceptanceCriteria: input.acceptanceCriteria,
        state: OrderState.Purchased,
        onchainDealId: null,
      }),
    );
  }

  /**
   * Mark an order as having failed to open, leaving `onchain_deal_id` NULL.
   *
   * ## ⚠️ This is the only writer of `failed` + NULL deal id in the system
   *
   * That matters more than it looks. `failed` covers two situations that share a
   * word and nothing else:
   *
   * | | deal id | Tokens escrowed | Written by |
   * | --- | --- | --- | --- |
   * | `openDeal` was refused | **NULL** | no — and the buyer is already compensated | **this method** |
   * | The agent ran and produced nothing | set | yes, until the reclaimer sweeps | execution (API-08) |
   *
   * Because nothing else can produce the first row shape,
   * `state = 'failed' AND onchain_deal_id IS NULL` is an **exact** test for "this
   * purchase was compensated" rather than a heuristic — which is what
   * `escrow-exposure.repository.ts` relies on to keep compensated money out of
   * `inEscrowMinor` without dropping mid-saga money from it.
   *
   * ⚠️ It must **not** be used for a receipt timeout. An unknown outcome leaves
   * the order in `purchased`, because the money may genuinely be escrowed and
   * calling it `failed` here would license a compensating credit that breaks
   * solvency. See `purchase.service.ts`.
   */
  async markFailed(manager: EntityManager, orderId: string): Promise<void> {
    await manager.getRepository(Order).update({ id: orderId }, { state: OrderState.Failed });
  }

  /**
   * Record the deal id the escrow contract assigned.
   *
   * Runs **after** the purchase transaction has committed, on its own
   * connection, because the chain call it follows also happens after that commit
   * (R2). No manager parameter, deliberately: there is no transaction left for
   * it to join, and offering one would suggest this could be folded back inside.
   */
  async setOnchainDealId(orderId: string, onchainDealId: number): Promise<void> {
    await this.orders.update({ id: orderId }, { onchainDealId });
  }

  /**
   * Load an order for a settling action, holding its row lock for the rest of
   * the caller's transaction.
   *
   * ⚠️ **The lock is what makes the state checks mean anything.** Accept and
   * complain both read the state, decide, and then write — the textbook
   * check-then-act race. Without `FOR UPDATE`, a buyer double-clicking Complain
   * gets two transactions that both read `delivered`, both pass, and both send a
   * `dispute`; the second reverts on-chain, but only after the first has already
   * been charged for it. The `complaints.order_id UNIQUE` constraint would catch
   * the duplicate row, and it would catch it *after* the chain call.
   *
   * Unlike `findVisibleToAccount` this takes **no** `accountId`: the settling
   * actions are buyer-only, and the caller compares `buyerAccountId` itself so
   * that "not found" and "not yours" stay one answer. Returning `null` only for
   * a genuinely absent order keeps that decision in one readable place.
   */
  async findForSettlement(
    manager: EntityManager,
    orderId: string,
  ): Promise<Order | null> {
    return manager.getRepository(Order).findOne({
      where: { id: orderId },
      lock: { mode: 'pessimistic_write' },
    });
  }

  /** Uncontested settlement: the buyer accepted, or the window lapsed. */
  async markReleased(manager: EntityManager, orderId: string): Promise<void> {
    await manager
      .getRepository(Order)
      .update({ id: orderId }, { state: OrderState.Released, settledAt: new Date() });
  }

  /**
   * The buyer complained. `disputed_at` is set here rather than inferred later,
   * because it stays true through every state after it — a seller's sales list
   * reads it as a fact so a state added later cannot silently unmark a dispute.
   */
  async markDisputed(manager: EntityManager, orderId: string): Promise<void> {
    await manager
      .getRepository(Order)
      .update({ id: orderId }, { state: OrderState.Disputed, disputedAt: new Date() });
  }

  /**
   * Record the buyer's stated reason.
   *
   * ⚠️ `complaints.order_id` is `UNIQUE`, so "one complaint per order, no
   * amendments, no re-filing" is a database guarantee rather than an API check
   * someone eventually forgets (FR-031). A second insert raises inside the
   * caller's transaction and takes the chain call down with it, which is the
   * correct order of events — the service checks first only so the buyer gets a
   * `409` instead of a constraint violation.
   */
  async insertComplaint(
    manager: EntityManager,
    orderId: string,
    reason: string,
  ): Promise<Complaint> {
    const repo = manager.getRepository(Complaint);

    return repo.save(repo.create({ orderId, reason }));
  }

  /** Whether this order already carries a complaint. */
  async hasComplaint(manager: EntityManager, orderId: string): Promise<boolean> {
    const count = await manager.getRepository(Complaint).countBy({ orderId });

    return count > 0;
  }
}

/**
 * One order with everything needed to render it and to authorise the caller.
 *
 * A raw row rather than an entity graph: the three joins produce a flat result
 * and mapping it into nested entities would cost a second pass for nothing. The
 * `run*` columns are `null` when no run exists, which is the normal state of a
 * `purchased` order and not an error.
 *
 * ⚠️ No `systemPrompt` member, and the query does not select the column. The
 * absence is the guarantee, in the same way `ListingFields` is in
 * `catalog/agent-serialiser.ts`.
 */
export interface VisibleOrderRow {
  id: string;
  state: OrderState;
  priceMinor: string;
  acceptanceCriteria: string;
  reviewWindowSeconds: number;
  input: Record<string, unknown>;
  onchainDealId: string | null;
  buyerAccountId: string;
  createdAt: Date;
  deliveredAt: Date | null;
  disputedAt: Date | null;
  settledAt: Date | null;
  agentName: string;
  ownerAccountId: string;
  runId: string | null;
  runInput: Record<string, unknown> | null;
  runOutput: Record<string, unknown> | null;
}

/**
 * The three facts a purchase needs about the version it is about to pin.
 *
 * `onchainAgentId` is non-null by the query's own predicate — an agent without
 * one is filtered out rather than returned for the caller to check.
 *
 * ⚠️ `priceMinor` arrives as a **string**: `bigint` columns come off the driver
 * that way when selected raw, without the entity's transformer in the path. The
 * caller converts once, at the point it snapshots the value onto the order.
 */
export interface PurchasableVersionRow {
  agentVersionId: string;
  priceMinor: string;
  inputSchema: Record<string, unknown>;
  onchainAgentId: string;
}

/**
 * One row in either list. The buyer's and the seller's projections differ only
 * in which fields the serialiser carries through — the seller's drops
 * `deliveredAt`, because the sales list answers "what did I sell and is anyone
 * disputing it", not "is my delivery ready to accept".
 */
export interface OrderSummaryRow {
  id: string;
  state: OrderState;
  priceMinor: string;
  createdAt: Date;
  deliveredAt: Date | null;
  disputedAt: Date | null;
  agentName: string;
}

/**
 * The evidence, as a buyer may see it.
 *
 * ⚠️ **No `systemPrompt` member.** The type is the second guarantee behind the
 * query that produced it: even if the select list grew the column back, nothing
 * downstream would have anywhere to put it.
 *
 * ⚠️ **`runSteps` is `unknown[]`, not `ExecutionStep[]`, and that is the point
 * on this side.** The jsonb is unvalidated *and* holds `reasoning`, which a
 * buyer may not see. Typing it as the entity would put a `reasoning` property in
 * scope for anything holding this row, one autocomplete away from a response.
 * `toBuyerCaseFileSteps` takes `unknown` for the same reason and re-reads four
 * fields by name.
 *
 * The `run*` columns are `null` for an order that has not run. That is content,
 * not an error — an absent output is how non-delivery is proven.
 */
export interface CaseFileRow {
  input: Record<string, unknown>;
  acceptanceCriteria: string;
  capabilities: string[];
  exclusions: string[];
  runId: string | null;
  runOutput: Record<string, unknown> | null;
  runError: string | null;
  runDurationMs: number | null;
  runSteps: unknown[] | null;
}

/**
 * The same evidence, as its seller may see it: one member wider, because the
 * prompt is theirs. The steps are the same raw jsonb both parties' queries now
 * fetch; what makes the seller's copy unredacted is that `getForSeller` also
 * emits `rawSteps` from it — a reasoning turn quoting their own instructions is
 * quoting them to themselves.
 */
export interface SellerCaseFileRow extends CaseFileRow {
  systemPrompt: string;
}
