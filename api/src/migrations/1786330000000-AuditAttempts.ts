import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Two columns on `orders`: `audit_attempts` and `audit_failed_at`.
 *
 * ## What they are for
 *
 * Guardian retries a failed audit — a refusal, a truncation, an untraceable
 * citation, a leaked prompt, a timeout — and something has to say when to stop.
 * `audit_attempts` is the count; `audit_failed_at` is the moment Guardian gave
 * up, and it is what `GET /orders/:id/verdict` reads to answer `409
 * AUDIT_FAILED` instead of the in-progress `404`.
 *
 * ## ⚠️ Why the counter cannot live in memory
 *
 * It has to outlive the process. An in-memory counter resets on restart, so a
 * deterministically-failing order retries forever across deploys — and worse,
 * the terminal state would *vanish from the API* on the next restart, turning a
 * visible failure back into the spinner it was added to prevent.
 *
 * ## ⚠️ Why this is not a new `order_state` member
 *
 * The order is still `disputed`, and that is not a technicality: the dispute is
 * real and unresolved, and what failed is our ability to rule on it. A new state
 * would mean migrating the `order_state` enum, deciding whether it belongs in
 * `ESCROWED_ORDER_STATES` (it would — the tokens are still escrowed), and adding
 * a word to a state machine four other specs already reason about, all to say
 * what these two columns already say.
 *
 * ## What does NOT happen when the attempts run out
 *
 * No fallback verdict is written. Settling at the quarter tier would match
 * `docs/product-workflow.md` §7.4 and would free the money, and it would put a
 * row into `verdicts` that Guardian did not author — rendering on the verdict
 * screen as a tier with an empty citation checklist, which is *"a tier alone is
 * an assertion"* wearing the costume of an audit. The funds stay escrowed until
 * the escrow's own 72-hour `DISPUTE_DEADLINE` lets anyone call `forceResolve`,
 * which is the contract's existing answer for "Guardian never ruled".
 *
 * ## On the timestamp
 *
 * Renamed from the generator's clock value, which landed *before*
 * `1786320000000-OrderInput`. TypeORM orders by this prefix, so on a fresh
 * database the generated name would have run this migration before the one that
 * precedes it in the project's history — harmless here, since both only touch
 * columns `InitialSchema` created, and confusing forever.
 *
 * (`specs/009-guardian-audit-engine/research.md` R14, data-model.md §7)
 */
export class AuditAttempts1786330000000 implements MigrationInterface {
  name = 'AuditAttempts1786330000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "orders" ADD "audit_attempts" smallint NOT NULL DEFAULT '0'`,
    );
    await queryRunner.query(
      `ALTER TABLE "orders" ADD "audit_failed_at" TIMESTAMP WITH TIME ZONE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "orders" DROP COLUMN "audit_failed_at"`,
    );
    await queryRunner.query(
      `ALTER TABLE "orders" DROP COLUMN "audit_attempts"`,
    );
  }
}
