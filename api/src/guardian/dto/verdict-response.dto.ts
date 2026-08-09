/**
 * `GET /orders/:id/verdict` — the wire shape of a Guardian ruling
 * (`specs/009-guardian-audit-engine/contracts/verdict-api.md` §2,
 * `docs/api-design.md` §3.4).
 *
 * This is the screen the whole product argues toward: a tier, its reasoning,
 * and a ✓/✗ checklist of the clauses the ruling rests on. It is also the one
 * place Guardian's prose reaches a buyer, which is why every decision below is
 * about *not* letting anything else travel with it.
 *
 * ## ⚠️ THREE FIELD NAMES ARE READ LITERALLY, AND A RENAME DOES NOT THROW
 *
 * `source`, `quote` and `met` on {@link CitationResponse} are consumed
 * character for character by `ui/src/api/types.ts`'s `RawCitation` and by
 * `ui/src/lib/verdict.ts`'s `normaliseVerdict`. Every field on that type is
 * declared `?: unknown`, deliberately — `verdicts.citations` is `jsonb` with no
 * schema behind it, so the client refuses to promise a shape it has not
 * checked. The consequence is the failure mode this comment exists for:
 *
 * > **A renamed field does not throw.** `citation.clause` arrives as
 * > `undefined`, `normaliseStatus(undefined)` answers `unrecorded`, and the
 * > checklist row renders blank or the panel disappears entirely — a tier with
 * > no evidence under it, which is precisely the *"an AI decided this"*
 * > assertion the citation checklist exists to prevent.
 *
 * It is the identical rule `orders/dto/case-file.dto.ts` states about its own
 * fields, for the identical reason, and it is worth restating rather than
 * cross-referencing because the two files fail the same silent way: an absent
 * panel on the evidence screen, a green build, and a passing test suite.
 *
 * ⚠️ **The clause text is `quote`, not `clause`.** The client renames it to
 * `clause` on the *rendered* `Citation` and says so in writing
 * (`ui/src/api/types.ts`: *"Named `quote` because that is what the API sends"*).
 * Matching this file to the rendered name would null every citation on the page.
 *
 * ## Closed interfaces, no index signature, no `extends` from an entity
 *
 * Same construction as `orders/dto/case-file.dto.ts` and
 * `catalog/agent-listing.dto.ts`. `return { ...verdictRow }` must remain a
 * compile error here above all — see `verdict-serialiser.ts`, which is where
 * the guarantee is actually made, by its parameter type rather than by care.
 *
 * ## ⚠️ Both parties receive THIS type. There is no redacted variant.
 *
 * The buyer and the owner of the agent the order was placed against get the
 * same bytes. `docs/api-design.md` §3.4: *"A seller ruled against who cannot
 * read the ruling has no idea what they were found to have done."* Unlike the
 * case file, which genuinely has two shapes, this file declares **one** — and a
 * second, thinner one must never be added. See `verdict.controller.ts`.
 */

/**
 * One clause of the case file the ruling leans on, quoted back.
 *
 * Mirrors `verdict.schema.ts`'s `CitationSchema` exactly, because it *is* that
 * document: the row was written from a successful parse of that schema and is
 * read back out unchanged.
 */
export interface CitationResponse {
  /**
   * ⚠️ **Literal.** Not `clause`, not `type`, not `kind`.
   *
   * Which list the quote came from — and therefore which list
   * `verdict-validation.ts` traced it against, since a `capability` quote is
   * not allowed to be satisfied by an exclusion that happens to share words.
   *
   * The client widens this to `string` on its side and renders an unfamiliar
   * origin rather than dropping the row, so a sixth source added upstream
   * degrades gracefully. That is the client being generous; it is not licence
   * to send something other than these three.
   */
  source: 'capability' | 'exclusion' | 'criterion';

  /**
   * ⚠️ **Literal.** The clause text as the auditor quoted it, verbatim.
   *
   * Not trimmed, not case-folded, not normalised. The normalisation
   * `verdict-validation.ts` performs exists for *comparison* and is never
   * written back (`verdict.schema.ts`, closing note): the stored row must be
   * the ruling that was actually made, and the verdict hash commits to these
   * bytes.
   */
  quote: string;

  /**
   * ⚠️ **Literal.** `true` = the delivery met this clause. This is what drives
   * the ✓/✗.
   *
   * The model's own reading, recorded rather than recomputed. Note that the
   * client maps a **missing or non-boolean** value to `unrecorded` and never to
   * `met` — guessing in that direction would fabricate a passed clause, and
   * guessing the other way would fabricate a failed one and defame a seller. So
   * a rename here does not produce a wrong tick; it produces a checklist of
   * rows that record nothing, which is worse than an error because it looks
   * like a ruling.
   */
  met: boolean;
}

/**
 * The ruling on one disputed order. `ui/src/api/types.ts`'s `Verdict`, before
 * that file's normaliser has looked at it.
 *
 * ⚠️ **What is deliberately absent is as load-bearing as what is present.**
 * There is no `id`, no `orderId`, and above all no `verdictHash`. The hash is
 * an anchoring detail a buyer cannot recompute; rendering it would push this
 * card back towards *"a machine decided this"*, which the citation checklist
 * exists to prevent. `model` is here because
 * `specs/009-guardian-audit-engine/contracts/verdict-api.md` §2 puts it on the
 * wire for reproducibility; the client declares no field for it and ignores it,
 * and that is fine — declaring fewer fields than arrive is safe, declaring
 * different ones is not.
 */
