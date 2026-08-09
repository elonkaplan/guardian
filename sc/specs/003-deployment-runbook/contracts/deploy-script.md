# Contract: `script/Deploy.s.sol`

**Feature**: `003-deployment-runbook` · **Date**: 2026-08-08

The interface `Deploy.s.sol` exposes to its one caller — a person at a terminal. Its
contract is: what it reads, what it refuses, what it creates, and what it prints.

---

## 1. Invocation

```bash
forge script script/Deploy.s.sol:Deploy --rpc-url "$MONAD_RPC_URL" --broadcast
```

Run from `sc/`, in a shell where the repository-root `.env` has been exported
(`set -a; . ../.env; set +a`). Without the export, `forge` sees none of the inputs —
[research R2](../research.md#r2--the-repository-root-env-is-not-visible-to-forge-the-blocking-one).

Omitting `--broadcast` runs the identical validation and simulation without sending
anything. That is the supported dry run, and it is how the failure paths in §4 are
exercised without spending MON.

**No flags beyond these.** No `--verify` (out of scope, R10), no
`--gas-estimate-multiplier` override (the fork submits an unpadded limit anyway — R8), no
`--slow` (single transaction).

## 2. Inputs

Four environment variables, all read through `vm.envOr` with zero sentinels so that
validation can see every failure at once rather than dying on the first. Full table in
[data-model §1](../data-model.md#1-deployment-inputs).

| Variable | Solidity type | Sentinel |
| --- | --- | --- |
| `DEPLOYER_PRIVATE_KEY` | `uint256` | `0` |
| `USDC_ADDRESS` | `address` | `address(0)` |
| `OPERATOR_ADDRESS` | `address` | `address(0)` |
| `GUARDIAN_ADDRESS` | `address` | `address(0)` |

`--rpc-url` is a command-line argument, not an input the script reads.

## 3. Behaviour

```
1. read all four inputs via vm.envOr           (no aborts, sentinels on failure)
2. validate V1, V2, V3                          (accumulate; revert once if any failed)
3. vm.startBroadcast(pk)
4. new GuardianEscrow(IERC20(token), vm.addr(pk), operator, guardian)
5. vm.stopBroadcast()
6. console2.log the paste-ready line
```

Steps 1–2 complete before any broadcast begins. `forge script` simulates the whole run
before sending, so a revert in step 2 sends nothing even under `--broadcast` — FR-004's
"creates nothing on the network" holds by construction.

### Role assignment (step 4)

| Constructor parameter | Source | Resulting role |
| --- | --- | --- |
| `_token` | `USDC_ADDRESS` | — (immutable settlement token) |
| `admin` | `vm.addr(DEPLOYER_PRIVATE_KEY)` | `DEFAULT_ADMIN_ROLE` |
| `operator` | `OPERATOR_ADDRESS` | `OPERATOR_ROLE` |
| `guardian` | `GUARDIAN_ADDRESS` | `GUARDIAN_ROLE` |

All three roles are granted inside the constructor, so deployment is a single
transaction and no follow-up `grantRole` appears in the runbook (FR-002).

The admin is the deployer's own address, derived rather than configured — there is no
`ADMIN_ADDRESS` key in `.env` and this feature does not add one. The deployer key is
single-use and discardable (project-structure §7), which means the admin role is
effectively abandoned after deployment. That is intended for the MVP: no runbook step
needs it, and the three functions that could strand funds are permissionless by design
(`CONTEXT.md` §3.3).

## 4. Failure modes

All are pre-broadcast. Each names every offending key, not the first.

| # | Condition | Message shape |
| --- | --- | --- |
| V1 | Any input absent, empty, or malformed | `missing or malformed: USDC_ADDRESS, GUARDIAN_ADDRESS` |
| V1b | `DEPLOYER_PRIVATE_KEY` fails V1 | V1 message plus an explicit `0x`-prefix hint (R5) |
| V2 | Any address begins `0xDEAD` | `placeholder value still in .env: GUARDIAN_ADDRESS` |
| V3 | `OPERATOR_ADDRESS == GUARDIAN_ADDRESS` | names both keys |

**V1 collapses absent and malformed** because `vm.envOr` cannot distinguish them (R4).
The message says so; the reader's fix — look at that line in `.env` — is identical.

**V1b exists because the two failures are indistinguishable to the reader.** A bare-hex
private key and a blank one both arrive as `0`, but `cast` accepts bare hex, so a reader
who tests their key with `cast wallet address` sees it work and concludes the script is
broken. The hint costs one sentence.

**V2 is the widening beyond FR-015**, justified in [plan Complexity Tracking](../plan.md#complexity-tracking).

### Not guarded

- **`USDC_ADDRESS` pointing at a non-token contract, or at nothing.** The constructor
  stores it without probing. A `code.length` check would catch a typo'd address but not
  a wrong-but-real one, and the value is a documented constant that the reader copies
  rather than composes. Left to the runbook's verification step.
- **Deployer balance.** Insufficient MON fails at broadcast with Foundry's own error,
  which is already clear. The runbook states the minimum up front instead (R9).
- **Deploying twice.** Not detectable and not always wrong. The runbook states the
  consequences (R11).

## 5. Output

On success, exactly one line matters:

```
  ESCROW_CONTRACT_ADDRESS=0x5aAdFB43eF8dAF45DD80F4676345b7676f1D70e3
```

Produced by `console2.log(string.concat("ESCROW_CONTRACT_ADDRESS=", vm.toString(address(escrow))))`.

| Property | Requirement |
| --- | --- |
| Key name | Exactly `ESCROW_CONTRACT_ADDRESS` — matches `.env.example`; `api/` reads this spelling |
| Separator | `=` with **no surrounding space** — the comma form of `console2.log` inserts one (R3) |
| Address form | `vm.toString(address)` — EIP-55 checksummed, `0x`-prefixed |
| Position | Under `== Logs ==`, indented two spaces by `forge`; the reader selects from `E` |

`forge` also prints its own transaction summary (hash, block, gas used, total paid).
That is not part of this contract, but the runbook points at the "total paid" figure
when explaining charge-the-limit gas.

## 6. Non-goals

Not read, not written, not printed, not flagged:

- Verification on the explorer (R10)
- Any post-deploy `grantRole` / `revokeRole`
- The token approval — a separate operator-signed step, by design (US3)
- Writing back to `.env` — the paste is manual and visible; a script that edited a file
  holding four private keys would be a worse trade than one line of copying
- Broadcast artifact management — `broadcast/` is already gitignored
