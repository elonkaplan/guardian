# Phase 0 Research: Chain Adapter

Sixteen decisions. They cluster around four questions the spec leaves open on purpose:
**where the contract interface comes from**, **how a write reports what it did**,
**what "explicit gas" actually means in this client library**, and **how a revert
becomes a typed error**.

Three of them (R2, R3, R14) are the ones that cost real time if discovered during
implementation rather than now.

**R16 is the newest and was written after the escrow was deployed** — it records what
the live contract actually reports, and it corrected R5's `openDeal` gas ceiling from
a value that would have made every purchase fail. Read it alongside R5 and R10, both
of which it amends.

---

## R1 — viem `^2.55.11`, added to `api/`

**Decision**: add `"viem": "^2.55.11"` to `api/package.json` dependencies. Not the
`3.0.0-next` line.

**Rationale**: Monad's docs name **≥ 2.40.0** as the floor
([project-structure.md](../../../docs/project-structure.md) §1.3); 2.55.11 is the
current `latest` tag, verified against the registry. The caret keeps us on 2.x, which
is where the floor applies. `3.0.0-next.7` exists but is a prerelease — a breaking
major on the one library that signs money-moving transactions is not an MVP risk worth
taking for no named benefit.

**Alternatives considered**: ethers.js (Monad's own docs call out viem, and `ui/`
already commits to the wagmi/viem stack — two client libraries in one repo is two
sets of gotchas); pinning exactly to `2.40.0` (the floor is a minimum, not a target,
and we would inherit ten months of fixed bugs for nothing).

---

## R2 — The ABI is **copied into `src/`**, not imported from `sc/out/`

**Decision**: transcribe the `abi` array from
`sc/out/GuardianEscrow.sol/GuardianEscrow.json` into
`api/src/chain/abi/escrow.abi.ts` as an `export const escrowAbi = [...] as const`,
checked into git, with a header comment naming the source artifact and the command
that regenerates it.

**Rationale**: three independent reasons, any one of which is decisive.

1. **`sc/out/` is gitignored** (verified: `sc/.gitignore` line 2). A build that
   depends on it fails on any machine that has not run `forge build` — including CI
   and the Docker image.
2. **`tsconfig.json` sets `"rootDir": "./src"`.** Nothing outside `api/src/` can be
   compiled into the output at all, so a relative import across the package boundary
   is not merely untidy, it does not build.
3. **`as const` is load-bearing.** viem derives every argument and return type from
   the ABI's *literal* type. A JSON import (even with `resolveJsonModule`) widens
   `"uint256"` to `string`, and every wrapper silently degrades to `unknown` — losing
   exactly the type safety this module exists to provide.

The duplication is real and is managed by making it visible: the header records the
artifact path and the regeneration step, and R11's startup preflight catches a
drifted ABI at boot rather than mid-demo.

**Alternatives considered**: `wagmi/cli` codegen (a build-tool dependency, a config
file, and a generation step, for three ABIs that change when the contract is
redeployed and never otherwise); a shared workspace package (npm workspaces across
`api/`, `sc/`, `ui/` is a repo-layout change, not a feature).

---

## R3 — `registerAgent` and `openDeal` return ids that the transaction cannot give back

**Decision**: recover both new ids from the **receipt's event logs**, using
`parseEventLogs({ abi: escrowAbi, eventName: 'AgentRegistered' | 'DealOpened', logs: receipt.logs })`.
Never from the transaction's return value; never from `nextAgentId()`.

**Rationale**: this is the single most likely thing to get wrong, because the
contract's signature reads as though it works:

```solidity
function registerAgent(...) external returns (uint256 agentId)
function openDeal(...)      external returns (uint256 dealId)
```

A return value only exists for an `eth_call`. A **transaction** returns nothing to an
off-chain caller — the value is discarded once the transaction is mined. The id is
recoverable only because both functions also emit it: `AgentRegistered(agentId, ...)`
and `DealOpened(dealId, ...)`, both confirmed present in the compiled ABI.

`parseEventLogs` filters by ABI *and* by event name, so an unrelated log in the same
receipt (the ERC-20 `Transfer` that `openDeal` produces, for instance) cannot be
mistaken for ours. Reading the log rather than the tuple is also why R4's simulate
step cannot be the source: the simulation's `result` is the id the call *would*
produce, which is correct only if nothing interleaves before the real transaction
lands.

