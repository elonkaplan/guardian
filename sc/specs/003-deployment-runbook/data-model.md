# Phase 1 Data Model: Deployment Runbook

**Feature**: `003-deployment-runbook` · **Date**: 2026-08-08

This feature has no persistent state of its own. Its "data" is the configuration that
flows in, the one value that flows back, and the off-chain preconditions (funded wallets,
a granted allowance) without which the flow produces a contract that looks fine and does
not work.

---

## 1. Deployment inputs

Read from the repository-root `.env` (`guardian/.env`), which `forge` cannot see from
`sc/` without the export step — see [research R2](./research.md#r2--the-repository-root-env-is-not-visible-to-forge-the-blocking-one).

| Key | Type | Read as | Becomes | Notes |
| --- | --- | --- | --- | --- |
| `DEPLOYER_PRIVATE_KEY` | `uint256` | `vm.envOr(…, uint256(0))` | broadcast signer; `vm.addr(pk)` → `DEFAULT_ADMIN_ROLE` | **Requires the `0x` prefix** (R5). Single-use; discardable after deploy. |
| `USDC_ADDRESS` | `address` | `vm.envOr(…, address(0))` | constructor `_token` | Immutable on the contract thereafter. Live value is a Circle FiatToken proxy, 6 decimals. |
| `OPERATOR_ADDRESS` | `address` | `vm.envOr(…, address(0))` | constructor `operator` → `OPERATOR_ROLE` | Must differ from `GUARDIAN_ADDRESS`. |
| `GUARDIAN_ADDRESS` | `address` | `vm.envOr(…, address(0))` | constructor `guardian` → `GUARDIAN_ROLE` | The role that fails late if wrong (US4). |

**Not inputs, deliberately.** `MONAD_RPC_URL` is passed on the command line
(`--rpc-url`), not read by the script. `REVIEW_WINDOW_SECONDS` is a per-deal argument to
`openDeal`, not a constructor parameter — nothing about the review window is fixed at
deployment. `OPERATOR_PRIVATE_KEY` is used by the reader in the approval step but is
never read by the deploy script; the script only ever needs the operator's *address*.

### Validation rules

Applied in one pass, before `vm.startBroadcast`, accumulating every failure:

| # | Rule | Failure message names |
| --- | --- | --- |
| V1 | Each of the four keys resolves to a non-zero value | every key that failed, together |
| V2 | No address begins with the bytes `0xDEAD` | every placeholder key, by name (R6) |
| V3 | `OPERATOR_ADDRESS != GUARDIAN_ADDRESS` | both keys |

`vm.envOr` collapses "absent" and "malformed" into the sentinel, so V1's message says
*missing or malformed* — the reader's fix is the same either way (R4). A private key
supplied as bare hex fails V1 and gets an explicit `0x`-prefix hint rather than the
generic message, because that case is otherwise indistinguishable from a blank field.

V3 is not in the spec's requirements. It is included because the two-role separation is
the contract's central security property (`docs/CONTEXT.md` §3.2) and a single address
holding both silently voids it — a one-line check against a failure that never announces
itself.

**All validation runs during simulation**, which `forge script` performs before it
broadcasts even with `--broadcast`. A validation revert therefore creates nothing
on-chain, satisfying FR-004 by construction rather than by care.

---

## 2. Deployment output

One value, in one form.

| Field | Value |
| --- | --- |
| Emitted line | `ESCROW_CONTRACT_ADDRESS=0x…` |
| Produced by | `console2.log(string.concat("ESCROW_CONTRACT_ADDRESS=", vm.toString(address(escrow))))` |
| Destination | `guardian/.env`, replacing the existing `ESCROW_CONTRACT_ADDRESS=` line |
| Constraint | Byte-identical to the `.env` line it replaces — no space after `=` (R3) |

The key name is not free: `.env.example` already defines `ESCROW_CONTRACT_ADDRESS`, and
`api/` reads it. The emitted line must match that spelling exactly or the paste is silently
wrong.

Secondary output — the standard `forge script` summary (transaction hash, block, gas
used, cumulative cost) — is not part of this contract but is what the runbook points at
for the gas-charging note (R8).

---

## 3. Wallet roster

Four wallets, three distinct failure timings. This is the table the runbook reproduces;
amounts are derived in [research R9](./research.md#r9--funding-amounts-derived-rather-than-guessed).

| Wallet | `.env` keys | Must hold | Minimum | First used | If empty |
| --- | --- | --- | ---: | --- | --- |
| **Deployer** | `DEPLOYER_PRIVATE_KEY` | MON | **1 MON** | Step 3, once | Deployment fails immediately — the only visible failure of the four |
| **Funder** | `FUNDER_PRIVATE_KEY`, `FUNDER_ADDRESS` | MON **and test USDC** | **5 MON** + USDC | First user top-up | No money enters the system; every purchase fails for lack of funds |
| **Operator** | `OPERATOR_ADDRESS`, `OPERATOR_PRIVATE_KEY` | MON | **5 MON** | Step 5, then every call | Purchases fail once the balance runs out — mid-session, after working |
| **Guardian** | `GUARDIAN_ADDRESS`, `GUARDIAN_PRIVATE_KEY` | MON | **1 MON** | First verdict only | **Everything works until the first dispute**, then fails at settlement |

**The funder is the only wallet needing two assets**, and they come from **two different
faucets** — MON from `faucet.monad.xyz`, test USDC from `faucet.circle.com` (R13). That
is why it is the wallet readers most often half-fund: finishing the MON round for all
four wallets feels like finishing the step. **The guardian is the one most often skipped entirely**, because nothing in
the deploy-and-first-purchase path touches it; its failure is deferred to the most
visible moment in the demo (US4, SC-004).

The deployer is separate from all three by decision (project-structure §7): it signs
once and nothing running needs it, so its key never has to live in a `.env` that travels.

---

## 4. Spending authorisation

Not on-chain state that this feature creates, but the precondition without which the
deployment is inert.

| Property | Value |
| --- | --- |
| Granted on | the settlement token (`USDC_ADDRESS`), not the escrow |
| Owner (signer) | **operator wallet** — signing as deployer produces a valid-looking no-op |
| Spender | `ESCROW_CONTRACT_ADDRESS` — the *newly deployed* one |
| Amount | `$(cast max-uint)` (R7) |
| Required by | `openDeal`, which calls `token.safeTransferFrom(msg.sender, address(this), a.price)` (`GuardianEscrow.sol:229`) |
| Survives redeploy | **No** — it names the old contract address (R11) |

**State transition it gates:**

```
deployed ──(no allowance)──> first openDeal REVERTS
         └─(allowance set)──> first openDeal succeeds
```

Both states report a successful deployment. Nothing between them is observable without
either attempting a purchase or reading `allowance(operator, escrow)` — which is why the
runbook's verification for step 5 is the allowance read, not the absence of an error.

---

## 5. What deployment does *not* configure

Recorded so nobody looks for it: the five refund tiers and the four deadline constants
are compile-time constants in `GuardianEscrow`; `REVIEW_WINDOW_SECONDS` is passed
per-deal by the API; there are no fees, no pause switch, no upgrade proxy, and no
post-deploy role changes in the runbook path. Deployment supplies exactly the four
inputs in §1 and nothing else is adjustable without redeploying.
