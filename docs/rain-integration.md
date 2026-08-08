# Rain Integration — Design & Findings

**Status**: ⚠️ **Rain is stubbed for the MVP — no live calls.** See §0.
**Last updated**: 2026-08-08
**Companion docs**: [product-workflow.md](./product-workflow.md) ·
[smart-contract.md](./smart-contract.md) · [tech-stack.md](./tech-stack.md)

The vendor's own implementation guide is preserved verbatim in
[§7 Vendor reference](#7-vendor-reference-rains-own-guide). Everything above it is
our analysis of how it fits Guardian.

---

## 0. Decision: Rain is stubbed

**Confirmed with Rain: Monad is not a supported payment-route rail, and isn't
planned.** That closes R1 — the one answer that could have made the fiat leg work
end to end.

Consequence, decided by the user:

| | |
| --- | --- |
| **Onramp / offramp endpoints** | **Exist, but make no Rain call.** They log the exact request body they *would* send, then return. |
| **Funding instead comes from** | A **funder wallet** (§0.2) holding faucet-minted test USDC and MON |
| **`RAIN_ENABLED`** | `false` in `.env`. The code path is written, just not switched on. |

### 0.1 Why stub rather than delete

Three reasons, in order of how much they matter:

1. **The integration is real work that reveals a real finding.** Logging the exact
   payload means we can show *"here is the Rain call we would make, and here is why
   it cannot complete — Monad isn't a supported destination rail."* At a
   Rain-hosted hackathon, that is a more useful contribution than a half-working
   integration: it's feedback on their product from someone who tried to use it.
2. **The shape stays in the codebase.** If a Monad rail ships, this becomes a
   config flag rather than a feature.
3. **It's honest.** A stub that logs is obviously a stub. A mock that returns fake
   success is a thing you forget about and accidentally demo.

### 0.2 The funder wallet replaces the onramp

```
FUNDER wallet  (faucet-minted MON + test USDC)
     │
     │  user clicks "Add funds"
     ▼
transfer test USDC ──▶ OPERATOR pool     +   ledger credit (kind='onramp')
                                             for that user
     │
     ▼
        balance is spendable on purchases
```

- The funder wallet is **the only source of money** in the system.
- A top-up is a real on-chain transfer plus a ledger entry — so the solvency
  invariant (database-schema §3.3) still holds, and there's a transaction to point
  at if anyone asks where the money came from.
- Sub-second finality makes the per-top-up transfer cheap enough that pre-funding
  isn't necessary.
- **Three wallets need MON for gas**: funder, operator, guardian. Easy to forget the
  guardian one until the first verdict fails to settle.

### 0.3 Offramp returns money to the funder wallet

**The funder wallet is "the outside world."** Money enters the system from it and
leaves back into it, which closes the loop and keeps the mock shaped like the real
thing:

```
                 ┌──────────────────────────┐
                 │      FUNDER WALLET       │   ← stands in for the bank
                 │  faucet MON + test USDC  │
                 └────┬────────────────▲────┘
        top-up        │                │        offramp
   (money enters)     ▼                │     (money leaves)
                 ┌─────────────────────┴────┐
                 │   Guardian: balances,    │
                 │   escrow, settlements    │
                 └──────────────────────────┘
```

**This mirrors how Rain's offramp actually works.** Rain gives you a deposit
address, you send USDC to it, and fiat arrives in your bank. So:

`POST /offramp/routes` returns the **funder address as the deposit address** —
exactly the shape Rain would return — logs the Rain call it would have made, and the
user sends test USDC there. On arrival we log *"fiat would now settle to the user's
bank account."*

Two consequences worth having written down:

- **The funder wallet's balance becomes a live health check.** It should fall as
  users top up and rise as they offramp. If it drifts in one direction only,
  something is wrong.
- **⚠️ One gap this exposed:** *unspent platform balance currently has no exit.* A
  user who tops up $100 and spends $2 can only ever spend the remaining $98 — there
  is no path back out, because `withdraw` only pulls **settled** funds from the
  contract, not the Postgres ledger. Cheap fix: let `POST /offramp` also accept
  unspent balance, operator-driven (pool → funder, ledger debit, no user signature).
  Worth doing — a demo where money can enter but not leave invites the obvious
  question.

### 0.4 What this costs

**Rain now contributes no executing code to the demo.** Cards were cut with agent
buyers; onramp and offramp are stubbed. Worth saying plainly rather than discovering
it during the pitch — and worth pairing with §0.1's framing, because *"we integrated
until we hit a real limitation, and here it is"* lands considerably better than
silence about a sponsor.

The **product** still describes the fiat rails accurately (product §7.7); it's the
**implementation** that's stubbed.

---

## 1. Findings from the integration work

### 1.1 ~~Rain cannot deliver to Monad~~ → see §0

Payment-route destinations support **ethereum, polygon, optimism, arbitrum,
avalanche, base, celo, solana**. **Monad is not on the list**, confirmed with Rain
directly, and not on the roadmap. This is what drove the §0 decision.

### 1.2 ⚠️ The $2 simulation minimum breaks two of our three prices

> "Onramp and offramp simulations require a minimum amount of $2."

Our catalogue: LedgerBot **$2.00** ✅, TLDR Agent **$1.00** ❌, PolyglotAI **$1.50** ❌.

This only bites if we simulate an onramp *per purchase*. Under the top-up model
(§4) it doesn't bite at all — one $100 top-up funds many sub-$2 purchases. Another
point in favour of top-up.

If we ever do need per-purchase onramps, raise the two prices above $2.

### 1.3 ~~KYC may gate route creation~~ ✅ RESOLVED

**Our sandbox key is KYC-cleared** — confirmed directly with Rain. Route creation is
unblocked, and the biggest "invisible until the first call" risk on the Rain side is
gone.

---

## 2. Rain gives us two separate things

The vendor guide covers only Payment Routes; Guardian needs both capabilities, and
they're independent.

| Capability | What it does | Chain-bound? | Our use |
| --- | --- | --- | --- |
| **Payment Routes** | fiat ↔ USDC, via a deposit address | **Yes** — and not to Monad | Onramp (funding) and offramp (cash out) |
| **Cards** | Scoped card with a hard spend ceiling | **No** | The agent's leash (product §2.3) |

*Historical note: this section was written when both halves were in scope. **Cards
went with agent buyers, and Payment Routes are stubbed** (§0) — the analysis is kept
because it is still the accurate description of what Rain offers, and what we would
wire up first if a Monad rail appeared.*

### 2.1 Card scoping — confirmed shape

```json
{
  "amountInUSDCents": 10000,
  "expiresAt": "2026-09-01T00:00:00Z",
  "allowedMccs": ["5411"]
}
```

- `amountInUSDCents` is the only required field — **the leash, in cents**. $10.00
  limit = `1000`.
- Rain applies a **1.2× ceiling** over the stated limit to buffer authorization
  holds. Worth knowing before anyone is surprised that a $10 card authorizes $12.
- Rain also enforces **max $5,000 across all active scoped cards per user per
  rolling 24h**. Irrelevant at our prices.
- Card creation takes a `userId` path parameter — **a Rain user record must exist
  first.**

---

## 3. The user flow, as described

> *"User registers with wallet, user can start selling (all SC operations via
> Operator), buying (all SC operations via Operator). Onramp, offramp."*

