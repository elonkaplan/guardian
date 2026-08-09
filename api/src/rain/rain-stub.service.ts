import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { AppConfig } from '../config/env.schema';
import {
  buildOfframpRoutePayload,
  buildOnrampRoutePayload,
  type RainPayloadConfig,
  type RainRequest,
} from './rain-payloads';

/**
 * The stub response, and the reason its keys are in this order.
 *
 * ⚠️ **`stub` and `rainCallMade` are first, and that is a requirement rather
 * than a preference** (`contracts/internal-api.md` §6, research R10). Both
 * `JSON.stringify` and `util.inspect` emit string keys in insertion order, so
 * declaring them first here is what puts them on the first line of a `curl |
 * jq` and on the first line of the log. Someone skimming a terminal mid-demo
 * reads the top of an object and stops; if `reason` came first they would read
 * a sentence about Monad and could still walk away thinking a call was made.
 * Two booleans at the top cannot be misread.
 *
 * ⚠️ **There is no `id`, no `status`, and no `routeId`, and none may be
 * added.** Those are the field names a Rain success response carries (§7,
 * *State Variables*: `PAYMENT_ROUTE_ID` comes from `response.id`), and the
 * failure mode being designed out is a screenshot of this JSON being mistaken
 * for a working integration — by us, later, more likely than by anyone else.
 * `docs/rain-integration.md` §0.1 puts it plainly: "a stub that logs is
 * obviously a stub. A mock that returns fake success is a thing you forget
 * about and accidentally demo."
 *
 * The literal types `true` and `false` — not `boolean` — mean a future edit
 * that flips either one has to change this interface too, in a file whose whole
 * subject is that no call is made.
 */
export interface RainStubResponse {
  /** Always `true`. Nothing here talked to Rain. */
  stub: true;
  /** Always `false`. Not "failed", not "retried" — never attempted. */
  rainCallMade: false;
  /** Why not, in a sentence, including the `RAIN_ENABLED` value. */
  reason: string;
  /** The request Rain would have received, verbatim. No headers — see `rain-payloads.ts`. */
  wouldHaveSent: RainRequest;
  /**
   * Offramp only, and absent (not `undefined`) on the onramp — see
   * `offrampRoute`.
   */
  depositAddress?: string;
}

/**
 * Assembles the Rain call, logs it, and returns without making it.
 *
 * **The whole service is the §0 decision made executable.** Rain confirmed
 * Monad is not a supported payment-route rail and is not planned
 * (`docs/rain-integration.md` §1.1), so the honest implementation is one that
 * shows the call it cannot complete. Funding really happens elsewhere — a
 * funder wallet holding faucet-minted USDC (§0.2) — and these two endpoints
 * exist so the fiat rails are documented in running code rather than only in
 * prose.
 *
 * ⚠️ **No network call, by construction.** There is no `fetch`, no `axios`, no
 * `HttpModule`, and nothing imported here that could reach one: the imports are
 * Nest's `Injectable`/`Logger`, `ConfigService`, and a file of pure functions.
 * Adding an HTTP client to this file would not be a refactor, it would be a
 * change of behaviour — the endpoints answer `200` on a host that cannot route
 * to `RAIN_BASE_URL` at all, and quickstart §8 verifies exactly that.
 *
 * ⚠️ **`RAIN_ENABLED` is read and reported, and deliberately does not
 * branch.** (research R10.) The live path is not written, so `if (enabled)
 * { … }` would have nothing to guard: flipping the flag to `true` would
 * silently change nothing, which is the worst of the three options — worse than
 * honouring it, and worse than ignoring it visibly. Reporting its value inside
 * `reason` makes the setting observable in every response and every log line,
 * so "we turned it on and nothing happened" becomes "the response says
 * `RAIN_ENABLED=true` and still says `rainCallMade: false`, so the live path
 * does not exist yet". The flag stays configuration rather than decoration
 * (FR-034), and the day a Monad rail ships it becomes the branch it looks like.
 */
@Injectable()
export class RainStubService {
  /**
   * Named `RainStub` rather than `RainStubService` — the log prefix is read
   * dozens of times per demo and the suffix carries no information. Matches
   * `ChainPreflightService`, which logs as `ChainPreflight`.
   */
  private readonly logger = new Logger('RainStub');

  constructor(private readonly config: ConfigService<AppConfig, true>) {}

  /**
   * The onramp route Rain would create: fiat in, USDC to the operator pool.
   *
   * ⚠️ **No `depositAddress` key at all**, not `depositAddress: undefined`.
   * The two are indistinguishable over JSON — `JSON.stringify` drops undefined
   * members — but they are very distinguishable in a terminal, where Nest's
   * logger and Node's REPL both print `depositAddress: undefined`. On the
   * onramp there is nothing for a user to send funds to (money would arrive
   * from a bank, not go out to an address), and a visible empty field invites
   * the reading that one is missing.
   */
  onrampRoute(amountMinor: number): RainStubResponse {
    const wouldHaveSent = buildOnrampRoutePayload(
      this.payloadConfig(),
      amountMinor,
    );
    this.logRefusal('onramp', wouldHaveSent);

    return {
      stub: true,
      rainCallMade: false,
      reason: this.reason(),
      wouldHaveSent,
    };
  }

