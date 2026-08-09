# Phase 0 Research: Demo seed & the three seller agents

**Feature**: `011-demo-seed-fixtures` · **Date**: 2026-08-09

Nine questions. Seven were answered by reading code that already exists in this
repository; two are design decisions with consequences worth recording.

---

## R1 — When are fixtures registered, so they survive a restart? (FR-026)

**Decision**: At **module bootstrap**, from the static definition objects, in
`DemoModule`'s `onModuleInit`. Not at seed time.

**Rationale**: `DemoScriptRegistry.register()` keys on
`(definitionHash, canonical input)`, and `definitionHash` is a pure function of the
canonical definition — `src/catalog/definition-hash.ts` hashes exactly ten fields and
deliberately excludes `id`, `agentId`, `ownerAccountId`, `createdAt`, and even
`version`, precisely so "the same agent definition hashes identically on a reseeded
database". So the key can be computed from `seeded-agents.ts` alone, with no database
read and no ordering dependency on the seed.

That turns the spec's hardest requirement into a non-event. Registering at seed time
would mean the registry is empty after every restart while the listings persist — and
the failure is silent: Act 2 returns a live five-item extraction, on stage, with
nothing logged as wrong. Registering at bootstrap means the fixtures are in force
whenever the process is, seeded or not.

**Consequence to accept**: fixtures are registered even on a database that was never
seeded. That is harmless — the key includes a definition hash no unseeded agent has,
so every lookup misses, which is exactly the "empty registry" behaviour
`ScriptedAgentRunner` already documents.

**Alternatives considered**:

- *Register during `POST /demo/seed`* — the obvious reading of the source spec, and
  the seam's own docblock says "API-11 … registers them". Rejected: in-memory state
  created by an HTTP call does not survive the process, and the resulting failure is
  invisible.
- *Persist the fixtures in a table and rehydrate at boot* — a migration and a new
  table to hold content that is already a compile-time constant. Rejected as strictly
  more machinery for the same result.

⚠️ **Registration must strip the `0x` prefix.** `definitionHash().hex` is viem's
`0x`-prefixed `Hex`, but the string that reaches `AgentRunner.definitionHash` comes
from `execution.repository.ts` as `Buffer.toString('hex')` — **bare hex, no prefix**.
The registry lowercases but does not normalise the prefix, so registering the viem
form would produce a key that never matches and a fixture that silently never fires.

---

## R2 — How does the seed publish listings so they are actually buyable? (FR-009)

**Decision**: Call the existing `AgentWritesService.createAgent(account, dto)`, once
per agent, awaiting each. Export it from `CatalogModule`.

**Rationale**: `createAgent` already does every part that is easy to get wrong: it
validates both schemas, canonicalises and hashes the definition, inserts the agent and
version 1 in one transaction, calls `registerAgent` with the **account's own wallet
address** as the payout owner, awaits the receipt, and writes back
`onchain_agent_id`. `GET /agents` filters on `onchain_agent_id IS NOT NULL`, so a
listing is only buyable once that has landed — which makes "the seed reports success
only when all three are buyable" the same statement as "all three `createAgent` calls
resolved".

**Consequence**: the seed is **slow and synchronous** — three sequential on-chain
transactions, each awaiting one confirmation. On Monad that is seconds, well inside
SC-002's two minutes. It must not be parallelised: `registerAgent` is an operator-key
write, and three concurrent transactions from one key is a nonce race.

**Alternatives considered**: inserting rows directly and skipping the chain — rejected
outright; the agents would be unbuyable and the demo would fail at `openDeal`.

---

## R3 — What makes the seed idempotent, and what happens when a definition changes? (FR-007, FR-008)

**Decision**: Look up the demo seller's owned agents by name. For each of the three:

| State found | Action |
| --- | --- |
| No agent with that name | `createAgent` — full path, on-chain registration |
| Agent exists, active version's `definition_hash` **matches** the code | Nothing. Return the existing ids. |
| Agent exists, hash **differs** | `publishVersion` — a new immutable version + `updateAgent` on-chain |
| Agent exists with `onchain_agent_id IS NULL` | **Refuse**, loudly, naming the agent | 

**Rationale**: The first three rows make the seed both idempotent and *self-healing*:
editing a fixture's definition in code and re-running the seed brings the database
back into step, which is the workflow this feature will actually be used in. It
respects invariant #6 — a new version never edits the old one, so an order already
judged keeps the text it was judged against.

