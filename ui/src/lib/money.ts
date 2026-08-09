/**
 * Money is integer USD cents, everywhere in this app.
 *
 * $2.00 is 200 (database-schema §1.3). Token base units — USDC's six decimals —
 * exist only inside the API's chain adapter. If a factor of 10,000 ever appears
 * in frontend code, something has gone wrong upstream.
 *
 * No floating-point arithmetic on money. This module formats; it does not add.
 */

export type Cents = number;

const formatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatUsd(cents: Cents): string {
  if (!Number.isFinite(cents)) {
    return '—';
  }
  return formatter.format(cents / 100);
}

// $10,000.00. The treasury is a faucet-funded testnet wallet, not a bank account, and the
// likeliest money failure in a rehearsal is not a hostile input but a slipped finger — typing
// 100000 where 100.00 was meant. Refusing that here, before it reaches the network, turns a
// mid-demo backend error (whatever a failed ERC-20 transfer happens to say) into one clear
// sentence on the form. This is a display convenience, not a security control: the backend
// remains the authority on what the treasury can actually pay, and nothing about this constant
// should be read as a trust boundary.
export const TREASURY_CEILING_CENTS: Cents = 1_000_000;

export type ParseResult = { ok: true; cents: Cents } | { ok: false; message: string };

/**
 * Turns what a person typed into an amount field back into cents, or refuses.
 *
 * The module comment above rules out `parseFloat(x) * 100`: it works today — 19.99 becomes
 * 1999 — and it is one careless refactor away from `Math.round` quietly becoming `Math.floor`,
 * at which point the same input becomes 1998 and nobody notices until a statement is a cent
 * short. The only arithmetic that cannot round is the arithmetic that never produces a
 * fraction, so this function splits the string on its decimal point and builds cents from the
 * two integer parts directly: `19 * 100 + 99`. There is no float anywhere in this function, not
 * even transiently.
 *
 * That same discipline is why "1.999" is refused rather than accepted as 1.99 or rounded to
 * 2.00. Both of those are silent: the person typed one amount and the ledger would record a
 * different one, and a truncation the person did not ask for is exactly the failure mode this
 * module exists to rule out. Refusing is the only response that never invents a number nobody
 * typed, so anything with more than two decimal places is turned back with a sentence rather
 * than guessed at.
 *
 * This function must never throw, for any string thrown at it — it sits behind a form field a
 * person is actively typing into, and a half-finished "1." or a pasted "$1,234.50" are both
 * ordinary keystrokes, not exceptional input. Every rejection is an `{ ok: false, message }`
 * with a plain sentence, because that message is shown directly to whoever is looking at the
 * screen, not logged for someone who understands error codes.
 *
 * See specs/006-wallet-page/research.md R6 for the full rule table this was derived from.
 */
export function parseUsd(input: string): ParseResult {
  const trimmed = input.trim();
  if (trimmed === '') {
    return { ok: false, message: 'Enter an amount.' };
  }

  // A person pasting a formatted figure — the currency symbol, thousands commas — is not
  // making a mistake, so those are stripped before the shape of the number is judged at all.
  const stripped = trimmed.replace(/^\$/, '').replace(/,/g, '');

  // Digits, at most one decimal point, and nothing else. This alone rejects "abc", "1e3",
  // "1.2.3" and a leading "-" (negative amounts have no digits-only representation), while
  // still accepting a bare trailing point like "1." as ordinary mid-typing.
  if (!/^\d+(\.\d*)?$/.test(stripped)) {
    return { ok: false, message: 'Enter a plain dollar amount, like 12.50.' };
  }

  // The regex above guarantees at least one digit before any decimal point, so `wholePart` is
  // never actually empty; the `= ''` defaults exist only to satisfy `noUncheckedIndexedAccess`.
  const [wholePart = '', decimalPart = ''] = stripped.split('.');
  if (decimalPart.length > 2) {
    return { ok: false, message: 'Enter at most two decimal places.' };
  }

  const cents = Number.parseInt(wholePart, 10) * 100 + Number.parseInt(decimalPart.padEnd(2, '0'), 10);

  if (cents === 0) {
    return { ok: false, message: 'Enter an amount greater than zero.' };
  }

  if (cents > TREASURY_CEILING_CENTS) {
    return { ok: false, message: 'That is more than this demo\'s treasury holds.' };
  }

  return { ok: true, cents };
}

/**
 * Cents back into the plain text an amount field holds — `12.50`, not `$12.50`.
 *
 * This exists so that a form can be pre-filled with a figure the app already
 * knows, and its output is deliberately the *editable* representation rather
 * than the display one: no currency symbol and no thousands separators, because
 * the value goes straight into an input that a person may continue typing into.
 * `parseUsd` would accept the decorated form too, but round-tripping through
 * characters a person did not type is a small unkindness — put the cursor after
 * "100.00", not after "$1,00.00" with the separator in a place their next
 * keystroke has to work around.
 *
 * Integer arithmetic throughout, for the reason at the top of this module. The
 * division is exact: both operands are whole numbers and `Math.trunc` takes the
 * whole-dollar part without ever producing a fraction to round.
 */
export function toAmountInput(cents: Cents): string {
  if (!Number.isFinite(cents) || cents < 0) {
    return '';
  }
  const whole = Math.trunc(cents / 100);
  const remainder = cents % 100;
  return `${whole}.${String(remainder).padStart(2, '0')}`;
}
