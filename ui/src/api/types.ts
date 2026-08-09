import type { Address, Hex } from 'viem';

import type { Cents } from '../lib/money';

/**
 * Payload types, hand-written until the API publishes a schema.
 *
 * If API-01 emits an OpenAPI document, generated types replace this module and
 * nothing else changes.
 */

/**
 * `GET /me` (api-design §3.2): account, available balance, and the amount
 * currently in escrow.
 *
 * Two figures, never summed. They are different money in different places with
 * different exits — available balance lives in the Postgres ledger and leaves
 * via cash-out; escrowed money is locked on-chain until an order settles.
 * A single combined number would be wrong in both directions.
 *
 * `settledFundsMinor` joins them in UI-06 — the on-chain `balances[]` a user
 * withdraws to their own wallet. It arrives on this same read rather than from
 * a chain call in the browser: the backend does the `eth_call`, which is the
 * demonstration of `ui/docs/CONTEXT.md` §2's boundary rather than the exception
 * to it.
 *
 * **`null` means unknown. It never means zero.** The other two figures come
 * from Postgres in the same transaction as the account; this one comes from an
 * RPC that can be unreachable on its own, and `GET /me` is polled every five
 * seconds by the header on every screen — so a chain outage returns `null` for
 * one field rather than failing the request and taking the whole app's money
 * display down with it. Three states, and the type carries all three: an
 * amount, zero, and unknown.
 *
 * Required-and-nullable rather than optional, deliberately. Optionality invites
 * `?? 0`, and "we could not read it" rendered as "$0.00" is a seller being told
 * they earned nothing when in truth nobody looked. `fetchMe` in `./me.ts`
 * normalises an absent or unreadable value to `null` for the same reason.
 *
 * NOTE: field names are provisional — api-design documents the meanings but not
 * the exact JSON casing. If API-01 lands different names, this file is the only
 * thing that changes.
 */
export interface AccountSummary {
  address: string;
  availableBalanceMinor: Cents;
  inEscrowMinor: Cents;
  /** On-chain, read server-side. `null` = the chain read failed — unknown, never zero. */
  settledFundsMinor: Cents | null;
}

/**
 * `POST /auth/nonce` then `POST /auth/verify` (api-design §3.1).
 *
 * The message signed is the `nonce` value verbatim, as a personal message. Note
 * what the verify payload does not carry: a message field. The backend has to
 * reconstruct what it issued, which is why a structured sign-in message
 * (SIWE-style, with domain and statement) is not used here — it would have
 * nowhere to travel.
 *
 * The first successful verify creates the account. Connecting a wallet is the
 * whole of registration: no password, no email.
 *
 * NOTE: field names are provisional, for the same reason as `AccountSummary`
 * above.
 */
export interface NonceRequest {
  address: Address;
}

export interface NonceResponse {
  nonce: string;
  /**
   * **The exact bytes to sign, and the only thing that may be signed.**
   *
   * Server-owned and multi-line: it embeds the address and the nonce in a
   * format the backend reconstructs verbatim when it verifies. Signing the
   * `nonce` instead — which this app did until UI-08 — produces a signature the
   * backend cannot recover, and the failure surfaces as a bare
   * `401 Signature verification failed` that reads exactly like a user
   * declining the prompt. Confirmed live: same key, same nonce, signing `nonce`
   * → 401, signing `message` → 201 (research R-01).
   *
   * Never recompose this from a template. The format is not ours, drift is
   * invisible until it 401s, and there is no field on `VerifyRequest` to carry
   * a client's idea of what it signed.
   */
  message: string;
}

export interface VerifyRequest {
  address: Address;
  signature: Hex;
}

export interface VerifyResponse {
  token: string;
}

