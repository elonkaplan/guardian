# Feature Specification: UI Foundation

**Feature Branch**: `001-ui-foundation`

**Created**: 2026-08-08

**Status**: Draft

**Input**: User description: "docs/specs/UI-01-foundation.md — An app that runs, routes, and talks to the API. Routes for all eight pages with placeholder components; typed API client (base URL from env, JWT header, normalised errors); a polling hook that takes an interval and stops on a terminal state; app shell with a header balance widget linking to Wallet; Dockerfile and docker-compose.yml. Out of scope: automated tests of any kind, page content, wallet connection, styling systems beyond a basic setup."

## Overview

This is the frontend's skeleton, not a user-facing feature. It exists so that the seven feature specs that follow (UI-02 onward) each start from a running application with navigation, a working path to the backend, and the one piece of shared machinery — live updates — that three separate pages will otherwise each invent differently.

The people served by this work are the **developer building subsequent UI features** and the **demo operator** who has to start the application reliably before a rehearsal or a judged run. Buyers and sellers see nothing new here; every page is a placeholder.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Every page has an address that resolves (Priority: P1)

A developer starts the application and can reach any of the eight product screens by URL or by navigating in the browser. Each screen renders a recognisable placeholder that names the screen and shows any identifier from the address (an agent id, an order id). Nothing is styled beyond legibility, and nothing has content — but the map of the product exists and is navigable.

**Why this priority**: Without this, no subsequent feature spec has a place to put its work. It is also the only story that delivers standalone value on its own: a navigable eight-screen skeleton is a demonstrable artifact.

**Independent Test**: Start the application, visit each of the eight addresses in turn, and confirm each renders its placeholder without a blank screen or a browser error. No backend needs to be running.

**Acceptance Scenarios**:

1. **Given** the application is running, **When** the developer visits each of the eight screen addresses in turn, **Then** each renders a placeholder naming that screen, and the browser console reports no errors.
2. **Given** the developer is on a screen whose address carries an identifier, **When** the placeholder renders, **Then** it displays the identifier taken from the address.
3. **Given** the developer is on any screen, **When** they use the browser's back and forward controls, **Then** the application returns to the previously viewed screen without a full page reload.
4. **Given** the developer visits an address that matches no screen, **When** the page renders, **Then** a "not found" placeholder appears with a link back to the entry screen — not a blank page.

---

### User Story 2 - The application can talk to the backend (Priority: P2)

A developer makes a request to the backend from application code and gets back either typed data or a single, predictable error shape. The backend's location is supplied by configuration rather than hardcoded. When the user is signed in, the stored credential is attached automatically; the developer never assembles an authorization header by hand.

**Why this priority**: Every remaining UI feature is a sequence of backend calls. Getting one client right — one place for the base address, one place for credentials, one error shape — is what stops eight pages from each inventing their own error handling.

**Independent Test**: With the backend running, call the health endpoint from the application and confirm a successful response. Then stop the backend and confirm the same call surfaces a normalised error rather than an unhandled failure.

**Acceptance Scenarios**:

1. **Given** the backend is running and its address is configured, **When** the application requests the health endpoint, **Then** it receives a success response and reports the backend as reachable.
2. **Given** a stored session credential exists, **When** the application makes any backend request, **Then** the credential is attached to that request without the calling code doing anything.
3. **Given** no stored credential exists, **When** the application makes a backend request, **Then** the request is sent without a credential rather than failing locally.
4. **Given** the backend returns a failure, **When** the calling code inspects the result, **Then** it finds a consistent error value carrying a status, a machine-readable code, and a human-readable message — regardless of whether the backend replied with a structured error, an unstructured error, or nothing at all.
5. **Given** the backend is unreachable or the request times out, **When** the calling code inspects the result, **Then** it finds the same error shape, distinguishable as a connectivity failure rather than a backend rejection.
6. **Given** the backend rejects a request as unauthenticated, **When** the client handles the response, **Then** the stored credential is cleared and the application returns the user to the entry screen.

---

### User Story 3 - Live screens update themselves and then stop (Priority: P3)

Three screens need to refresh on their own: the order screen refreshes quickly while an order is in flight, the wallet and orders-list screens refresh slowly and indefinitely. A developer gets one reusable mechanism that takes a refresh interval and a rule for when the work is finished. When the rule says finished, refreshing stops. When the user leaves the screen, refreshing stops.