**Rejected**: reading `nextAgentId() - 1` after the transaction. It is racy against
any concurrent write, and the race resolves as *the wrong agent id attached to the
wrong seller* — a silent, money-relevant corruption.

---

## R4 — Simulate first (free), then write with an explicit `gas`

**Decision**: every operator write is `simulateContract` → `writeContract` with an
explicit `gas` value. `simulateContract`'s `request` is spread into the write, but
**`gas` is overridden with our own constant**, never taken from the simulation.

**Rationale**: `simulateContract` is an `eth_call`. It costs nothing, changes
nothing, and reverts with the same data the real transaction would — so it catches
"agent inactive", "not delivered", "window closed", and every role failure *before*
a transaction is paid for. On a chain that charges the gas limit, a revert caught
for free instead of on-chain is a direct saving, on top of the better error.

The `gas` override is the part that matters. viem's `writeContract` issues an
`eth_estimateGas` call whenever `gas` is absent, and `eth_estimateGas` returns a
binary-searched **upper bound**, not the actual usage. On Ethereum that headroom is
refunded; on Monad `value + gas_price * gas_limit` is deducted, so the headroom is
spent. Passing our own number removes both the round-trip and the overpayment, and —
more importantly — makes the figure a reviewable decision rather than whatever the
node happened to return.

**Alternatives considered**: writing without simulating (one fewer round-trip, but
every precondition failure becomes a paid, mined revert — the expensive way to learn
the deal was already delivered); using the simulation's gas estimate (that *is* the
estimate we are avoiding).

---

## R5 — Gas ceilings are named constants with a measurement procedure attached

**Decision**: one `GAS_LIMITS` table in `src/chain/chain.constants.ts`. **Five entries
are now measured against the deployed escrow**; the rest remain estimates. Every
operator write logs `gasUsed` from its receipt alongside the declared limit, so the
remaining estimates replace themselves during the first rehearsal.

**Rationale**: the asymmetry decides every value here — an over-estimate wastes some
MON; an under-estimate loses the MON *and* the transaction, mid-demo.

**⚠️ The first draft of this table got that wrong once, and it is worth recording.**
It estimated `openDeal` at 400,000 from the storage the function touches. The measured
figure is **408,072**. Shipping that estimate would have made *every purchase* revert
out-of-gas on its first attempt, charged in full, with a `GasExhaustedError` — the
exact failure this table exists to prevent, in the single most important operation in
the product. Reasoning about storage costs was not good enough; the measurement was.

**⚠️ How to actually measure gas here — `receipt.gasUsed` is not usage.**

Verified during implementation: a `registerAgent` sent with an explicit 210,000 ceiling
returned `receipt.gasUsed === 210000`, while `eth_estimateGas` for the identical call
returns **158,189**. Monad charges the *limit*, and the receipt reports **what was
charged**, not what execution cost. `gasUsed` therefore always equals the limit,
whatever the limit is.

Two things follow, both of which broke a first-draft implementation:

- **Out-of-gas cannot be detected by comparing `gasUsed` to the ceiling** — they are
  always equal, so a ratio test classifies *every* revert as gas exhaustion.
  `execute-write.ts` instead infers it from the simulation: step 1 already ran the call
  as a free `eth_call` and it did not revert, so a revert appearing only once mined
  points at the one thing simulation cannot see.
- **Logging `gasUsed` measures nothing** — it reads 100% of the ceiling forever, which
  invites the conclusion that the ceilings are perfectly sized. Real cost comes from
  `eth_estimateGas` (exposed as `measureGas`).

The figures below remain correct as *execution costs*: they were read from receipts of
Foundry transactions, and Foundry sets the limit to its own estimate, so `gasUsed`
reported a limit that happened to equal the estimate. Confirmed independently —
`estimateGas` for `registerAgent` returns exactly the 158,189 that receipt reported.
The **method** described in the first draft was wrong; the numbers survive it.

Measurements, from the deployment runbook's own lifecycle transactions on Monad testnet:

