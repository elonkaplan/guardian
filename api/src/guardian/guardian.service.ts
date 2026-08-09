import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import type { Hex } from 'viem';

import { ChainOutcomeUnknownError } from '../chain/errors';
import { EscrowGuardianService } from '../chain/escrow-guardian.service';
import type { AppConfig } from '../config/env.schema';
import { Auditor } from './auditor';
import { assembleCaseFile } from './case-file-assembler';
import { GUARDIAN_MAX_AUDIT_ATTEMPTS } from './guardian.constants';
import { AuditFailedError } from './guardian.errors';
import { GuardianRepository } from './guardian.repository';
import { refundMinorFor } from './refund';
import { verdictHash } from './verdict-hash';
import { validateVerdict } from './verdict-validation';

/**
 * The audit pipeline, and the settlement retry.
 *
 * ## ⚠️ The transaction shape is MANDATED, not chosen
 *
 * `docs/CONTEXT.md` invariant #8: *"The verdict is persisted before the chain
 * call, and re-auditing an order that already has one is refused. That is what
 * makes the demo replayable."*
 *
 * So this file uses **`purchase.service.ts`'s shape** — commit, then call the
 * chain — and deliberately **not** `settlement.service.ts`'s, which opens a
 * transaction, calls the chain inside it, and rolls back if the chain disagrees.
 *
 * That file explains exactly when its own shape is right: *"A rollback loses
 * nothing but the attempt."* **That is false here, and it is the whole point.**
 * Rolling back a verdict on a chain failure destroys a ruling a model produced
 * non-deterministically and that cannot be reproduced — `temperature` does not
 * exist on Opus 5, so a re-audit is a *different* audit. The stored verdict is
 * the only copy of what was decided.
 *
 * ```
 *   Txn A: insert verdict + disputed → adjudicated     COMMIT
 *          ↓
 *          resolve(dealId, tier, verdictHash)          (outside any transaction)
 *          ↓
 *   Txn B: onchain_tx_hash + adjudicated → settled     COMMIT
 * ```
 *
 * A failure at either of the last two steps leaves a committed, readable verdict
 * on an `adjudicated` order — which {@link settleNext} picks up from the stored
 * row, never from the auditor (FR-024).
 *
 * ## Nothing here writes a ledger entry
 *
 * Settlement is an on-chain fact. The contract credits `balances[buyer]` and
 * `balances[seller]` at the users' **own** addresses, where the platform cannot
 * recapture the money (invariant #5) — which is the property that lets either
 * party exit without us. `LedgerKind` deliberately has no `settlement` member
 * and this feature does not add one.
 */
@Injectable()
export class GuardianService {
  private readonly logger = new Logger(GuardianService.name);
  private readonly auditTimeoutMs: number;

  constructor(
    private readonly dataSource: DataSource,
    private readonly repository: GuardianRepository,
    private readonly auditor: Auditor,
    private readonly escrow: EscrowGuardianService,
    config: ConfigService<AppConfig, true>,
  ) {
    this.auditTimeoutMs = config.get('GUARDIAN_AUDIT_TIMEOUT_MS', {
      infer: true,
    });
  }

  /**
   * Audit one disputed order, if there is one. Returns `true` if work was done.
   *
   * ⚠️ **This method does not throw for a failed audit.** A refusal, a
   * truncation, an untraceable citation, a leaked prompt, a timeout — all of
   * them are legitimate outcomes that produce no ruling, and all of them are
   * caught here and turned into exactly one write: an incremented attempt
   * counter, and a `audit_failed_at` stamp once the bound is reached. The poller
   * must keep ticking afterwards (SC-012).
   */
  async auditNext(): Promise<boolean> {
    const row = await this.repository.findAuditPending();
    if (row === null) return false;

    const caseFile = assembleCaseFile(row);

    try {
      const outcome = await this.auditor.audit({
        orderId: row.orderId,
        caseFile,
        timeoutMs: this.auditTimeoutMs,
      });

      // ⚠️ Every gate runs BEFORE anything is written. A ruling that fails one
      // is never repaired, never partially stored, and never edited — the stored
      // verdict must be the ruling that was made, because it is replayed and the
      // fingerprint commits to it.
      validateVerdict(row.orderId, outcome, caseFile);

      const refundMinor = refundMinorFor(outcome.tier, row.priceMinor);
      const hash = verdictHash({
        orderId: row.orderId,
        tier: outcome.tier,
        refundMinor,
        reasoning: outcome.reasoning,
        citations: outcome.citations,
        model: outcome.model,
      });

      // ---- Transaction A: the invariant #8 write --------------------------
      await this.dataSource.transaction(async (manager) => {
        await this.repository.insertVerdictAndAdjudicate(manager, {
          orderId: row.orderId,
          tier: outcome.tier,
          refundMinor,
          reasoning: outcome.reasoning,
          citations: outcome.citations,
          verdictHash: hash,
          model: outcome.model,
        });
      });

      this.logger.log(
        `order ${row.orderId} adjudicated tier=${outcome.tier} ` +
          `citations=${outcome.citations.length} duration_ms=${outcome.durationMs}`,
      );

      // ---- The chain call, outside any transaction ------------------------
      await this.settle(row.orderId, outcome.tier, hash, row.onchainDealId);
      return true;
    } catch (err: unknown) {
      if (err instanceof AuditFailedError) {
        await this.recordAuditFailure(row.orderId, err);
        return true;
      }

      if (isUniqueViolation(err)) {
        // Another process ruled between our SELECT and our INSERT. The UNIQUE is
        // the guarantee (research R2); reaching it means a model call was
        // already wasted, and the correct response is to touch nothing.
        this.logger.warn(
          `order ${row.orderId} was adjudicated by another worker; abandoning`,
        );
        return true;
      }

      // A settlement failure after the verdict committed. The ruling survives,
      // the order rests at `adjudicated`, and `settleNext` retries it.
      this.logger.error(
        `order ${row.orderId} ruled but not settled: ${errorLabel(err)}`,
      );
      return true;
    }
  }

