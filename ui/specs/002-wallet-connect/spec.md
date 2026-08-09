# Feature Specification: Wallet Connect & Session

**Feature Branch**: `002-wallet-connect`

**Created**: 2026-08-08

**Status**: Draft

**Input**: User description: "docs/specs/UI-02-wallet-connect.md — Connect a wallet, which is the entire registration flow. Monad testnet chain definition (id 10143, MonadVision explorer); Connect button → request a nonce → sign → verify → session token; session persistence across reloads; auth guard on protected screens; disconnect; wrong-network detection with a switch prompt. Out of scope: automated tests of any kind, any contract interaction, transaction signing beyond the auth nonce, key storage."

## Overview

Guardian has no sign-up form. There is no password, no email address, and no external identity provider. **Connecting a wallet and signing one short challenge is the entire registration flow** — the first successful signature creates the account, and every subsequent visit re-uses it.

This feature turns the entry screen from a placeholder into that flow, and gives the rest of the application the two things it has been missing since the foundation shipped: a session that survives a page reload, and a rule about which screens require one.

Two boundaries define the shape of this work, and both are places where it would be natural to build more than is wanted:

- **The wallet signs exactly one thing: the authentication challenge.** Every movement of money happens server-side through the operator. This feature must not create any path by which a user's wallet is asked to approve a transaction.
- **The network the wallet is pointed at does not gate signing.** Signing a challenge is a local operation. Wrong-network detection exists so the user is not surprised later by balances and explorer links that assume Monad testnet — it warns and offers a fix, it does not lock the person out.

The people served are the **demo operator**, who must be able to sign in reliably and recover from an accidental page refresh mid-rehearsal, and the **buyer or seller** on stage, for whom "how do I get an account?" should never be a question that has an answer longer than one sentence.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Connecting a wallet signs me in and creates my account (Priority: P1)

A first-time visitor lands on the entry screen. It says, in effect, that connecting a wallet is all there is to it. They activate the connect control, choose their browser wallet, and approve the connection. The application then asks the backend for a one-time challenge for their address, asks the wallet to sign it, and sends the signature back for verification. The backend recognises a valid signature, creates the account if this address has never been seen, and returns a session credential. The visitor is now signed in, sees their own address on screen, and is taken onward into the product.

**Why this priority**: Nothing else in the product is reachable without it. It is also the whole of registration — so this single story is a complete, demonstrable feature on its own.

**Independent Test**: With the backend running, open the entry screen in a browser with a wallet extension holding an address that has never signed in. Complete the connect-and-sign flow and confirm a signed-in state with that address shown. Repeat with the same address and confirm sign-in succeeds again without creating a second account.

**Acceptance Scenarios**:

1. **Given** a visitor with no session and a browser wallet available, **When** they activate the connect control and approve the wallet connection, **Then** the application requests a challenge for the connected address and the wallet prompts them to sign it.
2. **Given** the wallet prompt is showing, **When** the visitor approves the signature, **Then** the application submits the signature for verification, stores the returned session credential, and shows a signed-in state carrying their address in an abbreviated, readable form.
3. **Given** an address that has never signed in before, **When** verification succeeds, **Then** an account exists for that address and no additional registration step is presented — no form, no password, no email.
4. **Given** the visitor is signed in, **When** the flow completes, **Then** the application moves them off the entry screen to the screen they originally intended to reach, or to the marketplace if they arrived at the entry screen directly.
5. **Given** the visitor is already signed in with a valid session, **When** they navigate to the entry screen, **Then** they are not asked to sign again and are shown their signed-in state (or moved onward) rather than a connect prompt.
6. **Given** no wallet is available in the browser at all, **When** the entry screen renders, **Then** it explains that a browser wallet is required and how to get one, rather than presenting a control that cannot work.

---

### User Story 2 - My session survives a page reload (Priority: P2)

A signed-in user reloads the page — deliberately, or by fumbling a keystroke thirty seconds before a demo. The application comes back already signed in. It does not ask for a second signature, and it does not flash a connect screen before recovering.

**Why this priority**: This is the difference between an accidental refresh being a non-event and being a visible stumble in front of an audience. It is separable from Story 1 and independently observable.

**Independent Test**: Sign in, reload the page, and confirm the signed-in state returns with no wallet prompt. Then reload with the wallet extension locked and confirm the session is still recognised.

