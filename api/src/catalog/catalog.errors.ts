/**
 * Abstract root of every error the catalogue can throw.
 *
 * One class at the root, for the same reason `chain/errors.ts` and
 * `ledger/ledger.errors.ts` each have one: a caller that only needs to know
 * "something in the catalogue refused" writes a single
 * `catch (e) { if (e instanceof CatalogError) }` instead of enumerating four
 * class names it will forget to extend when the fifth is added. Anything finer
 * — *which* refusal, and therefore which status code and which words — means
 * checking the concrete subclass, which is why the per-class fields below exist
 * rather than being flattened into a message string somebody downstream would
 * have to parse back out.
 *
 * `this.name = new.target.name` for the same reason `ChainError` does it:
 * subclassing a built-in leaves `name` reading `"Error"` on every subclass, so
 * a log line or a Sentry title says nothing about what actually happened.
 * `new.target` is the constructor that was actually `new`-ed, so each subclass
 * gets its own name without restating it.
 *
 * ⚠️ These are plain `Error`s and NOT `HttpException` subclasses. That is the
 * same deliberate split `ledger.errors.ts` and `auth/errors.ts` document at
 * length, and it matters more here than anywhere else in the codebase, because
 * this feature's status mapping is genuinely non-obvious: the *same*
 * "you are not the owner" condition is a `403` on `POST /agents/:id/versions`
 * and a `404` on `GET /agents/:id/versions` ([contracts §7]) — the second must
 * not reveal that the agent exists. A service that threw `ForbiddenException`
 * directly would have made that decision at the throw site, where only one of
 * the two routes is in view. Throwing `NotAgentOwnerError` and letting each
 * controller decide keeps the whole mapping readable in one place, which is the
 * only way that asymmetry stays deliberate rather than becoming a leak.
 */
export abstract class CatalogError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/**
 * The agent asked for is not available to this caller on this route.
 *
 * ⚠️ **Deliberately one error for three different underlying facts.** The row
 * does not exist; the row exists but `active` is `false`; the row exists but
 * has a NULL `onchain_agent_id` (a listing whose `registerAgent` never
 * confirmed). The public views must not distinguish them — contracts §8 maps
 * "not found, inactive, unregistered" onto a single `404`, and §7 adds
 * "not yours" to the same bucket. Splitting this into three classes would
 * invite a well-meaning controller to say *which* one it was, and each of those
 * sentences is an existence oracle: "this agent is currently inactive" confirms
 * to a stranger that the id is real and tells them a seller paused it.
 *
 * That is also why this error is thrown for an agent the caller *could* have
 * seen a moment ago. A buyer holding a stale id from a listing page gets the
 * same `404` as someone enumerating uuids, and there is nothing to distinguish
 * between them from inside the service.
 *
 * `agentId` is the Postgres uuid as it arrived on the path, carried so a log
 * line names the id without the message string being the only record of it.
 *
 * Caller action: `404`. Never a `403`, and never a body that hints at which of
 * the three cases applied.
 *
 * ⚠️ Not to be confused with `chain/errors.ts`'s `AgentNotFoundError`, which is
 * a different class in a different hierarchy: that one is raised by a *read of
 * the escrow* and carries a `bigint` on-chain id. This one carries a `string`
 * uuid and is raised by the database layer. A file that needs both must alias
 * one of them on import; `instanceof CatalogError` will never match the chain's.
 */
export class AgentNotFoundError extends CatalogError {
  constructor(
    message: string,
    public readonly agentId: string,
  ) {
    super(message);
  }
}

