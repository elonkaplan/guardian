# Quickstart & Manual Validation: Wallet Connect & Session

**Feature**: 002-wallet-connect · **Date**: 2026-08-08

This component has no automated tests by explicit project decision (`ui/docs/CONTEXT.md`). Everything below is run by hand, in a browser, and **is** the acceptance criteria. Work through it in order; each part maps to one user story.

---

## Prerequisites

- The frontend from UI-01, running (`npm run dev`, default `http://localhost:5173`).
- The Guardian API running and reachable at `VITE_API_URL`, with `POST /auth/nonce` and `POST /auth/verify` implemented. **Parts B, C, and D cannot be run without it.**
- A browser wallet extension (MetaMask or similar) in the browser you are testing with, holding at least one address.
- For Part D you need a second address in the wallet. Create one now — switching accounts mid-test with only one available is the most common way to get stuck.

## Setup

```bash
cd ui
npm install          # picks up wagmi + viem
npm run typecheck    # must be clean before you start clicking
npm run dev
```

If `npm run typecheck` reports errors, stop. A type error here usually means a wagmi v3 rename (`useAccount` → `useConnection`) rather than anything about this feature.

---

## Part A — No wallet, no backend (User Story 1, offline)

Run this in a browser profile with **no wallet extension installed**, or with the extension disabled.

| # | Do | Expect | Covers |
| --- | --- | --- | --- |
| A1 | Load `/`. | The screen explains a browser wallet is required and how to get one. **No connect control that cannot work.** | FR-005 |
| A2 | Look at the console. | No errors. | — |

Re-enable the wallet extension for everything below.

---

## Part B — Connect and sign in (User Story 1, backend required)

Use an address that has **never signed in to this backend**. If you don't have one, create a fresh account in the wallet.

| # | Do | Expect | Covers |
| --- | --- | --- | --- |
| B1 | Load `/`. | A list of the wallets you actually have installed — one entry each, **no duplicates**. If you have two extensions, both appear by name. | FR-001, R4 |
| B2 | Activate one. | The wallet asks to connect. | FR-006 |
| B3 | Approve the connection. | The wallet immediately asks to **sign a message** — the message body is the nonce string. Nothing else is requested. | FR-006 |
| B4 | Approve the signature. | Signed in. The header shows the abbreviated address (`0x1234…abcd`) and a disconnect control. | FR-007, FR-033 |
| B5 | Note where you landed. | The marketplace (`/agents`), not the connect screen. | FR-023 |
| B6 | Count the prompts you approved. | **Exactly two: one connect, one sign.** Zero transaction prompts. | SC-001, SC-009 |
| B7 | Confirm no registration step appeared. | No form, no password, no email — at any point. | FR-008, SC-002 |
| B8 | Navigate back to `/` while signed in. | You are not asked to sign again; signed-in state is shown or you are moved onward. | US1 §5 |

### B9 — Failure paths, all retryable without reloading

Run each from a signed-out state (disconnect between them).

| Do | Expect | Covers |
| --- | --- | --- |
| Activate connect, then **reject** the wallet connection prompt. | Plain message naming the declined connection. Connect list still usable. Nothing stored — check `localStorage`: no `guardian.jwt`. | FR-009, FR-010 |
| Connect, then **reject** the signature prompt. | A *different* message, about the signature specifically. Still retryable. Still nothing stored. | FR-009, FR-010 |
| Stop the API, then attempt sign-in. | A message about not reaching the backend — distinguishable from both of the above. | FR-009 |
| Restart the API. Attempt sign-in and note the nonce; abandon it; sign in again. | The second attempt uses a **different** nonce. | FR-012 |
| Double-click the connect control fast. | One wallet prompt, not two. | FR-011 |

Three distinct messages, no unhandled console errors → **SC-008**.

---

## Part C — Reload survival (User Story 2, backend required)

| # | Do | Expect | Covers |
| --- | --- | --- | --- |
| C1 | Signed in, reload the page. Repeat **ten times**. | Signed in every time. **Zero** wallet prompts. No flash of the connect screen. | FR-013, SC-003 |
| C2 | Navigate to `/wallet`, reload that URL directly. | `/wallet` renders. You are not bounced to `/`. | FR-015, US2 §2 |
| C3 | **Lock the wallet extension**, then reload. | Still signed in. The header still shows your address. This is the one that proves identity is the credential, not the connection. | FR-016, R5 |
| C4 | Unlock the wallet. | Nothing changes; no prompt appears. | FR-016 |
| C5 | In devtools, corrupt `guardian.jwt` to a junk string. Reload and visit `/wallet`. | The first API call is rejected, the credential is discarded, and you land on `/`. **No redirect loop** — watch the network tab for a repeating 401. | FR-017, US2 §5 |

