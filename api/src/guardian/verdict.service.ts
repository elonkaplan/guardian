import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Order } from '../entities/order.entity';
import { Verdict } from '../entities/verdict.entity';
import { OrderRepository } from '../orders/order.repository';
import type { VerdictRow } from './verdict-serialiser';

/**
 * The read side of Guardian: *"what was ruled on this order, and if nothing,
 * why not?"* (`specs/009-guardian-audit-engine/contracts/verdict-api.md`).
 *
 * One method, four outcomes, no writes. Everything this module *does* —
 * auditing, hashing, settling — lives in `guardian.service.ts` and runs in a
 * poller with no request in sight. This class is the only thing in the module
 * downstream of an HTTP route.
 *
 * ## ⚠️ AUTHORISATION IS `OrderRepository.findVisibleToAccount`, AND ONLY THAT
 *
 * The rule — *"the buyer **or** the owner of the agent the order was placed
 * against"* — is not restated here, not re-derived here, and must never be. It
 * lives in the query that fetched the row anyway
 * (`orders/order.repository.ts`), which resolves the seller through
 * `order → agent_version → agent → owner_account_id` rather than through a
 * stored seller column that would freeze the owner as of purchase time.
 * `OrdersModule` exports that repository for this call site and no other.
 *
 * ⚠️ **A second authorisation query here would be the defect, not the
 * belt-and-braces.** contracts §3: *"five call sites each re-deriving it is how
 * one of them ends up wrong."* The second `findOne` below is deliberately **not**
 * one — see its comment.
 *
 * ## ⚠️ Both parties get the identical answer, and there is no redacted variant
 *
 * `docs/api-design.md` §3.4: *"A seller ruled against who cannot read the ruling
 * has no idea what they were found to have done."* The narrow check — buyer
 * only, on `orders.buyer_account_id` — is the natural one to write and it
 * silently removes half the seller experience. A seller is notified of a dispute
 * and has **no right of reply** (`docs/product-workflow.md` §7.5); being unable
 * to *read* the ruling as well would make the platform's core claim
 * indefensible.
 *
 * The three reads (`GET /orders/:id`, `/case-file`, `/verdict`) admit both
 * parties; the three writes stay buyer-only. This method takes an `accountId`
 * and never asks which side it is on, because there is no branch to feed.
 *
 * ## ⚠️ Why a discriminated union and not thrown errors
 *
 * `orders/` throws plain typed errors and maps them in one place
 * (`orders/orders-http.ts`), and that file's own argument is why this one does
 * something different rather than copying it. The argument there is: *seven*
 * endpoints share those refusals, the identical "not a party" condition must
 * render as `404` at **five** call sites, and a throw-site decision would only
 * ever see one of them. Every clause of that is about there being many callers.
 *
 * Here there is exactly one caller, one route, and one mapping table three rows
 * long — and two of the three outcomes are not failures at all:
 *
 * | Outcome | Is it an error? |
 * | --- | --- |
 * | `order-not-visible` | Yes, and it is the only one |
 * | `audit-pending` | **No.** It is the normal state of a disputed order, and the polling answer a buyer's screen sits on (FR-034) |
 * | `audit-failed` | **No.** It is a terminal *fact* about this order that both parties are owed |
 * | `verdict` | Obviously not |
 *
 * Throwing for the middle two would model a routine answer as an exception, and
 * would put the `404`-versus-`409` decision in an `instanceof` chain in a file
 * that does not exist yet — `guardian-http.ts` would have to be invented to hold
 * three branches with one reader. A union keeps the whole answer readable in the
 * controller's `switch`, and makes a fifth outcome a **compile error** at that
 * switch rather than an unmapped error class falling through to a `500`, which
 * is the failure mode `orders-http.ts` explicitly accepts because it has no
 * better option at seven endpoints.
 *
 * ⚠️ If a second route is ever added over these outcomes, this reasoning
 * expires: two callers is the threshold `orders-http.ts` was written for, and
 * the right move then is typed errors plus a `guardian-http.ts`, not two
 * switches.
 */
@Injectable()
export class VerdictService {
  constructor(
    private readonly orders: OrderRepository,
    @InjectRepository(Verdict)
    private readonly verdicts: Repository<Verdict>,
  ) {}

