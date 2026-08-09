import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';

import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { routeRequestSchema, type RouteRequest } from './dto/route-request.dto';
import { RainStubService, type RainStubResponse } from './rain-stub.service';

/**
 * The two fiat rails, present and honest about not working.
 *
 * They take a real request, build the real Rain payload, log it, and return a
 * body that says in its first two keys that nothing was called. Money moves
 * through the funder wallet instead (`docs/rain-integration.md` §0.2); these
 * exist so the integration is visible in running code and so the demo can show
 * the exact call that cannot complete, and why
 * (§0.1, `specs/005-accounts-ledger-funding/research.md` R10).
 *
 * ⚠️ **`200`, and the `@HttpCode` is load-bearing.** Nest answers `201` to a
 * `POST` by default, and contracts §6 fixes these at `200`; without the
 * decorator the status is silently wrong. The `200` itself is the deliberate
 * call: *"never fake a `200 OK`"* governs the **body**, and the object of that
 * rule is the fake success payload — which is exactly what `stub: true`,
 * `rainCallMade: false` and the absence of any `id`/`status`/`routeId` field
 * refuse to produce. A `4xx` or `5xx` would report a working endpoint as broken
 * and push a caller into retry-and-alert behaviour over a route that did
 * precisely what it was built to do. There is no client to mislead in either
 * direction: `ui/specs/006-wallet-page/contracts/internal-api.md` confirms no
 * screen calls these at all.
 *
 * ⚠️ **Neither handler carries `@Public()`, on purpose.** The global guard is
 * fail-closed, so silence here means "protected", and that is the intended
 * state — FR-036 requires an authenticated session for every endpoint in this
 * feature without carving out the ones that move nothing. These move no money,
 * but they read configuration, name the operator address in their response, and
 * write a log line on demand; none of that is anonymous-public. `@Public()` is
 * reserved for the two endpoints that cannot possibly present a credential —
 * `auth/nonce` and `auth/verify` — and every use of it elsewhere would be one
 * more thing to re-audit.
 *
 * Paths are `onramp/routes` and `offramp/routes` off the root, so
 * `@Controller()` takes no prefix: the two are siblings under different
 * top-level nouns and no shared prefix exists to hoist.
 */
@Controller()
export class RainController {
  constructor(private readonly rain: RainStubService) {}

  /**
   * The fiat → USDC route Rain would create. Logs the payload; calls nothing.
   *
   * The pipe is attached per-parameter, the house idiom (`auth.controller.ts`,
   * `zod-validation.pipe.ts`): the schema governing the body is readable at the
   * handler that receives it, and a malformed amount is refused with a `400`
   * before any payload is assembled or logged.
   */
  @Post('onramp/routes')
  @HttpCode(HttpStatus.OK)
  onrampRoute(
    @Body(new ZodValidationPipe(routeRequestSchema)) body: RouteRequest,
  ): RainStubResponse {
    return this.rain.onrampRoute(body.amountMinor);
  }

  /**
   * The USDC → fiat route Rain would create, plus the deposit address it would
   * have returned — the funder wallet, which is where cashed-out test USDC
   * actually goes (§0.3).
   */
  @Post('offramp/routes')
  @HttpCode(HttpStatus.OK)
  offrampRoute(
    @Body(new ZodValidationPipe(routeRequestSchema)) body: RouteRequest,
  ): RainStubResponse {
    return this.rain.offrampRoute(body.amountMinor);
  }
}