  /**
   * Settle one adjudicated order from its **stored** ruling, if there is one.
   *
   * ⚠️ **The auditor is not reachable from this path.** Its input is a row
   * (`findSettlePending`), which is what makes FR-024 — *"a retried settlement
   * MUST use the stored ruling and MUST NOT consult the auditor again"* —
   * structural rather than a rule someone has to remember.
   */
  async settleNext(): Promise<boolean> {
    const row = await this.repository.findSettlePending();
    if (row === null) return false;

    try {
      await this.settle(
        row.orderId,
        row.tier,
        row.verdictHash,
        row.onchainDealId,
      );
    } catch (err: unknown) {
      this.logger.error(
        `retrying settlement for order ${row.orderId} failed: ${errorLabel(err)}`,
      );
    }
    return true;
  }

  /**
   * `resolve` on-chain, then transaction B.
   *
   * A revert here is safe and informative: the **contract**, not our database, is
   * the authority on whether the deal is already `Settled`. An unknown outcome
   * is deliberately *not* rolled back — see the class header.
   */
  private async settle(
    orderId: string,
    tier: Parameters<EscrowGuardianService['resolve']>[1],
    hash: Buffer,
    dealId: number,
  ): Promise<void> {
    try {
      const result = await this.escrow.resolve(
        BigInt(dealId),
        tier,
        `0x${hash.toString('hex')}` as Hex,
      );

      await this.dataSource.transaction(async (manager) => {
        await this.repository.recordSettlement(manager, orderId, result.hash);
      });

      this.logger.log(
        `order ${orderId} settled tier=${tier} tx=${result.hash}`,
      );
    } catch (err: unknown) {
      if (err instanceof ChainOutcomeUnknownError) {
        // The ruling stays committed and the order stays `adjudicated`, so the
        // settle-pending pass retries. Rolling anything back here would be the
        // one action that loses a non-reproducible verdict.
        this.logger.error(
          `resolve outcome UNKNOWN for order ${orderId}; verdict KEPT and the ` +
            `order left 'adjudicated' so the settle pass retries. tx=${err.hash}`,
        );
      }
      throw err;
    }
  }

  /**
   * One failed audit: bump the counter, and stamp the terminal marker if that
   * was the last attempt (FR-043, FR-044).
   *
   * ⚠️ **No verdict row is written here, ever** — not a placeholder, not a
   * marker. The absence of a verdict row is what marks a dispute undecided, and
   * a placeholder would consume the one ruling an order is ever allowed
   * (`verdicts.order_id UNIQUE`) and permanently block the real one.
   *
   * ⚠️ **No fallback ruling either.** Settling at the quarter tier would free
   * the money and match `docs/product-workflow.md` §7.4, and it would put a row
   * into `verdicts` that Guardian did not author (FR-041, SC-013).
   */
  private async recordAuditFailure(
    orderId: string,
    err: AuditFailedError,
  ): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const attempts = await this.repository.incrementAuditAttempts(
        manager,
        orderId,
      );

      if (attempts >= GUARDIAN_MAX_AUDIT_ATTEMPTS) {
        await this.repository.markAuditFailed(manager, orderId);
        this.logger.error(
          `order ${orderId} audit FAILED permanently after ${attempts} attempts ` +
            `(last reason=${err.reason}); reported to both parties as AUDIT_FAILED`,
        );
      } else {
        this.logger.warn(
          `order ${orderId} audit failed reason=${err.reason} ` +
            `attempt=${attempts}/${GUARDIAN_MAX_AUDIT_ATTEMPTS}; will retry`,
        );
      }
    });
  }
}

/** Postgres `unique_violation` — the `verdicts.order_id` backstop firing. */
function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { code?: string }).code === '23505'
  );
}

/**
 * A log-safe label for an unknown error.
 *
 * ⚠️ Deliberately the class name only. `err.message` on a chain or SDK error can
 * echo back request fragments, and this module's requests contain the seller's
 * `system_prompt` — a log line goes around every serialiser this codebase has.
 */
function errorLabel(err: unknown): string {
  return err instanceof Error ? err.name : typeof err;
}
