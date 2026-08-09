import { OrderState } from '../entities/enums';

/**
 * Abstract root of every error the orders module can throw.
 *
 * One class at the root, for the same reason `chain/errors.ts`,
 * `ledger/ledger.errors.ts` and `catalog/catalog.errors.ts` each have one: a
 * caller that only needs to know "something in orders refused" writes a single
 * `catch (e) { if (e instanceof OrdersError) }` instead of enumerating seven
 * class names it will forget to extend when the eighth is added. Anything finer
 * — *which* refusal, and therefore which status code and which words — means
 * checking the concrete subclass, which is why the per-class fields below exist
 * rather than being flattened into a message string somebody downstream would
 * have to parse back out.
 *
 * `this.name = new.target.name` for the same reason `ChainError` does it:
 * subclassing a built-in leaves `name` reading `"Error"` on every subclass, so
 * a log line or a Sentry title says nothing about what actually happened.
 * `new.target` is the constructor that was actually `new`-ed, so each subclass
 * gets its own name without restating it.
 *
 * ⚠️ These are plain `Error`s and NOT `HttpException` subclasses. That is the
 * same deliberate split `catalog.errors.ts` and `ledger.errors.ts` document at
 * length, and this module is where it pays for itself hardest, because the
 * mapping here is unusually easy to get wrong in an unusually damaging way: the
 * *identical* "you are not a party to this order" condition must render as a
 * `404` on every one of the five routes ([contracts §3, §5, §6]), including the
 * two that admit the seller for reads and refuse them for writes. A service that
 * threw `NotFoundException` — or worse, `ForbiddenException` — directly would
 * have made that decision at the throw site, where only one route is in view,
 * and the first person adding a route would copy whichever throw was nearest.
 * Throwing plain errors and letting `orders-http.ts` decide keeps the whole
 * mapping readable in one screenful, which is the only way "no orders route ever
 * answers `403`" stays a property that can be *checked* rather than hoped for.
 *
 * The second reason is that these errors outlive HTTP. The sweeper, the
 * confirmation-retry job and the reclaimer (contracts §8, API-10's) call the same
 * services with no request in sight; an `HttpException` thrown at them is a
 * status code that means nothing to a cron and a `getResponse()` nobody reads.
 */
export abstract class OrdersError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/**
 * The order asked for is not visible to this caller.
 *
 * ⚠️ **Deliberately one error for two different underlying facts.** Either no
 * order with that id exists, or one does and the caller is neither its buyer nor
 * the owner of the agent it was placed against. The two must be indistinguishable
 * from outside the process, which is why they are indistinguishable *inside* it
 * as well: there is exactly one class, so there is nothing for a controller to
 * branch on even if someone wanted to.
 *
 * That construction is the whole point (R7). Splitting this into
 * `OrderNotFoundError` and `NotOrderPartyError` reads tidier and is a security
 * defect: a well-meaning controller would then say *which* one applied, and
 * "you are not a party to this order" is an existence oracle. It confirms to a
 * stranger that the uuid they just guessed names a real order — that somebody
 * bought something, at some price, from some seller — and repeated against a
 * uuid space that is being enumerated it maps out the platform's order table.
 * FR-036 forbids exactly that, and one class is the enforcement mechanism.
 *
 * ⚠️ **Always `404`, never `403`.** Not on the reads, not on the writes, and not
 * for the *seller* on `accept` and `complain` either — those two routes are
 * buyer-only, and a seller who reaches them gets this error and the same `404`
 * body byte for byte as a stranger (contracts §5, §6). A seller told `403` there
 * would learn nothing they did not already know about that order, but the body
 * would have to differ from the stranger's, and the moment two bodies exist
 * somebody eventually returns the wrong one. Uniform refusal has no such edge.
 *
 * `orderId` is the Postgres uuid as it arrived on the path, carried so a log line
 * names the id without the message string being the only record of it.
 *
 * Caller action: `404`, with a body that hints at neither of the two cases.
 * Retrying does not help — an order does not become visible to a non-party, and
 * ownership of the agent is resolved live through
 * `order → agentVersion → agent` (R7), so it is already current.
 */
