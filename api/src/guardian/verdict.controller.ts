import {
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Param,
  ParseUUIDPipe,
} from '@nestjs/common';

import { CurrentAccount } from '../auth/current-account.decorator';
import { Account } from '../entities/account.entity';
import type { VerdictResponse } from './dto/verdict-response.dto';
import { toVerdictResponse } from './verdict-serialiser';
import { VerdictService } from './verdict.service';

/**
 * `GET /orders/:id/verdict` — the one route this feature adds
 * (`specs/009-guardian-audit-engine/contracts/verdict-api.md`).
 *
 * A tier, its reasoning, and a ✓/✗ checklist of clauses. No query parameters, no
 * pagination, no body: one order, one verdict, forever.
 *
 * ## Why a `guardian` controller sits on the `orders` path
 *
 * Nest permits two controllers on one prefix, and `docs/CONTEXT.md`'s module map
 * assigns the verdict to `guardian`. Adding the route to `orders.controller.ts`
 * instead would make `orders` import `guardian`, and would put the verdict's
 * shape two modules away from the code that writes it. Guardian importing
 * `orders` for the authorisation query creates no cycle; the forbidden edge is
 * `execution ↔ guardian` (contracts §3).
 *
 * ## ⚠️ There is no `@Public()` and no `@OptionalAuth()` in this file
 *
 * The global `JwtAuthGuard` is fail-closed, so this route is protected by saying
 * nothing — and it *must* be. A verdict names what one party was found to have
 * done to another; there is no anonymous view of one, and adding either
 * decorator here would be a disclosure rather than a convenience.
 * `@CurrentAccount()` is the whole contract with `auth/`, exactly as in
 * `orders.controller.ts`.
 *
 * ## ⚠️ BOTH PARTIES GET THE IDENTICAL RESPONSE
 *
 * The buyer, **or** the owner of the agent the order was placed against. No
 * redacted variant, no seller-shaped copy, no field dropped for one of them —
 * and there must not be one. `docs/api-design.md` §3.4:
 *
 * > *"A seller ruled against who cannot read the ruling has no idea what they
 * > were found to have done."*
 *
 * ⚠️ The narrow check — buyer only, on `orders.buyer_account_id` — is the
 * natural thing to write and it silently removes half the seller experience. A
 * seller is notified of a dispute and has **no right of reply**
 * (`docs/product-workflow.md` §7.5); a seller who cannot even *read* the ruling
 * has been accused, judged and refused the judgment. This route does not check
 * ownership at all: it hands the account id to
 * `OrderRepository.findVisibleToAccount`, which admits both sides in one SQL
 * predicate, so there is no branch here for a later edit to narrow.
 *
 * Note also what does **not** follow from that: the case file's route branches
 * on the caller and this one does not, because the case file genuinely has two
 * shapes (the seller's carries their own `systemPrompt`) and a verdict has one.
 * `verdict-serialiser.ts` therefore exports a single function with no mode flag.
 *
 * ## ⚠️ `404` FOR NOT-YOURS IS DELIBERATE, NOT LAZY
 *
 * A `403` on the second row of the table below would confirm the order exists to
 * anyone probing uuids — that somebody bought something, from some seller, at
 * some price — and repeated against an enumerated uuid space it maps out the
 * platform's order table. So the two facts are answered with one status and one
 * body, byte for byte.
 *
 * The enforcement is structural rather than editorial, and that is the part
 * worth keeping: `findVisibleToAccount` returns a single `null` for both facts
 * and `VerdictLookup` has a single member for it, so **no caller can tell them
 * apart** rather than this file being trusted not to say. There is deliberately
 * no `ForbiddenException` anywhere in this module, the same absence
 * `orders/orders-http.ts` documents at length.
 *
 * ## The four answers (contracts §4)
 *
 * | Case | Status | Body |
 * | --- | --- | --- |
 * | No such order, **or** caller is party to neither side | `404` | `{ error: 'ORDER_NOT_FOUND' }` |
 * | Visible, no verdict, audit still in progress | `404` | `{ error: 'VERDICT_NOT_FOUND' }` |
 * | Visible, no verdict, `audit_failed_at` set | `409` | `{ error: 'AUDIT_FAILED', attempts, failedAt }` |
 * | Verdict exists | `200` | `VerdictResponse` |
 * | No / invalid JWT | `401` | The guard's standard response |
 *
 * ⚠️ **The second row is a different `404` from the first, and that is
 * correct.** *"You may see this order; it has no verdict yet"* is a
 * distinguishable answer because the caller has **already proven they are a
 * party** — nothing is disclosed to a stranger, who never gets past row one. It
 * is the polling state: a buyer watching a disputed order sees
 * `VERDICT_NOT_FOUND` until the audit lands, then the ruling (FR-034). It must
 * never be a partial or provisional verdict; there is no such thing.
 *
 * ## ⚠️ `AUDIT_FAILED` IS THE DIFFERENCE BETWEEN AN ERROR AND A SPINNER
 *
 * Both parties get it, and it is deliberately **not** a `404`, because the
 * client must be able to tell *"the ruling is still coming"* from *"no ruling is
 * coming"* without polling forever.
 *
 * Without it, a `disputed` order with no verdict row is **byte-identical**
 * whether the audit is mid-flight or abandoned — so the buyer's screen says a
 * ruling is being prepared, indefinitely, with nothing behind it. Nothing would
 * ever change that answer: no scheduled job in the system touches a stuck
 * dispute (API-10's reaper covers `running` only) and Guardian's own poller has
 * stopped selecting the row at `audit_attempts < 3`. The escrow's 72-hour
 * `DISPUTE_DEADLINE` plus its permissionless `forceResolve` — settling at a
 * fixed quarter tier — is the **only** backstop, and it is deliberately slow.
 * R14.
 *
 * ⚠️ **Why no fallback ruling is written to free the money.** The obvious
 * alternative — write a quarter-tier verdict and settle, matching
 * `docs/product-workflow.md` §7.4 — is refused because it would put a row into
 * `verdicts` that **Guardian did not author**: a tier with an empty citation
 * checklist, rendering as a ruling with no evidence on the one screen whose
 * entire claim is that every mark on it came from the audit. FR-041 and SC-013:
 * every ruling in the record was produced by the auditor. A stuck dispute is
 * reported as stuck.
 *
 * ## Errors are built here, not in a `*-http.ts`
 *
 * `orders/` centralises its mapping because seven endpoints share seven
 * refusals; this module has one endpoint and three answers, all of which are
 * `VerdictService`'s outcomes rather than thrown errors. `verdict.service.ts`
 * argues that choice out in full, including when it expires.
 *
 * ⚠️ The bodies are constructed from `HttpException` directly rather than from
 * `NotFoundException` / `ConflictException`, because contracts §4 fixes them
 * character for character and the shortcut constructors run `createBody`, whose
 * treatment of a non-string argument is a subtlety this route should not depend
 * on. `orders/orders-http.ts` reaches for the same escape hatch for its `402`.
 * The response body is the whole contract with `ui/src/api/errors.ts`; a
 * `statusCode`/`message` envelope wrapped around it would not be.
 */
