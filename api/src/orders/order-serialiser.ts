import type { CaseFileStepResponse } from './dto/case-file.dto';
import type {
  BuyerOrderSummary,
  OrderResponse,
  OrderRunResponse,
  SaleResponse,
} from './dto/order-response.dto';
import type { OrderSummaryRow, VisibleOrderRow } from './order.repository';

/**
 * ⚠️ **The orders module's serialisation boundary — the sibling
 * `src/catalog/agent-serialiser.ts` predicts by name.**
 *
 * That file guards one column. This one guards the thing that made the boundary
 * wider than a column: an execution trace. A reasoning turn can paraphrase the
 * system prompt it was handed without the `system_prompt` column ever being
 * read, so a case file that passed steps through verbatim would leak the
 * seller's craft with invariant #3 still perfectly well enforced everywhere it
 * was written down.
 *
 * The construction carried across from `agent-serialiser.ts` is not the code,
 * it is the three independent failures:
 *
 * **1. The column is never read.** `order.repository.ts` names its columns
 * explicitly and `system_prompt` is absent from every query a buyer reaches. On
 * a buyer's read the prompt does not enter the process at all — the only layer
 * that also protects a log line, an error message and a stack trace, none of
 * which pass through this file.
 *
 * **2. This module cannot see the field.** `VisibleOrderRow` and
 * `OrderSummaryRow` have no `systemPrompt` member, and `toOrderRun` takes a
 * two-member `Pick<>`. No expression below can read a property its parameter
 * type does not declare, whatever a later edit does to the bodies.
 *
 * **3. The return types are closed.** `OrderResponse`, `OrderRunResponse`,
 * `BuyerOrderSummary`, `SaleResponse` and `CaseFileStepResponse` are exact
 * interfaces with no index signature and no `extends` from an entity, so
 * spreading a row into a response is a compile error rather than a leak.
 *
 * ## What is deliberately absent
 *
 * There is no case-file mapper here. The seller's copy must carry
 * `systemPrompt`, and a mapper that needs the field cannot live behind a
 * boundary defined by not having it — so both case-file mappings live in
 * `case-file.service.ts`, exactly as `agent-versions.service.ts` sits beside
 * `agent-serialiser.ts` rather than inside it. `grep systemPrompt` over **this**
 * file returns these comments and no code, and that is the assertion.
 *
 * What *is* here is `toBuyerCaseFileSteps`, because redacting a step is a pure
 * projection with no privileged input: it is safe precisely because of what it
 * never reads, which makes this the right side of the wall for it.
 *
 * ## No `@Injectable`, no class
 *
 * Pure functions over rows, like `agent-serialiser.ts`. Nothing here reaches a
 * database, a clock or a chain, so nothing here needs a lifetime — and a mapper
 * that cannot be given a dependency cannot grow a code path to a value its
 * parameter type does not contain.
 *
 * (`specs/007-orders-purchase-saga/contracts/internal-api.md` §2, §3, §4, §7;
 *  `research.md` R10, R11; `data-model.md` §5)
 */

/**
 * `GET /orders/:id` — the order screen's one-second poll (contracts §3).
 *
 * ⚠️ **`priceMinor` arrives as a `string` and leaves as a `number`.** `bigint`
 * columns come off the driver as strings when selected raw, because the entity's
 * transformer is not in the path of a query builder `getRawOne`. The conversion
 * belongs here, at the wire boundary, and not one layer earlier: the client's
 * `Order.priceMinor` is a `number`, and a JSON string arriving where a number is
 * declared does not throw — it renders as `NaN` after the first arithmetic on
 * the order screen, which is the same silent class of defect the DTO file's
 * "copy from the contract, do not retype" warning exists for. Whole USD cents
 * are far inside `Number.MAX_SAFE_INTEGER`, so the narrowing is lossless at any
 * price this product can transact.
 *
 * **Dates become ISO-8601 strings; nulls stay null.** `null` on a timestamp is
 * a fact the screen states — not delivered, not disputed, not settled — so the
 * three optional-looking fields are present and null rather than omitted.
 *
 * ⚠️ **`run === null` and `run.output === null` are two different kinds of
 * nothing, and the difference is load-bearing all the way down to the dispute.**
 * `run === null` means execution has not started; `run.output === null` means it
 * ran and produced nothing. Collapsing them tells a buyer their agent is still
 * working when it has already given up — and `runs.output IS NULL` is the
 * non-delivery evidence invariant #7 rests on. The test below is
 * `row.runId === null`, the run's own primary key from a `LEFT JOIN`, rather
 * than `runOutput === null`: the output of a run that failed is also null, so
 * testing the payload would report every failure as "not started yet".
 *
 * Four members of `VisibleOrderRow` are deliberately not emitted.
 * `buyerAccountId` and `ownerAccountId` were fetched to authorise the read in
 * SQL and are nobody's business on the wire — a seller learns what was ordered,
 * never who ordered it. `input` belongs to the case file, and `onchainDealId` is
 * an escrow implementation detail the order screen has no use for. Because
 * `OrderResponse` is closed, adding any of them is a decision someone has to
 * make on purpose rather than something a spread does on their behalf.
 */
