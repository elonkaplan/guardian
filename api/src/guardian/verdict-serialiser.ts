import type { VerdictTier } from '../entities/enums';
import type { CitationResponse, VerdictResponse } from './dto/verdict-response.dto';

/**
 * ⚠️ **The guardian module's serialisation boundary** — the sibling of
 * `orders/order-serialiser.ts` and `catalog/agent-serialiser.ts`, built the same
 * way and for the same reason (contracts §6).
 *
 * One function, over a row type, naming every field it emits.
 *
 * ## ⚠️ Why a file rather than a method on the service
 *
 * `orders/order-serialiser.ts` answers this at length and the answer transfers
 * verbatim: **the guarantee comes from the parameter type having no dangerous
 * member, not from the mapper being careful.** A method on `VerdictService` sits
 * in a class that holds an `OrderRepository` and a `Repository<Verdict>`; every
 * order row, every entity, every joined column is one expression away. A free
 * function whose only parameter is {@link VerdictRow} can emit nothing else,
 * whatever a later edit does to its body.
 *
 * ## ⚠️ Never spread a row. `return { ...verdictRow }` must stay impossible.
 *
 * The dangerous line is not the one you would write on purpose:
 *
 * ```ts
 * return { ...verdictRow, ...orderRow };   // ⚠️ must remain a compile error
 * ```
 *
 * An order row carries `buyerAccountId` — a seller learns *what* was ordered and
 * never *who* ordered it — and an agent version row carries `systemPrompt`,
 * which is the seller's craft and the thing a frivolous complaint is filed to
 * extract (invariant #3). This response is the one place Guardian's prose
 * reaches a buyer, so it is the last place a spread should be possible.
 *
 * Three independent things make it impossible, exactly as in the two sibling
 * files:
 *
 * **1. The parameter type is a row, not the entity.** {@link VerdictRow} has no
 * `verdictHash`, no `orderId`, no `order` relation, and no `id`. A `Verdict`
 * entity is structurally assignable to it — which is allowed and still safe,
 * because widening what this function *may* emit means editing the interface at
 * the bottom of this file, in a diff that says so.
 *
 * **2. The return type is closed.** `VerdictResponse` is an exact interface with
 * no index signature and no `extends` from an entity, so the excess-property
 * check refuses an object literal carrying anything else.
 *
 * **3. The types do not line up for a spread anyway.** `createdAt` is a `Date`
 * on the row and a `string` on the wire, and `citations` is `unknown[]` on the
 * row. A spread fails to compile before anyone has to notice it is wrong.
 *
 * ## ⚠️ `citations` passes through with NO RESHAPING
 *
 * Not renamed, not filtered by `met`, not sorted, not deduplicated, not trimmed.
 *
 * It was validated on the way in — `verdict.schema.ts` §4's `CitationSchema`
 * parse, then `verdict-validation.ts`'s traceability gate — and stored verbatim,
 * and that file states the rule this one obeys: *"A citation that cannot be
 * traced fails the whole audit; it is never quietly removed from a ruling whose
 * `reasoning` may still argue from it."*
 *
 * Transforming it here would mean the buyer and the seller read something other
 * than the ruling that was made. Two concrete consequences, both of which look
 * like improvements in a diff:
 *
 * - **Filtering to `met === false`** would produce a checklist of only the
 *   failures. The screen's claim is that every mark on it came from the ruling,
 *   and a list of what was breached with the satisfied clauses deleted is an
 *   argument, not an audit.
 * - **Sorting** would break replay (contracts §5, FR-025, SC-005). Repeated
 *   reads must return byte-identical `tier`, `reasoning` and `citations`, and
 *   the order is the auditor's own — the `reasoning` above frequently refers to
 *   the clauses in the sequence it cited them.
 *
 * There is no recomputation path in this module and this file must not become
 * the first one.
 *
 * ## No `@Injectable`, no class
 *
 * A pure function, like both sibling serialisers. Nothing here reaches a
 * database, a clock or a chain, so nothing here needs a lifetime — and a mapper
 * that cannot be given a dependency cannot grow a code path to a value its
 * parameter type does not contain.
 */

