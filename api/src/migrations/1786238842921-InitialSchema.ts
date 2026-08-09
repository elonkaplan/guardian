import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The whole schema: 8 tables, 3 enum types, 20 indexes, 4 CHECK constraints.
 *
 * TRANSCRIBED from specs/002-entities-migrations/contracts/schema.sql, NOT
 * generated from the entities. Three things do not survive decorator inference
 * faithfully — the named enum types, the `lower(wallet_address)` functional
 * unique index, and the CHECK constraints — and those are exactly the parts
 * that encode product rules. Writing the SQL and making the entities match is
 * the direction that keeps them.
 *
 * `CREATE EXTENSION pgcrypto` is deliberately absent: gen_random_uuid() has
 * been core Postgres since v13, and this project runs 16.
 */
export class InitialSchema1786238842921 implements MigrationInterface {
  name = 'InitialSchema1786238842921';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ---------------------------------------------------------- enum types
    // Value order is significant — Postgres sorts enums by declaration order,
    // so reordering silently changes the meaning of ORDER BY.

    // No 'settlement' member, deliberately: settled funds land on-chain under
    // the user's own address and cannot be recaptured, so settlement writes no
    // ledger entry at all.
    await queryRunner.query(
      `CREATE TYPE "ledger_kind" AS ENUM ('onramp','purchase','offramp','adjustment')`,
    );
    await queryRunner.query(
      `CREATE TYPE "order_state" AS ENUM ('purchased','running','delivered','failed','released','disputed','adjudicated','settled')`,
    );
    await queryRunner.query(
      `CREATE TYPE "verdict_tier" AS ENUM ('none','quarter','half','three_quarter','full')`,
    );

    // ------------------------------------------------------------ accounts
    await queryRunner.query(`
      CREATE TABLE "accounts" (
        "id"             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "wallet_address" text        NOT NULL,
        "created_at"     timestamptz NOT NULL DEFAULT now()
      )
    `);

    // Identity must not vary with casing, but the stored casing is the
    // checksummed address and is also the payout destination — so the index is
    // functional and the column is left alone. There is deliberately NO plain
    // UNIQUE here: a plain one is case-sensitive and would let 0xAbC… and
    // 0xabc… both register as separate accounts.
    await queryRunner.query(
      `CREATE UNIQUE INDEX "accounts_wallet_lower_idx" ON "accounts" (lower("wallet_address"))`,
    );

    // -------------------------------------------------------------- agents
    await queryRunner.query(`
      CREATE TABLE "agents" (
        "id"               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "owner_account_id" uuid        NOT NULL REFERENCES "accounts"("id"),
        "onchain_agent_id" bigint      UNIQUE,
        "active"           bool        NOT NULL DEFAULT true,
        "created_at"       timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "agents_owner_idx" ON "agents" ("owner_account_id")`,
    );

    // ------------------------------------------------------ agent_versions
    await queryRunner.query(`
      CREATE TABLE "agent_versions" (
        "id"              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "agent_id"        uuid        NOT NULL REFERENCES "agents"("id"),
        "version"         int         NOT NULL,
        "name"            text        NOT NULL,
        "description"     text        NOT NULL,
        "capabilities"    text[]      NOT NULL,
        "exclusions"      text[]      NOT NULL,
        "price_minor"     bigint      NOT NULL CHECK ("price_minor" > 0),
        "input_schema"    jsonb       NOT NULL,
        "output_schema"   jsonb       NOT NULL,
        "system_prompt"   text        NOT NULL,
        "model"           text        NOT NULL,
        "timeout_seconds" int         NOT NULL DEFAULT 120,
        "definition_hash" bytea       NOT NULL,
        "created_at"      timestamptz NOT NULL DEFAULT now(),
        UNIQUE ("agent_id", "version")
      )
    `);

    // -------------------------------------------------------------- orders
    // agent_version_id, never agent_id: pinning to the version is what makes
    // "judged against the definition that actually ran" true by construction.
    await queryRunner.query(`
      CREATE TABLE "orders" (
        "id"                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "onchain_deal_id"       bigint      UNIQUE,
        "buyer_account_id"      uuid        NOT NULL REFERENCES "accounts"("id"),
        "agent_version_id"      uuid        NOT NULL REFERENCES "agent_versions"("id"),
        "price_minor"           bigint      NOT NULL CHECK ("price_minor" > 0),
        "acceptance_criteria"   text        NOT NULL,
        "state"                 order_state NOT NULL DEFAULT 'purchased',
        "review_window_seconds" int         NOT NULL CHECK ("review_window_seconds" > 0),
        "created_at"            timestamptz NOT NULL DEFAULT now(),
        "delivered_at"          timestamptz,
        "disputed_at"           timestamptz,
        "settled_at"            timestamptz
      )
    `);

