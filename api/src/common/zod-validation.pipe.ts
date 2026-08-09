import {
  BadRequestException,
  type ArgumentMetadata,
  type PipeTransform,
} from '@nestjs/common';
import { z, type ZodType } from 'zod';

/**
 * Validates a request body (or param, or query) against a Zod schema before the
 * handler is entered, and hands the handler the parsed value.
 *
 * **Why Zod and not class-validator.** The project already validates its most
 * safety-critical input — the entire environment — with Zod in
 * `src/config/env.schema.ts`, and refuses to boot when that parse fails. Adding
 * class-validator/class-transformer for HTTP bodies would mean two validation
 * idioms, two error shapes, and two places to look when something is rejected,
 * in exchange for nothing Zod cannot already express. One library, one mental
 * model: a schema is a value, it lives next to the thing it describes, and the
 * inferred type IS the DTO type rather than a decorated class kept in sync with
 * one by hand.
 *
 * **Why this is not a global ValidationPipe.** It is deliberately applied
 * per-parameter — `@Body(new ZodValidationPipe(someSchema))` — so the schema
 * that governs a body is readable at the handler that receives it, not inferred
 * from a decorated class three files away and a pipe registered in `main.ts`.
 * The cost is one explicit construction per route; the benefit is that no
 * endpoint is ever silently unvalidated or silently re-shaped, because nothing
 * happens to a body that the signature does not say out loud.
 *
 * **Why `src/common/` and not `src/auth/`.** Validating a request body is not
 * an auth concept. Auth is the first caller, not the owner: catalog, orders and
 * funding all take bodies too, and a shared pipe reached for via
 * `../auth/...` would be a lie about where it belongs.
 *
 * **Why rejecting before the handler matters here.** For the wallet auth flow
 * this is load-bearing rather than cosmetic. A malformed wallet address must be
 * refused with a 400 and nothing else — no challenge row written, no nonce
 * minted, no signable message returned. If validation lived inside the handler,
 * the natural shape of that code is "issue the challenge, then check the
 * address", and every rejected request would leave a usable artefact behind.
 * Failing at the boundary makes that mistake unavailable.
 */
export class ZodValidationPipe<TSchema extends ZodType>
  implements PipeTransform<unknown, z.output<TSchema>>
{
  // No `@Injectable()`, on purpose. This pipe is always constructed by hand
  // with its schema, so Nest's container can never build one — the decorator
  // would only advertise a wiring path that does not exist.
  constructor(private readonly schema: TSchema) {}

  /**
   * `_metadata` is ignored deliberately. The pipe validates whatever it is
   * pointed at and nothing about its behaviour should depend on whether that
   * happened to be a body, a param or a query — the schema is the whole
   * contract.
   */
  transform(value: unknown, _metadata?: ArgumentMetadata): z.output<TSchema> {
    const result = this.schema.safeParse(value);

    if (!result.success) {
      // `z.flattenError` rather than `result.error.flatten()`: the method form
      // is marked @deprecated in zod 4, and the top-level function is the
      // supported spelling. Both exist in 4.4.3, so this compiles either way
      // today and only one of them will still be here later.
      //
      // Flattened rather than raw `issues`: the client wants "which field, what
      // is wrong with it", and `{ formErrors, fieldErrors }` says exactly that
      // without leaking Zod's internal issue codes into a public API shape.
      //
      // ⚠️ This travels over the wire. Zod's built-in messages describe types
      // ("expected string, received number"), never the value received — the
      // same rule `format-errors.ts` enforces for the environment. A custom
      // `message` that interpolates the input would break that rule here, in a
      // response, which is worse than breaking it in a log.
      throw new BadRequestException({
        message: 'Validation failed',
        errors: z.flattenError(result.error),
      });
    }

    // `result.data`, not `value`. The two differ whenever the schema coerces,
    // trims, defaults or strips unknown keys, and returning the original would
    // quietly hand the handler the unparsed input while the types insist
    // otherwise.
    return result.data;
  }
}