The fourth row is the important one. A NULL `onchain_agent_id` means a registration
whose outcome was never determined, and `agent-writes.service.ts` states in as many
words that such an agent **must never be retried** by calling `registerAgent` again —
the contract would mint a second on-chain agent and the seller would own two, one
unreachable. The seed must therefore refuse rather than "fix" it, and say which agent
and what to do (reconcile by hand against the `AgentRegistered` logs).

**Alternatives considered**:

- *Key idempotency on a dedicated `demo_seeded` marker table* — a migration to record
  something already derivable from the catalogue.
- *Refuse whenever anything exists, and require a reset first* — rejected: `reset`
  deliberately keeps agents, so there would be no way back except editing the
  database by hand, which is the thing this feature exists to remove.

---

## R4 — How does reset clear orders without touching the ledger? (FR-029, FR-031)

**The collision**: `1786238842921-InitialSchema.ts` declares
`ledger_entries.order_id uuid REFERENCES orders(id)` — nullable, **no `ON DELETE`
clause**, so the default `NO ACTION` applies. Every purchase writes one such entry.
`DELETE FROM orders` therefore fails on the constraint, and the two obvious escapes
are both wrong:

- **Delete the ledger entries too.** This reverses purchase debits, so balances jump
  back up. But the money is gone: it is sitting in an escrow deal or has already
  settled to someone's own on-chain address (invariant #5, which says settled funds
  cannot be recaptured *by design*). The result is a ledger that claims money the pool
  does not hold — a direct hit on the solvency invariant, in the direction the
  two-phase rule exists to prevent.
- **Keep the orders.** Contradicts FR-029, and leaves the previous rehearsal's orders
  on screen during the next one.

**Decision**: `UPDATE ledger_entries SET order_id = NULL WHERE order_id IS NOT NULL`,
inside the same transaction as the deletes and **before** them. Every `amount_minor`,
every `kind`, every row survives; every balance is unchanged, because balance is
`SUM(amount_minor)` and nothing in that sum is touched. What is lost is the pointer
from an entry to a row that no longer exists — which was going to be dangling either
way.

**Rationale**: The append-only rule protects *what the ledger records*: the amounts and
their signs. It is not violated by clearing a foreign key to a deleted row; it would
be violated by deleting the row or writing a compensating entry. The column is already
nullable and already NULL for every non-purchase kind, so the shape is not novel — a
`/me` ledger line for a cleared rehearsal shows `kind: "purchase"`, the right amount,
and `orderId: null`.

**Consequence to accept, and it is the one an operator will feel**: **reset does not
give the money back.** Each rehearsal spends real balance. A long rehearsal session
needs topping up through the ordinary funding path, and the reset response reports the
buyer-visible consequence rather than hiding it.

**Alternatives considered**: a migration adding `ON DELETE SET NULL` — identical
outcome, plus a migration; the write is not made more principled by being performed by
the database.

---

## R5 — What happens if reset runs while a worker holds an order? (FR-034)

**Decision**: Delete inside one transaction and let the workers fail on their own
existing paths. Add nothing.

**Rationale**: Both pollers claim work with `UPDATE … RETURNING` and then act on the
returned row, so the race has three outcomes and all three are already safe:

1. Reset commits before the claim — the claim selects nothing, the poller ticks on.
2. Reset commits after the run completed — ordinary delete.
3. Reset commits **between** claim and write — the worker's later write hits a foreign
   key on a deleted order and throws. `runs.order_id` is `NOT NULL REFERENCES
   orders(id)`, so the write fails outright rather than writing an orphan. The poller
   catches, logs, and continues; there is no partial record because the FK refused it.

Outcome 3 is the one FR-034 is about, and the requirement it produces is a *logging*
requirement, not a locking one: the error must be recognisable as "the operator reset
mid-run" rather than looking like a new defect at 3am. The reset logs the in-flight
count it removed, which is the other half of the pair.

**Alternatives considered**: pausing the pollers for the duration of a reset —
real coordination (a flag every poller reads, and a window where it is set and the
process dies) to protect against an error that is already harmless.

---

## R6 — Why does `additionalProperties: false` have to be enforced here, and where? (FR-004, FR-005)

**The finding, already paid for**: the execution engine's verification run failed all
thirteen pre-existing orders identically with `DefinitionUnusableError`, on

