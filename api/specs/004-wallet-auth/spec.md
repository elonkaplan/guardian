# Feature Specification: Wallet Auth

**Feature Branch**: `004-wallet-auth`

**Created**: 2026-08-08

**Status**: Draft

**Input**: User description: "docs/specs/API-04-auth.md — Wallet signature in, JWT out, and account creation. Nonce issue and single-use consumption, signature verification against the claimed address, account created on first successful verify, a guard plus a decorator exposing the current account, addresses stored checksummed and matched case-insensitively. This is the entire registration flow."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Connecting a wallet is the entire registration (Priority: P1)

Someone arriving with nothing but a wallet asks the platform for a one-time challenge tied to their address, signs it in their wallet, and hands the signature back. The platform confirms the signature really came from that address and returns a session credential. If that address has never been seen before, an account is created for it in the same step. There is no form, no password, no email, no separate sign-up.

**Why this priority**: Nothing else in the product can be reached without an identity, and this is the only way to get one. It also has to be fast and unremarkable on stage — a buyer who cannot get past the first screen ends the demo. On its own it delivers a working, self-service way to become a user of the platform.

**Independent Test**: From a wallet the platform has never seen, request a challenge, sign it, submit it, and confirm a session credential comes back and exactly one new account now exists for that address.

**Acceptance Scenarios**:

1. **Given** an address the platform has never seen, **When** a challenge is requested for it, **Then** a single-use challenge value is returned that is tied to that address.
2. **Given** a challenge issued for an address, **When** a signature of the challenge message produced by that address's key is submitted, **Then** the platform returns a session credential.
3. **Given** the same first-time sign-in, **When** it succeeds, **Then** an account now exists for that address and no account existed for it before.
4. **Given** a successful sign-in, **When** the response is inspected, **Then** it carries the session credential and nothing that could be used to sign on the user's behalf.
5. **Given** a challenge request for a malformed value that is not a wallet address, **When** it is submitted, **Then** it is refused with a clear validation failure and no challenge is issued.

---

### User Story 2 - Every later request knows who is calling (Priority: P2)

A caller presenting a valid session credential reaches protected parts of the platform, and the code handling that request is handed the calling account directly rather than having to unpack the credential itself. A caller presenting nothing, something expired, or something tampered with is turned away before any handler runs.

**Why this priority**: The credential from Story 1 is worthless until something honours it, and every subsequent module — catalogue, orders, money — is written against this one way of learning who the caller is. Building it once here is what stops each later module inventing its own. It is independently demonstrable the moment one protected endpoint exists.

**Independent Test**: Call a protected endpoint with a freshly issued credential and confirm it identifies the correct account; repeat with no credential, a malformed one, and an expired one, and confirm each is refused.

**Acceptance Scenarios**:

1. **Given** a valid, unexpired session credential, **When** a protected endpoint is called with it, **Then** the request proceeds and the handler receives the account that signed in.
2. **Given** no credential at all, **When** a protected endpoint is called, **Then** the request is refused as unauthenticated and no handler logic runs.
3. **Given** a credential whose contents have been altered, **When** it is presented, **Then** it is refused rather than trusted.
4. **Given** a credential issued long enough ago to have lapsed, **When** it is presented, **Then** it is refused as expired, distinguishably from a malformed one.
5. **Given** a credential naming an account that no longer exists, **When** it is presented, **Then** the request is refused rather than proceeding with a phantom identity.
6. **Given** an endpoint intended to be public, **When** it is explicitly marked public, **Then** it succeeds with no credential — and an endpoint nobody remembered to mark is protected rather than open, so an omission cannot expose it.

---

### User Story 3 - One wallet is always the same account, and its address is exact (Priority: P3)

A wallet that signs in again gets back into the account it already has, never a duplicate. The address the platform stores for that account is recorded in its canonical, checksummed form, while matching an incoming address against it ignores letter casing. That stored address is the destination for every refund and every payout the account will ever receive, and it holds one account — buyer and seller are the same identity, with ownership decided per resource rather than by any role.

**Why this priority**: A duplicate account silently splits a user's balance and history, and a mis-cased address is the kind of fault that stays invisible until money is sent somewhere it cannot be recovered from. It ranks below the sign-in path only because it cannot be observed until sign-in works.

