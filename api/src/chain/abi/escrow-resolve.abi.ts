/**
 * The guardian signing identity's ENTIRE view of the escrow contract.
 *
 * `escrow.abi.ts` is what the OPERATOR key is trusted with — the full
 * surface, because the operator legitimately needs `openDeal`, `accept`,
 * `markDelivered`, `registerAgent`, and so on. The guardian key is a
 * different trust boundary: per `docs/smart-contract.md` §3.5, the
 * `GUARDIAN_ROLE` can do exactly one thing on-chain — call `resolve` to
 * settle a disputed deal — and must not be able to do anything else, not
 * even the read-only calls the operator makes routinely. This file is that
 * boundary given a type.
 *
 * ONE ENTRY IS NOT AN OVERSIGHT OR AN OPTIMIZATION. IT IS THE SECURITY
 * PROPERTY. If the guardian's viem client is ever constructed against
 * `escrowAbi` "for convenience," the boundary is gone even though nothing
 * looks wrong in review — the contract's `onlyRole(GUARDIAN_ROLE)` checks
 * still revert unauthorized calls at the chain level, but the whole point
 * of a narrow ABI is that a mistake is caught at compile time, in this
 * repo, before a transaction is ever signed — not three network hops later
 * by someone reading a revert reason.
 *
 * viem infers the permitted `functionName` union from this array's literal
 * type. With only `resolve` present, `functionName: 'openDeal'` through a
 * client typed against `escrowResolveAbi` is a **compile error**, not a
 * code-review question:
 *
 *   error TS2322: Type '"openDeal"' is not assignable to type '"resolve"'.
 *
 * (Verified against viem 2.55.11.) The role separation from
 * `docs/smart-contract.md` §3.5 becomes structural rather than
 * aspirational — the guardian key CANNOT be made to sign `openDeal` through
 * this client, because the type system has no name for it to sign.
 *
 * ⚠️ The `as const` is what makes any of this real. Without it, the array
 * widens from a tuple of literal object shapes to a generic `Abi` /
 * `string[]`-ish type, `functionName` widens to `string`, and the whole
 * guarantee above silently disappears — the file would still look correct,
 * still export one entry, still compile, and yet no longer prove anything.
 * Never remove it.
 *
 * The one entry below is copied verbatim (including `internalType`) from
 * the `resolve` entry in `./escrow.abi.ts`, which is itself transcribed by
 * hand from `sc/out/GuardianEscrow.sol/GuardianEscrow.json`. If that
 * transcription is ever regenerated, re-copy this entry from it — do not
 * hand-edit this file out of sync with the source of truth.
 *
 * Adding ANY entry to this array widens what the guardian key can sign. If
 * a second guardian capability is ever genuinely needed, that is a
 * deliberate security decision to be made explicitly, in review, with this
 * comment updated to explain why — not a convenience edit made in passing
 * while building something else.
 */
export const escrowResolveAbi = [
  {
    type: 'function',
    name: 'resolve',
    inputs: [
      { name: 'dealId', type: 'uint256', internalType: 'uint256' },
      {
        name: 'tier',
        type: 'uint8',
        internalType: 'enum GuardianEscrow.Tier',
      },
      { name: 'verdictHash', type: 'bytes32', internalType: 'bytes32' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
] as const;