```
REGISTER      connect wallet ──▶ account created (wallet = identity + payout address)
                                  (no Rain provisioning — §0)

TOP-UP        funder wallet ──▶ operator pool + ledger credit
              (Rain onramp endpoint exists but only logs — §0)

SELL          submit agent definition ──▶ operator calls registerAgent()
                                          (no wallet interaction, no gas)

BUY           choose agent + write acceptance criteria
                              └▶ operator calls openDeal()
              agent runs ──▶ operator calls markDelivered()
              accept / complain ──▶ operator calls accept() or dispute()
              Guardian rules ──▶ guardian key calls resolve()

WITHDRAW      balances[wallet] ──▶ withdraw to wallet          ⚠️ see §3.1
OFFRAMP       payment account (bank) ──▶ payment route ──▶ ACH
```

### 3.1 ⚠️ "All SC operations via Operator" breaks `withdraw()`

`withdraw()` in the current draft pays `msg.sender`. **If the operator calls it, the
money goes to the operator**, not the user.

Not an edge case — it's a direct consequence of the flow just described, and it
would silently misroute every payout.

**Fix — add a payee-explicit variant:**

```solidity
/// Pays `account`'s balance to `account`, whoever calls.
/// Permissionless: a caller can only ever pay the rightful owner.
function withdrawFor(address account) external {
    uint256 amount = balances[account];
    require(amount > 0, "nothing to withdraw");
    balances[account] = 0;
    token.safeTransfer(account, amount);
    emit Withdrawn(account, amount);
}
```