**Independent Test**: Sign in with the same wallet twice, with the address written in different letter casing each time, and confirm both sessions resolve to one account whose stored address is the canonical checksummed form.

**Acceptance Scenarios**:

1. **Given** a wallet that has signed in before, **When** it signs in again, **Then** it is returned to the existing account and the total number of accounts is unchanged.
2. **Given** an address submitted in all-lowercase and the same address submitted in mixed case, **When** each is used to sign in, **Then** both resolve to the same single account.
3. **Given** any account, **When** its stored address is inspected, **Then** it is in the canonical checksummed form regardless of how it was submitted.
4. **Given** two wallets differing only in the letters of the address, **When** the platform attempts to hold both as separate accounts, **Then** it is prevented from doing so.
5. **Given** an authenticated account, **When** its capabilities are inspected, **Then** it carries no buyer or seller role — the same account can both list and purchase, and permission comes from owning the specific resource.
6. **Given** two sign-ins by the same wallet, **When** both sessions are used, **Then** each identifies the same account and neither invalidates the other.

---

### User Story 4 - A captured signature is useless to whoever captures it (Priority: P4)

A challenge can be spent exactly once and expires quickly on its own. Someone who observes a valid signature in transit and replays it gets nothing. Someone who submits a genuine signature from one address while claiming to be a different address is refused.

**Why this priority**: This is what separates wallet sign-in from a shared password. It has to exist before anyone else is trusted with the system, but it is expressed as refusals of the flow that Stories 1 and 3 establish, so it is built and shown last.

**Independent Test**: Complete one successful sign-in, then submit the exact same address-and-signature pair a second time and confirm it is refused; separately, sign a challenge with one wallet and submit it claiming another address, and confirm that is refused too.

**Acceptance Scenarios**:

1. **Given** a challenge that has already been spent on a successful sign-in, **When** the same signature is submitted again, **Then** it is refused and no new session credential is issued.
2. **Given** a challenge that was issued but never used, **When** it is submitted after its lifetime has elapsed, **Then** it is refused as expired.
3. **Given** a challenge issued for one address, **When** a signature valid for a different address is submitted against it, **Then** the sign-in is refused.
4. **Given** an address that never requested a challenge, **When** a signature is submitted for it, **Then** the sign-in is refused rather than a challenge being invented for it.
5. **Given** a signature that is well-formed but does not recover to the claimed address, **When** it is submitted, **Then** the sign-in is refused with an authentication failure that does not reveal whether the address is known to the platform.
6. **Given** a second challenge requested for an address that already has an unused one, **When** the older challenge is then used, **Then** the platform's behaviour is deterministic and documented rather than incidental.
7. **Given** a failed verification attempt, **When** it is refused, **Then** the challenge is not left in a state where a subsequent guess could succeed on unlimited attempts.

---

### Edge Cases

- **Signature submitted for an address with no outstanding challenge** — refused; the platform never fabricates a challenge to verify against.
- **Challenge reused across addresses** — a challenge is bound to the address it was issued for and cannot be redeemed by another.
- **Concurrent verifies of the same challenge** — at most one succeeds; the other is refused as already spent.
- **Clock skew around expiry** — a challenge at the exact boundary is treated as expired rather than valid, erring toward refusal.
- **Credential outliving the account** — a credential naming a deleted or missing account fails closed.
- **Address casing on the payout path** — because the stored address is the payout destination, any comparison against it ignores casing while any value written to it is canonical.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The platform MUST issue a one-time challenge value on request for a given wallet address, and MUST bind that challenge to that address.
- **FR-002**: The platform MUST reject a challenge request whose address is not a syntactically valid wallet address, without issuing a challenge.
- **FR-003**: A challenge MUST expire on its own after a short, fixed lifetime, and MUST be refused after that point.
- **FR-004**: A challenge MUST be usable at most once; a successful sign-in MUST consume it so the same signature cannot be presented again.
- **FR-005**: The platform MUST verify a submitted signature by recovering the address that produced it and comparing that address to the address the challenge was issued for, refusing any mismatch.
- **FR-006**: The message a user is asked to sign MUST include the challenge value, so that a signature is only meaningful for the challenge it answers.
- **FR-007**: On the first successful verification for an address, the platform MUST create an account for it as part of that same operation.
- **FR-008**: On any subsequent successful verification for a known address, the platform MUST return the existing account and MUST NOT create another.
- **FR-009**: The platform MUST store each account's wallet address in its canonical checksummed form.
- **FR-010**: The platform MUST match incoming addresses against stored addresses without regard to letter casing, and MUST make it impossible for two accounts to exist for addresses that differ only in casing.
- **FR-011**: A successful verification MUST return a session credential that identifies the account and can be presented on later requests.
- **FR-012**: A session credential MUST be tamper-evident — any alteration MUST cause it to be refused.
- **FR-013**: A session credential MUST expire after a fixed lifetime, after which it MUST be refused.
- **FR-014**: The platform MUST provide a single, reusable way to mark an endpoint as requiring authentication, which refuses missing, malformed, and expired credentials before any handler logic runs.
- **FR-015**: The platform MUST provide a single, reusable way for a handler to obtain the calling account without unpacking the credential itself.
- **FR-016**: Endpoints MUST require authentication by default and MUST be reachable without a credential only when explicitly marked public, so that forgetting to classify an endpoint fails closed.
- **FR-017**: The platform MUST refuse a credential that names an account which cannot be found.
- **FR-018**: Accounts MUST carry no role distinction; the same account MUST be able to act as both buyer and seller, with permission decided by ownership of the specific resource.
- **FR-019**: Authentication failures MUST NOT disclose whether an address is already registered.
- **FR-020**: The platform MUST NOT collect or store a password, an email address, or any other credential beyond the wallet address.