| Operation | Limit | Measured | Basis |
| --- | --- | --- | --- |
| `registerAgent` | 210,000 | **158,189** | measured × 1.33 |
| `openDeal` | 530,000 | **408,072** | measured × 1.30 — see the warning above |
| `markDelivered` | 75,000 | **54,549** | measured × 1.37 |
| `accept` / `release` | 130,000 | **99,904** | measured × 1.30 |
| `withdrawFor` | 140,000 | **106,935** | measured × 1.31 |
| `updateAgent` | 120,000 | — | estimate: 3 warm SSTOREs + event |
| `setAgentActive` | 80,000 | — | estimate: 1 SSTORE |
| `dispute` | 100,000 | — | estimate: as `markDelivered`, plus margin |
| `reclaim` | 130,000 | — | estimate: same shape as `release` |
| `resolve` | 180,000 | — | estimate: `release` + a second balance credit |
| `forceResolve` | 180,000 | — | estimate: as `resolve` |
| `approve` (token) | 80,000 | — | estimate: 1 SSTORE + event |

The ×1.3 margin covers the one case the measurements do not: `openDeal`'s cost depends
on whether the escrow's token balance slot is zero at the time. The measured run
started from zero (the expensive case) and the balance returned to zero after the
withdrawal, so 408,072 is the realistic high-water mark rather than a lucky low
reading.

**What this costs in practice**, at the measured effective gas price: `registerAgent`
≈ 0.0165 MON, `openDeal` ≈ 0.0426 MON, `markDelivered` ≈ 0.0057 MON, `release` ≈
0.0104 MON. A full purchase cycle is therefore ≈ 0.059 MON, and the operator holds
4.9 MON — roughly 80 complete cycles. Gas is not the binding constraint on a demo of
this size; the under-estimate was the real risk, and it is now closed.

The logging stays regardless: it is what turns the seven remaining estimates into
measurements without anyone having to remember to go looking.

**Alternatives considered**: one blanket limit for everything (sized for `openDeal`,
it triples the cost of the sweeper's `release` — the highest-frequency call in the
system); deriving from `simulateContract` (R4 explains why not).

---

## R6 — Three distinct revert encodings, one decoder

**Decision**: one `decodeRevert()` that walks the viem error with
`err.walk((e) => e instanceof ContractFunctionRevertedError)` and handles all three
shapes below, mapping to the typed errors in
[contracts/errors.md](./contracts/errors.md).

**Rationale**: reverts arrive in three different encodings, and a decoder that knows
only one produces "execution reverted" for the other two.

| Source | Encoding | Example | Read from |
| --- | --- | --- | --- |
| The escrow's own preconditions | `require` string | `"not delivered"`, `"agent inactive"` | `err.reason` |
| OpenZeppelin AccessControl v5 | custom error | `AccessControlUnauthorizedAccount(account, role)` | `err.data.errorName` |
| The settlement token, bubbled through `SafeERC20` | custom error **not in the escrow ABI** | `ERC20InsufficientAllowance(spender, allowance, needed)` | requires the ERC-20 error ABI |

The third is the trap. `SafeERC20._callOptionalReturn` re-reverts with the token's
own return data, so an `openDeal` with no allowance surfaces an `ERC20…` error that
`escrowAbi` cannot decode — it will decode as raw, unnamed data. Fix: include the
ERC-20 error entries in the ABI passed to the decode for `openDeal`. Verified against
the compiled artifact — the escrow ABI declares only `AccessControlBadConfirmation`,
`AccessControlUnauthorizedAccount`, and `SafeERC20FailedOperation`; every `ERC20…`
error comes from the token.

R10 makes this mostly moot for the common case by checking allowance up front, but
the decoder still has to be right for the case where the allowance is drained between
the check and the write.

---

## R7 — A confirmation timeout is a third outcome, not a failure

**Decision**: `waitForTransactionReceipt({ hash, confirmations: 1, timeout: 30_000 })`.
A `WaitForTransactionReceiptTimeoutError` becomes `ChainOutcomeUnknownError` carrying
the transaction hash. `receipt.status === 'reverted'` becomes a failure.

**Rationale**: the caller's reaction to "failed" and to "unknown" must differ, and
only this module can tell them apart. A timed-out `openDeal` reported as failed
invites the purchase saga to retry, and the retry opens a **second on-chain deal for
the same order** — precisely what invariant #1 in
[CONTEXT.md](../../docs/CONTEXT.md) exists to prevent. The hash travels with the
error so the caller can reconcile later instead of guessing.