export class OrderNotVisibleError extends OrdersError {
  constructor(
    message: string,
    public readonly orderId: string,
  ) {
    super(message);
  }
}

/**
 * The order exists, the caller is entitled to act on it, and it is in a state
 * where the requested action is not defined — `accept` on an order that was never
 * `delivered`, `complain` on one still `running`, and so on (contracts §5, §6).
 *
 * **Why the state is a typed field rather than words in the message.** The
 * refusal the buyer sees names the current state — *"this order is `running` and
 * cannot be accepted yet"* — and the controller has no other way to learn it: the
 * state was read inside the service's transaction, under the row lock, and by the
 * time the catch block runs that transaction is gone. Re-reading is worse in the
 * usual three ways (an extra round trip for a value already in hand, a read
 * outside the transaction that a concurrent execution can have already moved on
 * from, and a message turned into a database dependency). Carrying it as
 * `OrderState` rather than `string` also means a state added to
 * `entities/enums.ts` cannot arrive here as an unhandled spelling.
 *
 * ⚠️ The state carried is the one the *refusal was based on*, not necessarily the
 * one the order is in when the buyer reads the message. Orders move on their own
 * — execution finishes, the sweeper releases — so this is a snapshot and the poll
 * one second later is the authority (contracts §3). Do not build a client
 * decision on this field beyond wording a sentence.
 *
 * Caller action: `409`, naming `currentState`. Not `400`: the payload was
 * well-formed — an `accept` has no payload at all — and it is the *state* that
 * conflicts, which is the distinction contracts §8 makes load-bearing for the UI.
 * Worth retrying once the state changes, which for `purchased`/`running` it
 * shortly will; for `released` and `settled` it never will.
 */
export class InvalidOrderStateError extends OrdersError {
  constructor(
    message: string,
    public readonly orderId: string,
    public readonly currentState: OrderState,
  ) {
    super(message);
  }
}

/**
 * The order was delivered, the caller is its buyer, and the review window has
 * already elapsed — `now() >= delivered_at + review_window_seconds`. There is
 * nothing left to dispute.
 *
 * **The platform refuses at the same instant the escrow contract does.** The
 * window is `orders.review_window_seconds`, the snapshot taken at purchase, and
 * the on-chain deal was opened with that same number; the two clocks are set from
 * the same value on purpose (contracts §6). This check therefore exists to give
 * the buyer a sentence instead of a decoded revert, not to make a decision the
 * chain has not already made.
 *
 * ⚠️ **Where the two race, the contract's answer is final.** A complaint arriving
 * in the same second the sweeper's `release` lands may pass this check and still
 * revert on chain, or fail this check while the release has not yet been mined.
 * The platform reports what actually happened rather than what it predicted: this
 * error is the *pre-read* refusal and a `ContractRevertError` from `dispute` is
 * the authoritative one, and neither is permitted to overrule the other by, say,
 * retrying the dispute because "the window looked open". Removing this check
 * entirely would still be correct and would only be ruder; strengthening it into
 * a guarantee would be wrong.
 *
 * Caller action: `409`. Not `403` — the buyer had the right, they no longer have
 * the time. Never retry: windows do not reopen, and the money is already the
 * seller's or on its way there.
 */
export class ComplaintWindowClosedError extends OrdersError {
  constructor(
    message: string,
    public readonly orderId: string,
  ) {
    super(message);
  }
}