/**
 * `GET /agents` (api-design §3.3): one card in the catalogue.
 *
 * The list is deliberately thinner than the detail response rather than being
 * the same object with fields left out. A card has to answer one question —
 * "is this the agent I want, and can I afford it?" — and everything beyond
 * name, description, and price is weight the marketplace grid does not carry.
 *
 * `priceMinor` is integer USD cents, per `lib/money`. The `Minor` suffix is
 * kept from `AccountSummary` so that no reader has to guess whether a number
 * on this type is dollars.
 *
 * NOTE: field names are provisional, for the same reason as `AccountSummary`
 * above — API-06 is unbuilt and no OpenAPI document exists yet. camelCase is
 * chosen because api-design §3.4 spells the purchase body that way.
 */
export interface AgentSummary {
  id: string;
  name: string;
  description: string;
  priceMinor: Cents;
}

/**
 * `GET /agents/:id` (api-design §3.3): everything the detail screen is allowed
 * to know about an agent.
 *
 * `capabilities` and `exclusions` are required arrays, not optional ones. The
 * backend column is `text[] NOT NULL` — they may be empty, but they are never
 * absent. Typing them as optional would be a lie about the wire format with a
 * cost: it invites `?.map()` at every call site and lets a seller who declared
 * nothing disappear behind a section that simply fails to render, which is
 * exactly the silence the screen is supposed to break. An empty array is a
 * statement the buyer should see; `undefined` is not.
 *
 * What is missing from this type is the point of it. There is no
 * `systemPrompt`, no `model`, no `timeoutSeconds`, and adding one would be a
 * defect rather than an enhancement. The absent property *is* the guarantee:
 * the screen cannot render seller IP because the type gives it nowhere to put
 * it, so no component can leak the prompt even if the serialiser upstream were
 * to regress and start sending it. That is requirement FR-011, enforced by the
 * shape of the data rather than by everyone remembering.
 *
 * There is likewise no separate human-readable description of the input. The
 * prose a buyer reads is derived from the schema's own `title` and
 * `description` keywords, because the database carries only the schema and a
 * second field would immediately be free to contradict it.
 */
export interface AgentListing extends AgentSummary {
  capabilities: string[];
  exclusions: string[];
  inputSchema: JsonSchema;
  outputSchema: JsonSchema;
}

/**
 * The slice of JSON Schema this app reads — not an implementation of it.
 *
 * These are the keywords the form builder consults when it turns a seller's
 * declared input contract into controls. Anything outside this list is passed
 * over rather than rejected; a schema this app cannot lay out as fields is
 * shown to the buyer as raw JSON instead, which means an unknown keyword costs
 * a fallback rather than an error.
 *
 * Every keyword is optional, including `type`, because a seller's schema is
 * arbitrary JSON that arrived through a raw textarea. Nothing upstream
 * validates that it is a schema at all, so a type that promised any required
 * key would be describing a document that may never have existed.
 */
export interface JsonSchema {
  type?: string | string[];
  title?: string;
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  enum?: unknown[];
  format?: string;
  maxLength?: number;
  default?: unknown;
}

/**
 * `POST /orders` (api-design §3.4): the whole of a purchase.
 *
 * Note what a buyer cannot send. There is no price, because the order's price
 * is a snapshot the backend takes from the listing it is charging against — a
 * client-supplied figure would be an invitation to pay a number of one's own
 * choosing. There is no `reviewWindowSeconds` either; it comes from backend
 * configuration and never from the client (api-design §4), so that the window
 * is the same length for everyone regardless of who is asking.
 *
 * Both omissions are requirement FR-021, and this type is where it is
 * enforced: the request has nowhere to put them, so no form and no handler can
 * develop the habit of sending them.
 *
 * `input` is `Record<string, unknown>` rather than a generic parameter because
 * its shape is the seller's `inputSchema`, which is only known at runtime.
 * `acceptanceCriteria` is the buyer's own prose — it is what Guardian later
 * checks the output against, and it has no schema.
 *
 * NOTE: field names are provisional, for the same reason as `AccountSummary`
 * above.
 */
