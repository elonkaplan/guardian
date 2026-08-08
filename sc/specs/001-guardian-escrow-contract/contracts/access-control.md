# Contract: Access Control, Preconditions & Revert Reasons

**Feature**: [../spec.md](../spec.md) · **Interface**: [IGuardianEscrow.sol](./IGuardianEscrow.sol)

This table is an **interface, not documentation**. The SC-02 test suite asserts against
these exact revert strings and these exact caller restrictions; the SC-03 runbook
debugs against these strings. Changing one is a breaking change to two downstream
features.

---

## 1. Roles

| Role | Held by | Can | Cannot |
| --- | --- | --- | --- |
| `DEFAULT_ADMIN_ROLE` | Deployer (a throwaway key, discarded after deploy) | Grant and revoke the two roles below | **Touch funds or deals at all.** No admin function reads or writes a deal. |
| `OPERATOR_ROLE` | The backend | Register/update/deactivate agents, open deals, mark delivery, accept or dispute on a buyer's behalf | **Move escrowed funds anywhere.** No operator function chooses a recipient. |
| `GUARDIAN_ROLE` | The audit agent's key | Split an **already-disputed** deal between the two addresses fixed at purchase, by choosing one of five tiers | Open deals, register agents, choose an address, choose an amount, or touch a deal in any other state |

The separation is the entire point. `GUARDIAN_ROLE` is attached to an autonomous LLM,
so it holds the narrowest authority in the system: **the worst outcome from a fully
compromised Guardian key is a wrong verdict, not a drained contract.**

Roles are granted in the constructor:
`constructor(IERC20 _token, address admin, address operator, address guardian)`.

---

## 2. Caller matrix

**"Anyone"** means genuinely anyone — the buyer, the seller, the backend, an unrelated
bot, a judge in the audience. That is deliberate.

| Function | Admin | Operator | Guardian | Buyer | Seller | Anyone | Time gate |
| --- | :---: | :---: | :---: | :---: | :---: | :---: | --- |
| `registerAgent` | — | ✅ | — | — | — | — | — |
| `updateAgent` | — | ✅ | — | — | — | — | — |
| `setAgentActive` | — | ✅ | — | — | — | — | — |
| `openDeal` | — | ✅ | — | — | — | — | — |
| `markDelivered` | — | ✅ | — | — | — | — | — |
| `accept` | — | ✅ | — | ✅ | — | — | Any time while `Delivered` |
| `dispute` | — | ✅ | — | ✅ | — | — | **Only** during the review window |
| `release` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | **After** the review window lapses |
| `reclaim` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | After `DELIVERY_DEADLINE` |
| `resolve` | — | — | ✅ | — | — | — | — |
| `forceResolve` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | After `DISPUTE_DEADLINE` |
| `withdraw` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | — (pays `msg.sender` only) |
| `withdrawFor` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | — (pays the **named account** only) |
| `grantRole` / `revokeRole` | ✅ | — | — | — | — | — | — |

13 entry points plus the two inherited role-management functions — this is SC-006's
"13 of 13".

### Why three rows are open to everyone

`release`, `reclaim`, and `forceResolve` are permissionless **on purpose**. Each can
only push a deal past a deadline that has *already passed*, into the single outcome the
rules already dictate — the caller chooses nothing, gains nothing, and cannot direct a
single unit anywhere. Restricting them would hand the platform a way to strand funds by
staying silent, which is precisely the difference between escrow and custody.

`withdraw` and `withdrawFor` are likewise open, but a caller can only ever move an
account's balance **to that account**, so there is nothing to exploit.

### Three things nobody can do, in any role

1. Move escrowed funds to an address not recorded on the deal
2. Settle a deal twice, or reopen a settled one
3. Change the split the arbitrator chose, or produce a split outside the five tiers

---

## 3. Preconditions and revert reasons

Reason strings are **exact**. Keep them short — they are stored in bytecode.

