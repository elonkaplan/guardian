import { z } from 'zod';

import { amountMinorSchema } from '../../common/amount.schema';

/**
 * The body of **both** `POST /agents` and `POST /agents/:id/versions`
 * (`specs/006-agent-catalogue/contracts/internal-api.md` §4 and §5).
 *
 * **One schema, two routes, on purpose.** §5 says "same body as `POST /agents`"
 * in as many words, and it says so because the two routes write the *same row*:
 * an agent version is an agent version whether it is the first one or the
 * eleventh. The difference between the routes is entirely in what surrounds the
 * write — ownership, `registerAgent` versus `updateAgent`, the response shape —
 * and none of that is expressible in the body. Two schemas here would be two
 * places for "what a definition is" to drift, and the drift would land on the
 * one thing a dispute is judged against.
 *
 * ⚠️ **Every field name is literal.** `ui/specs/007-seller-pages/data-model.md`
 * §1.4 declares `CreateAgentRequest` with exactly these strings (minus the two
 * documented below), and the seller's form is already written against them. A
 * renamed key does not fail loudly — it arrives as `undefined`, so `name` becomes
 * a missing-field `400` on a form that visibly had a name in it. Copy from the
 * contract rather than retyping from memory; this schema and that interface must
 * stay in step.
 *
 * ⚠️ **`active` is deliberately NOT accepted, and the absence is the design.**
 * `agents.active` defaults to `true`, so a client-supplied value here would be a
 * second authority over whether a brand-new listing is live — two sources for
 * one fact, which is how a listing ends up live in the database and dark in the
 * UI. Availability is changed afterwards, deliberately and by its own route,
 * `PATCH /agents/:id/active` (§6). Adding `active` to this object would not be a
 * convenience; it would be a second way in.
 *
 * ⚠️ **There is no `ownerAccountId` either.** The caller *is* the owner (§4);
 * a body that could name someone else would let one seller publish under
 * another's account.
 *
 * **Why validation is split between here and Ajv.** `inputSchema` and
 * `outputSchema` are checked for *shape* here — "is this a JSON object at all" —
 * and for *schema-ness* — "does this validate as JSON Schema 2020-12" — by
 * `assertValidJsonSchema` in `src/catalog/schema-validation.ts`, called from the
 * service. The split is not an accident of who wrote what:
 *
 *  - Zod guards the HTTP boundary. A string, a number or an array where an
 *    object belongs is a malformed body, and it should be refused before the
 *    handler is entered — the argument `zod-validation.pipe.ts` makes in full.
 *  - Ajv answers a question about meaning, not shape. `{ "type": "banana" }` is
 *    a perfectly good JSON object and a nonsense schema, and saying so requires
 *    a JSON Schema implementation. Rebuilding that in Zod would be writing a
 *    second, worse Ajv; calling Ajv from inside a Zod refinement would bury a
 *    meta-schema compile inside a parse and make the field-naming that FR-008
 *    requires (`400`, naming `inputSchema`) harder rather than easier.
 *
 * So this file deliberately does **not** import `schema-validation.ts`. Passing
 * this schema means the body is well-formed, not that the definition is valid.
 *
 * (research R15 for `priceMinor`, R14 for why the database check is a backstop
 * rather than the guard)
 */
