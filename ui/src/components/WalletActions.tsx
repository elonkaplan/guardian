import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { FormEvent, JSX } from 'react';
import { useEffect, useRef, useState } from 'react';

import { isConnectivityError } from '../api/errors';
import type { AccountSummary } from '../api/types';
import { cashOut, topUp, withdraw } from '../api/wallet';
import { formatUsd, parseUsd, toAmountInput } from '../lib/money';
import { AmountField } from './AmountField';
import { ExplorerTxLink } from './ExplorerTxLink';

/**
 * The three ways money moves, and the only component in this feature that
 * writes anything.
 *
 * Four things here are load-bearing and none of them are visual.
 *
 * **Two exits, because there are two kinds of money.** Cash out returns unspent
 * platform balance to the treasury it was funded from; withdraw sends settled
 * on-chain funds to the address the person signed in with. One combined button
 * would either strand the unspent balance — money that can enter and never
 * leave, which is the first thing an observer probes — or imply the platform
 * can reach into funds it deliberately cannot touch. So each control names
 * which figure it moves and where that money goes (FR-024, FR-025).
 *
 * **One request per intent, guarded by a ref.** The guard cannot be `isPending`
 * or the `disabled` attribute, because both come from state and state does not
 * change until React re-renders — several activations dispatched within one
 * frame all read the same stale `false`. `OrderActions` measured that: five
 * synchronous clicks sent five requests before its ref existed. With money on
 * it the stakes are higher. And the ref is shared by all three actions rather
 * than one per control, which is stronger than FR-028 asks for: all three move
 * the same available balance, and two in flight at once produce two statement
 * entries whose order nobody can predict, on the one screen whose promise is
 * that the statement explains the balance.
 *
 * **A refusal and a silence are different failures, and the three actions do
 * not share a resolving signal.** `api/wallet.ts` sets this out in full. A
 * refusal means the backend understood us and did nothing: show what it said,
 * keep what was typed, let them fix it. Silence means we never got an answer,
 * so the control locks and the copy names the specific thing on this screen
 * that will settle the question — the statement for a top-up or a cash-out,
 * which write ledger entries, and the *settled figure falling* for a
 * withdrawal, which never writes one at all. Pointing someone at their
 * statement to confirm a withdrawal would be advice that can never come true.
 *
 * **An unknown settled balance disables withdrawal — and an unknown available
 * balance does not disable anything.** This is the one place the app blocks an
 * action on a figure it could not read, and it deliberately contradicts the
 * warning in `useAccountSummary`. The costs are asymmetric in the opposite
 * direction there: blocking a purchase blocks the demo, while blocking a
 * withdrawal blocks nothing — the money is on-chain, it is not going anywhere,
 * and the button returns on the next successful read five seconds later. More
 * to the point, the usual reason the settled figure could not be read is that
 * the RPC is unreachable, which is exactly when `withdrawFor` would fail too:
 * the choice is between a disabled button with a sentence, and a chain error
 * arriving on stage. Cash-out keeps the original rule and is refused locally
 * only when the amount exceeds a balance we actually have (research R10).
 */

/** Which action, if any, went silent. Its control stays locked until the signal below moves. */
interface Silence {
  action: 'topup' | 'cashout' | 'withdraw';
  /** The figures as they stood when we asked — the baseline the resolution is measured against. */
  availableAtAsk: number;
  settledAtAsk: number | null;
}

const SILENCE_LEDGER =
  'We did not hear back, so we do not know whether this went through. Do not try again — your balance and statement refresh every few seconds, and the movement will appear below if it landed.';

const SILENCE_WITHDRAW =
  'We did not hear back, so we do not know whether this went through. Do not try again — this will not appear in the statement, because withdrawals never do. Watch the settled funds figure above: it will fall on its own if the transfer landed.';

