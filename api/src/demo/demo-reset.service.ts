import { Injectable, Logger } from '@nestjs/common';
import { DataSource, type EntityManager } from 'typeorm';

import { OrderState } from '../entities/enums';
import {
  RESET_NOTE,
  type ResetClearedCounts,
  type ResetResponse,
} from './dto/reset-response.dto';

/**
 * The states an order can be in while its money is still on-chain and unsettled.
 *
 * `released`, `settled` and `failed` are absent deliberately. The first two have
 * already paid out; a `failed` order was compensated by the purchase saga's own
 * failure branch and never escrowed anything. Everything else here has funds in
 * the escrow contract right now.
 */
const IN_FLIGHT_STATES: readonly OrderState[] = [
  OrderState.Purchased,
  OrderState.Running,
  OrderState.Delivered,
  OrderState.Disputed,
  OrderState.Adjudicated,
];

/**
 * `POST /demo/reset` — return the system to a re-runnable state.
 *
 * Clears orders, runs, complaints and verdicts. Keeps accounts, the catalogue,
 * and **every ledger entry**.
 *
 * ## ⚠️ Why the ledger is updated rather than deleted
 *
 * `ledger_entries.order_id` carries a foreign key to `orders` with **no
 * `ON DELETE` clause**, so `DELETE FROM orders` is a constraint violation while
 * a purchase entry still points at one. Something has to give, and the two
 * obvious answers are both wrong:
 *
 * - **Delete the entries too.** This reverses the purchase debits, so balances
 *   jump back up — but the money is gone. It is sitting in an escrow deal, or it
 *   has already settled to someone's own on-chain address, which `docs/CONTEXT.md`
 *   invariant #5 says *by design* cannot be recaptured. The result is a ledger
 *   claiming money the operator pool does not hold: a direct hit on the solvency
 *   invariant, in the exact direction invariant #1 exists to prevent.
 * - **Keep the orders.** Contradicts the requirement, and leaves the last
 *   rehearsal's orders on screen during the next one.
 *
 * So the pointer goes and the row stays. Every `amount_minor`, every `kind`,
 * every timestamp survives, and because a balance is `SUM(amount_minor)`
 * (invariant #4) **no balance changes**. What is lost is provenance to a row
 * that no longer exists — which was going to dangle either way.
 *
 * The append-only rule protects what the ledger *records*. Clearing a foreign
 * key to a deleted row does not rewrite an amount; deleting the row, or writing
 * a compensating entry to "give the money back", would.
 * (`specs/011-demo-seed-fixtures/research.md` R4.)
 *
 * ## ⚠️ Reset does not refund
 *
 * Each rehearsal spends real balance and this does not return it. A long session
 * needs topping up through the ordinary funding path. `RESET_NOTE` says so in
 * the response because that is where the person who just ran it is looking.
 *
 * ## Concurrency
 *
 * No coordination with the pollers, on purpose. Both claim work with
 * `UPDATE … RETURNING` and act on the returned row, so a reset that commits
 * between a claim and its write makes that write fail on a foreign key —
 * `runs.order_id` is `NOT NULL REFERENCES orders(id)`, so the constraint refuses
 * it outright and no orphan is created. The poller logs and continues. Pausing
 * the workers would be real coordination (a flag, a window, a process that dies
 * with it set) to protect against an error that is already harmless (research
 * R5).
 */
@Injectable()
export class DemoResetService {
  private readonly logger = new Logger(DemoResetService.name);

  constructor(
    // Injected by class token, matching `AgentWritesService` and
    // `LedgerRepository`: `TypeOrmModule.forRoot` provides `DataSource` globally,
    // so this needs no `@InjectDataSource()` and no module-local registration.
    private readonly dataSource: DataSource,
  ) {}

