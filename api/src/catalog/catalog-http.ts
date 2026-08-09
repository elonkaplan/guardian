import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  type HttpException,
  NotFoundException,
} from '@nestjs/common';

import { toHttpException as chainToHttpException } from '../common/chain-http';
import {
  AgentNotFoundError,
  AgentNotRegisteredError,
  CatalogError,
  InvalidJsonSchemaError,
  NotAgentOwnerError,
} from './catalog.errors';

/**
 * The single place a catalogue error becomes an HTTP response.
 *
 * Same argument `common/chain-http.ts` makes for the chain family, applied to
 * this module: the services throw plain errors so that the cause-to-status
 * mapping lives in one reviewable location rather than at every throw site.
 *
 * ⚠️ **`NotAgentOwnerError` is `403` here and `404` at one route, and the
 * difference is a security decision rather than an inconsistency.**
 * `POST /agents/:id/versions` and `PATCH /agents/:id/active` answer `403`,
 * because the caller already holds that agent id — it came from their own list,
 * and confirming it exists tells them nothing new. `GET /agents/:id/versions`
 * answers `404`, because a `403` there would make the endpoint an existence
 * oracle: any seller could probe uuids and learn which ones are real agents
 * belonging to someone else (spec FR-029).
 *
 * That is why this function maps the error to `403` and the versions route
 * catches `NotAgentOwnerError` *before* calling it. The narrow mapping lives
 * here; the one exception lives at the route that needs it, where it is visible
 * next to the handler it protects.
 *
 * Chain failures are delegated to `chain-http.ts` unchanged, which keeps the
 * `ChainOutcomeUnknownError`-first ordering — and the `txHash` in its body — in
 * exactly one place for the whole application.
 */
export function toHttpException(err: unknown): HttpException {
  // A seller's schema was not a schema. `400`, naming which of the two fields
  // was at fault — the whole reason `InvalidJsonSchemaError` carries `field`
  // rather than folding it into a message the controller would have to parse.
  if (err instanceof InvalidJsonSchemaError) {
    return new BadRequestException({
      message: err.message,
      fieldErrors: { [err.field]: [err.detail] },
    });
  }

  // Unknown, inactive, or unregistered — the public queries cannot tell these
  // apart and must not, so neither does this.
  if (err instanceof AgentNotFoundError) {
    return new NotFoundException('Agent not found');
  }

  if (err instanceof NotAgentOwnerError) {
    return new ForbiddenException('Not your agent');
  }

  // `409`, not `502`: nothing was attempted and nothing is wrong upstream. The
  // agent simply has no on-chain counterpart to update, because its
  // registration outcome is unknown. Contracts §8 fixes this split — `409`
  // means nothing was attempted, `502` means the chain leg failed.
  if (err instanceof AgentNotRegisteredError) {
    return new ConflictException(
      'Agent is not registered on-chain and cannot be updated. ' +
        'Its registration did not complete; list it again.',
    );
  }

  if (err instanceof CatalogError) {
    // A subclass added later that nobody mapped. `400` would claim the caller
    // can fix it and `502` would blame the chain; neither is known to be true,
    // so this falls through to the chain mapper's rethrow and Nest's default
    // `500` — which is the honest answer for "we added an error and forgot to
    // classify it", and it puts the stack in the log.
    throw err;
  }

  // Chain errors, and the rethrow for everything that is nobody's to translate.
  return chainToHttpException(err);
}
