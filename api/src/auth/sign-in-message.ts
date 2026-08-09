import type { Address } from 'viem';

/**
 * THE SINGLE DEFINITION OF WHAT GETS SIGNED.
 *
 * `POST /auth/nonce` returns the output of this function, and the verifier
 * rebuilds it from the stored nonce before recovering the signer. Both sides
 * call this one function, so the two can never disagree about a byte.
 *
 * That is also why the endpoint hands back the composed `message` rather than
 * only the `nonce`. Letting the client assemble it would mean two
 * implementations of an unversioned format with nothing keeping them in step —
 * and the failure mode is silent: a changed word, a lost blank line, a trailing
 * newline picked up by an editor, and `recoverMessageAddress` returns some
 * unrelated address. The user sees "signature does not match your address" with
 * no hint anywhere that formatting is the cause. Anything the client can get
 * wrong about this string, it eventually will.
 *
 * ⚠️ **Changing this string invalidates every challenge in flight** — anyone
 * mid-signature at deploy time gets a mismatch and has to start over. That is
 * the tolerable outcome. The intolerable one is the two sides drifting apart,
 * which does not invalidate challenges so much as break sign-in completely and
 * permanently. Any edit must be made HERE and nowhere else; do not "keep the
 * frontend in sync" by copying the format into it.
 *
 * On the copy itself: "It is not a transaction and costs nothing" is load-
 * bearing, not filler. A wallet popup full of opaque bytes teaches users that
 * approving things they cannot read is normal, which is exactly the habit that
 * gets them drained later. A buyer who hesitates at an unexplained signature
 * request is behaving correctly, and the cheapest possible answer is to tell
 * them in plain words what they are approving.
 *
 * The address is echoed in CHECKSUMMED form so the user can see, before
 * signing, which address the platform actually resolved their input to. This is
 * the payout address for every refund and every sale that account ever makes —
 * worth one line to show it.
 *
 * Deliberately a plain EIP-191 `personal_sign` message, NOT EIP-4361
 * (Sign-In With Ethereum). Using SIWE honestly means verifying its
 * domain/chain-id/issued-at/expiry fields, which is a parser plus a policy set
 * for a single-origin demo app that has neither multiple domains nor multiple
 * chains to disambiguate. Emitting the SIWE format while checking only the
 * nonce would be strictly worse than not using it: it would advertise
 * guarantees to every reviewer who recognises the shape, without any of them
 * being enforced.
 */
export function buildSignInMessage(address: Address, nonce: string): string {
  return `Guardian: sign in to your account.

This signature proves you own this wallet.
It is not a transaction and costs nothing.

Address: ${address}
Nonce: ${nonce}`;
}