  async reset(): Promise<ResetResponse> {
    const cleared = await this.dataSource.transaction(async (manager) =>
      this.clearInsideTransaction(manager),
    );

    // Counted after the commit rather than inside it: these are the numbers a
    // reader uses to confirm nothing was lost, and a count from inside the
    // transaction would be reporting what this method intended rather than what
    // the database now holds.
    const kept = {
      accounts: await this.count('accounts'),
      agents: await this.count('agents'),
      ledgerEntries: await this.count('ledger_entries'),
    };

    this.logger.log(
      `demo reset: cleared ${cleared.orders} orders ` +
        `(${cleared.ordersInFlight} in flight), ${cleared.runs} runs, ` +
        `${cleared.complaints} complaints, ${cleared.verdicts} verdicts; ` +
        `unlinked ${cleared.ledgerEntriesUnlinked} ledger entries, deleted none`,
    );

    if (cleared.ordersInFlight > 0) {
      // ⚠️ `warn`, not `log`. Money was left escrowed on-chain for these, and
      // the only thing that frees it now is the escrow's own deadline. A line
      // that scrolls past at `log` level is not a record of that.
      this.logger.warn(
        `${cleared.ordersInFlight} order(s) were still in flight when reset ran; ` +
          `their escrowed funds remain on-chain and are not recoverable by this platform`,
      );
    }

    return { cleared, kept, note: RESET_NOTE };
  }

  /**
   * The whole clear, in one transaction, in foreign-key order.
   *
   * The order is not a preference. `ledger_entries` must be unlinked before
   * `orders` is deleted, and the three child tables must go before their parent.
   * A partial reset is not a state anyone should have to reason about, so a
   * failure anywhere rolls all of it back.
   */
  private async clearInsideTransaction(
    manager: EntityManager,
  ): Promise<ResetClearedCounts> {
    // Read before deleting — afterwards there is nothing left to count, and this
    // is the number that tells an operator they left money in escrow.
    const ordersInFlight = await this.countInFlight(manager);

    const ledgerEntriesUnlinked = await this.affected(
      manager,
      `UPDATE ledger_entries SET order_id = NULL WHERE order_id IS NOT NULL`,
    );

    const verdicts = await this.affected(manager, `DELETE FROM verdicts`);
    const complaints = await this.affected(manager, `DELETE FROM complaints`);
    const runs = await this.affected(manager, `DELETE FROM runs`);
    const orders = await this.affected(manager, `DELETE FROM orders`);

    return {
      orders,
      ordersInFlight,
      runs,
      complaints,
      verdicts,
      ledgerEntriesUnlinked,
    };
  }

  private async countInFlight(manager: EntityManager): Promise<number> {
    const rows = (await manager.query(
      `SELECT count(*)::int AS count FROM orders WHERE state = ANY($1)`,
      [IN_FLIGHT_STATES],
    )) as Array<{ count: number }>;

    return rows[0]?.count ?? 0;
  }

  private async count(table: string): Promise<number> {
    // The table name is interpolated because an identifier cannot be a bound
    // parameter. Every call site below passes a literal from this file — there
    // is no path by which a request value reaches here, and this method is
    // private so there cannot be one later without editing this file.
    const rows = (await this.dataSource.query(
      `SELECT count(*)::int AS count FROM ${table}`,
    )) as Array<{ count: number }>;

    return rows[0]?.count ?? 0;
  }

  /**
   * Row count for a statement that returns no rows.
   *
   * ⚠️ **`manager.query()` does not return one shape for every statement**, and
   * asserting the wrong one is a defect a type check cannot catch — this
   * codebase has already paid for it once, when a raw `UPDATE … RETURNING` was
   * read as a rows array and thirteen orders changed state with no record
   * (`specs/008-execution-engine/tasks.md`, verification run). For a bare
   * `DELETE` or `UPDATE` with no `RETURNING`, the driver resolves to
   * `[undefined, affectedCount]`, so the count is the **second** element. It is
   * read defensively rather than asserted, because being wrong here would
   * misreport what a destructive operation did.
   */
  private async affected(
    manager: EntityManager,
    sql: string,
  ): Promise<number> {
    const result: unknown = await manager.query(sql);

    if (Array.isArray(result) && typeof result[1] === 'number') {
      return result[1];
    }

    this.logger.warn(
      `could not read an affected-row count from: ${sql} — reporting 0`,
    );

    return 0;
  }
}
