# Contract: the typed error taxonomy

Nine error types and the rules that produce them. FR-010 requires six distinguishable
failure kinds; the extra three cover unit conversion and the two not-found reads.

---

## The three outcomes of a write

Every operator or guardian write ends in exactly one of these. Nothing else is
possible, and the three must stay distinguishable at the call site.

| Outcome | Condition | Result |
| --- | --- | --- |
| **Success** | receipt arrived, `status === 'success'` | returns `TxResult` |
| **Failure** | reverted (simulated or mined), or transport failed | throws a `ChainError` subclass |
| **Unknown** | receipt did not arrive within the timeout | throws `ChainOutcomeUnknownError` with `hash` |

**Unknown is not failure.** A caller that treats them alike and retries an `openDeal`
opens a second on-chain deal for one order — invariant #1 in `docs/CONTEXT.md` exists
to prevent exactly that. `ChainOutcomeUnknownError` therefore does not extend any
failure type, so `catch (e) { if (e instanceof ContractRevertError) … }` cannot
accidentally swallow it.

---

## Hierarchy

```
ChainError                       abstract; carries `operation` (the function attempted)
├── ChainConnectivityError       transport failed — endpoint unreachable, DNS, 5xx
├── ChainOutcomeUnknownError     + hash: Hex
├── ContractRevertError          + reason: string  — the escrow said no
├── InsufficientAllowanceError   operator has not approved the escrow
├── InsufficientFundsError       + address — the signing identity is out of MON
├── GasExhaustedError            the declared ceiling was too low
├── UnitConversionError          + value — a units.ts guard rejected an amount
├── DealNotFoundError            + dealId
└── AgentNotFoundError           + agentId
```

Every one carries `operation` so a log line names the function that failed without
the caller having to add it.

---

## Decoding a revert

Reverts arrive in three encodings (R6). One decoder handles all three:

```ts
const revert = err.walk((e) => e instanceof ContractFunctionRevertedError)
```

| Encoding | Source | Read from | Maps to |
| --- | --- | --- | --- |
| `require` string | the escrow's own preconditions | `revert.reason` | `ContractRevertError` (table below) |
| custom error, in `escrowAbi` | OpenZeppelin AccessControl v5 | `revert.data.errorName` | `ContractRevertError` |
| custom error, **not** in `escrowAbi` | the token, bubbled through `SafeERC20` | needs the ERC-20 error ABI | `InsufficientAllowanceError` |

The third row is the trap. `SafeERC20._callOptionalReturn` re-reverts with the
token's own return data, so a missing allowance surfaces as
`ERC20InsufficientAllowance` — an error `escrowAbi` cannot decode. The ERC-20 error
entries must be included in the ABI used to decode `openDeal` failures.

### Revert strings the escrow can produce

Transcribed from `sc/src/GuardianEscrow.sol`. Every one of these is a *legitimate
state*, not a bug — which is why the reason string has to survive into the typed
error rather than being flattened to "transaction failed".

| Reason | Raised by | Means |
| --- | --- | --- |
| `"bad owner"` | `registerAgent` | owner is the zero address |
| `"no agent"` | `updateAgent`, `setAgentActive` | agent id does not exist |
| `"agent inactive"` | `openDeal` | the agent has been delisted |
| `"bad buyer"` | `openDeal` | buyer is the zero address |
| `"not open"` | `markDelivered`, `reclaim` | wrong state |
| `"not delivered"` | `accept`, `release`, `dispute` | wrong state |
| `"not disputed"` | `resolve`, `forceResolve` | wrong state |
| `"not buyer"` | `accept`, `dispute` | caller is neither buyer nor operator |
| `"window open"` | `release` | the review window has not yet elapsed |
| `"window closed"` | `dispute` | the complaint window has already elapsed |
| `"too early"` | `reclaim`, `forceResolve` | the deadline has not yet passed |
| `"nothing to withdraw"` | `withdrawFor` | the account's balance is zero |

### Custom errors

| Error | Source | Maps to |
| --- | --- | --- |
| `AccessControlUnauthorizedAccount` | OZ AccessControl | `ContractRevertError` — the wrong key signed |
| `AccessControlBadConfirmation` | OZ AccessControl | `ContractRevertError` — unreachable here |
| `SafeERC20FailedOperation` | OZ SafeERC20 | `ContractRevertError` — token call returned false |
| `ERC20InsufficientAllowance` | the token | `InsufficientAllowanceError` |
| `ERC20InsufficientBalance` | the token | `ContractRevertError` — the operator holds no USDC |

---

## Non-revert failures

| Condition | Detection | Maps to |
| --- | --- | --- |
| RPC unreachable, transport error | viem `HttpRequestError` / `TransportError` | `ChainConnectivityError` |
| Receipt did not arrive | `WaitForTransactionReceiptTimeoutError` | `ChainOutcomeUnknownError` |
| Mined with `status === 'reverted'` | the receipt itself | `ContractRevertError` (no reason available) |
| Signer has no MON | RPC error: insufficient funds for gas | `InsufficientFundsError` |
| Declared ceiling too low | receipt reverted with `gasUsed ≈ gas` | `GasExhaustedError` |

`GasExhaustedError` is recognised by `gasUsed` being at or very near the declared
limit on a reverted receipt. It cannot be perfectly distinguished from a revert that
happened to consume everything, but the diagnosis it points at — R5's table is wrong
for this operation — is the right first thing to check, and the full limit was
charged either way.

---

## Provoking each one

FR-010 and SC-007 require every kind to be reachable and distinguishable. These are
the cheapest ways to trigger each, used by [../quickstart.md](../quickstart.md):

| Error | How to provoke |
| --- | --- |
| `ContractRevertError` | `markDelivered` a deal id that does not exist |
| `ChainConnectivityError` | point `MONAD_RPC_URL` at an unroutable host |
| `ChainOutcomeUnknownError` | set `RECEIPT_TIMEOUT_MS` to `1` for one run |
| `InsufficientAllowanceError` | `openDeal` with the allowance check bypassed |
| `InsufficientFundsError` | sign with a funded-looking but empty key |
| `GasExhaustedError` | set one `GAS_LIMITS` entry to `21_000` |
| `UnitConversionError` | `toBaseUnits(1.5)` |
| `DealNotFoundError` | `getDeal(999999n)` |
| `AgentNotFoundError` | `getAgent(999999n)` |