  /**
   * The offramp route Rain would create, plus the deposit address it would
   * have handed back.
   *
   * **Why `FUNDER_ADDRESS` is the right stand-in.** It is not a placeholder —
   * it is the same shape the real provider returns, wired to a wallet that
   * behaves the same way. Rain's offramp gives you a deposit address, you send
   * USDC to it, and fiat arrives in your bank. Here the funder wallet *is* "the
   * outside world" (`docs/rain-integration.md` §0.3): money enters the system
   * from it on a top-up and leaves back into it on a cash-out, which closes the
   * loop and makes the funder's balance a live health check — it should fall as
   * users top up and rise as they cash out, and one-directional drift means
   * something is wrong.
   *
   * So a client that took this `depositAddress` at face value and sent test
   * USDC to it would be doing the correct thing, which is the standard a stub
   * has to meet before it is worth returning a value at all.
   */
  offrampRoute(amountMinor: number): RainStubResponse {
    const wouldHaveSent = buildOfframpRoutePayload(
      this.payloadConfig(),
      amountMinor,
    );
    this.logRefusal('offramp', wouldHaveSent);

    return {
      stub: true,
      rainCallMade: false,
      reason: this.reason(),
      wouldHaveSent,
      depositAddress: this.config.get('FUNDER_ADDRESS', { infer: true }),
    };
  }

  /**
   * One `WARN` per call, carrying the complete payload.
   *
   * ⚠️ **`warn`, not `log` — the level is a product requirement here, not
   * style.** (contracts §6, research R10, quickstart §8.) The demo's claim is
   * "we integrated until we hit a real limitation, and here it is", and the
   * evidence for it has to be legible off a console that is also carrying
   * request logs, TypeORM chatter and the sweeper. `LOG` scrolls past. `WARN`
   * is yellow, and the thing it is warning about is true: an endpoint was
   * called and it did not do what its name says. Anyone tempted to demote this
   * to `debug` because it is noisy should note that the noise *is* the feature.
   *
   * ⚠️ **`JSON.stringify`, not the object.** Nest's `ConsoleLogger` renders a
   * non-string argument through `util.inspect`, whose default depth is 2 —
   * which collapses `body.destination.address` to `[Object]` and hides the
   * `address` inside it. Worse for the point of the exercise, deeply nested
   * values are the first thing an inspector truncates, and `destination.rail:
   * 'monad'` is the single field the whole log line exists to show.
   * Stringifying also makes the line greppable, which quickstart §8's
   * `grep -F "$RAIN_API_KEY"` check depends on.
   *
   * The stringified object is `wouldHaveSent` and nothing else: a body with no
   * secret in it and a type with no `headers` member (see `rain-payloads.ts`),
   * so FR-035 needs no redaction step here.
   */
  private logRefusal(direction: 'onramp' | 'offramp', request: RainRequest) {
    this.logger.warn(
      `${direction} route NOT sent — ${this.reason()}. Would have sent: ${JSON.stringify(request)}`,
    );
  }

  /**
   * The sentence that appears both in the log and in the response body.
   *
   * Two facts, one line: the blocking limitation, and the current value of the
   * flag that would nominally control the integration. Reading it off
   * configuration on every call rather than caching it at construction means a
   * changed environment shows up in the next response instead of at the next
   * restart — which matters precisely because nobody would think to restart for
   * a flag that does not branch.
   */
  private reason(): string {
    const enabled = this.config.get('RAIN_ENABLED', { infer: true });
    return `Monad is not a supported payment-route rail; RAIN_ENABLED=${String(enabled)}`;
  }

  /**
   * The configuration slice the payload builders take.
   *
   * Assembled per call rather than in the constructor for the same reason
   * `reason()` is: configuration is read where it is used, so nothing is stale.
   * These are five string reads out of an already-parsed object — there is no
   * cost to weigh against it.
   *
   * ⚠️ `RAIN_API_KEY` is absent, and `RainPayloadConfig` cannot accept it. The
   * key is an `Api-Key` header on a request this code never makes.
   */
  private payloadConfig(): RainPayloadConfig {
    return {
      RAIN_BASE_URL: this.config.get('RAIN_BASE_URL', { infer: true }),
      RAIN_TEAM_ID: this.config.get('RAIN_TEAM_ID', { infer: true }),
      RAIN_USER_ID: this.config.get('RAIN_USER_ID', { infer: true }),
      RAIN_COLLATERAL_CONTRACT_ID: this.config.get(
        'RAIN_COLLATERAL_CONTRACT_ID',
        { infer: true },
      ),
      OPERATOR_ADDRESS: this.config.get('OPERATOR_ADDRESS', { infer: true }),
    };
  }
}
