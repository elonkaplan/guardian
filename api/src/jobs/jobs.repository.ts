import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import { OrderState } from '../entities/enums';
import { Order } from '../entities/order.entity';
import { Run } from '../entities/run.entity';

/**
 * Every database statement the three timers issue. Nothing in `src/jobs/` talks
 * to Postgres except through this class.
 *
 * One repository for three jobs rather than one each, because the whole surface
 * is four selects and four writes against two tables, and the value of having
 * them in one file is that the prohibitions below can be checked by reading it.
 *
 * ## ⚠️ Three prohibitions, all checkable by grep
 *
 * Each of these is an **absence**, and an absence does not announce itself in
 * code review. `specs/010-cron-jobs/tasks.md` T043 runs these greps over
 * `src/jobs/` as a release gate; they are restated here because the person most
 * likely to break one is whoever adds the fifth query.
 *
 * **1. No job writes a ledger entry. Ever.** There is no `INSERT INTO
 * ledger_entries` in this module and there must never be one. Invariant #5
 * (`docs/CONTEXT.md`): settled funds land on-chain under the user's own address,
 * where the platform cannot recapture them, so settlement writes no ledger row.
 * A "refund" credit when an order is reclaimed reads as kindness and is the one
 * error no later entry can correct — the buyer would hold the same cents twice,
 * once as spendable balance and once as an on-chain claim, and the pool would
 * owe more than it holds. `guardian.service.ts` carries the identical
 * prohibition for the dispute path.
 *
 * **2. No statement names `runs.output`, `runs.output_valid`, or `runs.steps`.**
 * Invariant #7: `runs.output IS NULL` is how non-delivery is proven, and it is
 * the entire basis of the demo's closing act. `execution/`'s `closeRun` protects
 * that column by *refusing* to write a stand-in into it; this module protects it
 * by never mentioning it, which is the stronger form. The reaper's only `runs`
 * write touches `finished_at`, `duration_ms` and `error`, and is guarded on
 * `finished_at IS NULL` — see `closeAbandonedRun`.
 *
 * **3. No query selects `disputed`, `adjudicated`, `released`, or `settled`.**
 * The four state literals that may appear in this file are `delivered`,
 * `purchased`, `failed` and `running`. A dispute Guardian has not ruled on —
 * including one whose `audit_failed_at` is set — is left to the escrow's 72-hour
 * `DISPUTE_DEADLINE` and its permissionless `forceResolve`; `order.entity.ts`
 * says so directly. `adjudicated` is invariant #8's window and belongs to
 * `GuardianPoller`'s settle pass. `released` and `settled` are terminal and
 * their money has already left escrow (research R14).
 *
 * ## Every write is conditional on the state it expects
 *
 * That is what makes each job idempotent without a transaction, a lock, or a
 * persisted retry counter: a second attempt matches zero rows and changes
 * nothing. Each write returns whether a row actually moved, so a job logs what
 * happened rather than what it intended — a `false` means somebody else got
 * there first, which is an ordinary outcome and belongs at debug level, not
 * error.
 *
 * There is deliberately **no `FOR UPDATE SKIP LOCKED`** here.
 * `ExecutionRepository.claimNext` uses it because execution may genuinely run
 * concurrent workers one day; here a pass is single-threaded by
 * `PollingJob`'s re-entrancy guard, and across processes the conditional
 * `UPDATE` plus the contract's own state check already make a duplicate
 * harmless — a second `release` reverts for free at simulation. Adding the lock
 * would imply a guarantee this feature neither needs nor has (research R4).
 *
 * And **no transactions**: each write is a single statement, and the chain call
 * that precedes it is not rollbackable. Wrapping one `UPDATE` in a transaction
 * would suggest the two were atomic.
 */
@Injectable()
export class JobsRepository {
  constructor(
    @InjectRepository(Order)
    private readonly orders: Repository<Order>,
    @InjectRepository(Run)
    private readonly runs: Repository<Run>,
  ) {}

  // -------------------------------------------------------------------
  // Sweeper — delivered, and the review window has run out
  // -------------------------------------------------------------------