@Controller('orders')
export class VerdictController {
  constructor(private readonly verdicts: VerdictService) {}

  /**
   * `GET /orders/:id/verdict` — the ruling on a disputed order.
   *
   * ⚠️ **Replay: the same bytes, every time.** Repeated reads of a decided order
   * return byte-identical `tier`, `reasoning` and `citations` (FR-025, SC-005).
   * That is not a caching behaviour — it is the **absence of any recomputation
   * path**. This handler reads one row, the row was written once, and
   * `verdicts.order_id UNIQUE` means there can never be a second. `temperature`
   * does not exist on Opus 5, so a re-audit would be a genuinely *different*
   * audit; `docs/tech-stack.md` §5 is explicit that this mitigation *"is not a
   * demo trick: it falls straight out of the product rule that verdicts are
   * final."* Nothing may ever be added here that recomputes, refreshes, or
   * re-ranks any part of the ruling.
   *
   * `ParseUUIDPipe` on the path parameter, the local idiom on every
   * `orders`-prefixed route. A malformed id is a `400` before any query runs,
   * which is not an existence oracle: it says the *string* is not a uuid, which
   * the caller could have determined without asking.
   */
  @Get(':id/verdict')
  async getVerdict(
    @CurrentAccount() account: Account,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<VerdictResponse> {
    const lookup = await this.verdicts.findForAccount(account.id, id);

    switch (lookup.outcome) {
      // ⚠️ Two facts, one answer. See the class docblock: a `403` here is the
      // existence oracle, and there is deliberately nothing to branch on.
      case 'order-not-visible':
        throw new HttpException({ error: 'ORDER_NOT_FOUND' }, HttpStatus.NOT_FOUND);

      // A different `404`, and correct: the caller has already proven they are a
      // party, so this discloses nothing a stranger could reach. It is the
      // polling state, not a failure.
      case 'audit-pending':
        throw new HttpException({ error: 'VERDICT_NOT_FOUND' }, HttpStatus.NOT_FOUND);

      // ⚠️ `409`, not `404`. Terminal: nothing retries after this and no verdict
      // will ever appear for this order. `attempts` and `failedAt` ride along so
      // the screen can say *when* Guardian gave up and after how many tries,
      // rather than only that it did.
      case 'audit-failed':
        throw new HttpException(
          {
            error: 'AUDIT_FAILED',
            attempts: lookup.attempts,
            failedAt: lookup.failedAt.toISOString(),
          },
          HttpStatus.CONFLICT,
        );

      case 'verdict':
        return toVerdictResponse(lookup.verdict);

      default: {
        // ⚠️ A fifth outcome added to `VerdictLookup` fails to compile *here*,
        // at the line that would otherwise have quietly answered `500` — which
        // is the property `orders-http.ts` cannot have with an open error
        // hierarchy and this route can, having exactly one caller.
        const unreachable: never = lookup;

        throw new Error(
          `unhandled verdict lookup outcome: ${JSON.stringify(unreachable)}`,
        );
      }
    }
  }
}
