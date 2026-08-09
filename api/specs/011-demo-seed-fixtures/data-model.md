# Data Model: Demo seed & the three seller agents

**Feature**: `011-demo-seed-fixtures` · **Date**: 2026-08-09

**No migration.** No new table, no new column, no altered constraint. This feature
writes and deletes existing rows through existing repositories, and holds its only new
structures in memory.

---

## 1. Rows the seed creates

### 1.1 `accounts` — one row, the demo seller

| Column | Value |
| --- | --- |
| `wallet_address` | `DEMO_SELLER_ADDRESS`, as configured |
| everything else | defaults |

Created through `AccountRepository.findOrCreateByAddress()` — the same call the auth
flow makes on first sign-in. There is no "demo" flag on the row and there must not be:
an account that behaves differently because it was seeded is an account the demo is not
really testing. Address matching is case-insensitive by the repository's existing rule,
so a checksummed and a lowercase `DEMO_SELLER_ADDRESS` are the same account.

**Not deleted by reset** (FR-030).

### 1.2 `agents` + `agent_versions` — three pairs

One `agents` row and one `agent_versions` row per seeded agent, written by
`AgentWritesService.createAgent` in a single transaction, with `onchain_agent_id`
filled from the `registerAgent` receipt.

| Field | Source |
| --- | --- |
| `owner_account_id` | the demo seller from §1.1 |
| `active` | `true` (the column default; the create path accepts no override) |
| `onchain_agent_id` | assigned by the escrow contract, written after the receipt |
| `definition_hash` | `keccak256` of the canonical definition — see §3 |
| the ten definition fields | [`contracts/seeded-definitions.md`](./contracts/seeded-definitions.md) |

**Not deleted by reset** (FR-030). A second version row appears if a seeded definition
is edited in code and the seed is re-run (research R3); the old version is never
edited, so an order that already ran keeps the text it was judged against.

---

## 2. Rows reset removes

Reset runs as **one transaction**, in this order. The order is a foreign-key order, not
a preference.

```text
1. UPDATE ledger_entries SET order_id = NULL WHERE order_id IS NOT NULL
2. DELETE FROM verdicts
3. DELETE FROM complaints
4. DELETE FROM runs
5. DELETE FROM orders
```

| Table | FK into `orders` | Why it is in this position |
| --- | --- | --- |
| `ledger_entries` | `order_id uuid REFERENCES orders(id)` — **nullable, no `ON DELETE`** | The rows must survive (FR-031) and the pointer must go, so this is an `UPDATE` and it must precede step 5. Full argument in research R4. |
| `verdicts` | `order_id NOT NULL UNIQUE` | Deleted. A cleared rehearsal is decided afresh; this is the only reason a second audit of the same order is ever possible. |
| `complaints` | `order_id NOT NULL UNIQUE` | Deleted. |
| `runs` | `order_id NOT NULL UNIQUE` | Deleted — including the ones whose `output IS NULL`. Invariant #7 forbids retrying over or cleaning up that NULL *as evidence*; wiping a finished rehearsal is not that. |
| `orders` | — | Deleted last. |

**Untouched by reset**: `accounts`, `agents`, `agent_versions`, and every
`ledger_entries` row (amount, sign, kind, account, timestamp all preserved).

**Counts reported** (FR-032): orders deleted, of which in-flight
(`state IN ('purchased','running','delivered','disputed','adjudicated')`), plus runs,
complaints, verdicts deleted and ledger entries unlinked. The in-flight count is the
one that matters — those orders had money in escrow, and clearing the record does not
recall it.

---

## 3. In-memory structures

### 3.1 `SeededAgent` — `src/demo/seeded-agents.ts`

Content only. Three exported constants.

| Field | Notes |
| --- | --- |
| `key` | `'ledgerbot' \| 'tldr' \| 'polyglot'` — the stable handle the response and the fixtures use, independent of the display name |
| `definition` | Exactly the ten fields of `CanonicalDefinition`, in the shape `createAgent` accepts |

The definition object is the **single source** for three things: what is published, what
is hashed, and what the fixture keys on. There is deliberately no second copy of the
name, price or schema anywhere in the module.

### 3.2 `DemoFixture` — `src/demo/fixtures.ts`

| Field | Type | Purpose |
| --- | --- | --- |
| `act` | `1 \| 2 \| 3` | Which act |
| `agentKey` | `SeededAgent['key']` | Binds the fixture to a definition — never to a name (FR-025) |
| `input` | `Record<string, unknown>` | Half the registry key; also published verbatim |
| `acceptanceCriteria` | `string` | Published. Half of what the ruling is computed from |
| `complaint` | `string` | Published. The other half (FR-013) |
| `script` | `DemoScript` | `{ kind: 'output', output }` for acts 1–2, `{ kind: 'failure', message }` for act 3 |
| `expectedTier` | `'none' \| 'half' \| 'full'` | Documentation and the quickstart's expected value. **Read by nothing at runtime** — no code may branch on it, or the demo would be asserting its own verdict |

Content in [`contracts/fixtures.md`](./contracts/fixtures.md).

### 3.3 Registration into `DemoScriptRegistry`

At `DemoModule.onModuleInit`, for each fixture:

```text
definitionHash(seededAgent.definition).hex   →  strip the leading "0x"
register({ definitionHash, input, script, label })
```

⚠️ **The `0x` strip is load-bearing.** The hash the runner compares against arrives from
`execution.repository.ts` as `Buffer.toString('hex')` — bare hex. Registering viem's
`0x`-prefixed form produces a key that never matches, and the symptom is Act 2 quietly
running live (research R1).

The registry throws on a duplicate key at registration, which is the intended failure:
two fixtures sharing a definition and an input is a content bug, and boot is the moment
to find out.

---

## 4. Relationships that carry the demo

```text
DEMO_SELLER_ADDRESS ──► accounts (1) ──owns──► agents (3) ──► agent_versions (3+)
                                                                    │
                                             definition_hash ───────┤
                                                                    ▼
seeded-agents.ts ──definitionHash()──► (same value) ──► DemoScriptRegistry key
                                                                    ▲
fixtures.ts ──canonical input──────────────────────────────────────┘
```

The hash is computed twice from one object — once by `createAgent` on its way to the
database and the chain, once by `DemoModule` on its way to the registry. They agree by
construction, not by convention, which is what makes a fixture impossible to
mis-register and impossible for a stranger's identically-named agent to inherit.

---

## 5. State transitions

This feature introduces none. Every state change the acts produce is made by existing
code:

| Act | Path | Terminal state |
| --- | --- | --- |
| 1 | purchase → run → `delivered` → complain → `disputed` → audit → `adjudicated` → `settled` | `settled`, tier `none` |
| 2 | same | `settled`, tier `half` |
| 3 | purchase → run → **`AgentRunFailedError`** → `failed` (`runs.output IS NULL`, `runs.error` set) → complain → `disputed` → audit → `settled` | `settled`, tier `full` |

Act 3's failure is thrown by `ScriptedAgentRunner` from a `{ kind: 'failure' }` script
and is indistinguishable to `ExecutionService` from a real crash. No demo code writes an
order state, a run row, or a verdict (FR-022).
