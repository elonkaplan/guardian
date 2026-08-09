# Phase 0 Research: Deployment Runbook

**Feature**: `003-deployment-runbook` · **Date**: 2026-08-08

Fourteen decisions. Every one marked **measured** was verified against the installed
toolchain or the live network during this phase, not recalled — the commands and the
observed output are recorded so the next reader does not have to re-run them.

---

## R1 — Toolchain: the Monad fork, and how to prove you have it

**Decision**: The runbook installs the Monad Foundry fork via the fork's own
`foundryup`, and verifies the install by checking that `forge --version` contains
`-monad-`.

**Measured**: The fork is already installed on this machine.

```
$ ~/.foundry/bin/forge --version
forge Version: 1.7.1-monad-v1.0.0
Commit SHA: bb49277de2e0979b9d37dc0e5f7f18f24b0262b8
```

The fork's installer is `FOUNDRY_BIN_URL=https://raw.githubusercontent.com/category-labs/foundry/monad/foundryup/foundryup`
(read out of the installed `~/.foundry/bin/foundryup`, itself version
`1.9.1-monad-v1.0.0`).

**Rationale, and the reason this needs a verification step rather than an install
step**: the fork installs to `~/.foundry/bin` — *the same path upstream Foundry uses*.
A reader who already has upstream Foundry ends up with two toolchains competing for one
path, and nothing about the resulting `forge` announces which one won. There is no
separate binary name, no `forge-monad`. The only reliable discriminator is the version
string. Since installing the wrong one produces mis-priced gas rather than an error
(project-structure §1.2), the check has to be in the runbook as its own verifiable
step, not as an assumption.

**Alternatives considered**: Instructing "install from docs.monad.xyz" and leaving it
there — rejected, because that is exactly the instruction that produces an upstream
install on a machine that already had one.

---

## R2 — The repository-root `.env` is not visible to `forge` (the blocking one)

**Decision**: The runbook exports the configuration into the shell before running
anything: `set -a; . ../.env; set +a`.

**Measured**: Foundry's dotenv loading reads `.env` from the Foundry project root /
working directory and **does not walk up to parent directories**. Probed with a script
reading `PROBE_VAR` through `vm.envOr`:

| `.env` location | Result |
| --- | --- |
| `sc/.env` (project root) | `loaded_from_probe_dir_env` — found |
| `../.env` (repo root), nothing in `sc/` | `<<UNSET>>` — **not found** |
| symlink `sc/.env → ../.env` | `loaded_from_PARENT_env` — found |
| `set -a; . ../.env; set +a` then run | `loaded_from_PARENT_env` — found |

There is no `--env-file` flag on `forge script` (`forge script --help | grep -c env-file`
→ `0`).

**Why this matters more than it looks**: Guardian keeps one `.env` at the repository
root, shared by `api/`, `ui/` and `sc/` (spec Assumptions; `.env.example` header). The
Foundry project root is `sc/`. So the single most obvious way to run the deploy —
`cd sc && forge script script/Deploy.s.sol --broadcast` — reads **none** of the
configuration and fails on the first `vm.env*` call. Every reader hits this on their
first attempt unless the runbook pre-empts it.

**Rationale for exporting over symlinking**: the `set -a` line is visible in the
runbook, survives a fresh clone, needs no file that `.gitignore` has opinions about,
and — decisively — puts the values in the environment for `cast send` in step 5 as
well, which the symlink does not do. Its cost is that the reader must stay in the same
shell for the whole runbook, which the runbook states.

**Alternatives considered**: (a) symlink `sc/.env → ../.env` — works, but it is
invisible state that a fresh clone does not reproduce, and it silently does nothing for
`cast`. (b) Move `.env` into `sc/` — rejected, it is shared by three components.
(c) `--env-file` — does not exist in this Foundry version.

**Verified sourceable**: `set -a; . ./guardian/.env.example; set +a` completes cleanly
and yields `MONAD_CHAIN_ID=10143`, `USDC_ADDRESS=0x534b…43A3`. The file's `#` comments
and unquoted values are shell-safe as written.

---

## R3 — Printing the address so it is genuinely paste-safe

**Decision**: `console2.log(string.concat("ESCROW_CONTRACT_ADDRESS=", vm.toString(address(escrow))))`.

**Measured** — the two forms are not equivalent:

```
  A_COMMA_STYLE= 0x534b2f3A21130d7a60830c2Df862319e593943A3
  B_CONCAT_STYLE=0x534b2f3A21130d7a60830c2Df862319e593943A3
```