  /**
   * The ruling on one order, as far as this account is entitled to know it.
   *
   * The four outcomes are resolved in the order below and the order matters:
   *
   * 1. **Not visible** — no such order, *or* the caller is party to neither
   *    side. One answer for both facts, and the reason is not brevity. See
   *    {@link VerdictLookup}.
   * 2. **A verdict exists** — return it. This is checked before the
   *    audit-failure stamp on purpose: a ruling that exists is the answer,
   *    whatever earlier attempts did, and `verdicts.order_id UNIQUE` means there
   *    can only ever be the one.
   * 3. **No verdict, `audit_failed_at` set** — Guardian gave up. Terminal.
   * 4. **No verdict, `audit_failed_at` null** — the audit is still coming.
   *
   * ⚠️ **The `VisibleOrderRow` this authorises against is deliberately
   * discarded.** It carries `buyerAccountId` and the order's `input`, neither of
   * which belongs anywhere near this response; it was fetched to decide whether
   * the caller may ask the question, and that is all it is read for. Nothing
   * below narrows or re-checks it — `null` or not `null` is the entire signal.
   */
  async findForAccount(accountId: string, orderId: string): Promise<VerdictLookup> {
    const visible = await this.orders.findVisibleToAccount(orderId, accountId);

    if (visible === null) {
      // ⚠️ No detail travels with this, not even into a log line. The two facts
      // it covers must be indistinguishable from outside the process, and they
      // are indistinguishable inside it: `findVisibleToAccount` returned one
      // `null` for both and there is nothing here to branch on.
      return { outcome: 'order-not-visible' };
    }

    const verdict = await this.verdicts.findOne({ where: { orderId } });

    if (verdict !== null) {
      // ⚠️ The entity, handed to a parameter type that cannot see most of it.
      // `verdict-serialiser.ts` explains why passing a wider value is safe and
      // why the narrowing belongs in that file's interface rather than here:
      // a `select:` list on this query would be a *second* place the response's
      // shape is decided, and the two would drift.
      return { outcome: 'verdict', verdict };
    }

    // ⚠️ **This is not a second authorisation query.** It carries no
    // `accountId` predicate and must never grow one: the caller was authorised
    // by `findVisibleToAccount` two statements up, and duplicating the
    // buyer-or-owner rule here is precisely what contracts §3 forbids. It is a
    // fact lookup for two columns `VisibleOrderRow` does not select, reached
    // through the entity manager rather than a new injected repository so that
    // `GuardianModule` needs no extra `forFeature` registration — the same route
    // `guardian.repository.ts` takes to `Order`.
    const audit = await this.verdicts.manager.getRepository(Order).findOne({
      where: { id: orderId },
      select: { auditAttempts: true, auditFailedAt: true },
    });

    // The order was visible a moment ago and is gone now. Nothing in the
    // product deletes orders, so this is unreachable in practice; answering
    // "not visible" rather than throwing keeps the one impossible case
    // indistinguishable from the ordinary one instead of turning a race into a
    // `500` on a screen a buyer is already polling.
    if (audit === null || audit.auditFailedAt === null) {
      return { outcome: 'audit-pending' };
    }

    return {
      outcome: 'audit-failed',
      attempts: audit.auditAttempts,
      failedAt: audit.auditFailedAt,
    };
  }
}

/**
 * What `GET /orders/:id/verdict` can truthfully answer, as four closed cases.
 *
 * ⚠️ **`order-not-visible` is ONE case for TWO facts, and that is the security
 * property.** Either no order with that id exists, or one does and the caller is
 * neither its buyer nor the owner of the agent it was placed against. A `403`
 * for the second would confirm the order exists to anyone probing uuids —
 * turning this route into an existence oracle that, repeated against an
 * enumerated uuid space, maps out the platform's order table. This union has one
 * member for both, so no caller **can** tell them apart, rather than the
 * controller being trusted not to reveal it. The same construction
 * `orders/orders.errors.ts` uses for `OrderNotVisibleError`, and the same
 * reasoning (FR-036, research R7).
 *
 * ⚠️ **Do not split it into `no-such-order` and `not-a-party`.** It reads
 * tidier and is a security defect: a well-meaning controller would then say
 * which one applied.
 *
 * ## ⚠️ `audit-pending` and `audit-failed` are the difference between a spinner
 * and an error
 *
 * Both are "there is no verdict", and collapsing them is the failure R14 exists
 * to prevent. A `disputed` order with no verdict row is **byte-identical**
 * whether the audit is mid-flight or abandoned, so with only one outcome the
 * buyer's screen says a ruling is being prepared — indefinitely, with nothing
 * behind it. Nothing would ever change that answer: no scheduled job in the
 * system touches a stuck dispute (API-10's reaper covers `running` only), and
 * `orders.audit_attempts < 3` means Guardian's own poller has stopped selecting
 * the row. The escrow's 72-hour `DISPUTE_DEADLINE` plus its permissionless
 * `forceResolve` — which settles at a fixed quarter tier — is the only backstop,
 * and it is deliberately slow.
 *
 * ⚠️ **Why there is no fifth outcome that writes a fallback ruling.** The
 * obvious alternative — write a quarter-tier verdict and settle, matching
 * `docs/product-workflow.md` §7.4 — would free the money immediately and is
 * refused, because it puts a row into `verdicts` that **Guardian did not
 * author**: a tier with an empty citation checklist, rendering on the evidence
 * screen as a ruling with no evidence, on the one screen whose entire claim is
 * that every mark on it came from the audit. FR-041 and SC-013: every ruling in
 * the record was produced by the auditor. A stuck dispute is honestly reported
 * as stuck.
 *
 * `failedAt` is carried as a `Date` and formatted at the wire boundary, the same
 * split `orders/order-serialiser.ts` keeps.
 */
export type VerdictLookup =
  | { readonly outcome: 'order-not-visible' }
  | { readonly outcome: 'audit-pending' }
  | {
      readonly outcome: 'audit-failed';
      readonly attempts: number;
      readonly failedAt: Date;
    }
  | { readonly outcome: 'verdict'; readonly verdict: VerdictRow };
