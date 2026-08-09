import type { OrderState } from '../../entities/enums';

/**
 * Every buyer- and seller-facing order shape that is not the case file
 * (`specs/007-orders-purchase-saga/contracts/internal-api.md` §1, §2, §3, §7).
 *
 * ⚠️ **Closed, and closed deliberately.** No index signature, and no `extends`
 * from a TypeORM entity anywhere in this file. This is **layer 3 of the three
 * described in `src/catalog/agent-serialiser.ts`** — the queries do not select
 * the restricted columns, the mappers' parameter types cannot see them, and
 * these interfaces have no property to hold them. Three independent failures
 * are needed, not one lapse, and this file is the third. With an index
 * signature or an `extends`, `return { ...order, ...version }` compiles, and
 * the day it compiles is the day `system_prompt`, `model` and the buyer's
 * account id ship in a response body with every rule about them still
 * perfectly well documented. The excess-property check on an exact object
 * literal is what turns that mistake into a build failure, so a mapper must
 * name each field it emits.
 *
 * ⚠️ **Field names are literal, and four of these five shapes are
 * transcriptions rather than designs.** `ui/src/api/types.ts` already declares
 * `CreateOrderResponse`, `Order`, `OrderRun` and `Sale`, and
 * `ui/src/api/orders.ts` and `sales.ts` are written against them. The client
 * shipped before this server existed, so reconciling means matching it
 * (contracts §0, research R12). A mismatched key does not throw: it renders as
 * an absent value on the order screen, the same class of bug as commit
 * `67dcf4d`. Copy from the contract, do not retype.
 *
 * **Timestamps are ISO-8601 strings, never `Date`.** The client parses at the
 * point of use rather than converting at the boundary, and a string says the
 * same thing whether it was produced by this process or replayed from a log.
 *
 * **Money is whole USD cents**, always suffixed `Minor`.
 *
 * The case file's two shapes are **not** here — they live in `case-file.dto.ts`
 * for the reason `agent-version-detail.dto.ts` is not folded into
 * `agent-listing.dto.ts`: one of them is allowed to carry `systemPrompt`, and a
 * file whose promise is "none of these can carry the prompt" stops being a
 * guarantee the moment it becomes "one of these can, check which".
 */

/**
 * `POST /orders` — the `201` body (§1).
 *
 * **Deliberately thin: an id, and nothing else.** `ui/src/api/types.ts` states
 * the reason in writing — the client wants *"an id to navigate to"*, and
 * modelling the whole order here would mean two type definitions racing to
 * describe one resource. `GET /orders/:id` is the authority on state, output,
 * countdown and verdict; whatever a purchase might have known about those is a
 * second opinion with a shorter shelf life than the poll that follows it.
 *
 * ⚠️ Do not widen this later "since we have the row anyway". The order screen
 * navigates and then polls; a richer `201` would be read once, by nothing.
 */
export interface CreateOrderResponse {
  /** The order's uuid — what `/orders/:id` is addressed with. */
  id: string;
}

/**
 * The execution attached to an order, embedded in `OrderResponse` (§3).
 *
 * Embedded rather than fetched separately so that a one-second poll stays a
 * single request. There is exactly one run per order.
 *
 * ⚠️ **There is no `steps`, and the absent property is the guarantee.**
 * Execution steps are a documented redaction hazard — a reasoning turn can
 * paraphrase the seller's system prompt without ever touching that column — so
 * no component can leak a step if the type gives it nowhere to land, even if
 * the serialiser upstream regresses and starts sending them. Steps appear
 * **only** in the case file, redacted, where the redaction is a stated contract
 * (`case-file.dto.ts`). `GET /orders/:id` is a general read with no such
 * contract, which is exactly why it carries none.
 *
 * Until the execution feature (API-08) exists, no `runs` row is ever written,
 * so `OrderResponse.run` is always `null` and this interface is a contract with
 * no producer yet.
 */
export interface OrderRunResponse {
  /**
   * What was actually sent to the agent — `runs.input`, not `orders.input`.
   * The two are the same document in the MVP and answer different questions:
   * the order's copy records what the buyer paid for, this one records what ran
   * (data-model §1). The case file quotes the order's copy; this field is the
   * run's own evidence.
   */
  input: Record<string, unknown>;

