import { UnitConversionError } from './errors';

/**
 * ⚠️ **THE ONLY PLACE IN THE BACKEND THAT KNOWS TOKEN BASE UNITS EXIST.**
 *
 * The rest of the platform speaks whole US cents and nothing else. This file
 * is the single boundary where cents become the settlement token's base units
 * and back. If the scale below ever appears in a second file, invariant #2 in
 * `docs/CONTEXT.md` has been broken and the whole containment argument goes
 * with it.
 *
 * **Where 10,000 comes from**: the scale is
 * `10^(tokenDecimals − centDecimals)` = `10^(6 − 2)` = 10,000. Both halves are
 * verified rather than assumed — the settlement token reports `decimals() = 6`
 * on Monad testnet (confirmed by a live read against the deployed escrow's
 * `token()`), and every money column in the database is `BIGINT` cents.
 *
 * Getting this wrong is a **factor-of-10,000 error in real money**, which is
 * exactly why it lives in one reviewable function rather than at twenty call
 * sites.
 *
 * **Why not viem's `parseUnits`/`formatUnits`**: they work in decimal
 * *strings*. Using them would mean cents → string → base units, reintroducing
 * a text representation of money in the middle of the one function that exists
 * to keep money exact. `bigint` arithmetic has no such step.
 */
export const CENTS_TO_BASE_SCALE = 10_000n;

/**
 * Whole US cents → token base units, for the chain.
 *
 * @throws {UnitConversionError} if `cents` is not a non-negative safe integer.
 */
export function toBaseUnits(cents: number): bigint {
  if (!Number.isInteger(cents)) {
    // A fractional value here means precision was already lost upstream —
    // something did `price / 100` and handed us dollars. Rejecting is the only
    // way that mistake is ever noticed.
    throw new UnitConversionError(
      `toBaseUnits expects whole cents, received ${cents}`,
      'toBaseUnits',
      cents,
    );
  }
  if (cents < 0) {
    // A sign error that survived would become a credit rather than a debit.
    throw new UnitConversionError(
      `toBaseUnits expects a non-negative amount, received ${cents}`,
      'toBaseUnits',
      cents,
    );
  }
  if (cents > Number.MAX_SAFE_INTEGER) {
    throw new UnitConversionError(
      `toBaseUnits received ${cents}, beyond the safe integer range`,
      'toBaseUnits',
      cents,
    );
  }

  return BigInt(cents) * CENTS_TO_BASE_SCALE;
}

/**
 * Token base units → whole US cents, for the platform.
 *
 * @throws {UnitConversionError} if `base` is negative, is not a whole number of
 * cents, or would exceed the safe integer range once converted.
 */
export function fromBaseUnits(base: bigint): number {
  if (base < 0n) {
    throw new UnitConversionError(
      `fromBaseUnits expects a non-negative amount, received ${base}`,
      'fromBaseUnits',
      base,
    );
  }
  if (base % CENTS_TO_BASE_SCALE !== 0n) {
    // ⚠️ THROW, NEVER ROUND.
    //
    // An amount that does not divide evenly into cents means value entered the
    // escrow through a path that bypassed this module — nothing we produce can
    // have a sub-cent remainder, because `toBaseUnits` only ever multiplies.
    // Rounding it away would destroy the single piece of evidence that such a
    // path exists, and would do so silently, in money.
    throw new UnitConversionError(
      `fromBaseUnits received ${base}, which is not a whole number of cents — ` +
        `an amount reached the escrow without passing through toBaseUnits`,
      'fromBaseUnits',
      base,
    );
  }

  const cents = base / CENTS_TO_BASE_SCALE;
  if (cents > BigInt(Number.MAX_SAFE_INTEGER)) {
    // Reachable if the configured token had more decimals than we believe, so
    // the message points at the likely cause rather than just the symptom.
    throw new UnitConversionError(
      `fromBaseUnits produced ${cents} cents, beyond the safe integer range — ` +
        `check that the settlement token really has 6 decimals`,
      'fromBaseUnits',
      base,
    );
  }

  return Number(cents);
}