export function WalletActions({ account }: { account: AccountSummary }): JSX.Element {
  const queryClient = useQueryClient();

  /*
   * See the fourth paragraph above: written synchronously, so the second
   * activation in the same frame sees the first. One ref for all three actions.
   */
  const inFlight = useRef(false);

  const [topUpAmount, setTopUpAmount] = useState('');
  const [topUpError, setTopUpError] = useState<string | undefined>(undefined);

  const [cashOutAmount, setCashOutAmount] = useState(() =>
    account.availableBalanceMinor > 0 ? toAmountInput(account.availableBalanceMinor) : '',
  );
  const [cashOutError, setCashOutError] = useState<string | undefined>(undefined);

  const [silence, setSilence] = useState<Silence | null>(null);

  /*
   * Keep the cash-out field pre-filled with the whole balance, but only while
   * it is empty — this must never fight someone who is mid-keystroke.
   *
   * The mount initialiser covers the ordinary case, where the page loads with a
   * balance already in it. This covers the other one: a fresh account that
   * loads at zero and is then funded, where without it the person would have to
   * type a figure the screen is already displaying two inches above the field.
   * Cashing out the whole balance in one click is what exercises the funder
   * wallet's health check (rain-integration §0.3); making it a typing exercise
   * is how that step gets skipped in a rehearsal.
   *
   * `cashOutAmount` is read here but deliberately left out of the dependency
   * list: including it would run this on every keystroke, and the moment
   * someone cleared the field to retype it the balance would be pasted back
   * under their cursor. Keyed on the balance alone, the effect fires only when
   * the figure it copies has actually changed.
   */
  useEffect(() => {
    if (cashOutAmount === '' && account.availableBalanceMinor > 0) {
      setCashOutAmount(toAmountInput(account.availableBalanceMinor));
    }
  }, [account.availableBalanceMinor]);

  /*
   * Every action re-reads both keys on settled rather than success, following
   * `OrderActions`. Settled is the more useful of the two precisely in the
   * ambiguous case: after a failure with no answer, re-reading is how the page
   * finds out what happened, which is also what makes the wait-and-see copy
   * true rather than a hope.
   *
   * Both keys for all three actions, including withdrawal, which writes no
   * ledger entry. One extra read of a small list costs a request; a stale
   * statement sitting under a figure that has moved costs the screen's whole
   * argument.
   */
  const settle = (): void => {
    inFlight.current = false;
    void queryClient.invalidateQueries({ queryKey: ['me'] });
    void queryClient.invalidateQueries({ queryKey: ['ledger'] });
  };

  const noteSilence = (action: Silence['action'], error: Error): void => {
    if (isConnectivityError(error)) {
      setSilence({
        action,
        availableAtAsk: account.availableBalanceMinor,
        settledAtAsk: account.settledFundsMinor,
      });
    }
  };

  const topUpMutation = useMutation({
    mutationFn: (amountMinor: number) => topUp(amountMinor),
    onSuccess: () => {
      setTopUpAmount('');
    },
    onError: (error) => {
      noteSilence('topup', error);
    },
    onSettled: settle,
  });

  const cashOutMutation = useMutation({
    mutationFn: (amountMinor: number) => cashOut(amountMinor),
    onSuccess: () => {
      // Cleared rather than left holding the amount that just left. The effect
      // above refills it from whatever balance remains.
      setCashOutAmount('');
    },
    onError: (error) => {
      noteSilence('cashout', error);
    },
    onSettled: settle,
  });

  const withdrawMutation = useMutation({
    mutationFn: withdraw,
    onError: (error) => {
      noteSilence('withdraw', error);
    },
    onSettled: settle,
  });

  /*
   * Derived, never stored: a lock outlives its own reason otherwise.
   *
   * The signal is the figure the action would have moved. If it has changed
   * since we asked, the question the person was left with has been answered by
   * the data — the call landed — and the control comes back on its own. If a
   * purchase in another tab moves the balance first, the lock clears a little
   * early; the cost of that is a button becoming available again, which still
   * takes a deliberate click, and the alternative is a control that stays dead
   * until someone reloads the page mid-demo.
   */
  const silenceResolved =
    silence !== null &&
    (silence.action === 'withdraw'
      ? account.settledFundsMinor !== silence.settledAtAsk
      : account.availableBalanceMinor !== silence.availableAtAsk);

  const activeSilence = silenceResolved ? null : silence;

  const busy =
    topUpMutation.isPending || cashOutMutation.isPending || withdrawMutation.isPending;

  /** A refusal is the backend saying no. Silence is handled separately and never shown as one. */
  const refusalFor = (error: Error | null): string | undefined =>
    error !== null && !isConnectivityError(error) ? error.message : undefined;

  const settled = account.settledFundsMinor;
  const settledUnknown = settled === null;
  const canWithdraw = settled !== null && settled > 0;
  const canCashOut = account.availableBalanceMinor > 0;

  function handleTopUp(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (busy || inFlight.current || activeSilence?.action === 'topup') {
      return;
    }

    const parsed = parseUsd(topUpAmount);
    if (!parsed.ok) {
      setTopUpError(parsed.message);
      return;
    }

    setTopUpError(undefined);
    inFlight.current = true;
    topUpMutation.mutate(parsed.cents);
  }

  function handleCashOut(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (busy || inFlight.current || activeSilence?.action === 'cashout') {
      return;
    }

    const parsed = parseUsd(cashOutAmount);
    if (!parsed.ok) {
      setCashOutError(parsed.message);
      return;
    }

    /*
     * The one local refusal that is about the balance rather than the number.
     * Checked here, before anything leaves the browser, because the backend's
     * version of this answer arrives as whatever an insufficient-funds error
     * happens to say — and because a person who mistyped a digit should find
     * out from the field they typed it into (FR-027).
     */
    if (parsed.cents > account.availableBalanceMinor) {
      setCashOutError(
        `That is more than your available balance of ${formatUsd(account.availableBalanceMinor)}.`,
      );
      return;
    }

    setCashOutError(undefined);
    inFlight.current = true;
    cashOutMutation.mutate(parsed.cents);
  }

  function handleWithdraw(): void {
    if (busy || inFlight.current || !canWithdraw || activeSilence?.action === 'withdraw') {
      return;
    }
    inFlight.current = true;
    withdrawMutation.mutate();
  }

  const topUpRefusal = refusalFor(topUpMutation.error);
  const cashOutRefusal = refusalFor(cashOutMutation.error);
  const withdrawRefusal = refusalFor(withdrawMutation.error);
  const receipt = withdrawMutation.data;

  return (
    <div className="wallet-actions">
      {/* ---------------------------------------------------------------- Add funds */}
      <section className="wallet-action wallet-action--topup">
        <h2 className="wallet-action__heading">Add funds</h2>
        <p className="wallet-action__what">
          Money in. Lands in your available balance, ready to spend on an order.
        </p>

        <form className="wallet-action__form" onSubmit={handleTopUp} noValidate>
          <AmountField
            id="topup-amount"
            label="Amount to add"
            value={topUpAmount}
            {...(topUpError !== undefined ? { error: topUpError } : {})}
            disabled={topUpMutation.isPending}
            onChange={(value) => {
              setTopUpAmount(value);
              setTopUpError(undefined);
            }}
          />
          <button
            type="submit"
            className="wallet-action__submit"
            disabled={busy || activeSilence?.action === 'topup'}
          >
            {topUpMutation.isPending ? 'Adding…' : 'Add funds'}
          </button>
        </form>

        {/*
          FR-013, and the smallest requirement in the feature carrying the most
          weight. A judge watching $100 appear with no bank transfer behind it
          will wonder what just happened, and a question asked is far worse than
          a question answered. Stated as a disclosed limitation rather than a
          warning, because nothing here is broken — the rail genuinely does not
          exist yet (rain-integration §1.1).
        */}
        <p className="wallet-action__provenance">
          Funded from the demo treasury — Rain&rsquo;s onramp has no Monad rail yet.
        </p>

        {topUpRefusal !== undefined ? (
          <p className="wallet-action__refusal" role="alert">
            {topUpRefusal}
          </p>
        ) : null}

        {activeSilence?.action === 'topup' ? (
          <p className="wallet-action__silence" role="alert">
            {SILENCE_LEDGER}
          </p>
        ) : null}
      </section>

      {/* ---------------------------------------------------------------- Cash out */}
      <section className="wallet-action wallet-action--cashout">
        <h2 className="wallet-action__heading">Cash out</h2>
        <p className="wallet-action__what">
          Money out, from your <strong>available balance</strong> back to the demo treasury it
          was funded from. This is what Rain&rsquo;s offramp would do.
        </p>

        <form className="wallet-action__form" onSubmit={handleCashOut} noValidate>
          <AmountField
            id="cashout-amount"
            label="Amount to cash out"
            value={cashOutAmount}
            {...(cashOutError !== undefined ? { error: cashOutError } : {})}
            disabled={cashOutMutation.isPending || !canCashOut}
            onChange={(value) => {
              setCashOutAmount(value);
              setCashOutError(undefined);
            }}
          />
          <button
            type="submit"
            className="wallet-action__submit"
            disabled={busy || !canCashOut || activeSilence?.action === 'cashout'}
          >
            {cashOutMutation.isPending ? 'Cashing out…' : 'Cash out'}
          </button>
        </form>

        {/* An action that will certainly fail is not offered; it is explained (FR-027). */}
        {!canCashOut ? (
          <p className="wallet-action__unavailable">
            There is nothing to cash out — your available balance is {formatUsd(0)}.
          </p>
        ) : null}

        {cashOutRefusal !== undefined ? (
          <p className="wallet-action__refusal" role="alert">
            {cashOutRefusal}
          </p>
        ) : null}

        {activeSilence?.action === 'cashout' ? (
          <p className="wallet-action__silence" role="alert">
            {SILENCE_LEDGER}
          </p>
        ) : null}
      </section>

      {/* ---------------------------------------------------------------- Withdraw */}
      <section className="wallet-action wallet-action--withdraw">
        <h2 className="wallet-action__heading">Withdraw</h2>
        <p className="wallet-action__what">
          Money out, from your <strong>settled funds</strong> to the wallet address you signed
          in with. This money is already yours on-chain; we are only forwarding it, and you
          will not be asked to sign anything.
        </p>

        <button
          type="button"
          className="wallet-action__submit"
          disabled={busy || !canWithdraw || activeSilence?.action === 'withdraw'}
          onClick={handleWithdraw}
        >
          {withdrawMutation.isPending ? 'Withdrawing…' : 'Withdraw settled funds'}
        </button>

        {withdrawMutation.isPending ? (
          <p className="wallet-action__pending" role="status">
            This one moves on-chain, so it may take a moment. The settled funds figure above
            will fall when it lands.
          </p>
        ) : null}

        {/*
          Two reasons a withdrawal is unavailable, and they must not share a
          sentence. Zero is a fact about the account. Unknown is a fact about our
          reading of the chain, and saying "nothing to withdraw" there would tell
          a seller they earned nothing when in truth nobody could look (R10).
        */}
        {!canWithdraw && !busy ? (
          <p className="wallet-action__unavailable">
            {settledUnknown
              ? 'Your settled funds could not be read just now, so this is unavailable. Nothing is wrong with your money — it is on-chain and untouched. This will come back on its own within a few seconds.'
              : 'There is nothing settled to withdraw yet. Money arrives here when an order you sold completes, or when a dispute is decided in your favour.'}
          </p>
        ) : null}

        {receipt !== undefined && receipt.txHash !== null ? (
          <div className="wallet-action__receipt tx-hash">
            <span className="tx-hash__label">Withdrawal transaction</span>
            <ExplorerTxLink hash={receipt.txHash} label="Withdrawal" />
          </div>
        ) : null}

        {receipt !== undefined && receipt.txHash === null ? (
          <p className="wallet-action__receipt" role="status">
            Withdrawal sent. No transaction reference came back with it, so there is nothing to
            link — the settled funds figure above is the confirmation.
          </p>
        ) : null}

        {withdrawRefusal !== undefined ? (
          <p className="wallet-action__refusal" role="alert">
            {withdrawRefusal}
          </p>
        ) : null}

        {activeSilence?.action === 'withdraw' ? (
          <p className="wallet-action__silence" role="alert">
            {SILENCE_WITHDRAW}
          </p>
        ) : null}
      </section>
    </div>
  );
}