**Why this priority**: It is used by three screens at two different intervals, and both of its failure modes are visible on stage — an order screen that keeps hammering the backend ten minutes after an order settled, or a screen whose timers survive navigation and pile up over a rehearsal.

**Independent Test**: Attach the mechanism to a value that reaches a finishing state after a few refreshes, observe that refreshing stops at that point, then navigate away mid-flight and confirm no further refresh activity occurs.

**Acceptance Scenarios**:

1. **Given** a screen using the mechanism with a one-second interval, **When** the screen is displayed, **Then** the data is fetched immediately and then re-fetched about once per second.
2. **Given** a refresh returns data that satisfies the finishing rule, **When** that data arrives, **Then** the mechanism performs no further refreshes and reports itself as stopped.
3. **Given** the very first fetch already satisfies the finishing rule, **When** the screen loads, **Then** no repeat refresh is ever scheduled.
4. **Given** a refresh is in flight, **When** the user navigates away from the screen, **Then** no timer remains scheduled and no state update is attempted for the abandoned screen.
5. **Given** a refresh fails, **When** the next interval elapses, **Then** the mechanism tries again rather than stopping, and the screen can show that the last refresh failed.
6. **Given** a refresh takes longer than the configured interval, **When** the interval elapses, **Then** a second overlapping request is not started; the next refresh is scheduled after the current one settles.
7. **Given** a screen is configured never to stop, **When** it runs for an extended period, **Then** it keeps refreshing at its interval until the user navigates away.

---

### User Story 4 - The shell shows money and a way to reach it (Priority: P4)

Every screen sits inside a persistent shell with a header. The header carries a balance widget that shows the signed-in user's money and links to the Wallet screen. Because the product distinguishes two kinds of money that must never be collapsed into one number, the widget shows both, labelled. When nobody is signed in, the widget shows a sign-in affordance instead of a number.

**Why this priority**: The header is the frame every later screen renders inside, so it has to exist before those screens are built. Showing two money figures rather than one is a product rule established in the briefing — a single collapsed number makes the ledger look broken — and the shell is where that rule gets set from the start.

**Independent Test**: Sign in, confirm both figures appear in the header and refresh on their own, and confirm clicking the widget navigates to the Wallet screen. Sign out and confirm the widget shows a sign-in affordance.

**Acceptance Scenarios**:

1. **Given** a signed-in user, **When** any screen is displayed, **Then** the header shows the user's available balance and the amount currently in escrow as two distinctly labelled figures.
2. **Given** a signed-in user viewing any screen, **When** they activate the balance widget, **Then** the application navigates to the Wallet screen.
3. **Given** no signed-in user, **When** any screen is displayed, **Then** the header shows a sign-in affordance in place of the figures and shows no money amounts.
4. **Given** the balance figures are displayed, **When** the underlying amounts change on the backend, **Then** the header reflects the new amounts without the user reloading the page.
5. **Given** the backend cannot be reached, **When** the header renders, **Then** the widget degrades to a neutral placeholder and the rest of the screen still works.

---

### User Story 5 - One command starts the whole frontend (Priority: P5)

An operator with a clean checkout and no local toolchain beyond a container runtime starts the frontend with a single command and reaches it in a browser. The backend address is supplied through configuration rather than being baked in.

**Why this priority**: Valuable for a clean start before a rehearsal or a handoff, but day-to-day development uses the faster local dev server, so this can land last without blocking anything.

**Independent Test**: On a clean checkout, run the single documented start command and load the entry screen in a browser.

**Acceptance Scenarios**:

1. **Given** a clean checkout and a running container runtime, **When** the operator runs the documented start command, **Then** the frontend becomes reachable in a browser at a documented address.
2. **Given** the container is running, **When** the operator inspects what the browser received, **Then** only configuration values explicitly designated as browser-safe are present, and no operator secret appears.
3. **Given** the backend address is changed in configuration, **When** the frontend is restarted, **Then** it calls the new address without any code change.

---

### Edge Cases

- **The backend address is not configured at all.** The application must fail loudly and early with a message naming the missing setting, rather than silently issuing requests against its own origin and producing confusing "not found" errors.
- **A secret that is not designated browser-safe sits in the shared configuration file.** It must not reach the browser bundle. This is the guardrail that keeps the operator's private key out of the frontend, and it must not be worked around.
- **The stored session credential is expired or malformed.** The first rejected request clears it and returns the user to the entry screen; the application must not enter a retry loop.
- **The backend replies with a non-JSON body, an empty body, or an unexpected shape.** The client still produces its normalised error rather than throwing a parsing failure at the calling screen.
- **A refreshing screen is unmounted while a request is in flight.** The pending result is discarded; no timer survives and no update is applied to a screen that is gone.
- **The browser tab is backgrounded.** Refresh intervals may be throttled by the browser; the mechanism must recover its cadence when the tab is foregrounded again, without firing a burst of queued refreshes.
- **A screen that never stops refreshing runs for hours.** Memory and scheduled timers must not accumulate.
- **A direct visit to a screen address that carries an identifier, with no prior navigation.** The placeholder still renders using the identifier from the address.