/**
 * ⚠️ **`txHash`, not `onchainTxHash`.** The column is `verdicts.onchain_tx_hash`
 * and an earlier draft of `contracts/verdict-api.md` §2 named the wire field to
 * match it. The client does not: `ui/src/lib/verdict.ts`'s `normaliseVerdict`
 * reads `raw.txHash`, and `ui/src/api/types.ts` declares `txHash: string | null`.
 *
 * A mismatch here does not throw — it renders as a missing proof link on the one
 * screen whose purpose is to show the ruling is real, which is precisely the
 * failure class this file's field-naming rule exists to prevent. The UI ships
 * and is the existing consumer, so the API matches it and the contract was
 * corrected rather than the client.
 */
export interface VerdictResponse {
  /**
   * ⚠️ **The DATABASE vocabulary, not the wire percentages the model emitted.**
   *
   * There are three vocabularies for the same five outcomes and
   * `verdict.schema.ts` tabulates all three: the model answers `'0'`…`'100'`,
   * the database stores `none`…`full`, and the escrow contract takes a `Tier`
   * enum. This field is the **database's**, which is also what
   * `ui/src/lib/verdict.ts`'s `tierDisplay` switches on to produce the
   * percentage badge. Sending `'75'` here would render as an unknown tier with
   * a blank percentage and the literal string `75` as its phrase — no error,
   * just a wrong-looking card.
   *
   * The client types its own copy as `string` rather than this union on
   * purpose, so a sixth tier is a display fallback there and a compile error
   * only inside `tierDisplay`. This end declares the union because this end
   * knows: it read the column.
   */
  tier: 'none' | 'quarter' | 'half' | 'three_quarter' | 'full';

  /**
   * The refund in whole USD cents (invariant #2).
   *
   * ⚠️ **A record of the ruling, not a payment instruction.** The escrow
   * computes and pays the real split on-chain from basis points
   * (`GuardianEscrow.sol`'s `_refundBps`); nothing downstream of this field
   * moves money. It is on the wire so that the verdict screen and the order
   * screen agree without either re-deriving it — and re-deriving it is exactly
   * what must not happen, because a quarter of 199 cents is 49.75 and two
   * independent roundings of that eventually disagree in front of an audience.
   * The seller's share is `order.priceMinor - refundMinor` and nothing else.
   *
   * `0` is a legitimate value: a `none` verdict refunds nothing, which is why
   * the column's CHECK is `>= 0` and not `> 0`.
   */
  refundMinor: number;

  /**
   * Guardian's explanation of the ruling, verbatim.
   *
   * ⚠️ Model prose, reaching the buyer through no redaction. It is safe here
   * only because `verdict-validation.ts`'s leak check ran against this exact
   * string before the row was written; nothing on this read re-checks it, and
   * nothing on this read should — a second, weaker check downstream of a
   * committed row would create the impression of a gate where there is none.
   */
  reasoning: string;

  /**
   * The clauses the ruling rests on, in the auditor's order.
   *
   * **Never empty.** FR-011 is an API-level guarantee rather than a check:
   * `minItems: 1` is one of the few constraints that survives the SDK's schema
   * transform, so a zero-citation ruling is not representable on the wire and
   * the row could not have been written from one (`verdict.schema.ts`).
   *
   * Required and never optional. The column defaults to `[]`, so the array may
   * in principle be empty for a row written by some future path, and an empty
   * list is a statement the screen makes rather than a section that silently
   * fails to render.
   */
  citations: CitationResponse[];

  /**
   * The settlement transaction, or `null`.
   *
   * ⚠️ **Its null is meaningful and is not an error.** It means the ruling
   * exists and is final, and the chain call has not confirmed — the invariant
   * #8 window, made visible: `guardian.service.ts` commits the verdict *before*
   * calling `resolve`, precisely so a chain failure leaves a readable ruling
   * rather than destroying one that cannot be reproduced.
   *
   * **The client renders the ruling and omits the proof link. It never
   * withholds the ruling.** A screen that waited for this field before showing
   * a tier would hide a final decision behind an unrelated network's
   * confirmation time.
   *
   * ⚠️ Note for whoever reconciles this with the client: `ui/src/lib/verdict.ts`
   * currently reads `raw.txHash`, while
   * `specs/009-guardian-audit-engine/contracts/verdict-api.md` §2 — the contract
   * this file implements — names the field `txHash`. The contract wins
   * here; the divergence renders as a permanently absent proof link and is
   * exactly the class of defect §7 of that document says API-12 must
   * reconcile. Do not "fix" it by renaming this field without changing the
   * contract, or the two will simply swap which side is wrong.
   */
  txHash: string | null;

  /**
   * The model that produced this ruling, recorded per verdict (FR-016) so a
   * stored row always says what judged it even after `GUARDIAN_MODEL` changes.
   */
  model: string;

  /** ISO-8601. When the ruling was written, not when it settled. */
  createdAt: string;
}
