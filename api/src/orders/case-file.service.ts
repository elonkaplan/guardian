import { Injectable } from '@nestjs/common';

import type {
  BuyerCaseFileResponse,
  ExecutionStep,
  SellerCaseFileResponse,
} from './dto/case-file.dto';
import { OrderRepository } from './order.repository';
import { toBuyerCaseFileSteps } from './order-serialiser';
import { OrderNotVisibleError } from './orders.errors';

/**
 * `GET /orders/:id/case-file` — the evidence, in the two shapes it has
 * (`specs/007-orders-purchase-saga/contracts/internal-api.md` §4).
 *
 * The one route in the product that returns different content to different
 * callers, and the only mapping in `orders/` that is allowed to emit
 * `systemPrompt`. Everything difficult about this file follows from those two
 * sentences being about the same route.
 *
 * ## ⚠️ Why this is a SEPARATE FILE from `order-serialiser.ts`
 *
 * That module is the choke point every buyer-facing order shape passes through,
 * and what makes it a choke point is not that mappers live there — it is that
 * its parameter types have **no `systemPrompt` property**. No expression inside
 * it can read the field, whatever a later edit does to its bodies.
 *
 * The seller's case file must carry the prompt. A mapper that must see a field
 * cannot be written against a type defined by not having it, so putting
 * `toSellerCaseFile` in the serialiser would mean widening a parameter type
 * there — and the module would stop being *"the place that structurally cannot
 * leak"* and become *"the place that mostly does not leak, depending which
 * function you are in"*. So the mapping that needs the field lives out here,
 * next to the route that needs it, and the serialiser keeps its guarantee.
 *
 * This is exactly the relationship `catalog/agent-versions.service.ts` has with
 * `catalog/agent-serialiser.ts`, and it is the arrangement that file's own
 * doc-comment predicts for this feature. It costs a file, and it makes each
 * file's invariant a property of the file rather than of a reviewer's attention:
 *
 * > `grep systemPrompt src/orders/order-serialiser.ts` must return **nothing**.
 *
 * That is the assertion. Across the whole orders module the field appears in
 * exactly four places, all of them on the seller's path: the `addSelect` in
 * `findCaseFileForSeller`, the `SellerCaseFileRow` member it lands in,
 * `SellerCaseFileResponse`, and the one `getForSeller` line below.
 *
 * ## ⚠️ The ROUTE branches on the caller; the SERIALISER does not
 *
 * 006 FR-030 forbade one route branching on the caller. This feature's FR-035
 * requires exactly that — `useCaseFile` reads one path for both parties. The
 * tension is real, and it resolves by being precise about *which layer* must not
 * branch (research R10, contracts §4):
 *
 * | Layer   | Branches? |
 * | ------- | --------- |
 * | Route   | **yes** — after the caller's role is already resolved and checked |
 * | Query   | **yes** — the buyer's `SELECT` does not name `system_prompt` |
 * | Mapper  | **no** — two closed methods, neither with a mode flag; the buyer's row type has no such member |
 *
 * What 006 was protecting is the mapper: a conditional deciding what a caller
 * may see is a disclosure bug waiting to happen, because the bug is one operator
 * away and reviews read `if (isSeller)` as ordinary code. That property holds
 * here — the two methods below share no code and take no flag, and
 * `getForBuyer`'s row type is `CaseFileRow`, which has no `systemPrompt` member
 * to emit even under a hostile edit.
 *
 * Pushing the branch down into the **query** is stronger than the mapper
 * guarantee alone: on a buyer's read the prompt never enters the process, so it
 * cannot reach a log line, an error message or a stack trace either — none of
 * which pass through a mapper.
 *
 * ## ⚠️ `getForSeller` is a disclosure, and its precondition is not checked here
 *
 * The repository's `accountId` predicate admits the buyer **or** the agent's
 * owner. It is the **visibility** check — "may this account see this order at
 * all" — and it is emphatically not the **disclosure** check. Calling
 * `getForSeller` for a buyer would hand that buyer the seller's prompt, and the
 * query would happily return it, because the buyer is a party to the order.
 *
 * So: **the caller must have already established that the requester owns the
 * agent the order was placed against.** That resolution belongs to the route,
 * one level up, where the caller's identity is known — this class is given an
 * `accountId` and cannot re-derive the role from it without a second query whose
 * answer the route already has.
 *
 * The reason it is stated here rather than only there is that a case file is
 * exactly what a buyer disputes an order to get: making a frivolous complaint a
 * route to a competitor's prompt is the specific attack invariant #3 exists to
 * defeat, and it costs the price of one order.
 *
 * ## Errors
 *
 * `null` from either query means "no such order" **or** "you are party to
 * neither side", deliberately indistinguishable — one class, one `404`, one body
 * byte for byte (FR-036, R7). There is nothing here to branch on even if
 * somebody wanted to, which is the point of `OrderNotVisibleError` being a
 * single class.
 *
 * A missing **run** is not an error and never a `404`: an order in any state
 * produces a case file, and for one that never ran the absence *is* the evidence
 * (FR-040).
 */
