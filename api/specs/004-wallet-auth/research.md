# Phase 0 Research: Wallet Auth

**Feature**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md) · **Date**: 2026-08-08

Every open question from the Technical Context is settled below. Three of the findings
were verified by running code against the installed dependencies rather than reasoned
about (R5, R6, R15) — noted inline where that is the case.

---

## R1 — Where the challenge lives: process memory, not Postgres

**Decision**: An injectable `NonceStore` holding a `Map<string, StoredNonce>` keyed by
the **lowercased** address. One entry per address; issuing a new challenge overwrites
any earlier one. No table, no migration, no Redis.

**Rationale**: A challenge is worthless five minutes after it is issued and worthless
the instant it is spent. Persisting it buys the ability to survive a restart, and the
thing it would preserve is a user's need to click "sign in" again — which they can do
in two seconds. Against that: a table means a migration, an entity, a cleanup job for
expired rows, and a second thing that can be out of sync with the account it refers to.

There is a real advantage beyond simplicity. Node runs one thread, so
`store.consume(address)` — read, delete, return — cannot interleave with another
request between the read and the delete. That makes single-use consumption (FR-004)
atomic **for free**, with no transaction, no row lock, and no `SELECT … FOR UPDATE` to
get wrong. The database version of this is genuinely harder to make correct.

**Alternatives considered**:

- *A `nonces` table.* Correct, survives restarts, and requires an atomic
  `DELETE … RETURNING` to be replay-safe. Rejected: it solves a problem (restart
  durability) that costs the user one click, and introduces one (concurrent consumption)
  that the in-memory version does not have.
- *Stateless signed challenge* — issue an HMAC of `address + timestamp` and verify it
  without storing anything. Elegant, and **fatally wrong here**: with no server-side
  record there is nothing to mark as spent, so every challenge is replayable until it
  expires. That is exactly the property FR-004 exists to deny.
- *Redis.* Explicitly out of scope for the component (`docs/CONTEXT.md` §6).

**Bounded-growth note**: the map holds at most one entry per address that has ever
requested a challenge, and entries are removed on consumption. A periodic sweep of
expired entries is included (`setInterval`, cleared in `onModuleDestroy`) — not because
demo-scale memory is a concern, but because an unbounded map with no eviction is the
kind of thing that is trivially correct to write now and awkward to add later.

---

## R2 — Challenge value: 32 random bytes, hex

**Decision**: `randomBytes(32).toString('hex')` from `node:crypto` — 64 hex characters,
256 bits of entropy.

**Rationale**: It must be unguessable, and it goes into a message a human sees in their
wallet, so it must be printable. Hex satisfies both and needs no dependency.
`crypto.randomUUID()` would also work but carries 122 bits and looks like an identifier
rather than a secret, which invites someone downstream to treat it as one.

---

## R3 — The signed message, and why `/auth/nonce` returns it

**Decision**: The server composes the exact message and returns it alongside the nonce:

```text
Guardian: sign in to your account.

This signature proves you own this wallet.
It is not a transaction and costs nothing.

Address: 0xAbC…
Nonce: 3f7a…
```

`POST /auth/nonce` responds `{ nonce, message }`. The client signs `message` verbatim.

**Rationale**: `docs/api-design.md` §3.1 writes the response as `{ nonce }`, which
implies the client assembles the message from a format both sides have memorised. That
is a contract with no schema: a trailing newline or a changed word on either side turns
every sign-in into "signature does not match your address", and the failure gives no
hint that formatting is the cause. Returning the composed string makes the format
server-owned and unbreakable by the UI. The addition is backwards compatible — `nonce`
is still there for any client that wants it.

The wording is doing work too. A wallet popup showing opaque bytes trains users to
approve things they cannot read; stating in the message that this is not a transaction
is the cheapest possible defence against a buyer who is right to be suspicious.

**Alternatives considered**: full **EIP-4361 (Sign-In With Ethereum)**. It is the
standard, and it carries domain, chain id, issue time, and expiry. Rejected for MVP:
using it honestly means *verifying* those fields, which is a parser and a set of
policies for a single-origin demo app with no cross-domain replay surface. Half-using
it — emitting the format and checking only the nonce — would be worse than not using it,
because it would look like the guarantees were there.

---

## R4 — Consume the challenge before checking the signature

