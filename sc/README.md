# Guardian Settlement Contracts

`GuardianEscrow` — the contract that holds a buyer's payment between purchase and
settlement. It is the only contract Guardian deploys, and the only place platform money
is ever locked.

This README is the deployment runbook. It takes a machine with nothing installed to a
live contract on Monad Testnet that survives its first purchase. Work the six steps in
order.

**Steps 4 and 5 carry the same weight as step 3.** A deployment that stops after step 3
reports success, shows healthy roles on the explorer, and reverts on the first purchase.

---

## Step 0 — Prerequisites, and what you end up with

### 0a. What you need before starting

| | |
| --- | --- |
| Machine | macOS or Linux, with `bash`, `curl` and `git` |
| Installed | Nothing else — step 1 installs the toolchain |
| Browser | Yes, for two faucets in step 2 |
| Time | ~45 minutes |
| Cost | ~0.4 MON for the deploy, ~0.07 MON for the step 6 smoke test. MON and test USDC are free from the faucets |

**All commands run from `sc/`** — the directory holding this file — unless a step says
otherwise. Steps 3 through 6 must run in **one** terminal window; step 3 loads the
configuration into that shell and nowhere else.

### 0b. The network

| | |
| --- | --- |
| Chain | Monad Testnet, chain ID `10143` |
| RPC | `https://testnet-rpc.monad.xyz` |
| Explorer | `https://testnet.monadvision.com` |
| Settlement token | `0x534b2f3A21130d7a60830c2Df862319e593943A3` — test USDC, **6 decimals**, so `1000000` is 1 USDC |

### 0c. What you end up with

- `GuardianEscrow` live on Monad Testnet, its settlement token fixed and its three roles
  (admin, operator, guardian) granted in the deploy transaction — no follow-up
  configuration.
- Its address in the repository-root `.env`, as `ESCROW_CONTRACT_ADDRESS`, where `api/`
  reads it.
- The operator wallet authorised to move test USDC into the escrow, which is what makes a
  purchase possible.
- One completed purchase, proven end to end.

### 0d. The six steps

| Step | Does | If you skip it |
| --- | --- | --- |
| 1 | Installs the **Monad fork** of Foundry | Upstream Foundry prices gas wrong, silently |
| 2 | Fills `.env`, funds four wallets | Deploy fails now, or the demo fails later |
| 3 | Exports the configuration, deploys | — |
| 4 | Pastes the new address into `.env` | Every other component points at nothing |
| 5 | **Approves the escrow, from the operator wallet** | **The first purchase reverts** |
| 6 | Runs one purchase end to end | You find out on stage instead |

---

## Step 1 — Install the Monad Foundry fork, and prove you have it

Monad ships a **fork** of Foundry. It is not upstream Foundry with a flag: it installs to
the same directory (`~/.foundry/bin`), under the same binary names, so the two overwrite
each other and nothing about the resulting `forge` announces which one won. There is no
`forge-monad`. Installing the wrong one produces no error — it produces mis-priced gas.

### 1a. Install

```bash
mkdir -p "$HOME/.foundry/bin"
curl -L https://raw.githubusercontent.com/category-labs/foundry/monad/foundryup/foundryup \
  -o "$HOME/.foundry/bin/foundryup"
chmod +x "$HOME/.foundry/bin/foundryup"
export PATH="$HOME/.foundry/bin:$PATH"
foundryup --network monad
```

The `--network monad` flag is what selects the fork. Without it you get upstream.

### 1b. Put the binaries on `PATH` permanently

The installer does not reliably do this, and `forge` is **not** on `PATH` in a fresh
shell. Until this is fixed, step 1c looks like a failed install.

```bash
echo 'export PATH="$HOME/.foundry/bin:$PATH"' >> ~/.zshrc    # or ~/.bashrc
```

Then open a **new terminal** — or re-run the `export PATH=...` line above in the current
one.

### 1c. Verify — the version string must contain `-monad-`

```bash
forge --version
```

Expected:

```
forge Version: 1.7.1-monad-v1.0.0
Commit SHA: bb49277de2e0979b9d37dc0e5f7f18f24b0262b8
```

`forge Version: 1.7.1` with **no** `-monad-` means upstream Foundry is winning the path;
re-run 1a. `forge: command not found` means 1b was skipped or the terminal is stale.
The version string is the only reliable way to tell the two apart.