/**
 * `GET /orders/:id/verdict` — one stored ruling, on the wire (contracts §2).
 *
 * ⚠️ **Both parties get the value this returns, byte for byte.** There is no
 * seller variant and no buyer variant, so there is deliberately no second
 * function here and no mode flag on this one — the construction
 * `orders/order-serialiser.ts` uses for `toBuyerOrderSummary` / `toSaleResponse`
 * is *two* branchless functions, and the reason there were two is that the two
 * projections genuinely differ. These do not. See `verdict.controller.ts` for
 * why they must not.
 *
 * ⚠️ **`tier` is emitted unchanged, not remapped.** `VerdictResponse['tier']` is
 * the database vocabulary spelled out as a literal union for the client, so this
 * is one vocabulary rendered, not two reconciled — and it must stay that way.
 * `verdict.schema.ts` already documents the two hops that *are* translations
 * (wire → database there, database → contract in `chain/tier.ts`) and warns
 * against inventing a third correspondence to keep in step. Emitting the model's
 * percentage strings here would be exactly that, and would render as a tier with
 * a blank percentage badge.
 *
 * **`refundMinor` is a `number` already.** Unlike `orders/order-serialiser.ts`,
 * which converts `priceMinor` from a driver string at this boundary, the
 * `bigint` column arrives converted because the row comes off the entity
 * repository with `bigintTransformer` in the path rather than off a raw
 * `getRawOne`. If this ever changes to a query builder, the conversion belongs
 * here and a JSON string where the client declares a number does not throw — it
 * renders as `NaN` after the first arithmetic on the split.
 */
export function toVerdictResponse(row: VerdictRow): VerdictResponse {
  return {
    tier: row.tier,
    refundMinor: row.refundMinor,
    // Model prose, verbatim. The leak check ran before the row was written;
    // nothing here re-checks it, and nothing here should.
    reasoning: row.reasoning,
    // ⚠️ The one assertion in this file, and it is a claim this module is
    // entitled to make about a document THIS MODULE validated and wrote:
    // `CitationSchema` parsed it and `verdict-validation.ts` traced every quote
    // back to the case file before `insertVerdictAndAdjudicate` was called.
    // Contrast `orders/order-serialiser.ts`'s `toBuyerCaseFileSteps`, which
    // refuses the equivalent assertion and re-reads every field defensively —
    // correctly, because `runs.steps` is jsonb that no validator has ever seen.
    //
    // ⚠️ It is NOT a licence to reshape. The alternative to an assertion here
    // would be a defensive re-read, and a re-read that skipped a malformed
    // element would silently shrink the evidence — which is why the client does
    // the defensive pass instead and *counts* what it could not read
    // (`ui/src/lib/verdict.ts`'s `unreadableCitations`) rather than dropping it.
    // A pre-Guardian row, or one written by hand, arrives here unchanged and is
    // rendered as best the client can, which is the honest outcome.
    citations: row.citations as CitationResponse[],
    // Present and null, never omitted: "the ruling is final and the settlement
    // has not confirmed" is something the screen states by omitting the proof
    // link, not something it leaves out of the payload.
    // ⚠️ The one field whose wire name differs from its column name.
    // Column: `verdicts.onchain_tx_hash`. Wire: `txHash`, because that is what
    // `ui/src/lib/verdict.ts` reads. Mapping it here — rather than renaming
    // either side — is what a serialiser is for.
    txHash: row.onchainTxHash,
    model: row.model,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * The columns `GET /orders/:id/verdict` needs, and **no others**.
 *
 * ⚠️ **The absences are the guarantee** (contracts §6), in the same way
 * `ListingFields` is in `catalog/agent-serialiser.ts` and `CaseFileRow` is in
 * `orders/order.repository.ts`:
 *
 * | Absent | Why |
 * | --- | --- |
 * | `verdictHash` | An anchoring detail a buyer cannot recompute. Rendering it pushes the card back towards *"a machine decided this"* |
 * | `orderId`, `id` | The caller already has the order id; the verdict's own key is nobody's business |
 * | `order` | The relation would put `buyerAccountId` and, through the pinned version, `systemPrompt` one dot away from a mapper |
 *
 * A `Verdict` entity satisfies this interface structurally, which is how the
 * service passes one. That is deliberate and is the same allowance
 * `orders/order-serialiser.ts` documents on `toOrderRun`: passing a wider value
 * is safe precisely because the *function* cannot see past this declaration.
 *
 * `citations` is `unknown[]` because that is what the column is
 * (`jsonb NOT NULL DEFAULT '[]'`) and what `verdict.entity.ts` declares. Typing
 * it `CitationResponse[]` here would move the unchecked claim from one visible
 * line inside the mapper to the type of a shared interface, where nobody reads
 * it.
 */
export interface VerdictRow {
  tier: VerdictTier;
  refundMinor: number;
  reasoning: string;
  citations: unknown[];
  onchainTxHash: string | null;
  model: string;
  createdAt: Date;
}
