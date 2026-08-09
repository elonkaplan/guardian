import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';

import { AgentVersion } from '../entities/agent-version.entity';
import { OrderState } from '../entities/enums';
import { Order } from '../entities/order.entity';
import { Run } from '../entities/run.entity';
import type { ExecutionStep } from '../entities/execution-step';

/** Postgres `unique_violation`. The one driver code this module branches on. */
const PG_UNIQUE_VIOLATION = '23505';

/** What a successful claim hands back — everything the run needs, in one row. */
export interface ClaimedOrder {
  orderId: string;
  agentVersionId: string;
  /** Never null: the claim predicate excludes orders without one. */
  onchainDealId: number;
  input: Record<string, unknown>;
}

/**
 * The pinned definition, as loaded for execution.
 *
 * ⚠️ `systemPrompt` is in this shape because the run cannot happen without it.
 * It must not be logged, echoed into an error message, or copied anywhere a
 * serialiser does not guard.
 */
export interface PinnedDefinition {
  systemPrompt: string;
  model: string;
  outputSchema: Record<string, unknown>;
  timeoutSeconds: number;
  /** Hex, no `0x`. Half the demo-script key (research R4). */
  definitionHash: string;
}

/** Everything written when a run concludes, in one update. */
export interface RunClosure {
  steps: ExecutionStep[];
  output: Record<string, unknown> | null;
  error: string | null;
  outputValid: boolean | null;
  finishedAt: Date;
  durationMs: number;
}

/**
 * Everything this module reads and writes: `runs`, the two `orders` columns it
 * may move, and the pinned definition it runs.
 *
 * ## ⚠️ This is the one query in the codebase that fetches `system_prompt`
 *
 * `order.repository.ts` opens with the opposite rule and the reason for it:
 * every buyer-reachable query names its columns so the seller's prompt never
 * enters the process, because that "is the only layer that also protects a log
 * line, an error message and a stack trace, none of which pass through a
 * serialiser". This module inverts that deliberately — the platform runs the
 * seller's definition, so it must hold the prompt — and pays for it by having
 * **no controller at all**. Nothing here is reachable over HTTP, so the column
 * cannot be serialised to anyone; the discipline that replaces the query-level
 * guard is that nothing in `execution/` logs it (research R8, R7).
 *
 * ## Ownership
 *
 * `docs/CONTEXT.md` §3's module map assigns `agent_versions` to `catalog/` and
 * `orders` to `orders/`. That ownership is about **writes and serialisation**,
 * not reads: it is what makes `agent-serialiser.ts` the single disclosure
 * boundary. `OrderRepository` already reads `agent_versions` and `agents`
 * directly for the same reason. Asking `CatalogModule` to export a
 * hand-out-the-system-prompt method would be a worse boundary than a private
 * query in a module with no routes.
 */
@Injectable()
export class ExecutionRepository {
  constructor(
    @InjectRepository(Run)
    private readonly runs: Repository<Run>,
  ) {}

  // -------------------------------------------------------------------
  // Claim
  // -------------------------------------------------------------------