`confirmations: 1` is enough: Monad produces 300 ms blocks with the sub-second
finality the product design already assumes. 30 s is roughly 100 blocks — generous
enough that a timeout means something is genuinely wrong, short enough not to hang a
request.

`status === 'reverted'` is a separate branch because a mined revert is a real
failure whose gas has already been charged in full. Treating "it was included" as
success is the classic version of this bug.

---

## R8 — `nonceManager` on both signing accounts

**Decision**: construct both signing accounts as
`privateKeyToAccount(key, { nonceManager })` using viem's exported `nonceManager`.

**Rationale**: the operator has two independent senders — the purchase saga and the
sweeper cron, which
[CONTEXT.md](../../docs/CONTEXT.md) §3 says "fires constantly". With viem's default
behaviour each write independently fetches the pending nonce; two overlapping writes
fetch the *same* nonce, and the second replaces the first in the mempool. One
transaction silently disappears, and it is a money-moving one. `nonceManager` keeps
an in-process counter per account and hands out distinct nonces.

This is the mechanism behind the spec's assumption that "the operator submits
transactions one at a time" — rather than relying on that being true, we make
overlap harmless.

**✅ Verified** against viem 2.55.11: `nonceManager` is exported from the root entry,
from `viem/accounts`, from `viem/nonce`, and from `viem/utils` — all four re-export
`./utils/nonceManager.js`. The import below type-checks:

```ts
import { privateKeyToAccount, nonceManager } from 'viem/accounts'
```

**Alternatives considered**: an application-level mutex around operator writes
(serialises the sweeper behind every purchase, and only works within one process);
doing nothing (the failure is silent and intermittent — the worst combination to
debug during a demo).

---

## R9 — `toBaseUnits` / `fromBaseUnits`, and the guards that make them safe

**Decision**:

```
toBaseUnits(cents: number): bigint      // BigInt(cents) * 10_000n
fromBaseUnits(base: bigint): number     // Number(base / 10_000n)
```

`src/chain/units.ts` is the only file in the backend containing the number 10,000 in
this role, or the token's decimal count.

