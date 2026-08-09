import { z } from 'zod';

/**
 * The one schema every money amount arriving over HTTP is validated against:
 * a positive, whole, safe-integer number of **US cents**.
 *
 * **This is a boundary guard in FRONT of `units.ts`, not a replacement for
 * it.** `toBaseUnits` already rejects a non-integer, a negative, and anything
 * past `Number.MAX_SAFE_INTEGER` — those three guards stay exactly where they
 * are, because they are the backstop that catches a bad amount arriving from
 * somewhere that is not an HTTP body. But by the time an amount reaches
 * `toBaseUnits` it has travelled through a controller, a session lookup, an
 * account read, a chain pre-read, and — on the cash-out path — possibly a
 * ledger write. A `UnitConversionError` thrown there is a 500-shaped failure
 * deep inside `chain/`, raised after work was already done, and it names no
 * field. Parsing here turns the same three cases into a `400` carrying
 * `{ fieldErrors: { amountMinor: [...] } }` before the handler is entered,
 * before any row is read and before any row is written.
 *
 * That is the identical argument `zod-validation.pipe.ts` makes for validating
 * pre-handler rather than inside it ("no challenge row written, no nonce
 * minted") — applied to money instead of to addresses. (research R14)
 *
 * **`.positive()`, not `.nonnegative()`.** Zero is not a harmless no-op on
 * either route it guards. A zero top-up broadcasts an ERC-20 transfer of
 * nothing and pays the full gas ceiling to do it — on Monad the limit is
 * charged whether or not the call moves anything. A zero cash-out takes a row
 * lock, sums the ledger, and appends a `0` entry that means nothing and that
 * the ledger can never remove, because it is append-only (invariant #4). Both
 * are the caller having made a mistake, so both are a `400`.
 *
 * **Three callers, not two.** `POST /topup` and `POST /offramp` were the
 * original pair; `priceMinor` on the catalogue's two write bodies —
 * `POST /agents` and `POST /agents/:id/versions` — is the third. The same
 * three clauses carry over unchanged: a zero-price agent would open deals that
 * escrow nothing, and a fractional price is a seller who typed dollars. The
 * database agrees independently via `CHECK (price_minor > 0)`; this is the
 * layer that turns that constraint into a `400` naming the field instead of a
 * `500` from inside TypeORM.
 *
 * **No minimum and no maximum beyond the safe-integer bound.** The real
 * ceiling on a top-up is what the funder wallet actually holds, on a
 * cash-out what the account's ledger sums to, and on a listing nothing at all —
 * what a seller may charge is their business (`006` R15). The first two are
 * checked against live state (R15, R8), not guessed at here. A hardcoded cap
 * would be a number invented at rehearsal scale, and the thing about an
 * invented cap is that it gets hit on stage. `Number.MAX_SAFE_INTEGER` is not that kind of limit: past it,
 * JavaScript silently stops being able to represent the integer at all, so the
 * bound is about arithmetic being true rather than about policy.
 *
 * ⚠️ Cents, never dollars. Everything outside `src/chain/units.ts` speaks
 * whole US cents (invariant #2), so `12.34` is not "twelve dollars thirty-four"
 * here — it is a non-integer and it is refused. A caller sending dollars has a
 * bug that `.int()` is the last place to catch cheaply.
 */
export const amountMinorSchema = z
  .number()
  .int()
  .positive()
  .max(Number.MAX_SAFE_INTEGER);
