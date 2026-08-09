# Feature Specification: Deployment Runbook

**Feature Branch**: `003-deployment-runbook`

**Created**: 2026-08-08

**Status**: Draft

**Input**: User description: "docs/specs/SC-03-deployment.md — Take a cold machine to a deployed, operator-approved settlement contract on the test network using only a README."

## Overview

The settlement layer exists as source code. This feature is what turns that source
code into a live, working settlement layer that the rest of the platform can point
at — and, just as importantly, what makes that transition repeatable by someone who
has never done it before.

The deliverable is two things: an automated deployment step that puts the settlement
contract on the target test network with its two roles already wired, and a written
runbook that carries a reader from a machine with nothing installed to a first
purchase that actually succeeds.

The distinction between "deployed" and "working" is the whole point of this feature.
A deployment can complete cleanly, report success, hand back an address, and still
leave a system that fails on its first real transaction — because the operator was
never authorised to spend, or because one of the four wallets that the running system
depends on was never funded. Both failures surface long after the deployment looked
finished, at the worst possible moment. The runbook's job is to make those steps
impossible to walk past.

The audience is a person under time pressure, possibly at 3am, possibly not the person
who wrote any of this. Success is measured by what that person can accomplish with the
runbook and nothing else.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A cold reader reaches a live settlement contract (Priority: P1)

Someone sits down at a machine with none of the required tooling installed, opens the
runbook, and works through it in order. By the end they have a settlement contract
live on the target test network, with the backend role and the arbitrator role already
granted to the correct addresses, and they know its address.

**Why this priority**: Nothing else in the platform can be exercised against a real
network until this exists. Every other component's integration work, and the demo
itself, is blocked behind it. It is also the step with the most unfamiliar tooling,
which is exactly why it needs to be written down rather than remembered.

**Independent Test**: Hand the runbook to someone who has not seen the project, on a
machine with no project tooling installed, and give them no other resource and no
opportunity to ask questions. They finish with a live settlement contract whose two
roles resolve to the intended addresses. Delivers value on its own: the settlement
layer becomes a real thing on a real network.

**Acceptance Scenarios**:

1. **Given** a machine with none of the required tooling installed and access to the
   runbook only, **When** the reader follows the numbered steps in order, **Then**
   they reach a live settlement contract without needing to consult another document
   or another person.
2. **Given** the required configuration values are all supplied, **When** the
   deployment step runs, **Then** the settlement contract is created with the
   settlement token, the administrative role, the backend role, and the arbitrator
   role all set from those supplied values, with no further manual configuration
   needed.
3. **Given** a completed deployment, **When** the reader inspects the deployed
   contract's role assignments, **Then** the backend role belongs to the configured
   backend address and the arbitrator role belongs to the configured arbitrator
   address, and they are different addresses.
4. **Given** a required configuration value is missing or is not a well-formed
   address, **When** the deployment step is invoked, **Then** it stops before creating
   anything on the network and names the offending value.

---

### User Story 2 - The deployed address is handed back ready to paste (Priority: P2)

The deployment finishes and reports the new contract's address in exactly the form the
platform's shared configuration file expects — a complete configuration line, not a
bare address embedded in a sentence. The reader selects one line, copies it, and pastes
it into the configuration file.

**Why this priority**: The address is the single value that connects every other
component to the settlement layer, and it is a long string that is meaningless to a
human eye — a transcription error in it is both easy to make and hard to spot, and it
produces confusing downstream failures rather than an obvious one. Removing the
retyping step removes the entire class of error, at essentially no cost.

**Independent Test**: Run the deployment and confirm that the reported output contains
a line that can be copied verbatim into the shared configuration file with no editing,
retyping, or reformatting. Testable without any other part of this feature.

**Acceptance Scenarios**:

1. **Given** a successful deployment, **When** the reader reads the deployment's
   output, **Then** the new address appears as a complete, correctly-named
   configuration line that matches the shared configuration file's format exactly.