---

## Part D — Guards, disconnect, account change (User Story 3, backend required)

### D1 — Guarded while signed out

Disconnect first. Then visit each of these **directly by URL**:

`/orders` · `/orders/abc` · `/wallet` · `/sell` · `/sell/new`

Each must redirect to `/`. Then sign in, and confirm you land on **that** URL — not the marketplace. Five for five → **SC-004**.

### D2 — Public while signed out

Disconnect. Visit `/agents` and `/agents/xyz`. Both render fully, no sign-in prompt blocking them. Two for two → **SC-005**.

### D3 — Disconnect

| Do | Expect | Covers |
| --- | --- | --- |
| Signed in on any screen, activate disconnect. | Header returns to the signed-out state: sign-in affordance, **no money figures**. | FR-025, FR-034 |
| Check `localStorage`. | Neither `guardian.jwt` nor `guardian.address` remains. | FR-025 |
| Press browser **back**. | You do not re-enter the protected screen. No data from the previous session is visible. | FR-026 |
| Visit all five guarded URLs again. | All redirect to `/`. | FR-026 |

Six checks → **SC-006**.

### D4 — Account change

Signed in as address A, **switch to address B inside the wallet extension**.

- The session ends. You are signed out.
- **No signature prompt fires.** This is the specific bug the imperative sign-in flow exists to prevent (research R6) — if a wallet popup appears here, the implementation has an effect watching the address.
- Address A's data is not shown next to address B's address at any point.

Covers FR-018.

### D5 — Disconnect from inside the wallet

Signed in, use the extension's own "disconnect this site" control. The app returns to a signed-out state rather than continuing to show a signed-in header. Covers FR-019.

---

## Part E — Wrong network (User Story 4, no backend needed)

| # | Do | Expect | Covers |
| --- | --- | --- | --- |
| E1 | Point the wallet at a different network (Ethereum mainnet will do). Load the app. | A persistent banner naming **both** the current and the expected network, with a switch control. | FR-028 |
| E2 | Visit several screens. | The banner is on every one of them. | FR-028, SC-007 |
| E3 | Activate switch, approve in the wallet. | Banner disappears. **No page reload.** | FR-029, SC-007 |
| E4 | Switch away again, activate switch, then **decline**. | Banner stays. No error thrown at you. The screen still works. | FR-030 |
| E5 | Remove Monad Testnet from the wallet's network list entirely. Activate switch. | The wallet offers to **add** the network — with MON as the currency and MonadVision as the explorer — then switch to it. | FR-029 |
| E6 | While on the wrong network, sign in and browse. | Everything works. Sign-in is not blocked. The banner warns; it does not gate. | FR-031, US4 §6 |
| E7 | On Monad Testnet. | No banner at all. | FR-032 |

---

## Part F — The two boundaries

These are the rules that matter more than any single screen. Check them at the end, and check them again before the demo.

| # | Do | Expect | Covers |
| --- | --- | --- | --- |
| F1 | `grep -rn "signMessage" src/` | **Exactly one** call site, in `src/auth/useSignIn.ts`. | FR-003 |
| F2 | `grep -rniE "sendTransaction\|useWriteContract\|writeContract\|privateKey\|mnemonic\|seed *phrase" src/` | **Zero** hits. | FR-003, FR-004, SC-010 |
| F3 | `grep -rn "monadvision\|monadexplorer" src/` | Hits only in `src/chain/chains.ts`. | FR-027 |
| F4 | `grep -rn "useAccount\|useAccountEffect" src/` | Zero hits — those are the deprecated v2 aliases. | research R2 |
| F5 | Run the whole demo rehearsal end to end. Count wallet prompts. | Exactly **one signature**, **zero transactions**, for the entire run. | SC-009 |

---

## Sign-off

| Part | Story | Backend needed | Pass |
| --- | --- | --- | --- |
| A — no wallet | US1 | no | ☐ |
| B — connect & sign in | US1 | **yes** | ☐ |
| C — reload survival | US2 | **yes** | ☐ |
| D — guards & disconnect | US3 | **yes** | ☐ |
| E — wrong network | US4 | no | ☐ |
| F — the two boundaries | all | no | ☐ |

A failed part is a red build. The demo rehearsal is the real test suite for this component — run Acts 1 and 2 more than once, and treat a failed rehearsal the way you would treat a failing CI job.