Keep `withdraw()` too, so a user *can* self-serve, but the operator path uses
`withdrawFor`. Safe to leave permissionless: the funds can only ever reach the
address they were credited to.

---

## 4. The money-flow consequence: top-up is back

This is the substantive change, and it needs a decision.

**Product §7.7 currently says:** *"There is no top-up wallet. Each purchase charges
the buyer's Rain card directly."* That was decided before we knew how Rain's onramp
works.

**But an ACH payment route is inherently a funding event.** You cannot sensibly run
an ACH deposit per $2 purchase — settlement times alone rule it out, and §1.2's $2
floor confirms it. Onramp *means* top-up.

The reconciliation that keeps everything else intact:

| Concept | Role |
| --- | --- |
| **Onramp (payment route)** | Funds the account. USDC balance. A top-up. |
| **Purchase** | Operator moves from that balance into escrow. No fiat involved. |
| **Rain card + limit** | The **agent's authority to spend**, not a separate charge |
| **Offramp (payment route)** | Balance → bank |

This resolves something that was previously muddy: **the card is the leash, the
balance is the funds.** An agent's spend limit governs how much of its owner's
balance it may commit — it is permission, not payment. Refund-restores-limit
(product §7.3) then means restoring *permission*, which is coherent and has no
accounting side effect.

**This supersedes product §7.7 if approved.** It does not touch anything else — the
escrow, the tiers, the verdicts, and all three demo acts are unaffected.

---

## 5. Decisions — all approved

| Decision | Outcome |
| --- | --- |
| **Money model** | **Top-up adopted.** Product §7.7 rewritten; §2.1 gains a funding step. Nothing else changed. |
| ~~Monad gap~~ | **Superseded by §0** — Rain confirmed no Monad rail, so the integration is stubbed rather than mirrored. |
| **`withdrawFor`** | Added to the contract spec (smart-contract §4.5). |
| **$2 minimum** | Dissolved by top-up — one $100 deposit funds many sub-$2 purchases. |

**✅ KYC is cleared.** Confirmed with Rain — our sandbox key can create payment
routes. §1.3 is closed; onramp work is unblocked.

**✅ One platform `userId` for all routes.** Confirmed — Rain identities are
platform-level, not per end-user. No per-user Rain provisioning; registration is a
wallet connect and nothing else.

That is worth more than it sounds: integration unknowns were named the single
largest risk to the demo ([discovery-notes.md](./discovery-notes.md)), and half of
that risk was *not knowing who to ask*. It is now a five-minute walk.

### 5.1 Worth asking him in person

Ordered by how much the answer would change:

1. **Is Monad supported — or planned — as a payment-route destination rail?**
   **Ask this first.** A yes deletes §1.1 outright: no operator-mirrored credit, no
   trusted-mirror caveat on stage, and a genuinely end-to-end Rain→Monad story
   instead of two half-connected rails. It is also exactly the kind of roadmap
   question only he can answer, and you get one shot at asking it.
2. **Is the trial sandbox key KYC-cleared**, or is there a step we need?
3. **Do scoped cards authorize in sandbox** without a funded balance behind them —
   i.e. can an agent's spend-limited card be exercised end to end with simulated
   money?
