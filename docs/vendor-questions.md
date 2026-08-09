# Questions for Rain and Monad

Carry this over. Every question below is one **only they can answer** — the docs
either don't say, or say something we need confirmed. Each has *why it matters* and
*what we do with the answer*, so a "no" is as useful as a "yes".

Ordered within each section by how much the answer changes.

**Last updated**: 2026-08-08

---

## Rain

### R1. ~~Monad as a payment-route rail?~~ ❌ **NO — not supported, not planned**

**Ask this one first.** The published rails are ethereum, polygon, optimism,
arbitrum, avalanche, base, celo, solana. Our escrow is on **Monad**, so today the
onramp physically cannot deliver into it.

- **If yes / soon** → deletes our biggest compromise. Rain→Monad becomes one
  end-to-end flow instead of two half-connected rails, and we drop a caveat we'd
  otherwise have to say on stage.
- **If no** → we keep the operator-mirrored credit: onramp lands USDC on Base, our
  operator credits Monad. Works, but it's a *trusted mirror*, not a bridge, and
  we'll describe it that way.

*Roadmap question — the docs will never answer it. This is the one worth using the
in-person access on.*

### R2. ~~Is our trial sandbox key KYC-cleared?~~ ✅ **YES**

Route creation can fail with *"Team has not completed KYC verification"* /
*"incomplete compliance data"*. We haven't made a live call yet.

- **If cleared** → onramp work starts immediately.
- **If not** → tell us the unblock path, or we fall back to crypto-only funding and
  Rain features less prominently in the demo.

### R3. ~~One platform-level `userId` for all routes?~~ ✅ **YES**

We were issued **one Team ID and one User ID**, and we're planning to use that one
`userId` for every end user's route, distinguishing them by destination address.