export function toOrderResponse(row: VisibleOrderRow): OrderResponse {
  return {
    id: row.id,
    state: row.state,
    // The PINNED version's name (`orders → agent_versions`), resolved in the
    // query. A seller who renames an agent must not retitle orders already sold.
    agentName: row.agentName,
    priceMinor: Number(row.priceMinor),
    acceptanceCriteria: row.acceptanceCriteria,
    // The order's own snapshot column, never a live config read: the client's
    // countdown is computed from this and nothing else.
    reviewWindowSeconds: row.reviewWindowSeconds,
    createdAt: row.createdAt.toISOString(),
    deliveredAt: row.deliveredAt?.toISOString() ?? null,
    disputedAt: row.disputedAt?.toISOString() ?? null,
    settledAt: row.settledAt?.toISOString() ?? null,
    run: row.runId === null ? null : toOrderRun(row),
  };
}

/**
 * The execution embedded in an order — `runs.input` and `runs.output`, and
 * nothing else (contracts §3).
 *
 * ⚠️ **The parameter type is a two-member `Pick<>` with no `steps`, and that
 * absence is the guarantee.** It is the same construction as `ListingFields` in
 * `agent-serialiser.ts`: this function is structurally incapable of emitting a
 * step, so if `findVisibleToAccount` ever started selecting `r.steps` — a
 * plausible edit, the column is right there in the same `LEFT JOIN` — nothing
 * here could carry it onto a general read. `OrderRunResponse` has nowhere to put
 * one either (layer 3), and steps appear **only** in the case file, redacted,
 * where the redaction is a stated contract. `GET /orders/:id` makes no such
 * promise, which is exactly why it carries no steps.
 *
 * Passing a whole `VisibleOrderRow` is allowed by structural typing and is
 * still safe: widening what this function may emit means editing the type on
 * the line above this comment.
 *
 * ⚠️ `input` falls back to `{}`. `runs.input` is `jsonb NOT NULL`, so the value
 * is never actually absent for a row that exists — the nullability is an
 * artefact of the `LEFT JOIN`, which types every joined column as optional.
 * `??` rather than a non-null assertion because an assertion is a claim about a
 * row shape that a future query change can quietly falsify, and `{}` renders as
 * an empty document instead of throwing inside a poll the order screen repeats
 * every second.
 */
export function toOrderRun(
  row: Pick<VisibleOrderRow, 'runInput' | 'runOutput'>,
): OrderRunResponse {
  return {
    input: row.runInput ?? {},
    // Present and null, never omitted: "the agent returned nothing" is
    // something the screen says, not something it leaves out.
    output: row.runOutput,
  };
}

/**
 * One row of `GET /orders` — the buyer's own orders (contracts §2).
 *
 * Carries `deliveredAt` because My Orders is where a buyer sees which orders are
 * waiting on **them**, and the review countdown starts at delivery.
 *
 * Every state appears here, `failed` included (FR-045): a purchase that did not
 * complete leaves a debit and a compensating credit in the buyer's statement,
 * and hiding the order leaves both with nothing to explain them.
 */
export function toBuyerOrderSummary(row: OrderSummaryRow): BuyerOrderSummary {
  return {
    id: row.id,
    agentName: row.agentName,
    priceMinor: Number(row.priceMinor),
    state: row.state,
    createdAt: row.createdAt.toISOString(),
    deliveredAt: row.deliveredAt?.toISOString() ?? null,
    disputedAt: row.disputedAt?.toISOString() ?? null,
  };
}

