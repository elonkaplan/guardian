# Quickstart: Catalogue & the serialisation boundary

**Feature**: `006-agent-catalogue` · **Spec**: [spec.md](./spec.md) · **Contracts**: [contracts/internal-api.md](./contracts/internal-api.md)

This is the test suite. Automated tests are out of scope for `api/`
(`docs/CONTEXT.md`), so every acceptance criterion in the spec is verified here, by hand,
and a failed run is a red build.

**Three checks are load-bearing and must never be skipped**: §2 (the hash reproduces
outside the system), §3 (no prompt escapes, under any input), and §7 (the availability
round trip). They correspond to the three acceptance criteria the source brief states.

---

## 0. Prerequisites

```bash
docker compose up -d
npm run migration:run
npm run start:dev
```

```bash
export API=http://localhost:3000

# Two sessions. The second is needed for every ownership check.
export SELLER=<token for wallet A>
export OTHER=<token for wallet B>
```

Both wallets must have signed in at least once so their accounts exist.

---

## 1. List an agent (US1, FR-006…FR-015)

```bash
curl -s -X POST $API/agents \
  -H "Authorization: Bearer $SELLER" -H 'Content-Type: application/json' -d '{
  "name": "LedgerBot",
  "description": "Extracts line items from a receipt and totals them.",
  "capabilities": ["Extracts every line item from a receipt with its amount and returns the total."],
  "exclusions": ["Does not handle handwritten receipts or non-Latin scripts."],
  "priceMinor": 200,
  "inputSchema":  {"type":"object","properties":{"receiptText":{"type":"string"}},"required":["receiptText"]},
  "outputSchema": {"type":"object","properties":{"lineItems":{"type":"array","items":{"type":"object","properties":{"description":{"type":"string"},"amount":{"type":"number"}}}},"total":{"type":"number"}},"required":["lineItems","total"]},
  "systemPrompt": "SENTINEL-PROMPT-DO-NOT-LEAK. You extract line items from receipts.",
  "model": "claude-haiku-4-5"
}' | tee /tmp/agent.json
```

| # | Check | Pass |
| --- | --- | --- |
| A1 | Status | `201` |
| A2 | `onchainAgentId` | present, an integer, **not null** — FR-012. If null, the endpoint returned early and the whole feature is wrong |
| A3 | `version` | `1` |
| A4 | `definitionHash` | `0x` + 64 hex characters |
| A5 | Response body | contains no `systemPrompt`, no `model`, no `timeoutSeconds` |
| A6 | Wall-clock | the call took seconds, not milliseconds — it waited for a receipt |

The sentinel string in `systemPrompt` is deliberate and is used by §3. Keep it.

```bash
export AGENT=$(jq -r .id /tmp/agent.json)
```

### Refusals — nothing is recorded (FR-007…FR-009)

```bash
# Not a schema.
curl -s -X POST $API/agents -H "Authorization: Bearer $SELLER" \
  -H 'Content-Type: application/json' \
  -d '{"name":"X","description":"X","capabilities":[],"exclusions":[],"priceMinor":100,
       "inputSchema":{"type":"not-a-real-type"},"outputSchema":{"type":"object"},
       "systemPrompt":"x","model":"claude-haiku-4-5"}'
```

| # | Case | Pass |
| --- | --- | --- |
| A7 | Invalid `inputSchema` | `400`, and the message **names `inputSchema`** — SC-009 |
| A8 | Invalid `outputSchema` | `400` naming `outputSchema` |
| A9 | `priceMinor: 0`, `-1`, `1.5` | `400` each |
| A10 | Missing `systemPrompt` | `400` |
| A11 | No `Authorization` header | `401` |
| A12 | After A7–A11 | `GET /agents` is unchanged — no partial agent was created |

---

## 2. The hash reproduces outside the system (US1, FR-016…FR-020, SC-001, SC-008)

**The check the on-chain commitment is worthless without.** Re-derive the fingerprint
independently and compare it against the chain — not against our own database, which would
be marking our own homework.

```bash
# The stored definition, from the owner's own view.
curl -s $API/agents/$AGENT/versions -H "Authorization: Bearer $SELLER" | jq '.[0]' > /tmp/v1.json
```