**Rationale**: the scale is `10^(tokenDecimals − centDecimals)` = `10^(6 − 2)` =
10,000. Verified on both sides: `MockUSDC.decimals()` returns 6 with a comment saying
it matches Monad testnet's settlement token, and every money column in the database
is `BIGINT` cents (002's data model).

`bigint` throughout the multiplication — the chain side must be exact and can exceed
`Number.MAX_SAFE_INTEGER` in principle. `number` on the cents side matches the
existing entity convention (002's R1 chose `number` for cents with the same
reasoning, and the two must agree or the boundary needs a third conversion).

Four guards, each catching a real class of bug:

| Guard | Catches |
| --- | --- |
| `cents` is a non-negative safe integer | a float that has already lost precision upstream |
| `base % 10_000n === 0n` | an amount that entered the escrow through a path bypassing this module |
| `base / 10_000n` within `MAX_SAFE_INTEGER` | a wrong-decimals token producing an absurd figure |
| both reject negatives | a sign error becoming a credit |

Guard 2 deliberately **throws rather than rounds**. Rounding would hide the only
evidence that a non-conforming amount exists.

**Alternatives considered**: `parseUnits`/`formatUnits` from viem (they work in
decimal *strings*, so using them means cents → string → base units, reintroducing a
text representation of money in the middle of the one function that exists to keep
money exact).

---

## R10 — Allowance is checked before every `openDeal`, topped up in bulk

**Decision**: `ensureAllowance(requiredCents)` reads
`allowance(operator, escrow)` — free — and, if short, submits one `approve` for
`ALLOWANCE_TOPUP_CENTS = 1_000_000` (**$10,000**). `openDeal` calls it first.

**Rationale**: `openDeal` does `token.safeTransferFrom(msg.sender, address(this), a.price)`,
so with no allowance **every purchase reverts** — and, as the contract's own comment
warns, "long after deployment looked successful". The spec's FR-012 puts this inside
the module for exactly that reason: an operation that cannot succeed without a
companion call has not really been wrapped.

Bulk rather than per-deal: a per-deal approval adds a second transaction, a second
gas limit, and a second failure mode to every single purchase — for a spender that
is a fixed, audited contract address.

**⚠️ Superseded in practice by the deployment.** The runbook that deployed the escrow
already granted it an effectively unbounded allowance from the operator — the live
value reads `MaxUint256 − 1_000_000`, the max approval minus the one $1 deal it then
opened. **Decision (with the project owner): accept it.** Re-approving downward would
cost a transaction to restore a bound that only matters against a contract we control
and have already deployed.

Two consequences, recorded so neither is discovered later:

1. **`ensureAllowance` still ships, but its top-up branch will not fire against this
   deployment.** It short-circuits to `null` on every call. It stays because it is
   what makes `openDeal` work against a *fresh* deployment — the next redeploy starts
   at zero allowance, and without this the first purchase reverts with an ERC-20 error
   nobody was expecting. The branch is unexercised, not dead.
2. **The `ALLOWANCE_TOPUP_CENTS = 1_000_000` ($10,000) constant is retained** as the
   value that branch would use. It is no longer describing the live allowance, and its
   comment must say so.

The original reasoning, for the record: a bounded approval means a bug in the escrow's
accounting cannot drain the operator's whole balance, and $10,000 against $1–2 deals
lasts the entire hackathon while staying far below any plausible operator balance.
That argument is unchanged; it simply lost to the cost of undoing a max approval that
was already granted.

**Alternatives considered**: approving once by hand as a deploy step (works, and it
is invisible — the first person to run against a fresh deployment loses an hour to a
revert whose message is about an ERC-20 they never called).

---

## R11 — The chain definition reads from config; the preflight warns and does not block

**Decision**: build `monadTestnet` with `defineChain` from the **existing** config
values (`MONAD_CHAIN_ID`, `MONAD_RPC_URL`, `MONAD_EXPLORER_URL`) rather than
hardcoding them. On boot, run four free reads and log warnings; never abort.

| Check | Reads | Catches |
| --- | --- | --- |
| chain id | `getChainId()` vs `MONAD_CHAIN_ID` | signing for the wrong network |
| settlement token | escrow `token()` vs `USDC_ADDRESS` | a config/deploy mismatch |
| token decimals | `decimals() === 6` | the conversion scale being wrong (R9) |
| roles | `hasRole(OPERATOR_ROLE, operator)`, `hasRole(GUARDIAN_ROLE, guardian)` | keys that will revert on first use |

**Rationale**: reading from config rather than hardcoding is not ceremony — the
values are already validated at boot by `env.schema.ts`, and two sources for the same
RPC URL is how a demo ends up pointed at two different nodes.

Warn-don't-block is the existing convention, not a new one:
`detect-placeholders.ts` already exists precisely so the service starts before the
contract is deployed, and `ESCROW_CONTRACT_ADDRESS` is a placeholder **right now**.
A blocking preflight would stop the API from booting today. Every check above fails
loudly at the first real chain call anyway; the preflight's job is to move the
diagnosis earlier, not to gate startup.

The role check doubles as R2's drift detector: an ABI copied from a stale artifact
generally fails to decode `hasRole` against the deployed bytecode.

---

## R12 — `deals(id)` returns a positional tuple; one mapper, one not-found rule

**Decision**: map the getter's 11-element tuple into a named `OnChainDeal` object in
one place. Not-found is `state === DealState.None (0)` for deals and
`owner === zeroAddress` for agents, surfaced as `DealNotFoundError` /
`AgentNotFoundError`.

**Rationale**: Solidity's auto-generated getter for a public mapping-of-struct
returns the members **positionally**, and viem types it as
`readonly [bigint, Address, Address, bigint, Hex, number, bigint, bigint, bigint, number, number]`
— verified against the compiled ABI. Every field is therefore addressed by index at
the call site, and `deal[6]` vs `deal[7]` is `openedAt` vs `deliveredAt`: two
same-typed timestamps whose confusion produces a plausible-looking wrong answer.
Mapping once, in a file whose only job is that mapping, is the containment.

The not-found rule is the contract's own design, stated in its comments: ids start at
1 so that a lookup on an unknown id returns a zero-filled struct. Without an explicit
check, `deals(99999)` returns a deal that looks `None`-state, zero-amount, and
`address(0)`-partied — which FR-020 requires we distinguish from a real record.

---

## R13 — One `Tier` mapping table, both directions

**Decision**: an exhaustive bidirectional map in `src/chain/tier.ts` between the
contract's `uint8` and the database's `VerdictTier` string enum.

**Rationale**: the two agree in order but not in name — the contract's zero value is
`NoRefund`, the database's is `none`:

| uint8 | Contract | `VerdictTier` | Refund |
| --- | --- | --- | --- |
| 0 | `NoRefund` | `none` | 0% |
| 1 | `Quarter` | `quarter` | 25% |
| 2 | `Half` | `half` | 50% |
| 3 | `ThreeQuarter` | `three_quarter` | 75% |
| 4 | `Full` | `full` | 100% |

Both orderings are already documented as significant — `enums.ts` warns that Postgres
sorts by declared order, and the contract's `_refundBps` comment says an off-by-one
"would be invisible until a live demo and is the exact number an audience watches".
An explicit table with a `Record<VerdictTier, number>` type means adding a tier to
either side fails to compile until both are updated. Passing the enum's numeric index
implicitly would make the two orderings a coincidence that must be maintained by
memory.

---

## R14 — `tsconfig.json` needs no change; viem resolves under `node10`

**Decision**: **no change to `api/tsconfig.json`.** The concern below was investigated
and does not apply.

**The concern**: `tsconfig.json` sets `"module": "commonjs"` and omits
`moduleResolution`, which defaults to the legacy `node10` algorithm. `node10` does not
understand the `exports` field, and viem 2.x declares all 28 of its subpaths there —
so `import { privateKeyToAccount } from 'viem/accounts'` looked likely to fail with
`Cannot find module`, an error that reads as a missing install rather than a
resolution-mode problem. There is no root-entry workaround: `privateKeyToAccount` is
not exported from `viem` itself.

**Why it does not apply**: viem still ships **legacy directory stubs** alongside the
`exports` map. `node_modules/viem/accounts/package.json` contains:

```json
{ "type": "module", "types": "../_types/accounts/index.d.ts",
  "module": "../_esm/accounts/index.js", "main": "../_cjs/accounts/index.js" }
```

`node10` resolves through exactly that `main`/`types` pair, which is what the stubs
exist for. Same for `chains/`, `utils/`, and `nonce/`.

**Verified empirically**, not reasoned about: viem 2.55.11 installed in a throwaway
project with `compilerOptions` copied from `api/tsconfig.json`, importing
`privateKeyToAccount` and `nonceManager` from `viem/accounts` and `createPublicClient`,
`createWalletClient`, `defineChain`, `http`, `parseEventLogs` from `viem`.
`tsc --noEmit` is clean, with a deliberate type error in a sibling file confirming the
check actually ran.

Recorded rather than deleted because the reasoning is sound and would be re-derived by
the next person to read viem's `package.json`. If viem 3.x drops the stubs — which is
the obvious thing for a major to do — this becomes live again, and the fix is
`"module": "node16"` with `"moduleResolution": "node16"`, which changes resolution
without changing output (no `"type": "module"` means every file stays CommonJS).

---

## R15 — Module shape: three services, three ABIs, one narrow one

**Decision**: `src/chain/` as a Nest module exporting three services, with the
guardian's client and ABI in files of their own.

```
EscrowReadService       publicClient    escrowAbi           reads only
EscrowOperatorService   operatorClient  escrowOperatorAbi   everything but resolve
EscrowGuardianService   guardianClient  escrowResolveAbi    resolve, and nothing else
```

**Rationale**: FR-003's guarantee — that signing an `openDeal` with the guardian key
is a compile error — is produced by `escrowResolveAbi` being a one-entry `as const`
array. viem infers the permitted `functionName` union from that array, so
`guardianClient.writeContract({ functionName: 'openDeal' })` fails to type-check.

**Verified empirically** against viem 2.55.11 under this project's compiler options,
because the entire security claim rests on it. A one-entry `resolve` ABI, a real
`createWalletClient`, and a `writeContract` call naming `openDeal` produces:

```
error TS2322: Type '"openDeal"' is not assignable to type '"resolve"'.
```

The same call naming `resolve` compiles. The narrowing is real, and it is the
`as const` that does the work — without it the ABI widens to `string` and the check
silently disappears.

This only holds if nothing else is reachable, hence FR-005: the clients are
`private readonly` inside their services and never exported. A single `ChainService`
holding all three clients would put the escape hatch one property access away.

`escrowOperatorAbi` is likewise narrowed — it omits `resolve`, satisfying FR-004's
converse. Both narrow ABIs are derived by hand from `escrowAbi` rather than filtered
at runtime, because a runtime `.filter()` produces a value whose *type* is still the
full union, which loses the entire property.

`withdraw()` is deliberately **absent** from the operator's surface. Called by the
operator it pays the operator, which is the exact bug `withdrawFor` was added to
prevent (smart-contract §4.5). Omitting it makes that unavailable rather than
discouraged. This is the one place the module knowingly does not wrap "every escrow
function" (FR-007), and it is recorded here so the omission reads as a decision.

---

## R16 — The deployed escrow, verified against this plan

**Decision**: build against the live deployment at
`0xe1b74F8dB511247786Ef61bde9330198a1929d53`, and treat the facts below as fixtures
rather than assumptions.

**Rationale**: the plan was written before the contract existed. Every assumption in
it that could be checked against the chain has now been checked — with read-only
calls, no signing — and the ABI transcribed in R2 decodes correctly against the
deployed bytecode, which is the strongest available evidence that R2's copy is faithful.

| Check | Result |
| --- | --- |
| chain id | `10143` ✅ matches `MONAD_CHAIN_ID` |
| escrow `token()` | `0x534b…43A3` ✅ matches `USDC_ADDRESS` |
| token `decimals()` | `6` ✅ — R9's `10_000` scale is correct |
| `hasRole(OPERATOR_ROLE, operator)` | ✅ |
| `hasRole(GUARDIAN_ROLE, guardian)` | ✅ |
| guardian holds `OPERATOR_ROLE` | ❌ correctly **not** granted |
| operator holds `GUARDIAN_ROLE` | ❌ correctly **not** granted |
| `deals(999999)` | returns `state = 0 (None)` ✅ — R12's not-found rule holds |
| `DELIVERY_DEADLINE` / `DISPUTE_DEADLINE` | `86400s` / `259200s` ✅ |

**Three facts that change what the verification steps should expect:**

1. **The chain is not fresh.** `nextAgentId = 2` and `nextDealId = 2` — the runbook ran
   a full lifecycle smoke test. Agent 1 exists (owner = funder, price $1.00, v1,
   active) and deal 1 exists in state `Settled`. A newly registered agent is therefore
   **id 2, not id 1**, and any quickstart output claiming otherwise is wrong.

   This is a gain, not a nuisance: agent 1 and settled deal 1 are real fixtures for
   verifying the read path and the R12 tuple mapper, which previously had nothing to
   read.

2. **The operator holds $20.00 USDC** (minted by the project owner), and the funder
   still holds its own $20.00. Both `openDeal` preconditions now pass — balance ≥ price
   and allowance ≥ price — so the operator can fund 20 deals at $1.00. **No blocker.**

   Recorded because it was briefly wrong in this document: the operator started at
   $0.00, and `openDeal` does `safeTransferFrom(msg.sender = operator, …)`, so every
   `openDeal` reverted with `ERC20InsufficientBalance` regardless of the allowance —
   the allowance and the balance are independent preconditions and it is easy to check
   only the first.

   An earlier draft here claimed the token was "not mintable", on the evidence that
   simulating `mint` from the operator and funder keys reverted. That evidence only
   showed *those two keys* cannot mint; a minter or owner key exists and was used.
   The correction matters for the next person who needs test USDC: **minting is
   available to the right key** — do not conclude from a reverted simulation that no
   path exists.

3. **`eth_getLogs` is capped at a 100-block range** on the public RPC
   (`https://testnet-rpc.monad.xyz`), which returns error `-32614`. This feature does
   not read event history — R3 parses logs from a receipt it already holds, which is
   unaffected — but any later reconciliation-from-events work must page in 100-block
   chunks. Recorded here because the limit is not in Monad's docs and costs an hour to
   rediscover.
