import { useEffect, useState } from 'react';
import type { JSX } from 'react';

import type { OrderState } from '../api/types';
import { isTxHash } from '../lib/verdict';
import { ExplorerTxLink } from './ExplorerTxLink';

interface TxHashLinkProps {
  /**
   * `verdict.txHash` as the boundary normalised it: a non-empty string, or
   * `null` when the column held nothing. Never `''` — `normaliseVerdict`
   * collapses the empty string to `null`, so this component has two cases to
   * distinguish rather than three.
   */
  txHash: string | null;
  /**
   * The order's state, consulted only to choose between the two things a
   * missing hash can mean. See the comment on `MissingTx` below: without it,
   * both cases collapse into one sentence that is wrong half the time.
   */
  state: OrderState;
}

/** How long the copy acknowledgement stays up. Two seconds: long enough to read, short enough not to linger into the next click. */
const COPIED_MS = 2000;

/**
 * The settlement transaction, and the only claim on this page a sceptic can
 * check without believing a word of the rest of it.
 *
 * Everything else in the verdict card is this product describing its own
 * behaviour. The tier, the split, the reasoning, the citation checklist — all of
 * it is Guardian's account of what Guardian did, and a reader who has decided
 * not to trust us has no way to get behind any of it. The transaction hash is
 * different in kind. It is a pointer into a public ledger this product does not
 * own, cannot edit, and did not write the explorer for. Follow it and you watch
 * the money move. That single property is why this small line at the foot of the
 * card is worth more than every other element on it (US-3, FR-015).
 *
 * Which is also exactly why a link that fails when it is followed is worse than
 * no link at all. Every other element degrades in front of a general audience; a
 * broken explorer link degrades in front of the one person who cared enough to
 * check, at the moment they went to check, and it converts "here is the proof"
 * into "the proof 404s". So this component would rather print a string and say it
 * cannot vouch for it than emit an `href` it has not validated. Three rules fall
 * out of that. They used to be the whole component; see below for where they
 * live now:
 *
 * 1. **A link is emitted only for something hash-shaped** (`isTxHash`, FR-018,
 *    research R9). A malformed value renders as text, marked unrecognisable. A
 *    link built from a truncated or mangled hash looks every bit as authoritative
 *    as a real one and lands on an explorer's not-found page.
 * 2. **No hash, no control.** Not an empty link, not a placeholder hash, not a
 *    disabled button that looks like a link (FR-018). A dead control invites the
 *    click that produces the failure; a sentence does not.
 * 3. **The URL comes from `explorerTxUrl` and nowhere else** (FR-019). The host
 *    string does not appear in this file. `chain/chains.ts` says in its own
 *    comment that this feature is the drift it exists to prevent, and the only
 *    way to honour that is to never be the second place that knows the address.
 *
 * Two smaller decisions, both from FR-016 and FR-017. The displayed hash is
 * middle-truncated because 66 hex characters in the footer of a card is a wall,
 * but truncation is a display convenience and must never be the only copy — the
 * complete value stays in the `href`, in the `title`, and behind the copy
 * control, because someone checking this elsewhere needs to paste it, not
 * retype it from a projector. And the link opens in a new tab with
 * `rel="noopener noreferrer"`: mid-demo, navigating the order screen away from
 * the order is a hole the presenter has to climb back out of, and the explorer
 * has no business holding a handle on our window.
 *
 * The three rules above — link only what's hash-shaped, no dead control, the URL
 * from `explorerTxUrl` alone — no longer live in this file. They moved to
 * `ExplorerTxLink` (research R15) when the wallet page's withdrawal receipt
 * needed the same validated anchor, and re-typing them a second time here was
 * exactly the drift `chain/chains.ts` warns against. What stays here is
 * everything specific to this card: the two missing-hash sentences, which need
 * `state` and have no equivalent on a withdrawal receipt, and the copy button,
 * which exists because a sceptic checking this hash is doing so elsewhere —
 * a withdrawal receipt is a confirmation the person already believes.
 *
 * The one `useState` this feature is allowed lives here (data-model §5), for the
 * two-second "Copied" acknowledgement and nothing else.
 */