/**
 * A complaint against this order already exists. One order, one complaint.
 *
 * ⚠️ **`complaints.order_id UNIQUE` is the real guarantee; this error is the
 * friendly form of it.** FR-031 puts the constraint in storage rather than in a
 * check for the reason every such rule ends up there: a `SELECT` followed by an
 * `INSERT` is two statements with a gap, and two clicks of a submit button that
 * land in that gap both pass. The constraint has no gap. This class exists so the
 * common case — the buyer whose first complaint succeeded and who reloaded — gets
 * a sentence rather than a driver error, and so the service can distinguish
 * "already filed" from "the insert broke" without matching on a Postgres SQLSTATE
 * at the controller.
 *
 * The consequence worth internalising: **the constraint fires inside the
 * transaction regardless of whether this error was ever thrown.** If a race slips
 * past the read, the `INSERT` raises `23505`, the transaction rolls back, and no
 * second escrow `dispute` is attempted — which is the outcome that actually
 * matters, since the on-chain call is not idempotent and a second `dispute` on a
 * deal already `Disputed` reverts. Do not "optimise" the pre-check away on the
 * grounds that the constraint covers it, and do not drop the constraint on the
 * grounds that the pre-check covers it. The first loses the message, the second
 * loses the guarantee.
 *
 * Caller action: `409`. Never retry; a complaint is not amendable and a second
 * one will be refused identically. The order is already `disputed` and
 * `GET /orders/:id` shows it.
 */
export class AlreadyComplainedError extends OrdersError {
  constructor(
    message: string,
    public readonly orderId: string,
  ) {
    super(message);
  }
}

/**
 * The agent a purchase was requested against cannot be bought right now.
 *
 * ⚠️ **Deliberately one error for three different underlying facts**, and the
 * reasoning is `catalog.errors.ts`'s `AgentNotFoundError` verbatim, because the
 * facts are the same three: the row does not exist; the row exists but `active`
 * is `false`; the row exists but has a NULL `onchain_agent_id` (a listing whose
 * `registerAgent` never confirmed, so there is no on-chain agent to open a deal
 * against). Contracts §1 maps all three onto a single `404` with the body
 * `Agent not found`. Splitting them would invite a controller to say which
 * applied, and *"this agent is currently inactive"* confirms to a stranger that
 * the uuid is real and tells them a seller paused it.
 *
 * The consequence to keep: `POST /orders` and `GET /agents/:id` must be
 * indistinguishable probes. If the purchase route ever answered something the
 * catalogue route does not, the pair becomes an oracle even though neither is one
 * alone — which is why `orders-http.ts` renders this with the same body text the
 * catalogue's mapper uses rather than a wording of its own.
 *
 * `agentId` is the uuid from the request body, carried for the log line.
 *
 * ⚠️ Not to be confused with `catalog/errors`' `AgentNotFoundError` or
 * `chain/errors.ts`'s: three classes, three hierarchies, and
 * `instanceof OrdersError` matches only this one. It is separate rather than
 * reused because the orders module resolving an agent for purchase asks a
 * *stricter* question than the catalogue does — a listing with a NULL on-chain id
 * is legitimately visible to its owner (`listed: false`) and is still unbuyable —
 * and because importing the catalogue's error would make every orders caller's
 * `catch` need two root checks.
 *
 * Caller action: `404`, body `Agent not found`, no hint at which case applied.
 * Retrying does not help within a request; an inactive agent may be relisted
 * later, but nothing about that is visible to this caller.
 */
export class AgentNotPurchasableError extends OrdersError {
  constructor(
    message: string,
    public readonly agentId: string,
  ) {
    super(message);
  }
}