export const createAgentSchema = z.object({
  /**
   * ⚠️ `.trim().min(1)` and not `.min(1)` — the order matters and it is checked
   * in that order. A name of three spaces is a name the seller did not type,
   * and it renders in the catalogue as a blank row that cannot be clicked with
   * any confidence. Trimming first turns it into the `400` it always was.
   */
  name: z.string().trim().min(1),

  /** Same rule, same reason: whitespace is not a description. */
  description: z.string().trim().min(1),

  /**
   * Half of Guardian's yardstick. **MAY be empty, never absent** — the column
   * is `NOT NULL` and the entity says the same thing.
   *
   * ⚠️ No `.default([])`. An empty array is a seller who claims nothing, which
   * is a legitimate (if unwise) listing; an absent key is a client that forgot
   * the field, and defaulting it silently would turn a bug in the form into a
   * published agent with no claims. The contract says "may be empty", not "may
   * be omitted".
   */
  capabilities: z.array(z.string()),

  /**
   * The other, defensive half — what the agent explicitly does not do. Same
   * rule as `capabilities` for the same reason.
   */
  exclusions: z.array(z.string()),

  /**
   * Whole USD cents. **Reused, not redefined** (research R15): this is the same
   * `amountMinorSchema` that guards `POST /topup` and `POST /offramp`, and it
   * is already exactly what FR-009 asks for — positive, whole, safe integer,
   * cents. A second money schema in a second module is how two money rules
   * start disagreeing, and the copy that drifts is always the one guarding
   * money.
   *
   * ⚠️ Cents, never dollars. `12.34` is a non-integer here and it is refused.
   */
  priceMinor: amountMinorSchema,

  /**
   * The shape a buyer's input must satisfy. **Structural check only** — an
   * object with string keys, which is what `jsonb` will hold and what the
   * entity types as `Record<string, unknown>`.
   *
   * ⚠️ Passing this does **not** mean it is a valid JSON Schema. That question
   * belongs to `assertValidJsonSchema` in the service (see the docblock above);
   * this line rejects `"hello"`, `42` and `[]`, and nothing subtler.
   */
  inputSchema: z.record(z.string(), z.unknown()),

  /**
   * The load-bearing one — it is what a run's output is validated against, so
   * it is the half of the definition a non-delivery claim is measured with.
   * Same structural-only check, same Ajv follow-up naming `outputSchema`.
   */
  outputSchema: z.record(z.string(), z.unknown()),

  /**
   * ⚠️ RESTRICTED — seller IP. It arrives here and it must never leave: no
   * buyer-facing response type in `agent-listing.dto.ts` has anywhere to put
   * it, and that is the enforcement (entity docblock, research R9). Accepting
   * it is not the same as being allowed to echo it.
   */
  systemPrompt: z.string().trim().min(1),

  /**
   * e.g. `claude-haiku-4-5`. **Free text, no allowlist**, deliberately.
   *
   * The platform is not the authority on which models a seller may pick.
   * `docs/tech-stack.md` names two, but naming is not restricting: an allowlist
   * here would mean every new model release is a backend deploy before any
   * seller can use it, and the failure mode of getting it wrong is refusing a
   * valid listing rather than accepting an invalid one. A model string that
   * does not resolve fails at run time, where the run is the thing that failed
   * and the dispute machinery already knows what to do about it.
   */
  model: z.string().trim().min(1),

  /**
   * Seconds, beyond which the run counts as non-delivery.
   *
   * `.default(120)` mirrors `agent_versions.timeout_seconds DEFAULT 120`
   * exactly. The default lives in both places on purpose: the column's default
   * is what protects a row inserted by anything that is not this route, and
   * this one is what makes the parsed body a complete definition, so the
   * service and the hash never see `undefined` where a number belongs.
   *
   * ⚠️ Optional on the wire, **required after parsing**. `CreateAgentDto` is the
   * schema's *output* type, so `timeoutSeconds` is `number` there and not
   * `number | undefined` — which matters, because this value feeds the
   * canonical definition that is hashed, and a hash over `undefined` is a hash
   * nobody can reproduce.
   *
   * `ui/specs/007-seller-pages/data-model.md` §1.4 omits the field entirely and
   * the seller's form does not collect it; that omission is honoured here
   * rather than worked around.
   */
  timeoutSeconds: z.number().int().positive().default(120),
});

/**
 * The parsed body. Inferred rather than declared, so the type cannot disagree
 * with the schema that produced it — there is no second place to update, and no
 * chance of a hand-written interface still listing a field the schema stopped
 * accepting.
 *
 * ⚠️ This is the **output** type: `timeoutSeconds` is present and `number`,
 * because `.default(120)` has already run by the time a handler holds one of
 * these.
 */
export type CreateAgentDto = z.infer<typeof createAgentSchema>;
