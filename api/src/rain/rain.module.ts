import { Module } from '@nestjs/common';

import { RainController } from './rain.controller';
import { RainStubService } from './rain-stub.service';

/**
 * The provider integration, kept in the codebase and switched off.
 *
 * Two files and no exports, which is the correct size for what this is: Rain
 * confirmed Monad is not a supported payment-route rail and is not planned, so
 * §0 of `docs/rain-integration.md` decided to stub rather than delete. The
 * module is the boundary that makes the stub obvious — everything that pretends
 * to talk to Rain is in `src/rain/`, and nothing else in the backend imports
 * from it.
 *
 * **`exports: []`, deliberately.** No other module may reach `RainStubService`.
 * Funding is a funder-wallet transfer plus a ledger entry (§0.2) and belongs to
 * the accounts/ledger path; if a top-up handler could inject this service,
 * "call Rain here later" becomes an import edge that exists today and does
 * nothing, which is precisely the accidental-mock failure §0.1 is written to
 * avoid. The service has exactly one caller, its own controller.
 *
 * **No `imports`.** `ConfigModule` is global (see `app.module.ts`), so
 * `ConfigService` injects without one, and there is no `HttpModule` here on
 * purpose — see the ⚠️ in `rain-stub.service.ts`. A module list that stays
 * empty is the cheapest possible evidence that nothing in here can reach the
 * network.
 *
 * ⚠️ Registration in `src/app.module.ts` is not done here and is the one thing
 * still needed for these routes to exist (T048).
 */
@Module({
  controllers: [RainController],
  providers: [RainStubService],
})
export class RainModule {}