@Injectable()
export class CaseFileService {
  constructor(private readonly orders: OrderRepository) {}

  /**
   * The buyer's copy — complete for what a buyer is owed, and structurally
   * incapable of carrying the seller's prompt.
   *
   * `capabilities` and `exclusions` come off the **pinned** version, never the
   * agent's current listing (FR-039). A seller who lost a dispute has every
   * reason to edit the capability that was cited against them, and explaining a
   * ruling with today's listing would break the trace from a citation to its
   * source — quietly, and in the one direction that looks like the platform
   * covering for the seller. The query resolves them through
   * `orders.agent_version_id`, so this is true by construction rather than by
   * this method being careful; it is restated because the wrong version is one
   * join away and would type-check perfectly.
   *
   * ⚠️ **`output` is `row.runOutput`, and `null` is CONTENT.** An order that has
   * not run, and an order whose agent returned nothing, both arrive here as
   * `null`, and neither is an error condition to throw on. `runs.output IS NULL`
   * is the non-delivery evidence invariant #7 rests on — the whole reason the
   * screen exists is to say *"nothing came back"*, and a `404` or a thrown error
   * would replace that sentence with silence on the one screen whose purpose is
   * to break it.
   *
   * ## ⚠️ `steps` is the REDACTED trace, and getting here cost a layer
   *
   * This method used to return `[]` unconditionally, and while no `runs` row
   * existed that was an accurate statement rather than a placeholder. API-08
   * ships runs; the empty array became a silent omission of evidence
   * `api-design.md` §1.3 says the buyer is owed, on the one screen where a buyer
   * decides whether they were treated fairly — see
   * `docs/ESCALATION-buyer-case-file-steps.md` for how the decision was reached.
   *
   * **The change is a deliberate weakening of one layer of three, and this is
   * the diff that says so.** Layer 1 was the select list: `findCaseFileForBuyer`
   * did not name `r.steps`, so the raw jsonb never entered the process on a
   * buyer's read — the only layer that also covers a log line, an error message
   * and a stack trace, none of which pass through a mapper. `reasoning` lives
   * inside the same jsonb column as the fields the summary is composed from, so
   * that layer cannot separate them: it was the whole trace or none of it.
   *
   * What still holds the boundary, and what to check before touching this line:
   *
   * - **Layer 2 — `toBuyerCaseFileSteps`.** Reads `kind`, `label`, `durationMs`
   *   and `error` by name, one property at a time, and never `reasoning`. It
   *   composes `summary` from structure rather than from prose, so there is no
   *   code path from the model's text to a buyer's response.
   * - **Layer 3 — `CaseFileStepResponse`.** Closed, four fields, no index
   *   signature: a fifth has nowhere to land, and a spread is a compile error.
   *
   * ⚠️ **`row.runSteps` is now in scope on a buyer's path, and only
   * `toBuyerCaseFileSteps` may read it.** Passing it anywhere else — a log line,
   * an error, `rawSteps`, a spread — puts `reasoning` in front of a buyer and
   * breaks invariant #3. It is typed `unknown[]` rather than `ExecutionStep[]`
   * precisely so that nothing here can reach a field by name.
   *
   * `runError` and `runDurationMs` are fetched and not emitted: the buyer's
   * response type declares neither — the UI's `CaseFile` does not — and
   * per-step `error` and `durationMs` are how a failure and its timings reach
   * the screen. Emitting run-level ones means widening a closed interface, which
   * is a decision about the contract rather than a convenience.
   */
  async getForBuyer(orderId: string, accountId: string): Promise<BuyerCaseFileResponse> {
    const row = await this.orders.findCaseFileForBuyer(orderId, accountId);

    if (row === null) {
      // The message is for the log. Whatever the controller renders must be
      // identical for "no such order" and "not your order" — including the
      // words — or the existence oracle is back with extra steps.
      throw new OrderNotVisibleError(
        `order ${orderId} not visible to account ${accountId}`,
        orderId,
      );
    }

    return {
      // `orders.input` — what the buyer paid for — not `runs.input`. The two are
      // the same document in the MVP and answer different questions, and the
      // order's copy exists for an order that failed to open or never ran.
      input: row.input,
      acceptanceCriteria: row.acceptanceCriteria,
      capabilities: row.capabilities,
      exclusions: row.exclusions,
      output: row.runOutput,
      // ⚠️ The redaction, and the only read of `runSteps` on this path. Not
      // `row.runSteps`, not a cast, not a spread — see the warning above.
      steps: toBuyerCaseFileSteps(row.runSteps),
    };
  }

