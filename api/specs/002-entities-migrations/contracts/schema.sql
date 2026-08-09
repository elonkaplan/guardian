-- =============================================================================
-- Guardian — initial schema. THE CONTRACT.
--
-- This file is what the migration must produce, exactly. It is transcribed from
-- docs/database-schema.md §8 with two deliberate changes, both recorded in
-- research.md:
--
--   1. CREATE EXTENSION pgcrypto is DROPPED. gen_random_uuid() has been core
--      since Postgres 13; verified against this project's Postgres 16 with only
--      plpgsql installed. An extension nobody needs is a permission requirement
--      for nothing.
--   2. Nothing else. Every table, column, type, default, constraint and index
--      below matches the source DDL.
--
-- Read the ordering as a dependency graph: enums, then accounts, then everything
-- that references accounts. ledger_entries is last because it references BOTH
-- accounts and orders.
-- =============================================================================

-- --------------------------------------------------------------- enum types
-- Value order is significant: Postgres sorts enums by declaration order, so
-- reordering these silently changes the meaning of ORDER BY.

-- 'settlement' is deliberately ABSENT. Settled funds land on-chain under the
-- user's own address and cannot be recaptured, so settlement writes no ledger
-- entry at all (CONTEXT.md invariant #5).
CREATE TYPE ledger_kind  AS ENUM ('onramp','purchase','offramp','adjustment');

-- The product state machine, which is finer than the contract's.
CREATE TYPE order_state  AS ENUM ('purchased','running','delivered','failed','released','disputed','adjudicated','settled');

CREATE TYPE verdict_tier AS ENUM ('none','quarter','half','three_quarter','full');

-- ----------------------------------------------------------------- accounts
CREATE TABLE accounts (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_address text        NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- Identity must not vary with casing, but the stored casing is the checksummed
-- address and is also the payout destination — so the index is functional and
-- the column is left alone. There is deliberately NO plain UNIQUE here; a plain
-- one would be case-sensitive and would let 0xAbC and 0xabc both register.
CREATE UNIQUE INDEX accounts_wallet_lower_idx ON accounts (lower(wallet_address));

-- ------------------------------------------------------------------- agents
CREATE TABLE agents (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_account_id uuid        NOT NULL REFERENCES accounts(id),
  -- NULL until registerAgent confirms. NULL means "submitted, not yet
  -- confirmed" — an honest state, and it makes the retry query trivial.
  onchain_agent_id bigint      UNIQUE,
  active           bool        NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX agents_owner_idx ON agents (owner_account_id);

-- ----------------------------------------------------------- agent_versions
-- One row per definition edit. Rows are IMMUTABLE once written — nothing a
-- buyer was shown may change without producing a new version.
CREATE TABLE agent_versions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id        uuid        NOT NULL REFERENCES agents(id),
  version         int         NOT NULL,
  name            text        NOT NULL,
  description     text        NOT NULL,
  capabilities    text[]      NOT NULL,   -- half of Guardian's yardstick
  exclusions      text[]      NOT NULL,   -- the other, defensive half
  price_minor     bigint      NOT NULL CHECK (price_minor > 0),
  input_schema    jsonb       NOT NULL,
  output_schema   jsonb       NOT NULL,   -- the load-bearing one
  system_prompt   text        NOT NULL,   -- ⚠ SELLER IP: never serialise to a buyer
  model           text        NOT NULL,
  timeout_seconds int         NOT NULL DEFAULT 120,
  definition_hash bytea       NOT NULL,   -- keccak256 of the canonical definition
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (agent_id, version)
);

-- ------------------------------------------------------------------- orders
CREATE TABLE orders (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  onchain_deal_id       bigint      UNIQUE,
  buyer_account_id      uuid        NOT NULL REFERENCES accounts(id),
  -- PINNED to the version, never to the agent. This is what makes "judged
  -- against the definition that actually ran" true by construction.
  agent_version_id      uuid        NOT NULL REFERENCES agent_versions(id),
  price_minor           bigint      NOT NULL CHECK (price_minor > 0),
  acceptance_criteria   text        NOT NULL,
  state                 order_state NOT NULL DEFAULT 'purchased',
  -- Never 0: a zero window collapses the dispute window entirely.
  review_window_seconds int         NOT NULL CHECK (review_window_seconds > 0),
  created_at            timestamptz NOT NULL DEFAULT now(),
  delivered_at          timestamptz,
  disputed_at           timestamptz,
  settled_at            timestamptz
);

-- The sweeper's query. Re-run every few seconds for the whole demo; this index
-- earns its keep more than any other in the schema.
CREATE INDEX orders_sweeper_idx     ON orders (state, delivered_at);
CREATE INDEX orders_undelivered_idx ON orders (state, created_at);
CREATE INDEX orders_buyer_idx       ON orders (buyer_account_id, created_at DESC);

-- --------------------------------------------------------------------- runs
CREATE TABLE runs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- UNIQUE: exactly one execution per purchase. A crashed run stays as the row
  -- with output IS NULL, which IS the non-delivery evidence — re-running would
  -- destroy it, so the database refuses.
  order_id     uuid        NOT NULL UNIQUE REFERENCES orders(id),
  input        jsonb       NOT NULL,
  output       jsonb,                                  -- NULL is evidence, not an error
  steps        jsonb       NOT NULL DEFAULT '[]'::jsonb,
  error        text,
  output_valid bool,                                   -- NULL = not yet checked
  started_at   timestamptz NOT NULL DEFAULT now(),
  finished_at  timestamptz,
  duration_ms  int
);

-- --------------------------------------------------------------- complaints
CREATE TABLE complaints (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- UNIQUE: one complaint per order. No amendments, no re-filing — a database
  -- guarantee rather than an API check someone forgets.
  order_id   uuid        NOT NULL UNIQUE REFERENCES orders(id),
  reason     text        NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------- verdicts
CREATE TABLE verdicts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- UNIQUE: one verdict per order — there are no appeals. This is also what
  -- makes the demo replayable: a re-run shows the stored verdict rather than
  -- re-auditing, which removes live-model variance from the stage.
  order_id        uuid         NOT NULL UNIQUE REFERENCES orders(id),
  tier            verdict_tier NOT NULL,
  refund_minor    bigint       NOT NULL CHECK (refund_minor >= 0),
  reasoning       text         NOT NULL,
  citations       jsonb        NOT NULL DEFAULT '[]'::jsonb,
  verdict_hash    bytea        NOT NULL,   -- anchored on-chain in resolve()
  model           text         NOT NULL,   -- for reproducibility
  onchain_tx_hash text,                    -- the demo's clickable proof
  created_at      timestamptz  NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------- ledger_entries
-- APPEND-ONLY. A balance is SUM(amount_minor). There is no cached balance
-- column on this or any other table, by design.
CREATE TABLE ledger_entries (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id   uuid        NOT NULL REFERENCES accounts(id),
  amount_minor bigint      NOT NULL,   -- SIGNED: credits positive, debits negative
  kind         ledger_kind NOT NULL,
  order_id     uuid        REFERENCES orders(id),   -- set on 'purchase'
  external_ref text,                                -- Rain transfer id, or a tx hash
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ledger_account_idx ON ledger_entries (account_id, created_at);

-- =============================================================================
-- Inventory — VERIFIED by executing this file against Postgres 16 and reading
-- the catalog back. The migration must reproduce these numbers exactly.
--
--   8   tables
--   3   enum types
--   4   CHECK constraints
--         agent_versions (price_minor > 0)
--         orders         (price_minor > 0)
--         orders         (review_window_seconds > 0)
--         verdicts       (refund_minor >= 0)
--   20  indexes total, made up of:
--         8  primary keys
--         6  explicit named indexes (*_idx)
--         6  unique constraints
--
--   The 6 uniqueness rules that carry product meaning:
--         accounts_wallet_lower_idx            (functional, case-insensitive)
--         complaints_order_id_key              one complaint per order
--         verdicts_order_id_key                one verdict per order — no appeals
--         runs_order_id_key                    one execution per purchase
--         agent_versions_agent_id_version_key  version unique within an agent
--         agents_onchain_agent_id_key  +  orders_onchain_deal_id_key
--                                              one row per on-chain object
-- =============================================================================