export interface CreateOrderRequest {
  agentId: string;
  input: Record<string, unknown>;
  acceptanceCriteria: string;
}

/**
 * The response to `POST /orders` (api-design §3.4), as far as this feature is
 * concerned: an id to navigate to.
 *
 * Deliberately not the created order. State, output, countdown, and verdict
 * are the order screen's subject in UI-04, and modelling them here would mean
 * two type definitions racing to describe the same resource. Whatever else the
 * backend returns is ignored until there is a screen that reads it.
 */
export interface CreateOrderResponse {
  id: string;
}

/**
 * The eight states an order can be in, listed in the declaration order of the
 * backend's `order_state` enum (`api/specs/002-entities-migrations/data-model.md`
 * §5.1). That order is fixed over there because Postgres sorts enum values by
 * declaration, so it is not free to be rearranged for readability.
 *
 * The order carries no meaning in *this* file — nothing here compares two
 * states, and the lifecycle ranking that decides whether a page may move
 * backwards lives in `lib/orderState.ts`. Keeping the two lists character-for-
 * character identical is the point: when the backend enum gains or reorders a
 * value, a diff between the two files shows it, which is the only mechanism
 * either side has for noticing.
 *
 * A union rather than `string` so that `faceFor` can be exhaustively checked. A
 * ninth state added upstream then becomes a compile error in a switch that no
 * longer covers its input, instead of an order page that quietly renders no
 * face at all because nothing matched.
 */
export type OrderState =
  | 'purchased'
  | 'running'
  | 'delivered'
  | 'failed'
  | 'released'
  | 'disputed'
  | 'adjudicated'
  | 'settled';

/**
 * The execution attached to an order (`api/specs/002-entities-migrations/data-model.md`
 * §6): what was sent to the agent, and what came back.
 *
 * `output` is `unknown` rather than a shape, because its shape *is* the seller's
 * `outputSchema` and that is only known at runtime — the screen renders it by
 * inspection, not by field access. Typing it as anything narrower would be a
 * claim about a document this app has never seen.
 *
 * `null` is the failed case, and it is part of the type rather than an absence
 * because "the agent returned nothing" is a thing the screen *says*, not a thing
 * it omits. An optional property would let a non-delivery slip through as a
 * section that simply fails to render, which is the exact silence the
 * nothing-came-back face exists to break.
 *
 * There is no `steps`. Execution steps are a documented redaction hazard
 * (api-design §1.3, ui-design §7.1 — a reasoning step can paraphrase the
 * seller's system prompt), and as with `AgentListing` and `systemPrompt`, the
 * absent property is the guarantee: no component can leak a step if the type
 * gives it nowhere to put one, even if the serialiser upstream regresses and
 * starts sending them.
 */
export interface OrderRun {
  input: Record<string, unknown>;
  output: unknown | null;
}

/**
 * `GET /orders/:id` (api-design §3.4): everything the order screen follows.
 *
 * Every field but two maps to a column in
 * `api/specs/002-entities-migrations/data-model.md` §5. The exceptions are
 * `agentName`, which the backend resolves through `agent_version → agent`
 * because the order points at an `agent_version_id` and the client has no way
 * to turn that into a name the header can show; and `run` (§6), of which there
 * is exactly one per order, embedded rather than fetched separately so that a
 * one-second poll stays a single request.
 *
 * `reviewWindowSeconds` is a snapshot taken at purchase, not a configuration
 * read. It is on the order so that an order shows the window it was actually
 * sold under, even after the backend's default changes underneath it. The
 * countdown must be computed from this field and nothing else — reading the
 * live config instead would silently retime orders that were already sold.
 *
 * The two nullables are not the same kind of nothing. `run` is null because a
 * `purchased` order has not started; `run.output` is null because a `failed`
 * run produced nothing. They render differently, and collapsing them would tell
 * a buyer their agent is still working when it has already given up.
 *
 * Timestamps are ISO-8601 strings, parsed at the point of use rather than
 * converted to `Date` at the boundary. They arrive as JSON strings, and turning
 * them into `Date` objects on the way in would mean a custom reviver for one
 * field on one type — cost paid on every response to save a `Date.parse` in the
 * one place that does arithmetic.
 *
 * There is no `systemPrompt` and no `model`, for the same reason `AgentListing`
 * has neither: seller IP does not travel to the client, and the type is where
 * that is enforced.
 *
 * NOTE: field names are provisional, for the same reason as `AccountSummary`
 * above.
 */
