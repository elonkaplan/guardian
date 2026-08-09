import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { JSX } from 'react';
import { useEffect, useRef, useState } from 'react';

import { isConnectivityError } from '../api/errors';
import { acceptOrder, complainAboutOrder } from '../api/orders';
import type { Order, OrderState } from '../api/types';
import { ComplainDialog } from './ComplainDialog';

/**
 * The buyer's actions on a live order. Accept today; Complain joins it in this
 * same component, because "either action in flight disables both" has to be one
 * component's local truth rather than a flag threaded through two siblings
 * (contracts §6).
 *
 * Three things here are load-bearing and none of them are visual.
 *
 * **One request per intent.** The in-flight flag disables the action, and the
 * click handler is the only path to `mutate`. Nothing here navigates and nothing
 * writes the order into the cache by hand: the next poll is the authority on
 * what the order now is, and it is one second away.
 *
 * **A refusal and a silence are different failures.** A refusal means the
 * backend understood us and said no — so we show what it said, re-read the
 * order, and let the *new state* pick both the face and the words (research
 * R12). Silence means we never got an answer, so we do not know whether the
 * transition happened, and the only honest copy says exactly that.
 *
 * **On this page the poll is the recovery mechanism.** This is where the
 * component parts company with `BuyPanel`, and copying that panel's rule here
 * would be cargo-culting. `POST /orders` is dangerous on silence because it
 * debits a ledger with no screen following the outcome, so the buyer is sent to
 * their orders list and offered no retry at all. Accept and complain are state
 * transitions on an order this page is re-reading every second: if the call
 * landed, the state moves and the interface corrects itself with nobody
 * touching anything. So silence gets a wait-and-see notice rather than a dead
 * end — and still no retry button, because the poll already does the retrying
 * and a button invites a second click during the one second before the state
 * flips (research R11, and the scope note in `src/api/orders.ts`).
 */

/**
 * Silence. No "try again": see the third paragraph above — the poll is what
 * recovers this, and it is already running.
 */
const SILENCE_NOTICE =
  'We did not hear back, so we do not know whether this went through. This page updates every second — if it landed, it will show here in a moment.';

/**
 * US3 AS6, and the reason this is copy rather than an error: the buyer asked for
 * the money to go to the seller, and the money went to the seller. The request
 * failed; the intent did not.
 */
const ACCEPT_OUTCOME_NOTICE =
  'The window closed first, and the seller has been paid — the same result you were asking for.';

/**
 * US4 AS6. The complaint lost the race with the sweeper, which is a thing that can
 * genuinely happen at the end of a short demo window — so it is explained as what
 * happened rather than as a rejection, and it says plainly that there is nothing
 * further to do.
 */
const COMPLAIN_TOO_LATE_NOTICE =
  'The review window closed before this was filed, so the order released and the seller has been paid. A released order cannot be disputed.';

/**
 * The other way a complaint gets refused after the order moved: it already landed.
 * A second submission meeting an order that is already disputed is harmless — and
 * saying "already filed" is the truth, where showing the backend's refusal would
 * read as though the complaint had failed.
 */
const COMPLAIN_ALREADY_FILED_NOTICE =
  'This complaint has already been filed — Guardian has the case.';

type ActionKind = 'accept' | 'complain';

interface Notice {
  /** Picks the modifier class. An outcome is still styled as a refusal. */
  tone: 'refusal' | 'silence';
  /**
   * True when the refusal turned out to be the outcome the buyer wanted. The
   * reset effect below leaves this one alone; every other notice is cleared by
   * the state moving.
   */
  isOutcome: boolean;
  text: string;
}

/**
 * Derived, never stored. The notice is a function of the last error and the
 * order's *current* state, so a state change cannot leave stale words on screen
 * that contradict the face around them.
 *
 * How "the order moved on" is detected, kept as simple as the spec allows: the
 * state at the moment we asked is recorded in a ref, and compared against the
 * state on re-render. No error code is parsed — the backend has not committed to
 * any, and the order itself is the better source (research R12). Only `released`
 * earns the outcome wording; `settled` is arbitration's ending and may well have
 * refunded the buyer, so claiming the seller was paid there would be a guess.
 */
function noticeFor(
  error: Error | null,
  state: OrderState,
  askedFrom: OrderState | null,
  action: ActionKind,
): Notice | null {
  if (error === null) {
    return null;
  }

  if (isConnectivityError(error)) {
    return { tone: 'silence', isOutcome: false, text: SILENCE_NOTICE };
  }

  const movedOn = askedFrom !== null && state !== askedFrom;

  if (movedOn && action === 'accept' && state === 'released') {
    return { tone: 'refusal', isOutcome: true, text: ACCEPT_OUTCOME_NOTICE };
  }

  if (movedOn && action === 'complain' && state === 'released') {
    return { tone: 'refusal', isOutcome: true, text: COMPLAIN_TOO_LATE_NOTICE };
  }

  if (movedOn && action === 'complain' && (state === 'disputed' || state === 'adjudicated')) {
    return { tone: 'refusal', isOutcome: true, text: COMPLAIN_ALREADY_FILED_NOTICE };
  }

  return { tone: 'refusal', isOutcome: false, text: error.message };
}

