import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, type EntityManager } from 'typeorm';

import { Agent } from '../entities/agent.entity';
import { AgentVersion } from '../entities/agent-version.entity';
import { Complaint } from '../entities/complaint.entity';
import type { ExecutionStep } from '../entities/execution-step';
import { OrderState, VerdictTier } from '../entities/enums';
import { Order } from '../entities/order.entity';
import { Run } from '../entities/run.entity';
import { Verdict } from '../entities/verdict.entity';
import { GUARDIAN_MAX_AUDIT_ATTEMPTS } from './guardian.constants';

/**
 * Everything this module reads and writes.
 *
 * ## ⚠️ This is the SECOND query in the codebase that selects `system_prompt`
 *
 * `order.repository.ts` opens with the opposite rule and the reason for it:
 * every buyer-reachable query names its columns so the seller's prompt never
 * enters the process, because that *"is the only layer that also protects a log
 * line, an error message and a stack trace, none of which pass through a
 * serialiser"*. `execution.repository.ts` inverts that deliberately, because the
 * run cannot happen without the prompt.
 *
 * This module inverts it for a different reason. `docs/agent-definition.md` §4
 * lists Guardian as one of the three parties that sees the prompt — *"needed for
 * intent-vs-effort judgment"* — because without it the auditor cannot tell
 * *"tried hard and the task was impossible"* from *"returned a stub without
 * trying"*, and `docs/product-workflow.md` §6.3 says the same of the raw
 * `runs.steps`.
 *
 * **The obligation that comes with it**: this module has a controller, but
 * **no route is downstream of these queries**. The audit runs in a poller; the
 * one HTTP route (`GET /orders/:id/verdict`) reads `verdicts` through a
 * different path and never touches a case file. Nothing built from
 * `findAuditPending`'s row is ever serialised into a response, logged, or
 * interpolated into an error message — `guardian.errors.ts` takes identifying
 * fields as typed properties precisely so that stays true.
 *
 * ## Guardian reads `runs`; it does not import `execution`
 *
 * `docs/CONTEXT.md` §3: *"Keep `execution` and `guardian` from importing each
 * other. Execution produces evidence; Guardian consumes it."* Reading a table
 * another module writes is not the import that rule forbids — and owning the
 * query here rather than borrowing `ExecutionRepository`'s is what keeps the
 * direction one-way by construction.
 *
 * ## Two claim predicates, not one
 *
 * `orders.state` is the queue (invariant #9), and this module drains it twice
 * per tick for two different jobs (research R1). The split is not tidiness: it
 * is what makes *"a retried settlement MUST NOT consult the auditor again"*
 * (FR-024) structural rather than remembered. `findSettlePending` starts from a
 * stored row and has no access to an auditor at all.
 */
@Injectable()
export class GuardianRepository {
  constructor(
    @InjectRepository(Verdict)
    private readonly verdicts: Repository<Verdict>,
  ) {}