export interface Order {
  id: string;
  state: OrderState;
  agentName: string;
  priceMinor: Cents;
  acceptanceCriteria: string;
  reviewWindowSeconds: number;
  createdAt: string;
  deliveredAt: string | null;
  disputedAt: string | null;
  settledAt: string | null;
  run: OrderRun | null;
}

/**
 * A row in the buyer's own order list — `GET /orders`, the seven fields
 * `BuyerOrderSummary` declares in the OpenAPI contract and no more.
 *
 * **Not `Order`, and not `Sale`.** Three types for one resource family looks
 * like duplication until you notice that each is a different party's view of it
 * and the differences are load-bearing:
 *
 * - `Order` is the whole thing — criteria, review window, the embedded run. It
 *   is what the order screen polls at 1s and what the buyer accepts or disputes.
 *   Reusing it here would declare fields `GET /orders` never sends, and a
 *   declared-but-absent field is exactly the thing that renders blank.
 * - `Sale` is the *seller's* row, and the contract flags the trap in writing:
 *   *"Deliberately narrower than `BuyerOrderSummary`: there is no `deliveredAt`
 *   field here at all, not merely a null one. A seller list must not be rendered
 *   with buyer-list code that reads it."* The two lists therefore get two types
 *   and two components, so that sharing one by accident is a compile error
 *   rather than a column that is silently always empty on one side.
 *
 * No `reviewWindowSeconds`, which is the field a countdown would need. That
 * absence is the contract's, not an omission here, and it is why the list marks
 * a delivered order as awaiting review without saying how long is left: the only
 * honest clock is on the order's own screen, one click away, where the field
 * exists. Inventing a default window to count down from here would put a number
 * on screen that no order was actually sold under.
 *
 * `disputedAt` is carried as a fact rather than inferred from `state`, for the
 * reason spelled out on `Sale` and in `ConcludedFace`: it stays true through
 * every state after the complaint, so a state added later in the lifecycle
 * cannot silently strip the mark off a row that earned it.
 */
export interface BuyerOrderSummary {
  /** The order id, and what `/orders/:id` is keyed on. */
  id: string;
  /** The agent version's name as pinned at purchase — not the agent's name now. */
  agentName: string;
  priceMinor: Cents;
  state: OrderState;
  createdAt: string;
  /** When the run finished. `null` until then, and `null` forever if it never delivered. */
  deliveredAt: string | null;
  /** When the buyer complained. `null` if no complaint was filed. */
  disputedAt: string | null;
}

/**
 * `POST /orders/:id/complain` (api-design §3.4), verbatim: a reason and nothing
 * else. Accept has no body at all, which is why it has no request type here.
 *
 * Neither action's response is modelled, because neither is read. The poll's
 * next read is the authority on what the order now is, so both wrappers return
 * `Promise<void>` and discard whatever came back.
 */
export interface ComplainRequest {
  reason: string;
}

/**
 * The five values of the backend's `verdict_tier` enum, in its declaration
 * order (`docs/database-schema.md` §5, `api/specs/002-entities-migrations/data-model.md`
 * §8).
 *
 * Kept character-for-character identical to that list for the same reason
 * `OrderState` is: Postgres sorts enum values by declaration, so the order is
 * not free to be rearranged over there, and a diff between the two files is the
 * only mechanism either side has for noticing a change.
 *
 * A union rather than `string` so `tierDisplay` can be exhaustively switched. A
 * sixth tier added upstream then becomes a compile error in one file rather than
 * a card with a blank badge.
 *
 * Note what this type is *not* used for: arithmetic. The percentage a tier
 * implies is a display string, and the money figures come from `refundMinor`
 * (see `Verdict` below).
 */