**Acceptance Scenarios**:

1. **Given** a signed-in user, **When** they reload the page, **Then** they remain signed in, no signature is requested, and the signed-in state reappears without an intervening connect screen.
2. **Given** a signed-in user on a protected screen, **When** they reload that screen directly by its address, **Then** that same screen renders with their data rather than bouncing them to the entry screen.
3. **Given** a stored session credential exists but the wallet is locked or has not yet reconnected, **When** the application starts, **Then** the user is still treated as signed in, because the credential — not the live wallet connection — is what proves identity.
4. **Given** the application is still determining whether a stored session exists, **When** a protected screen is requested, **Then** a brief resolving state is shown rather than a premature redirect to the entry screen.
5. **Given** a stored credential the backend no longer accepts, **When** the first request using it is rejected as unauthenticated, **Then** the credential is discarded and the user is returned to the entry screen to sign in again, without a repeated-rejection loop.

---

### User Story 3 - Protected screens require a session; disconnect ends it (Priority: P3)

Screens that show a person's own money, orders, or listings are unavailable without a session; a visitor who requests one is sent to the entry screen and, after signing in, arrives at the screen they originally asked for. The public catalogue remains browsable without signing in. A signed-in user can disconnect from anywhere in the header: the session ends, protected screens become unavailable again, and nothing personal remains visible.

**Why this priority**: It makes the session mean something. It is also what lets the demo be re-run cleanly — sign out, sign in as the other party — without clearing browser storage by hand.

**Independent Test**: While signed out, request each protected address directly and confirm the redirect and the post-sign-in return. Then sign in, disconnect, and confirm protected screens are unavailable again and no personal figures remain on screen.

**Acceptance Scenarios**:

1. **Given** no session, **When** the visitor requests a protected screen by its address, **Then** they are sent to the entry screen with the requested destination remembered.
2. **Given** a visitor was redirected from a protected screen, **When** they complete sign-in, **Then** they land on the screen they originally requested, not on a generic landing screen.
3. **Given** no session, **When** the visitor browses the public catalogue screens, **Then** those screens render normally without any sign-in prompt blocking them.
4. **Given** a signed-in user on any screen, **When** they activate disconnect, **Then** the session credential is discarded, the wallet connection is released, and the header returns to its signed-out state.
5. **Given** the user has just disconnected, **When** they attempt to return to a protected screen — including by using the browser's back control — **Then** they are sent to the entry screen and no personal data from the previous session is displayed.
6. **Given** the user disconnects, **When** the header re-renders, **Then** it shows the sign-in affordance and no money figures, matching the signed-out behaviour already established for the shell.

---

### User Story 4 - Being on the wrong network is visible, with a one-click fix (Priority: P4)

A user whose wallet is pointed at some other network sees a persistent, unmissable notice naming the network the product expects, with a control that asks the wallet to switch. Approving the switch clears the notice. Declining leaves the notice in place. Signing in is not blocked either way — the product never asks the wallet to send a transaction, so the network affects what the user sees, not what they can do.

**Why this priority**: It prevents a confusing stretch of demo where balances and explorer links appear wrong for a reason nobody on stage can see. It is the last story because everything else works without it.

**Independent Test**: Point the wallet at a different network, load the application, and confirm the notice appears. Activate the switch control and approve, and confirm the notice disappears. Repeat and decline, and confirm the notice persists and the application still functions.

**Acceptance Scenarios**:

1. **Given** a connected wallet on a network other than the expected one, **When** any screen renders, **Then** a persistent notice names both the current and the expected network and offers a switch control.
2. **Given** the wrong-network notice is showing, **When** the user activates the switch control and approves it in the wallet, **Then** the notice disappears without a page reload.
3. **Given** the user declines the switch, **When** the wallet returns control, **Then** the notice remains, no error is thrown at them, and the application continues to work.
4. **Given** the wallet does not yet know the expected network, **When** the switch is requested, **Then** the application asks the wallet to add it — using the network's published identity, currency, endpoint, and explorer — and then to switch to it.
5. **Given** a connected wallet on the expected network, **When** any screen renders, **Then** no network notice appears.
6. **Given** a signed-in user on the wrong network, **When** they use the product, **Then** sign-in and all screens remain available; the network state warns but does not block.