**This corrects the draft in `docs/project-structure.md` §4.2**, which uses the comma
form `console2.log("ESCROW_CONTRACT_ADDRESS=", address(escrow))`. `console2.log`
joins its arguments with a space, so the comma form emits `KEY= 0x…` — a space after
the `=`. That is not the format `.env.example` uses, and it defeats the entire purpose
of the step, which is that the line needs no editing (FR-005, SC-002). The concat form
produces the exact line.

**Residual, and accepted**: `forge` indents script logs by two spaces. The reader
selects from the `E` of `ESCROW`, not from column zero. Every dotenv reader in the
stack tolerates leading whitespace anyway, so a sloppy selection still works — but the
runbook shows the expected output verbatim so there is no ambiguity about what to grab.

---

## R4 — Naming *every* bad configuration value, not just the first

**Decision**: read all four inputs through `vm.envOr(name, <zero sentinel>)`, accumulate
the failures, and revert once with a message listing all of them.

**Measured**: the direct accessors abort on first failure and say nothing about the
rest:

```
Error: script failed: vm.envAddress: environment variable "DEFINITELY_MISSING" not found
Error: script failed: vm.envAddress: failed parsing $EMPTY_ADDR as type `address`: …
Error: script failed: vm.envUint: failed parsing $PK_BARE as type `uint256`: missing hex prefix ("0x")
```

`vm.envOr` does not abort. It returns the default for **both** missing and malformed
values — confirmed with `MALFORMED_ADDR=not_an_address`, which yielded
`0x0000…0000` rather than an error.

**Rationale**: FR-004 requires naming *every* value that failed. With the direct
accessors a reader with three blank fields discovers them one deploy attempt at a time.
`vm.envOr` is the only mechanism that lets the script see all four before deciding to
stop.

**Accepted limitation**: `envOr` cannot distinguish "absent" from "malformed" — both
arrive as the sentinel. The error message therefore says *missing or malformed*, which
is honest and costs the reader nothing, since the fix (look at the line in `.env`) is
identical either way.

**Why no on-chain risk**: `forge script` simulates before it broadcasts, and a revert
during simulation stops the run before any transaction is sent. The `--broadcast` flag
does not change this ordering. FR-004's "creates nothing on the network" therefore holds
by construction rather than by care.

---

## R5 — The `0x` prefix asymmetry between `forge` and `cast`

**Decision**: `.env` stores private keys **with** the `0x` prefix; the deploy script's
validation message says so by name.

**Measured**:

| Consumer | bare hex `ac09…ff80` | `0x`-prefixed |
| --- | --- | --- |
| `vm.envUint` (deploy) | **fails** — `missing hex prefix ("0x")` | works |
| `cast wallet --private-key` (approve) | works | works |

**Why it earns a decision**: this is the worst shape a configuration bug can take — the
same value, from the same file, accepted by step 5 and rejected by step 3. A reader who
pasted a bare key from a wallet export sees the deploy fail on a key that they can
demonstrate `cast` accepts, which reads as a Foundry bug rather than a formatting one.
One sentence in the runbook and one in the error message removes it.

---

## R6 — Rejecting the shipped placeholder values

**Decision**: the deploy script rejects any role address whose leading bytes are
`0xDEAD`, as a pre-flight check alongside the R4 validation.

**Rationale**: `.env.example` deliberately ships *format-valid* fakes so `api/` can boot
before this feature exists, under a documented convention — "fake hex starts with
0xDEAD, zero-padded, ending in a repeated 4-digit role tag — 1111 escrow, 2222 funder,
3333 operator, 4444 guardian, 5555 deployer". Format validation (R4) passes them by
construction; that is what they were designed to do.

Deploying with a placeholder grants `GUARDIAN_ROLE` to an address nobody holds a key
for. There is no upgrade path and no way to revoke-and-regrant without the admin key
plus a second transaction the runbook does not have — in practice it means redeploy,
re-paste, re-approve, discovered at the first dispute. The convention is machine-
checkable and the check is four lines, so declining to check it would be choosing a
recoverable-only-by-redeploy failure over a one-line guard.

**Scope note**: this exceeds FR-015, which asks only for a runbook warning. The warning
stays; the guard is added because the cost asymmetry is extreme and the cost is
trivial. Recorded here so it reads as a deliberate widening rather than scope creep.

**Alternatives considered**: checking the full placeholder pattern including the role
tag — rejected as over-fitting; the `0xDEAD` prefix alone has no false positives worth
worrying about on a testnet.

---

## R7 — The approval amount

**Decision**: approve `$(cast max-uint)` — verified present in this toolchain, returns
`115792089237316195423570985008687907853269984665640564039457584007913129639935`.

**Rationale**: FR-011 requires an amount that never needs re-granting mid-session. An
unbounded approval satisfies it definitionally, and `$(cast max-uint)` is
self-documenting in a way that a hand-typed run of digits is not.