> `output_config.format.schema: For 'object' type, 'additionalProperties' must be explicitly set to false`

confirmed against the live service in both directions. Ajv accepts such a schema, so a
definition **passes listing validation and is refused at execution**.

**Decision**: A small recursive guard, `structured-output-guard.ts`, that walks a
schema and throws naming the JSON pointer of the first object that omits it. Run it
over all three seeded output schemas **before** the first `createAgent` call, so a bad
schema costs nothing — no row, no gas, no partial seed.

**Scoped to the demo module on purpose.** The obvious place is
`catalog/schema-validation.ts`, applied to every seller. That would be a real
improvement and it is deliberately **not** made here: it changes the listing contract
for every seller, it belongs to the catalogue feature, and it would turn a
content-authoring feature into a change in what the marketplace accepts. Worth raising
separately; not worth widening this feature's blast radius. (`guardian/verdict.schema.ts`
solved the same problem for the verdict schema by forcing the flag in a transform,
which is the same answer applied to a schema the platform authors.)

**⚠️ Applies to nested objects too** — `lineItems.items` is an object schema and is the
one most likely to be missed, which would fail Act 2 specifically.

---

## R7 — Where does the demo seller identity come from? (FR-006)

**Decision**: One new required environment key, `DEMO_SELLER_ADDRESS`, validated by the
existing `envSchema` with the same `/^0x[a-fA-F0-9]{40}$/` rule the four other address
keys use. The seed resolves it through `AccountRepository.findOrCreateByAddress()` —
the same call the auth flow makes on first sign-in, so the demo seller is an ordinary
account and not a special row.

**Rationale**: `registerAgent(owner, …)` takes the seller's **payout address**, and
`createAgent` reads it from the account's own `walletAddress`. The address is
therefore where every seller payout in the demo lands — Act 1's full release and Act
2's split — so it must be an address someone in the room controls. Because ownership
is fixed at registration and `updateAgent` cannot change it, a wrong value cannot be
corrected: it can only be re-registered as a new agent. That is why a missing key must
refuse the whole seed rather than default to anything.

Making it **required** rather than optional means the failure lands at boot, in the
existing preflight report, rather than at the first seed call.

**One demo seller owns all three.** The product documents describe three agents and
never three sellers; one identity means every payout lands somewhere the operator can
point at on one screen, and one seller login shows all three listings.

---

## R8 — How are the fixtures published so an act can be driven without re-typing? (FR-028)

**Decision**: `POST /demo/seed` returns them, and because the seed is idempotent,
calling it again after a reset returns them again. **No third route.**

**Rationale**: `docs/api-design.md` §3.5 lists exactly two demo routes, and a `GET
/demo/fixtures` would be a third surface holding the same constant. The fixture
payload is served from the same `fixtures.ts` objects that were registered, so
"published" and "registered" cannot drift — anything else would let the operator paste
an input that no longer matches the key.

⚠️ The published input must be the object, not a rendering of it. The registry's
canonical form sorts object keys but **preserves array order**, so `preserveTerms`
retyped in a different order is a different input and produces a live run — which is
correct behaviour and a confusing five minutes if it happens by accident.

---

## R9 — How is Act 2 made to cite an exclusion? (FR-020)

**Decision**: Give LedgerBot a second exclusion — *"Does not convert between
currencies…"* — make the seeded receipt euro-denominated, and write the fixture's
complaint text with two grievances: the missing items, and a demand for dollars.

**Rationale**: The source spec asks for an exclusion to be *seen* being cited, and the
canonical exclusion — handwritten receipts — cannot be exercised by a text fixture at
all. Attaching the exclusion to one of the two *dropped* line items was considered and
rejected: it would give one omission a legitimate excuse and turn the half tier into an
argument, which is the exact ambiguity FR-027 forbids. Putting it in the **complaint**
instead leaves the arithmetic untouched — five items, three returned — while giving
Guardian a clause to cite in the seller's defence.

**Consequence**: the acceptance criteria for Act 2 must not ask for dollars, or the
grievance stops being unfounded and the tier moves. The criteria and the complaint are
both fixture content for this reason (FR-013), and they are published together.

---

## Resolved unknowns

No `NEEDS CLARIFICATION` markers remain. The three assumptions the specification
flagged are resolved above: the seller identity in R7, reset and the ledger in R4, and
restart survival in R1.
