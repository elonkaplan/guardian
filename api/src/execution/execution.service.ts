import { Injectable, Logger } from '@nestjs/common';

import { validateAgainstSchema } from '../catalog/schema-validation';
import { ChainOutcomeUnknownError } from '../chain/errors';
import { EscrowOperatorService } from '../chain/escrow-operator.service';
import { AgentRunner, type AgentRunOutcome } from './agent-runner';
import {
  AgentRunFailedError,
  AgentTimeoutError,
  DefinitionUnusableError,
  ExecutionError,
} from './execution.errors';
import {
  ExecutionRepository,
  type ClaimedOrder,
  type PinnedDefinition,
} from './execution.repository';
import { failureTrace, successTrace } from './run-trace';

/**
 * The prefix `catalog/schema-validation.ts` puts on a *compile* failure, as
 * opposed to a validation mismatch. Kept next to its only use so the coupling is
 * visible; if that message is ever reworded, this is the line that breaks and
 * the comment in `checkConformance` explains what breaks with it.
 */
const SCHEMA_COMPILE_FAILURE = "the agent's stored input schema could not be compiled";

/**
 * Which platform-authored label the terminal `error` step carries. A closed
 * mapping rather than a string on the error class, so a fourth error type added
 * later is a compile error here rather than a step that renders with no label.
 */
function failureKind(
  error: ExecutionError,
): 'model_error' | 'timeout' | 'definition_unusable' {
  if (error instanceof AgentTimeoutError) return 'timeout';
  if (error instanceof DefinitionUnusableError) return 'definition_unusable';
  return 'model_error';
}

/**
 * The pipeline. One order in, one permanent run record out.
 *
 * ```text
 * claim ──▶ load ──▶ open ──▶ run ──┬─ resolved ─▶ close(output) ─▶ …
 *                                   └─ threw ────▶ close(error)  ─▶ …
 * ```
 *
 * ## ⚠️ The order of the first three steps is the whole design
 *
 * **Claim before anything else** so the order leaves `purchased` in one
 * indivisible move and a second worker cannot pick it up (`claimNext`).
 *
 * **Open the record before running**, so a process that dies mid-run leaves an
 * open row — a start with no finish — rather than nothing at all. That row is
 * what the reaper reads to decide an order is stuck, and it is the difference
 * between "we can see it was attempted" and silence (research R3).
 *
 * **Close the record before telling anyone anything.** A lost chain response
 * must leave complete evidence and a missing announcement, never an announced
 * delivery with no record of what was delivered.
 *
 * ## ⚠️ No retry, anywhere, ever
 *
 * `runs.order_id` is UNIQUE. If `openRun` reports a row already exists, another
 * worker owns this order: return immediately, touch nothing, and **do not call
 * the model**. Overwriting a run record would destroy the only evidence of what
 * actually happened — and when that record has `output IS NULL`, it is the
 * buyer's strongest case that is being destroyed (`docs/CONTEXT.md` invariant
 * #7).
 *
 * ## ⚠️ Nothing here logs the prompt
 *
 * The pinned `system_prompt` and the model's own prose both pass through this
 * class. `order.repository.ts` explains why the query layer is the only thing
 * that protects a log line, an error message and a stack trace — none of which
 * pass through a serialiser. This module cannot use that defence, because it
 * has to hold the prompt to run it. The replacement discipline is here: log
 * lines carry ids, the model, durations and failure kinds. Never content.
 */
@Injectable()
export class ExecutionService {
  private readonly logger = new Logger(ExecutionService.name);

  constructor(
    private readonly repository: ExecutionRepository,
    private readonly runner: AgentRunner,
    private readonly escrow: EscrowOperatorService,
  ) {}

  /**
   * Claim and execute one order, or discover there is nothing to do.
   *
   * Returns `true` when an order was claimed, so the poller can decide whether
   * to look again immediately or wait for the next tick.
   *
   * ⚠️ **This method does not throw for a failed run.** A crash, a timeout or an
   * unusable definition is an *outcome*, recorded as evidence and reflected in
   * the order's state. Only a defect — the database being unreachable, a bug —
   * escapes, and the poller treats that as its own problem.
   */
  async runNext(): Promise<boolean> {
    const claimed = await this.repository.claimNext();
    if (claimed === null) return false;

    this.logger.log(`order=${claimed.orderId} claimed deal=${claimed.onchainDealId}`);

    await this.execute(claimed);
    return true;
  }