---

### Edge Cases

- **The user rejects the wallet connection prompt.** The entry screen returns to its initial state with a plain explanation and the connect control still available. No partial session is stored.
- **The user rejects the signature prompt**, or closes the wallet popup without answering. Same outcome: no credential stored, a clear message, and the control ready to retry. A rejected signature is a normal choice, not an error to be styled like a crash.
- **The challenge request or the verification request fails** (backend down, timeout, rejection). The flow stops with a message distinguishing "we couldn't reach the backend" from "the backend refused the signature", and the user can retry without reloading.
- **Verification is rejected as an invalid signature.** The stale challenge is not reused; a retry starts a fresh challenge request.
- **The user switches accounts in the wallet while signed in.** The session belongs to the address that signed, so the application must not silently present another address's data: the existing session is ended and the user is invited to sign in as the new address.
- **The user disconnects the site from inside the wallet extension.** The application notices the loss of connection and returns to a signed-out state rather than continuing to show a signed-in header.
- **A second connect attempt is made while one is already in flight** (double-click on the connect control). Only one challenge is requested and only one signature prompt appears.
- **Browser storage is unavailable** (private browsing, storage disabled). Sign-in still works for the current page view; the user is told the session will not survive a reload rather than being shown a silent failure.
- **The user has multiple wallet extensions installed.** They are able to choose which one to connect rather than the application picking one arbitrarily.
- **The wallet is connected but locked when the page loads.** A stored credential still signs the user in; only actions that need a signature would require unlocking, and this feature has none after sign-in.
- **The clock or challenge expires between issuing and signing** (the user leaves the prompt open for minutes). Verification fails cleanly and a retry obtains a fresh challenge.

## Requirements *(mandatory)*

### Functional Requirements

**Wallet connection**

- **FR-001**: The application MUST let a visitor connect a browser wallet from the entry screen, and MUST let them choose among the wallets available in their browser rather than selecting one implicitly.
- **FR-002**: The application MUST expose the connected wallet's address, connection status, and current network to any screen that needs them, from one shared source rather than per-screen.
- **FR-003**: The application MUST NOT request any signature other than the authentication challenge, and MUST NOT contain a code path that asks the wallet to submit a transaction or to interact with the escrow contract.
- **FR-004**: The application MUST NOT store, request, or handle a private key or seed phrase in any form.
- **FR-005**: When no wallet is available in the browser, the entry screen MUST say so and explain what is needed, instead of offering a control that cannot succeed.

**Sign-in**

- **FR-006**: On connection, the application MUST obtain a one-time challenge from the backend for the connected address, request the wallet's signature over it, and submit address and signature for verification.
- **FR-007**: On successful verification, the application MUST store the returned session credential through the existing single session store, and MUST treat that credential as the sole proof of identity thereafter.
- **FR-008**: The application MUST treat a first successful verification as account creation and MUST NOT present any additional registration step — no password, no email address, no external provisioning.
- **FR-009**: The application MUST distinguish, in what it shows the user, between: the wallet connection being refused, the signature being refused, the backend being unreachable, and the backend rejecting the signature. Each MUST leave the entry screen retryable without a page reload.
- **FR-010**: A refused connection or a refused signature MUST leave no stored credential and no partially signed-in state.
- **FR-011**: The application MUST prevent concurrent sign-in attempts: while one is in flight, further activations of the connect control MUST NOT issue a second challenge or a second signature prompt.
- **FR-012**: Each sign-in attempt MUST use a freshly obtained challenge; a challenge from a failed or abandoned attempt MUST NOT be reused.

**Session**

- **FR-013**: A stored session credential MUST be recognised on application start, so a page reload restores the signed-in state without any wallet interaction.
- **FR-014**: The application MUST expose one authentication state — signed in, signed out, or still resolving — and every screen and the header MUST derive their behaviour from it rather than reading storage directly.
- **FR-015**: While authentication state is still resolving, the application MUST NOT redirect away from a protected screen; it MUST show a resolving state until the answer is known.
- **FR-016**: The application MUST treat the credential, not the live wallet connection, as proof of identity: a locked or not-yet-reconnected wallet MUST NOT sign the user out.
- **FR-017**: When the backend rejects the credential as unauthenticated, the application MUST end the session and return the user to the entry screen, reusing the existing unauthenticated signal rather than adding a second mechanism.
- **FR-018**: When the wallet reports that the active account has changed to a different address, the application MUST end the current session rather than display the new address alongside the previous account's data.
- **FR-019**: When the wallet reports that the site has been disconnected from within the wallet, the application MUST return to a signed-out state.

