# UI-04 — Order Detail (the hero page)

**Component:** `ui/` · **Depends on:** UI-03 · **Size:** Large

> ⚠️ **The demo happens here.** All three acts play out on this page.

> **Feed this file to `/speckit-specify`.** Read [`../CONTEXT.md`](../CONTEXT.md)
> first — it carries the frontend conventions and the six things that must be visible.

## Goal

One page, five faces, driven by `orders.state` — from "the agent is working" through
to a settled verdict, without navigating away.

## In scope

| State | Shows | Actions |
| --- | --- | --- |
| `purchased` / `running` | "Agent is working…", your input, elapsed time | — |
| `delivered` | Output **beside** your acceptance criteria, **countdown** | Accept · Complain |
| `failed` | "The agent returned nothing." | Complain |
| `disputed` | "Guardian is reviewing…" | — |
| `adjudicated` / `settled` | Verdict card (UI-05) | — |

- Poll `GET /orders/:id` at 1s; **stop on a terminal state**
- Countdown computed client-side from `delivered_at + review_window_seconds`
- Complain modal: reason → confirm → `POST /orders/:id/complain`
- Accept → `POST /orders/:id/accept`
- Optional: total-escrow figure in the header

## Out of scope

**Automated tests of any kind** (MVP decision — see `../CONTEXT.md`). Plus:

The verdict card itself (UI-05), seller-side views (UI-07).

## Acceptance

- An order can be watched from `running` to `released` **without a manual refresh**
- The countdown reaches zero and the page flips to `released` on its own
- Complaining moves the page to `disputed`

## Watch out for

- **The countdown is the visible proof that escrow is real.** When it hits zero the
  sweeper releases and the page flips with nobody touching the keyboard. That's Act
  1's ending — it only works if both the countdown and the poll are live.
- **Output beside criteria, always.** Act 2's whole effect is the audience counting
  rows and reaching 50% *before* Guardian announces it. Stack them vertically and
  that evaporates.
- **Stop polling on terminal states.** A laptop hammering an endpoint for an order
  that finished ten minutes ago is a needless way to look bad.

## Source

`../../../docs/ui-design.md` §2.1, §5 · `../../../docs/product-workflow.md` §5.3.
