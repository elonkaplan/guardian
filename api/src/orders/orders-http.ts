import {
  ConflictException,
  HttpException,
  HttpStatus,
  NotFoundException,
} from '@nestjs/common';

import { toHttpException as chainToHttpException } from '../common/chain-http';
import {
  AgentNotPurchasableError,
  AlreadyComplainedError,
  ComplaintWindowClosedError,
  InsufficientFundsForPurchaseError,
  InvalidOrderStateError,
  OrderNotDisputableError,
  OrderNotVisibleError,
  OrdersError,
} from './orders.errors';

/**
 * The single place an orders error becomes an HTTP response.
 *
 * Same argument `common/chain-http.ts` makes for the chain family and
 * `catalog/catalog-http.ts` makes for the catalogue, applied to this module: the
 * services throw plain errors so that the cause-to-status mapping lives in one
 * reviewable location rather than at every throw site. Seven endpoints share
 * these seven refusals; without this file the same `409` would be constructed in
 * five controllers and would drift in four of them.
 *
 * ---
 *
 * ## ⚠️ `OrderNotVisibleError` is `404` here and `404` everywhere, and it must
 * stay that way
 *
 * This module has **no `403` branch at all**, and its absence is the security
 * property, not an oversight. `GET /orders/:id`, `GET /orders/:id/case-file`,
 * `POST /orders/:id/accept` and `POST /orders/:id/complain` all refuse a caller
 * who is not a party with a `404` whose body is byte-for-byte the body a
 * nonexistent order gets. A `403` on any of them would confirm the order exists to
 * anyone probing uuids — that somebody bought something, from some seller, at some
 * price — and repeated against an enumerated uuid space it maps the order table
 * (FR-036, R7).
 *
 * The enforcement is structural rather than editorial: `orders.errors.ts` defines
 * **one class for both facts**, so there is nothing here to branch on even if a
 * future edit wanted to. Contrast `catalog-http.ts`, where `NotAgentOwnerError`
 * genuinely is a `403` on the writes and a `404` on one read, and the exception
 * has to be maintained by hand at the route that needs it. Orders has no such
 * exception and should never grow one; if a route ever appears where confirming
 * existence is safe, it needs its own error class rather than a second meaning for
 * this one.
 *
 * ⚠️ Note in particular that the **seller** reaching `accept` or `complain` gets
 * this same `404` (contracts §5, §6). The read routes admit them and the writes do
 * not, and the writes do not explain themselves. That looks unhelpful and is
 * deliberate: the moment a second body exists for "wrong party", somebody
 * eventually returns it to the wrong party.
 *
 * ---
 *
 * ## Why the chain branch is delegated rather than reimplemented
 *
 * Both write routes call the escrow inside their transaction, so every class in
 * `chain/errors.ts` can arrive here. None of them is handled in this file. They
 * fall through to `chainToHttpException`, which keeps the
 * **`ChainOutcomeUnknownError`-first ordering** — and the `txHash` in its body —
 * in exactly one place for the whole application.
 *
 * That ordering is the single most consequential line in the codebase's error
 * handling: `ChainOutcomeUnknownError extends ChainError` on purpose, so any
 * generic `instanceof ChainError` branch written *above* the specific check
 * silently reports "we do not know" as "it failed", and what a caller does with a
 * failure is retry. `chain-http.ts` documents that trap at length. Re-deriving the
 * chain mapping here — even faithfully, even once — would create a second place
 * where that ordering has to be right, and the second place is the one that is
 * wrong after the next refactor.
 *
 * ⚠️ What this function does **not** decide is what happens to the *database* on a
 * chain failure, and the two questions have opposite answers on the two write
 * routes: `accept` rolls back on both a knowable failure and an unknown outcome,
 * `complain` rolls back on failure and **commits** on unknown (R8), while
 * `POST /orders` compensates on failure and pointedly does not on unknown (R3).
 * All three then return the same `502` through this function. Formatting a
 * response and repairing state are different questions about the same error, and
 * collapsing them into one helper is how the wrong one gets answered by accident.
 *
 * ---
 *
 * ## The signature
 *
 * This function either returns an `HttpException` or does not return at all — an
 * unmapped `OrdersError` and every non-orders, non-chain throw are rethrown with
 * their stacks intact. Call it as `throw toHttpException(err)`; written that way
 * the rethrow is invisible at the call site and both paths end in a throw anyway.
 */