**Decision**: `verify` consumes (reads and deletes) the challenge **first**, then
recovers the signer. A failed signature check does not put the challenge back.

**Rationale**: This is the difference between one attempt and unlimited attempts. If the
challenge survived a failed verify, an attacker holding a captured message could grind
signatures against a live challenge for its full five-minute lifetime. Consuming first
makes every challenge worth exactly one try, which is what US4 scenario 7 asks for.

The cost is a genuine, if minor, usability wrinkle: a user who fumbles the signature
must request a new challenge rather than retry. The client handles this by always
calling `/auth/nonce` immediately before asking for a signature, which is the natural
flow anyway.

**Alternatives considered**: consume only on success (friendlier, and the common naive
implementation) — rejected above. Consume on success plus an attempt counter —
equivalent security, more state, no benefit.

---

## R5 — Recovering the signer: `recoverMessageAddress`, verified

**Decision**: `recoverMessageAddress({ message, signature })` from **viem**, already a
dependency at `^2.55.11`. Compare its result to the challenge's address with `===`.

**Rationale**: FR-005 says "recover the address and compare", and this is literally that
function. It is pure — no RPC call, no `publicClient`, so auth has no chain dependency
and works with the node down. It applies the EIP-191 `personal_sign` prefix, which is
what every browser wallet produces for a plain-string signature request.

**Verified, not assumed** (run against the installed viem 2.55.11):

- `recoverMessageAddress` returns an **EIP-55 checksummed** address, so `===` against
  another checksummed address is a correct comparison and no `toLowerCase()` is needed
  on the hot path.
- A multi-line message round-trips intact — relevant because the R3 message has blank
  lines in it.
- Foundry's `cast wallet sign` produces a signature viem recovers correctly, which is
  what makes the manual verification in [quickstart.md](./quickstart.md) possible
  without a browser.

**Alternatives considered**: viem's `verifyMessage`, which returns a boolean and also
handles **ERC-1271** smart-contract wallets when given a public client. Rejected: it
would hide the recovered address that the error path wants to log, and smart-account
sign-in is not a demo requirement. Worth revisiting the day a buyer arrives with a Safe.

---

## R6 — Address canonicalisation, and the index that must be hit

**Decision**: `getAddress()` from viem to canonicalise on the way in (it validates and
returns EIP-55 mixed case, throwing on a bad address). Store that. Look accounts up with
an explicit `WHERE lower(wallet_address) = :lower`.

**Rationale**: The stored address is the payout destination for every refund and sale,
so it has to be exact; matching has to ignore case because a user may type or paste any
casing. `getAddress()` gives the first, the lowered comparison gives the second.

The query form is load-bearing. `src/entities/account.entity.ts` carries an unusually
emphatic comment explaining that uniqueness is enforced by a **functional** index,
`accounts_wallet_lower_idx ON accounts (lower(wallet_address))`, because a plain unique
column index would be case-sensitive and would let `0xAbC…` and `0xabc…` both register.
A lookup written as `findOne({ where: { walletAddress } })` would be both **case-sensitive
and unable to use that index** — wrong answer and a sequential scan. Writing
`lower(account.wallet_address) = :lower` in a query builder matches the index expression
exactly, so Postgres uses it.

**Verified**: `getAddress(addr.toLowerCase()) === addr` for a checksummed address, so
canonicalisation is idempotent regardless of what casing arrives.

---

## R7 — Session credential: `@nestjs/jwt`, HS256, one new dependency

**Decision**: Add **`@nestjs/jwt` ^11.0.2** (the only new dependency). HS256 with a
symmetric secret from a new `JWT_SECRET` environment key. Payload is `{ sub: accountId }`
plus the standard `iat` / `exp`. Lifetime 7 days, as a code constant.

**Rationale**: `@nestjs/jwt` is the first-party wrapper over `jsonwebtoken`, its peer
range covers `@nestjs/common` ^11, and it gives an injectable `JwtService` with
`signAsync` / `verifyAsync` that fits the module idiom already in use. HS256 rather than
RS256 because one process both signs and verifies; an asymmetric key pair would add
key-management ceremony for a property nobody needs.