**Access control**

- **FR-020**: The application MUST require a session for the wallet, orders list, order detail, seller's agents, and create-agent screens.
- **FR-021**: The application MUST leave the entry screen and the public catalogue screens (marketplace and agent detail) reachable without a session.
- **FR-022**: A request for a protected screen without a session MUST redirect to the entry screen and MUST remember the requested destination.
- **FR-023**: After a successful sign-in that followed such a redirect, the application MUST navigate to the originally requested destination; with no remembered destination, it MUST navigate to the marketplace.

**Disconnect**

- **FR-024**: The application MUST offer a disconnect control from the persistent header, available on every screen while signed in.
- **FR-025**: Disconnecting MUST discard the stored credential, release the wallet connection, and return the header to its signed-out presentation with no money figures shown.
- **FR-026**: After disconnecting, protected screens MUST be unreachable — including via the browser's back control — and no data from the ended session MUST remain on screen.

**Network**

- **FR-027**: The application MUST define the expected network by its published identity — chain identifier 10143, name, native currency, endpoint, and block explorer — in one place, so that later features linking to the explorer use the same definition.
- **FR-028**: While a wallet is connected to any other network, the application MUST show a persistent notice on every screen, naming the current and expected networks and offering a switch control.
- **FR-029**: Activating the switch control MUST ask the wallet to switch to the expected network, and MUST ask the wallet to add the network first when the wallet does not already know it.
- **FR-030**: A declined or failed switch MUST leave the notice in place and MUST NOT break the screen the user is on.
- **FR-031**: Being on the wrong network MUST NOT block sign-in or access to any screen; it warns only.
- **FR-032**: When the connected network is the expected one, no network notice MUST be shown.

**Header**

- **FR-033**: While signed in, the header MUST show the connected address in an abbreviated, readable form alongside the disconnect control.
- **FR-034**: The header's existing two-figure money display MUST appear only while signed in, and MUST return to the sign-in affordance on disconnect — the previously established rule that the two figures are never collapsed into one is unchanged.

**Out of scope for this feature**

- **FR-035**: This feature MUST NOT include automated tests of any kind. Acceptance is verified by hand (see Assumptions).
- **FR-036**: This feature MUST NOT implement any contract interaction, any transaction signing, any key storage, or any content on the protected screens beyond the access rule that guards them.

### Key Entities

- **Wallet connection**: The live link to the visitor's browser wallet — its address, whether it is connected, and which network it is pointed at. Transient: it is lost on reload and re-established by the wallet, and it is *not* what proves identity.
- **Authentication challenge**: A one-time value issued by the backend for a specific address, signed once and then spent. Never reused across attempts.
- **Session credential**: The proof of a signed-in account, already owned by the foundation's single session store. Written here for the first time — after verification — and cleared on disconnect, on account change, and on backend rejection.
- **Authentication state**: The application's one answer to "who is signed in?", with three values — signed in, signed out, resolving — from which the header, the route guard, and the entry screen all derive their behaviour.
- **Expected network**: The chain the product operates on, defined once by identifier, name, currency, endpoint, and explorer; compared against the wallet's current network and used later for explorer links.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A first-time visitor with a funded browser wallet goes from the entry screen to a signed-in state in **under 30 seconds and exactly two wallet approvals** — one to connect, one to sign — with no form to fill in.
- **SC-002**: Signing in with an address that has never been used creates an account with **zero** additional registration steps presented to the user.
- **SC-003**: Reloading the page while signed in restores the signed-in state on **10 of 10** consecutive reloads, with zero wallet prompts and no visible flash of the connect screen.
- **SC-004**: Each of the five protected screens, requested directly by address while signed out, redirects to the entry screen and — after sign-in — lands on the originally requested screen: **5 of 5** on a manual pass.
- **SC-005**: Both public catalogue screens render fully while signed out, with no sign-in prompt blocking them: **2 of 2**.
- **SC-006**: After disconnecting, all five protected screens are unreachable and the header shows no money figures — verified including a browser-back attempt — **6 of 6** checks.
- **SC-007**: A wallet on any other network produces the notice on every screen visited, and an approved switch clears it without a page reload.
- **SC-008**: Refusing the connection prompt, refusing the signature prompt, and attempting sign-in with the backend stopped each produce a distinct, plain-language message and a retryable entry screen — **3 of 3**, with no unhandled failure in the browser console.
- **SC-009**: Across an entire demo rehearsal, the wallet is asked to approve **exactly one signature** and **zero transactions**.
- **SC-010**: A search of the shipped application finds **zero** occurrences of private-key or seed-phrase handling and **zero** calls to the escrow contract.