/**
 * The order cannot be disputed because it has no `onchain_deal_id` — nothing was
 * ever escrowed, so there is no deal for `dispute` to name.
 *
 * **This is specifically the compensated-purchase case:** `state = 'failed'` AND
 * `onchain_deal_id IS NULL`, the row shape R3 assigns to a *knowable* `openDeal`
 * failure. The escrow call reverted or the RPC broke, the order was marked
 * `failed`, and a compensating `adjustment` credit was written — the buyer's money
 * came straight back and never left the ledger. There is no dispute to file
 * because there is no money in dispute and no counterparty who was ever paid.
 *
 * ⚠️ **Distinct from a crashed run, which looks identical in `state` and is not
 * this error.** An agent that was bought successfully and then failed to produce
 * output is *also* `state = 'failed'`, but it **has** a deal id, its money **is**
 * escrowed, and it **is** disputable — that is Act 3 of the demo, and R9 has
 * `complain` call `markDelivered` then `dispute` on exactly those orders
 * (contracts §6). The discriminator is the deal id and nothing else. A refusal
 * written against `state === 'failed'` alone would refuse the one complaint the
 * product most needs to accept, and it would look right in review.
 *
 * The same shape can in principle arise from an *unknown* `openDeal` outcome, but
 * not through this error: that leaves the order at `purchased`, not `failed` (R3),
 * so it is refused by `InvalidOrderStateError` instead — correctly, because there
 * the deal may yet turn up and the confirmation-retry job owns the row.
 *
 * Caller action: `409`. Not `404` — the order exists and the buyer may read it;
 * not `400` — there was no payload defect. Never retry: a deal id is never
 * assigned to a compensated order, by design, since assigning one would mean
 * calling `openDeal` a second time after the buyer was already refunded.
 */
export class OrderNotDisputableError extends OrdersError {
  constructor(
    message: string,
    public readonly orderId: string,
  ) {
    super(message);
  }
}

/**
 * A purchase was refused because the buyer's available balance does not cover the
 * agent's price. **Nothing was written** — this is raised from inside the
 * purchase transaction, before the escrow is touched and while the `accounts` row
 * lock is still held, so the transaction rolls back and the ledger is exactly as
 * it was.
 *
 * **Why both figures ride along.** The refusal the buyer sees names them both —
 * *"available balance is $12.00, this agent costs $25.00"* — and both are known
 * at the moment of the throw: the balance was just summed under the lock and the
 * price was just read off the pinned version. Carrying them means the controller
 * formats the refusal with `formatCents` and nothing else. Re-querying in the
 * catch block is worse in three separate ways: it is a second round trip for
 * numbers already in hand; it reads *outside* the transaction, so a concurrent
 * top-up can make the reported balance differ from the one the refusal was
 * actually based on; and it turns a message into a database dependency, so a
 * wording change touches a query.
 *
 * `availableBalanceMinor` is the signed ledger sum, in integer USD cents, and can
 * be negative if hand-written `adjustment` rows put it there — `formatCents`
 * renders that as `-$12.34` rather than hiding it. `priceMinor` is the pinned
 * version's price, positive cents, and is the price the *order* would have been
 * created at, not necessarily the agent's current listing price.
 *
 * ⚠️ **`402`, not `400`.** The request was well-formed — `agentId` parsed, the
 * `input` passed the version's `inputSchema`, `acceptanceCriteria` was non-blank
 * — and it is the *state* that refused it, which is the same distinction
 * `catalog-http.ts` makes load-bearing between `400`, `409` and `502` and which
 * contracts §1 fixes for this route. `402 Payment Required` rather than `409`
 * because the client branches on it: it is the one refusal whose remedy is "add
 * funds", and `BuyPanel` routes it to the top-up flow rather than to a generic
 * conflict message. Worth retrying after a top-up, and never before.
 *
 * ⚠️ This deliberately **mirrors `ledger/ledger.errors.ts`'s
 * `InsufficientBalanceError` and is a separate class in a separate hierarchy.**
 * Same two figures, different module, different status: the ledger's is a `409`
 * on the cash-out routes, this one is a `402` on the purchase route, and folding
 * them into one class would force one status onto both surfaces or push the
 * decision back to the throw site. `instanceof OrdersError` never matches the
 * ledger's, and a file needing both must import both — which is the honest
 * reflection of there being two different refusals here.
 */
export class InsufficientFundsForPurchaseError extends OrdersError {
  constructor(
    message: string,
    public readonly availableBalanceMinor: number,
    public readonly priceMinor: number,
  ) {
    super(message);
  }
}