  private async execute(claimed: ClaimedOrder): Promise<void> {
    const runId = await this.repository.openRun(claimed.orderId, claimed.input);

    // The UNIQUE backstop fired: another worker already owns this order. Return
    // without touching it and without spending a model call. If this is ever
    // reached in production, two runs were already in flight — see `openRun`.
    if (runId === null) {
      this.logger.warn(
        `order=${claimed.orderId} already has a run record; abandoning this attempt`,
      );
      return;
    }

    const startedAt = new Date();

    let definition: PinnedDefinition | null;
    try {
      definition = await this.repository.loadPinnedDefinition(claimed.agentVersionId);
    } catch (err) {
      await this.onFailure(
        claimed,
        runId,
        startedAt,
        new DefinitionUnusableError(
          `pinned definition for order ${claimed.orderId} could not be loaded`,
          claimed.orderId,
          'agentVersionId',
          err,
        ),
        null,
      );
      return;
    }

    if (definition === null) {
      await this.onFailure(
        claimed,
        runId,
        startedAt,
        new DefinitionUnusableError(
          `order ${claimed.orderId} pins agent version ${claimed.agentVersionId}, which no longer exists`,
          claimed.orderId,
          'agentVersionId',
        ),
        null,
      );
      return;
    }

    let outcome: AgentRunOutcome;
    try {
      outcome = await this.runner.run({
        orderId: claimed.orderId,
        systemPrompt: definition.systemPrompt,
        model: definition.model,
        outputSchema: definition.outputSchema,
        input: claimed.input,
        timeoutMs: definition.timeoutSeconds * 1000,
        definitionHash: definition.definitionHash,
      });
    } catch (err) {
      await this.onFailure(
        claimed,
        runId,
        startedAt,
        this.asExecutionError(err, claimed),
        definition.model,
      );
      return;
    }

    await this.onSuccess(claimed, runId, definition, outcome, startedAt);
  }

  /**
   * The agent returned something. Close the record with it, then announce the
   * delivery.
   *
   * The record is written first and that ordering is fixed — but note it is
   * **not** invariant #1's money rule. Nothing moves here: `markDelivered`
   * starts the buyer's review clock, it does not transfer a cent. The reason for
   * this order is narrower and more practical (research R6).
   */
  private async onSuccess(
    claimed: ClaimedOrder,
    runId: string,
    definition: PinnedDefinition,
    outcome: AgentRunOutcome,
    startedAt: Date,
  ): Promise<void> {
    const outputStartedAt = new Date();
    const outputValid = this.checkConformance(
      claimed,
      definition.outputSchema,
      outcome.output,
    );
    const finishedAt = new Date();

    await this.repository.closeRun(runId, {
      steps: successTrace({
        model: definition.model,
        assistantText: outcome.assistantText,
        modelDurationMs: outcome.durationMs,
        modelStartedAt: startedAt,
        outputDurationMs: finishedAt.getTime() - outputStartedAt.getTime(),
        outputStartedAt,
      }),
      output: outcome.output,
      error: null,
      outputValid,
      finishedAt,
      durationMs: finishedAt.getTime() - startedAt.getTime(),
    });

    this.logger.log(
      `order=${claimed.orderId} run=${runId} closed with output ` +
        `duration_ms=${finishedAt.getTime() - startedAt.getTime()}`,
    );

    await this.announceDelivery(claimed);
  }