  /**
   * The next order whose seller is owed payment, or `null`.
   *
   * Uses `orders_sweeper_idx (state, delivered_at)` — the index API-02 created
   * for this job and named after it, before the job existed.
   *
   * `review_window_seconds` is the per-order **snapshot** taken at purchase, not
   * the seller's current listing setting, for the same reason `price_minor` is:
   * a seller editing their listing cannot move the deadline on a sale that has
   * already happened.
   *
   * `onchain_deal_id IS NOT NULL` is belt-and-braces — an order cannot reach
   * `delivered` without one, because `markDelivered` is called *with* the id.
   * It stays because the id is dereferenced two lines later at the call site,
   * where a NULL would be a crash rather than a skip.
   *
   * ⚠️ `LIMIT 1` inside the caller's drain loop, deliberately, rather than
   * fetching a batch. Each iteration re-reads current truth, so an order whose
   * state changed while the previous chain call was in flight is simply not
   * selected again — which is most of why no job here needs a lock (research R4).
   *
   * ## ⚠️ `skipIds` is what stops the drain looping forever
   *
   * The re-read that makes `LIMIT 1` safe is also what makes it dangerous
   * without this parameter. An order the sweeper **fails** to advance — the
   * chain said `"window open"` because our clock ran ahead, the deal turned out
   * to be `Disputed`, the RPC was down — keeps every property this predicate
   * selects on. The next iteration selects the identical row, fails identically,
   * and the pass spins until the process is killed.
   *
   * Breaking out of the drain on the first failure would fix the spin and
   * introduce **starvation** instead: candidates are ordered by `delivered_at`,
   * so the single oldest stuck order would stand in front of every newer one
   * forever, and a sweeper that cannot pay anybody because one deal is disputed
   * is worse than the loop.
   *
   * So the caller accumulates the ids it could not advance and passes them back.
   * The set lives for one pass and is discarded — the next tick starts empty and
   * retries everything, which is the retry policy for the whole feature
   * (research R5).
   */
  async findReleasable(skipIds: readonly string[] = []): Promise<DueOrder | null> {
    const rows = (await this.orders.manager.query(
      `SELECT id, onchain_deal_id
         FROM orders
        WHERE state = $1
          AND onchain_deal_id IS NOT NULL
          AND delivered_at + (review_window_seconds * INTERVAL '1 second') <= now()
          AND NOT (id = ANY($2::uuid[]))
        ORDER BY delivered_at
        LIMIT 1`,
      [OrderState.Delivered, skipIds],
    )) as Array<{ id: string; onchain_deal_id: string }>;

    return toDueOrder(rows[0]);
  }

  /**
   * Record that the escrow has paid the seller.
   *
   * ⚠️ **Only ever called after a confirmed receipt.** `state = 'released'` is a
   * claim about where the money is; writing it before the chain agrees tells a
   * seller they have been paid when nothing has moved (research R5).
   *
   * Conditional on `state = 'delivered'`, which is what makes the sweeper
   * idempotent: a second pass over the same order matches zero rows. It also
   * means an order that was disputed between the select and this write is not
   * dragged out of the dispute — the buyer won that race and the row says so.
   */
  async markReleased(orderId: string): Promise<boolean> {
    const result = await this.orders.update(
      { id: orderId, state: OrderState.Delivered },
      { state: OrderState.Released },
    );

    return (result.affected ?? 0) > 0;
  }

  // -------------------------------------------------------------------
  // Reaper — running, and nobody is coming back
  // -------------------------------------------------------------------