```bash
# Independent re-derivation. Node, but nothing from src/.
node -e '
const { keccak256, toBytes } = require("viem");
const v = require("/tmp/v1.json");
const sortRec = x => Array.isArray(x) ? x.map(sortRec)
  : (x && typeof x === "object")
    ? Object.fromEntries(Object.keys(x).sort().map(k => [k, sortRec(x[k])]))
    : x;
const def = {
  capabilities: v.capabilities, description: v.description, exclusions: v.exclusions,
  inputSchema: v.inputSchema, model: v.model, name: v.name, outputSchema: v.outputSchema,
  priceMinor: v.priceMinor, systemPrompt: v.systemPrompt, timeoutSeconds: v.timeoutSeconds,
};
console.log(keccak256(toBytes(JSON.stringify(sortRec(def)))));
'
```

```bash
# What the chain holds. ONCHAIN_ID from /tmp/agent.json.
cast call $ESCROW_CONTRACT_ADDRESS "agents(uint256)(address,uint256,bytes32,uint32,bool)" \
  $(jq -r .onchainAgentId /tmp/agent.json) --rpc-url $MONAD_RPC_URL
```

| # | Check | Pass |
| --- | --- | --- |
| B1 | Re-derived hash vs `definitionHash` in `/tmp/v1.json` | identical |
| B2 | Re-derived hash vs the chain's `defHash` | **identical** — SC-001 |
| B3 | Chain `price` | `2000000` base units = 200 cents |
| B4 | Chain `active` | `true` |

### Determinism (SC-008)

| # | Check | Pass |
| --- | --- | --- |
| B5 | Post the same definition again with the JSON keys **in a different order** | the new agent's `definitionHash` equals the first |
| B6 | Post it again with one character changed in `systemPrompt` | a **different** hash — a private field is inside the commitment |
| B7 | Post it again with `capabilities` reordered | a **different** hash — array order is part of the definition |
| B8 | Post a definition whose `inputSchema` has nested objects | re-derivation still matches. **This is the check that catches the replacer-array trap** ([R2](./research.md)) — a wrong canonicaliser empties nested objects and still produces a stable, reproducible, wrong hash |

B8 is the one that finds the bug the others miss. Do not skip it.

---

## 3. No prompt escapes, under any input (US2, FR-001…FR-005, SC-004)

**The second of the three acceptance criteria.** The sentinel from §1 makes this a grep
rather than an inspection.

```bash
for U in "/agents" "/agents/$AGENT" "/agents?owner=me" ; do
  for T in "" "$SELLER" "$OTHER" ; do
    echo "--- $U  token=${T:+set}"
    curl -s "$API$U" ${T:+-H "Authorization: Bearer $T"}
  done
done | grep -c "SENTINEL-PROMPT-DO-NOT-LEAK"
```

| # | Check | Pass |
| --- | --- | --- |
| C1 | The count above | **`0`** — SC-004 |
| C2 | Same sweep for `"model"` and `"timeoutSeconds"` as keys | zero matches on every buyer-facing route |
| C3 | `GET /agents/$AGENT` as the owner, with their own token | still no prompt — the public route does not widen for the owner |
| C4 | The same sweep with a malformed uuid, a valid-but-unknown uuid, and `?owner=me&owner=me` | no prompt, no 500 |
| C5 | Server log during the sweep | the prompt does not appear there either — layer 1 means the column is never fetched |

```bash
# The structural check, not a behavioural one.
grep -rn "systemPrompt" src/catalog/agent-serialiser.ts
```

| # | Check | Pass |
| --- | --- | --- |
| C6 | The grep | prints **nothing but comments**. If the serialiser mentions the field at all — even to delete it — the boundary is a rule again, not a shape ([R9](./research.md)) |
| C7 | `grep -n "select" src/catalog/*.repository.ts` | the public reads name their columns explicitly; `system_prompt` is absent from every one |

---

## 4. The public catalogue shows only what can be bought (FR-021…FR-024, SC-002)