  /**
   * Does the output satisfy the contract the seller declared for it?
   *
   * ## ⚠️ A `false` here is still a delivery
   *
   * The output exists, the buyer received it, and the order goes to `delivered`
   * like any other. Conformance is a **fact handed to the auditor**, not a
   * second definition of non-delivery: an output that fails its own declared
   * contract has already failed and Guardian can say so without deliberating
   * (`docs/agent-definition.md` §3). Treating it as non-delivery instead would
   * award a guaranteed full refund to any output with a stray field — a far
   * larger judgment than this check is entitled to make.
   *
   * The output is *requested* in this shape (`output_config.format` constrains
   * the model to it), so `true` is the expected answer. Recording it anyway is
   * what lets an auditor assert conformance rather than assume it.
   *
   * ## ⚠️ A broken checker must not manufacture a non-delivery
   *
   * If `validateAgainstSchema` itself throws — a schema Ajv can compile at
   * listing but not here, a bug — the answer is left unanswered and logged. It
   * must never fall through to `false`, which would assert that the seller's
   * output was wrong, and never to a thrown error, which would convert a
   * completed delivery into a non-delivery (FR-030).
   *
   * Reuses the catalogue's Ajv instance, unchanged. `schema-validation.ts` is
   * already on the 2020-12 dialect **because of this caller** — its header says
   * so — so there is nothing to reconcile between what a seller's schema was
   * validated as at listing and what constrains their agent here.
   */
  private checkConformance(
    claimed: ClaimedOrder,
    outputSchema: Record<string, unknown>,
    output: Record<string, unknown>,
  ): boolean | null {
    try {
      const result = validateAgainstSchema(outputSchema, output);

      // ⚠️ `validateAgainstSchema` does NOT throw when the schema itself cannot
      // be compiled — it catches and reports the compile failure through the
      // same `{ valid: false }` channel as a genuine mismatch. That is right for
      // its first caller (the purchase path turns any `valid: false` into one
      // 400) and wrong here: recording `false` asserts the seller's output
      // failed its contract, when in fact the platform could not ask the
      // question. FR-030 says that must leave the answer unanswered.
      //
      // Matching on the prefix is a wart, and the alternative was worse:
      // changing the shared function to throw would change how a *purchase*
      // reports an unusable schema, which is API-06/07 behaviour this feature
      // has no business altering. (The message says "input schema" because that
      // function serves both sides of a purchase; here the same failure is
      // about `output_schema`.)
      if (!result.valid && result.errors.startsWith(SCHEMA_COMPILE_FAILURE)) {
        this.logger.error(
          `order=${claimed.orderId} output schema could not be compiled; ` +
            'output_valid left unanswered — the delivery stands',
        );
        return null;
      }

      if (!result.valid) {
        // Worth a line: it is a pre-audit fact, and on the demo path it would
        // mean a seeded fixture drifted from its own contract. The Ajv message
        // names paths and keywords, not values — it does not echo the output.
        this.logger.warn(
          `order=${claimed.orderId} output does not satisfy its declared schema: ${result.errors}`,
        );
      }

      return result.valid;
    } catch (err) {
      this.logger.error(
        `order=${claimed.orderId} conformance check itself failed ` +
          `(${err instanceof Error ? err.name : 'unknown error'}); ` +
          'output_valid left unanswered — the delivery stands',
      );
      return null;
    }
  }

  /**
   * Tell the escrow contract the deal was delivered, and only then move the
   * order to `delivered`.
   *
   * ## ⚠️ The state follows the contract, never the other way round
   *
   * `markDelivered` is what opens the buyer's review window — on-chain, where
   * `accept` and `release` are checked against it. An order marked `delivered`
   * in Postgres while the contract disagrees shows the buyer a clock that does
   * not exist and a button the contract will reject.
   *
   * ## ⚠️ All three failure outcomes leave the order in `running`
   *
   * | Outcome | Why not `delivered` | Why not `failed` |
   * | --- | --- | --- |
   * | Reverted | the contract does not agree | something *was* produced |
   * | Unreachable | no confirmation exists | same |
   * | Unknown (`ChainOutcomeUnknownError`) | it may yet confirm | same |
   *
   * `failed` would be a false statement: the output is sitting in `runs.output`,
   * and Guardian would read it as a delivery while the state claimed nothing
   * arrived. So the order rests in `running` with a complete, closed record —
   * an honest description of "the work is done and the announcement is not".
   *
   * **The agent is never re-run to recover from this.** The work happened; a
   * second run would destroy the record of it, and the `runs` UNIQUE makes that
   * structurally impossible anyway.
   *
   * Two things outside this feature already resolve the resting state: API-10's
   * reaper eventually moves a stuck `running` order to `failed` (leaving the one
   * combination nothing else produces — `failed` with a non-NULL output, which
   * an auditor reads on its merits), and API-07's complaint path issues
   * `markDelivered` and `dispute` as a single action for a `failed` order, which
   * re-sends exactly the announcement that was lost (research R6).
   */
  private async announceDelivery(claimed: ClaimedOrder): Promise<void> {
    let txHash: string;

    try {
      const tx = await this.escrow.markDelivered(BigInt(claimed.onchainDealId));
      txHash = tx.hash;
    } catch (err) {
      this.logger.error(
        `order=${claimed.orderId} deal=${claimed.onchainDealId} ` +
          `markDelivered FAILED kind=${err instanceof Error ? err.name : 'unknown'} ` +
          `hash=${err instanceof ChainOutcomeUnknownError ? err.hash : 'none'} — ` +
          'run record and output are intact; order left in `running` for the reaper ' +
          'or for a complaint to re-announce. DO NOT re-run the agent.',
      );
      return;
    }

    const moved = await this.repository.markDelivered(claimed.orderId);

    if (!moved) {
      // The reaper got there first. The record still holds the output and the
      // contract now agrees the deal was delivered, so nothing is lost — but it
      // is worth saying out loud, because `failed` with an output is the one
      // row shape nothing else in the system produces.
      this.logger.warn(
        `order=${claimed.orderId} delivered on-chain (tx=${txHash}) but was no ` +
          'longer `running` — another writer moved it first',
      );
      return;
    }

    this.logger.log(
      `order=${claimed.orderId} deal=${claimed.onchainDealId} delivered tx=${txHash}`,
    );
  }