2. **Given** that output line, **When** the reader copies it and pastes it into the
   shared configuration file replacing the existing entry, **Then** the configuration
   file is correct with no further editing.
3. **Given** a successful deployment, **When** the reader looks for the address in the
   output, **Then** they can identify it without reading surrounding prose.

---

### User Story 3 - The operator is authorised to spend before the first purchase (Priority: P3)

After deploying, the reader performs a numbered step that authorises the settlement
contract to draw settlement tokens from the operator's wallet. Only then is the system
capable of taking a purchase.

**Why this priority**: This is the step that bites. Opening a purchase pulls tokens
from the operator's wallet into escrow, which requires a standing authorisation. Without
it the deployment appears entirely successful — the contract is live, the roles are
right, the address is in the configuration — and the failure only appears when the very
first purchase is attempted, by which point the deployment is assumed done and nobody
is looking at it. It is a low-effort step guarding a high-cost, badly-timed failure.

**Independent Test**: Against an already-deployed contract, perform the authorisation
step from the runbook and then attempt a first purchase; it succeeds. Skip the step
and attempt the same purchase; it fails. The contrast is the test.

**Acceptance Scenarios**:

1. **Given** a freshly deployed settlement contract with no authorisation granted,
   **When** a first purchase is attempted, **Then** it fails — demonstrating why the
   step exists.
2. **Given** the same contract, **When** the reader performs the runbook's
   authorisation step signed by the operator's wallet, **Then** a subsequent first
   purchase succeeds.
3. **Given** the runbook, **When** a reader scans it, **Then** the authorisation step
   appears as a numbered step in the main sequence, carrying the same visual weight as
   the deployment step itself — never as a footnote, aside, or trailing note.
4. **Given** the authorisation step, **When** the reader reads it, **Then** it states
   which wallet must sign it, because signing from the deploying wallet instead
   produces an authorisation that looks granted but does not apply.
5. **Given** an authorisation granted once, **When** the platform runs an entire demo
   session of purchases, **Then** the authorisation does not need to be granted again
   partway through.

---

### User Story 4 - Every wallet the running system needs is funded before it is needed (Priority: P4)

Before deploying, the reader funds four separate wallets from the runbook's funding
table: the one that deploys, the one that holds the platform's money, the one the
backend signs with, and the one the arbitrator signs with. The table states what each
needs and what breaks without it.

**Why this priority**: An unfunded wallet does not announce itself — it fails at the
moment it is first used, which for three of the four wallets is well after deployment.
The arbitrator's wallet is the worst case: it is used only when a dispute is ruled on,
so the entire system works perfectly right up to the first verdict and then fails at
settlement, which in a demo is the single most visible moment.

**Independent Test**: Follow the funding table on a clean set of wallets, then drive
one purchase through to an ordinary completion and one through to a disputed verdict.
Both complete without a funding-related failure. Testable independently of how the
contract itself was deployed.

**Acceptance Scenarios**:

1. **Given** the runbook, **When** the reader reads the funding section, **Then** they
   find all four wallets listed, each with what it must hold and what stops working if
   it is empty.
2. **Given** the funding table, **When** the reader reads the entry for the wallet that
   holds the platform's money, **Then** it states that this wallet needs both the
   network's gas asset and the settlement token, unlike the other three.
3. **Given** all four wallets funded per the table, **When** a dispute is ruled on,
   **Then** the verdict settles without a funding failure.
4. **Given** the runbook, **When** the reader reaches the funding section, **Then** it
   appears before the deployment step, because the deployment itself cannot run
   without one of those wallets being funded.

---

### Edge Cases

- **A configuration value is still a placeholder.** The shared configuration file ships
  with well-formed but fake values so other components can start before deployment has
  happened. A placeholder is indistinguishable from a real address by format alone, so
  deploying with one produces a live contract that grants a role to an address nobody
  controls — unrecoverable without redeploying. The runbook must warn about this
  explicitly at the point the reader supplies these values.
