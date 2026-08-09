---
description: "Task list for Wallet Auth implementation"
---

# Tasks: Wallet Auth

**Input**: Design documents from `/specs/004-wallet-auth/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/](./contracts/)

**Tests**: **No test tasks.** Automated tests remain out of scope for this component per
[`docs/CONTEXT.md`](../../docs/CONTEXT.md). Verification tasks run the corresponding step
from [quickstart.md](./quickstart.md) by hand.

**Organization**: Grouped by user story, in priority order — which here also happens to be
dependency order. Three things about the shape of this feature are worth knowing before
reading:

**US1 and US2 are separable; US3 and US4 are properties, not slices.** Sign-in (US1) and
the guard (US2) touch disjoint files and could be built by two people. US3 (one wallet =
one account, exact casing) and US4 (replays refused) are guarantees *about* the code US1
writes, so their phases are shorter on new files and heavier on hardening and proof.
Skipping them leaves something that signs people in while duplicating accounts and
accepting replayed signatures — a demo that works once and is wrong the second time.

**✅ No external blockers, and no migration.** Nothing here touches the chain, the LLM,
or Rain. `accounts` and `accounts_wallet_lower_idx` already exist from API-02
([data-model.md](./data-model.md) §1), so no migration is generated or run. The feature
works with the Monad RPC endpoint down.

**⚠️ Two ordering traps, flagged where they occur.** T026 registers a global fail-closed
guard, which locks the auth endpoints themselves until T027 marks them public — land the
two together. And `migration:generate` must not be run in this feature: it will propose
dropping the functional index, as the comment in `src/entities/account.entity.ts` warns.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1–US4)
- Include exact file paths in descriptions

## Path Conventions

All paths are relative to `guardian/api/` unless prefixed `../` (repository root).

---

## Phase 1: Setup

**Purpose**: The one new dependency, the one new environment key, and the decision
constants. All leaves — nothing imports anything yet.

- [X] T001 Add `"@nestjs/jwt": "^11.0.2"` to the `dependencies` block of `package.json` (alphabetically, after `@nestjs/core`) and run `npm install`. Confirm with `node -e "console.log(require('@nestjs/jwt/package.json').version)"`. Its peer range covers `@nestjs/common` ^11 and it pulls `jsonwebtoken` 9.0.3 transitively — **no other dependency is added by this feature**; viem and zod are already present ([research R7](./research.md))
- [X] T002 [P] Add `JWT_SECRET` to `src/config/env.schema.ts` in a new `AUTH` section between `CHAIN` and `LLM`: `z.string().min(32, 'expected at least 32 characters')`. **Required, no `.default()`** — the file header states the rule that every key is required precisely so consumers never null-check. One rule, not `.min(1)` plus `.min(32)`, matching the `DATABASE_URL` comment about not naming the same key twice in the error report
- [X] T003 [P] Add `JWT_SECRET` to the repository-root `../.env` (generate with `openssl rand -hex 32`) and to `../.env.example` with a placeholder plus a one-line comment saying it signs session tokens and that changing it invalidates every outstanding token. Until this lands, `npm run preflight` fails and the API will not boot — which is the intended behaviour, not a bug to work around
- [X] T004 [P] Create `src/auth/auth.constants.ts` — export `NONCE_TTL_MS = 5 * 60_000`, `JWT_TTL = '7d'`, and `NONCE_SWEEP_INTERVAL_MS = 60_000`. Comment why these are code constants rather than environment keys: they are neither secret nor per-deployment, and every optional env key is one more thing that can be absent at 3am ([research R7](./research.md)). Note in the comment that [quickstart Step 13](./quickstart.md) temporarily shortens the first two to verify expiry, and must restore them

**Checkpoint**: `npm run build` passes. `npm run preflight` fails naming `JWT_SECRET` if T003 is skipped, and passes once it lands.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The leaf modules both user stories import — validation, errors, types, the
message builder, and the account repository. Every file here is standalone and has no
dependency on another file in this phase.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [X] T005 [P] Create `src/common/zod-validation.pipe.ts` — `ZodValidationPipe implements PipeTransform`, constructed with a `ZodType`, calling `safeParse` and throwing `BadRequestException` with the flattened issue list on failure. New directory: it is not an auth concept and every later module wants it. **Zod, not class-validator** — the project already validates its most safety-critical input (the whole environment) with Zod in `src/config/env.schema.ts`, and a second validation library would mean two idioms and two error shapes ([research R10](./research.md))
- [X] T006 [P] Create `src/auth/errors.ts` — abstract `AuthError` root plus the eight concrete subclasses in [contracts/errors.md](./contracts/errors.md): `NonceNotFoundError`, `NonceExpiredError`, `SignatureMalformedError`, `SignerMismatchError` (carrying `expected` and `recovered`), `MissingCredentialError`, `InvalidTokenError`, `SessionExpiredError`, `UnknownAccountError`. Mirror the structure and comment density of `src/chain/errors.ts` — one root so a caller can write a single `instanceof`, concrete subclasses carrying what the **log** needs. Comment on the root that these classes exist to be distinguished internally and deliberately collapse to two messages externally
- [X] T007 [P] Create `src/auth/jwt-payload.ts` — the `JwtPayload` type (`{ sub: string }` plus `iat`/`exp` supplied by `@nestjs/jwt`) and an `isJwtPayload` type guard. Comment that the payload carries **no address and no role**: the guard reads the account from Postgres anyway to satisfy FR-017, and a second copy of a fact is how a token comes to disagree with the database ([data-model.md](./data-model.md) §3)
- [X] T008 [P] Create `src/auth/request-with-account.ts` — an Express `Request` module augmentation adding `account?: Account`, so `request.account` is typed rather than `any` wherever it is touched
- [X] T009 [P] Create `src/auth/sign-in-message.ts` — `buildSignInMessage(address: Address, nonce: string): string`, producing the exact five-line string in [research R3](./research.md), with the **checksummed** address. This function is the single definition of what gets signed: the endpoint returns its output and the verifier rebuilds it, so the two can never disagree. Comment that the "this is not a transaction and costs nothing" line is deliberate — a wallet popup full of opaque bytes trains users to approve things they cannot read
- [X] T010 Create `src/accounts/account.repository.ts` — `@Injectable`, `@InjectRepository(Account)`. Two methods: `findOrCreateByAddress(address: Address): Promise<Account>` and `findById(id: string): Promise<Account | null>` (returning `null`, not throwing — the guard decides what absence means). `findOrCreateByAddress` canonicalises with viem's `getAddress()` before writing and looks up with a query builder using `lower(account.wallet_address) = :lower`. **Both details are load-bearing and neither is optional** — the write rule keeps the payout address exact, and the lookup form is what matches the functional index; `findOne({ where: { walletAddress } })` would be case-sensitive *and* would sequential-scan ([research R6](./research.md)). One method rather than a separate find and create, because a caller able to call them separately can call them in the wrong order
- [X] T011 Create `src/accounts/accounts.module.ts` — `TypeOrmModule.forFeature([Account])`, providing and **exporting** `AccountRepository`. A whole module for one repository, following the precedent `LedgerModule` set in API-02 for the same reason: `docs/CONTEXT.md` §3 assigns the account to `accounts`, and API-05 builds `/me`, balance, and the ledger on exactly this class

**Checkpoint**: `npm run build` passes. No behaviour is reachable yet — nothing is wired into `app.module.ts`.

---

## Phase 3: User Story 1 — Connecting a wallet is the entire registration (Priority: P1) 🎯 MVP

**Goal**: A wallet the platform has never seen requests a challenge, signs it, and gets
back a session token — with its account created in the same step. No form, no password,
no second registration action.

**Independent Test**: [quickstart.md](./quickstart.md) Steps 1–3 and 11 — from a fresh
`cast wallet new`, reach a token and exactly one correctly-cased `accounts` row.

- [X] T012 [P] [US1] Create `src/auth/dto/nonce.dto.ts` — `nonceRequestSchema` (a `z.object` with `address` matching `^0x[a-fA-F0-9]{40}$`, the same regex `env.schema.ts` uses for `OPERATOR_ADDRESS` and friends, so "valid address" has one definition) and the `NonceResponse` type `{ nonce: string; message: string }`
- [X] T013 [P] [US1] Create `src/auth/dto/verify.dto.ts` — `verifyRequestSchema` (`address` as above, plus `signature` matching `^0x[a-fA-F0-9]+$` and non-empty) and the `VerifyResponse` type `{ token: string }`
- [X] T014 [US1] Create `src/auth/nonce.store.ts` — `@Injectable`, holding `Map<string, StoredNonce>` keyed by **lowercased** address. `issue(address)` generates `randomBytes(32).toString('hex')` from `node:crypto` and stores `{ nonce, address, expiresAt }`, **replacing any existing entry** so at most one challenge is ever outstanding per address. `consume(address)` reads and deletes in one step, returning `null` when absent or expired and deleting an expired entry on the way out; the boundary comparison is `now >= expiresAt` so an entry at exactly its expiry is expired. Comment that single-use is lock-free because Node runs `consume` on one thread with no `await` inside, so nothing can observe the entry between the read and the delete ([research R1](./research.md))
- [X] T015 [US1] Create `src/auth/auth.service.ts` with `issueNonce(address)` — canonicalise with `getAddress()`, call `nonceStore.issue()`, build the message with `buildSignInMessage()`, return `{ nonce, message }`. Issuing reveals nothing and is granted for any syntactically valid address, registered or not
- [X] T016 [US1] Add `verifySignature(address, signature)` to `src/auth/auth.service.ts`, in this exact order: canonicalise → **`nonceStore.consume()`** → rebuild the message from the consumed nonce → `recoverMessageAddress()` → compare with `===` against the stored address → `accountRepository.findOrCreateByAddress()` → `jwtService.signAsync({ sub: account.id })`. **The consume must precede the recovery** — that ordering is what makes a captured message worth exactly one guess instead of five minutes of them ([research R4](./research.md)). `recoverMessageAddress` returns a checksummed address, verified against viem 2.55.11, so `===` is a correct comparison with no `toLowerCase()` ([research R5](./research.md))
- [X] T017 [US1] Create `src/auth/auth.controller.ts` — `@Controller('auth')` with `POST nonce` and `POST verify`, each applying `new ZodValidationPipe(schema)` to the body so a malformed address is rejected before the handler runs and **no challenge is issued** (FR-002). Response shapes exactly as in [contracts/auth-api.md](./contracts/auth-api.md); `/auth/verify` returns the token and nothing else — not the account id, not whether this sign-in created an account
- [X] T018 [US1] Create `src/auth/auth.module.ts` — `JwtModule.registerAsync` reading `JWT_SECRET` from `ConfigService` with `signOptions: { expiresIn: JWT_TTL }`, importing `AccountsModule`, providing `AuthService` and `NonceStore`, declaring `AuthController`. **Export nothing yet.** Comment, mirroring `chain.module.ts`: `JwtService`, `NonceStore`, and `AuthService` must never be exported, because a module that could inject `JwtService` could mint a token for any account id, which would make the guard decorative
- [X] T019 [US1] Register `AuthModule` and `AccountsModule` in the `imports` array of `src/app.module.ts`, keeping the existing alphabetical order
- [X] T020 [US1] Run [quickstart Steps 1–2](./quickstart.md) — a throwaway wallet reaches a token. Read the message printed by Step 2 and confirm it is legible English naming the checksummed address
- [X] T021 [US1] Run [quickstart Step 3](./quickstart.md) — exactly one `accounts` row, `wallet_address` matching the wallet character for character including case. This is the payout destination for every refund and sale the account will ever receive (SC-005)
- [X] T022 [US1] Run [quickstart Step 11](./quickstart.md) — three malformed bodies each return `400` naming the `address` field, and no challenge is issued for any of them

**Checkpoint**: Sign-in works end to end and creates accounts. Nothing is protected yet — the guard arrives in US2.

---

## Phase 4: User Story 2 — Every later request knows who is calling (Priority: P2)

**Goal**: A valid token reaches protected routes and the handler is handed the calling
account; anything missing, expired, tampered with, or naming a vanished account is turned
away before a handler runs. This is the surface API-05 through API-09 are written
against.

**Independent Test**: [quickstart.md](./quickstart.md) Steps 4, 12, 14, 15 — a protected
route identifies the right account, refuses four kinds of bad credential, and an
*unmarked* route is protected rather than open.

- [X] T023 [P] [US2] Create `src/auth/public.decorator.ts` — `IS_PUBLIC_KEY` and `Public()` via `SetMetadata`. The only way out of the global guard; usable on a handler or a whole controller
- [X] T024 [P] [US2] Create `src/auth/current-account.decorator.ts` — `CurrentAccount()` via `createParamDecorator`, returning `request.account`. **Throw if it is absent.** That state is unreachable on a guarded route, so reaching it means the decorator was used on a `@Public()` route — a programming error that should be loud at the parameter rather than `Cannot read properties of undefined` three lines into the handler, or worse, `undefined` arriving at an ownership check ([research R9](./research.md))
- [X] T025 [US2] Create `src/auth/jwt-auth.guard.ts` — `JwtAuthGuard implements CanActivate`, executing the five steps in [contracts/guard-contract.md](./contracts/guard-contract.md): read `@Public()` via `Reflector.getAllAndOverride` (handler then class) → extract the bearer token → `jwtService.verifyAsync`, mapping `TokenExpiredError` to `SessionExpiredError` and everything else to `InvalidTokenError` → `accountRepository.findById(payload.sub)`, `null` → `UnknownAccountError` → attach the account to `request.account`. Comment that step 4 is a Postgres lookup on every protected request, that it is FR-017's price, and that it is **deliberately not cached** — a cache here is a mechanism for continuing to honour a deleted account
- [X] T026 [US2] Register the guard globally in `src/auth/auth.module.ts`: `{ provide: APP_GUARD, useClass: JwtAuthGuard }`. **Land this together with T027 and T028** — the moment it exists, every route including `/auth/nonce` and `/health` returns 401 until it is marked public. Comment the deviation: this reverses FR-016 as first written, and the argument is in [research R8](./research.md) — the two defaults differ only in what happens when someone forgets, and forgetting must not leave `POST /withdraw` open
- [X] T027 [US2] In `src/auth/auth.controller.ts`, add `@Public()` to both existing handlers and add `GET session` — protected, taking `@CurrentAccount() account: Account` and returning `{ accountId, address }`. It exists so the guard has something to guard: without it FR-014 and FR-015 stay undemonstrable until API-05. It is **not** `/me`, which arrives in API-05 carrying balance and escrow ([contracts/auth-api.md](./contracts/auth-api.md))
- [X] T028 [US2] Add `@Public()` to the `check()` handler in `src/health/health.controller.ts`. The existing comment there — *"Unauthenticated by design, and it must stay that way once auth lands"* — is the warning this task answers; a guarded health check breaks the Compose dependency graph for a reason that looks like a database problem. Extend the comment with a line noting the guard is now global, so the marker is load-bearing rather than decorative
- [X] T029 [US2] Run [quickstart Step 4](./quickstart.md) — `GET /auth/session` with a valid token returns the account id and address from the row created in T021
- [X] T030 [US2] Run [quickstart Step 12](./quickstart.md) — all four of no header, garbage token, missing `Bearer` scheme, and a last-character-flipped token return `401`. The tampered case is the one that matters: a broken HS256 signature must be refused, not trusted (FR-012)
- [X] T031 [US2] Run [quickstart Step 14](./quickstart.md) — delete the account row and confirm a still-valid, unexpired token is refused (FR-017). Sign in again afterwards to restore the account
- [X] T032 [US2] Run [quickstart Step 15](./quickstart.md) — `/health` and `/auth/nonce` answer with no credential, then temporarily comment out `@Public()` on `/auth/nonce` and confirm it returns `401`. **This is the one step that demonstrates fail-closed**; without it, T026's whole argument is untested. Restore the decorator

**Checkpoint**: The guard is live and every later module can rely on `@Public()` and `@CurrentAccount()`.

---

## Phase 5: User Story 3 — One wallet is always the same account (Priority: P3)

**Goal**: A returning wallet lands in the account it already has, never a duplicate, and
the address stored for it is exact.

**Independent Test**: [quickstart.md](./quickstart.md) Steps 5 and 6 — sign in three
times, twice with different casing, and the account count stays at 1.

**Why this phase is short on new files**: both rules were built into
`AccountRepository` at T010 because sign-in cannot work correctly without them. What is
left is the part that is easy to believe and hard to know — that the index is actually
being used, and that the duplicate really cannot appear.

- [X] T033 [US3] Confirm the lookup uses the functional index rather than scanning: run `EXPLAIN SELECT * FROM accounts WHERE lower(wallet_address) = lower('0x…');` against the running database and check for an **Index Scan on `accounts_wallet_lower_idx`**. A `Seq Scan` means T010's query was written against the column rather than the expression and both the correctness and the performance claims are wrong ([research R6](./research.md)). **Do not run `migration:generate` while checking this** — it will propose dropping the index, exactly as `src/entities/account.entity.ts` warns
- [X] T034 [US3] Confirm `buildSignInMessage` echoes the **checksummed** address regardless of the casing submitted, by inspecting the message returned for a lowercased request. The user reads this line in their wallet, and it is the only place before signing where they can see the address the platform resolved
- [X] T035 [US3] Run [quickstart Step 5](./quickstart.md) — a second sign-in returns the same `accountId`, the account count stays at 1, and **the first token still works**. Two live sessions for one wallet is the intended behaviour; neither invalidates the other (US3 scenario 6)
- [X] T036 [US3] Run [quickstart Step 6](./quickstart.md) — signing in with the all-lowercase form of the same address yields the same `accountId` and no second row. A count of 2 here means the lookup is comparing raw `wallet_address`; go back to T010
- [X] T037 [US3] Confirm no roles exist anywhere: grep `src/` for `role`, `Roles`, `isSeller`, `isBuyer`. **Expect zero hits in application code.** The account entity has no role column, the token has no role claim, and no `@Roles()` decorator exists, so authorisation in `catalog` and `orders` has nothing to fall back on but comparing ownership against the resource (FR-018, `docs/api-design.md` §7)

**Checkpoint**: Identity is provably stable and the payout address is provably exact.

---

## Phase 6: User Story 4 — A captured signature is useless (Priority: P4)

**Goal**: Every challenge is worth one attempt and expires on its own; a signature from
the wrong wallet is refused; and no failure response reveals whether an address has an
account.

**Independent Test**: [quickstart.md](./quickstart.md) Steps 7–10 and 13 — a replay
fails, a wrong guess burns the challenge, a foreign signature is refused, and a request
for an unregistered address is byte-identical to one for a registered address.

**Why this phase is mostly hardening**: the consume-before-verify ordering landed in T016
because the happy path needs it. What is added here is the failure machinery around it —
the uniform response, the diagnostic log, and the memory bound.

- [X] T038 [US4] In `src/auth/auth.service.ts`, replace ad-hoc throws with the `errors.ts` classes from T006 and map **all four** of `NonceNotFoundError`, `NonceExpiredError`, `SignatureMalformedError`, and `SignerMismatchError` to a single `UnauthorizedException('Signature verification failed')`. Wrap `recoverMessageAddress` in a try/catch so an undecodable signature becomes `SignatureMalformedError` rather than a leaked viem error. **`401`, never `400`** — using `400` for the malformed case would put back into the status line the distinction the message body is careful not to make ([contracts/errors.md](./contracts/errors.md))
- [X] T039 [US4] Add `Logger` calls at `warn` in `src/auth/auth.service.ts` and `src/auth/jwt-auth.guard.ts` recording the real cause of each refusal, with `SignerMismatchError` logging **both** the expected and recovered addresses — during the demo the likeliest cause is a wallet connected to a different account than the one on screen, and having both values turns a five-minute confusion into a five-second one. **Never log the token, any part of it, `JWT_SECRET`, or the signature bytes.** Addresses are public by construction and are the only thing that makes an auth log diagnosable
- [X] T040 [US4] Add expired-entry sweeping to `src/auth/nonce.store.ts` — a `setInterval` at `NONCE_SWEEP_INTERVAL_MS` calling a private `sweep()`, with `implements OnModuleDestroy` clearing it so the process can exit. Comment that this is for **bounding memory, not correctness**: expiry is already enforced on read in `consume()`, and the sweep exists because an unbounded map with no eviction is trivial to write now and awkward to add later
- [X] T041 [US4] Run [quickstart Step 7](./quickstart.md) — resubmitting the exact address-and-signature pair from a successful sign-in returns `401` (SC-003)
- [X] T042 [US4] Run [quickstart Step 8](./quickstart.md) — one wrong signature against a fresh challenge, then the **correct** signature for that same challenge. **Both must fail.** The second failing is the whole point: one guess ends the challenge (US4 scenario 7)
- [X] T043 [US4] Run [quickstart Step 9](./quickstart.md) — a second wallet's signature over the right message is refused (SC-004), and the server log carries one `warn` naming both addresses
- [X] T044 [US4] Run [quickstart Step 10](./quickstart.md) — a signature for an address that never requested a challenge is refused and creates no account. Then **diff this response against Step 7's byte for byte**: one address has an account and the other does not, and if the two responses differ at all, `/auth/verify` is an oracle for enumerating which wallets hold funds here (FR-019)
- [X] T045 [US4] Run [quickstart Step 13](./quickstart.md) — temporarily shorten `NONCE_TTL_MS` and `JWT_TTL` in `src/auth/auth.constants.ts`, confirm an expired challenge gives the generic verification failure while an expired token gives the distinct **"Session expired"**, then **restore both constants to `5 * 60_000` and `'7d'`**. Verify the restore by re-reading the file; shipping a 3-second token lifetime would be discovered on stage

**Checkpoint**: All four stories complete. Every acceptance scenario in the spec has been exercised.

---

## Phase 7: Polish & Cross-Cutting Concerns

- [X] T046 [P] Add `JWT_SECRET` to the `suspects` array in `src/config/detect-placeholders.ts` with a matcher for the `.env.example` placeholder value, so a developer running with the example secret is told at boot. Follows the existing pattern: names only, never values, non-blocking
- [X] T047 [P] Add an auth section to `README.md` — the two-call sign-in flow, the `Authorization: Bearer` header, and the fact that endpoints are protected by default with `@Public()` as the opt-out. This is the note that stops the next module's author reinventing a guard
- [X] T048 Confirm the viem boundary held: `grep -rnE "from 'viem" src --include='*.ts'` returns hits only under `src/chain/`, `src/auth/` and `src/accounts/`, and the two new directories' hits are `getAddress`, `recoverMessageAddress`, and the `Address`/`Hex` types — **no client, no transaction, no unit conversion**. **Outcome: the check fired.** `src/accounts/account.repository.ts` imports `getAddress`, which the plan's original two-directory widening did not cover. The rule was wrong, not the code — canonicalising at the point of write makes "every stored address is checksummed" an invariant of the row instead of a promise each caller keeps — so [plan.md](./plan.md) now records a three-directory boundary under Complexity Tracking
- [X] T049 Run [quickstart.md](./quickstart.md) start to finish in one sitting, on a clean database, following the cleanup step at the end. The individual steps were run inside their phases; this pass catches the interactions between them and is the closest thing this component has to a regression suite

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies. T002/T003/T004 are parallel; T001 is independent of all three
- **Foundational (Phase 2)**: Needs T001 (for nothing it imports yet, but the build must be clean) and T004. **Blocks both user stories.** T005–T009 are fully parallel; T010 needs the `Account` entity (already exists); T011 needs T010
- **US1 (Phase 3)**: Needs Phase 2 complete
- **US2 (Phase 4)**: Needs Phase 2 complete. **Does not need US1's service** — but its verification steps use a token, so run US1 first unless two people are working
- **US3 (Phase 5)**: Needs US1 (its proofs sign in)
- **US4 (Phase 6)**: Needs US1 (its proofs sign in)
- **Polish (Phase 7)**: Needs everything

### User Story Dependencies

- **US1 (P1)**: Independent once Phase 2 lands. The MVP
- **US2 (P2)**: Structurally independent of US1 — disjoint files, no shared functions. Verification borrows a token from US1
- **US3 (P3)**: Verifies and hardens code US1 wrote. Cannot precede it
- **US4 (P4)**: Same. T038 and T040 modify `auth.service.ts` and `nonce.store.ts` from T014/T016

### Within Each User Story

- Types and schemas before the services that import them
- Store and repository before the service
- Service before the controller
- Implementation before its verification tasks
- Story complete before moving to the next

### Parallel Opportunities

- **Phase 1**: T002, T003, T004 together (three different files)
- **Phase 2**: T005, T006, T007, T008, T009 together — five files, zero imports between them. The largest parallel block in the feature
- **Phase 3**: T012 and T013 together; everything after is sequential through `auth.service.ts` and `auth.controller.ts`
- **Phase 4**: T023 and T024 together, then T025 → T026/T027/T028 as one landing
- **Phase 7**: T046 and T047 together
- **Across stories**: with two developers, one takes Phase 3 and the other Phase 4 the moment Phase 2 closes. They meet at `auth.module.ts` (T018 creates it, T026 adds one provider) — the only file both touch

---

## Parallel Example: Phase 2

```bash
# Five leaf files, no imports between them — launch together:
Task: "Create src/common/zod-validation.pipe.ts"
Task: "Create src/auth/errors.ts"
Task: "Create src/auth/jwt-payload.ts"
Task: "Create src/auth/request-with-account.ts"
Task: "Create src/auth/sign-in-message.ts"