**Payload is deliberately minimal.** `sub` alone — not the wallet address, not a role
(there are none, FR-018). The guard loads the account from the database on every request
anyway to satisfy FR-017, so anything else in the token would be a second copy of a fact
we are about to read authoritatively. Duplicated state in a token is how a token ends up
disagreeing with the database.

**Configuration split**: `JWT_SECRET` is a secret and belongs in the environment, added
to `src/config/env.schema.ts` with a `.min(32)` rule and to the repository-root `.env`
and `.env.example`. The two **durations** — 7-day token, 5-minute challenge — are code
constants in `src/auth/auth.constants.ts`, not environment keys. They are not secrets,
they are not per-deployment, and every optional environment key is one more thing that
can be absent at 3am. This mirrors the reasoning in `env.schema.ts`'s own header: keys
are required precisely so nothing downstream has to null-check.

**Alternatives considered**: `@nestjs/passport` + `passport-jwt`. Two more dependencies
and a strategy-registration indirection to produce a guard that is about twenty lines
written directly. Passport earns its place when there are several strategies; there is
exactly one here, and there will not be a second (no passwords, no OAuth — FR-020).

---

## R8 — The guard is global and fails closed *(deviation from the spec as first written)*

**Decision**: Register `JwtAuthGuard` as a global `APP_GUARD`. Every route is protected
unless it carries `@Public()`. The four public routes — `GET /health`,
`POST /auth/nonce`, `POST /auth/verify`, and later the public catalogue reads — are
marked explicitly.

**This reverses FR-016 as originally written**, which asked for the opposite default
(public unless marked protected). The spec has been updated to match, and the reason is
in the codebase rather than in general principle:

`src/health/health.controller.ts` already carries the comment *"Unauthenticated by
design, and it must stay that way once auth lands — a health check behind a guard is a
health check nothing can call."* That warning only needs writing if the author expected
a global guard to sweep the health endpoint up. And `src/chain/chain.module.ts` states
the house rule directly: the guardian's role separation *"is only real if signing an
`openDeal` with the guardian key is a compile error rather than a code-review
question."*

Apply that rule here. The two defaults differ only in what happens when someone forgets:
opt-in leaves `POST /withdraw` open to the internet, opt-out leaves `GET /agents`
returning 401 until someone notices. The first is a money loss found by an attacker; the
second is a bug found by the first person to load the marketplace page. Roughly fifteen
of this backend's endpoints are protected and about seven are public, so the safe
default is also the quieter one.

What is lost is FR-016's stated *reason* — protection visible at the declaration site —
for protected routes specifically. That is the accepted cost. A bootstrap-time
`DiscoveryService` scan requiring every handler to be marked one way or the other would
recover it, and is deliberately not built: it is the wrong amount of machinery for an
MVP whose unmarked default is already the safe one.

**FR-017 costs one query per protected request.** The guard verifies the token and then
loads the account, so a token naming a deleted account is refused rather than proceeding
with a phantom identity. That is a primary-key lookup at demo scale; it is not worth
caching, and a cache here would be a way to keep honouring a deleted account.

---

## R9 — How a handler learns who is calling

**Decision**: A `@CurrentAccount()` parameter decorator returning the full `Account`
entity, which the guard has already attached to the request. A module augmentation
narrows Express's `Request` so `request.account` is typed rather than `any`.

**Rationale**: FR-015 asks for one way to get the caller that does not involve unpacking
the credential. Returning the entity rather than a bare id is what makes ownership checks
in later modules read straightforwardly, and the guard has already paid for the row.

The decorator throws if `request.account` is missing. That state is unreachable through a
guarded route, so reaching it means someone used `@CurrentAccount()` on a route marked
`@Public()` — a programming error that should be loud immediately rather than a
`Cannot read property 'id' of undefined` three lines into a handler.

---

## R10 — Request validation with Zod, not class-validator

**Decision**: Zod schemas (`zod` is already a dependency) parsed by a small reusable
`ZodValidationPipe`. No `class-validator`, no `class-transformer`, no global
`ValidationPipe`.

**Rationale**: The project already validates its most safety-critical input — the entire
environment — with Zod in `src/config/env.schema.ts`, complete with per-key error
messages. Adding a second validation library for request bodies would mean two idioms,
two error shapes, and two things to remember. Zod also expresses the address rule
(`0x` + 40 hex) as the same regex the environment schema already uses for
`OPERATOR_ADDRESS` and friends, so the definition of "valid address" stays singular.