export function OrderActions({ order }: { order: Order }): JSX.Element | null {
  const queryClient = useQueryClient();

  // The state the order was in when we submitted. This is the whole of the
  // "did it move under us?" test — see `noticeFor`.
  const askedFrom = useRef<OrderState | null>(null);

  /**
   * The re-entry guard, and it has to be a ref.
   *
   * `isPending` and the `disabled` attribute both come from state, and state does not
   * change until React re-renders — so several activations dispatched *within one
   * frame* all read the same stale `false` and every one of them fires. A double
   * click from a trackpad, or a held Enter key, is exactly that: the clicks arrive
   * before the render that would have disabled the button. Measured, not theorised —
   * five synchronous activations sent five requests before this existed.
   *
   * A ref is written synchronously, so the second activation in the same frame sees
   * the first. One ref for both actions, because FR-030 is "either action in flight
   * blocks both", not "each action blocks itself".
   */
  const inFlight = useRef(false);

  const [dialogOpen, setDialogOpen] = useState(false);

  const accept = useMutation({
    mutationFn: () => acceptOrder(order.id),
    // Settled, not success: a refusal is exactly the case where re-reading pays.
    // The refetched state picks the face and the words; nothing here decides
    // either from an error code, and nothing writes an optimistic order into the
    // cache (research R12).
    onSettled: () => {
      inFlight.current = false;
      void queryClient.invalidateQueries({ queryKey: ['order', order.id] });
    },
  });

  const complain = useMutation({
    mutationFn: (reason: string) => complainAboutOrder(order.id, reason),
    onSuccess: () => {
      // The complaint is in. Close the dialog and let the poll bring back the
      // disputed state — which it will do within a second, and which is what
      // moves the page to the arbitration face.
      setDialogOpen(false);
    },
    onError: (error) => {
      // A refusal keeps the dialog open, because the buyer's typed reason is in
      // it and they may want to read what went wrong beside their own words
      // (FR-032). Silence closes it: there is nothing to correct and nothing to
      // resubmit, and the wait-and-see notice belongs on the page where the
      // state it refers to is about to change.
      if (isConnectivityError(error)) {
        setDialogOpen(false);
      }
    },
    onSettled: () => {
      inFlight.current = false;
      void queryClient.invalidateQueries({ queryKey: ['order', order.id] });
    },
  });

  // Whichever action last failed owns the notice. They cannot both be in flight —
  // `busy` disables both — so there is never a genuine contest between two errors,
  // and preferring the accept error on the impossible tie costs nothing.
  const notice =
    noticeFor(accept.error, order.state, askedFrom.current, 'accept') ??
    noticeFor(complain.error, order.state, askedFrom.current, 'complain');

  // One flag, not `isPending` read at each button: both buttons disable together
  // while either action is in flight, which is FR-030 and the reason both
  // mutations live in this one component.
  const busy = accept.isPending || complain.isPending;

  // Nothing to accept unless the work has been delivered. Complaining is open on
  // both `delivered` and `failed` — non-delivery is explicitly in scope for
  // arbitration (product-workflow §4.3), and it is the one face where Complain is
  // the only thing on offer (FR-025). Derived from the order rather than passed
  // in, so the page does not have to know the rule twice.
  const canAccept = order.state === 'delivered';
  const canComplain = order.state === 'delivered' || order.state === 'failed';

  const isOutcome = notice !== null && notice.isOutcome;

  // A refusal, and only a refusal, is shown inside the dialog. Silence has already
  // closed it by the time this renders.
  const dialogError =
    complain.error !== null && !isConnectivityError(complain.error)
      ? complain.error.message
      : undefined;

  useEffect(() => {
    // The order's state changing *is* the answer to whatever we asked, so a
    // notice about a request that has since been overtaken must not outlive it:
    // resetting the mutation drops the error, and the notice is derived from it.
    //
    // The exception is the outcome notice, where the new state is precisely what
    // the notice is explaining. Clearing that one would blink "the seller has
    // been paid" off the screen in the frame it appeared.
    //
    // Keyed on the state alone on purpose: `reset` is stable and `isOutcome` is
    // read at the render that scheduled this, which is the render whose state
    // change we are reacting to.
    if (isOutcome) {
      return;
    }
    accept.reset();
    complain.reset();
  }, [order.state]);

  function handleAccept(): void {
    // See `inFlight` above: the ref is the guard that actually holds, because it is
    // written synchronously. `busy` is kept alongside it as the slower belt to the
    // ref's braces — it covers a re-render that has already landed.
    if (busy || inFlight.current) {
      return;
    }
    inFlight.current = true;
    askedFrom.current = order.state;
    accept.mutate();
  }

  function handleConfirmComplaint(reason: string): void {
    if (busy || inFlight.current) {
      return;
    }
    inFlight.current = true;
    askedFrom.current = order.state;
    complain.mutate(reason);
  }

  if (!canAccept && !canComplain && notice === null) {
    return null;
  }

  return (
    <section className="order-actions">
      <div className="order-actions__buttons">
        {canAccept ? (
          <button
            type="button"
            className="order-actions__accept"
            disabled={busy}
            onClick={handleAccept}
          >
            {accept.isPending ? 'Accepting…' : 'Accept and release payment'}
          </button>
        ) : null}

        {canComplain ? (
          <button
            type="button"
            className="order-actions__complain"
            disabled={busy}
            onClick={() => {
              setDialogOpen(true);
            }}
          >
            Complain
          </button>
        ) : null}
      </div>

      {notice !== null ? (
        <p
          className={`order-actions__notice order-actions__notice--${notice.tone}`}
          role="alert"
        >
          {notice.text}
        </p>
      ) : null}

      {/*
        Presentational, and deliberately so: it calls nothing, which is what lets it
        stay open showing a refusal with the buyer's typed reason still in the box.
        Cancelling also resets the mutation, so reopening does not greet the buyer
        with the error from an attempt they have already abandoned.
      */}
      <ComplainDialog
        open={dialogOpen}
        pending={complain.isPending}
        {...(dialogError !== undefined ? { error: dialogError } : {})}
        onConfirm={handleConfirmComplaint}
        onCancel={() => {
          if (complain.isPending) {
            return;
          }
          setDialogOpen(false);
          complain.reset();
        }}
      />
    </section>
  );
}
