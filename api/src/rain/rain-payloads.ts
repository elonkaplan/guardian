import type { AppConfig } from '../config/env.schema';

/**
 * The exact HTTP request Rain would have received — assembled, never sent.
 *
 * **Why a payload builder is a deliverable rather than dead code.** Rain
 * confirmed directly that Monad is not a supported payment-route destination
 * rail and is not on the roadmap (`docs/rain-integration.md` §1.1), which
 * closed the one question that could have made the fiat leg work end to end.
 * §0.1 then decided to stub rather than delete, and the first of its three
 * reasons is the reason this file exists: logging the exact payload lets the
 * demo say *"here is the Rain call we would make, and here is precisely why it
 * cannot complete — `destination.rail` is `monad`, and `monad` is not on the
 * list."* At a Rain-hosted hackathon that is a more useful contribution than a
 * half-working integration, because it is feedback on their product from
 * someone who actually tried to use it. A hand-waved "we would have called
 * Rain here" is not that; a byte-accurate request body is.
 *
 * The second reason matters for the code: the shape stays in the repository, so
 * if a Monad rail ever ships this becomes a config change rather than a
 * feature.
 *
 * ⚠️ **`RAIN_API_KEY` is an authentication HEADER, never a body field**, and it
 * is deliberately not imported, read, or referenced anywhere in this file. The
 * vendor guide is explicit — "every request sends the header
 * `Api-Key: $RAIN_API_KEY`" (`docs/rain-integration.md` §7, *Authentication*) —
 * so a key in the body would be wrong even if it were harmless. It is not
 * harmless: `RainStubService` logs the object this file returns, in full, at
 * `warn`. FR-035 ("exclude private keys, session credentials, and other secrets
 * from the logged request bodies") therefore holds **by construction** rather
 * than by a redaction pass — there is no secret in the object being logged, so
 * there is nothing for a redactor to miss and no redactor to forget to run when
 * a field is added later. `RainRequest` carries `method`, `url` and `body`, and
 * no `headers` member, so the type itself refuses the mistake.
 *
 * **Pure functions, no `@Injectable()`.** Nothing here reads a clock, a
 * database, or a network; the whole file is `(config, amount) -> object`. That
 * keeps the payload inspectable without standing up a Nest container, and it
 * keeps the one class in this module — the service — about *logging and
 * refusing*, which is the part that has a policy in it.
 */

/**
 * A request that was assembled and not sent.
 *
 * The three members are exactly what `wouldHaveSent` carries in the stub
 * response (`specs/005-accounts-ledger-funding/contracts/internal-api.md` §6)
 * and exactly what a reader needs to reproduce the call by hand with `curl`:
 * verb, URL, body. Notably absent: `headers`. See the ⚠️ above — that omission
 * is the FR-035 guarantee, not an oversight.
 */
export interface RainRequest {
  method: 'POST';
  url: string;
  body: Record<string, unknown>;
}

/**
 * The slice of configuration a payload is built from.
 *
 * A `Pick<AppConfig, …>` rather than `ConfigService` on purpose: these
 * functions then have no Nest dependency at all, and the type states — in the
 * signature, where a reader looks — the complete list of settings that can
 * influence a payload. `RAIN_API_KEY` is conspicuously not in it, and cannot be
 * added by accident without editing this line.
 *
 * `OPERATOR_ADDRESS` is here alongside the four `RAIN_*` keys because a
 * payment route needs an on-chain endpoint and the operator pool is it: under
 * the top-up money model (`docs/rain-integration.md` §0.2) every user balance
 * is backed by USDC held in the operator pool, so a real onramp would deliver
 * there and a real offramp would draw from there. `FUNDER_ADDRESS` is *not*
 * here — the funder address is what Rain would **return** as `depositAddress`,
 * not something we send, so it belongs to the service's response and not to a
 * request body (§0.3).
 */
