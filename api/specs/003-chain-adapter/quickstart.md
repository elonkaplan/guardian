# Quickstart: verifying the chain adapter

Automated tests are out of scope for this component
([`docs/CONTEXT.md`](../../docs/CONTEXT.md)). This is the manual verification, and it
is what SC-001 through SC-009 are checked against.

Budget: about 20 minutes, most of it the smoke script.

---

## Prerequisites

| # | Requirement | Status |
| --- | --- | --- |
| 1 | The escrow is deployed | ✅ `0xe1b74F8dB511247786Ef61bde9330198a1929d53` |
| 2 | The operator holds `OPERATOR_ROLE`, the guardian `GUARDIAN_ROLE` | ✅ verified on chain, and neither holds the other's |
| 3 | The operator holds MON for gas | ✅ 4.9 MON ≈ 80 full purchase cycles |
| 4 | The escrow has a USDC allowance from the operator | ✅ effectively unbounded (set by the deploy runbook) |
| 5 | The operator holds USDC | ✅ $20.00 — 20 deals at $1.00 |
| 6 | `npm install` has been run since viem was added | `ls node_modules/viem` |

> **No blockers.** Every step in this document runs today.
>
> Worth knowing if the operator ever reads $0.00 again: `openDeal` does
> `safeTransferFrom(operator, escrow, price)`, so **balance and allowance are
> independent preconditions**. An unbounded allowance tells you nothing about whether
> the transfer can succeed, and the resulting `ERC20InsufficientBalance` arrives
> bubbled through `SafeERC20` — R6's third decode encoding. More test USDC can be
> minted by the key that holds the minter role.

> **⚠️ The chain is not fresh.** The deployment runbook ran a full lifecycle smoke
> test, so `nextAgentId = 2`, `nextDealId = 2`, agent 1 exists (owner = funder, $1.00,
> v1, active) and deal 1 exists in state `Settled`. **A newly registered agent will be
> id 2, not id 1.** Those two records are useful — they are real fixtures for the read
> path in Step 4.

---

## Step 0 — already settled, no action

An earlier draft put a module-resolution probe here. It has been **run and passed**
against viem 2.55.11 with this project's compiler options (research R14): viem ships
legacy directory stubs, so `viem/accounts` resolves under the default `node10`
algorithm and `api/tsconfig.json` needs no change. `nonceManager` is exported from
`viem/accounts` alongside `privateKeyToAccount`.

Nothing to do. Re-run the probe only if viem's **major** version changes — dropping
those stubs is the obvious thing for a 3.x to do.

---

## Step 1 — unit conversion (SC-005)

No chain access needed. Run against `src/chain/units.ts`:

```bash
npx ts-node -e "
const { toBaseUnits, fromBaseUnits } = require('./src/chain/units');
for (const c of [0, 1, 100, 150, 200, 999, 12_345, 1_000_000, 90_071_992]) {
  const b = toBaseUnits(c);
  console.log(c, '->', b.toString(), '->', fromBaseUnits(b), fromBaseUnits(b) === c ? 'OK' : 'FAIL');
}
for (const bad of [1.5, -1, NaN, Number.MAX_SAFE_INTEGER + 1]) {
  try { toBaseUnits(bad as number); console.log(bad, 'FAIL — accepted'); }
  catch { console.log(bad, 'OK — rejected'); }
}
try { fromBaseUnits(1n); console.log('non-whole-cent FAIL — accepted'); }
catch { console.log('non-whole-cent OK — rejected'); }
"
```

**Expected**: every round-trip `OK`, every guard `OK — rejected`. `$2.00` must print
`200 -> 2000000 -> 200`.

**Then SC-004** — the scale appears in exactly one file:

```bash
grep -rnE "(^|[^0-9_])10_000n|(^|[^0-9])10000n|10n \*\* 4n" src/ --include='*.ts' \
  | grep -v "src/chain/units.ts"
```

**Expected**: no results outside `src/chain/units.ts`.

Two notes, both learned by getting false positives from the obvious version of
this command:

- **Quote `--include='*.ts'`.** Unquoted, zsh tries to expand it and the command
  fails with `no matches found` — which prints nothing and looks exactly like a
  clean pass.
- **The leading `[^0-9_]` matters.** A plain `10_000n` search also matches
  `210_000n` in `chain.constants.ts`, which is a gas ceiling, not the conversion
  scale. Searching for bare `decimals` is likewise useless: it hits
  `nativeCurrency: { decimals: 18 }` in `monad-chain.ts`, which is MON's
  precision and has nothing to do with the settlement token.

---

## Step 2 — the guardian narrowing (SC-003)

The check that FR-003 is structural rather than aspirational.

```bash
grep -c "name:" src/chain/abi/escrow-resolve.abi.ts
```

**Expected**: `1` — and reading the file shows that one name is `resolve`.

Then prove the compile error. Add this line temporarily inside
`EscrowGuardianService`:

```ts
await this.guardianClient.writeContract({
  address: this.escrow, abi: escrowResolveAbi, functionName: 'openDeal', args: [1n, '0x0', 30],
})
```

```bash
npx tsc --noEmit
```

**Expected**, verbatim — this exact error has been reproduced against viem 2.55.11,
so anything else means the narrowing is not working:

```
error TS2322: Type '"openDeal"' is not assignable to type '"resolve"'.
```