- **The deployment is run a second time.** It produces a second, entirely separate
  contract. The previously deployed address becomes stale everywhere it was recorded,
  and any funds held by the old contract stay there. The runbook must state that
  redeploying means repeating the paste step and the authorisation step, and that the
  old contract's held funds do not follow.
- **The authorisation is granted from the wrong wallet.** The step succeeds, reports
  success, and has no effect on the operator's ability to spend — the failure surfaces
  as a failed first purchase, identical in appearance to having skipped the step.
- **The authorisation amount is set too low.** Purchases succeed until the allowance is
  exhausted, then fail partway through a session — the most confusing possible failure,
  because the same action worked minutes earlier.
- **The deploying wallet runs out of the network's gas asset mid-deployment.** The
  runbook must state a sufficient starting balance rather than leaving the reader to
  guess.
- **The gas asset balance drops faster than the transactions appear to cost.** On the
  target network the full requested gas allowance is charged rather than only what was
  used, so a wallet drains faster than a reader familiar with other networks expects.
  Without a note in the runbook this reads as a bug or a theft rather than as expected
  behaviour.
- **The arbitrator role is granted to one address while a different address is funded.**
  Everything works until the first verdict, which then fails for a reason that looks
  like a permissions bug rather than a configuration mismatch.
- **The reader's installed tooling is the widely-known general-purpose version rather
  than the network-specific variant.** Costs are then computed under the wrong rules,
  which misleads exactly the measurements this network requires care with. The runbook
  must call the distinction out where the tooling is installed, not later.

## Requirements *(mandatory)*

### Functional Requirements

**Deployment**

- **FR-001**: The deployment step MUST create the settlement contract on the target
  test network, reading the deploying credential, the settlement token address, the
  backend address, and the arbitrator address from the shared configuration.
- **FR-002**: The deployment step MUST grant the backend role and the arbitrator role
  as part of the same deployment, so that no manual role-granting step is required
  afterwards.
- **FR-003**: The deployment step MUST assign the administrative role to the deploying
  wallet.
- **FR-004**: The deployment step MUST stop before creating anything on the network if
  any required configuration value is absent or is not a well-formed address, and MUST
  name every value that failed the check.
- **FR-005**: The deployment step MUST report the deployed contract's address as a
  complete configuration line, named exactly as the shared configuration file names it,
  such that the line can be copied and pasted with no editing.
- **FR-006**: The deployment step MUST NOT require the reader to supply any value that
  is not already present in the shared configuration file.

**Runbook**

- **FR-007**: The runbook MUST take a reader from a machine with none of the required
  tooling installed to a completed, purchase-capable deployment, as a single ordered
  sequence of numbered steps, without depending on any other document.
- **FR-008**: The runbook MUST instruct the reader to install the network-specific
  variant of the required tooling and MUST state explicitly that the general-purpose
  version is not a substitute, at the point of installation.
- **FR-009**: The runbook MUST include the wallet funding table before the deployment
  step, listing all four wallets, what each must hold, and what stops working if it is
  empty.
- **FR-010**: The runbook MUST present the authorisation of the settlement contract to
  spend from the operator's wallet as a numbered step within the main sequence, with
  the same prominence as the deployment step.
- **FR-011**: The authorisation step MUST state which wallet signs it and MUST specify
  an authorisation amount large enough that it never needs re-granting during a demo
  session.
- **FR-012**: The runbook MUST state that the full requested gas allowance is charged
  on this network rather than only the amount consumed, and MUST place that statement
  where the reader is funding wallets or spending gas, not in an appendix.
- **FR-013**: The runbook MUST include the step of pasting the reported address into
  the shared configuration file as its own numbered step between deployment and
  authorisation.
- **FR-014**: The runbook MUST tell the reader how to confirm each of the following
  succeeded before moving on: wallets funded, contract deployed, address recorded,
  authorisation granted.