/**
 * One row of `GET /sales` — the same order seen from the other side
 * (contracts §7).
 *
 * ⚠️ **Two functions over one row type, not one function with a flag.** The
 * two projections differ by a single field, and a `toOrderSummary(row, { seller:
 * true })` would be a shape branch — a conditional deciding what a caller may
 * see — which is the exact construct 006 FR-030 exists to prevent and which
 * `research.md` R10 preserves for this feature. Two branchless functions cost
 * seven duplicated lines and make "what does a seller receive?" answerable by
 * reading one function to the end.
 *
 * ⚠️ **`deliveredAt` is dropped, and there is no buyer identity to drop** —
 * `OrderSummaryRow` never carried one, because `findBySeller` never selected
 * one. The seller learns what was ordered, what it cost and what was ruled, not
 * who bought it. Delivery is the buyer's clock: it starts the review window,
 * which the seller has nothing to do with, and `SaleResponse` is closed so
 * adding it back is a deliberate edit rather than a spread's side effect.
 *
 * `disputedAt` is carried as a fact rather than inferred from `state`, because
 * this list is a seller's **entire** notification mechanism — there is no email
 * and no bell — and `state === 'settled'` would miss a dispute still in flight,
 * which is the difference between being told of an accusation and not.
 */
export function toSaleResponse(row: OrderSummaryRow): SaleResponse {
  return {
    // ⚠️ The ORDER's id. There is no sales table — a sale is an order seen from
    // the other side — and every read on `/sell/sales/:id` is keyed on this.
    id: row.id,
    agentName: row.agentName,
    priceMinor: Number(row.priceMinor),
    state: row.state,
    createdAt: row.createdAt.toISOString(),
    disputedAt: row.disputedAt?.toISOString() ?? null,
  };
}

/**
 * ⚠️⚠️ **THE REDACTION. `runs.steps` → what a buyer may be shown**
 * (FR-042, contracts §4, `research.md` R11, `data-model.md` §5).
 *
 * ## `reasoning` is never read. That sentence is the entire mechanism.
 *
 * `ExecutionStep.reasoning` carries model prose, and model prose is where a
 * paraphrase of the seller's system prompt turns up without the `system_prompt`
 * column ever being touched. The property is not referenced anywhere below — not
 * copied, not shortened, not passed to anything. `grep reasoning` over this file
 * returns this comment and no code, and **that is the assertion**. Every field
 * this function emits is either platform-authored (`label`), composed by the
 * platform from structure (`summary`), or a number.
 *
 * ## ⚠️ Truncation is the trap
 *
 * The obvious implementation of "summarise the reasoning" is
 * `reasoning.slice(0, 200)`. It looks like compliance and is not: **the first
 * two hundred characters of a paraphrase are still a paraphrase, and the leak is
 * at the START of the sentence, not the end.** A reasoning turn opens by
 * restating its instructions. Truncating keeps precisely the part worth stealing
 * and discards the part nobody wanted, while producing a diff that reads as a
 * privacy improvement and a test suite that stays green.
 *
 * ## ⚠️ Why not ask a model to summarise it
 *
 * That is the other obvious answer, and it fails twice. It would be faithful to
 * the word — a faithful summary of a paraphrase of the prompt is a paraphrase of
 * the prompt, so the disclosure survives with an extra step in front of it. And
 * it puts a model call inside a read the dispute screen polls once a second,
 * priced per token, on the one screen a buyer opens when they are already angry.
 *
 * ## What this does instead
 *
 * Composes the sentence from the step's **structure** — its `kind` and its
 * platform-authored `label`. Deterministic, free, and safe by construction:
 * there is no code path from the model's text to a buyer's response, which is
 * the standard invariant #3 is held to everywhere else. The UI already types
 * `summary` as `string | null` and renders a terse platform sentence or nothing.
 *
 * ## ⚠️ Field by field, never `{ ...step, summary }`
 *
 * A spread is the one edit that would defeat all of the above in a single line:
 * it carries `reasoning` — and every field API-08 adds later — straight into the
 * response. `CaseFileStepResponse` is closed, so the excess-property check
 * catches the literal form; naming four fields is what keeps that check engaged.
 *
 * ## Why the input is `unknown`
 *
 * `runs.steps` is `jsonb` and **nothing has validated it**. API-08 writes it and
 * does not exist yet (`data-model.md` §5 fixes the shape ahead of its producer,
 * precisely because this redaction is structural and needed the shape settled
 * first). Typing the parameter `ExecutionStep[]` would be a claim about a
 * document this process has never seen, and jsonb honours whatever was inserted
 * — including a scalar, a string, or objects with different keys from an older
 * writer. So: a non-array yields `[]`, non-object elements are skipped, and each
 * field is read only if it has the type it should. Nothing here throws, because
 * a malformed row must not take down a case file whose entire purpose is to say
 * what happened.
 *
 * Until API-08 lands there are no `runs` rows at all and this function is only
 * ever called with `null` or `[]`.
 */
