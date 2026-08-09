/**
 * `GET /me` response — the account and the money model behind it.
 *
 * ⚠️ **Every field name here is literal and load-bearing.**
 * `ui/specs/006-wallet-page/data-model.md` already declares the consuming type
 * with exactly these strings. A renamed or omitted field does not throw
 * anywhere: it renders as an absent value on the wallet page, which is the same
 * class of bug as commit `67dcf4d`, where `RawCitation.clause` shipped wrong
 * with a perfectly good rule attached because nobody wrote `quote` at the place
 * an implementer would type it. Copy from
 * `specs/005-accounts-ledger-funding/contracts/internal-api.md` §1 rather than
 * retyping from memory.
 *
 * **Three figures, never fewer, and never a combined one.** Money lives in four
 * places (`docs/database-schema.md` §3.3): the platform ledger, the escrow
 * contract, the user's settled on-chain balance, and — once withdrawn — their
 * own wallet, which the platform deliberately stops tracking. A single
 * `balance` field would be wrong in three of them. The consequence that reads
 * like a bug and is not: a refund moves money from escrow to settled, so
 * `availableBalanceMinor` does not change at all.
 *
 * (research R2, R13)
 */
export interface AccountSummaryResponse {
  /** uuid. */
  accountId: string;

  /**
   * EIP-55 checksummed, exactly as stored. `AccountRepository` guarantees the
   * column is `getAddress()` output, and this is the payout destination for
   * every refund and sale — it must not be lower-cased on the way out.
   */
  address: string;

  /** Cents. `SUM(ledger_entries.amount_minor)`. Never null. */
  availableBalanceMinor: number;

  /** Cents. Sum of open orders' `price_minor` (research R3). Never null. */
  inEscrowMinor: number;

  /**
   * Cents currently withdrawable from the escrow contract, or `null` when the
   * chain could not be read inside the budget.
   *
   * ⚠️ `number | null`, and **not optional**. The `?` form is the bug, not a
   * tidier spelling of the same thing: `JSON.stringify` DROPS keys whose value
   * is `undefined`, so a handler returning `{ settledFundsMinor: undefined }`
   * sends a body with no such key — a different wire contract from the one the
   * UI was built against, and one TypeScript cannot warn about while the
   * property is optional. The key must always be present, carrying an explicit
   * `null`.
   *
   * ⚠️ **`null` ≠ `0`.** `null` means COULD NOT BE READ; `0` means the chain
   * was read successfully and this account has nothing settled. The UI renders
   * `—` for the first and `$0.00` for the second, and disables Withdraw for
   * both with different wording. `ui/specs/006-wallet-page/research.md` R2
   * rejected the optional form deliberately, on the grounds that *"optionality
   * invites `?? 0` and reads as 'sometimes we don't bother', when the truth is
   * 'sometimes it cannot be known'"* — and `?? 0` here tells a user with
   * unreadable settled funds that they have none.
   */
  settledFundsMinor: number | null;
}