  /**
   * Take ownership of the next order that is ready to run, or return `null`.
   *
   * ## ⚠️ One statement, because "exactly one worker wins" must be the
   * database's guarantee and not the loop's timing
   *
   * The inner `SELECT … FOR UPDATE SKIP LOCKED` picks one candidate row and
   * locks it; the outer `UPDATE` moves it out of `purchased` in the same
   * statement. A second worker arriving mid-flight skips the locked row and
   * takes the next one rather than blocking on it — which is the behaviour you
   * want the day the poller's concurrency limit is raised above one.
   *
   * A `SELECT` followed by an `UPDATE` would give the same guarantee only while
   * wrapped in a transaction held open across both, and would read as if the
   * safety came from the ordering rather than from the lock.
   *
   * ## The predicate is two preconditions, not one
   *
   * `state = 'purchased'` is FR-002. `onchain_deal_id IS NOT NULL` is FR-003,
   * and it excludes two different orders for two different reasons:
   *
   * | Order | Why it must never run |
   * | --- | --- |
   * | `openDeal` was refused → `failed`, NULL id | nothing was escrowed and the buyer was already compensated |
   * | `openDeal` outcome unknown → `purchased`, NULL id | the money **may** be escrowed; that is the confirmation-retry job's call, not ours |
   *
   * The second is the one that matters: running work against an unconfirmed
   * purchase spends a model call on a trade that may not exist.
   *
   * ## ⚠️ `onchain_deal_id` is a bigint on a raw query
   *
   * The `bigintTransformer` on the entity does not apply here — a raw query
   * returns the driver's value, and `pg` hands back `bigint` as a **string**.
   * It is converted once, here, so no caller ever holds `"7"` where it expects
   * `7`.
   */
  async claimNext(): Promise<ClaimedOrder | null> {
    // ⚠️ `manager.query()` does NOT return the same shape for every statement.
    // A `SELECT` resolves to the rows array; an `UPDATE … RETURNING` resolves to
    // the tuple `[rows, affectedCount]`. Reading `result[0]` as a row therefore
    // yields the rows *array*, whose `.id` is `undefined` — which fails far
    // downstream, at the `runs` insert, as a not-null violation on `order_id`
    // rather than anywhere near here. The destructure below is the whole fix and
    // the reason this comment exists.
    const [rows] = (await this.runs.manager.query(
      `UPDATE orders SET state = $1
         WHERE id = (
           SELECT id FROM orders
             WHERE state = $2 AND onchain_deal_id IS NOT NULL
             ORDER BY created_at
             LIMIT 1
             FOR UPDATE SKIP LOCKED
         )
       RETURNING id, agent_version_id, onchain_deal_id, input`,
      [OrderState.Running, OrderState.Purchased],
    )) as [
      Array<{
        id: string;
        agent_version_id: string;
        onchain_deal_id: string;
        input: Record<string, unknown>;
      }>,
      number,
    ];

    const row = rows[0];
    if (row === undefined) return null;

    return {
      orderId: row.id,
      agentVersionId: row.agent_version_id,
      onchainDealId: Number(row.onchain_deal_id),
      input: row.input,
    };
  }

  // -------------------------------------------------------------------
  // Load
  // -------------------------------------------------------------------

  /**
   * The definition the order pinned at purchase — **by id**, never by resolving
   * the agent's latest version.
   *
   * That is invariant #6 (`docs/CONTEXT.md`) and it is the whole reason an order
   * stores `agent_version_id` rather than `agent_id`: a dispute is judged
   * against the definition that actually ran, so what runs has to be the
   * definition that was bought. A seller who republishes between purchase and
   * execution has changed nothing about this order.
   *
   * `input_schema` is deliberately not selected. The buyer's input was validated
   * against it at purchase; re-validating here would let an order that has
   * already taken the buyer's money be refused for an input the platform
   * accepted.
   *
   * Returns `null` when the version is missing, which the service turns into a
   * `DefinitionUnusableError` — a run failure recorded like any other, rather
   * than an exception escaping into the poller (FR-007).
   */
  async loadPinnedDefinition(
    agentVersionId: string,
  ): Promise<PinnedDefinition | null> {
    const row = await this.runs.manager
      .createQueryBuilder(AgentVersion, 'v')
      .select([
        'v.system_prompt AS "systemPrompt"',
        'v.model AS "model"',
        'v.output_schema AS "outputSchema"',
        'v.timeout_seconds AS "timeoutSeconds"',
        'v.definition_hash AS "definitionHash"',
      ])
      .where('v.id = :agentVersionId', { agentVersionId })
      .getRawOne<{
        systemPrompt: string;
        model: string;
        outputSchema: Record<string, unknown>;
        timeoutSeconds: number;
        definitionHash: Buffer | string;
      }>();

    if (row === undefined) return null;

    return {
      systemPrompt: row.systemPrompt,
      model: row.model,
      outputSchema: row.outputSchema,
      timeoutSeconds: row.timeoutSeconds,
      // `bytea` arrives as a Buffer. Hex without `0x`, so the demo-script key is
      // one stable spelling on both sides of the seam (research R4).
      definitionHash: Buffer.isBuffer(row.definitionHash)
        ? row.definitionHash.toString('hex')
        : String(row.definitionHash),
    };
  }