export function toHttpException(err: unknown): HttpException {
  // The buyer cannot afford it. `402`, not `400`: the body was well-formed and
  // the state refused it (contracts §1). Both figures go on the wire because the
  // client formats the refusal from them and `BuyPanel` routes a `402` — and only
  // a `402` — into the top-up flow, so it needs the shortfall without a second
  // request.
  //
  // ⚠️ `@nestjs/common` (11.1.28, verified against
  // `node_modules/@nestjs/common/exceptions/index.d.ts`) exports no
  // `PaymentRequiredException` — the file list jumps from `payload-too-large` to
  // `precondition-failed`. This is therefore constructed from `HttpException` and
  // `HttpStatus.PAYMENT_REQUIRED` by necessity, not by preference; it produces the
  // identical response. If a later Nest adds the class, swapping to it is safe and
  // this comment goes with it.
  if (err instanceof InsufficientFundsForPurchaseError) {
    return new HttpException(
      {
        message: err.message,
        availableBalanceMinor: err.availableBalanceMinor,
        priceMinor: err.priceMinor,
      },
      HttpStatus.PAYMENT_REQUIRED,
    );
  }

  // Unknown, inactive, or unregistered — `POST /orders` cannot tell these apart
  // and must not.
  //
  // ⚠️ The body text is `catalog-http.ts`'s, character for character, on purpose.
  // A stranger probing a uuid must get the same answer from the purchase route as
  // from `GET /agents/:id`; two wordings for the same fact make the pair an oracle
  // even though neither route is one alone. If the catalogue's text ever changes,
  // this changes with it.
  if (err instanceof AgentNotPurchasableError) {
    return new NotFoundException('Agent not found');
  }

  // Does not exist, or exists and is none of the caller's business. One class, one
  // status, one body — see the long note above. There is deliberately no
  // `ForbiddenException` anywhere in this function.
  if (err instanceof OrderNotVisibleError) {
    return new NotFoundException('Order not found');
  }

  // `409`, naming the state, which is the whole reason `InvalidOrderStateError`
  // carries it as a typed field rather than folding it into a message the
  // controller would have to parse. The state is a snapshot from inside the
  // service's transaction; the client's one-second poll is the authority on what
  // the order is now (contracts §3).
  if (err instanceof InvalidOrderStateError) {
    return new ConflictException(
      `Order is ${err.currentState} and this action is not available in that state.`,
    );
  }

  // `409`, not `502`: nothing was attempted on chain. The window closed, which is
  // a state conflict the caller can read a clock against — and the escrow would
  // have refused at the same instant anyway (contracts §6).
  if (err instanceof ComplaintWindowClosedError) {
    return new ConflictException(
      'The review window for this order has closed and it can no longer be disputed.',
    );
  }

  // `409`. The friendly form of `complaints.order_id UNIQUE`; the constraint is
  // what actually holds, in the transaction, whether or not this branch ever runs.
  if (err instanceof AlreadyComplainedError) {
    return new ConflictException(
      'A complaint has already been filed for this order.',
    );
  }

  // `409`, not `404`: the order exists and the buyer may read it. Nothing was ever
  // escrowed — the purchase's `openDeal` failed knowably and the money was already
  // credited back — so there is no deal to dispute. ⚠️ A *crashed run* is also
  // `failed` and IS disputable; the discriminator is the deal id, never the state.
  if (err instanceof OrderNotDisputableError) {
    return new ConflictException(
      'This order was never escrowed and its payment was already returned, ' +
        'so there is nothing to dispute.',
    );
  }

  if (err instanceof OrdersError) {
    // A subclass added later that nobody mapped. `400` would claim the caller can
    // fix it and `502` would blame the chain; neither is known to be true, so this
    // falls through to the chain mapper's rethrow and Nest's default `500` — which
    // is the honest answer for "we added an error and forgot to classify it", and
    // it puts the stack in the log.
    throw err;
  }

  // Chain errors, and the rethrow for everything that is nobody's to translate.
  return chainToHttpException(err);
}