  /**
   * The next order abandoned mid-execution, or `null`.
   *
   * Due when the run has been open for longer than the **pinned** version's
   * declared time limit plus a grace margin. The limit comes through
   * `orders.agent_version_id` and never from the agent's current version — that
   * is invariant #6 doing its job: a seller who republishes between purchase and
   * execution has changed nothing about how long *this* order was allowed.
   *
   * ## ⚠️ `LEFT JOIN` and `COALESCE`, never an inner join
   *
   * `ExecutionRepository` moves an order to `running` and inserts its `runs` row
   * as **two statements**. A process that died between them leaves an order in
   * `running` with no run record at all — and an inner join would never select
   * it, leaving it stuck forever, which is the exact hole this job exists to
   * close.
   *
   * The fallback to `orders.created_at` is imperfect and knowingly so: an order
   * that sat in `purchased` for hours because the execution poller was down, and
   * was claimed one second ago, looks long overdue. The window is the
   * milliseconds between two adjacent statements against a job that ticks once a
   * minute, so in practice the run row is always there by the next tick
   * (research R7). The exact fix — a `claimed_at` column — was rejected as a
   * migration for a race no rehearsal will produce.
   */
  async findAbandonedRun(
    graceMs: number,
    skipIds: readonly string[] = [],
  ): Promise<AbandonedRun | null> {
    const rows = (await this.orders.manager.query(
      `SELECT o.id AS order_id, r.id AS run_id, r.started_at
         FROM orders o
         JOIN agent_versions v ON v.id = o.agent_version_id
         LEFT JOIN runs r      ON r.order_id = o.id
        WHERE o.state = $1
          AND COALESCE(r.started_at, o.created_at)
              + (v.timeout_seconds * INTERVAL '1 second')
              + ($2 || ' milliseconds')::interval
              <= now()
          AND NOT (o.id = ANY($3::uuid[]))
        ORDER BY o.created_at
        LIMIT 1`,
      [OrderState.Running, String(graceMs), skipIds],
    )) as Array<{
      order_id: string;
      run_id: string | null;
      started_at: Date | null;
    }>;

    const row = rows[0];
    if (row === undefined) return null;

    return {
      orderId: row.order_id,
      runId: row.run_id,
      startedAt: row.started_at,
    };
  }

  /**
   * Close the run of a worker that never came back.
   *
   * ## ⚠️ `finished_at IS NULL` is the whole design
   *
   * One predicate satisfies both halves of FR-019, with no branch and nothing
   * for a reader to remember. There are exactly two ways an order is found in
   * `running`:
   *
   * | How it got stuck | Run record | What this statement does |
   * | --- | --- | --- |
   * | The process died mid-run | open — `finished_at` NULL, `output` NULL | closes it, records why |
   * | The run succeeded but `markDelivered` failed | **already closed** — `output` set | matches zero rows. Untouched |
   *
   * The second is not hypothetical. `execution.service.ts` calls `closeRun` with
   * the output **before** it tells the chain, so a lost delivery announcement
   * leaves a `running` order whose run holds a real output. Excluding that row is
   * what stops the reaper destroying the only record of what the agent produced.
   *
   * ## ⚠️ It never names `output`, `output_valid`, or `steps`
   *
   * Invariant #7: `runs.output IS NULL` is how non-delivery is proven, and it is
   * the basis of the demo's closing act. `execution/`'s `closeRun` protects that
   * column by refusing to write a stand-in into it; this statement protects it by
   * never mentioning it, which cannot be got wrong by a later edit to a value.
   *
   * `duration_ms` is computed in the database from `started_at` rather than
   * passed in, so it stays consistent with a row this process may never have
   * seen open.
   */
  async closeAbandonedRun(orderId: string, error: string): Promise<boolean> {
    const [, affected] = (await this.runs.manager.query(
      `UPDATE runs
          SET finished_at = now(),
              duration_ms = (EXTRACT(EPOCH FROM (now() - started_at)) * 1000)::int,
              error       = $2
        WHERE order_id = $1
          AND finished_at IS NULL`,
      [orderId, error],
    )) as [unknown[], number];

    return affected > 0;
  }

  /**
   * Move an abandoned order to `failed`.
   *
   * ⚠️ Conditional on `state = 'running'`, and that condition is one half of a
   * two-sided race. `ExecutionRepository.markDelivered` is conditional on the
   * same state for the same reason, from the other side — its docblock names
   * this job: *"Between the claim and this call the reaper may have decided the
   * order was stuck and moved it to `failed`."* Whichever write lands first
   * wins, and the loser changes nothing. An order that finished normally between
   * being selected and being written here is therefore never dragged back out of
   * `delivered` (FR-022).
   *
   * The order moves regardless of which run-row shape `closeAbandonedRun` found:
   * a `failed` order that *does* have an output is coherent, and an auditor reads
   * it on its merits rather than as non-delivery.
   */
  async markReaped(orderId: string): Promise<boolean> {
    const result = await this.orders.update(
      { id: orderId, state: OrderState.Running },
      { state: OrderState.Failed },
    );

    return (result.affected ?? 0) > 0;
  }