**Measured, on the token itself**: the settlement token at
`0x534b2f3A21130d7a60830c2Df862319e593943A3` is a **Circle FiatToken proxy** — code
size 1798 bytes, `decimals()` → `6`, `symbol()` → `"USDC"`, `totalSupply()` →
`9227483608859721` (≈9.23 bn). A `mint(address,uint256)` call reverts with
`FiatToken: caller is not a minter`, so the funder wallet's test USDC must come from a
faucet, not from self-minting (see R13).

FiatToken permits re-approval from a non-zero allowance, so there is no USDT-style
"reset to zero first" dance to document.

**Risk accepted**: an unbounded approval on a testnet wallet holding faucet tokens, in
a system with no upgrade path and a demo-length lifetime. Proportionate.

---

## R8 — Gas: the fork already removes the pad (corrected post-deploy)

**Decision**: document that the limit is charged and that the *fork* submits an unpadded
limit; do not attempt to tune the multiplier.

> **Corrected 2026-08-08 against the real deploy.** This decision originally assumed
> `forge script`'s documented 130% pad applied on Monad, and put the deploy cost at
> ~0.40 MON with ~0.09 MON burned on padding. The live transaction says otherwise:
> submitted gas limit **2,406,060**, gas used **2,406,060** — identical to the unit — at
> 107.8 gwei, and the deployer's balance fell by exactly **0.2594 MON**. The Monad fork
> submits the simulated gas as the limit with **no multiplier applied**, which is the
> correct behaviour for a charge-the-limit chain and is evidently one of the fork's
> changes. The `--gas-estimate-multiplier` default of 130 is still what `--help`
> advertises; it is not what the fork does when broadcasting.
>
> **This strengthens R1 rather than weakening it**: upstream Foundry would have padded
> and burned ~30% more on every transaction. "Use the fork" now has a measured price tag.
>
> One residual worth keeping: the `Estimated amount required` figure printed before
> broadcast (0.5000 MON here) is quoted at a conservative gas price and runs ~2× the
> actual charge. It is a funding check, not a bill — and a reader who reads it as a bill
> will think they were overcharged.

**Measured**:

- `forge script --gas-estimate-multiplier` advertises a default of **130** — but see the
  correction above; it did not apply to the broadcast transaction.
- Live network, this session: `cast gas-price` → `102000000000` (102 gwei),
  `cast base-fee` → `100000000000` (100 gwei — matching the documented 100 MON-gwei
  floor). `cast chain-id` → `10143`.
- Deploy gas: `forge test --gas-report` reports creation at **1,805,780** (deployed
  size 8,170 bytes); a `forge script` `CREATE` measured **2,976,901** including
  constructor role-granting and script overhead. The conservative figure is used below.

**Actual, from the live deploy** (tx `0xc4c57f…7407`): 2,406,060 gas, limit submitted
equal to it, 107.8 gwei, **0.2594 MON** charged. Balance before 5.0000, after 4.7406.

**Rationale for still documenting it prominently**: the charge-the-limit rule is
unchanged and still governs everything the API does later — it is only Foundry's padding
that turned out not to apply. Two surprises remain for a reader:

1. The pre-broadcast `Estimated amount required` (0.5000 MON here) is quoted at a
   conservative price and runs ~2× the real charge. Read as a bill it looks like
   overcharging; it is a funding check.
2. On any chain but this one, "gas used" and "amount paid" diverge only via the price.
   Here the limit is the bill, so anything written later against this chain should set
   explicit limits rather than estimate-and-pad — which is what project-structure §1.1
   already concluded for the operator's repeated calls.

---

## R9 — Funding amounts, derived rather than guessed

Gas from `forge test --gas-report` against the real contract, except the two marked
**on-chain**, which come from actual testnet receipts. Converted at 107.8 gwei with **no
pad** — the fork submits the simulated gas as the limit (R8), so gas × price *is* the
bill:

| Call | Gas | ≈ MON |
| --- | ---: | ---: |
| deploy | 2,406,060 **on-chain** | 0.259 |
| `approve` (ERC-20) | 88,193 **on-chain** | 0.010 |
| `registerAgent` | 121,011 | 0.013 |
| `openDeal` | 254,793 | 0.027 |
| `markDelivered` | 35,766 | 0.004 |
| `release` | 58,142 | 0.006 |
| `resolve` | 84,214 | 0.009 |
| `withdrawFor` | 51,895 | 0.006 |

A completed order costs the operator ≈**0.049 MON** (`openDeal` + `markDelivered` +
`release` + two `withdrawFor`). A verdict costs the guardian ≈**0.009 MON**.

