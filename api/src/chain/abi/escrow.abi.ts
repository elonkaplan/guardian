/**
 * ABI for the GuardianEscrow contract, transcribed by hand from the build
 * artifact at:
 *
 *   sc/out/GuardianEscrow.sol/GuardianEscrow.json
 *
 * Regenerate the source artifact with:
 *
 *   cd ../sc && forge build
 *
 * Then re-run this file's generator (or re-transcribe) if the contract's
 * public interface has changed.
 *
 * WHY THIS IS COPIED RATHER THAN IMPORTED FROM `sc/out/`:
 *   1. `sc/out/` is gitignored, so importing from it directly would make
 *      the API build depend on a local `forge build` having already run.
 *      That works on a dev machine that happens to have run it, but fails
 *      on any other machine — a fresh clone, CI, or a Docker build — where
 *      `sc/out/` simply doesn't exist yet.
 *   2. `api/tsconfig.json` sets `"rootDir": "./src"`, so nothing outside
 *      `src/` can be compiled in at all; a path outside the API package
 *      (like `../sc/out/...`) is not a legal import target regardless of
 *      the gitignore issue above.
 *
 * `as const` on the exported array is REQUIRED for viem's type inference
 * (it narrows literal `type`/`name`/`stateMutability` fields instead of
 * widening them to `string`) and MUST NEVER BE REMOVED — without it,
 * viem's `readContract`/`writeContract`/event-decoding types silently
 * degrade to `any`-ish shapes and downstream type safety is lost.
 *
 * Deployed escrow contract address: 0xe1b74F8dB511247786Ef61bde9330198a1929d53
 * This ABI has been verified to decode correctly against that deployment's
 * bytecode.
 */
