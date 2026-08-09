# Contract — `AgentRunner`

**This feature exposes no HTTP endpoints.** It is a worker; nothing calls it over the network, and
`docs/openapi.yaml` gains nothing from it. Its contracts are three internal seams, and this is the
first: the port that separates *running an agent* from *recording what happened*.

Consumer: `ExecutionService`. Implementations: `ClaudeAgentRunner` (real),
`ScriptedAgentRunner` (deterministic demo mode, delegating).

---

## The port

```ts
// src/execution/agent-runner.ts

export interface AgentRunRequest {
  /** The pinned version's `system_prompt`. ⚠️ Never logged, never echoed. */
  readonly systemPrompt: string;
  /** The pinned version's `model`. The seller's field — never substituted. */
  readonly model: string;
  /** The pinned version's `output_schema`, 2020-12 dialect. */
  readonly outputSchema: Record<string, unknown>;
  /** The buyer's input, from `orders.input`. */
  readonly input: Record<string, unknown>;
  /** The pinned version's `timeout_seconds`, already in ms. */
  readonly timeoutMs: number;
  /** `agent_versions.definition_hash`, hex. Only the scripted runner reads it. */
  readonly definitionHash: string;
}

export interface AgentRunOutcome {
  /** The structured output. Never null on this type — a failure throws. */
  readonly output: Record<string, unknown>;
  /**
   * Assistant prose accompanying the structured output, when the model emitted
   * any. ⚠️ MODEL PROSE — stored on the step's `reasoning`, never on `label`,
   * never logged.
   */
  readonly assistantText: string | null;
  /** Wall clock for the model call alone, for the `model_turn` step. */
  readonly durationMs: number;
}

export abstract class AgentRunner {
  abstract run(request: AgentRunRequest): Promise<AgentRunOutcome>;
}
```

An `abstract class` rather than a bare interface plus a symbol: Nest can use it as its own
injection token, which keeps the wiring to one line and keeps the token from drifting from the
type.

---

## The contract

**Success** resolves with an `AgentRunOutcome`. The `output` is whatever the model returned under
the structured-output constraint — the runner does **not** check it against the schema. That is
the service's job (see `run-record.md`), because conformance has to be *recorded*, and a runner
that rejected a non-conforming output would turn a delivery into a non-delivery, which FR-029
forbids.

**Failure throws**, and only these three:

| Thrown | When | Becomes |
| --- | --- | --- |
| `AgentTimeoutError` | the run exceeded `timeoutMs` | `failed`, `output` NULL, `error` naming the limit |
| `AgentRunFailedError` | the model call errored, was refused, or returned something unparseable | `failed`, `output` NULL, `error` carrying the cause |
| `DefinitionUnusableError` | the API refused the `outputSchema` itself | `failed`, `error` naming the field (FR-007) |

Anything else escaping a runner is a bug, and the service treats an unexpected throw as
`AgentRunFailedError` rather than letting it reach the poller — a run that dies without a record
is the one outcome with no evidence at all.

**The runner never touches the database, the chain, or the order.** It receives a request and
returns or throws. That is what lets the scripted runner be a total substitute.

---

## `ClaudeAgentRunner`

One non-streaming `messages.create` (research R5 argues each of these):

```ts
{
  model: request.model,                 // from the definition, never ours
  max_tokens: AGENT_MAX_OUTPUT_TOKENS,  // module constant, 8192
  system: request.systemPrompt,
  messages: [{ role: 'user', content: JSON.stringify(request.input) }],
  output_config: {
    format: { type: 'json_schema', schema: request.outputSchema },
  },
}
```

with the request options `{ timeout: request.timeoutMs, signal, maxRetries: 0 }`.

**Not sent, deliberately**: `thinking`, `output_config.effort`, `temperature`, `top_p`, `top_k`.
Each of these is either removed or unsupported on some model a seller may legitimately name —
`effort` and adaptive thinking both fail on `claude-haiku-4-5`, which is the model all three demo
agents use — and the request has to be buildable from seller data for any model. R5.

**`maxRetries: 0` is load-bearing**, not tidiness. The SDK retries twice by default; two hidden
retries make `duration_ms` false, can spend triple the declared timeout, and turn one purchased
run into three model calls. A failure here is a legitimate evidence-producing outcome
(invariant #7), not something to paper over.

**The timeout is enforced twice** — the SDK's `timeout` and an `AbortController` armed for the same
deadline — because the first bounds the HTTP request and the second bounds the whole call
including anything the SDK does around it. Whichever fires, the runner throws
`AgentTimeoutError` naming `timeoutSeconds`, and whatever the model had produced is discarded
(FR-026).

**Logging rule**: the runner logs the order id, the model, the duration and the failure kind. It
never logs `systemPrompt`, the request body, the response body, or `assistantText`. Invariant #3's
boundary is a serialiser on the way out to a buyer; a log line goes around it.

---

## `ScriptedAgentRunner`

```ts
class ScriptedAgentRunner extends AgentRunner {
  constructor(
    private readonly scripts: DemoScriptRegistry,
    private readonly live: ClaudeAgentRunner,
  ) { super(); }

  async run(request: AgentRunRequest): Promise<AgentRunOutcome> {
    const script = this.scripts.lookup(request.definitionHash, request.input);
    if (script === null) return this.live.run(request);   // FR-033
    return script.perform();                              // resolves, or throws
  }
}
```

Registered as the provider for the `AgentRunner` token, so `ExecutionService` depends on the port
and cannot tell which implementation it got. A scripted failure throws the *same* error types as a
live one, so it travels the same branch, writes the same record, and reaches the same `failed`
state — which is what API-11's brief requires of Act 3.

See [`demo-script-registry.md`](./demo-script-registry.md) for what API-11 registers.
