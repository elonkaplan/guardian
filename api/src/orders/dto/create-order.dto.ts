import { z } from 'zod';

/**
 * The body of `POST /orders` — the whole of a purchase
 * (`specs/007-orders-purchase-saga/contracts/internal-api.md` §1).
 *
 * ⚠️ **Every field name is literal, and the client is already shipped.**
 * `ui/src/api/types.ts` declares `CreateOrderRequest` with exactly these three
 * strings and `BuyPanel` posts against them today. A renamed key here does not
 * fail loudly on either side — it arrives as `undefined`, which surfaces as a
 * missing-field `400` on a form the buyer visibly filled in. Copy from the
 * contract rather than retyping from memory.
 *
 * **Note what a buyer cannot send, and that the absence is the enforcement.**
 * There is no `priceMinor` and no `reviewWindowSeconds` (FR-021). The price is
 * a snapshot the service takes from the version it charges against, and the
 * window comes from backend configuration; a client-supplied figure for either
 * would be an invitation to pay a number of one's own choosing, or to grant
 * oneself a review window of a century. The request has nowhere to put them, so
 * no form and no handler can develop the habit of sending them. There is no
 * `buyerAccountId` either — the caller *is* the buyer, and a body that could
 * name someone else would let one account spend another's balance.
 *
 * **This schema is the cheap half of validation, and it says so out loud.**
 * Passing it means the body is well-formed, not that the purchase is possible.
 * The agent may not exist, may be inactive, may be unregistered on-chain; the
 * balance may be below the price; `input` may not satisfy the version's
 * `inputSchema`. All of those are state questions, answered inside the service
 * after rows are read (§1's failure table: `404`, `402`, `400` naming `input`).
 * What is bought here is that a malformed body never reaches the saga at all —
 * the same argument `zod-validation.pipe.ts` makes in full: nothing is read,
 * nothing is debited, no escrow call is attempted for a request that was never
 * shaped like a purchase.
 */