FR-002 requires a malformed address to be rejected **without a challenge being issued**,
which the pipe delivers by construction: the handler never runs.

---

## R11 — Account creation on first verify

**Decision**: After a successful signature check, look the account up by lowered address;
create it if absent; return it either way. One method, `findOrCreateByAddress`, on an
`AccountRepository` in a new `src/accounts/` module.

**Rationale**: FR-007 and FR-008 are two views of one operation, so they should be one
call — a caller who can perform "find" and "create" separately can also perform them in
the wrong order.

Placing the repository in `src/accounts/` rather than inside `src/auth/` follows the
module map in `docs/CONTEXT.md` §3, where `accounts` owns the account and `auth` owns
sign-in, and follows the precedent already set by `LedgerModule`: created in API-02 with
a single read method and exported specifically so API-05 can build on it.

**Concurrency, and why it is not handled**: two simultaneous first-time verifies for the
same address would race to insert and one would hit the unique index. It cannot happen
here — an address has at most one outstanding challenge (R1), and consumption is atomic
(R4), so at most one verify per address can be in flight past the signature check. No
retry-on-conflict is written. Recorded so a future reader knows it was considered rather
than missed.

---

## R12 — Failure taxonomy, and the one thing errors must not reveal

**Decision**: Everything that can go wrong in verification produces a single
`401 Unauthorized` with the message **"Signature verification failed"** — no challenge
found, challenge expired, signature malformed, signature valid but recovering to a
different address. Distinct **log** lines at `warn` carry the real cause; the response
does not. Guard failures are separately distinguishable: missing/malformed credential vs.
expired credential vs. unknown account.

**Rationale**: FR-019 forbids disclosing whether an address is registered. A response
that said "no challenge for this address" would turn `/auth/verify` into an oracle for
enumerating the platform's users, and since accounts are wallet addresses, that is a list
of who holds what — a privacy leak with financial consequences, not a cosmetic one.

Distinguishing failures on the **guard** side is fine and is what US2 scenario 4 asks
for: those messages describe the caller's own token, which tells an attacker nothing they
did not supply.

`401` throughout rather than `400` for a malformed signature: the caller failed to
authenticate. Splitting the status codes would reintroduce, through the status line, the
distinction the message body is careful not to make.

---

## R13 — What is deliberately absent

No refresh tokens, no `/auth/logout`, no revocation list, no rate limiting, no roles, no
password or email field. Each is named out of scope by `docs/specs/API-04-auth.md` or by
`docs/CONTEXT.md` §6, and each is listed here so its absence reads as a decision.

The consequence worth stating plainly: **a token cannot be revoked before it expires.**
Seven days is a long time for that to be true. It is acceptable because the demo
environment is disposable and every token names an account that only controls its own
funds — but it is the first thing to change if this ever faces real users, and adding it
later means adding server-side session state, which is the design R1 argued against for
challenges.

---

## R14 — Constitution and invariants

`.specify/memory/constitution.md` remains the unmodified Spec Kit template — every
`[PRINCIPLE_N_NAME]` placeholder intact, no ratified principles. **PASS (vacuous)**,
recorded as a known gap for the third feature running.

Of the nine invariants in `docs/CONTEXT.md` §2, this feature touches none directly: it
writes no money, opens no deal, and calls no contract. The relevant discipline is the one
from `docs/api-design.md` §7 — **no roles** — enforced here by there being no role field
to check (FR-018), so ownership checks in `catalog` and `orders` have nothing to fall
back on but the resource itself.

---

## R15 — Manual verification is possible without a browser *(verified)*

**Decision**: [quickstart.md](./quickstart.md) drives the whole flow from a shell with
`cast wallet new`, `cast wallet sign`, and `curl`.

**Rationale**: Automated tests are out of scope for `api/`, so the verification steps
*are* the test suite and they need to be runnable in one terminal, repeatably, before the
UI exists. Foundry is already installed at `~/.foundry/bin` and used throughout
`sc/README.md`.

**Verified**: a throwaway key from `cast wallet new`, signing the exact multi-line R3
message with `cast wallet sign`, produces a signature that
`recoverMessageAddress` resolves back to that key's address. The manual path is real, not
hypothetical.
