# Contract — `DemoScriptRegistry`

The seam between this feature and **API-11**. This feature builds the mechanism and ships the
registry **empty**; API-11 authors the three agent definitions, the three fixture inputs, and the
three scripted outcomes, and registers them.

Reading order: `docs/specs/API-11-demo-seed.md` names the fixtures; `product-workflow.md` §5.5
explains why they are scripted at all; research [R4](../research.md) argues the substitution point.

---

## The interface

```ts
// src/execution/demo-script.registry.ts

/** What a script does when it matches. Exactly one of two shapes. */
export type DemoScript =
  | { readonly kind: 'output'; readonly output: Record<string, unknown> }
  | { readonly kind: 'failure'; readonly message: string };

export interface DemoScriptEntry {
  /** `agent_versions.definition_hash` for the seeded version, hex, no 0x. */
  readonly definitionHash: string;
  /** The seeded input, verbatim. Hashed canonically on registration. */
  readonly input: Record<string, unknown>;
  readonly script: DemoScript;
  /** For the log line when a script fires. e.g. "Act 2 — LedgerBot drops 2 of 5". */
  readonly label: string;
}

@Injectable()
export class DemoScriptRegistry {
  register(entry: DemoScriptEntry): void;
  lookup(definitionHash: string, input: Record<string, unknown>): MatchedScript | null;
  get size(): number;
}
```

`lookup` returns `null` on a miss, and a miss is the normal case — every real purchase from every
real agent misses. A `MatchedScript` exposes `perform()`, which either resolves an
`AgentRunOutcome` or throws `AgentRunFailedError` carrying `message`.

---

## Matching

```
key = sha256(definitionHash) ‖ sha256(canonicalJson(input))
```

Both halves must match.

**Why `definition_hash`** — it already exists on every version, it is keccak256 over the canonical
definition, and it is committed on-chain at listing, so it is the one identifier a third party
cannot shadow. Keying on the agent's *name* would let anyone register an agent called "LedgerBot"
and inherit the script.

**Why the input too** — FR-033. `product-workflow.md` §5.5 describes *seeded inputs*, not seeded
agents. A judge who pastes their own receipt into LedgerBot must get a real extraction, not the
scripted three-of-five. Canonical JSON means sorted keys and no incidental whitespace, so the same
document typed twice matches.

---

## Guarantees this feature makes to API-11

1. **A scripted run is indistinguishable from a live one in the database.** Same `runs` row shape,
   same `steps`, same timings, same conformance answer, same order transition. The script replaces
   the model call and nothing downstream of it (FR-034).
2. **A scripted failure travels the ordinary failure path.** `{ kind: 'failure' }` throws the same
   error type a real crash throws, so it lands as `state = 'failed'` with `output IS NULL` and the
   message on `runs.error`. There is no shortcut that writes a verdict, and no error row that
   skips `failed` — the two things API-11's brief specifically warns against.
3. **Registration is additive and order-independent.** `register` twice on the same key is a
   programming error and throws at registration time, not at run time.
4. **An empty registry changes nothing.** With no entries, `ScriptedAgentRunner` is a pass-through.

## What API-11 owes this feature

1. **Three entries**, one per act — a valid ~85-word summary that covers the pricing change, an
   extraction returning exactly 3 of 5 nameable line items, and a failure with a message worth
   reading in a case file.
2. **Output schemas that structured outputs will actually accept.** Ajv is more permissive than the
   API: every object needs `additionalProperties: false`, recursion is unsupported, and
   `minLength`-style constraints are not honoured. A definition can pass listing and be refused at
   run time — which this feature records as a run failure naming the field (FR-007), and which
   would make Act 2 fail for a reason that has nothing to do with line items. Research R5.
3. **`{ kind: 'output' }` payloads that satisfy their own schema**, unless an act is deliberately
   demonstrating the opposite. A scripted output is *not* schema-checked at registration — it goes
   through the ordinary conformance check like any other, so a sloppy fixture shows up as
   `output_valid = false` in a case file rather than as an error at seed time.

## Where registration happens

API-11's seeding path, after the three versions exist and their `definition_hash` values are
known. `DemoScriptRegistry` is exported from `ExecutionModule`; API-11's module imports it and
calls `register` three times. The registry is process-local and holds no state that survives a
restart — re-seeding after a restart is already part of the rehearsal loop (`POST /demo/seed`).