export function TxHashLink({ txHash, state }: TxHashLinkProps): JSX.Element {
  const [copied, setCopied] = useState(false);

  /*
   * Retract the acknowledgement on a timer, and cancel the timer if the card
   * unmounts or the reader copies again before it fires. A `setTimeout` whose
   * `clearTimeout` is missing is a stated concern in this codebase — the screen
   * this component sits on polls, re-renders, and can be navigated away from
   * mid-countdown, and a timer that survives that fires `setCopied` into a
   * component that is gone.
   *
   * Keyed on `copied` so that no timer exists at all until there is something
   * to retract. Copying again while the acknowledgement is still up sets a flag
   * that is already true and therefore does not extend it — two seconds from the
   * first copy, not from the last. That is the right behaviour anyway: the
   * message is a receipt for an action that already succeeded, not a hint that
   * needs to stay on screen.
   */
  useEffect(() => {
    if (!copied) {
      return;
    }
    const timer = window.setTimeout(() => {
      setCopied(false);
    }, COPIED_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [copied]);

  if (txHash === null) {
    return (
      <div className="tx-hash">
        <span className="tx-hash__label">Settlement transaction</span>
        {/*
         * The same absence, two different meanings, and saying the wrong one
         * costs trust in opposite directions. On `adjudicated` the ruling is
         * recorded but the chain call has not landed yet, so "nothing was
         * recorded" would read as a lost payout when the payout is simply in
         * flight. On `settled` the money has moved and the reference is missing
         * from our own record, and "still completing" would be a promise of a
         * link that is never going to arrive (FR-018, spec edge cases).
         */}
        {state === 'adjudicated' ? (
          <span className="tx-hash__pending">
            Settlement is completing. The transaction will appear here as soon as it is
            recorded — you do not need to refresh.
          </span>
        ) : (
          <span className="tx-hash__unavailable">
            No transaction reference was recorded for this settlement.
          </span>
        )}
      </div>
    );
  }

  const handleCopy = (): void => {
    const clipboard = navigator.clipboard;
    if (!clipboard) {
      // No Clipboard API (an insecure origin, an older browser). The full value
      // is still in the `title` and the `href`, so there is a route to it; there
      // is nothing to announce and nothing to throw about.
      return;
    }
    /*
     * The rejection path is a deliberate no-op. A denied permission or a
     * document that lost focus mid-click must not throw out of a render tree
     * that is currently displaying the conclusion of a dispute, and it must not
     * claim a copy that did not happen — an acknowledgement for an empty
     * clipboard sends a reader off to paste nothing. Silence leaves the reader
     * looking at a Copy button that visibly did not respond, which is the
     * honest signal.
     */
    void clipboard.writeText(txHash).then(
      () => {
        setCopied(true);
      },
      () => {
        /* leave the acknowledgement unchanged */
      },
    );
  };

  return (
    <div className="tx-hash">
      <span className="tx-hash__label">Settlement transaction</span>
      {/*
       * The validate-truncate-link-or-caveat core lives in `ExplorerTxLink`
       * now (research R15). `label` is left unset — its default of
       * "Transaction" reproduces this card's own `aria-label` exactly, and
       * naming that here a second time would be the re-typing the extraction
       * exists to avoid.
       */}
      <ExplorerTxLink hash={txHash} />
      {/*
       * The copy control belongs to a hash worth copying, which is why this is
       * gated rather than rendered alongside every present value. `isTxHash` is
       * consulted here for a second, different reason than `ExplorerTxLink`
       * consults it: there, it decides whether an `href` may be built at all;
       * here, it decides whether offering to put this string on someone's
       * clipboard is a service or a trap. A malformed reference is shown —
       * deleting the only trace of a settlement because it is ragged is the
       * wrong instinct on this card — but it is shown as evidence, not handed
       * over as something to paste into an explorer that will reject it.
       *
       * This is also parity with what UI-05 shipped: the malformed branch never
       * had a copy button, and the R15 extraction was meant to move the anchor,
       * not to change what the verdict card does.
       */}
      {isTxHash(txHash) ? (
        <>
          <button type="button" className="tx-hash__copy" onClick={handleCopy}>
            Copy full hash
          </button>
          {/*
           * Mounted unconditionally and filled on copy. A live region that appears
           * at the same moment its text does is frequently not announced at all;
           * one that is already in the tree announces the change. Empty the rest of
           * the time, so it says nothing when there is nothing to say.
           */}
          <span className="tx-hash__copied" role="status">
            {copied ? 'Copied' : ''}
          </span>
        </>
      ) : null}
    </div>
  );
}