4. **Do simulated transfer webhooks need a registered endpoint**, or can we poll
   `GET /issuing/transactions` instead? Polling would remove the need to expose a
   public URL from a laptop.

---

## 6. Spike this before anything else

Per the solo-builder note in [discovery-notes.md](./discovery-notes.md), integration
unknowns are now the largest risk. Ordered by how badly each would hurt if
discovered late:

1. **Does the API key work at all, and is KYC pre-cleared?** `POST /payment-routes`.
   A KYC block here would reshape the entire fiat plan (§1.3).
2. **Can we create a scoped card?** `POST` with `amountInUSDCents`. This is the
   non-droppable half (§2).
3. **Does `/simulate/payment-routes` fire?** Confirms the demo can run without real
   funds.
4. **Do webhooks arrive?** The vendor notes simulated transfers fire real transfer
   webhooks — that's how the backend learns a deposit landed.

All four are throwaway scripts. The only question they answer is *does this work at
all* — which no amount of design can settle.

---

## 7. Vendor reference (Rain's own guide)

*Everything below is Rain's implementation template, preserved as provided. Note its
`Chain: base` default — that is the constraint behind §1.1.*

### Implementation Constraints

- Maintain transactional consistency across all steps.
- Treat all saved IDs as persistent state that must be captured.
- Ensure request parameters match the configuration exactly.
- Do not create duplicate resources.
- Handle API errors gracefully with appropriate error messages.

### Before Implementation

1. Review the complete API sequence below.
2. Identify dependency relationships between steps (which IDs flow where).
3. Plan an error handling strategy for each API call.
4. Then implement the complete flow.

### Configuration

- Direction: Onramp (fiat → crypto)
- User ID: (not set)
- Fiat Rail: ach
- Chain: base
- Stablecoin: usdc
- Wallet Address: 0x1234567890abcdef1234567890abcdef12345678
- Payment Route ID: (not set)
- Simulate Amount: 100
- Environment: Sandbox

### Authentication

- Base URL: https://api-dev.raincards.xyz/v1
- Every request sends the header `Api-Key: $RAIN_API_KEY`.
- JSON requests also send `Content-Type: application/json`.
- Use the Api-Key issued to your team — see /reference/authenticating-with-the-api

### State Variables

Capture these from responses and export them before running later steps:

- PAYMENT_ROUTE_ID — from POST /payment-routes response `id`
- DEPOSIT_ADDRESS — from the payment route response `depositAddress` — where funds arrive

### API Sequence

#### Step 1 — POST /payment-routes

Create the onramp route — ach deposits arrive as usdc on base.
Request body:

```json
{
  "userId": "{USER_ID}",
  "source": {
    "currency": "usd",
    "rail": "ach"
  },
  "destination": {
    "currency": "usdc",
    "rail": "base",
    "address": {
      "type": "onchain",
      "address": "0x1234567890abcdef1234567890abcdef12345678"
    }
  }
}
```

Save: PAYMENT_ROUTE_ID = response.id

#### Step 2 — GET /payment-routes/{PAYMENT_ROUTE_ID}

Read the route back — confirm the deposit address and status.

#### Step 3 — POST /simulate/payment-routes

Trigger a $100 deposit against the route without moving real funds.
Request body:

```json
{
  "paymentRouteId": "{PAYMENT_ROUTE_ID}",
  "amount": "100"
}
```

#### Step 4 — GET /issuing/transactions?type=transfer&limit=20

Find the resulting transfer transaction.

### Notes

- Every request goes to the Rain sandbox at https://api-dev.raincards.xyz/v1.
- USD is the only supported currency: the fiat side is always "usd" with rail "ach" or "wire", and the crypto side is the USD-denominated "usdc" or "rusd".
- `source`, `destination`, and `depositAddress` are immutable — to change them, delete the route and create a new one. PATCH /payment-routes/{id} only updates fees and metadata.
- Simulated transfers create real transaction records and fire the same transfer webhooks as a real deposit; no funds move.
- Onramp and offramp simulations require a minimum amount of $2.
- Onramps need no payment account — the destination is an on-chain address.
