import { useEffect, useRef, useState } from 'react';

interface ComplainDialogProps {
  /** Whether the modal should be showing. The parent owns this; the dialog element follows it. */
  open: boolean;
  /** True while a complaint is in flight. Freezes the whole dialog — see FR-030. */
  pending: boolean;
  /** A refusal from the backend, in the words the caller chose to show the buyer (FR-032). */
  error?: string;
  /** The buyer confirmed. The trimmed reason is handed over; the caller does the request. */
  onConfirm(reason: string): void;
  /** The buyer backed out — Cancel, Esc, or the backdrop. Nothing is submitted (FR-028). */
  onCancel(): void;
}

/** Soft guide, not a limit. The backend decides what it will accept (data-model §6). */
const MAX_REASON = 2000;

const titleId = 'complain-dialog-title';
const finalityId = 'complain-dialog-finality';
const counterId = 'complain-dialog-counter';
const errorId = 'complain-dialog-error';
const fieldId = 'complain-dialog-reason';

/**
 * The confirmation in front of the only irreversible thing on the order page.
 *
 * **Why a native `<dialog>`.** `showModal()` gives focus trapping, Esc, inertness of
 * the page behind, top-layer stacking above every `z-index` on the route, and a
 * real `::backdrop` — all of it correct, all of it free. The alternative is a `div`
 * with a hundred lines of focus management that will be subtly worse (a tab cycle
 * that leaks, a countdown underneath that stays reachable by keyboard), or a modal
 * dependency, which R17 rules out. The element is baseline in every browser this
 * demo runs on, so the trade has no downside to weigh.
 *
 * **Why not `window.confirm()`.** Two reasons, both disqualifying. It cannot carry
 * the finality copy FR-027 requires — no reason field, no paragraph, no error line,
 * only a string and two buttons the browser names. And blocking dialogs are banned
 * in this environment: `confirm()` halts the event loop, which would stall the 1s
 * poll that this whole page's correctness rests on, and freeze a countdown that is
 * meanwhile still running on the backend.
 *
 * **Why this component calls no API.** It is presentational on purpose. The
 * mutation lives in `OrderActions` (T029), and that separation is exactly what
 * lets the dialog stay open after a refusal, still showing the buyer's typed
 * reason, while the page re-reads the order underneath (FR-032, scenarios 6 and 7).
 * A dialog that owned its own request would have to decide when to close, and the
 * honest answer — "when the backend says the complaint was filed" — is knowledge
 * this component does not have.
 *
 * **Where the reason lives.** Here, in local state, reset when `open` transitions
 * false → true. That rule is the simple one that is also correct: the text must
 * survive a failed submit (so it cannot be cleared on error, and the field cannot
 * be unmounted between attempts), and it must not haunt the next complaint on
 * another order (so it cannot simply persist). Keying off the opening edge covers
 * both without the parent having to remember to clear anything, and it means a
 * success and a cancellation need no different handling — both close the dialog,
 * and whatever happens next starts from empty. Nothing is written to storage: a
 * reason typed but never confirmed was not filed (data-model §5).
 *
 * **The tone of the copy.** Filing really is final — no appeals in the MVP
 * (product-workflow §4.4) — and a complaint about sound work really does end in a
 * 0% verdict with the seller paid in full (§4.6). Both are said plainly, and
 * neither is dressed up. The buyer facing this box may well have a genuine
 * grievance, and arbitration is free; frightening them out of it would be a worse
 * failure than a frivolous complaint, which Guardian is built to rule against.
 */