export type RainPayloadConfig = Pick<
  AppConfig,
  | 'RAIN_BASE_URL'
  | 'RAIN_TEAM_ID'
  | 'RAIN_USER_ID'
  | 'RAIN_COLLATERAL_CONTRACT_ID'
  | 'OPERATOR_ADDRESS'
>;

/** The vendor's route-creation endpoint (`docs/rain-integration.md` §7, Step 1). */
const PAYMENT_ROUTES_PATH = '/payment-routes';

/**
 * The value that makes the whole call impossible, named out loud.
 *
 * Rain's supported destination rails are ethereum, polygon, optimism,
 * arbitrum, avalanche, base, celo and solana (§1.1). `monad` is not among them
 * and is not planned. This constant is therefore the single most important
 * string in the module: it is the field a reviewer at Rain would look at, and
 * the reason the request is logged instead of sent.
 *
 * ⚠️ Do not "fix" this to `base` to make the payload look acceptable. A payload
 * Rain would accept is a payload that describes a different product — funds
 * landing on Base, where the escrow contract does not exist.
 */
const UNSUPPORTED_DESTINATION_RAIL = 'monad';

/**
 * The fiat side of every route, both directions.
 *
 * Fixed rather than parameterised because the vendor is explicit that it is
 * not a choice: "USD is the only supported currency: the fiat side is always
 * `usd` with rail `ach` or `wire`" (§7, *Notes*). `ach` matches the
 * Configuration block of the vendor's own template.
 */
const FIAT_LEG = { currency: 'usd', rail: 'ach' } as const;

/**
 * Whole US cents → the plain decimal string Rain's API speaks: `1000` → `"10.00"`.
 *
 * **Why not `formatCents` from `src/common/format-money.ts`.** That produces
 * `"$10.00"`, correct for a sentence shown to a person and wrong inside a JSON
 * request body — the vendor's simulate body is `{"amount": "100"}`, a bare
 * number-as-string, and a leading `$` would be a validation error at the other
 * end. Two formatters exist because they have two audiences; reusing the
 * human-facing one here would produce a payload that is *not* the one Rain
 * would receive, which defeats the entire point of the file.
 *
 * **Why not `amountMinor / 100`.** Because the result is a `number` and this
 * field is a string, and the conversion to one is where floats bite: `String()`
 * on a float drops trailing zeros (`10.5`, never `10.50`) and switches to
 * exponent notation past 1e21. Integer division and a `padStart` remainder
 * cannot do either — the same argument, and the same technique, as
 * `formatCents`.
 *
 * Callers hand this a value already parsed by `amountMinorSchema`, so it is a
 * positive safe integer by the time it arrives; there is no negative branch
 * here because a negative amount cannot reach it.
 */
function usdAmountString(amountMinor: number): string {
  const dollars = Math.floor(amountMinor / 100);
  const cents = String(amountMinor % 100).padStart(2, '0');
  return `${dollars}.${cents}`;
}

/**
 * `RAIN_BASE_URL` + a path, without the doubled slash.
 *
 * `env.schema.ts` validates `RAIN_BASE_URL` with `z.url()`, which happily
 * accepts both `https://api-dev.raincards.xyz/v1` and the same string with a
 * trailing slash — the two are equally valid URLs and an operator will
 * eventually paste the second one. Naive interpolation would then emit
 * `…/v1//payment-routes`, and the whole value of this module is that the
 * logged URL is the URL you can paste into `curl` and have it work.
 */
