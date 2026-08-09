interface LoadStateProps {
  /** Which of the three non-content outcomes the caller is reporting. */
  status: 'loading' | 'error' | 'empty';
  /** The caller's own wording, when it knows the screen better than we do. */
  message?: string;
  /** Refetch the data behind this screen. Supplying it is what draws the retry button. */
  onRetry?(): void;
}

const defaultMessage: Record<LoadStateProps['status'], string> = {
  loading: 'Loading…',
  error: 'Something went wrong loading this.',
  empty: 'There is nothing here yet.',
};

/**
 * The three ways a screen can have no content, kept visibly apart.
 *
 * A marketplace with no agents in it and a marketplace whose API never answered
 * both end up as an empty rectangle, and the two demand opposite reactions: one
 * is the system working and telling you the truth, the other is the backend being
 * down. Leaving them to look alike means the demo either shrugs at a real outage
 * or panics at a normal one. So empty states say plainly that there is nothing
 * here, in a matter-of-fact voice with no retry control, and errors say something
 * broke and hand back a button.
 *
 * That button calls the caller's refetch. It deliberately does not reload the
 * page: a reload throws away the wallet session and everything else on screen to
 * fix one failed request, which is a worse outcome than the failure. This is
 * FR-003.
 */
export function LoadState({ status, message, onRetry }: LoadStateProps) {
  const text = message ?? defaultMessage[status];

  // Loading is transient and self-resolving — a retry button there invites people
  // to interrupt a request that is still in flight.
  const canRetry = status !== 'loading' && onRetry !== undefined;

  return (
    <div
      className={`load-state load-state--${status}`}
      role={status === 'error' ? 'alert' : 'status'}
    >
      <p className="load-state__message">{text}</p>
      {canRetry ? (
        <button type="button" className="load-state__retry" onClick={onRetry}>
          Try again
        </button>
      ) : null}
    </div>
  );
}