| # | Action | Pass |
| --- | --- | --- |
| D1 | `GET /agents` with no token | `200`, an array, the agent present |
| D2 | `GET /agents/$AGENT` with no token | `200`, listing fields, `capabilities` and `exclusions` present as arrays |
| D3 | `GET /agents/00000000-0000-0000-0000-000000000000` | `404` |
| D4 | `GET /agents/not-a-uuid` | `400`, not a 500 |
| D5 | `GET /agents` with `Authorization: Bearer garbage` | **`401`** — a bad credential is refused even where none is required ([R6](./research.md)) |
| D6 | `GET /agents` with an expired token | `401` |

### The unregistered agent is invisible (FR-021, FR-022, SC-002)

Simulate the only state that produces one — a receipt timeout — by pointing
`MONAD_RPC_URL` at a host that accepts a connection and never answers, then listing an
agent. Restore the URL afterwards.

| # | Check | Pass |
| --- | --- | --- |
| D7 | `POST /agents` against the black hole | `502`, body says the listing did not complete |
| D8 | `select id, onchain_agent_id from agents order by created_at desc limit 1` | a row exists, `onchain_agent_id` is **NULL** ([R8](./research.md)) |
| D9 | `GET /agents` | the row is **absent** — SC-002 |
| D10 | `GET /agents/<that id>` | **`404`** |
| D11 | `GET /agents?owner=me` | the row **is** present, with `listed: false` |
| D12 | Server log | one `error` line carrying the tx hash **and** the `defHash`, so the transaction can be reconciled by hand |

If D9 or D10 shows the agent, an unbuyable listing is in the marketplace and a buyer will
find it at purchase time, on their own screen. That is the failure the whole filter exists
to prevent.

---

## 5. Chain failures record nothing (FR-014, contracts §4)

Distinguish the two `502`s. A revert is not a timeout.

| # | Case | Pass |
| --- | --- | --- |
| E1 | `POST /agents` with the operator wallet out of gas | `502`, and **no row at all** — `select count(*) from agents` is unchanged |
| E2 | `POST /agents/:id/versions` with the chain unreachable | `502`, and `select count(*) from agent_versions where agent_id = …` is unchanged |
| E3 | `PATCH /agents/:id/active` with the chain unreachable | `502`, and `agents.active` is unchanged |
| E4 | After E1–E3 | the chain and the database agree — nothing half-applied |

E2 and E3 are the transaction-wrapping check ([R8](./research.md)). A version row that
survives a failed `updateAgent` is a listing at a price the chain will not honour.

---

## 6. Versions are immutable and supersede cleanly (US4, FR-031…FR-036, SC-005, SC-007)

```bash
curl -s -X POST $API/agents/$AGENT/versions -H "Authorization: Bearer $SELLER" \
  -H 'Content-Type: application/json' -d '{ …same body, priceMinor 250, sharper capabilities… }'
```

| # | Check | Pass |
| --- | --- | --- |
| F1 | Status, `version` | `201`, `2` |
| F2 | `GET /agents/$AGENT` | shows version 2's listing and price — FR-023 |
| F3 | `/tmp/v1.json` re-fetched | **byte-identical** to before — SC-007 |
| F4 | Chain `defHash` and `price` | now version 2's — §2's `cast call`, re-run |
| F5 | Publish a version with an **unchanged** price | `updateAgent` is still called (FR-034) — check the log line |
| F6 | Publish a definition **identical** to the current one | `201`, new version number, **same `definitionHash`** — [R3](./research.md); this must not be refused |
| F7 | `POST /agents/$AGENT/versions` as `$OTHER` | `403`, nothing recorded |
| F8 | Two publishes fired simultaneously | version numbers are consecutive and unique; neither is lost, no constraint error surfaces to the caller |

**SC-005 — running orders untouched.** Not verifiable until API-07 exists. Record it here
as owed, and check it during the first end-to-end rehearsal: open an order against version
1, publish version 2, confirm the order still resolves version 1's `capabilities` in its
case file.

---

## 7. The availability round trip (US3, FR-037…FR-040, SC-006)

**The third acceptance criterion.** The half that gets skipped is switching it back on.

```bash
curl -s -X PATCH $API/agents/$AGENT/active -H "Authorization: Bearer $SELLER" \
  -H 'Content-Type: application/json' -d '{"active": false}'
```