### 1d. Build

From `sc/`:

```bash
forge build
```

---

## Step 2 — Fill in `.env` and fund the four wallets

Guardian keeps **one** `.env`, at the **repository root** — one level *above* `sc/`,
shared by `api/`, `ui/` and `sc/`. There is no `.env` inside `sc/` and you should not
create one.

### 2a. Create it

```bash
cp ../.env.example ../.env
```

`../.env` is gitignored. `../.env.example` is not — never put a real key in the example.

### 2b. Generate four keypairs and fill them in

```bash
cast wallet new     # run four times: deployer, funder, operator, guardian
```

Record each address and private key, then fill these keys in `../.env`:

| Wallet | `.env` keys |
| --- | --- |
| Deployer | `DEPLOYER_PRIVATE_KEY` |
| Funder | `FUNDER_PRIVATE_KEY`, `FUNDER_ADDRESS` |
| Operator | `OPERATOR_PRIVATE_KEY`, `OPERATOR_ADDRESS` |
| Guardian | `GUARDIAN_PRIVATE_KEY`, `GUARDIAN_ADDRESS` |

**Store every private key with the `0x` prefix.** This is not cosmetic: `cast` accepts
bare hex and `forge` refuses it. A bare-hex key passes every test you can run with
`cast`, then fails the deploy in step 3 with an error that reads like a Foundry bug.

`OPERATOR_ADDRESS` and `GUARDIAN_ADDRESS` must be **different** wallets. Splitting them is
the contract's central security property — a leaked guardian key can mis-rule a dispute
but cannot open deals or move money — and the deploy script refuses to run if they match.

### 2c. Clear the placeholders

`.env.example` ships **format-valid fakes** — `0xDEAD…`, zero-padded, correct length — so
that `api/` can boot before this contract exists. They are the right shape and pass every
format check by design. Nothing catches them except the deploy script's explicit guard.

List what is still fake:

```bash
grep -n 'TODO(placeholder)' ../.env
```

Every wallet and address line it names must hold a real value before step 3. Two
exceptions: `ESCROW_CONTRACT_ADDRESS` is step 4's output, and the `ANTHROPIC_API_KEY` /
Rain keys belong to `api/`, not to this runbook.

### 2d. The deployer key is disposable

It signs exactly one transaction — the deploy in step 3 — and nothing in the running
system ever uses it again. Generate a throwaway for it, and discard it afterwards. It
never has to live in a `.env` that travels.

### 2e. Fund all four wallets with MON

Faucet: **https://faucet.monad.xyz/** — one visit per address, four addresses.

| Wallet | Needs | Minimum | First used | If it is empty |
| --- | --- | ---: | --- | --- |
| **Deployer** | MON | **1 MON** | Step 3, once | Deployment fails immediately — the only one of the four that fails visibly |
| **Funder** | MON **and test USDC** | **5 MON** + test USDC | First user top-up | No money ever enters the system; every purchase fails for lack of funds |
| **Operator** | MON | **5 MON** | Step 5, then every call after | Purchases fail once the balance runs out — mid-session, after everything worked |
| **Guardian** | MON | **1 MON** | First verdict only | **Everything works until the first dispute**, then settlement fails |

The guardian is the wallet most often skipped, because nothing between here and a working
first purchase touches it. Its failure is deferred to the most visible moment you have.

### 2f. Fund the funder wallet with test USDC — a second site

Faucet: **https://faucet.circle.com/** — select Monad Testnet, paste `FUNDER_ADDRESS`.

**Do not stop after 2e.** Four wallets of MON *feels* like a finished step and is not.
The funder is the only wallet needing two assets, and the two assets come from two
different websites. A funder holding MON and no USDC deploys fine, approves fine, and has
no money to sell anything with. 20 test USDC is plenty.

### 2g. Confirm the balances

Substitute each real address for the placeholder:

```bash
cast balance <FUNDER_ADDRESS> --rpc-url https://testnet-rpc.monad.xyz

cast call 0x534b2f3A21130d7a60830c2Df862319e593943A3 "balanceOf(address)(uint256)" \
  <FUNDER_ADDRESS> --rpc-url https://testnet-rpc.monad.xyz
# 20000000   ← 20 test USDC, 6 decimals
```