export const escrowAbi = [
  {
    type: "constructor",
    inputs: [
      {
        name: "_token",
        type: "address",
        internalType: "contract IERC20",
      },
      {
        name: "admin",
        type: "address",
        internalType: "address",
      },
      {
        name: "operator",
        type: "address",
        internalType: "address",
      },
      {
        name: "guardian",
        type: "address",
        internalType: "address",
      },
    ],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "DEFAULT_ADMIN_ROLE",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "DELIVERY_DEADLINE",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "uint32",
        internalType: "uint32",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "DISPUTE_DEADLINE",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "uint32",
        internalType: "uint32",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "GUARDIAN_ROLE",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "OPERATOR_ROLE",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    stateMutability: "view",
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
    name: "agents",
    inputs: [
      {
        name: "",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    outputs: [
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
      {
        name: "version",
        type: "uint32",
        internalType: "uint32",
      },
      {
        name: "active",
        type: "bool",
        internalType: "bool",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "balances",
    inputs: [
      {
        name: "",
        type: "address",
        internalType: "address",
      },
    ],
    outputs: [
      {
        name: "",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "deals",
    inputs: [
      {
        name: "",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    outputs: [
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
        name: "seller",
        type: "address",
        internalType: "address",
      },
      {
        name: "amount",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "defHash",
        type: "bytes32",
        internalType: "bytes32",
      },
      {
        name: "defVersion",
        type: "uint32",
        internalType: "uint32",
      },
      {
        name: "openedAt",
        type: "uint64",
        internalType: "uint64",
      },
      {
        name: "deliveredAt",
        type: "uint64",
        internalType: "uint64",
      },
      {
        name: "disputedAt",
        type: "uint64",
        internalType: "uint64",
      },
      {
        name: "reviewWindow",
        type: "uint32",
        internalType: "uint32",
      },
      {
        name: "state",
        type: "uint8",
        internalType: "enum GuardianEscrow.DealState",
      },
    ],
    stateMutability: "view",
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
    name: "getRoleAdmin",
    inputs: [
      {
        name: "role",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    outputs: [
      {
        name: "",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "grantRole",
    inputs: [
      {
        name: "role",
        type: "bytes32",
        internalType: "bytes32",
      },
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
    type: "function",
    name: "hasRole",
    inputs: [
      {
        name: "role",
        type: "bytes32",
        internalType: "bytes32",
      },
      {
        name: "account",
        type: "address",
        internalType: "address",
      },
    ],
    outputs: [
      {
        name: "",
        type: "bool",
        internalType: "bool",
      },
    ],
    stateMutability: "view",
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
    name: "nextAgentId",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "nextDealId",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    stateMutability: "view",
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
    name: "renounceRole",
    inputs: [
      {
        name: "role",
        type: "bytes32",
        internalType: "bytes32",
      },
      {
        name: "callerConfirmation",
        type: "address",
        internalType: "address",
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "resolve",
    inputs: [
      {
        name: "dealId",
        type: "uint256",
        internalType: "uint256",
      },
      {
        name: "tier",
        type: "uint8",
        internalType: "enum GuardianEscrow.Tier",
      },
      {
        name: "verdictHash",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "revokeRole",
    inputs: [
      {
        name: "role",
        type: "bytes32",
        internalType: "bytes32",
      },
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
    name: "supportsInterface",
    inputs: [
      {
        name: "interfaceId",
        type: "bytes4",
        internalType: "bytes4",
      },
    ],
    outputs: [
      {
        name: "",
        type: "bool",
        internalType: "bool",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "token",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "address",
        internalType: "contract IERC20",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "totalEscrowed",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "uint256",
        internalType: "uint256",
      },
    ],
    stateMutability: "view",
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
    name: "withdraw",
    inputs: [],
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
    name: "AgentUpdated",
    inputs: [
      {
        name: "agentId",
        type: "uint256",
        indexed: true,
        internalType: "uint256",
      },
      {
        name: "version",
        type: "uint32",
        indexed: false,
        internalType: "uint32",
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
  {
    type: "event",
    name: "Delivered",
    inputs: [
      {
        name: "dealId",
        type: "uint256",
        indexed: true,
        internalType: "uint256",
      },
      {
        name: "at",
        type: "uint64",
        indexed: false,
        internalType: "uint64",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "Disputed",
    inputs: [
      {
        name: "dealId",
        type: "uint256",
        indexed: true,
        internalType: "uint256",
      },
      {
        name: "at",
        type: "uint64",
        indexed: false,
        internalType: "uint64",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "Reclaimed",
    inputs: [
      {
        name: "dealId",
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
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "Released",
    inputs: [
      {
        name: "dealId",
        type: "uint256",
        indexed: true,
        internalType: "uint256",
      },
      {
        name: "seller",
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
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "Resolved",
    inputs: [
      {
        name: "dealId",
        type: "uint256",
        indexed: true,
        internalType: "uint256",
      },
      {
        name: "tier",
        type: "uint8",
        indexed: false,
        internalType: "enum GuardianEscrow.Tier",
      },
      {
        name: "toBuyer",
        type: "uint256",
        indexed: false,
        internalType: "uint256",
      },
      {
        name: "toSeller",
        type: "uint256",
        indexed: false,
        internalType: "uint256",
      },
      {
        name: "verdictHash",
        type: "bytes32",
        indexed: false,
        internalType: "bytes32",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "RoleAdminChanged",
    inputs: [
      {
        name: "role",
        type: "bytes32",
        indexed: true,
        internalType: "bytes32",
      },
      {
        name: "previousAdminRole",
        type: "bytes32",
        indexed: true,
        internalType: "bytes32",
      },
      {
        name: "newAdminRole",
        type: "bytes32",
        indexed: true,
        internalType: "bytes32",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "RoleGranted",
    inputs: [
      {
        name: "role",
        type: "bytes32",
        indexed: true,
        internalType: "bytes32",
      },
      {
        name: "account",
        type: "address",
        indexed: true,
        internalType: "address",
      },
      {
        name: "sender",
        type: "address",
        indexed: true,
        internalType: "address",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "RoleRevoked",
    inputs: [
      {
        name: "role",
        type: "bytes32",
        indexed: true,
        internalType: "bytes32",
      },
      {
        name: "account",
        type: "address",
        indexed: true,
        internalType: "address",
      },
      {
        name: "sender",
        type: "address",
        indexed: true,
        internalType: "address",
      },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "Withdrawn",
    inputs: [
      {
        name: "account",
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
    ],
    anonymous: false,
  },
  {
    type: "error",
    name: "AccessControlBadConfirmation",
    inputs: [],
  },
  {
    type: "error",
    name: "AccessControlUnauthorizedAccount",
    inputs: [
      {
        name: "account",
        type: "address",
        internalType: "address",
      },
      {
        name: "neededRole",
        type: "bytes32",
        internalType: "bytes32",
      },
    ],
  },
  {
    type: "error",
    name: "SafeERC20FailedOperation",
    inputs: [
      {
        name: "token",
        type: "address",
        internalType: "address",
      },
    ],
  },
] as const;