| Function | Required prior state | Other preconditions | Revert reason |
| --- | --- | --- | --- |
| `registerAgent` | — | `owner != address(0)` | `"bad owner"` |
| `updateAgent` | — | `agents[id].owner != address(0)` | `"no agent"` |
| `setAgentActive` | — | `agents[id].owner != address(0)` | `"no agent"` |
| `openDeal` | — | `agent.active` | `"agent inactive"` |
| `openDeal` | — | `buyer != address(0)` | `"bad buyer"` |
| `openDeal` | — | operator has approved ≥ `price` | *(reverts inside the token)* |
| `markDelivered` | `Open` | — | `"not open"` |
| `accept` | `Delivered` | — | `"not delivered"` |
| `accept` | `Delivered` | `msg.sender == buyer \|\| hasRole(OPERATOR_ROLE)` | `"not buyer"` |
| `release` | `Delivered` | — | `"not delivered"` |
| `release` | `Delivered` | `now >= deliveredAt + reviewWindow` | `"window open"` |
| `reclaim` | `Open` | — | `"not open"` |
| `reclaim` | `Open` | `now >= openedAt + DELIVERY_DEADLINE` | `"too early"` |
| `dispute` | `Delivered` | — | `"not delivered"` |
| `dispute` | `Delivered` | `msg.sender == buyer \|\| hasRole(OPERATOR_ROLE)` | `"not buyer"` |
| `dispute` | `Delivered` | `now < deliveredAt + reviewWindow` | `"window closed"` |
| `resolve` | `Disputed` | — | `"not disputed"` |
| `forceResolve` | `Disputed` | — | `"not disputed"` |
| `forceResolve` | `Disputed` | `now >= disputedAt + DISPUTE_DEADLINE` | `"too early"` |
| `withdraw` / `withdrawFor` | — | `balances[account] > 0` | `"nothing to withdraw"` |

**Role failures revert with OpenZeppelin v5's own error**, not a string:
`AccessControlUnauthorizedAccount(address account, bytes32 neededRole)`. Tests must use
`vm.expectRevert(abi.encodeWithSelector(...))` for those, not a string match — an easy
thing to get wrong when every other revert in the contract *is* a string.

**Unknown ids need no explicit check.** Ids start at 1, so an unset id returns a
zero-filled struct whose `state` is `None` and whose `owner` is `address(0)` — every
state precondition above rejects it. `deals[0]`, `deals[999]`, and a settled deal all
fail through the same guard.

---

## 4. Effects, by function

| Function | `state` → | `totalEscrowed` | `balances` credited | Tokens moved | Event |
| --- | --- | --- | --- | --- | --- |
| `registerAgent` | — | — | — | — | `AgentRegistered` |
| `updateAgent` | — | — | — | — | `AgentUpdated` |
| `setAgentActive` | — | — | — | — | *(none)* |
| `openDeal` | `None`→`Open` | **+`amount`** | — | **IN** — `safeTransferFrom(operator, this, price)` | `DealOpened` |
| `markDelivered` | `Open`→`Delivered` | — | — | — | `Delivered` |
| `accept` | `Delivered`→`Settled` | −`amount` | seller += full | none | `Released` |
| `release` | `Delivered`→`Settled` | −`amount` | seller += full | none | `Released` |
| `reclaim` | `Open`→`Settled` | −`amount` | buyer += full | none | `Reclaimed` |
| `dispute` | `Delivered`→`Disputed` | — | — | none | `Disputed` |
| `resolve` | `Disputed`→`Settled` | −`amount` | buyer += `toBuyer`, seller += `toSeller` | none | `Resolved` |
| `forceResolve` | `Disputed`→`Settled` | −`amount` | 25/75 split | none | `Resolved` |
| `withdraw` / `withdrawFor` | — | — | account → **0** | **OUT** — `safeTransfer(account, amount)` | `Withdrawn` |

**Read the "Tokens moved" column.** Exactly two rows are not "none": one in, one out.
All four settlement paths move zero tokens — settlement is pure bookkeeping, converting
a locked claim into a withdrawable one. That is what makes settlement reentrancy-free
without a guard, and it is the single most important structural property of this
contract. If a settlement path ever grows a `transfer`, that property is gone.

`setAgentActive` is the one state-changing function with no event. That matches the
source design, which lists nine events and does not include one for it — the frontend
learns about delisting from the API, not from a log.

---

## 5. Implementation notes that the ABI does not capture

- **`withdrawFor` must be declared `public`, not `external`**, so that `withdraw()` can
  call it internally. The interface file declares it `external` because interfaces
  cannot express `public` — this is the one place where the interface and the
  implementation legitimately differ.
- **`withdraw()`'s entire body is `withdrawFor(msg.sender);`.** Do not duplicate the
  logic. A second copy is exactly how the payout-to-operator bug gets reintroduced.
- **Set `state = Settled` before crediting balances** on every settlement path. The
  ordering does not matter for reentrancy here (nothing external is called), but it
  keeps every path uniform and makes the double-settle guard obvious to a reader.
- **Both settlement helpers should re-assert the required state.** `_settleDispute`
  checking `Disputed` again after `forceResolve` already checked it is a redundant
  `SLOAD` and worth every gas unit — it means neither public entry point can be edited
  into a hole.