| # | Check | Pass |
| --- | --- | --- |
| G1 | `GET /agents` | the agent is **gone** |
| G2 | `GET /agents/$AGENT` | `404` |
| G3 | `GET /agents?owner=me` | the agent is **present**, `active: false` — FR-039. If it vanished here, the toggle is one-way and nothing can switch it back on |
| G4 | `PATCH … {"active": true}` | `200` |
| G5 | `GET /agents` | the agent is **back** — SC-006, round trip complete |
| G6 | `PATCH … {"active": true}` again | `200`, no error — idempotent |
| G7 | `PATCH` as `$OTHER` | `403`, `agents.active` unchanged |
| G8 | Chain `active` after each PATCH | matches the database — §2's `cast call` |

G3 is the check `ui/specs/007-seller-pages` quickstart D8 makes from the other side. If one
passes and the other fails, they disagree about the same endpoint.

---

## 8. Owner-only views (US5, FR-025…FR-029, SC-010)

| # | Request | Pass |
| --- | --- | --- |
| H1 | `GET /agents/$AGENT/versions` as `$SELLER` | `200`, every version, **with** `systemPrompt`, `model`, `timeoutSeconds`, `definitionHash` |
| H2 | as `$OTHER` | **`404`** — not `403`. A `403` tells another seller the id is real ([contracts §7](./contracts/internal-api.md)) |
| H3 | with no token | `401` |
| H4 | for an unknown uuid, as anyone | `404` — indistinguishable from H2 |
| H5 | `GET /agents?owner=me` with no token | `401`, **not** the public list — FR-027 |
| H6 | `GET /agents?owner=someone-else` | `400` |
| H7 | `GET /agents?owner=me` as `$OTHER` | contains none of `$SELLER`'s agents |
| H8 | Deactivate, then H1 | still `200` — the owner's view ignores availability |

---

## 9. Field names match what the UI already calls (FR-042, SC-011)

The UI is written; this is a diff, not a design review.

| # | Check against | Pass |
| --- | --- | --- |
| I1 | `ui/src/api/types.ts` `AgentSummary` | `GET /agents` entries carry exactly `id`, `name`, `description`, `priceMinor` |
| I2 | `AgentListing` | `GET /agents/:id` carries those plus `capabilities`, `exclusions`, `inputSchema`, `outputSchema` (and `version`, which the UI ignores) |
| I3 | `ui/specs/007-seller-pages` §1.3 `OwnedAgent` | `?owner=me` carries `AgentSummary` + `active` — **plus `listed`, which UI-07 does not yet declare** ([R12](./research.md)) |
| I4 | §1.4 `CreateAgentRequest` | `POST /agents` accepts exactly those nine fields; `timeoutSeconds` optional; `active` **not** accepted |
| I5 | §1.5 `SetAgentActiveRequest` | `PATCH` takes `{ active: boolean }` |
| I6 | Every response | bare arrays for lists; `camelCase` throughout; every money field ends `Minor` and is an integer |

**I3 is a known handoff, not a defect.** The seller's screen cannot render `listed` until
`OwnedAgent` and `OwnedAgentList` are edited. Until then D11 passes on the wire and shows
nothing on the page.

---

## 10. Rehearsal checklist

Run before every rehearsal. Everything below must pass, in order.

- [ ] All three demo agents list successfully, each returning a non-null `onchainAgentId` (§1)
- [ ] Each agent's hash re-derives independently and matches the chain (§2, B2)
- [ ] The nested-schema re-derivation matches (§2, B8)
- [ ] The sentinel sweep returns `0` (§3, C1)
- [ ] `GET /agents` shows exactly the three agents, none unregistered (§4)
- [ ] Deactivate → gone publicly, present privately → reactivate → back (§7)
- [ ] A second version supersedes and leaves version 1 byte-identical (§6)
- [ ] `GET /agents/:id/versions` refuses another account with `404` (§8, H2)
- [ ] Field names still match `ui/src/api/types.ts` (§9)

**SC-012** is this list passing twice in a row with no manual correction to the catalogue
between runs.
