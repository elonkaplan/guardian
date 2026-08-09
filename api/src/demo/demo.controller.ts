import { Controller, HttpCode, Post } from '@nestjs/common';

import { Public } from '../auth/public.decorator';
import { DemoResetService } from './demo-reset.service';
import { DemoSeedService } from './demo-seed.service';
import { toHttpException } from './demo-http';
import type { ResetResponse } from './dto/reset-response.dto';
import type { SeedResponse } from './dto/seed-response.dto';

/**
 * The demo rig's two routes (`docs/api-design.md` §3.5).
 *
 * ## ⚠️ Both are unauthenticated, and neither has an environment guard
 *
 * That is a recorded decision, not an omission (`docs/api-design.md` §8): you
 * will run the three acts many times, and re-seeding by hand at 3am is how demos
 * get broken. The consequences are accepted deliberately and are contained by
 * three properties rather than by a credential:
 *
 * 1. **Both are safe to call twice.** The seed is idempotent and the reset
 *    clears nothing on an empty database, so a stranger poking at a deployed
 *    instance cannot produce a state the operator could not produce themselves.
 * 2. **Neither response carries seller IP.** The response types are built field
 *    by field and have nowhere to put a `systemPrompt` (invariant #3).
 * 3. **Reset cannot move money.** It makes no chain call at all — there is no
 *    method here that could.
 *
 * The reset *is* destructive to the platform's record of a rehearsal, and the
 * README says so in as many words. Worth remembering this exists if the project
 * ever outlives the hackathon.
 *
 * ⚠️ **`@Public()` is on the handlers, never on the class.** On the class it
 * would apply to every method added later by someone who never read this — the
 * same rule `agents.controller.ts` follows and for the same reason.
 */
@Controller('demo')
export class DemoController {
  constructor(
    private readonly seedService: DemoSeedService,
    private readonly resetService: DemoResetService,
  ) {}

  /**
   * Create the three seller agents, and return the fixtures for driving the acts.
   *
   * ⚠️ **`200`, not `201`.** The call is idempotent and on every run after the
   * first it creates nothing; a `201` would claim otherwise every time. What was
   * created is reported per agent, in `created`.
   *
   * Slow by design — three on-chain registrations, each awaiting its receipt.
   */
  @Post('seed')
  @Public()
  @HttpCode(200)
  async seed(): Promise<SeedResponse> {
    try {
      return await this.seedService.seed();
    } catch (err) {
      throw toHttpException(err);
    }
  }

  /**
   * Clear orders, runs, complaints and verdicts. Keep accounts, the catalogue,
   * and every ledger entry.
   *
   * No error mapping: the service's only failure mode is the database, one
   * transaction rolls all of it back, and Nest's default `500` is the honest
   * answer. Nothing is ever half-cleared.
   */
  @Post('reset')
  @Public()
  @HttpCode(200)
  async reset(): Promise<ResetResponse> {
    return this.resetService.reset();
  }
}