function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, '')}${path}`;
}

/**
 * `POST /payment-routes` for an onramp: fiat in, USDC out to the operator pool.
 *
 * The body follows the vendor's Step 1 template verbatim in structure —
 * `userId`, `source`, `destination`, with `destination.address` typed
 * `onchain` — because a payload that does not match their template is not
 * evidence of anything. `teamId` and `collateralContractId` accompany it from
 * configuration: Rain identities are platform-level rather than per end-user
 * (§5, "One platform `userId` for all routes"), so all three are constants of
 * the deployment and are recorded here to make the account the call would be
 * attributed to explicit in the log.
 *
 * `amount` is included even though route *creation* does not itself move money
 * — the vendor's flow spends it one step later, in
 * `POST /simulate/payment-routes` (§7, Step 3). Carrying it means the logged
 * artefact answers "how much" as well as "where to", which is what makes
 * validating the request body worthwhile at all when the value only ends up in
 * a log.
 *
 * ⚠️ `destination.rail` is `monad`. This is the field that cannot be honoured,
 * and it is the point of the exercise — see `UNSUPPORTED_DESTINATION_RAIL`.
 *
 * ⚠️ The $2 simulation minimum (§1.2) is **not** enforced here. It is Rain's
 * rule about simulations, not ours, and the top-up money model dissolved it
 * (§5) — one $100 deposit funds many sub-$2 purchases. Rejecting a $1 request
 * locally would invent a constraint our system does not have, on an endpoint
 * that calls nothing.
 */
export function buildOnrampRoutePayload(
  config: RainPayloadConfig,
  amountMinor: number,
): RainRequest {
  return {
    method: 'POST',
    url: joinUrl(config.RAIN_BASE_URL, PAYMENT_ROUTES_PATH),
    body: {
      teamId: config.RAIN_TEAM_ID,
      userId: config.RAIN_USER_ID,
      collateralContractId: config.RAIN_COLLATERAL_CONTRACT_ID,
      // Not a Rain field — a label for whoever reads the log, so the two
      // payloads are told apart at a glance without decoding which leg is
      // fiat. The direction is otherwise only inferable from which of
      // `source`/`destination` carries the on-chain address.
      direction: 'onramp',
      amount: usdAmountString(amountMinor),
      source: { ...FIAT_LEG },
      destination: {
        currency: 'usdc',
        rail: UNSUPPORTED_DESTINATION_RAIL,
        address: { type: 'onchain', address: config.OPERATOR_ADDRESS },
      },
    },
  };
}

/**
 * `POST /payment-routes` for an offramp: USDC in from the operator pool, fiat out.
 *
 * The legs are the mirror of the onramp — the crypto side becomes `source` and
 * the fiat side becomes `destination` — which is exactly why the rail problem
 * is not escapable by going the other way: `source.rail` is still `monad`, and
 * Rain's rail list does not care which direction the money is travelling.
 *
 * ⚠️ **A real offramp would need a payment account id** that this deployment
 * does not have: the vendor notes "onramps need no payment account — the
 * destination is an on-chain address" (§7, *Notes*), which says by implication
 * that offramps do. Nothing in `env.schema.ts` configures one, and inventing a
 * placeholder would make the payload look complete when it is not. The fiat
 * destination is therefore currency + rail only, and this comment is the record
 * of what is missing. It is moot in practice — the call is refused on the rail
 * before an account id would ever be examined.
 *
 * ⚠️ **`depositAddress` is not in this body.** Rain *returns* it (§7, *State
 * Variables*: "DEPOSIT_ADDRESS — from the payment route response"). The stub's
 * stand-in for it, `FUNDER_ADDRESS`, is attached by `RainStubService` to the
 * response and never to the request, because putting it here would misrepresent
 * which side of the exchange supplies that value.
 */
export function buildOfframpRoutePayload(
  config: RainPayloadConfig,
  amountMinor: number,
): RainRequest {
  return {
    method: 'POST',
    url: joinUrl(config.RAIN_BASE_URL, PAYMENT_ROUTES_PATH),
    body: {
      teamId: config.RAIN_TEAM_ID,
      userId: config.RAIN_USER_ID,
      collateralContractId: config.RAIN_COLLATERAL_CONTRACT_ID,
      direction: 'offramp',
      amount: usdAmountString(amountMinor),
      source: {
        currency: 'usdc',
        rail: UNSUPPORTED_DESTINATION_RAIL,
        address: { type: 'onchain', address: config.OPERATOR_ADDRESS },
      },
      destination: { ...FIAT_LEG },
    },
  };
}