export type VerdictTier = 'none' | 'quarter' | 'half' | 'three_quarter' | 'full';

/** Which side of the contract a cited clause came from. */
export type CitationSource = 'capability' | 'exclusion' | 'criterion';

/**
 * Whether a cited clause was met — three-valued, and the third value is the
 * point.
 *
 * A boolean has no way to say *the ruling did not record this*, so a normaliser
 * producing one would have to choose between `true`, which fabricates a passed
 * clause, and `false`, which fabricates a failed one and defames a seller.
 * Neither is available: this screen's whole claim is that every mark on it comes
 * from the ruling. `unrecorded` is the honest answer and renders as its own row
 * treatment.
 */
export type CitationStatus = 'met' | 'unmet' | 'unrecorded';

/**
 * A citation as it arrives, before `normaliseVerdict` has looked at it.
 *
 * Every field optional and `unknown` because `verdicts.citations` is
 * `jsonb NOT NULL DEFAULT '[]'` with no schema behind it — Postgres will accept
 * any JSON document in that column, and the API's own data model types it
 * `unknown[]`. A type promising three present, correctly-typed fields would be
 * describing a document nothing upstream validated.
 *
 * Not exported past `src/api/verdicts.ts`. Components see `Citation`.
 */
export interface RawCitation {
  source?: unknown;
  /**
   * The cited text. **Named `quote` because that is what the API sends**
   * (`api/docs/specs/API-09` · `docs/tech-stack.md` §5); it becomes `clause` on
   * the rendered `Citation`. Renaming this to match the rendered field would
   * null every citation on the page without failing a build — every field here
   * is optional `unknown`, so a wrong name reads as an absent value.
   */
  quote?: unknown;
  met?: unknown;
}

/**
 * A citation as it renders: where the clause came from, the clause itself, and
 * whether it held.
 *
 * `source` widens to `string` beyond the three known values on purpose. An
 * unfamiliar origin is not a reason to drop evidence from a checklist whose
 * entire job is showing the evidence — the row renders labelled with whatever
 * the ruling called it.
 *
 * `clause` is nullable for the same reason rather than defaulted to an empty
 * string: "the ruling cited a clause it did not quote" is a fact the reader
 * should see stated, and an empty string would render as a blank quotation mark
 * that reads like a layout bug.
 */
export interface Citation {
  source: CitationSource | string | null;
  clause: string | null;
  status: CitationStatus;
}

/**
 * `GET /orders/:id/verdict` (api-design §3.4): the ruling on a disputed order,
 * normalised at the boundary.
 *
 * **`refundMinor` is authoritative for both money figures, and the tier is a
 * label.** It is the figure the API computed, hashed into `verdict_hash`, and
 * handed to `resolve()` on-chain — so it is what actually moved. A percentage
 * recomputed on the client would be a second, independent calculation of a
 * rounded quantity, and two such calculations disagree eventually: a quarter of
 * 199 cents is 49.75, and whichever way this app rounded it there would be a
 * version of the demo where the card says one thing and the block explorer says
 * another. The seller's share is `order.priceMinor - refundMinor` and nothing
 * else.
 *
 * `citations` is a required array, never optional. The column defaults to `[]`,
 * so it may be empty but is never absent, and an empty list is a statement the
 * screen makes ("no clauses were cited") rather than a section that silently
 * fails to render — the same argument as `AgentListing.capabilities`.
 *
 * `txHash` is `string`, not viem's `Hex`. It is an arbitrary text column until
 * `isTxHash` says otherwise; typing it `Hex` here would assert the validation
 * the card exists to perform before it turns the value into a link.
 *
 * `unreadableCitations` is produced by the normaliser rather than sent over the
 * wire. It exists so that a citation this app could not parse is *counted* on
 * screen instead of vanishing — a dropped row would quietly shrink the evidence.
 *
 * What is missing is again the point. There is no `verdictHash`, no `model`, and
 * no `id`: the hash is an anchoring detail a buyer cannot recompute, the model
 * name is an internal reproducibility record, and rendering either would push
 * this card back towards "an AI decided this" — which is the one thing the
 * citation checklist exists to prevent.
 */