  /**
   * Nothing was delivered. Close the record with the error and the timings,
   * leaving `output` NULL, then move the order to `failed`.
   *
   * ## ⚠️ `output` stays NULL, and `output_valid` stays NULL with it
   *
   * The empty output is not a missing value to be tidied up — it is a positive
   * claim that nothing arrived, and it is the strongest case a buyer can have
   * (`docs/CONTEXT.md` invariant #7). The unanswered conformance question is
   * correct for the same reason: there was no output to check, and recording
   * `false` would assert that something was delivered and failed its contract.
   *
   * ## ⚠️ No chain call on this path. None.
   *
   * `markDelivered` here would tell the escrow contract a deal was delivered
   * when nothing was, which makes it **releasable to a seller who delivered
   * nothing** — and release is permissionless, so the money could be gone before
   * anyone noticed. The only thing that ever marks a failed order's deal as
   * delivered is API-07's complaint path, which pairs it with `dispute` in a
   * single action precisely so that window is one action wide.
   *
   * The consequence to accept is that a failed order sits with its money in
   * escrow until the buyer complains or the reclaimer sweeps it. That is
   * correct: nothing was delivered, so nothing should settle.
   */
  private async onFailure(
    claimed: ClaimedOrder,
    runId: string,
    startedAt: Date,
    error: ExecutionError,
    model: string | null,
  ): Promise<void> {
    const finishedAt = new Date();
    const durationMs = finishedAt.getTime() - startedAt.getTime();

    await this.repository.closeRun(runId, {
      steps: failureTrace({
        model,
        kind: failureKind(error),
        message: error.message,
        durationMs,
        startedAt,
      }),
      output: null,
      error: error.message,
      outputValid: null,
      finishedAt,
      durationMs,
    });

    const moved = await this.repository.markFailed(claimed.orderId);

    this.logger.warn(
      `order=${claimed.orderId} run=${runId} failed kind=${error.name} ` +
        `duration_ms=${durationMs}${moved ? '' : ' (state already moved by another writer)'}`,
    );
  }

  /**
   * Anything escaping a runner that is not already one of the three declared
   * errors is a defect, and it is treated as a run failure rather than allowed
   * to reach the poller.
   *
   * A run that dies without a record is the one outcome in this feature with no
   * evidence at all — the order would sit in `running` with an open row and no
   * explanation. Turning the unknown throw into a recorded failure is strictly
   * better than that, and the message says plainly that it was unexpected.
   */
  private asExecutionError(err: unknown, claimed: ClaimedOrder): ExecutionError {
    if (err instanceof ExecutionError) return err;

    return new AgentRunFailedError(
      `unexpected failure while running order ${claimed.orderId}`,
      claimed.orderId,
      err,
    );
  }
}