## Requirements *(mandatory)*

### Functional Requirements

**Application shell and routing**

- **FR-001**: The application MUST provide a distinct address for each of the eight product screens: entry/connect, marketplace, agent detail, order detail, orders list, wallet, seller's agents, and create agent. Screens that concern a single record MUST take that record's identifier from the address.
- **FR-002**: Each of the eight screens MUST render a placeholder component that names the screen and, where the address carries an identifier, displays it.
- **FR-003**: The application MUST render every screen inside a persistent shell whose header remains present across navigation.
- **FR-004**: Navigation between screens MUST occur without a full page reload, and browser back/forward MUST return to previously viewed screens.
- **FR-005**: An address matching no screen MUST render a "not found" placeholder with a link to the entry screen.

**Backend client**

- **FR-006**: The application MUST read the backend's base address from configuration at build time and MUST NOT hardcode it. When the setting is absent, the application MUST surface an explicit, named error.
- **FR-007**: The application MUST expose a single client through which all backend requests pass; screens MUST NOT issue backend requests by any other route.
- **FR-008**: The client MUST attach the stored session credential to every request when one exists, and MUST send the request without a credential when none exists.
- **FR-009**: The client MUST return request and response payloads in typed form, so that a change to a payload's shape is caught at build time rather than at runtime.
- **FR-010**: The client MUST convert every failure — a structured backend error, an unstructured backend error, a timeout, and a connectivity failure — into a single error shape carrying a status, a machine-readable code, and a human-readable message. Callers MUST be able to distinguish a connectivity failure from a backend rejection.
- **FR-011**: On a response indicating the session is not authenticated, the client MUST clear the stored credential and the application MUST return the user to the entry screen.
- **FR-012**: The client MUST provide a reachability check against the backend's health endpoint that succeeds when the backend is running and produces the normalised error otherwise.
- **FR-013**: The client MUST NOT contain any code path that renders or logs a seller's private prompt text. (The backend redacts it; the frontend must not have a place to put it.)

**Live updates**

- **FR-014**: The application MUST provide one reusable refresh mechanism, parameterised by a refresh interval and by a rule that decides whether the data has reached a finishing state.
- **FR-015**: The mechanism MUST fetch once immediately, then repeat at the configured interval.
- **FR-016**: The mechanism MUST stop scheduling refreshes as soon as returned data satisfies the finishing rule, including when the very first fetch satisfies it, and MUST expose whether it is currently running.
- **FR-017**: The mechanism MUST cancel all scheduled work and discard in-flight results when the screen using it is removed, leaving no timer behind.
- **FR-018**: The mechanism MUST NOT run overlapping refreshes; the next refresh is scheduled only after the current one settles.
- **FR-019**: A failed refresh MUST NOT stop the mechanism; it MUST be retried at the next interval and the failure MUST be visible to the calling screen.
- **FR-020**: The mechanism MUST support screens that never reach a finishing state, refreshing indefinitely until the screen is removed.

**Header balance widget**

- **FR-021**: The header MUST display, for a signed-in user, available balance and money currently held in escrow as two separate labelled figures, and MUST NOT combine them into a single amount.
- **FR-022**: The balance widget MUST link to the Wallet screen.
- **FR-023**: The balance widget MUST refresh on its own using the shared refresh mechanism at the slow interval used by non-order screens.
- **FR-024**: When no user is signed in, the widget MUST show a sign-in affordance and no amounts. When the backend cannot be reached, it MUST degrade to a neutral placeholder without breaking the surrounding screen.

**Packaging and configuration**

- **FR-025**: The frontend MUST be startable in a container with a single documented command, reachable at a documented address.
- **FR-026**: Only configuration values explicitly designated as browser-safe MUST reach the browser bundle; all other values in the shared configuration file MUST be excluded by construction rather than by convention.
- **FR-027**: Changing the backend address in configuration and restarting MUST change which backend the frontend calls, with no code change.

**Out of scope for this feature**