  /**
   * The next disputed order that still needs a ruling, or `null`.
   *
   * ## The predicate is four preconditions
   *
   * | Clause | Why |
   * | --- | --- |
   * | `state = 'disputed'` | FR-027. Only a disputed order has a complaint to answer |
   * | `onchain_deal_id IS NOT NULL` | There is nothing to settle otherwise, and a ruling that can never move money is worse than none |
   * | `audit_attempts < 3` | FR-043. Past the bound the order is reported as failed, not retried (research R14) |
   * | `NOT EXISTS (verdict)` | FR-025 at *selection* time, so a decided order never reaches the model |
   *
   * ⚠️ **The `NOT EXISTS` is an optimisation, not the guarantee.** The guarantee
   * is `verdicts.order_id UNIQUE`: two processes can both pass this predicate,
   * and the loser's insert fails. That costs a wasted model call and never a
   * second ruling (research R2).
   *
   * ⚠️ **This does NOT claim the row.** Unlike `execution.repository.ts`'s
   * `claimNext`, there is no state move here — `disputed` has no equivalent of
   * `running`, and `adjudicated` must keep meaning *"a verdict row exists"*.
   * In-process, the poller's re-entrancy guard serialises audits.
   */
  async findAuditPending(): Promise<AuditPendingRow | null> {
    const row = await this.verdicts.manager
      .createQueryBuilder(Order, 'o')
      .innerJoin(AgentVersion, 'v', 'v.id = o.agent_version_id')
      .leftJoin(Run, 'r', 'r.order_id = o.id')
      .leftJoin(Complaint, 'c', 'c.order_id = o.id')
      .select([
        'o.id AS "orderId"',
        'o.price_minor AS "priceMinor"',
        'o.input AS "input"',
        'o.acceptance_criteria AS "acceptanceCriteria"',
        'o.onchain_deal_id AS "onchainDealId"',
        'o.audit_attempts AS "auditAttempts"',
        'v.capabilities AS "capabilities"',
        'v.exclusions AS "exclusions"',
        // ⚠️ The one column this module selects that no buyer-facing query may.
        // See the class header for why it is here and what that obliges.
        'v.system_prompt AS "systemPrompt"',
        'c.reason AS "complaint"',
        // ⚠️ Raw steps, reasoning included. NOT the buyer's redacted view.
        'r.steps AS "steps"',
        'r.output AS "output"',
        'r.error AS "runError"',
        'r.started_at AS "startedAt"',
        'r.finished_at AS "finishedAt"',
        'r.duration_ms AS "durationMs"',
        // Distinguishes "a run exists and produced nothing" from "no run at
        // all". Both are non-delivery; only one has a trace.
        'r.id IS NOT NULL AS "hasRun"',
      ])
      .where('o.state = :state', { state: OrderState.Disputed })
      .andWhere('o.onchain_deal_id IS NOT NULL')
      .andWhere('o.audit_attempts < :max', { max: GUARDIAN_MAX_AUDIT_ATTEMPTS })
      .andWhere(
        'NOT EXISTS (SELECT 1 FROM verdicts vd WHERE vd.order_id = o.id)',
      )
      .orderBy('o.disputed_at', 'ASC')
      .limit(1)
      .getRawOne<AuditPendingRaw>();

    if (row === undefined) return null;

    return {
      orderId: row.orderId,
      priceMinor: Number(row.priceMinor),
      input: row.input,
      acceptanceCriteria: row.acceptanceCriteria,
      onchainDealId: Number(row.onchainDealId),
      auditAttempts: Number(row.auditAttempts),
      capabilities: row.capabilities ?? [],
      exclusions: row.exclusions ?? [],
      systemPrompt: row.systemPrompt,
      complaint: row.complaint ?? '',
      steps: row.hasRun ? (row.steps ?? []) : [],
      output: row.hasRun ? row.output : null,
      runError: row.runError,
      startedAt: row.startedAt,
      finishedAt: row.finishedAt,
      durationMs: row.durationMs === null ? null : Number(row.durationMs),
      hasRun: row.hasRun,
    };
  }

  /**
   * The next adjudicated order whose `resolve` has not landed, or `null`.
   *
   * ⚠️ **Everything this returns comes from the stored verdict.** That is the
   * whole point: FR-024 says a retried settlement must not consult the auditor
   * again, and a pass whose input is a row cannot. The recovery for a failed
   * chain call is not an error handler — it is a different query with a
   * different input (research R1, R12).
   */
  async findSettlePending(): Promise<SettlePendingRow | null> {
    const row = await this.verdicts
      .createQueryBuilder('vd')
      .innerJoin(Order, 'o', 'o.id = vd.order_id')
      .select([
        'vd.order_id AS "orderId"',
        'vd.tier AS "tier"',
        'vd.verdict_hash AS "verdictHash"',
        'o.onchain_deal_id AS "onchainDealId"',
      ])
      .where('o.state = :state', { state: OrderState.Adjudicated })
      .andWhere('vd.onchain_tx_hash IS NULL')
      .andWhere('o.onchain_deal_id IS NOT NULL')
      .orderBy('vd.created_at', 'ASC')
      .limit(1)
      .getRawOne<SettlePendingRaw>();

    if (row === undefined) return null;

    return {
      orderId: row.orderId,
      tier: row.tier,
      verdictHash: row.verdictHash,
      onchainDealId: Number(row.onchainDealId),
    };
  }

  /**
   * **Transaction A** — the invariant #8 write.
   *
   * Inserts the ruling and moves the order `disputed → adjudicated` in one
   * statement batch. The caller commits this **before** calling the chain, so a
   * failed `resolve` leaves a readable verdict rather than destroying a ruling
   * that cannot be reproduced (`temperature` does not exist on Opus 5).
   *
   * ⚠️ **A unique violation here means another process already ruled.** Let it
   * propagate; the service treats it as "someone else owns this" and touches
   * nothing. Never turn this into an upsert — `verdicts.order_id UNIQUE` *is*
   * the product rule that there are no appeals.
   */
  async insertVerdictAndAdjudicate(
    manager: EntityManager,
    verdict: NewVerdict,
  ): Promise<void> {
    await manager.insert(Verdict, {
      orderId: verdict.orderId,
      tier: verdict.tier,
      refundMinor: verdict.refundMinor,
      reasoning: verdict.reasoning,
      citations: [...verdict.citations],
      verdictHash: verdict.verdictHash,
      model: verdict.model,
      onchainTxHash: null,
    });

    await manager.update(
      Order,
      { id: verdict.orderId },
      { state: OrderState.Adjudicated },
    );
  }