  /**
   * ⚠️ **`null` here and `run === null` are two different kinds of nothing.**
   * `run === null` means execution has not started; `output === null` means it
   * ran and produced nothing. Collapsing them tells a buyer their agent is
   * still working when it has already given up — and `runs.output IS NULL` is
   * the non-delivery evidence invariant #7 rests on, so the distinction is
   * load-bearing all the way down to the dispute.
   *
   * `null` is part of the type rather than an omitted property precisely
   * because *"the agent returned nothing"* is something the screen **says**,
   * not something it omits. An optional property would let a non-delivery slip
   * through as a section that simply fails to render, which is the exact
   * silence the nothing-came-back face exists to break.
   *
   * `unknown` rather than a shape because its shape **is** the seller's
   * declared `outputSchema`, known only at runtime. The screen renders it by
   * inspection, not by field access, and typing it narrower would be a claim
   * about a document this server has never seen.
   */
  output: unknown | null;
}

/**
 * `GET /orders/:id` — the order screen's poll (§3), transcribed from
 * `ui/src/api/types.ts`'s `Order`. Polled at 1 s by `useOrder`.
 *
 * Returned to the **buyer or the owner of the agent the order was placed
 * against**. Authorising it on `buyer_account_id` alone is the natural thing to
 * write and it silently deletes half the seller experience.
 *
 * ⚠️ **There is no `agentId`, and there is no input under which there could
 * be.** `agentName` is resolved through the **pinned agent version** — the
 * order points at `agent_version_id` and never at `agent_id` (invariant #6), so
 * the name shown is the one this order was actually sold under, not the one the
 * seller is advertising today. Nothing on the order screen navigates back to
 * the listing, and a field that invited it would invite navigating to a
 * definition the order is not running.
 *
 * ⚠️ **There is no `systemPrompt` and no `model`**, for the reason
 * `AgentListingResponse` has neither: seller IP does not travel to a buyer, and
 * the type is where that is enforced rather than remembered.
 */
export interface OrderResponse {
  /** The order's uuid. */
  id: string;

  /**
   * The product state machine's current value. Eight members, and the client's
   * `OrderState` union is kept character-for-character identical to
   * `entities/enums.ts` so that a ninth state added here shows up as a diff
   * over there rather than as an order page rendering no face at all.
   */
  state: OrderState;

  /**
   * ⚠️ Resolved through the **pinned** version (`orders → agent_versions →
   * agents`), never through the agent's latest one. A seller who renames an
   * agent must not retitle orders that were already sold; the header shows what
   * was bought.
   */
  agentName: string;

  /** Whole USD cents. The **snapshot** taken at purchase, not a live read. */
  priceMinor: number;

  /**
   * The buyer's own prose, verbatim. It is what Guardian later checks the
   * output against and it has no schema — and it is never matched against the
   * listing (FR-004), so nothing here has trimmed or normalised it.
   */
  acceptanceCriteria: string;

  /**
   * ⚠️ **The order's own snapshot column, NOT a config read.** The client's
   * countdown is computed from this field and nothing else. Reading live config
   * instead would silently retime orders that were already sold — the demo
   * turning the window down between rehearsals would shorten the review period
   * of every order already in flight, and every one of them would still look
   * correct on screen. An order shows the window it was sold under.
   */
  reviewWindowSeconds: number;

  /** ISO-8601. When the purchase committed. */
  createdAt: string;

  /**
   * ISO-8601, or `null` while the run has not landed. The instant the review
   * window starts counting from, which is why it is a fact on the payload
   * rather than something the client infers from `state`.
   */
  deliveredAt: string | null;

  /**
   * ISO-8601, or `null`. Carried as a **fact**, not inferred from `state`: it
   * is true from the moment a complaint is filed and stays true through every
   * state after it, so a state added later cannot silently unmark a disputed
   * order.
   */
  disputedAt: string | null;

  /** ISO-8601, or `null`. Set on release and on settlement alike. */
  settledAt: string | null;