### Key Entities

- **Account**: One per registered wallet. Holds the canonical checksummed wallet address — which is also the payout destination for every refund and sale — and the moment it was created. Carries no role, no password, no contact details.
- **Sign-in challenge**: A short-lived, single-use value issued for one specific address, tracking whether it has been spent and when it lapses. It exists only between a challenge request and the verification that answers it.
- **Session credential**: Proof of a completed sign-in, naming the account it belongs to and carrying its own expiry. Presented on later requests; cannot be altered without being refused.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A first-time user goes from connecting a wallet to holding a usable session in a single sign-and-submit step, with no form to fill in and no second registration action.
- **SC-002**: A user who signs in twice from the same wallet lands in the same account both times — verified by the account count being unchanged after the second sign-in.
- **SC-003**: Replaying a previously successful address-and-signature pair fails 100% of the time.
- **SC-004**: A signature produced by any wallet other than the one being claimed is refused 100% of the time.
- **SC-005**: Every account's stored address matches the canonical checksummed form of the wallet that created it, character for character, for every account created during a full demo rehearsal — so no refund or payout can be misdirected by casing.
- **SC-006**: Every protected endpoint refuses a request with no credential, and every protected handler receives the correct calling account when one is supplied.
- **SC-007**: A full Act 1 and Act 2 demo rehearsal completes without any sign-in step needing to be retried.

## Assumptions

- **Challenge lifetime is 5 minutes.** Long enough to sign in a wallet without hurrying, short enough that a captured unused challenge is worthless in practice.
- **Session credential lifetime is 7 days.** No refresh mechanism, no revocation list, and no sign-out endpoint — the credential simply lapses. This is an MVP-scale decision; the demo never runs long enough for expiry to matter, and refresh tokens are explicitly out of scope.
- **Requesting a new challenge for an address invalidates any earlier unused one**, so at most one challenge is outstanding per address at any time. This is the behaviour FR-004 and edge-case handling assume.
- **The signed message is human-readable and states what is being authorised**, embedding the challenge value so a user can see in their wallet that they are signing in rather than approving a transaction.
- **Challenge storage need not survive a restart.** A user whose challenge is lost simply requests another; nothing of value is destroyed.
- **No rate limiting on challenge requests or verification attempts**, consistent with the component-wide out-of-scope list. FR-004's single-use consumption is the replay defence, not throttling.
- **Automated tests are out of scope** for this component, per `docs/CONTEXT.md`. Every acceptance scenario above is verified by hand, and the demo rehearsal is the regression suite.
- **The account record and its case-insensitive uniqueness guarantee already exist** from API-02. This feature is the only thing that creates accounts; it does not define how they are stored.
- **Address recovery from a signature uses the standard personal-message signing scheme** that browser wallets expose by default, so no custom wallet integration is required on the client side.
