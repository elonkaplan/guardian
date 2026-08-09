# Quickstart: validating the deployment runbook

**Feature**: `003-deployment-runbook` · **Date**: 2026-08-08

How to prove this feature works. The unusual part: **the success path can only be
validated by doing it** — deploying to Monad Testnet once, for real. The failure paths,
which are where the requirements actually live, are all verifiable locally without
spending anything.

Do the local gate first. It costs nothing and catches everything except "the network
accepted it".

---

## Prerequisites

```bash
export PATH="$HOME/.foundry/bin:$PATH"
forge --version    # must contain -monad-  → e.g. forge Version: 1.7.1-monad-v1.0.0
```

If it does not say `-monad-`, you have upstream Foundry. The fork installs to the same
path with the same binary name, so nothing else will tell you
([R1](./research.md#r1--toolchain-the-monad-fork-and-how-to-prove-you-have-it)).

Run everything below from `sc/`.

---

## Gate 1 — Local, no network, no MON

Every check here runs without `--broadcast`. `forge script` validates and simulates
before it would send anything, so a revert proves the guard fires *and* proves nothing
reached the chain.

### 1.1 It compiles

```bash
forge build
```

### 1.2 The export step is genuinely required

This is the one that fails for everybody on the first real attempt
([R2](./research.md#r2--the-repository-root-env-is-not-visible-to-forge-the-blocking-one)).
Run the deploy in a shell where `.env` has *not* been exported:

```bash
env -u USDC_ADDRESS -u OPERATOR_ADDRESS -u GUARDIAN_ADDRESS -u DEPLOYER_PRIVATE_KEY \
  forge script script/Deploy.s.sol:Deploy
```

**Expect**: validation failure naming all four keys. If this *succeeds*, something is
leaking configuration from a shell profile and the rest of Gate 1 is untrustworthy.

### 1.3 Validation names every bad value, not the first

```bash
set -a; . ../.env; set +a
USDC_ADDRESS= GUARDIAN_ADDRESS= forge script script/Deploy.s.sol:Deploy
```

**Expect**: one failure naming **both** `USDC_ADDRESS` and `GUARDIAN_ADDRESS`. A message
naming only one means the script is using `vm.envAddress` somewhere instead of
`vm.envOr` — FR-004 is not met
([R4](./research.md#r4--naming-every-bad-configuration-value-not-just-the-first)).

Repeat once per key to satisfy SC-008:

```bash
for k in DEPLOYER_PRIVATE_KEY USDC_ADDRESS OPERATOR_ADDRESS GUARDIAN_ADDRESS; do
  echo "--- blanking $k ---"
  env "$k=" forge script script/Deploy.s.sol:Deploy 2>&1 | tail -2
done
```

**Expect**: four failures, each naming the blanked key, none reaching broadcast.

### 1.4 A bare-hex private key is caught, with the prefix hint

```bash
DEPLOYER_PRIVATE_KEY=ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 \
  forge script script/Deploy.s.sol:Deploy
```

**Expect**: failure that mentions the `0x` prefix. Without the hint the reader will
verify the same key with `cast wallet address` — which accepts bare hex — and conclude
the script is broken ([R5](./research.md#r5--the-0x-prefix-asymmetry-between-forge-and-cast)).

### 1.5 Placeholders are rejected

```bash
GUARDIAN_ADDRESS=0xDEAD000000000000000000000000000000004444 \
  forge script script/Deploy.s.sol:Deploy
```

> Count the zeros. An address is exactly 40 hex characters after `0x`, and the
> convention's tag is `0xDEAD` + 32 zeros + a 4-digit role tag. A 42-character literal
> is not an address at all — `vm.envOr` returns the sentinel and it trips V1 as
> *malformed* instead of V2 as a *placeholder*, testing the wrong guard.

**Expect**: failure naming `GUARDIAN_ADDRESS` as a placeholder. This value is
format-valid by design — it passes 1.3's check by construction, which is exactly why the
guard exists ([R6](./research.md#r6--rejecting-the-shipped-placeholder-values)).

### 1.6 Operator and guardian must differ

```bash
GUARDIAN_ADDRESS="$OPERATOR_ADDRESS" forge script script/Deploy.s.sol:Deploy
```

**Expect**: failure naming both keys.

### 1.7 The printed line is paste-safe

With valid configuration, dry-run and inspect the output:

```bash
forge script script/Deploy.s.sol:Deploy | grep ESCROW_CONTRACT_ADDRESS
```

**Expect** exactly:

```
  ESCROW_CONTRACT_ADDRESS=0x5aAdFB43eF8dAF45DD80F4676345b7676f1D70e3
```

**No space after `=`.** `ESCROW_CONTRACT_ADDRESS= 0x…` means the script uses
`console2.log("KEY=", addr)` instead of `string.concat`, and US2 is not met
([R3](./research.md#r3--printing-the-address-so-it-is-genuinely-paste-safe)).

Machine-checkable:

```bash
forge script script/Deploy.s.sol:Deploy \
  | grep -qE '^\s*ESCROW_CONTRACT_ADDRESS=0x[0-9a-fA-F]{40}$' \
  && echo "paste-safe" || echo "NOT paste-safe"
```

---

## Gate 2 — Live deployment

Costs ~0.4 MON. Do Gate 1 first.

```bash
set -a; . ../.env; set +a
forge script script/Deploy.s.sol:Deploy --rpc-url "$MONAD_RPC_URL" --broadcast
```

**Then, in order:**

1. Paste the printed line into `guardian/.env`, replacing the existing one.
2. Re-export: `set -a; . ../.env; set +a`
3. Confirm the roles landed where intended:

```bash
cast call "$ESCROW_CONTRACT_ADDRESS" "hasRole(bytes32,address)(bool)" \
  "$(cast keccak 'OPERATOR_ROLE')" "$OPERATOR_ADDRESS" --rpc-url "$MONAD_RPC_URL"
cast call "$ESCROW_CONTRACT_ADDRESS" "hasRole(bytes32,address)(bool)" \
  "$(cast keccak 'GUARDIAN_ROLE')" "$GUARDIAN_ADDRESS" --rpc-url "$MONAD_RPC_URL"
```

Both `true`.

4. Grant the allowance, **signed by the operator**:

```bash
cast send "$USDC_ADDRESS" "approve(address,uint256)" \
  "$ESCROW_CONTRACT_ADDRESS" "$(cast max-uint)" \
  --rpc-url "$MONAD_RPC_URL" --private-key "$OPERATOR_PRIVATE_KEY"
```

5. **Verify the allowance by reading it, not by the absence of an error** — an approval
   signed by the wrong wallet also succeeds:

```bash
cast call "$USDC_ADDRESS" "allowance(address,address)(uint256)" \
  "$OPERATOR_ADDRESS" "$ESCROW_CONTRACT_ADDRESS" --rpc-url "$MONAD_RPC_URL"
```

Expect a very large number. Zero means it was signed by the wrong key.

### Check the gas arithmetic while you are here

Read `broadcast/Deploy.s.sol/10143/run-latest.json` and compare the transaction's `gas`
(the submitted limit) against the receipt's `gasUsed`. On the fork these are **equal** —
no pad — so the charge is `gasUsed × effectiveGasPrice`. Confirm against the deployer's
balance drop. Measured on the real deploy: 2,406,060 / 2,406,060 at 107.8 gwei =
0.2594 MON, balance 5.0000 → 4.7406
([R8](./research.md#r8--gas-the-fork-already-removes-the-pad-corrected-post-deploy)).

The pre-broadcast `Estimated amount required` line reads ~0.50 MON — roughly double the
actual charge, because it is quoted at a conservative gas price. That is expected.

---

## Gate 3 — The runbook itself

The deliverable is the README, and it is validated by a person, not a command.

| Check | Method | Criterion |
| --- | --- | --- |
| SC-001 | Hand `sc/README.md` to someone who has not seen the project, on a clean machine. No other document, no questions. | Working deployment in under 45 min |
| SC-002 | Watch them move the address | Zero characters retyped |
| SC-003 | First purchase after they finish | Succeeds first attempt |
| SC-004 | First disputed verdict | Settles first attempt |
| SC-005 | Read the funding table | 4 of 4 wallets, each with asset and failure mode |
| SC-006 | Ask them to point at the approval step | Found in under 10 s, scanning only |
| SC-007 | Ask why the MON balance fell faster than expected | Answer is in the README |
| SC-010 | `grep -n 'docs/' README.md` | No hit is load-bearing for proceeding |

**If a real cold reader is not available**, the honest substitute is a fresh terminal, a
shell with no exported configuration, and following the README literally — executing
only what is written, adding nothing from memory. That catches R2 and R14, which are the
two failures a familiar reader compensates for without noticing.

---

## Prerequisites already satisfied

Both Gate 2 and Gate 3 need funded wallets, and that is done — four distinct keypairs in
`guardian/.env` with matching key/address pairs, 5 MON each, and 20 test USDC in the
funder wallet. Two faucets: MON from `https://faucet.monad.xyz/`, test USDC from
`https://faucet.circle.com/`
([R13](./research.md#r13--resolved-two-faucets-one-per-asset)).

**The operator's 0 USDC balance is correct, not a gap.** The funder is the only source
of money; USDC reaches the operator pool at runtime via user top-ups, which is what
`openDeal` then pulls into escrow. Nothing tops up the operator at setup, so do not
"fix" it before running Gate 2.