Repeat the `cast balance` line for the deployer, operator and guardian addresses. The
operator's USDC balance is `0` at this point and that is correct — the funder is the only
source of money, and USDC reaches the operator at runtime through user top-ups.

---

## Step 3 — Export the configuration, then deploy

`forge` reads `.env` from the Foundry project root — that is `sc/` — and **does not walk
up to parent directories**. Guardian's `.env` is one level above, at the repository root.
So `forge script` on its own sees **none** of your configuration and dies on the first
lookup, no matter how correctly `.env` is filled in.

The first line of the block below is what fixes that. It is part of deploying, not advice
about deploying.

### 3a. Export, then deploy — from `sc/`

```bash
set -a; . ../.env; set +a
forge script script/Deploy.s.sol:Deploy --rpc-url "$MONAD_RPC_URL" --broadcast
```

**The export lives in this shell session only.** A new terminal, a new tab, or a reboot
needs `set -a; . ../.env; set +a` again before anything in steps 3–6 works. Every command
from here on assumes it has been run in the shell you are typing into.

Drop `--broadcast` for a dry run: identical validation and simulation, nothing sent, no
MON spent. If any of the four inputs is missing, malformed, still a `0xDEAD…` placeholder,
or if operator and guardian match, the script stops **before** broadcasting and names
every offending key at once — nothing reaches the network.

### 3b. What it costs, and why gas works differently here

Expect roughly **0.26 MON** for the deploy — measured, not estimated: 2,406,060 gas at
~108 gwei.

**Monad charges the gas *limit*, not the gas used.** On most chains the limit is a
ceiling and you pay only for what you consume, so tooling estimates and then pads for
safety. Here that pad would be money spent, not headroom.

The Monad fork accounts for this: it submits the simulated gas as the limit exactly,
with no padding — verified on this deploy, where the submitted limit and the gas used
were the same number to the unit, and the deployer's balance fell by precisely
`gas × price`. **Upstream Foundry pads by 130% and would have burned about 30% more.**
This is one of the concrete reasons step 1 insists on the fork.

Two consequences worth carrying:

- The figure `forge` prints before broadcasting (`Estimated amount required`) is quoted
  at a conservative gas price and will read high — around 0.50 MON against an actual
  0.26. It is a funding check, not a bill.
- Anything you write later that talks to this chain should set explicit gas limits
  rather than estimate-and-pad, for the same reason.

The deployer's 1 MON minimum covers the deploy roughly three times over.

### 3c. Verify

The run reports success and prints one line under `== Logs ==`:

```
== Logs ==
  ESCROW_CONTRACT_ADDRESS=0xAbCdEf0123456789AbCdEf0123456789AbCdEf01
```

Your address will differ. That line is step 4's input.

---

## Step 4 — Paste `ESCROW_CONTRACT_ADDRESS` into `.env`

The line is printed in exactly the format `.env` expects, so nothing is retyped or
reformatted.

### 4a. Copy the line

Select from the `E` of `ESCROW`. `forge` indents its logs by two spaces; that leading
whitespace is not part of the line.

### 4b. Replace the existing entry in `../.env`

Open the **repository-root** `.env` and replace the whole `ESCROW_CONTRACT_ADDRESS=` line
with the copied one. Keep it byte-identical to what was printed — **no space after the
`=`**. Delete any `# TODO(placeholder)` marker left on that line.

### 4c. Verify

```bash
grep ESCROW_CONTRACT_ADDRESS ../.env
# ESCROW_CONTRACT_ADDRESS=0xAbCdEf0123456789AbCdEf0123456789AbCdEf01
```

Exactly one line, non-empty, and not starting `0xDEAD`.

---

## Step 5 — Approve the escrow from the operator wallet

**This is a step, not a footnote, and it is not part of step 3.**

`openDeal` does not receive money — it *pulls* the purchase price out of the operator's
wallet with `transferFrom`. Until the operator has approved the escrow as a spender, the
token contract refuses that pull. Nothing about the deployment reveals this: the contract
is live, the roles resolve correctly, the explorer looks healthy, and the **first
purchase reverts**, long after deployment looked finished.

Two ways to get this wrong, both of which produce **no error at all**:

