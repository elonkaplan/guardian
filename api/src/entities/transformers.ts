import { type ValueTransformer } from 'typeorm';

/**
 * Postgres `bigint` ⇄ JavaScript `number`.
 *
 * The `pg` driver returns `bigint` as a **string**, because a Postgres bigint
 * can exceed Number.MAX_SAFE_INTEGER. Left alone that means `price_minor` is
 * `"200"`, and `total + entry.amountMinor` quietly evaluates to `"2000200"` —
 * a money bug that type-checks and survives review.
 *
 * Converting to `number` is safe for this domain and the arithmetic is worth
 * the check: amounts are whole USD cents, and cents in a JS number are exact up
 * to 9,007,199,254,740,991 — about $90 trillion. `bigint` stays the storage
 * type because changing it later would mean migrating live data; the ceiling is
 * the database's, not JavaScript's.
 *
 * Applied to every `*_minor` money column and to the two on-chain id columns.
 */
export const bigintTransformer: ValueTransformer = {
  /** Entity → database. Postgres accepts a JS number for a bigint column. */
  to: (value: number | null | undefined): number | null =>
    value === null || value === undefined ? null : value,

  /** Database → entity. The driver hands us a string; parse it once, here. */
  from: (value: string | null): number | null =>
    value === null ? null : Number(value),
};
