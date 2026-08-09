# Contract: The guard, and what every other module consumes

**Feature**: [../spec.md](../spec.md) · **Provided by**: `AuthModule`

> `AuthModule`'s `exports` array is **empty**, deliberately — see the last
> section. What follows is the surface other modules consume by *importing the
> decorator files directly*; the global guard reaches them with no import at
> all. Nothing about it travels through Nest's DI graph, which is what keeps
> `JwtService` unreachable.

This is the surface API-05 through API-09 are written against. Two decorators and one
guarantee. Nothing else in the backend should ever read the `Authorization` header,
decode a token, or import `JwtService`.

---

## The default: protected

`JwtAuthGuard` is registered globally as an `APP_GUARD`. **Every route in the
application requires a valid credential unless it explicitly says otherwise.**

```ts
// auth.module.ts
providers: [{ provide: APP_GUARD, useClass: JwtAuthGuard }]
```

This reverses FR-016 as the spec was first written; the spec has been updated. The
argument is in [R8](../research.md), and it is short: the two defaults differ only in
what happens when someone forgets to classify an endpoint. Opt-in leaves `POST /withdraw`
open to the internet. Opt-out leaves `GET /agents` returning 401 until the first page
load. One of those is found by an attacker and the other by a developer.

`src/health/health.controller.ts` already anticipated this — *"Unauthenticated by design,
and it must stay that way once auth lands"* — which is exactly the warning you write when
you expect a global guard.

### What the guard does, in order

1. Read `@Public()` metadata via `Reflector` (handler, then class). Present → allow, stop.
2. Extract the bearer token from `Authorization`. Missing or wrong scheme → `401`.
3. `jwtService.verifyAsync`. Signature invalid or malformed → `401` *Authentication
   required*; `TokenExpiredError` → `401` *Session expired*.
4. `accountRepository.findById(payload.sub)`. `null` → `401` (FR-017).
5. Attach the `Account` to `request.account`. Allow.

Step 4 is a Postgres lookup on every protected request. That is FR-017's price and it is
paid on purpose: without it, a token outlives the account it names for up to seven days.
At demo scale it is a primary-key hit, and it is **not cached** — a cache here is a
mechanism for continuing to honour a deleted account.

---

## `@Public()`

The only way out of the guard.

```ts
import { Public } from '../auth/public.decorator';

@Controller('health')
export class HealthController {
  @Get()
  @Public()
  check() { /* … */ }
}
```

Sets a metadata key the guard reads. Works on a handler or on a whole controller.

**Public routes in the backend as planned:**

| Route | Why |
| --- | --- |
| `GET /health` | A health check behind a guard is a health check nothing can call |
| `POST /auth/nonce` | You cannot present a credential you do not have yet |
| `POST /auth/verify` | Same |
| `GET /agents`, `GET /agents/:id` | The marketplace is browsable before sign-in (API-06) |
| `POST /demo/seed`, `POST /demo/reset` | Rehearsal tooling, deliberately unguarded (`api-design.md` §8) |

Every other route in the backend is protected by saying nothing.

---

## `@CurrentAccount()`

How a handler learns who is calling. Returns the full `Account` entity the guard already
loaded — no second query.

```ts
import { CurrentAccount } from '../auth/current-account.decorator';
import { Account } from '../entities/account.entity';

@Get('me')
getMe(@CurrentAccount() account: Account) {
  return { id: account.id, address: account.walletAddress };
}
```

**It throws if `request.account` is absent.** That state is unreachable on a guarded
route, so reaching it means the decorator was used on a route marked `@Public()` — a
programming error. Failing loudly at the parameter beats
`Cannot read properties of undefined` three lines into the handler, and beats silently
handing over `undefined` where the next line is an ownership check.

Typing comes from a module augmentation in `src/auth/request-with-account.ts`, so
`request.account` is `Account | undefined` rather than `any` anywhere it is touched.

---

## Ownership is checked per resource — there are no roles

`Account` has no role column, the token has no role claim, and no `@Roles()` decorator
exists (FR-018, `docs/api-design.md` §7). The same account lists agents and buys from
other people's.

So authorisation in later modules is always a comparison against the resource:

```ts
if (agent.ownerAccountId !== account.id) throw new ForbiddenException();
if (order.buyerAccountId !== account.id) throw new ForbiddenException();
```

**`401` means "I do not know who you are"; `403` means "I know, and it is not yours."**
The guard only ever produces the first. Every `403` in this backend comes from a check
like the two above, written at the resource.

This matters most in `orders`, where the same order is read by two accounts with
different visibility — `GET /orders/:id/case-file` is redacted for the buyer and full for
the seller. That is an ownership comparison producing two serialisations, never a role
lookup.

---

## What is not exported, and must not be

`JwtService`, `NonceStore`, and `AuthService` stay inside `AuthModule`.

Same reasoning as `ChainModule` refusing to export its viem clients: a module that could
inject `JwtService` could mint a token for any account id, which would make the guard
decorative. The guard's guarantee is only real if there is exactly one place a token can
be created.

`AccountsModule` exports `AccountRepository` — that one is intentional, and API-05 builds
`/me`, balance, and the ledger on it.