## Assumptions

**Inherited decisions** — settled in the root design documents and in the foundation feature; this feature implements rather than revisits them:

- Sign-in is the two-call exchange defined by the API design: a challenge is requested for an address, and an address plus signature are exchanged for a session token. The first successful verification creates the account. There are no passwords, no email addresses, and no external card-provider provisioning at sign-in.
- Wallet connection and signing use the project's chosen React wallet library over the shared on-chain library, whose version floor is the one Monad states. Hand-rolling connector logic is explicitly not wanted.
- The expected network is Monad testnet — chain identifier 10143, native currency MON, with MonadVision as its block explorer. The on-chain library may already publish this definition; using the published one or defining it locally are equally acceptable, provided there is exactly one definition in the frontend.
- The frontend never holds a private key and never calls the escrow contract; every chain write goes through the operator, server-side.
- The session credential lives in browser storage behind the foundation's single session module, which is deliberately opaque about the credential's contents — it is never decoded and never checked for expiry locally. Expiry is discovered by the backend rejecting a request, which keeps one source of truth and avoids a clock-skew bug on a demo laptop. This feature is the first writer to that store.
- The unauthenticated signal already established by the foundation — a window-level event that the shell turns into a route change — is the single mechanism for backend-driven sign-out. This feature adds no second path.
- The component has no automated tests by explicit project decision.

**Defaults chosen here** because the source spec did not settle them:

- **What gets signed** is the challenge value returned by the backend, signed as a plain personal message. The verification call carries only address and signature, so the backend must reconstruct the message from the challenge it issued — a full structured sign-in message with domain and statement fields would require a message field the agreed contract does not have. If the backend later adopts a structured format, the change is confined to how the message is composed before signing.
- **Wrong network warns but does not block.** Signing a message is a local operation independent of the selected chain, and the frontend sends no transactions — so blocking sign-in on network would cost the demo a failure mode while preventing nothing. The notice exists because balances and explorer links later assume Monad, and a silent mismatch is worse than a visible one.
- **Which screens are protected**: wallet, orders list, order detail, seller's agents, create agent. The marketplace and agent-detail screens are left public because the corresponding catalogue endpoints are public — guarding them in the frontend would contradict the backend and would make the product feel closed for no reason.
- **Post-sign-in destination** is the remembered protected screen when the user was redirected, and the marketplace otherwise. The marketplace is the product's actual entry point once you have an account; returning the user to the connect screen would be a dead end.
- **A wallet account change ends the session** rather than silently re-authenticating as the new address. Automatic re-signing would fire an unexpected wallet prompt, and continuing with the old session while showing a new address would be a live misrepresentation of whose money is on screen.
- **The address is shown abbreviated** (leading and trailing characters) — full addresses are unreadable at header size and displaced content the header already carries.
- The entry screen keeps a small, honest indication of whether the backend is reachable, since sign-in has a backend dependency and a failed rehearsal should be diagnosable in one glance rather than in devtools.

**Verification method**: every acceptance scenario and success criterion above is verified by hand, using a browser wallet extension on a demo laptop. The demo rehearsal is the real test suite — a failed rehearsal should be treated the way a red build would be.

**Dependencies**:

- The foundation feature (routing, application shell and header, the single backend client with its credential attachment and unauthenticated signal, the session store, and the polling mechanism). This feature fills in seams the foundation deliberately left open.
- A running backend exposing the challenge and verification endpoints. No story here can be verified with the backend stopped, except the wrong-network notice and the no-wallet-available message.
- A browser wallet extension on the machine used for verification.
