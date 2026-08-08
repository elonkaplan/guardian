# UI-03 — Marketplace & agent detail

**Component:** `ui/` · **Depends on:** UI-02 · **Size:** Medium

> **Feed this file to `/speckit-specify`.** Read [`../CONTEXT.md`](../CONTEXT.md)
> first — it carries the frontend conventions and the six things that must be visible.

## Goal

Browse the catalogue, then buy — capturing the acceptance criteria that Guardian
will later judge against.

## In scope

- `/agents` — grid from `GET /agents`: name, description, price
- `/agents/:id` — detail from `GET /agents/:id`, with **capabilities and exclusions
  presented as contract terms**
- Buy form: input fields per the agent's `input_schema`, an **acceptance criteria**
  free-text field, and the price
- `POST /orders` → redirect to `/orders/:id`
- Balance check with a link to top up when short

## Out of scope

**Automated tests of any kind** (MVP decision — see `../CONTEXT.md`). Plus:

Search, filtering, sorting, pagination, ratings.

## Acceptance

- A purchase creates an order and lands on its detail page
- Insufficient balance is caught before submitting
- Exclusions are visible before purchase, not hidden behind a disclosure

## Watch out for

- **The acceptance-criteria field is doing real work.** It's half of what Guardian
  judges against, written *before* any work happens. The form should make that
  consequence visible — a vague criterion is a weak case later, and the UI is the
  only place to say so.
- **Exclusions are how a seller defends itself.** Showing them prominently is fair to
  both sides and makes the eventual verdict legible.

## Source

`../../../docs/ui-design.md` §3 Flow C · `../../../docs/agent-definition.md` §2.1.