    // The sweeper's query — re-run every few seconds for the whole demo. This
    // index earns its keep more than any other in the schema.
    await queryRunner.query(
      `CREATE INDEX "orders_sweeper_idx" ON "orders" ("state", "delivered_at")`,
    );
    await queryRunner.query(
      `CREATE INDEX "orders_undelivered_idx" ON "orders" ("state", "created_at")`,
    );
    await queryRunner.query(
      `CREATE INDEX "orders_buyer_idx" ON "orders" ("buyer_account_id", "created_at" DESC)`,
    );

    // ---------------------------------------------------------------- runs
    // order_id is UNIQUE: exactly one execution per purchase. A crashed run
    // stays as the row with output IS NULL, which IS the non-delivery evidence
    // — re-running would destroy it, so the database refuses.
    await queryRunner.query(`
      CREATE TABLE "runs" (
        "id"           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "order_id"     uuid        NOT NULL UNIQUE REFERENCES "orders"("id"),
        "input"        jsonb       NOT NULL,
        "output"       jsonb,
        "steps"        jsonb       NOT NULL DEFAULT '[]'::jsonb,
        "error"        text,
        "output_valid" bool,
        "started_at"   timestamptz NOT NULL DEFAULT now(),
        "finished_at"  timestamptz,
        "duration_ms"  int
      )
    `);

    // ---------------------------------------------------------- complaints
    // UNIQUE: one complaint per order. "No amendments, no re-filing" becomes a
    // database guarantee rather than an API check someone forgets.
    await queryRunner.query(`
      CREATE TABLE "complaints" (
        "id"         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "order_id"   uuid        NOT NULL UNIQUE REFERENCES "orders"("id"),
        "reason"     text        NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now()
      )
    `);

    // ------------------------------------------------------------ verdicts
    // UNIQUE: one verdict per order — there are no appeals. It is also what
    // makes the demo replayable: a re-run shows the stored verdict rather than
    // re-auditing, removing live-model variance from the stage.
    await queryRunner.query(`
      CREATE TABLE "verdicts" (
        "id"              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "order_id"        uuid         NOT NULL UNIQUE REFERENCES "orders"("id"),
        "tier"            verdict_tier NOT NULL,
        "refund_minor"    bigint       NOT NULL CHECK ("refund_minor" >= 0),
        "reasoning"       text         NOT NULL,
        "citations"       jsonb        NOT NULL DEFAULT '[]'::jsonb,
        "verdict_hash"    bytea        NOT NULL,
        "model"           text         NOT NULL,
        "onchain_tx_hash" text,
        "created_at"      timestamptz  NOT NULL DEFAULT now()
      )
    `);

    // ------------------------------------------------------ ledger_entries
    // APPEND-ONLY. A balance is SUM(amount_minor); there is no cached balance
    // column on this or any other table, by design.
    await queryRunner.query(`
      CREATE TABLE "ledger_entries" (
        "id"           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "account_id"   uuid        NOT NULL REFERENCES "accounts"("id"),
        "amount_minor" bigint      NOT NULL,
        "kind"         ledger_kind NOT NULL,
        "order_id"     uuid        REFERENCES "orders"("id"),
        "external_ref" text,
        "created_at"   timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "ledger_account_idx" ON "ledger_entries" ("account_id", "created_at")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Reverse dependency order. Indexes and UNIQUE constraints are dropped with
    // their tables, so only the tables and the three types need naming.
    await queryRunner.query(`DROP TABLE "ledger_entries"`);
    await queryRunner.query(`DROP TABLE "verdicts"`);
    await queryRunner.query(`DROP TABLE "complaints"`);
    await queryRunner.query(`DROP TABLE "runs"`);
    await queryRunner.query(`DROP TABLE "orders"`);
    await queryRunner.query(`DROP TABLE "agent_versions"`);
    await queryRunner.query(`DROP TABLE "agents"`);
    await queryRunner.query(`DROP TABLE "accounts"`);

    await queryRunner.query(`DROP TYPE "verdict_tier"`);
    await queryRunner.query(`DROP TYPE "order_state"`);
    await queryRunner.query(`DROP TYPE "ledger_kind"`);
  }
}