export interface Verdict {
  /**
   * The tier as it arrived. `string` rather than `VerdictTier`, deliberately:
   * this is an unvalidated wire value, and typing it as the union here would be
   * a claim no code has checked — `VerdictTier | string` would be worse still,
   * since TypeScript collapses that to plain `string` while *looking* like a
   * guarantee. The union is enforced where it is actually tested, inside
   * `tierDisplay`, whose exhaustive switch is what makes a sixth tier a compile
   * error.
   */
  tier: string;
  refundMinor: Cents;
  reasoning: string;
  citations: Citation[];
  txHash: string | null;
  createdAt: string;
  /** Elements of the payload's `citations` that were not objects. */
  unreadableCitations: number;
}

/**
 * One action the agent took, as the buyer is allowed to see it.
 *
 * **This type has no `prompt`, no `systemPrompt`, no `reasoning`, and no `raw`
 * field, and that absence is the guarantee** — the same enforcement used on
 * `AgentListing` and `OrderRun`, applied to the payload where it matters most.
 *
 * It is worth being explicit that this does not reverse `OrderRun`'s decision to
 * carry no steps at all. `GET /orders/:id` is a general order read with no
 * redaction contract; `GET /orders/:id/case-file` is the one route api-design
 * §3.4 marks *"redacted for a buyer, full for the seller"*, whose serialiser
 * does not merely strip `system_prompt` but **summarises reasoning text**,
 * precisely because a step can paraphrase its own instructions (api-design §1.3,
 * ui-design §7.1). So `summary` holds what that serialiser produced, and there
 * is nowhere here for raw model reasoning to land even if the API regressed and
 * started sending it.
 */
export interface CaseFileStep {
  label: string;
  summary: string | null;
  durationMs: number | null;
  error: string | null;
}

/**
 * `GET /orders/:id/case-file` (api-design §3.4): the evidence Guardian was
 * handed, redacted upstream for the buyer's copy.
 *
 * `capabilities` and `exclusions` are the listing text of the **agent version
 * that ran**, which is why this app never fetches `GET /agents/:id` to fill this
 * panel. An order pins its version (agent-definition §5) and a seller who lost a
 * dispute has every reason to edit the capability that was cited against them;
 * explaining a ruling with today's listing would break the trace from a citation
 * to its source, quietly, in the one direction that would look like the product
 * covering for the seller.
 *
 * `output` is `unknown` for the same reason it is on `OrderRun` — its shape is
 * the seller's `outputSchema`, known only at runtime — and it is rendered
 * through the same `OutputPanel`, so the case file and the page above it cannot
 * disagree about what was delivered.
 */
export interface CaseFile {
  input: Record<string, unknown>;
  acceptanceCriteria: string;
  capabilities: string[];
  exclusions: string[];
  output: unknown | null;
  steps: CaseFileStep[];
}

/**
 * `GET /me/ledger` (api-design §3.2): one movement of the platform balance.
 *
 * Mirrors `ledger_entries` (database-schema §3.2) field for field, which is why
 * the API side of this endpoint is a serialiser rather than a design exercise.
 *
 * **`amountMinor` is signed — credits positive, debits negative — and the sign
 * is the only source of truth for direction.** Nothing in this app infers
 * direction from `kind`: an `adjustment` goes either way by definition, and a
 * fifth kind added upstream would too.
 *
 * What is *not* here, and cannot be: an entry for a settlement. When an order
 * concludes, the contract credits `balances[buyer]` and `balances[seller]` —
 * the users' own addresses — and the platform never sees that money again
 * (database-schema §3.3). So the statement is a complete explanation of the
 * available balance and of nothing else, which is a fact the Wallet page states
 * on screen rather than leaving a reader to discover as a hole in the books.
 */
