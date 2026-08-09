/**
 * Whole US cents → the dollar string a person reads: `1234` → `"$12.34"`.
 *
 * **For messages, never for arithmetic.** This is the only direction that
 * exists in this file, deliberately — there is no `parseDollars`, because a
 * dollar string entering the system is precision already lost, and the one
 * place allowed to change money's units is `src/chain/units.ts` (invariant #2).
 * What this produces is display text on its way out of the process, and
 * nothing downstream should ever parse it back.
 *
 * **Why it exists at all.** Every refusal this feature can produce is shown
 * verbatim to a person mid-demo — `ui/specs/006-wallet-page/` handoff item 8
 * makes the wording the backend's responsibility, and contracts §7 fixes the
 * format: amounts in messages are dollars, not raw cents. "Available balance
 * is 10000, cannot cash out 12345" is a sentence that invites exactly the
 * wrong reading, out loud, on stage, in front of the people the number is
 * being explained to. `"Available balance is $100.00, cannot cash out
 * $123.45"` cannot be misread.
 *
 * **Negatives are formatted `-$12.34`, with the sign outside the symbol.** A
 * negative is not supposed to reach a refusal message — the balance in an
 * overdraw refusal is by definition the smaller figure, and it is normally
 * ≥ 0 — but `BalanceRepository` explicitly reports rather than judges, and a
 * hand-written `adjustment` can genuinely drive an account below zero. Given
 * that, `$-12.34` (what naive concatenation produces) is the wrong output:
 * it reads as a typo, which invites the reader to discount it, when a negative
 * balance is precisely the thing they should not discount.
 *
 * **No thousands separators and no `toLocaleString`.** The output must be the
 * same string on a developer's laptop and in a container whose `LANG` is unset,
 * because these strings appear in assertions in quickstart §5 and in logs that
 * get diffed. A locale-aware formatter would render `1 234,56 €`-shaped output
 * under the wrong environment and the failure would look like a logic bug.
 *
 * Implementation note: the split is done on the absolute value with integer
 * arithmetic rather than by dividing by 100, because `-1 / 100` truncates
 * toward zero in JavaScript and `%` keeps the sign of the dividend — handling
 * the sign once, up front, removes both traps instead of working around them.
 */
export function formatCents(cents: number): string {
  const negative = cents < 0;
  const magnitude = Math.abs(cents);

  const dollars = Math.floor(magnitude / 100);
  // padStart, not a manual `< 10 ? '0' + n : n` — 5 cents is "$0.05", and the
  // missing zero is the classic off-by-a-factor-of-ten in a money string.
  const remainder = String(magnitude % 100).padStart(2, '0');

  return `${negative ? '-' : ''}$${dollars}.${remainder}`;
}
