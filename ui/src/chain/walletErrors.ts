/**
 * One classification for everything wagmi and viem can throw at us.
 *
 * Connecting, signing in, and switching networks fail in the same four ways, so
 * they get one classifier and one copy table. Deciding the wording at each call
 * site is how "user rejected the request" ends up shown as a crash on one screen
 * and as a polite nudge on the next.
 *
 * The distinction that matters most is a declined prompt. viem wraps provider
 * errors, so the EIP-1193 code 4001 is never on the object we catch — reading
 * `error.code` off the outer error silently misclassifies a normal user choice
 * as an unknown failure. We walk the cause chain instead.
 */

import { BaseError, UserRejectedRequestError } from 'viem';

export type WalletErrorKind = 'rejected' | 'no-wallet' | 'unsupported' | 'unknown';

/** EIP-1193: the user rejected the request. */
const USER_REJECTED_CODE = 4001;

function hasRejectionCode(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === USER_REJECTED_CODE
  );
}

function errorName(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'name' in error && typeof error.name === 'string') {
    return error.name;
  }
  return '';
}

function errorText(error: unknown): string {
  if (error instanceof Error) {
    return error.message.toLowerCase();
  }
  return typeof error === 'string' ? error.toLowerCase() : '';
}

export function classifyWalletError(error: unknown): WalletErrorKind {
  // Rejection first: it is the most common outcome and the only one whose copy
  // must not read like something broke.
  if (error instanceof BaseError && error.walk((e) => e instanceof UserRejectedRequestError)) {
    return 'rejected';
  }
  // Some injected providers throw the raw EIP-1193 object with no viem wrapper.
  if (hasRejectionCode(error)) {
    return 'rejected';
  }

  const name = errorName(error);
  const text = errorText(error);

  if (name === 'ConnectorNotFoundError' || text.includes('connector not found')) {
    return 'no-wallet';
  }

  if (
    name === 'ChainNotConfiguredError' ||
    name === 'SwitchChainNotSupportedError' ||
    text.includes('unsupported chain') ||
    text.includes('chain not configured')
  ) {
    return 'unsupported';
  }

  return 'unknown';
}

/**
 * The sentence to show the user. `step` exists because declining a connection,
 * a signature, and a network switch are three different situations, and only
 * one of them should ever be on screen.
 *
 * Nothing here quotes the underlying error. Raw provider strings are noise to a
 * user; the caller logs them separately.
 */
export function walletErrorMessage(
  kind: WalletErrorKind,
  step: 'connect' | 'sign' | 'switch',
): string {
  switch (kind) {
    case 'rejected':
      if (step === 'connect') {
        return "You declined the wallet connection. Activate a wallet above when you're ready.";
      }
      if (step === 'sign') {
        return "You declined the signature. Nothing was saved — try again when you're ready.";
      }
      return 'You declined the network switch. You can switch whenever you like.';

    case 'no-wallet':
      return 'No browser wallet is available. Install one (MetaMask, for example) and reload this page.';

    case 'unsupported':
      if (step === 'switch') {
        return 'Your wallet could not switch to Monad Testnet. Add the network manually and try again.';
      }
      return 'Guardian runs on Monad Testnet, and your wallet is somewhere else. Switch networks and try again.';

    case 'unknown':
      if (step === 'connect') {
        return 'Your wallet could not complete the connection. Check the extension and try again.';
      }
      if (step === 'sign') {
        return 'Your wallet could not complete the signature. Check the extension and try again.';
      }
      return 'Your wallet could not complete the network switch. Check the extension and try again.';
  }
}