- **FR-015**: The runbook MUST warn, where the reader supplies configuration values,
  that the shipped placeholder values are well-formed and will therefore pass every
  format check while producing an unusable deployment.
- **FR-016**: The runbook MUST state that the deploying credential is single-use and
  may be discarded after deployment, and that nothing in the running platform requires
  it.
- **FR-017**: The runbook MUST state where the reader obtains the network's gas asset
  and the settlement token for funding.

### Key Entities

- **Deployment inputs**: The set of values the deployment reads from the shared
  configuration — the deploying credential, the settlement token address, the backend
  address, and the arbitrator address. All four must be present and well-formed before
  anything is created on the network.
- **Deployment output**: The address of the newly created settlement contract, expressed
  as a configuration line rather than a bare value. This is the one value the deployment
  produces and the only one that must travel back into the shared configuration.
- **Wallet roster**: Four distinct wallets with distinct funding needs — the deploying
  wallet (gas asset, single use, discardable), the platform's money wallet (gas asset
  and settlement token), the backend's wallet (gas asset, used on every purchase), and
  the arbitrator's wallet (gas asset, used only on verdicts).
- **Spending authorisation**: A standing permission from the operator's wallet allowing
  the settlement contract to draw settlement tokens when a purchase is opened. Granted
  once, outside the deployment itself, and required before the first purchase.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A person who has not seen this project before, working from the runbook
  alone on a machine with none of the required tooling installed, reaches a deployment
  that survives a first purchase — in under 45 minutes, without consulting another
  document and without asking anyone a question.
- **SC-002**: The address produced by deployment reaches the shared configuration file
  by copy and paste only, with zero characters retyped.
- **SC-003**: After the runbook is completed in full, the first purchase attempted
  succeeds on the first attempt.
- **SC-004**: After the runbook is completed in full, the first disputed verdict settles
  on the first attempt.
- **SC-005**: All four wallets that the running platform depends on are listed in the
  runbook with their funding requirement and their failure mode — 4 of 4, none omitted.
- **SC-006**: A reader can point to the authorisation step in the runbook within 10
  seconds of scanning it, without reading the surrounding prose.
- **SC-007**: A reader who observes their gas balance falling faster than expected can
  find the explanation in the runbook without searching outside it.
- **SC-008**: Invoking the deployment with any single required configuration value
  removed or malformed produces a clear failure that names that value, and creates
  nothing on the network — verified for each required value in turn.
- **SC-009**: Following the runbook twice from clean wallets produces two deployments
  that are equivalent in configuration, with no step whose outcome depends on knowledge
  not written in the runbook.
- **SC-010**: The runbook contains no step that says to consult another document, a
  chat history, or a person, in order to proceed.

## Assumptions

- **Single target environment.** There is one network and one deployment target. No
  staging-versus-production split, no per-environment configuration layering, and no
  automated release pipeline — deployment is an intentional manual act performed by a
  person following the runbook.
- **Redeploy rather than upgrade.** The settlement contract has no upgrade path by
  design. Correcting a deployed contract means deploying a new one and repointing
  configuration; no migration of held funds is provided or expected.
- **Public source verification is deliberately out of scope.** This is a recorded
  project decision, not an oversight: the deployed contract's source will not be
  published to a block explorer for the MVP.
- **A single shared configuration file** at the repository root holds all values, and is
  read by every component. Deployment reads from it and writes exactly one value back
  to it, by hand.
- **Faucets for the network's gas asset and the settlement token are available and free**
  to the reader, and provide enough for a demo session.
- **The deploying credential is separate from every other wallet** and is used exactly
  once. This costs one extra funding trip and is accepted as the safer default.
- **Contract-level tunables are not deployment parameters.** The review window and
  similar timing values are settled elsewhere; deployment supplies only the settlement
  token and the three role addresses.
- **The reader has network access, a terminal, and permission to install software** on
  the machine they are working from.
- **The runbook lives with the settlement component's source**, so a reader who has the
  code has the runbook.
