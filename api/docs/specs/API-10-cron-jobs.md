# API-10 — Cron jobs

**Component:** `api/` · **Depends on:** API-07 · **Size:** Small

> **Feed this file to `/speckit-specify`.** Read [`../CONTEXT.md`](../CONTEXT.md)
> first — it carries the nine backend invariants this spec assumes.

## Goal

The three timers that make the contract's deadlines actually fire. A smart contract
cannot act on its own; something must poke it.

## In scope

| Job | Interval | Does |
| --- | --- | --- |
| **Sweeper** | `SWEEPER_INTERVAL_MS` | `delivered` past its review window → `release()` → `state='released'` |
| **Reclaimer** | 5 min | `purchased` past `DELIVERY_DEADLINE` → `reclaim()` |
| **Reaper** | 1 min | `running` past its timeout → `state='failed'` |

Uses `@nestjs/schedule`. Each job logs what it acted on.

## Out of scope

**Automated tests of any kind** (MVP decision — see `../CONTEXT.md`). Plus:

Job queues, distributed locking, retry/backoff frameworks, the removed deposit
poller.

## Acceptance

- An untouched delivered order releases on its own once the window expires
- A killed mid-execution order ends up `failed` rather than stuck in `running`
- Jobs are idempotent — a second pass over the same order does nothing

## Watch out for

- **The sweeper is the one the audience sees.** It's what makes Act 1's uncontested
  trade auto-release with nobody touching the keyboard. It needs the
  `orders (state, delivered_at)` index.
- **The reaper exists because there's no job queue.** Restart the backend mid-run and
  an order sits in `running` forever. Marking it failed is correct, not a workaround:
  from the buyer's side, an agent that never returned is non-delivery regardless of
  why.
- Jobs must tolerate a chain call failing — log and retry next tick, never crash the
  scheduler.

## Source

`../../../docs/api-design.md` §6 · `../../../docs/smart-contract.md` §6.3.

**Build against [`../../../docs/openapi.yaml`](../../../docs/openapi.yaml)** (API-12) — it is the contract the frontend reconciles against, and a divergence here is a defect there.
