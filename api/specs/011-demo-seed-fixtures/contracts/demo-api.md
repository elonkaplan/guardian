# Contract: the demo routes

**Feature**: `011-demo-seed-fixtures` · Implements `docs/api-design.md` §3.5

Two routes. **Neither is authenticated and neither is environment-guarded**, per the
recorded decision in `docs/api-design.md` §8. Both are `@Public()`.

That decision is what makes §1.3 and §2.4 below non-negotiable: an unauthenticated
route's response is a public surface, so it may carry no seller IP, and it must be safe
to call twice by anyone poking at a deployed instance.

---

## 1. `POST /demo/seed`

Creates the demo seller, publishes the three listings, and returns the fixtures needed
to drive the three acts.

**Request body**: none.

### 1.1 Response `200 OK`

```json
{
  "seller": {
    "accountId": "uuid",
    "walletAddress": "0x…"
  },
  "agents": [
    {
      "key": "ledgerbot",
      "agentId": "uuid",
      "onchainAgentId": 7,
      "name": "LedgerBot",
      "priceMinor": 200,
      "version": 1,
      "definitionHash": "0x…",
      "created": true
    }
  ],
  "fixtures": [
    {
      "act": 2,
      "agentKey": "ledgerbot",
      "agentId": "uuid",
      "input": { "receiptText": "…" },
      "acceptanceCriteria": "Extract all line items with their amounts, and give the correct total.",
      "complaint": "Two line items are missing …",
      "expectedTier": "half"
    }
  ]
}
```

- `agents` — always three, in the order `ledgerbot`, `tldr`, `polyglot`.
- `created` — `true` if this call published it, `false` if it was already there.
  A re-seed returns three `false`s, which is how an operator confirms idempotency
  without reading the database.
- `fixtures` — always three, ordered by `act`. `input` is the object **verbatim as
  registered** (contracts/fixtures.md); posting it to `POST /orders` unchanged is what
  makes the act deterministic.
- `200`, not `201`. The call is idempotent and usually creates nothing.

### 1.2 Errors

| Status | Condition | Body `error` |
| --- | --- | --- |
| `500` | `DEMO_SELLER_ADDRESS` unset — *cannot occur at runtime*, the config schema requires it at boot | `demo-seller-not-configured` |
| `409` | A seeded agent exists with `onchain_agent_id IS NULL` | `demo-agent-unregistered` |
| `500` | A seeded output schema fails the structured-output guard | `demo-definition-unusable` |
| `502` | The chain registration failed or its outcome is unknown | `chain-unavailable` (existing mapping) |

The `409` names the agent and says explicitly that it must be reconciled by hand and
**must not** be re-registered — calling `registerAgent` again would mint a second
on-chain agent (research R3).

⚠️ **A partial seed is a valid state.** If the second `createAgent` fails, the first
listing stands. Re-running the seed completes the set; it does not start a parallel one.

### 1.3 What the response must never contain

`systemPrompt`, in any form, for any of the three agents. The response DTO is built
field by field and has nowhere to put it (invariant #3, FR-010). This is the same rule
`agent-listing.dto.ts` enforces for the public catalogue, applied to a route that has no
session at all.

---

## 2. `POST /demo/reset`

Clears the transactional history and leaves the catalogue standing.

**Request body**: none.

### 2.1 Response `200 OK`

```json
{
  "cleared": {
    "orders": 12,
    "ordersInFlight": 1,
    "runs": 11,
    "complaints": 4,
    "verdicts": 3,
    "ledgerEntriesUnlinked": 12
  },
  "kept": {
    "accounts": 3,
    "agents": 3,
    "ledgerEntries": 27
  },
  "note": "Ledger entries are preserved and balances are unchanged. Money already escrowed or settled on-chain is not returned by a reset."
}
```

- `ordersInFlight` — of the orders deleted, how many were in a non-terminal state
  (`purchased`, `running`, `delivered`, `disputed`, `adjudicated`). **Those had money in
  escrow**, and clearing the record does not recall it. This number existing is FR-032.
- `note` is a constant string. It is in the response because the operator reading it at
  3am is the person who needs it, and a README they will not open is not where it
  belongs.

### 2.2 What is removed, and in what order

One transaction:

```text
UPDATE ledger_entries SET order_id = NULL  →  DELETE verdicts  →  complaints  →  runs  →  orders
```

Foreign-key order, not preference. See [data-model.md §2](../data-model.md#2-rows-reset-removes).

### 2.3 What is kept

`accounts`, `agents`, `agent_versions`, and **every** `ledger_entries` row — amount,
sign, kind, account and timestamp all untouched, so every balance is exactly what it was
(FR-030, FR-031). Only the `order_id` pointer is cleared, and only where it pointed at a
row being deleted.

### 2.4 Behaviour under repetition and concurrency

- **Nothing to clear** → `200` with every count `0`.
- **Called twice** → the second call clears nothing and succeeds.
- **Called mid-act** → the transaction wins or loses cleanly. A worker that had already
  claimed an order fails on the foreign key when it tries to write, logs, and continues;
  no partial record survives, because the constraint refuses it (research R5, FR-034).
  The log line for that failure must be recognisable as *"someone reset mid-run"*.

### 2.5 Errors

None specific to this route. A database failure rolls the whole transaction back and
maps to the existing `500`; nothing is half-cleared.

---

## 3. Cross-cutting

- **No third route.** `docs/api-design.md` §3.5 lists exactly two, and the fixtures are
  re-readable by calling the idempotent seed again. A `GET /demo/fixtures` would be a
  second surface holding the same constant (research R8).
- **Both routes are documented in the README**, including the fact that reset is
  unguarded and what it does to a deployed instance (FR-011).
- **Neither route touches the chain except through `createAgent`.** Reset makes no chain
  call at all — it cannot, and pretending otherwise would be the one place this feature
  could quietly move money.