  // -------------------------------------------------------------------
  // The record
  // -------------------------------------------------------------------

  /**
   * Open the run record. Returns the new row's id, or `null` when one already
   * exists for this order.
   *
   * ## ⚠️ Written at claim, not at purchase, and not at the end
   *
   * `order.entity.ts` warns against writing this row **at purchase time**,
   * because `runs.output IS NULL` is the non-delivery evidence (invariant #7)
   * and a row that exists before execution starts makes every pending order look
   * like a crashed one. That warning is about a different moment: this insert
   * happens *after* the transition to `running`, so the states stay
   * distinguishable exactly where the warning cares —
   *
   * | Order state | `runs` row |
   * | --- | --- |
   * | `purchased` | none |
   * | `running` | open — `started_at` set, `finished_at` NULL |
   * | anything later | closed |
   *
   * Writing it only at the end would leave a crashed process with no evidence at
   * all, and nothing for the reaper to read (research R3).
   *
   * ## ⚠️ The unique violation is a backstop, not the mechanism
   *
   * `runs.order_id` is UNIQUE, which is what makes "one execution per purchase"
   * structural rather than remembered. `claimNext` is what should make a second
   * attempt impossible; if this ever returns `null` in production, two runs were
   * already in flight and one of them is about to have wasted a real model call.
   * The caller must return without touching the order — never overwrite, never
   * delete, never retry.
   */
  async openRun(
    orderId: string,
    input: Record<string, unknown>,
  ): Promise<string | null> {
    try {
      const row = this.runs.create({
        orderId,
        input,
        steps: [],
        output: null,
        error: null,
        outputValid: null,
      });
      const saved = await this.runs.save(row);
      return saved.id;
    } catch (err) {
      if (isUniqueViolation(err)) return null;
      throw err;
    }
  }

  // -------------------------------------------------------------------
  // The two exits
  // -------------------------------------------------------------------

  /**
   * Move a claimed order to `delivered`, once the escrow contract has confirmed
   * the delivery.
   *
   * ⚠️ **Conditional on `state = 'running'`, deliberately.** Between the claim
   * and this call the reaper may have decided the order was stuck and moved it
   * to `failed` (API-10). Writing `delivered` unconditionally would resurrect an
   * order the reaper has already accounted for, and the two would disagree about
   * what happened. Losing the race is the correct outcome: the run record still
   * holds the output, and the reaper's `failed` is a state a buyer can complain
   * about.
   *
   * Returns whether the transition was applied, so the caller can say so in the
   * log rather than assume it.
   */
  async markDelivered(orderId: string): Promise<boolean> {
    const result = await this.runs.manager
      .getRepository(Order)
      .update(
        { id: orderId, state: OrderState.Running },
        // ⚠️ `deliveredAt` is written HERE and nowhere else. Until API-10 this
        // column was never written at all, and two things were silently broken
        // by its absence — both of which read as "the code is fine" because the
        // column is nullable and NULL comparisons simply produce no rows:
        //
        //  1. **The sweeper could never fire.** Its predicate is
        //     `delivered_at + review_window <= now()`, which is NULL for every
        //     row when the column is NULL, so no order was ever selected and no
        //     seller was ever paid automatically. That is the whole of Act 1's
        //     ending (`jobs/sweeper.job.ts`).
        //  2. **The complaint window never closed.** `settlement.service.ts`'s
        //     `assertWindowOpen` returns early on a NULL `delivered_at`, which is
        //     correct and deliberate for a `failed` order — nothing was
        //     delivered, so no window ever opened, and Act 3 must not be refused
        //     by one. With the column never written, *every* order took that
        //     branch and a buyer could complain indefinitely. The money stayed
        //     safe only because the on-chain `dispute` reverts `"window closed"`
        //     on its own — the API said yes and the contract said no.
        //
        // `markFailed` deliberately does NOT set it, which is what keeps that
        // early return meaning what it says.
        //
        // ⚠️ This is OUR receipt time, not the contract's `block.timestamp`.
        // The two differ by the time it takes a receipt to come back, and the
        // direction is the safe one: ours is *later*, so the sweeper asks to
        // release slightly after the chain would already permit it, rather than
        // before. The reverse — deriving it from block time — would need an extra
        // `eth_call` on the delivery hot path to buy a revert we are already
        // designed to tolerate (`specs/010-cron-jobs/research.md` R6).
        { state: OrderState.Delivered, deliveredAt: new Date() },
      );

    return (result.affected ?? 0) > 0;
  }