  // -------------------------------------------------------------------
  // Reclaimer — an open deal nobody ever delivered against
  // -------------------------------------------------------------------

  /**
   * The next order whose buyer should have their money back, or `null`.
   *
   * Uses `orders_undelivered_idx (state, created_at)`.
   *
   * ## ⚠️ `failed` is in the state list on purpose
   *
   * The contract cannot tell "never ran" from "ran and produced nothing" —
   * `reclaim` requires `DealState.Open`, and a deal is Open in both cases,
   * because the platform only ever calls `markDelivered` on success. Covering
   * only `purchased` would strand the money of every buyer whose agent failed,
   * which is the population this job most exists for.
   * `escrow-exposure.repository.ts` already writes the intent into a table row:
   * *"The agent ran and produced nothing | deal id set | escrowed ✅ yes, until
   * the reclaimer sweeps."* (research R10)
   *
   * ## ⚠️ `onchain_deal_id IS NOT NULL` excludes two different rows
   *
   * A `purchased` order whose `openDeal` was never confirmed — there is nothing
   * to reclaim, and `order.entity.ts` warns that acting against a NULL id is how
   * one purchase ends up with two deals escrowing two prices. And a `failed`
   * order whose `openDeal` was **refused**, which escrowed nothing and whose
   * compensating `adjustment` has already restored the buyer's balance.
   *
   * ## `created_at` rather than the deal's `openedAt`
   *
   * The contract measures from its own `openedAt`, a block timestamp a second or
   * two after this row was written, so this predicate fires slightly early and
   * the contract answers `"too early"` — caught free at simulation, retried five
   * minutes later. Reading `openedAt` per candidate would cost one `eth_call` on
   * every pass to save one free refusal on the first pass after a deadline.
   */
  async findReclaimable(
    deadlineHours: number,
    skipIds: readonly string[] = [],
  ): Promise<DueOrder | null> {
    const rows = (await this.orders.manager.query(
      `SELECT id, onchain_deal_id
         FROM orders
        WHERE state = ANY($1)
          AND onchain_deal_id IS NOT NULL
          AND created_at + ($2 || ' hours')::interval <= now()
          AND NOT (id = ANY($3::uuid[]))
        ORDER BY created_at
        LIMIT 1`,
      [
        [OrderState.Purchased, OrderState.Failed],
        String(deadlineHours),
        skipIds,
      ],
    )) as Array<{ id: string; onchain_deal_id: string }>;

    return toDueOrder(rows[0]);
  }

  /**
   * Record that the escrow has returned an undelivered deal's money to its
   * buyer.
   *
   * ## ⚠️ The resting state is `settled`, and it is forced rather than chosen
   *
   * `ESCROWED_ORDER_STATES` (`src/orders/order-states.ts`) contains `failed` and
   * excludes `settled`, with the reason written into that file: an order still in
   * the set has money the buyer sees in `inEscrowMinor`, and one outside it has
   * money already paid out to `balances[]` on-chain, *"where they are counted by
   * `settledFundsMinor` instead. Counting them here would show the same cents
   * twice."*
   *
   * The moment `reclaim` confirms, `balances[buyer]` rises and
   * `accounts.service.ts` starts reporting those cents as settled funds — it
   * reads the chain directly. Leaving the order in `failed` would keep
   * `inEscrowMinor` summing the same price, and the buyer would see their money
   * in two figures at once. Only `settled` satisfies both halves (research R9).
   *
   * ## ⚠️ No ledger entry — not here, not anywhere in this module
   *
   * Invariant #5. The money comes back as an on-chain claim under the buyer's own
   * address, not as spendable platform balance. A credit here would hand them the
   * same money twice and leave the pool owing more than it holds, which invariant
   * #1 calls the one error no later entry can correct.
   */
  async markReclaimed(orderId: string): Promise<boolean> {
    const result = await this.orders.update(
      { id: orderId, state: In([OrderState.Purchased, OrderState.Failed]) },
      { state: OrderState.Settled, settledAt: new Date() },
    );

    return (result.affected ?? 0) > 0;
  }

  // -------------------------------------------------------------------
  // Not a job — a report
  // -------------------------------------------------------------------

