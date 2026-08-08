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
