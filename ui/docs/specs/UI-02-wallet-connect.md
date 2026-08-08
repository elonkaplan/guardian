# UI-02 — Wallet connect & session

**Component:** `ui/` · **Depends on:** UI-01 · **Size:** Medium

> **Feed this file to `/speckit-specify`.** Read [`../CONTEXT.md`](../CONTEXT.md)
> first — it carries the frontend conventions and the six things that must be visible.

## Goal

Connect a wallet — which is the **entire** registration flow.

## In scope

- wagmi + viem, `monadTestnet` chain definition (id 10143, MonadVision explorer)
- Connect button → `POST /auth/nonce` → sign → `POST /auth/verify` → JWT
- Session persistence across reloads; auth guard on protected routes; disconnect
- Wrong-network detection with a switch prompt

## Out of scope

**Automated tests of any kind** (MVP decision — see `../CONTEXT.md`). Plus:

Any contract interaction, transaction signing beyond the auth nonce, key storage.

## Acceptance

- Connecting produces an authenticated session that survives a page reload
- Disconnect clears it
- Being on the wrong network is detected and offers a switch

## Watch out for

- **The wallet signs exactly one thing: the auth nonce.** Every chain write goes
  through the operator, server-side. The UI never calls the escrow contract — a
  natural place to over-build.
- **No passwords, no email, no Rain provisioning.** Keep the screen as simple as
  that fact.
- viem must be **≥ 2.40.0** — Monad's stated floor.

## Source

`../../../docs/ui-design.md` §3 Flow A · `../../../docs/api-design.md` §7.