- **If fine** → no per-user Rain provisioning at all; registration is just a wallet
  connect. *(This is what we've built the schema around.)*
- **If routes collide, or compliance expects one user per human** → we need a
  per-user creation step and a `rain_user_id` column back in the database.

### R4. In sandbox, what does destination rail `base` actually mean? 🟠

Base mainnet or Base Sepolia? And after `POST /simulate/payment-routes`, **where do
the USDC actually appear** — at `depositAddress`, or at the destination address we
specified?

Determines what we watch to confirm a deposit landed, and whether we can see it in a
block explorer during the demo.

### R5. Can we detect deposits by polling instead of webhooks? 🟠

We'd rather not expose a public URL from a laptop. Plan: poll
`GET /issuing/transactions?type=transfer`.

- **How soon after `/simulate` does the record appear?** (we poll every 15s)
- **Is there a better endpoint** for "transfers against this payment route"?
- Any rate-limit concern polling every 15s for a few hours?

### R6. What is the Collateral Contract ID we were issued for? 🟡

It came with our credentials but doesn't appear in the payment-routes docs. We
suspect it belongs to card issuing — which we've cut. Just want to know whether
we're ignoring something we shouldn't.

### R7. Offramp in sandbox — can Payment Accounts be faked? 🟡

Offramp needs a Payment Account (bank details). Can that be created with dummy data
in sandbox, or does it need something real?

Offramp is our stretch goal; if it's cheap we'll do it, if it needs real banking
we'll drop it and say so.

### R8. (In reserve) Can scoped cards be exercised end-to-end in sandbox? 🟡

We've **cut agent buyers** for the MVP, so this isn't blocking — but if we restore
them, can a card with `amountInUSDCents` actually authorize against simulated funds,
end to end? And does the documented **1.2× authorization ceiling** apply in sandbox
too?

---

## Monad

### M1. ~~Canonical test USDC on Monad Testnet?~~ ✅ **YES** — `0x534b2f3A21130d7a60830c2Df862319e593943A3`

**The biggest unknown on the Monad side.** Our whole escrow settles in a
USDC-like ERC-20 with 6 decimals. We have a third-party address we don't trust.

- **If canonical + faucet exists** → use it, and the demo settles in something
  recognisable.
- **If not** → we deploy our own mock ERC-20 and mint freely. Simpler, actually —
  but we need to know *now*, because it changes `USDC_ADDRESS` and how we fund test
  accounts.

### M2. ~~Chain ID, RPC, explorer~~ ✅ **CONFIRMED** — 10143 · `testnet-rpc.monad.xyz` · `testnet.monadvision.com`

We have chain **10143**, `testnet.monadscan.com`, faucet at `faucet.monad.xyz` —
all from a third-party source, none verified.

Also: **is there a public RPC**, or should we use a provider? And what are the rate
limits? We poll fairly hard during the demo (see M4).

### M3. Faucet limits — MON per request, and cooldown? 🟠

We need gas for: contract deployment (a few attempts), ~20 seed transactions, and
maybe 50–100 transactions across rehearsals and the live run.

If the faucet is stingy or rate-limited, we need to know before the night before.

### M4. ~~Block time and finality?~~ ✅ **SUB-SECOND**

This shapes how the demo *feels*, not just whether it works.

Our review-window countdown and auto-release depend on transactions confirming
promptly — we poll the chain every ~3s and the UI every ~1s.

- **If confirmation is ~1–2s** → the demo feels instant, no changes.
- **If it's 10s+** → we add optimistic UI states so the screen isn't frozen while a
  transaction settles.

Related: **any RPC rate limits** we'd hit with a 3s sweeper plus per-second UI
polling?

### M5. Any `block.timestamp` caveats under parallel execution? 🟠

Our escrow's entire time model is `block.timestamp` comparisons — review window,
delivery deadline, dispute deadline. On most chains validators have a few seconds of
latitude, which is fine for us; we just want to know if Monad's execution model
introduces anything unusual.

**Concretely: is a ~30-second review window safe on stage**, or should we keep it
above some floor?

### M6. Solidity version and EVM feature parity? 🟡

We're on `pragma ^0.8.24` with OpenZeppelin `AccessControl` and `SafeERC20`. We
expect full parity, but: any unsupported opcodes, gas-metering differences, or a
recommended compiler/EVM target for testnet?

### M7. ~~Contract verification on the explorer?~~ ✅ **AVAILABLE — and done**

> **The in-person answer was wrong.** We were told verification wasn't available;
> Monad's docs said otherwise, and the docs were right. It works via **Sourcify**
> (not an Etherscan-style API), returned `exact_match` on the first attempt, and
> needed no config changes. Worth remembering that a verbal "no" from a busy person
> at a hackathon is worth one cheap test before being believed.

Hardhat or Foundry — is either better supported? And **can we verify the contract on
the explorer?**

Verified source matters more than usual for us: the demo shows a transaction hash on
the verdict card, and a judge clicking through to *readable, verified* escrow code is
a much stronger proof than an unverified blob.

### M8. Anything that commonly bites first-time Monad deployers? 🟡

Open-ended, and often the most valuable question in the room.

---

## Priority legend

🔴 **Blocking or architecture-changing** — R1, R2, M1, M2
🟠 **Changes the plan or the build order** — R3, R4, R5, M3, M4, M5
🟡 **Good to know** — R6, R7, R8, M6, M7, M8

If there's only time for four: **R1, R2, M1, M2.**

---

## Status after the first conversation

**Answered:** R1 ❌ · R2 ✅ · R3 ✅ · M1 ✅ · M2 ✅ · M4 ✅ · M7 ✅ *(the verbal no was wrong — see M7)*

**R1's answer changed the plan: Rain is now stubbed entirely** — see
[rain-integration.md](./rain-integration.md) §0. R4–R8 are therefore moot unless a
Monad rail appears.

**Still worth asking (Monad only — the Rain ones are moot now):**

| | |
| --- | --- |
| M3 | Faucet limits — MON per request, cooldown |
| M5 | `block.timestamp` caveats under parallel execution |
| M6 | Solidity / EVM parity for `^0.8.24` + OpenZeppelin |
| M8 | Anything that commonly bites first-time Monad deployers |
