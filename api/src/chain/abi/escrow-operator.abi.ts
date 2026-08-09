/**
 * The subset of `escrowAbi` (see `./escrow.abi.ts`) that the OPERATOR identity
 * is entitled to sign transactions for.
 *
 * `escrowAbi` exists so this codebase can DECODE anything the contract says —
 * every function, every event, every error, regardless of who could have
 * called what. That is the right shape for a reader. It is the wrong shape
 * for a signer: a signing identity's ABI should not just be "everything the
 * contract exposes", it should be exactly the set of calls that identity is
 * entitled to make. Handing the operator's signer the full ABI would mean
 * the type system happily offers `resolve(...)` as something the operator
 * can encode and sign, when the operator holding `GUARDIAN_ROLE` privileges
 * is a security bug, not a feature. Narrowing the ABI per role turns "the
 * operator must not call `resolve`" from a runtime permission check (which
 * only fires after a transaction is built) into something the operator's
 * client code cannot even express.
 *
 * WHY THIS IS TRANSCRIBED BY HAND RATHER THAN `escrowAbi.filter(...)`:
 * A `.filter()` over `escrowAbi` produces an array whose VALUES happen to
 * exclude `resolve`/`withdraw`/the admin functions, but whose TYPE is still
 * `typeof escrowAbi` (or a widened `Abi`) — TypeScript cannot narrow a filter
 * predicate over a tuple type into a different literal tuple type. viem's
 * `writeContract` generic inference reads the ABI's TYPE, not its runtime
 * contents, so a filtered array would still type-check a call to `resolve`
 * and only fail (or worse, silently no-op) at the RPC boundary. Filtering
 * would make the narrowing real at runtime and invisible to the compiler —
 * which is the exact property this file exists to provide. Hand-transcribing
 * means the entries literally are not here for `tsc` to see.
 *
 * INCLUDED — the 11 functions the operator signs in the normal course of
 * running the marketplace: `registerAgent`, `updateAgent`, `setAgentActive`,
 * `openDeal`, `markDelivered`, `accept`, `release`, `reclaim`, `dispute`,
 * `forceResolve`, `withdrawFor`.
 *
 * DELIBERATELY EXCLUDED:
 *   - `resolve` (FR-004): this is the guardian identity's function alone —
 *     it rules on an open dispute and pays out accordingly. The operator
 *     runs the marketplace day-to-day; it must not also be able to decide
 *     who wins a dispute against it. Leaving `resolve` out of this ABI is
 *     the converse half of that role separation — the guardian's ABI is
 *     where `resolve` belongs, and it does not belong here too.
 *   - `withdraw()` (the no-argument one) — the subtle exclusion. It pays
 *     out to `msg.sender`. If the operator's signer ever called it, every
 *     user's accumulated payout balance would be swept to the OPERATOR's
 *     own address, because `msg.sender` on that call is the operator, not
 *     whichever buyer or seller the balance was owed to. That is precisely
 *     the bug `withdrawFor(account)` was introduced to prevent (see
 *     `docs/smart-contract.md` §4.5): `withdrawFor` lets the operator pay a
 *     named account, `withdraw` lets it only ever pay itself. This is the
 *     one place this module does not simply wrap "every escrow function the
 *     operator touches" — it is a decision to make the unsafe call
 *     unavailable to the operator's client rather than merely undocumented
 *     or discouraged.
 *   - Any AccessControl admin function (`grantRole`, `revokeRole`,
 *     `renounceRole`) — role administration belongs to `DEFAULT_ADMIN_ROLE`,
 *     a separate identity from the operator entirely.
 *   - Any view function — views are read-only queries with no `msg.sender`
 *     semantics to narrow; they belong in `escrowAbi` for decoding/reading,
 *     not in a signing ABI scoped by write permission.
 *
 * INCLUDED EVENTS — `AgentRegistered`, `DealOpened`:
 * `registerAgent` and `openDeal` both declare `returns (uint256)` in
 * Solidity, which reads as though calling them hands the new id back to the
 * caller. It does not: a state-changing call submitted over JSON-RPC returns
 * only a transaction hash to an off-chain caller, never the function's
 * Solidity return value. The only place the new `agentId` / `dealId`
 * actually appears is in the event log of the mined receipt. These two
 * events are included — verbatim, including their `indexed` flags, since
 * viem's log decoder relies on which topics are indexed — so the operator's
 * write path can decode its own receipt and recover the id it just created,
 * without needing the full `escrowAbi` in scope to do it.
 *
 * `as const` is REQUIRED here for the same reason it is required on
 * `escrowAbi`: it is what makes viem infer literal `name`/`type`/
 * `stateMutability`/`indexed` fields instead of widening them to `string`/
 * `boolean`. Removing it silently degrades every `writeContract` call typed
 * against this ABI to loosely-typed `any`-ish arguments. MUST NEVER BE
 * REMOVED.
 */
export const escrowOperatorAbi = [
  {
    type: "function",
    name: "registerAgent",
    inputs: [
      {
        name: "owner",
        type: "address",
        internalType: "address",
      },
      {
        name: "price",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "defHash",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    outputs: [
      {
        name: "agentId",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "updateAgent",
    inputs: [
      {
        name: "agentId",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "price",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "defHash",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "setAgentActive",
    inputs: [
      {
        name: "agentId",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "active",
        type: "bool",
        internalType: "bool",
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "openDeal",
    inputs: [
      {
        name: "agentId",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "buyer",
        type: "address",
        internalType: "address",
      },
      {
        name: "reviewWindow",
        type: "uint32",
        internalType: "uint32",
      },
    ],
    outputs: [
      {
        name: "dealId",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "markDelivered",
    inputs: [
      {
        name: "dealId",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "accept",
    inputs: [
      {
        name: "dealId",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "release",
    inputs: [
      {
        name: "dealId",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "reclaim",
    inputs: [
      {
        name: "dealId",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "dispute",
    inputs: [
      {
        name: "dealId",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "forceResolve",
    inputs: [
      {
        name: "dealId",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "withdrawFor",
    inputs: [
      {
        name: "account",
        type: "address",
        internalType: "address",
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "event",
    name: "AgentRegistered",
    inputs: [
      {
        name: "agentId",
        type: "uint256",
        indexed: true,
        internalType: "uint256",
      },
      {
        name: "owner",
        type: "address",
        indexed: true,
        internalType: "address",
      },
      {
        name: "price",
        type: "uint256",
        indexed: false,
        internalType: "uint256",
      },
      {
        name: "defHash",
        type: "bytes32",
        indexed: false,
        internalType: "bytes32",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "DealOpened",
    inputs: [
      {
        name: "dealId",
        type: "uint256",
        indexed: true,
        internalType: "uint256",
      },
      {
        name: "agentId",
        type: "uint256",
        indexed: true,
        internalType: "uint256",
      },
      {
        name: "buyer",
        type: "address",
        indexed: true,
        internalType: "address",
      },
      {
        name: "amount",
        type: "uint256",
        indexed: false,
        internalType: "uint256",
      },
      {
        name: "defHash",
        type: "bytes32",
        indexed: false,
        internalType: "bytes32",
      },
      {
        name: "defVersion",
        type: "uint32",
        indexed: false,
        internalType: "uint32",
      },
    ],
    anonymous: false,
  },
] as const;
