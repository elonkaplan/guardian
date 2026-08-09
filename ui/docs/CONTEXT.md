# `ui/` — Context Briefing

Everything needed to build the frontend. Read this first; the root docs have the
detail.

**Root docs that matter here:**

| Doc | Why |
| --- | --- |
| [`../../docs/ui-design.md`](../../docs/ui-design.md) | **The specification.** Pages, flows, page→endpoint map, polling. |
| [`../../docs/api-design.md`](../../docs/api-design.md) | The endpoints being called |
| [`../../docs/product-workflow.md`](../../docs/product-workflow.md) | §5 the demo acts — what has to be visible on screen |
| [`../../docs/project-structure.md`](../../docs/project-structure.md) | §3.2 Docker · §5.3 viem/wagmi |

---

## 1. What this component is

React + TypeScript + Vite. Eight pages, one of which is the demo.

**Order Detail is the product on screen.** Both acts play out on it: delivery
arrives, a window counts down, a complaint is filed, Guardian rules, escrow splits —
without navigating away. Every other page exists to get you there, and design budget
should follow.

## 2. What the frontend does *not* do

- **Never holds a private key.** The wallet signs one thing: the auth nonce.
- **Never calls the escrow contract.** Every chain write goes through the operator,
  server-side.
- **Never sees a seller's `system_prompt`.** The API redacts it; the UI shouldn't
  have a code path that would render one.

Natural places to over-build. Don't.

## 3. Six things that must be visible

These are the demo's actual argument, and they're all UI responsibilities:

1. **Acceptance criteria beside the output.** The buyer wrote them before any work
   happened; side by side is what lets the audience judge before Guardian does.
2. **The countdown**, computed client-side from
   `delivered_at + review_window_seconds`. When it hits zero the sweeper releases and
   the page flips on its own — nobody clicks anything.
3. **The verdict card** — tier, reasoning, and citations **as a ✓/✗ checklist**.
   Prose alone reads as "the AI decided"; a checklist reads as "here is the clause."
4. **The transaction hash**, linked to MonadVision. Proof the money moved.
5. **Two money numbers, never one** — available balance and settled funds are
   different things with different exits. Collapsing them makes the ledger look
   broken.
6. **Where the money came from** — "funded from the demo treasury" on the Wallet
   page. A judge seeing "$100 added" with no bank transfer will wonder.

## 4. Conventions

| | |
| --- | --- |
| Updates | **Polling.** No SSE, no websockets. Order Detail 1s while live, stop on terminal state; Wallet and My Orders 5s. |
| Wallet | **wagmi** (React hooks over viem) for connection and signing |
| viem | **≥ 2.40.0** — Monad's stated floor |
| Env | Only `VITE_`-prefixed vars reach the browser. That's the guardrail keeping `OPERATOR_PRIVATE_KEY` out of the bundle. |
| Schemas | Raw JSON textareas on Create Agent — no schema builder |

## 5. Out of scope

Agent-buyer UI (deferred) · onramp/offramp route UI (Rain is stubbed) · SSE ·
pagination · responsive/mobile polish beyond what a demo laptop needs · i18n ·
schema builders.

## Automated tests — out of scope

**No unit, integration, or e2e tests in this component.** Time-boxed MVP decision:
the only test suite we keep is the escrow contract's (`sc/` SC-02), because a
contract bug means money moving wrong and costs a redeploy to fix.

**Acceptance criteria in these specs are therefore verified by hand.** Which makes
the demo rehearsal the real test suite — run all three acts end to end more than once,
and treat a failed rehearsal the way you'd treat a red build.
