# Contract: `sc/README.md` — the runbook's step structure

**Feature**: `003-deployment-runbook` · **Date**: 2026-08-08

The README is a deliverable with a contract, not free prose. This file fixes the step
sequence, what each step must contain, and which requirement each one discharges — so
`/speckit-tasks` has something to build against and a reviewer has something to check.

---

## 1. Step sequence

Six numbered steps, in this order. The ordering is load-bearing: funding precedes
deployment because deployment spends MON, and the paste precedes the approval because
the approval names the address that was just pasted.

| # | Step | Discharges |
| --- | --- | --- |
| 0 | Prerequisites and what you will end up with | FR-007 |
| 1 | Install the Monad Foundry fork, and prove you have it | FR-008, FR-014 |
| 2 | Fill in `.env` and fund the four wallets | FR-009, FR-015, FR-016, FR-017 |
| 3 | Export the configuration, then deploy | FR-001…004, FR-006 |
| 4 | Paste `ESCROW_CONTRACT_ADDRESS` into `.env` | FR-005, FR-013 |
| 5 | **Approve the escrow from the operator wallet** | FR-010, FR-011 |
| 6 | Verify: run one purchase end to end | FR-014 |

Steps 3, 4 and 5 are three separate numbered steps rather than one deploy step with
notes. That is the whole point of US3: an approval expressed as a sub-bullet of "deploy"
is an approval that gets skipped.

## 2. What each step must contain

### Step 1 — Toolchain

- The Monad fork's installer, not upstream Foundry — stated as a *difference*, not as a
  preference (FR-008).
- `export PATH="$HOME/.foundry/bin:$PATH"`, plus the note that a new terminal is needed
  after install. Without this, step 1 appears to fail (R14).
- **Verification**: `forge --version` must contain `-monad-`. Show the expected output
  (`forge Version: 1.7.1-monad-v1.0.0`). This is the only reliable discriminator — the
  fork installs to the same path as upstream and has no distinct binary name (R1).

### Step 2 — Configuration and funding

- Copy `.env.example` → `.env` at the **repository root**, not in `sc/`.
- **Private keys take the `0x` prefix.** One sentence; it prevents the failure that
  looks like a Foundry bug (R5).
- **The placeholder warning** (FR-015): the shipped `0xDEAD…` values are format-valid
  and will pass every check. `grep -n 'TODO(placeholder)' .env` lists what is still
  fake. The deploy script rejects them (R6), but the reader should not learn that from a
  revert.
- **The funding table** — all four wallets, both assets, the minimums, and the failure
  timing for each. Reproduced from [data-model §3](../data-model.md#3-wallet-roster).
  The guardian row must state that its failure is deferred to the first dispute.
- **Two faucets, on two different domains** — MON from `https://faucet.monad.xyz/` for
  all four wallets, test USDC from `https://faucet.circle.com/` for the funder only
  ([R13](../research.md#r13--resolved-two-faucets-one-per-asset)). The USDC trip must
  read as its own action, not as a parenthetical on the funder row: a reader who
  completes the MON round for four wallets feels finished, and that is exactly the
  half-funded funder US4 exists to prevent.
- The deployer key is single-use and discardable (FR-016).

### Step 3 — Export and deploy

- `set -a; . ../.env; set +a` **as part of the command block**, not as a preceding
  remark. This is the step everyone gets wrong on the first attempt (R2), and it must
  read as part of deploying rather than as advice about deploying.
- The note that the export lives in one shell session, and a new terminal needs it again.
- The `forge script` invocation from [deploy-script §1](./deploy-script.md#1-invocation).
- **The charge-the-limit note belongs here** (FR-012), next to the transaction summary
  the reader is looking at: the limit is charged, not the usage, so ~3.0M gas of deploy
  costs ~0.26 MON at ~108 gwei, with the fork submitting an unpadded limit (R8). Here, not in an
  appendix — this is where the number appears on screen.
- **Verification**: the run reports success and prints the `ESCROW_CONTRACT_ADDRESS=`
  line.

### Step 4 — Paste

- Show the expected output line verbatim so there is no ambiguity about what to select
  (R3).
- Replace the existing `ESCROW_CONTRACT_ADDRESS=` line in the repository-root `.env`.
- **Verification**: `grep ESCROW_CONTRACT_ADDRESS ../.env` shows a non-empty,
  non-placeholder value.

### Step 5 — Approve

- **Signed by the operator wallet** — stated in the step, not implied by the flag
  (FR-011). Signing as deployer succeeds and does nothing.
- Amount `$(cast max-uint)`, so it never needs re-granting mid-session (R7).
- Re-export note: the pasted address is not in the current shell's environment until the
  export is re-run.
- **Verification**: `cast call $USDC_ADDRESS "allowance(address,address)(uint256)"
  $OPERATOR_ADDRESS $ESCROW_CONTRACT_ADDRESS --rpc-url $MONAD_RPC_URL` returns a large
  number. The absence of an error is not verification here — a wrongly-signed approval
  also produces no error.

### Step 6 — Prove it works

- One purchase, end to end, as the acceptance of the whole runbook (SC-003).
- What a missing approval looks like when it fails, so the reader can recognise it.

## 3. Required cross-cutting content

Three things that are not steps but must appear, each placed where the reader is when it
becomes relevant:

| Content | Placement | Requirement |
| --- | --- | --- |
| Charge-the-limit gas | Step 3, beside the cost figure | FR-012 |
| Redeploy consequences — new address, old funds stranded, repeat steps 4 **and** 5 | After step 5, where the allowance is fresh in mind | R11 |
| Troubleshooting: the four failures that look like something else | End | FR-014 |

### Troubleshooting entries (minimum set)

| Symptom | Cause |
| --- | --- |
| `vm.envUint: missing hex prefix ("0x")` | Private key stored as bare hex (R5) |
| `environment variable … not found`, everything filled in | The export step was skipped, or you are in a new terminal (R2) |
| Deploy succeeded, first purchase reverts | Approval skipped, signed by the wrong wallet, or a redeploy invalidated it |
| First verdict fails, everything else works | Guardian wallet unfunded (US4) |

## 4. Prohibitions

- **No step may say "see `docs/…`" as a prerequisite to proceeding** (FR-007, SC-010).
  Links as further reading are fine; a link the reader must follow to continue is a
  runbook failure.
- **No unnumbered instruction.** If it must happen, it is a numbered step or a labelled
  sub-step of one.
- **No faucet URLs other than the two confirmed ones** (R13).
- **No live private keys, addresses, or deployed addresses in the committed README.**
  Placeholders and `$VAR` references only.