  /**
   * Move a claimed order to `failed` — the agent produced nothing.
   *
   * ⚠️ **This `failed` is not the same `failed` `orders/order.repository.ts`
   * writes.** That one means `openDeal` was refused: nothing was escrowed,
   * `onchain_deal_id` is NULL, and the buyer has already been compensated. This
   * one means the deal is open, the money **is** escrowed, and the agent
   * returned nothing — `onchain_deal_id` is set. `escrow-exposure.repository.ts`
   * distinguishes them with `NOT (state = 'failed' AND onchain_deal_id IS NULL)`
   * and both readings depend on this method never clearing the deal id.
   *
   * Conditional on `state = 'running'` for the same reason as `markDelivered`.
   */
  async markFailed(orderId: string): Promise<boolean> {
    const result = await this.runs.manager
      .getRepository(Order)
      .update(
        { id: orderId, state: OrderState.Running },
        { state: OrderState.Failed },
      );

    return (result.affected ?? 0) > 0;
  }

  /**
   * Close the run record — the single update that ends a run, whichever way it
   * ended.
   *
   * ## ⚠️ `output` is NULL or a real output. Never `{}`, never a string
   *
   * The guard below is not defensive tidiness. `runs.output IS NULL` is how
   * non-delivery is proven to Guardian (invariant #7), and it is the entire
   * basis of the demo's closing act. An empty object written "so the column is
   * not null" would convert a provable non-delivery into a delivery of nothing
   * — the buyer's strongest case, silently downgraded to an argument.
   */
  async closeRun(runId: string, closure: RunClosure): Promise<void> {
    if (closure.output !== null && !isNonEmptyObject(closure.output)) {
      throw new Error(
        `refusing to write a stand-in into runs.output for run ${runId} — ` +
          'NULL is the non-delivery evidence (docs/CONTEXT.md invariant #7)',
      );
    }

    // The cast is on `QueryDeepPartialEntity`, not on the values. TypeORM maps
    // every object-typed property of the entity into a deep-partial, which an
    // index-signature record (`Record<string, unknown>`) does not satisfy — but
    // `output` is a jsonb column stored whole, so there is no partial to map.
    // Casting the patch says that once, rather than weakening `RunClosure`.
    await this.runs.update({ id: runId }, {
      steps: closure.steps,
      output: closure.output,
      error: closure.error,
      outputValid: closure.outputValid,
      finishedAt: closure.finishedAt,
      durationMs: closure.durationMs,
    } as QueryDeepPartialEntity<Run>);
  }
}

/** `pg` surfaces the SQLSTATE on `code`; TypeORM passes the driver error through. */
function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: unknown }).code === PG_UNIQUE_VIOLATION
  );
}

/**
 * An output must be a real object with at least one key. An empty object is the
 * stand-in `closeRun` exists to refuse; a delivered-but-empty *answer* is a
 * populated object whose fields happen to be empty, which is a delivery and
 * passes.
 */
function isNonEmptyObject(value: Record<string, unknown>): boolean {
  return Object.keys(value).length > 0;
}
