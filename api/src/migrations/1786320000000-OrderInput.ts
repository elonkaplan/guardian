import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * One column: `orders.input`.
 *
 * ## Why this was missing, and why it could not stay missing
 *
 * `POST /orders` takes the buyer's input. The only column in the initial schema
 * that can hold it is `runs.input` — and a `runs` row is written by
 * **execution** (API-08), which runs *after* the purchase has already been
 * answered. So between the purchase committing and execution starting there was
 * nowhere for the document to live, and an order could not describe what it was
 * an order *for*.
 *
 * ⚠️ **The tempting fix is to insert the `runs` row at purchase time with
 * `output` left NULL, and it destroys the evidence model.**
 * `runs.output IS NULL` is how non-delivery is proven (`docs/CONTEXT.md`
 * invariant #7) — it is not an "unfilled" state, it is the assertion that the
 * agent returned nothing. A run row created at purchase makes every
 * not-yet-started order indistinguishable from a crashed one, to Guardian and
 * to the buyer's screen alike. `ui/src/api/types.ts` states the same thing from
 * the client side: `Order.run === null` is how it knows a `purchased` order has
 * not started.
 *
 * Holding the input in memory until dispatch was the other option. It does not
 * survive a process restart, which is the exact case the reaper exists for
 * (`docs/api-design.md` §6) — an order the reaper re-picked would have no input
 * to run.
 *
 * ## `runs.input` is not made redundant
 *
 * The two columns answer different questions and both are evidence:
 * `orders.input` is what the buyer *paid for*; `runs.input` is what was
 * *actually sent* to the agent. In the MVP they hold the same document. They
 * are kept apart because the case file quotes the order's copy, which is what
 * lets an order that never ran — or whose escrow call was refused — still show
 * what was asked for.
 *
 * ## NOT NULL with no default, and no backfill
 *
 * `orders` is empty: the purchase saga is the first code in the project that
 * writes to it. A default would be a value no buyer supplied, sitting in a
 * column whose whole purpose is to record what they did.
 *
 * (`specs/007-orders-purchase-saga/research.md` R5)
 */
export class OrderInput1786320000000 implements MigrationInterface {
  name = 'OrderInput1786320000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "orders" ADD COLUMN "input" jsonb NOT NULL`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "orders" DROP COLUMN "input"`);
  }
}