export function ComplainDialog({ open, pending, error, onConfirm, onCancel }: ComplainDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [reason, setReason] = useState('');

  /**
   * Marks a `close()` we asked for, so the resulting `close` event is not mistaken
   * for the buyer dismissing the dialog and bounced back to the parent as a cancel.
   */
  const closingOurselves = useRef(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) return;

    if (open) {
      if (!dialog.open) dialog.showModal();
      // Wipe the previous attempt on the opening edge, not on close: the text has
      // to be here through every failed submit in between.
      setReason('');
      return;
    }

    if (dialog.open) {
      closingOurselves.current = true;
      dialog.close();
    }
  }, [open]);

  const trimmed = reason.trim();
  const canConfirm = trimmed.length > 0 && !pending;

  function handleConfirm() {
    // Belt and braces against a double fire — a second click landing before React
    // has re-rendered the disabled state, or an Enter held down on the button.
    if (!canConfirm) return;
    onConfirm(trimmed);
  }

  const remaining = MAX_REASON - reason.length;

  return (
    <dialog
      ref={dialogRef}
      className="complain-dialog"
      aria-labelledby={titleId}
      aria-describedby={finalityId}
      // Esc. The browser would close the element itself; we stop it and report the
      // intent instead, so `open` stays the single source of truth for whether this
      // dialog is showing. While a complaint is in flight there is nothing to back
      // out of, so Esc is simply swallowed.
      onCancel={(event) => {
        event.preventDefault();
        if (!pending) onCancel();
      }}
      // A safety net rather than a path we expect: with `cancel` prevented, the only
      // `close` should be ours. If one arrives anyway while the parent still thinks
      // the dialog is open, tell it, so the two cannot disagree about what is on screen.
      onClose={() => {
        if (closingOurselves.current) {
          closingOurselves.current = false;
          return;
        }
        if (open) onCancel();
      }}
      // Clicking the backdrop lands on the dialog element itself, never on its
      // contents. Treated exactly like Cancel and Esc, which is what E5 checks.
      onClick={(event) => {
        if (event.target === dialogRef.current && !pending) onCancel();
      }}
    >
      <h2 className="complain-dialog__title" id={titleId}>
        File a complaint
      </h2>

      <div className="complain-dialog__finality" id={finalityId}>
        <p>
          Confirming sends this order to Guardian for arbitration. Filing is final — a
          complaint cannot be withdrawn once it is in, and the ruling binds both you and
          the seller. There is no appeal.
        </p>
        <p>
          Guardian reads the delivered work against what the seller promised and what you
          asked for. If the work holds up, the verdict is a full refusal and the seller is
          paid in full. Arbitration itself costs you nothing.
        </p>
      </div>

      <div className="complain-dialog__field">
        <label className="complain-dialog__label" htmlFor={fieldId}>
          What was wrong with the work? (required)
        </label>

        <textarea
          id={fieldId}
          className="complain-dialog__textarea"
          rows={6}
          value={reason}
          disabled={pending}
          // Required for assistive technology, not for the browser: the dialog does
          // its own validation by disabling Confirm, and a constraint bubble would
          // talk over the copy above.
          aria-required="true"
          aria-describedby={error === undefined ? counterId : `${counterId} ${errorId}`}
          onChange={(event) => setReason(event.target.value)}
        />

        <p className="complain-dialog__counter" id={counterId}>
          {remaining >= 0
            ? `${remaining.toLocaleString()} of ${MAX_REASON.toLocaleString()} characters left`
            : `${Math.abs(remaining).toLocaleString()} characters over the ${MAX_REASON.toLocaleString()}-character guide — you can still file, but shorter is easier to rule on`}
        </p>
      </div>

      {error !== undefined ? (
        <p className="complain-dialog__error" id={errorId} role="alert">
          {error}
        </p>
      ) : null}

      <div className="complain-dialog__actions">
        <button
          type="button"
          className="complain-dialog__cancel"
          disabled={pending}
          onClick={onCancel}
        >
          Cancel
        </button>
        <button
          type="button"
          className="complain-dialog__confirm"
          disabled={!canConfirm}
          onClick={handleConfirm}
        >
          {pending ? 'Filing…' : 'File complaint'}
        </button>
      </div>
    </dialog>
  );
}