Note `approve` came in at 88,193 gas on-chain against the ~46,000 first assumed here —
FiatToken is a proxy with more machinery than a bare ERC-20. Still ~0.01 MON, so nothing
downstream moves.

**Decision — the runbook's minimums**, unchanged by the correction. They were rounded up
hard on the principle that a faucet trip mid-demo is the expensive outcome and MON is
free, and that margin absorbed the revision:

| Wallet | Minimum | Covers (recomputed) |
| --- | --- | --- |
| Deployer | **1 MON** | ≈3.8 deploys at 0.259 each |
| Operator | **5 MON** | ≈100 completed orders |
| Guardian | **1 MON** | ≈110 verdicts |
| Funder | **5 MON + test USDC** | top-ups; the only wallet needing both assets |

---

## R10 — Contract verification

**Decision**: no `--verify` flag, no verification step. This is a recorded project
decision (project-structure §1.4, §7; spec Assumptions), not an omission — noted here
only so a reader of the deploy command does not add the flag back thinking it was
forgotten.

---

## R11 — Redeploy semantics

**Decision**: the runbook states plainly that re-running the deploy produces a *new,
separate* contract; that the previous address is stale everywhere it was recorded; that
funds held by the old contract stay there; and that both the paste step and the
approval step must be repeated.

**Rationale**: `GuardianEscrow` has no upgrade path by design and the constructor grants
roles fresh each time. The approval from R7 is granted to a *specific* contract address,
so it does not carry over — a redeploy silently reverts the system to the exact
pre-approval state that step 5 exists to prevent, and the reader has no reason to
suspect it because step 5 "was already done".

---

## R12 — Where the runbook lives

**Decision**: `sc/README.md`.

**Rationale**: `api/README.md` and `ui/README.md` already exist and carry each
component's own quick-start; `sc/` is the only component without one. Co-locating keeps
FR-007's "without depending on any other document" honest — a reader who has the
contract source has the instructions for deploying it.

---

## R13 — RESOLVED: two faucets, one per asset

**Decision**: the runbook names **two** sources, and says which wallets need which.

| Asset | Faucet | Who needs it |
| --- | --- | --- |
| MON | `https://faucet.monad.xyz/` | all four wallets |
| Test USDC | `https://faucet.circle.com/` | **funder only** |

**Status**: resolved 2026-08-08, confirmed by the project owner from a completed
funding run — the funder wallet holds 20 test USDC obtained from Circle's faucet,
verified on-chain alongside 5 MON in each of the four wallets. Circle's faucet is what
Monad's own hackathon documentation recommends for this token.

**This corroborates R7 rather than sitting beside it.** R7 identified the settlement
token as a **Circle FiatToken proxy** that rejects direct minting — so Circle operating
the faucet for it is the expected arrangement, not a coincidence. The two findings agree.

**Why two faucets makes the runbook's job harder, not easier**: US4's central failure is
that the funder gets half-funded. A single faucet would have made "collect both assets"
one action; two faucets on two domains means a reader can complete the MON round for all
four wallets, feel finished, and never visit the second one. The funding step must
therefore treat the funder's USDC trip as its own numbered action rather than a
parenthetical on the funder row.

**What was open, and why it mattered**: no document in `docs/` recorded a source for
test USDC — `rain-integration.md` refers to the funder holding "faucet-minted test
USDC" without naming the faucet — and R7 established that the token rejects direct
minting (`FiatToken: caller is not a minter`), so self-minting was not a fallback. An
unfunded funder wallet is SC-003's failure mode, and a *guessed* faucet URL in a runbook
is worse than an absent one, because the reader trusts it and burns time.

**Consequence for the funding table (R9)**: unchanged in amounts. What changes is
presentation — the step needs two links and an explicit "the funder needs a second trip",
placed so a reader working down the wallet table cannot finish the MON round and stop.

---

## R14 — `forge` is not on `PATH` in a non-interactive shell

**Measured**: `which forge` → not found; the binaries live at `~/.foundry/bin/`.
Carried forward from the SC-02 plan, still true.

**Decision**: the runbook includes the `PATH` line, and states that a new terminal is
needed after installation. This is the difference between step 1 appearing to fail and
step 1 working.

---

## Summary of what changed against the existing design docs

| Doc | Change |
| --- | --- |
| `project-structure.md` §4.2 | `console2.log` comma form emits `KEY= 0x…` with a space; must be `string.concat` (R3) |
| `project-structure.md` §4.3 | Runbook missing the env-export step; `forge` cannot see the repo-root `.env` from `sc/` (R2) |
| `project-structure.md` §4.2 | Direct `vm.envAddress` cannot name more than one bad value; FR-004 needs `vm.envOr` (R4) |
| `.env.example` | Should state that private keys need the `0x` prefix (R5) |
