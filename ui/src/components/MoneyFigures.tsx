import type { JSX } from 'react';

import type { AccountSummary } from '../api/types';
import { formatUsd } from '../lib/money';

interface MoneyFiguresProps {
  account: AccountSummary;
  /** True when the last refresh failed but these figures are still the last good read. */
  stale: boolean;
}

/**
 * Three money figures, laid out side by side, and never one.
 *
 * This is FR-001 and FR-002 in component form, and FR-002 is the reason this
 * file exists at all: no expression anywhere below adds two of these figures
 * together, and no combined total is ever rendered, in any state, for any
 * account. That single rule is worth spelling out because collapsing these
 * three numbers into one balance is wrong in three directions at once, not
 * one. It overstates what a buyer can actually spend, because escrowed money
 * is included in the sum but cannot be spent. It implies escrowed money could
 * be withdrawn on request, because a bigger number reads as more liquid than
 * it is. And it makes the statement — which explains only the available
 * balance — look like it has quietly lost track of money, because a reader
 * comparing the statement against a combined total will find a gap the
 * statement can never close: settlement happens on-chain and produces no
 * ledger entry, so no combined figure will ever be traceable to the rows
 * beneath it. Three separately labelled figures are not a stylistic choice
 * here; they are the only presentation that does not lie in one of those
 * three ways.
 *
 * Each figure gets a plain sentence saying where that money currently is and
 * how it leaves (FR-003), because the three exits are genuinely different
 * doors and a reader should not need to know the platform's internals to
 * find the right one. Available balance is spendable right now and leaves by
 * cashing out to the treasury it came from. Escrow is committed to orders
 * that have not concluded — it is neither spendable nor withdrawable, it is
 * simply waiting for an order to finish. Settled funds have already been
 * paid out on-chain to the signed-in address itself, outside the platform's
 * reach, and leave only by a withdrawal to that same address.
 *
 * The settled figure carries a third state the other two do not (FR-005,
 * FR-008, data-model.md §3 and §6). Available and escrow are always a
 * number, so `0` is simply zero. Settled funds are read from the chain on
 * the backend, and that read can fail on its own while the platform's own
 * two figures stay perfectly good — so `settledFundsMinor` is `null` when
 * nobody could look, `0` when the look succeeded and found nothing, and a
 * positive amount otherwise. `null` renders as an em dash with a short note,
 * never as `$0.00`, and nothing in this file writes `settledFundsMinor ?? 0`
 * or compares it with `>`/`<` without checking for `null` first. The reason
 * is not pedantry: "we could not read it" and "you have none" are different
 * facts about the world, and showing the second when the first is true tells
 * a seller who was actually paid that they earned nothing, when in truth
 * nobody looked.
 *
 * Zero is always shown as `$0.00` on the two figures that can be a plain
 * zero (FR-005) — never blank, never a hidden section — because an account
 * that has never funded anything is not a broken account, and the screen
 * should say so as plainly as an account with money in it. When `stale` is
 * true the last known amounts stay exactly where they are, with a note that
 * they are not fresh; a stale reading is still the most recent truth this
 * screen has, and blanking it or dropping it to zero would show a wrong
 * number instead of an old one (FR-007).
 *
 * This card is read from the back of a demo room and has to survive a
 * greyscale screenshot, so the stale marker and the unknown-settled marker
 * are both stated in words, not left to colour or a modifier class alone.
 */
export function MoneyFigures({ account, stale }: MoneyFiguresProps): JSX.Element {
  return (
    <section
      className={`money-figures${stale ? ' money-figures--stale' : ''}`}
      aria-label="Your money"
    >
      {stale && (
        <p className="money-figures__stale-note">
          Showing the last known amounts. The most recent refresh failed, so these figures
          may be out of date.
        </p>
      )}

      <div className="money-figures__figure">
        <span className="money-figures__label">Available</span>
        <span className="money-figures__amount">{formatUsd(account.availableBalanceMinor)}</span>
        <p className="money-figures__note">
          Spendable now. It leaves by cashing out back to the treasury it was funded from.
        </p>
      </div>

      <div className="money-figures__figure">
        <span className="money-figures__label">In escrow</span>
        <span className="money-figures__amount">{formatUsd(account.inEscrowMinor)}</span>
        <p className="money-figures__note">
          Committed to orders that have not concluded. It cannot be spent or withdrawn — it
          is simply waiting for those orders to finish.
        </p>
      </div>

      <div className="money-figures__figure">
        <span className="money-figures__label">Settled</span>
        {account.settledFundsMinor === null ? (
          <>
            <span className="money-figures__amount money-figures__amount--unknown">—</span>
            <p className="money-figures__note">
              Could not be read just now. This is unknown, not zero — try again shortly.
            </p>
          </>
        ) : (
          <>
            {/* Branching on the value itself, so the narrowing is the
                compiler's rather than a promise in a comment: there is no cast
                here and no way to reach `formatUsd` with a `null`. Zero needs
                no branch of its own — `formatUsd(0)` is "$0.00", which is
                exactly what an account with nothing settled should read. */}
            <span className="money-figures__amount">
              {formatUsd(account.settledFundsMinor)}
            </span>
            <p className="money-figures__note">
              Already paid out on-chain to your own address. It leaves by withdrawing to
              that same address.
            </p>
          </>
        )}
      </div>
    </section>
  );
}