export type LedgerKind = 'onramp' | 'purchase' | 'offramp' | 'adjustment';

export interface LedgerEntry {
  id: string;
  /** SIGNED. Credits positive, debits negative. Whole USD cents. */
  amountMinor: Cents;
  kind: LedgerKind;
  /** Set on `purchase` — the order this movement paid for. */
  orderId: string | null;
  /** A transfer id or an on-chain tx hash, when the movement had one. */
  externalRef: string | null;
  /** ISO 8601. */
  createdAt: string;
}

/**
 * `POST /topup` and `POST /offramp` (api-design §3.2) — the two movements of
 * *platform* money, both of which take an amount.
 *
 * Money leaves the way it came in: top-ups draw from the demo treasury and
 * cash-outs return to it (rain-integration §0.3). That symmetry is why the
 * funder wallet's balance is a live health check on the whole loop, and why
 * both requests carry an amount rather than one of them meaning "all of it".
 *
 * `POST /withdraw` has no request type on purpose. `withdrawFor(wallet)` moves
 * the whole settled balance to the caller's own address; there is no partial
 * withdrawal for a client to ask for.
 */
export interface TopupRequest {
  amountMinor: Cents;
}

export interface OfframpRequest {
  amountMinor: Cents;
}

/**
 * `POST /withdraw` (api-design §3.2).
 *
 * `txHash` is `null` when the backend did not report one. The wallet screen
 * degrades to a plain confirmation in that case rather than rendering a link
 * with nothing behind it — the same rule `TxHashLink` applies on the verdict
 * card, and for the same reason: a link that fails when it is followed is worse
 * than no link, because it fails in front of the one person who cared enough to
 * check.
 */
export interface WithdrawResponse {
  txHash: string | null;
}

/**
 * `GET /agents?owner=me` (api-design §3.3): the catalogue row, plus the one
 * flag only an owner is shown.
 *
 * The public list is active-only; this one **includes inactive agents**, and
 * api-design §3.3 gives the reason in the endpoint table itself — without them
 * the availability control is one-way, because switching an agent off would
 * remove it from the only screen that could switch it back on.
 *
 * **What is missing is the point, exactly as on `AgentListing`.** There is no
 * `systemPrompt`, no `model`, no `timeoutSeconds`, no schemas — and adding one
 * would be a defect rather than a convenience. The owner's execution spec is
 * available from `GET /agents/:id/versions`, an endpoint this app deliberately
 * never calls; and if `?owner=me` ever hands back whole version rows, the
 * seller's list still has nowhere to put a prompt. That is FR-037 enforced by
 * the shape of the data rather than by everyone remembering, and it holds for
 * the seller's own prompt too — `ui/docs/CONTEXT.md` §2 is unconditional that
 * this application has no code path that renders one.
 *
 * NOTE: field names are provisional, for the same reason as `AccountSummary`
 * above. `agents.active` is a real column with a `true` default, so a new
 * listing is on the market the moment it exists.
 */
export interface OwnedAgent extends AgentSummary {
  active: boolean;
  /**
   * Whether the on-chain registration actually landed — **not** the same fact as
   * `active`, and the reason both have to be on screen.
   *
   * `active` is the seller's own switch. `listed` is whether the chain agreed:
   * `false` means the agent exists in Postgres with no on-chain counterpart, so
   * no buyer can see or purchase it and `POST /agents/:id/versions` answers 409.
   *
   * **`active: true, listed: false` is the dangerous pair.** The availability
   * control reads "On the market" while the agent is invisible to every buyer,
   * and nothing else on the screen would say so — a seller advertising something
   * nobody can buy, with no way to find out. The field arrives on this endpoint
   * (`OwnedAgentResponse.listed`, required) and was being discarded at this type
   * boundary until UI-08; the contract's own note says it is "worth surfacing in
   * the UI" for exactly this reason.
   *
   * The public `GET /agents` excludes unregistered agents entirely, which is why
   * this flag exists only here: the seller's list is the one screen that has to
   * show an agent buyers cannot see.
   */
  listed: boolean;
}

