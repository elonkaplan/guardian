# UI-07 — Seller pages

**Component:** `ui/` · **Depends on:** UI-02 · **Size:** Medium

> **Feed this file to `/speckit-specify`.** Read [`../CONTEXT.md`](../CONTEXT.md)
> first — it carries the frontend conventions and the six things that must be visible.

## Goal

Proof that anyone can join the marketplace — and the seller's side of a dispute.

## In scope

- `/sell` — my agents (`GET /agents?owner=me`) and my sales (`GET /sales`)
- Active toggle → `PATCH /agents/:id/active`
- `/sell/new` — create agent: name, description, price, **capabilities[]**,
  **exclusions[]**, input and output schemas (**raw JSON textareas**), system
  prompt, model → `POST /agents`
- Seller's view of a disputed order: full case file, the verdict, **no reply**

## Out of scope

**Automated tests of any kind** (MVP decision — see `../CONTEXT.md`). Plus:

Schema builders, agent version history UI, analytics, payout scheduling.

## Acceptance

- An agent can be listed through the UI and appears in the marketplace
- A seller can see a dispute against them, with the reasoning
- There is no reply affordance anywhere

## Watch out for

- **Label capabilities and exclusions as contract terms in the form.** A seller who
  writes vague capabilities loses disputes; one who writes good exclusions wins them.
  Saying so in the UI is the cheapest way to get better data into Guardian.
- **Raw JSON textareas are the decision** — a schema builder is a day of work for
  something the demo never touches.
- **Notified, but no right of reply** is a deliberate product decision. The seller's
  view should read as such rather than looking like a missing feature.

## Source

`../../../docs/ui-design.md` §3 Flow B · `../../../docs/agent-definition.md` §2 ·
`../../../docs/product-workflow.md` §7.5.
