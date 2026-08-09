import { z } from 'zod';

import { amountMinorSchema } from '../../common/amount.schema';

/**
 * The body both route stubs take: `{ amountMinor }`, whole US cents.
 *
 * **Why validate an amount that only ends up in a log.** Because the log *is*
 * the deliverable (`docs/rain-integration.md` §0.1) — the point of these
 * endpoints is to show the exact request Rain would receive, and a payload
 * built from `"1e9"`, `12.34` or `-500` is not a request Rain would receive. It
 * is a request Rain would reject at its own boundary, which makes the artefact
 * evidence of nothing. `contracts/internal-api.md` §6 says it in one clause:
 * validated "so the logged payload is realistic".
 *
 * The second reason is that these two are the only endpoints in the feature
 * where an amount is *not* checked again downstream. Everywhere else
 * `units.ts` catches a bad figure as a backstop; here nothing does, because
 * nothing happens. Skipping the schema would make the stubs the one place a
 * nonsense amount is accepted silently, and "the endpoint that does nothing is
 * also the endpoint with no validation" is a rule nobody would defend out loud.
 *
 * `amountMinorSchema` is imported rather than restated — one definition of a
 * valid money amount for the whole backend, the same argument
 * `nonce.dto.ts` makes about reusing one address regex. Cents, never dollars
 * (invariant #2).
 */
export const routeRequestSchema = z.object({
  amountMinor: amountMinorSchema,
});

export type RouteRequest = z.infer<typeof routeRequestSchema>;