  /**
   * The seller's copy — the buyer's, plus the two things that are theirs.
   *
   * **This is not a leak, and the distinction is the whole feature.** The
   * boundary `systemPrompt` sits behind is about *buyers*. Here the caller is
   * the seller reading their own IP, in a dispute they are being asked to
   * answer and have no right of reply to; a seller who cannot see the prompt
   * that ran and the reasoning it produced has been notified of an accusation
   * they may not examine. Withholding it from its author would be theatre.
   *
   * ⚠️ **Only call this once the caller is confirmed to be the agent's OWNER.**
   * See the class comment: the repository's `accountId` predicate admits the
   * buyer too.
   *
   * `steps` **and** `rawSteps`, not one instead of the other: the seller sees
   * the same redacted list the buyer and the auditor were shown, beside the raw
   * record, so they can tell what was cited against them from what was not.
   *
   * ⚠️ **The `as ExecutionStep[]` is an unchecked assertion, and it is
   * acceptable here and nowhere on a buyer's path.** `runs.steps` is jsonb that
   * nothing has validated — API-08 writes it, and no read path checks the shape
   * back — so this is a claim about a document this process has never seen.
   * `toBuyerCaseFileSteps` refuses to make that claim and re-reads every field
   * defensively; this line makes it because the value is going back to its own
   * author. A malformed step here shows a seller their own bad data on their own
   * screen. The same assertion on the buyer's side would be a shape the type
   * system believes and the redaction does not.
   *
   * `?? []` because the `LEFT JOIN` yields `null` for an order that never ran,
   * and `rawSteps` is declared non-optional: an empty trace is a fact the screen
   * states.
   */
  async getForSeller(orderId: string, accountId: string): Promise<SellerCaseFileResponse> {
    const row = await this.orders.findCaseFileForSeller(orderId, accountId);

    if (row === null) {
      throw new OrderNotVisibleError(
        `order ${orderId} not visible to account ${accountId}`,
        orderId,
      );
    }

    return {
      input: row.input,
      acceptanceCriteria: row.acceptanceCriteria,
      // From the PINNED version, exactly as on the buyer's copy — both parties
      // are shown the same yardstick, or a dispute has two rulebooks.
      capabilities: row.capabilities,
      exclusions: row.exclusions,
      output: row.runOutput,
      steps: toBuyerCaseFileSteps(row.runSteps),
      // ⚠️ The one line in `orders/` that emits a system prompt. The PINNED
      // version's, not the agent's current one: the dispute is about what ran.
      systemPrompt: row.systemPrompt,
      rawSteps: (row.runSteps ?? []) as ExecutionStep[],
    };
  }
}