/**
 * The caller is authenticated, the agent exists, and it belongs to somebody
 * else. Distinct from `AgentNotFoundError` because on the write routes the
 * distinction is safe to make and useful to make: contracts §5 and §6 return
 * `403` there, on the reasoning that a seller reaching
 * `POST /agents/:id/versions` already holds the id from their own list, so
 * confirming the agent exists tells them nothing they did not bring with them.
 *
 * ⚠️ **That reasoning does not transfer to `GET /agents/:id/versions`.** That
 * route's whole purpose is disclosure — it is the one place `systemPrompt` is
 * emitted — so a `403` there would turn it into an existence oracle for other
 * sellers' agent ids (contracts §7, FR-029). The service may still throw *this*
 * class from that path; it is the controller's job to render it as a `404`
 * there and a `403` on the writes. Keeping that choice in the controller is
 * precisely why these are not `HttpException`s (see `CatalogError` above).
 *
 * `agentId` rides along so an audit log can record which agent a caller was
 * refused access to — the one genuinely interesting thing about this error.
 *
 * Caller action: `403` on §5 and §6; `404` on §7. Do not retry; ownership does
 * not change.
 */
export class NotAgentOwnerError extends CatalogError {
  constructor(
    message: string,
    public readonly agentId: string,
  ) {
    super(message);
  }
}

/**
 * The agent exists and the caller owns it, but its `onchain_agent_id` is NULL —
 * so there is no on-chain agent to update, and the requested write cannot be
 * carried out.
 *
 * This is the residue of contracts §4's receipt-timeout branch: a `registerAgent`
 * whose transaction was broadcast but whose receipt never arrived leaves the
 * agent row and version 1 committed with a NULL on-chain id, on purpose,
 * because the transaction may still confirm and deleting the row would orphan a
 * live on-chain agent with no record anywhere. The row is therefore real,
 * visible to its owner, and *unusable* by `POST /agents/:id/versions` and
 * `PATCH /agents/:id/active`, both of which must call the escrow with an id
 * that does not exist yet.
 *
 * Separate from `AgentNotFoundError` because the owner's own views deliberately
 * do show these rows (they carry `listed: false`), and because the answer is
 * not "this does not exist" — it is "this is not finished". A seller who is
 * told `404` for an agent their dashboard is currently rendering has been told
 * something false.
 *
 * ⚠️ **Never resolve this by calling `registerAgent` again.** The contract
 * assigns a *new* id on every registration, so a retry leaves the seller owning
 * two on-chain agents, one of them permanently unreachable (contracts §4).
 * Reconciliation is by looking the logged tx hash up and writing the id that
 * transaction actually produced — out of scope for this feature by decision
 * (research, Open items), not by omission.
 *
 * Caller action: `409`, not `404` and not `400`. The payload was well-formed
 * and the state is what conflicts, which is the distinction contracts §8 makes
 * load-bearing for the UI: a `409` is worth retrying once the state changes.
 */
export class AgentNotRegisteredError extends CatalogError {
  constructor(
    message: string,
    public readonly agentId: string,
  ) {
    super(message);
  }
}

/**
 * A submitted `inputSchema` or `outputSchema` is not a usable JSON Schema.
 * Raised by `assertValidJsonSchema` in `./schema-validation.ts`.
 *
 * **Why the field name is a typed field and not just words in the message.**
 * FR-008 requires the refusal to name which of the two schemas was wrong, and
 * both arrive in the same request body. Carrying `field` as
 * `'inputSchema' | 'outputSchema'` means the controller builds
 * `{ fieldErrors: { [err.field]: [err.detail] } }` — the shape the rest of the
 * API already produces for a Zod failure — without re-running validation to
 * find out which one it was, and without a regex over a human-readable string.
 * The union type also means a third schema field added later fails to compile
 * here rather than silently producing an unnamed error.
 *
 * `detail` is Ajv's own message, unedited. Rewording it would lose the JSON
 * Pointer that tells the seller *where* in a hundred-line schema the problem
 * is, and Ajv's phrasing for the two failure modes is already the useful part:
 * a meta-schema violation reads like `data/properties/x/type must be equal to
 * one of the allowed values`, and an unresolvable `$ref` reads
 * `can't resolve reference #/$defs/Missing from id #`. Neither is something
 * this module could say better.
 *
 * Caller action: `400`, naming `field`. This is never transient — the identical
 * body will be refused identically until the seller edits the schema.
 */
export class InvalidJsonSchemaError extends CatalogError {
  constructor(
    message: string,
    public readonly field: 'inputSchema' | 'outputSchema',
    public readonly detail: string,
  ) {
    super(message);
  }
}
