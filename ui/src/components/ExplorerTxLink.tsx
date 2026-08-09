import { Fragment } from 'react';
import type { JSX } from 'react';

import { explorerTxUrl } from '../chain/chains';
import { isTxHash, truncateHash } from '../lib/verdict';

interface ExplorerTxLinkProps {
  hash: string;
  /** Optional accessible-name context, e.g. "Withdrawal transaction". Defaults to "Transaction". */
  label?: string;
}

/**
 * The validate-truncate-link core of `TxHashLink`, pulled out because a second
 * screen now needs the same anchor.
 *
 * `TxHashLink` renders the settlement transaction on the verdict card; the
 * wallet page renders a withdrawal receipt. Both are the same object — a hex
 * hash that either is or is not shaped like one, displayed short with the full
 * value kept in reach, pointed at the one explorer this app knows how to name.
 * The temptation is to type that anchor out a second time in the wallet
 * component, and the reason not to is not tidiness. It is that four rules
 * re-typed in a second place is how one of them quietly goes missing, and the
 * rule most likely to be the casualty is the validation: the one check that
 * stands between a malformed hash and a link that looks exactly as
 * authoritative as a real one right up until it lands on the explorer's
 * not-found page. `chain/chains.ts` says in its own comment that a second
 * hardcoded explorer address anywhere in this codebase is precisely the drift
 * it exists to prevent, and that argument does not stop at the URL — the
 * validation and the truncation that sit next to it deserve the same single
 * source, for the same reason.
 *
 * So this component carries the whole anchor and nothing else. A value that
 * does not pass `isTxHash` is never turned into an `href` — it is printed as
 * plain text with a caveat that it is not a recognisable transaction
 * reference and has therefore not been linked, because a link built from a
 * mangled hash fails in front of exactly the person who cared enough to
 * follow it. A value that does pass is shown middle-truncated via
 * `truncateHash`, but the complete value stays available in both the `href`
 * and the `title`, because truncation is a display convenience and must never
 * be the only copy of the thing. The URL itself comes from `explorerTxUrl` and
 * nowhere else; the explorer host string does not appear in this file. The
 * link opens in a new tab with `rel="noopener noreferrer"`, and the `aria-label`
 * opens with the visible text and names the destination, so the external-arrow
 * glyph beside it can stay purely decorative.
 *
 * What this component deliberately does not carry: no copy-to-clipboard
 * control, no state, no opinion about what an absent hash means. Those stay in
 * `TxHashLink`, because they are particular to the verdict card — a sceptic
 * checking a settlement wants to paste the hash elsewhere, and the two
 * different sentences for a missing hash depend on the order's state in a way
 * a withdrawal receipt has no equivalent of. This component only ever renders
 * a hash it was handed.
 */
export function ExplorerTxLink({ hash, label }: ExplorerTxLinkProps): JSX.Element {
  const accessibleLabel = label ?? 'Transaction';

  if (!isTxHash(hash)) {
    // Two siblings, not one nested inside the other — `.tx-hash` in the caller
    // is a flex row with a gap between its children, and `tx-hash__value` and
    // `tx-hash__malformed` are each meant to be a direct child of it, exactly
    // as they are in the markup this was extracted from. Nesting one inside
    // the other would still validate and still read correctly, and would still
    // quietly break the layout the existing stylesheet expects.
    return (
      <Fragment>
        <span className="tx-hash__value">{hash}</span>
        <span className="tx-hash__malformed">
          This is not a recognisable transaction reference, so it has not been linked to the
          explorer.
        </span>
      </Fragment>
    );
  }

  // `isTxHash` narrowed `hash` to viem's `Hex`, which is what `explorerTxUrl`
  // asks for. The type is doing the same job as the sentence above it: the URL
  // builder is unreachable from an unvalidated string.
  const href = explorerTxUrl(hash);
  const shortHash = truncateHash(hash);

  return (
    <a
      className="tx-hash__link"
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      // The full hash, for anyone who wants to read it without copying it.
      title={hash}
      // The destination is announced rather than hidden in a visually-hidden
      // span, so the arrow beside it can stay purely decorative. The name
      // opens with the visible text, so what is read matches what is seen.
      aria-label={`${accessibleLabel} ${shortHash}, opens on MonadVision`}
    >
      <span className="tx-hash__value">{shortHash}</span>
      <span className="tx-hash__external" aria-hidden="true">
        ↗
      </span>
    </a>
  );
}
