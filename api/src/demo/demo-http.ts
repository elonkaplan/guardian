import {
  ConflictException,
  type HttpException,
  InternalServerErrorException,
} from '@nestjs/common';

import { toHttpException as chainToHttpException } from '../common/chain-http';
import {
  DemoAgentUnregisteredError,
  DemoDefinitionUnusableError,
  DemoError,
} from './demo.errors';

/**
 * The single place a demo error becomes an HTTP response.
 *
 * Same argument `catalog/catalog-http.ts` and `common/chain-http.ts` make: the
 * services throw plain errors, so the cause-to-status mapping is one reviewable
 * function rather than a decision repeated at every throw site.
 *
 * Both mappings here carry the **whole** error message into the body, which is a
 * deliberate departure from the catalogue's terse `'Agent not found'`. The
 * reason is who is reading: these two routes have no session and no UI in front
 * of them, and their audience is an operator with a terminal, mid-rehearsal. The
 * messages contain no user data and nothing about anyone else's account — they
 * describe the state of the demo rig — so there is nothing here to withhold, and
 * a response that says only "conflict" would send that operator to the logs for
 * information this feature already knows.
 *
 * (`specs/011-demo-seed-fixtures/contracts/demo-api.md` §1.2.)
 */
export function toHttpException(err: unknown): HttpException {
  // `409`, not `502`: nothing failed just now. A seeded agent exists whose
  // `registerAgent` outcome was never determined, and the fix is a human
  // reconciling it against the chain — never another call, which would mint a
  // second on-chain agent.
  if (err instanceof DemoAgentUnregisteredError) {
    return new ConflictException({
      error: 'demo-agent-unregistered',
      message: err.message,
      agentId: err.agentId,
    });
  }

  // `500` rather than `400`: no request body reached this. A seeded definition
  // that the model service would refuse is a defect in this repository's own
  // content, and the caller cannot fix it by asking differently. The pointer is
  // in the body because it names the exact object to edit.
  if (err instanceof DemoDefinitionUnusableError) {
    return new InternalServerErrorException({
      error: 'demo-definition-unusable',
      message: err.message,
      field: err.field,
      pointer: err.pointer,
    });
  }

  if (err instanceof DemoError) {
    // A subclass added later that nobody mapped. Rethrowing puts the stack in
    // the log and lets Nest answer `500`, which is the honest response to "we
    // added an error and forgot to classify it" — better than guessing a status
    // that claims to know whose fault it was.
    throw err;
  }

  // Chain failures from `registerAgent` / `updateAgent` — `502`, with the
  // `ChainOutcomeUnknownError`-first ordering and the `txHash` in the body, all
  // of which lives in one place for the whole application.
  return chainToHttpException(err);
}