- signing with the deployer key instead of the operator key — the transaction succeeds,
  but it authorises the escrow to spend the *deployer's* tokens. The operator's allowance
  is still zero, which is the only one `openDeal` consults;
- skipping the step and discovering it at the first purchase.

### 5a. Re-export

`ESCROW_CONTRACT_ADDRESS` changed in step 4; your shell still holds the old value.

```bash
set -a; . ../.env; set +a
```

### 5b. Approve — signed by the **operator**

```bash
cast send "$USDC_ADDRESS" "approve(address,uint256)" \
  "$ESCROW_CONTRACT_ADDRESS" "$(cast max-uint)" \
  --rpc-url "$MONAD_RPC_URL" --private-key "$OPERATOR_PRIVATE_KEY"
```

`--private-key "$OPERATOR_PRIVATE_KEY"` — never `$DEPLOYER_PRIVATE_KEY`. `$(cast max-uint)`
grants an unbounded allowance, so it never needs re-granting halfway through a session.

### 5c. Verify by reading the allowance back

A successful transaction proves nothing here — an approval signed by the wrong wallet
also succeeds. Read the value:

```bash
cast call "$USDC_ADDRESS" "allowance(address,address)(uint256)" \
  "$OPERATOR_ADDRESS" "$ESCROW_CONTRACT_ADDRESS" --rpc-url "$MONAD_RPC_URL"
# 115792089237316195423570985008687907853269984665640564039457584007913129639935
```

Expect that 78-digit number. **`0` means it did not take** — the wrong key signed it, or
the spender is a different contract than the one now in `.env`. Redo 5a and 5b.

### 5d. Confirm the two roles landed

While the environment is fresh:

```bash
cast call "$ESCROW_CONTRACT_ADDRESS" "hasRole(bytes32,address)(bool)" \
  "$(cast keccak 'OPERATOR_ROLE')" "$OPERATOR_ADDRESS" --rpc-url "$MONAD_RPC_URL"
cast call "$ESCROW_CONTRACT_ADDRESS" "hasRole(bytes32,address)(bool)" \
  "$(cast keccak 'GUARDIAN_ROLE')" "$GUARDIAN_ADDRESS" --rpc-url "$MONAD_RPC_URL"
```

Both must print `true`.

---

## If you redeploy

Re-running step 3 upgrades nothing. It creates a **new, separate contract** at a new
address, with empty state and no knowledge of the old one.

- The previous address is stale everywhere it was recorded — `.env`, `api/`, any note you
  took, any browser tab.
- Anything the old contract holds **stays in the old contract**. There is no migration
  and no upgrade path.
- **Steps 4 and 5 must both be repeated.** The approval from step 5 named the *old*
  contract as the spender, so it does not carry over. A redeploy silently returns you to
  the exact pre-approval state that step 5 exists to prevent — and because step 5 "was
  already done", nobody suspects it.

---

## Step 6 — Verify: run one purchase end to end

Deployment is complete; this proves it *works*. Costs ~0.07 MON and 1 test USDC. Run
everything from `sc/`, in the shell where 5a's export ran.

### 6a. Move 1 test USDC from the funder to the operator

The operator holds no USDC yet, which is correct: at runtime USDC reaches the operator
through user top-ups. For this smoke test, do it by hand. The token has 6 decimals, so
`1000000` is 1 USDC.

```bash
cast send "$USDC_ADDRESS" "transfer(address,uint256)" "$OPERATOR_ADDRESS" 1000000 \
  --rpc-url "$MONAD_RPC_URL" --private-key "$FUNDER_PRIVATE_KEY"
```

### 6b. Register an agent priced at 1 USDC

Operator-signed. The funder wallet stands in as the seller.

```bash
cast send "$ESCROW_CONTRACT_ADDRESS" "registerAgent(address,uint256,bytes32)" \
  "$FUNDER_ADDRESS" 1000000 "$(cast keccak 'smoke-test')" \
  --rpc-url "$MONAD_RPC_URL" --private-key "$OPERATOR_PRIVATE_KEY"
```

On a fresh deployment this is agent `1`.

### 6c. Open the deal — **this is the call that fails if step 5 was skipped**

The guardian wallet stands in as the buyer; `30` is the review window in seconds.