# Then, in order:
Task: "Create src/accounts/account.repository.ts"
Task: "Create src/accounts/accounts.module.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 only)

1. Phase 1: Setup — T001–T004
2. Phase 2: Foundational — T005–T011 (**blocks everything**)
3. Phase 3: US1 — T012–T022
4. **STOP and VALIDATE**: quickstart Steps 1–3 and 11 pass

At this point a wallet can register and hold a token. Nothing consumes the token yet, so
this is a genuine but incomplete increment — useful to demo, not safe to build on.

### Incremental Delivery

1. Setup + Foundational → the leaves exist
2. **+ US1** → registration works (MVP)
3. **+ US2** → the token means something; every later module now has its guard
4. **+ US3** → identity is provably stable and the payout address provably exact
5. **+ US4** → replays and forged signatures are provably refused
6. Polish → full quickstart pass

**The natural stopping point is after US2.** That is the smallest version API-05 can be
built on top of. US3 and US4 are not optional before the demo, though — without them the
system duplicates accounts on a case difference and accepts a replayed signature, and
both failures surface in front of an audience rather than in a log.

### Parallel Team Strategy

With two developers, after Phase 2 closes:

- **Developer A**: Phase 3 (US1) → then Phase 5 and Phase 6, which build on it
- **Developer B**: Phase 4 (US2) → then Phase 7's T046/T047

Coordinate on `src/auth/auth.module.ts` (T018 creates it, T026 adds the `APP_GUARD`
provider) and `src/auth/auth.controller.ts` (T017 creates it, T027 adds `@Public()` and
the session route). Everything else is disjoint.

---

## Notes

- `[P]` = different files, no dependencies on incomplete tasks
- `[Story]` maps a task to its user story for traceability
- **No migration is generated or run in this feature.** `accounts` and its functional
  unique index came from API-02, and `migration:generate` will propose dropping the index
- Commit after each task or logical group; T026/T027/T028 are one group
- Verification tasks are the test suite — a failed verification step is a red build
- Restore anything a verification step temporarily changed (T032's decorator, T045's
  constants) before moving on
