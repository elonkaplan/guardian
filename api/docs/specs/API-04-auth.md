# API-04 — Wallet auth

**Component:** `api/` · **Depends on:** API-02 · **Size:** Small

> **Feed this file to `/speckit-specify`.** Read [`../CONTEXT.md`](../CONTEXT.md)
> first — it carries the nine backend invariants this spec assumes.

## Goal

Wallet signature in, JWT out — and account creation. This is the **entire**
registration flow.

## In scope

- `POST /auth/nonce` — `{ address }` → `{ nonce }`, short-lived, single-use
- `POST /auth/verify` — `{ address, signature }` → `{ token }`; recover the
  signer, compare, issue a JWT
- Account created on first successful verify
- JWT guard + a decorator exposing the current account
- Addresses stored checksummed, matched case-insensitively

## Out of scope

**Automated tests of any kind** (MVP decision — see `../CONTEXT.md`). Plus:

Passwords, email, roles, refresh tokens, any Rain provisioning.

## Acceptance

- A valid signature yields a token that authenticates later requests
- A second sign-in from the same wallet reuses the same account
- A signature from a different address is rejected

## Watch out for

- **No roles.** One account is both buyer and seller; ownership is checked
  per-resource, not by role.
- **Nonces must be single-use** — replaying a captured signature shouldn't work.
- The stored address is the payout address for every refund and sale. Case
  mismatches here surface much later as "my money went nowhere."

## Source

`../../../docs/api-design.md` §3.1, §7.