export function toBuyerCaseFileSteps(steps: unknown): CaseFileStepResponse[] {
  if (!Array.isArray(steps)) {
    return [];
  }

  const redacted: CaseFileStepResponse[] = [];

  for (const raw of steps) {
    if (typeof raw !== 'object' || raw === null) {
      continue;
    }

    // ⚠️ Read by name, one property at a time. This is the only access to a
    // step in the file, and it names exactly the four things a buyer may have.
    // Widening this record to `ExecutionStep` would put `reasoning` in scope.
    const step = raw as Record<string, unknown>;
    const kind = typeof step.kind === 'string' ? step.kind : null;
    const label = typeof step.label === 'string' ? step.label : null;

    redacted.push({
      // `label` is nullable on `ExecutionStep` and non-nullable here: a step
      // with no label still needs a heading in the buyer's list, and composing
      // one from `kind` is this mapper's job rather than the screen's.
      label: label ?? headingFor(kind),
      summary: summarise(kind, label),
      durationMs: typeof step.durationMs === 'number' ? step.durationMs : null,
      // The step's failure, verbatim. Platform-authored and the thing a buyer
      // disputing a delivery most needs — see `ExecutionStep.error`'s warning to
      // whoever builds API-08: model prose goes in `reasoning` and nowhere else,
      // because this field crosses the boundary untouched.
      error: typeof step.error === 'string' ? step.error : null,
    });
  }

  return redacted;
}

/**
 * The heading for a step that arrived without a label.
 *
 * Names the *kind* of thing that happened and nothing more. A step with no
 * label is a step the platform did not name, and inventing a specific-sounding
 * heading for it would be the screen asserting something nobody recorded.
 */
function headingFor(kind: string | null): string {
  switch (kind) {
    case 'tool_call':
      return 'Tool call';
    case 'model_turn':
      return 'Reasoning';
    case 'output':
      return 'Output';
    case 'error':
      return 'Error';
    default:
      return 'Step';
  }
}

/**
 * The platform-authored sentence under a step.
 *
 * Every return value below is a **literal written in this file**, optionally
 * interpolating `label`, which `ExecutionStep` documents as platform-authored
 * for exactly this reason. No input string reaches the output except one the
 * platform wrote.
 *
 * ⚠️ **`null` is a legitimate answer and must stay one.** An unrecognised
 * `kind` — an older row, a fifth kind API-08 adds — produces no sentence rather
 * than a guess, and under no circumstances a sentence borrowed from the step's
 * own text. The UI types `summary` as `string | null` and renders the heading
 * alone when it is null, so the honest answer is also the one that displays.
 *
 * ⚠️ **This switch is over `string | null`, not over `ExecutionStep['kind']`,
 * and it therefore has no exhaustiveness check.** `case-file.dto.ts` explains
 * that the union is closed so a fifth kind becomes a compile error in the
 * composer — that argument holds for a *validated* value, and this one has been
 * through no validator (see the header). Once API-08 exists and parses
 * `runs.steps` on the way out of the database, narrowing this parameter to
 * `ExecutionStep['kind']` is the upgrade that buys the compile error back. Until
 * then the `default` arm is what stands in for it, and it is deliberately silent
 * rather than clever.
 */
function summarise(kind: string | null, label: string | null): string | null {
  switch (kind) {
    case 'tool_call':
      return label === null ? 'The agent called a tool' : `Called ${label}`;
    case 'model_turn':
      return 'The agent reasoned about the task';
    case 'output':
      return 'The agent produced its output';
    case 'error':
      return 'The step failed';
    default:
      return null;
  }
}