- **FR-028**: This feature MUST NOT include automated tests of any kind. Acceptance is verified by hand (see Assumptions).
- **FR-029**: This feature MUST NOT implement screen content, wallet connection or signing, or any styling system beyond what legibility requires.

### Key Entities

- **Screen route**: A named address in the product's navigation map, optionally carrying a record identifier. Eight exist; each maps to exactly one placeholder for now.
- **Session credential**: The token proving a signed-in user, held by the application across page reloads, attached to backend requests and cleared when the backend rejects it.
- **Normalised error**: The single failure value every backend call can produce — status, machine-readable code, human-readable message, and whether the cause was connectivity or rejection.
- **Refresh subscription**: A live data feed defined by its interval and its finishing rule, with an observable running/stopped state, bound to the lifetime of the screen that created it.
- **Money figures**: Available balance and in-escrow — two amounts with different meanings (spendable now vs. locked until an order settles), displayed together and never merged. All amounts are whole cents.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: All eight screen addresses, plus one unmatched address, render their placeholder with no browser console errors — 9 of 9 on a single manual pass.
- **SC-002**: With the backend running, the application's reachability check against the health endpoint succeeds on the first attempt.
- **SC-003**: With the backend stopped, every backend call produces the normalised error shape and no unhandled failure reaches the browser console.
- **SC-004**: A screen refreshing at one second stops within one interval of its data reaching a finishing state, and issues zero further requests over the following two minutes.
- **SC-005**: After navigating away from a refreshing screen and waiting one minute, zero further requests attributable to that screen appear in the network log.
- **SC-006**: Navigating between all eight screens twice in succession leaves no growth in the number of scheduled timers.
- **SC-007**: The header shows two distinct money figures for a signed-in user on 100% of screens, and never a single combined figure.
- **SC-008**: An operator with a clean checkout reaches the entry screen in a browser using one command, in under five minutes on a first run.
- **SC-009**: A search of what the browser receives finds zero configuration values other than those designated browser-safe.
- **SC-010**: A developer adding a new backend call in a later feature needs to touch exactly one file to define it, and writes no error-handling or credential-attaching code of their own.

## Assumptions

**Inherited decisions** — these were settled in the root design documents and this feature implements rather than revisits them:

- The stack is React with TypeScript in strict mode, built by Vite; the on-chain library floor is viem ≥ 2.40.0. Configuration reaching the browser must carry the `VITE_` prefix — that prefix rule *is* the mechanism satisfying FR-026, and must not be worked around.
- Live updates use polling, not server-sent events or websockets. The order screen polls at one second and stops on a terminal state; wallet and orders-list poll at five seconds and never stop. These intervals are what FR-014 through FR-020 are shaped for.
- The container image is defined by a `Dockerfile` and started via a compose file that takes the backend address from environment configuration; the frontend listens on the documented dev port.
- The eight screens and their addresses are fixed by the product's UI design: entry `/`, marketplace `/agents`, agent detail `/agents/:id`, order detail `/orders/:id`, orders list `/orders`, wallet `/wallet`, seller's agents `/sell`, create agent `/sell/new`.

**Defaults chosen here** because the source spec did not settle them:

- The session credential persists across page reloads in browser storage, so that an accidental refresh mid-demo does not force a re-signature. Signing itself belongs to a later feature; this feature only reads, attaches, and clears what is stored.
- The header's two figures are **available balance** and **in escrow**, both from the single account endpoint. This was corrected during planning: the account endpoint returns available balance and in-escrow, while *settled funds* live on-chain under the user's own address and are read and withdrawn by the Wallet screen (a later feature). Two figures in the header, never one, is the rule that matters; which two is settled by what one call can return.
- The backend exposes a health endpoint suitable for a reachability check. If it does not exist when this feature is built, the check targets the account endpoint instead and treats an unauthenticated rejection as "reachable".
- Placeholder screens carry no styling system; a minimal global stylesheet for legibility is sufficient, and a styling decision is deferred to the first feature that needs one.
- Day-to-day development uses the local dev server rather than the container; the container exists for a clean one-command start.

**Verification method**: this component has no automated tests by explicit project decision, so every acceptance scenario and success criterion above is verified by hand. The demo rehearsal is the real test suite — a failed rehearsal should be treated the way a red build would be.

**Dependencies**: none within the UI component; this is the first feature. It depends on the backend being reachable for User Stories 2 and 4 only — User Stories 1, 3, and 5 can be completed and verified with no backend running.