Not a runtime failure, not a lint warning. Remove the line afterwards.

If it *compiles*, the cause is almost always a missing `as const` on
`escrow-resolve.abi.ts` — without it the ABI widens to `string[]` and the check
silently disappears while the file still looks correct.

**Then SC-008** — nothing outside `chain/` addresses the chain:

```bash
grep -rnE "^\s*import .* from '(viem|viem/.*)'" src/ --include='*.ts' \
  | grep -v "^src/chain/"
```

**Expected**: no results.

Match on the **import statement**, not the bare word: `config/detect-placeholders.ts`
mentions viem in a prose comment explaining why a placeholder private key fails
late, and a bare-word search reports that as a boundary violation.

---

## Step 3 — boot the API and read the preflight

```bash
npm run start:dev
```

**Expected** in the log — every line has been confirmed against the live contract, so
any `WARN` here is a real regression rather than an unverified expectation:

```
[ChainPreflight] chain id 10143 — OK
[ChainPreflight] settlement token 0x534b…43A3 — OK
[ChainPreflight] token decimals 6 — OK
[ChainPreflight] OPERATOR_ROLE held by 0xB02D…580a — OK
[ChainPreflight] GUARDIAN_ROLE held by 0x4A93…fc2d — OK
```

Warnings here do not stop the boot (R11) — that is deliberate. A warning means the
next real call will fail, and it tells you why in advance.

**SC-009**: temporarily set `MONAD_CHAIN_ID=1` and restart. Expect a chain-id
mismatch warning naming both values. Restore it.

---

## Step 4 — the smoke script (SC-001, SC-002)

The throwaway script the spec's acceptance criterion names. `scripts/chain-smoke.ts`,
run with:

```bash
npx ts-node scripts/chain-smoke.ts
```

It performs, in order:

1. `ensureAllowance` — approves if needed, prints `already sufficient` if not
2. `registerAgent(operatorAddress, 200, keccak256("smoke"))` — a $2.00 agent
3. `getAgent(newId)` — reads it straight back
4. `totalEscrowedCents()` and `balanceOfCents(operator)`
5. Prints every transaction's explorer URL and its `gasUsed` against the declared limit

**Expected output** (shape — note the agent id is **2**, since agent 1 already exists):

```
allowance:      already sufficient (unbounded, set at deploy)
registerAgent:  agentId 2, tx 0x…  gas 158,189 / 210,000  (75%)
  https://testnet.monadvision.com/tx/0x…
getAgent(2):    owner 0xB02D…580a  price 200¢  version 1  active true
totalEscrowed:  0¢
balanceOf:      0¢
```

**Then check by hand:**

- Open the `registerAgent` URL. The transaction is there, status success, and the
  `AgentRegistered` log carries the id the script printed. **This is SC-001.**
- The write and the reads both worked in one run. **This is SC-002.**
- `getAgent` returned `200`, not `2000000`. The conversion holds across the boundary.

**Also read the pre-existing fixtures**, which exercise paths a fresh registration
cannot:

- `getAgent(1n)` → owner is the funder address, price `100`¢, version 1, active
- `getDeal(1n)` → state `Settled`, amount `100`¢, `reviewWindowSeconds` 30,
  `deliveredAt` a real `Date`, `disputedAt` **`null`** — that last one is the R12
  mapper's zero-timestamp rule working on real data

**Compare each `gasUsed` against its declared limit.** Five of the twelve ceilings are
already measured ([research R5](./research.md)); this run is the opportunity to
measure the rest.

---

## Step 5 — the id comes from the log, not the tuple (R3)

The failure mode this guards against is silent, so check it directly:

```bash
grep -n "parseEventLogs" src/chain/escrow-operator.service.ts
```

**Expected**: two occurrences — `AgentRegistered` and `DealOpened`. If `registerAgent`
returns an id obtained any other way (`nextAgentId`, a simulation result), that is
the bug R3 describes and it will surface as the wrong seller owning the wrong agent.

---

## Step 6 — gas ceilings are declared, not estimated (SC-006)

```bash
grep -rn "estimateGas\|estimateContractGas" src/chain/
```

**Expected**: no results.

```bash
grep -c "gas:" src/chain/escrow-operator.service.ts
```

**Expected**: one per write method — every one of them passes an explicit `gas`.

---

## Step 7 — provoke each error (SC-007)

Six named kinds, plus three more. Each row of the provocation table in
[contracts/errors.md](./contracts/errors.md) is run once, and the assertion is the
same every time: **the caught error is the named class**, and its message says
something a human can act on.

The two worth doing carefully:

- **`ChainOutcomeUnknownError`** — set `RECEIPT_TIMEOUT_MS` to `1`, run one
  `registerAgent`. Confirm the error carries a real transaction hash, and confirm
  that hash later shows a *successful* transaction on MonadVision. That is the whole
  point: the call failed, the transaction did not.
- **`InsufficientAllowanceError`** — needs the `ensureAllowance` call in `openDeal`
  bypassed. Confirm the message names the allowance, not "execution reverted" — R6's
  third encoding is the one most likely to decode badly.

---

## What is deliberately not verified here

- **Nothing about order state, balances, or the database.** This module has no
  business logic and writes no rows.
- **No load or concurrency testing.** R8's `nonceManager` is verified by reading the
  account construction, not by racing transactions.
- **No event subscription or history replay.** Out of scope for this feature.
