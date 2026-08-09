/**
 * Abstract root of every error the demo seed path can throw.
 *
 * One class at the root for the same reason `catalog/catalog.errors.ts` and
 * `ledger/ledger.errors.ts` each have one: a caller that only needs to know
 * "the seed refused" writes a single `catch (e) { if (e instanceof DemoError) }`
 * rather than enumerating class names it will forget to extend. Anything finer —
 * *which* refusal, and therefore which status code and which words — means
 * checking the concrete subclass, which is why the per-class fields below exist
 * instead of being flattened into a message string the controller would have to
 * parse back out.
 *
 * `this.name = new.target.name` because subclassing a built-in otherwise leaves
 * `name` reading `"Error"` on every subclass, and a log line or a Sentry title
 * that says `Error` says nothing about what happened.
 *
 * ⚠️ Plain `Error`s, never `HttpException` subclasses — the same split
 * `catalog.errors.ts` argues at length and does not need restating: the mapping
 * from a refusal to a status code is a decision that belongs where the whole
 * mapping is visible at once, which is the controller. It matters here for a
 * reason particular to this feature: the two errors below map to `500` and
 * `409` respectively (contracts/demo-api.md §1.2), and that table also assigns
 * `502` to a chain failure via the *existing* chain-error mapping — a throw site
 * that reached for `InternalServerErrorException` would put one third of that
 * table somewhere the other two thirds are not.
 */
export abstract class DemoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/**
 * A seeded definition would be refused at execution, so it is refused at seed
 * time instead. Raised by `assertStructuredOutputCompatible` in
 * `./structured-output-guard.ts`.
 *
 * **This is not a hypothetical failure mode; it is a bill this project has
 * already paid.** The execution engine's verification run failed all thirteen of
 * its orders identically, on an `outputSchema` that Ajv had accepted at listing
 * time and the structured-outputs API refused at run time
 * (`output_config.format.schema: For 'object' type, 'additionalProperties' must
 * be explicitly set to false`). The engine degraded correctly — a recorded
 * failure naming the definition — which is precisely what made it expensive to
 * read: every act failed for a reason unrelated to what the act was about
 * (research R6, FR-004).
 *
 * ⚠️ **Thrown before any row is written and before any chain call is made**
 * (FR-005). That is the whole point of the class existing at seed time rather
 * than being discovered at execution: a bad schema then costs no row, no gas and
 * no half-seeded catalogue. A `DemoDefinitionUnusableError` escaping *after* a
 * `createAgent` would mean the pre-flight pass in `demo-seed.service.ts` had been
 * moved below the first write.
 *
 * `field` names which schema was at fault and `pointer` is the JSON Pointer of
 * the offending subschema (`#/properties/lineItems/items`). Both are typed
 * fields rather than words in the message for the reason
 * `InvalidJsonSchemaError`'s `field` is: the controller builds its body without
 * re-running the guard to find out, and nobody regexes a human sentence. The
 * pointer in particular is the entire value of the error — "a seeded schema is
 * invalid" without a location is a search through three hand-written fixtures at
 * 3am.
 *
 * ⚠️ Not to be confused with `execution/execution.errors.ts`'s
 * `DefinitionUnusableError`, which is a different class in a different
 * hierarchy: that one is raised mid-run, carries an `orderId`, and ends in a
 * failed order. This one is raised before anything exists to fail.
 * `instanceof DemoError` will never match the execution engine's.
 *
 * Caller action: `500` with `error: 'demo-definition-unusable'` (contracts
 * §1.2). Never transient — the fixture file has to be edited.
 */
export class DemoDefinitionUnusableError extends DemoError {
  constructor(
    message: string,
    public readonly field: string,
    public readonly pointer: string,
  ) {
    super(message);
  }
}

/**
 * A seeded agent row exists and its `onchain_agent_id` is NULL, so there is no
 * on-chain agent behind the listing and the seed cannot go on with it.
 *
 * This is the residue of a `registerAgent` whose transaction was broadcast but
 * whose receipt never arrived: `agent-writes.service.ts` keeps the rows on
 * purpose, because the transaction may still confirm and deleting the row would
 * orphan a live on-chain agent with no record anywhere. That is the *only* way a
 * NULL id is produced, which is what makes it mean something specific here
 * rather than "something went wrong at some point" — and it is why the seed's
 * create-or-reconcile decision (research R3) treats this case as its own branch
 * and not as "absent, so create".
 *
 * ⚠️ **This must be reconciled by hand against the contract's `AgentRegistered`
 * logs, and the agent must NEVER be re-registered.** Calling `registerAgent`
 * again mints a *second* on-chain agent that the seller owns and cannot reach —
 * the contract assigns a new id on every registration, so the retry does not
 * repair the row, it creates a permanent orphan. `agent-writes.service.ts` states
 * the same rule in as many words, and logs both the tx hash and the definition
 * hash at `error` precisely so the pair can be looked up. The message this class
 * is constructed with must say so too (T013, contracts §1.2): the operator
 * meeting this mid-demo is the person about to reach for a re-seed, and the
 * response body is the only place that warning will be read.
 *
 * `agentId` is the Postgres uuid and `agentName` the seeded agent's name, both
 * carried as fields so a log line and a response body can name the row without
 * the message string being the only record of it. The name is here because the
 * operator knows these three agents by name, not by uuid, and the uuid is what
 * the reconciliation query needs — neither one alone is enough.
 *
 * Caller action: `409` with `error: 'demo-agent-unregistered'`, not `500` and
 * not `404`. The request was well-formed and the *state* is what conflicts;
 * re-running the seed once the row has been reconciled is the correct next step,
 * and a `409` is the status that says so.
 */
export class DemoAgentUnregisteredError extends DemoError {
  constructor(
    message: string,
    public readonly agentId: string,
    public readonly agentName: string,
  ) {
    super(message);
  }
}