  /**
   * **Transaction B** — the settlement landed.
   *
   * Records the transaction hash and moves `adjudicated → settled`. Separate
   * from transaction A because the chain call sits between them, and separate
   * from a combined write because `onchain_tx_hash IS NULL` is what
   * `findSettlePending` keys on: a hash written before the call would be a hash
   * for a transaction that may never exist, on the row the demo links to as
   * *"the clickable proof."*
   */
  async recordSettlement(
    manager: EntityManager,
    orderId: string,
    txHash: string,
  ): Promise<void> {
    await manager.update(Verdict, { orderId }, { onchainTxHash: txHash });
    await manager.update(
      Order,
      { id: orderId },
      { state: OrderState.Settled, settledAt: new Date() },
    );
  }

  /**
   * One more failed attempt on this order.
   *
   * ⚠️ Increments **only**. It writes no verdict row, no placeholder, and no
   * state move — the absence of a verdict row remains the marker for
   * *"undecided"*, and this column marks only *"and we have tried N times"*.
   */
  async incrementAuditAttempts(
    manager: EntityManager,
    orderId: string,
  ): Promise<number> {
    const rows = (await manager.query(
      `UPDATE orders SET audit_attempts = audit_attempts + 1
         WHERE id = $1
       RETURNING audit_attempts`,
      [orderId],
    )) as [Array<{ audit_attempts: number }>, number];

    // ⚠️ `manager.query` returns the bare rows for a SELECT but the tuple
    // `[rows, affectedCount]` for an `UPDATE … RETURNING`. Reading it as an
    // array is the defect the execution engine's verification run caught: a cast
    // asserted the wrong shape, `tsc` could not see it, and thirteen orders moved
    // into a state with no record before the failure surfaced far downstream.
    const [returned] = rows;
    const attempts = returned[0]?.audit_attempts;
    if (attempts === undefined) {
      throw new Error(
        `incrementAuditAttempts: order ${orderId} vanished mid-audit`,
      );
    }
    return Number(attempts);
  }

  /**
   * Guardian has given up on this order (FR-044).
   *
   * ⚠️ **No state move.** The order stays `disputed`, because the dispute is
   * still real and still unresolved — what failed is our ability to rule on it.
   * This stamp is what `GET /orders/:id/verdict` reads to answer `409
   * AUDIT_FAILED` instead of the in-progress `404`, so that the buyer's screen
   * stops saying a ruling is being prepared.
   */
  async markAuditFailed(
    manager: EntityManager,
    orderId: string,
  ): Promise<void> {
    await manager.update(
      Order,
      { id: orderId },
      { auditFailedAt: new Date() },
    );
  }
}

/** Raw driver shape for {@link GuardianRepository.findAuditPending}. */
interface AuditPendingRaw {
  orderId: string;
  priceMinor: string;
  input: Record<string, unknown>;
  acceptanceCriteria: string;
  onchainDealId: string;
  auditAttempts: string;
  capabilities: string[] | null;
  exclusions: string[] | null;
  systemPrompt: string;
  complaint: string | null;
  steps: ExecutionStep[] | null;
  output: Record<string, unknown> | null;
  runError: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: string | null;
  hasRun: boolean;
}

/**
 * One disputed order, with everything the case file needs, in one row.
 *
 * ⚠️ Carries `systemPrompt` and raw `steps`. Nothing built from this may reach a
 * response, a log line, or an error message.
 */
export interface AuditPendingRow {
  orderId: string;
  priceMinor: number;
  input: Record<string, unknown>;
  acceptanceCriteria: string;
  onchainDealId: number;
  auditAttempts: number;
  capabilities: string[];
  exclusions: string[];
  systemPrompt: string;
  complaint: string;
  steps: ExecutionStep[];
  output: Record<string, unknown> | null;
  runError: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  /** `false` when no `runs` row exists at all — a complete case file either way. */
  hasRun: boolean;
}

/** Raw driver shape for {@link GuardianRepository.findSettlePending}. */
interface SettlePendingRaw {
  orderId: string;
  tier: VerdictTier;
  verdictHash: Buffer;
  onchainDealId: string;
}

/** A ruling that exists and has not yet reached the chain. */
export interface SettlePendingRow {
  orderId: string;
  tier: VerdictTier;
  /** The stored bytes. **Never recomputed** — see `verdict-hash.ts`. */
  verdictHash: Buffer;
  onchainDealId: number;
}

/** What {@link GuardianRepository.insertVerdictAndAdjudicate} writes. */
export interface NewVerdict {
  orderId: string;
  tier: VerdictTier;
  refundMinor: number;
  reasoning: string;
  /**
   * The validated citations, **exactly as the model returned them** — same
   * objects, same order. `verdicts.citations` is `jsonb` and the entity types it
   * `unknown[]`; the shape guarantee comes from the Zod parse on the way in and
   * from `verdict-response.dto.ts` on the way out. Nothing between those two
   * points may reshape it, because the UI reads `source` / `quote` / `met`
   * literally.
   */
  citations: ReadonlyArray<{ source: string; quote: string; met: boolean }>;
  verdictHash: Buffer;
  model: string;
}
