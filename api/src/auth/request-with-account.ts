import type { Request } from 'express';

import { Account } from '../entities/account.entity';

/**
 * Teaches TypeScript about the one property the auth guard adds to the Express
 * request, so that everything downstream reads it as an `Account` instead of
 * `any`.
 *
 * The guard writes `request.account = <Account>` after it has verified the
 * bearer token and loaded the row; `@CurrentAccount()` reads it back out. Those
 * two halves live in different files and never call each other, so the request
 * object is the only contract between them. Without a declaration like this one
 * that contract is written in `(req as any).account` on both sides — a string
 * the compiler never checks, in the exact place where a typo produces
 * `undefined` rather than an error.
 *
 * Why the property is OPTIONAL, and why it stays that way: it is populated only
 * on routes the guard actually protected. Public routes — the sign-in
 * challenge, the verify endpoint that issues the very first token, health —
 * legitimately have no account attached, and marking it required would make the
 * type lie about every one of them. The `| undefined` is the type system
 * telling the truth about a request that has not been authenticated. It is not
 * friction to cast away with `!`; it is the reminder that a handler must be
 * behind the guard before it can assume an account.
 *
 * Why this matters more here than in a typical app: in this system the value
 * read out of `request.account` decides ownership, and ownership decides who
 * gets paid. An ownership check that compares a row's `accountId` against an
 * `undefined` that slipped through an `any` does not throw and does not warn —
 * it simply evaluates to `false` and locks the rightful owner out, or, if the
 * comparison is written the other way round, hands someone else's escrow to the
 * caller. Silent `undefined` in an authorization path is the specific failure
 * this file exists to make impossible to write.
 */
declare global {
  namespace Express {
    interface Request {
      /**
       * Set by the auth guard once the bearer token is verified and the account
       * row is loaded. Absent on every unprotected route — see the file
       * docblock for why that absence is modelled rather than asserted away.
       */
      account?: Account;
    }
  }
}

/**
 * The post-guard view of a request: same object, with `account` narrowed from
 * optional to present.
 *
 * The guard and the `@CurrentAccount()` decorator have already established that
 * the account exists, and this type is how they hand that knowledge to the
 * handler without a non-null assertion at every call site. Narrowing here
 * concentrates the "yes, the guard ran" claim in one named place where it can
 * be reviewed, instead of scattering `req.account!` through the controllers.
 *
 * Only use it where a guard genuinely runs first. Annotating an unprotected
 * handler's parameter with it does not make the account appear — it just moves
 * the same silent `undefined` behind a more convincing name.
 */
export type RequestWithAccount = Request & { account: Account };