```bash
cast send "$ESCROW_CONTRACT_ADDRESS" "openDeal(uint256,address,uint32)" \
  1 "$GUARDIAN_ADDRESS" 30 \
  --rpc-url "$MONAD_RPC_URL" --private-key "$OPERATOR_PRIVATE_KEY"
```

Success means deal `1` is open and 1 USDC has moved from the operator into escrow.

**A missing approval fails here**, with a revert coming from the *token* rather than the
escrow — an allowance error such as `ERC20: transfer amount exceeds allowance`, usually
surfaced by `cast` as `execution reverted`. That is step 5 failing late, not step 6
failing. Go back to 5a and check that 5c reads back a non-zero allowance.

### 6d. Mark it delivered

```bash
cast send "$ESCROW_CONTRACT_ADDRESS" "markDelivered(uint256)" 1 \
  --rpc-url "$MONAD_RPC_URL" --private-key "$OPERATOR_PRIVATE_KEY"
```

### 6e. Wait 30 seconds for the review window, then release

`release` is permissionless by design — any funded key may call it.

```bash
cast send "$ESCROW_CONTRACT_ADDRESS" "release(uint256)" 1 \
  --rpc-url "$MONAD_RPC_URL" --private-key "$OPERATOR_PRIVATE_KEY"
```

A revert saying `window open` means the 30 seconds have not elapsed. Wait, retry.

### 6f. Verify — the seller now holds a withdrawable claim

```bash
cast call "$ESCROW_CONTRACT_ADDRESS" "balances(address)(uint256)" "$FUNDER_ADDRESS" \
  --rpc-url "$MONAD_RPC_URL"
# 1000000
```

`1000000` is the price, credited to the seller. Money entered as a purchase and left as a
claim: the deployment is working.

### 6g. Withdraw, so the smoke test leaves nothing behind

Permissionless — any key may trigger a withdrawal, and the funds can only go to the
account they belong to.

```bash
cast send "$ESCROW_CONTRACT_ADDRESS" "withdrawFor(address)" "$FUNDER_ADDRESS" \
  --rpc-url "$MONAD_RPC_URL" --private-key "$OPERATOR_PRIVATE_KEY"
```

The 1 USDC returns to the funder wallet. Deployment complete.

---

## Troubleshooting

Seven failures that look like something other than what they are.

| Symptom | Cause | Fix |
| --- | --- | --- |
| `vm.envUint: missing hex prefix ("0x")` | A private key in `.env` is stored as bare hex. `cast` accepts bare hex and `forge` does not — so a key you have already "verified" with `cast` still fails here, which reads like a Foundry bug | Add the `0x` prefix in `../.env`, then re-run the export in 3a |
| `environment variable "…" not found`, or the deploy naming keys that are plainly filled in | The export step was skipped, or you are in a different terminal from the one that ran it. `forge` cannot see the repository-root `.env` from `sc/` on its own | Run `set -a; . ../.env; set +a` in **this** shell (3a) |
| Deploy succeeded, **first purchase reverts** on the token | The approval is missing. Three routes: step 5 skipped; step 5 signed with the deployer key instead of the operator key (no error either way); or a redeploy since step 5, which invalidated it — the allowance named the old contract | Redo 5a–5c. The proof is 5c reading back a non-zero allowance, not the absence of an error |
| Everything works, then the **first disputed verdict fails** | The guardian wallet has no MON. Nothing between deployment and a working first purchase touches it, so it is the wallet skipped in step 2, and its failure lands at the most visible moment you have | Send 1 MON to `GUARDIAN_ADDRESS` from https://faucet.monad.xyz/ |
| `placeholder value still in .env: …` | A shipped `0xDEAD…` fake survived step 2. They are format-valid on purpose and pass every check except this guard | `grep -n 'TODO(placeholder)' ../.env`, replace the named key, re-export (3a) |
| `forge Version: 1.7.1` with no `-monad-`, or `forge: command not found` | Upstream Foundry is winning `~/.foundry/bin`, or the shell predates the install. Both toolchains use the same path and binary name | Re-run 1a with `--network monad`; apply 1b and open a new terminal |
| Deploy fails on insufficient funds | The deployer holds under 1 MON. The charge tracks the padded gas *limit*, not the ~3.0M gas actually used (see 3b) | Top the deployer up from https://faucet.monad.xyz/ |