export const createOrderSchema = z.object({
  /**
   * The **agent's** uuid — not a version's, and not the order's.
   *
   * ⚠️ **The request names an agent; the record names a version.** The order
   * row that results stores `agent_version_id`, pinning whichever definition
   * was current at the instant of purchase, and it never stores the agent id at
   * all. That is not an inconsistency to be tidied up — it is the mechanism.
   * A buyer buys "this listing", which is a thing that can be republished
   * underneath them; the platform must judge them against the exact promise,
   * price and timeout they bought, so it resolves the agent's latest version
   * once, at checkout, and freezes it. A seller who republishes between the
   * buyer opening the page and pressing buy changes nothing about the order
   * that was already placed (spec §154, FR-041). The seller of the order is
   * likewise resolved *through* the pinned version back to the agent's current
   * owner, which is why no seller identity is copied onto the order either.
   *
   * Accepting a version id here instead would let a buyer purchase a definition
   * the seller had already withdrawn, by pasting an id out of an old case file.
   *
   * `z.uuid()` — zod 4's top-level format spelling. `z.string().uuid()` still
   * exists in 4.4.3 and is marked `@deprecated`; both compile today and only one
   * of them will still be here later, the same reasoning `zod-validation.pipe.ts`
   * applies to `z.flattenError`. The check is deliberately format-only: it turns
   * `"banana"` into a `400` carrying `fieldErrors.agentId` (§1's failure table)
   * before TypeORM is asked to compare a non-uuid against a `uuid` column, which
   * is a driver-level `500` describing nothing a client can act on. A
   * well-formed uuid naming no agent is a different answer — `404`, from the
   * service, and one answer for the three separate facts "unknown", "inactive"
   * and "unregistered on-chain", as `catalog.errors.ts` requires.
   */
  agentId: z.uuid(),

  /**
   * The buyer's input for the run. **Deliberately passed through unvalidated**,
   * and this is the single most important comment in the file.
   *
   * ⚠️ The real check on this value is against the purchased version's
   * `input_schema` — a JSON Schema document stored in the database, written by
   * the seller, different for every agent and every version of every agent.
   * That row cannot be known here: which version applies is decided *by* this
   * request, several steps into the service, after the agent has been resolved
   * and its latest version pinned. So there are exactly three things this line
   * could be, and only one of them is honest:
   *
   *  - **A second, weaker opinion about the shape.** Any concrete Zod shape
   *    written here would be a guess at a document only the seller has seen. It
   *    would refuse valid input for some agents and accept invalid input for
   *    others, and the failure it produces is the expensive kind: a `400` from
   *    the wrong authority, contradicting the schema the buyer's form was
   *    actually generated from.
   *  - **Nothing at all** (`z.unknown()`), which would let a string or an array
   *    through to a `jsonb` column typed `Record<string, unknown>` and move the
   *    complaint to TypeORM.
   *  - **A structural check and no more**, which is what this is: "is this a
   *    JSON object with string keys" — exactly what the column will hold and
   *    what the entity types. It rejects `"hello"`, `42` and `[]`, and nothing
   *    subtler.
   *
   * **The service does the real check**, with Ajv, against the pinned version's
   * `input_schema`, and refuses with a `400` whose body names the field:
   * `fieldErrors.input`, carrying Ajv's message and its JSON Pointer so the
   * buyer's form can point at the offending property (§1's failure table). No
   * order row is written and no money moves on that branch. This is the same
   * split `create-agent.dto.ts` documents for `inputSchema`/`outputSchema` —
   * Zod guards the HTTP boundary, Ajv answers a question about meaning — turned
   * around: there, Zod checks the schema is an object and Ajv checks it is a
   * schema; here, Zod checks the input is an object and Ajv checks it satisfies
   * that schema.
   *
   * ⚠️ Do not "strengthen" this line. Anything more specific is the first
   * bullet above wearing a better name.
   *
   * `z.record(z.string(), z.unknown())` takes both a key and a value schema:
   * zod 4 requires the two-argument form, and the one-argument `z.record(v)` of
   * zod 3 no longer type-checks. Same spelling as `create-agent.dto.ts` uses,
   * for the same `jsonb` destination.
   */
  input: z.record(z.string(), z.unknown()),

  /**
   * What the buyer says a good delivery would be. Free prose, no schema — there
   * cannot be one, because it is the buyer's own words.
   *
   * **Why this is required at all, rather than optional with a sensible
   * default.** It is one half of the standard a later dispute is judged
   * against; the seller's listing promise (`capabilities` and `exclusions` on
   * the pinned version) is the other half, and the auditor weighs the delivery
   * against both together with the complaint's `reason`. A buyer who never said
   * what they wanted has only the seller's half on the record, and so has a
   * much weaker case — which is the correct outcome, and precisely why the field
   * cannot be optional: the platform must not let a buyer arrive at a dispute
   * having accidentally supplied no standard to be judged by, and then discover
   * it at the moment it costs them the money. FR-004 makes it required at
   * checkout for that reason. This is a purchase-time field, not an afterthought
   * bolted onto the dispute form.
   *
   * ⚠️ `.trim().min(1)` and not `.min(1)` — the order matters and it is applied
   * in that order. Criteria of three spaces are criteria the buyer did not
   * write; they satisfy `.min(1)` and satisfy nothing else. They would be stored
   * `NOT NULL` and non-empty, survive every later check, and then present the
   * auditor with a blank standard at the one moment it is load-bearing.
   * Trimming first turns whitespace-only into the `400` it always was, carrying
   * `fieldErrors.acceptanceCriteria` (§1's failure table, spec scenario 8).
   * Same rule and same reasoning as `name` in `create-agent.dto.ts`.
   *
   * ⚠️ **These criteria are NEVER matched against the listing's promise at
   * purchase time, and that omission is deliberate — FR-004 states it as a
   * prohibition, not merely as silence.** A buyer may demand something the
   * listing never claimed, and the order goes through anyway. The mismatch is
   * judged at dispute time, where it produces a 0% verdict on the explicit
   * grounds that the seller never promised it (spec scenario 10) — the seller
   * keeps the money and the record says why.
   *
   * Purchase-time matching was considered and rejected. It would require the
   * platform to decide, at checkout, whether one piece of free prose is
   * "covered by" a list of capability strings — a semantic judgement, which is
   * the auditor's entire job and needs the delivery in hand to make. Getting it
   * wrong at checkout blocks a legitimate purchase with a refusal no buyer can
   * act on ("your criteria do not match the listing" — how?), and it moves an
   * expensive judgement onto the hot path of every single purchase. Getting it
   * wrong at dispute time costs one verdict, on evidence, with reasons attached.
   * **Do not add a validation for it here.**
   */
  acceptanceCriteria: z.string().trim().min(1),
});

/**
 * The parsed body. Inferred rather than declared, so the type cannot disagree
 * with the schema that produced it — there is no second place to update, and no
 * chance of a hand-written interface still listing a field the schema stopped
 * accepting.
 *
 * ⚠️ This is the **output** type, so `acceptanceCriteria` is the *trimmed*
 * string, not the one that arrived. A handler holding one of these is holding
 * the value that will be stored — `ZodValidationPipe` returns `result.data` and
 * not the original body for exactly this reason.
 */
export type CreateOrderDto = z.infer<typeof createOrderSchema>;