/**
 * `GET /sales` (api-design §3.4): an order placed against an agent this account
 * owns — the same trade the buyer sees, from the other side.
 *
 * Six fields, and deliberately not `Order`. This type is the **sales list's
 * alone**: the seller's dispute screen reads `GET /orders/:id` directly, which
 * api-design §3.4 authorises for the buyer *or* the agent's owner, so nothing
 * here has to stand in for a full order. Declaring fewer fields than arrive is
 * safe; declaring more is what renders blank.
 *
 * `id` is the **order** id, not a separate sale id. It is what `/sell/sales/:id`
 * carries and what all three of the dispute screen's reads are keyed on.
 *
 * `disputedAt` is carried as a fact rather than inferred from `state`, on the
 * reasoning `ConcludedFace` already uses: it is true from the moment a complaint
 * is filed and stays true through every state after it, so a state added later
 * in the lifecycle cannot silently mislabel a row. Testing `state === 'settled'`
 * instead would miss a dispute still in flight.
 *
 * There is no `buyerAddress`. The seller learns what was ordered, what it cost,
 * and what was ruled — not who bought it.
 */
export interface Sale {
  id: string;
  agentName: string;
  priceMinor: Cents;
  state: OrderState;
  createdAt: string;
  disputedAt: string | null;
}

/**
 * `POST /agents` (api-design §3.3): one agent and its version 1, in one request.
 *
 * Maps field for field onto `agent_versions` (database-schema §3.4), which is
 * why this is a transcription rather than a design. Two omissions are
 * deliberate, and both are a refusal to hold a second opinion:
 *
 * - **No `timeoutSeconds`.** The column defaults to 120 and the form does not
 *   collect it.
 * - **No `active`.** `agents.active` defaults to `true`. A client-supplied
 *   value would be a second authority over whether a brand-new listing is live,
 *   and the availability control is how it is changed afterwards.
 *
 * `inputSchema` and `outputSchema` are `Record<string, unknown>` rather than
 * `JsonSchema`. `JsonSchema` describes the slice of the vocabulary this app
 * *reads* when it builds a buyer's form; what a seller types into a raw
 * textarea is arbitrary JSON, and narrowing it here would claim this app
 * validated something it deliberately does not (research R12 — the backend
 * validates schemas, API-06 scopes it, and a client-side validator would be the
 * second opinion that eventually disagrees).
 *
 * **This type only ever travels outward.** `createAgent` discards its response,
 * so `systemPrompt` and `model` are written once and never read back — which is
 * what makes the no-prompt-rendering guarantee structural rather than
 * remembered.
 */
export interface CreateAgentRequest {
  name: string;
  description: string;
  priceMinor: Cents;
  capabilities: string[];
  exclusions: string[];
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  systemPrompt: string;
  model: string;
}

/**
 * `PATCH /agents/:id/active` (api-design §3.3).
 *
 * **An absolute value, never a toggle instruction**, and the distinction is
 * load-bearing rather than stylistic. Sending the state we want makes this call
 * idempotent in the literal sense — applying it twice leaves the world exactly
 * as applying it once did — which is why the non-idempotency doctrine that
 * governs `POST /orders` and the three money POSTs explicitly does not extend
 * to it (see `./agents.ts`). A server-side toggle would make a duplicate
 * request undo the first one, and silence would become unresolvable.
 */
export interface SetAgentActiveRequest {
  active: boolean;
}