  /**
   * ⚠️ **`null` means execution has not started** — a `purchased` order that no
   * worker has picked up yet. It is not the same nothing as
   * `run.output === null`, which means it ran and produced nothing. See
   * `OrderRunResponse.output`; the two render differently and collapsing them
   * is a lie about whether the agent is still working.
   *
   * **Always `null` until API-08 exists.** Nothing in this feature writes a
   * `runs` row, and the buyer's input deliberately lives on `orders.input`
   * rather than on a pre-created run precisely so that a not-yet-started order
   * stays distinguishable from a failed one (data-model §1).
   */
  run: OrderRunResponse | null;
}

/**
 * One row of `GET /orders` — the buyer's own orders, newest first (§2).
 *
 * **Defined by this backend feature, unlike its four neighbours.**
 * `MyOrdersPage.tsx` is still a `PagePlaceholder` and `ui/src/api/types.ts`
 * declares no counterpart, so this is the one shape in the file that is
 * designed here rather than transcribed. It needs a type and a hook on the
 * client before it can render — a handoff, not a gap on this side.
 *
 * **It mirrors `SaleResponse` field for field and adds `deliveredAt`**, which
 * is the difference between the two lists: My Orders is where a buyer sees
 * which orders are waiting on *them*, and the review countdown starts at
 * delivery. A seller has nothing to do with that clock, which is why their list
 * does not carry it.
 *
 * Every state is included, `failed`, `released` and `settled` among them
 * (FR-045). An empty result is `200 []`, never a `404`.
 */
export interface BuyerOrderSummary {
  /** The order's uuid — what `/orders/:id` is addressed with. */
  id: string;

  /** ⚠️ Resolved through the **pinned** version, as on `OrderResponse`. */
  agentName: string;

  /** Whole USD cents, as this order was sold at. */
  priceMinor: number;

  state: OrderState;

  /** ISO-8601. The list is ordered by this, descending. */
  createdAt: string;

  /** ISO-8601, or `null`. The buyer's cue that an order is waiting on them. */
  deliveredAt: string | null;

  /** ISO-8601, or `null`. A fact, not an inference from `state`. */
  disputedAt: string | null;
}

/**
 * One row of `GET /sales` — the seller's side (§7), transcribed from
 * `ui/src/api/types.ts`'s `Sale`.
 *
 * **This endpoint is the seller's entire notification mechanism.** There is no
 * email, no push and no bell in the header: a seller learns a complaint was
 * filed because a row here changes state, which is why `useSales` polls.
 * `product-workflow.md` §7.5's *"the seller is notified"* is true only for as
 * long as this list is re-read.
 *
 * ⚠️ **There is no buyer address, and no field from which one could be
 * derived.** The seller learns what was ordered, what it cost and what was
 * ruled — not who bought it. Sales against agents since made unavailable are
 * still listed (FR-046); hiding them would erase a seller's own history as a
 * side effect of a toggle.
 *
 * Deliberately not `OrderResponse`. This type is the sales **list's** alone —
 * the seller's dispute screen reads `GET /orders/:id` directly, which §3
 * authorises for the buyer *or* the agent's owner, so nothing here has to stand
 * in for a full order.
 */
export interface SaleResponse {
  /**
   * ⚠️ **The ORDER's id, not a separate sale id.** There is no sales table —
   * a sale is an order seen from the other side. This is what `/sell/sales/:id`
   * carries and what all three of the dispute screen's reads are keyed on, so
   * inventing an id here would break every one of them while type-checking
   * perfectly.
   */
  id: string;

  /** ⚠️ Resolved through the **pinned** version, as on `OrderResponse`. */
  agentName: string;

  /** Whole USD cents, as this order was sold at. */
  priceMinor: number;

  state: OrderState;

  /** ISO-8601. */
  createdAt: string;

  /**
   * ⚠️ **Carried as a fact rather than inferred from `state`.** It is true from
   * the moment a complaint is filed and stays true through every later state,
   * so a state added later in the lifecycle cannot silently mislabel a row.
   * Testing `state === 'settled'` instead would miss a dispute still in flight
   * — which, on the one screen that is a seller's only notification, is the
   * difference between being told of an accusation and not.
   */
  disputedAt: string | null;
}