  /**
   * Every purchase still waiting for its escrow deal to confirm, past the grace
   * period.
   *
   * The **whole set**, not `LIMIT 1`: this is a report, and the caller
   * deduplicates in memory so a steady state produces one line per order per
   * process rather than one every five minutes (research R12).
   *
   * ⚠️ Nothing acts on these rows. No state change, no ledger entry, no chain
   * call. The resting state is deliberate — API-07's saga leaves an order here
   * when `openDeal`'s outcome is **unknown**, because the money may genuinely be
   * escrowed and compensating would promise cents the pool does not hold.
   * Recovery is by looking the logged transaction hash up by hand.
   */
  async findUnconfirmedPurchases(graceMs: number): Promise<UnconfirmedOrder[]> {
    const rows = (await this.orders.manager.query(
      `SELECT id, buyer_account_id, created_at
         FROM orders
        WHERE state = $1
          AND onchain_deal_id IS NULL
          AND created_at + ($2 || ' milliseconds')::interval <= now()
        ORDER BY created_at`,
      [OrderState.Purchased, String(graceMs)],
    )) as Array<{ id: string; buyer_account_id: string; created_at: Date }>;

    return rows.map((row) => ({
      orderId: row.id,
      buyerAccountId: row.buyer_account_id,
      createdAt: row.created_at,
    }));
  }
}

/**
 * ⚠️ `pg` hands `bigint` back as a **string**, and the entity's
 * `bigintTransformer` does not apply to a raw query.
 *
 * Converted once, here, straight to the `bigint` viem wants — so no job holds
 * `"7"` where it expects a deal id, and no call site has to remember a
 * `BigInt(...)`. `ExecutionRepository.claimNext` documents the same trap and
 * converts to `number` instead, because its consumer stores the value rather
 * than calling the chain with it.
 */
function toDueOrder(
  row: { id: string; onchain_deal_id: string } | undefined,
): DueOrder | null {
  if (row === undefined) return null;
  return { orderId: row.id, onchainDealId: BigInt(row.onchain_deal_id) };
}

/**
 * An order whose escrow deal is due for a lifecycle call — `release` for the
 * sweeper, `reclaim` for the reclaimer.
 *
 * ⚠️ `onchainDealId` is a `bigint`, not the `number` the entity's
 * `bigintTransformer` produces. These rows come back from raw queries, where the
 * transformer does not apply and `pg` hands `bigint` over as a **string**; it is
 * converted once, at the repository boundary, straight into the type viem
 * wants — so no job ever holds `"7"` where it expects a deal id, and no call
 * site has to remember a `BigInt(...)`. `ExecutionRepository.claimNext`
 * documents the same trap and converts to `number` instead, because its consumer
 * stores the value rather than calling the chain with it.
 */
export interface DueOrder {
  readonly orderId: string;
  readonly onchainDealId: bigint;
}

/**
 * An order stuck in `running` past any time its agent could legitimately still
 * be working.
 *
 * `runId` and `startedAt` are **nullable together**, and the null case is real:
 * `ExecutionRepository` moves an order to `running` and inserts its `runs` row
 * as two separate statements, so a process that died between them leaves an
 * order in `running` with no run record at all. That order still has to be
 * reaped — it is the exact hole the reaper exists to close — which is why the
 * query LEFT joins and falls back to `orders.created_at` for the clock
 * (research R7).
 */
export interface AbandonedRun {
  readonly orderId: string;
  readonly runId: string | null;
  readonly startedAt: Date | null;
}

/**
 * A purchase whose `openDeal` was never confirmed, past the grace period.
 *
 * ⚠️ **Not work. A report.** This row shape exists so a stuck purchase can be
 * named in a log line, and nothing in this module ever acts on one: no state
 * change, no ledger entry, no chain call. The deal may yet confirm, and
 * `order.entity.ts` is explicit that retrying `openDeal` against a NULL id is
 * how one purchase ends up with two deals escrowing two prices.
 *
 * `buyerAccountId` is carried so the log line identifies a person, not only a
 * UUID — reconciliation here is by hand, and whoever does it starts from who is
 * out of pocket.
 */
export interface UnconfirmedOrder {
  readonly orderId: string;
  readonly buyerAccountId: string;
  readonly createdAt: Date;
}
