# Route inventory — the completeness checklist

**27 routes**, read from the decorators in `src/**/*.controller.ts`. This list defines
"complete" for FR-003. It is re-derived from the running router in stage 1 (see
[quickstart.md](../quickstart.md)) — if the router and this table disagree, the router wins
and this table is corrected.

**Auth column**: `public` = `@Public()`, guard skipped · `optional` = `@OptionalAuth()`,
token read if present · `jwt` = default, global fail-closed guard applies.

## Auth — `src/auth/auth.controller.ts`

| # | Method | Path | Auth | Success | Request | Response |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | POST | `/auth/nonce` | public | **201** | `NonceRequest` | `NonceResponse` |
| 2 | POST | `/auth/verify` | public | **201** | `VerifyRequest` | `VerifyResponse` — creates the account on first sign-in |
| 3 | GET | `/auth/session` | jwt | 200 | — | `SessionResponse` |

## Accounts — `src/accounts/accounts.controller.ts`

| # | Method | Path | Auth | Success | Request | Response |
| --- | --- | --- | --- | --- | --- | --- |
| 4 | GET | `/me` | jwt | 200 | — | `AccountSummaryResponse` |
| 5 | GET | `/me/ledger` | jwt | 200 | — | `LedgerEntryResponse[]` |

## Funding — `src/funding/funding.controller.ts`

| # | Method | Path | Auth | Success | Request | Response |
| --- | --- | --- | --- | --- | --- | --- |
| 6 | POST | `/topup` | jwt | 200 | `AmountRequest` | `AccountSummaryResponse` |
| 7 | POST | `/withdraw` | jwt | 200 | — | `WithdrawResponse` |
| 8 | POST | `/offramp` | jwt | 200 | `AmountRequest` | `AccountSummaryResponse` |

## Rain stubs — `src/rain/rain.controller.ts`

| # | Method | Path | Auth | Success | Request | Response |
| --- | --- | --- | --- | --- | --- | --- |
| 9 | POST | `/onramp/routes` | **jwt** | 200 | `AmountRequest` | `RainStubResponse` |
| 10 | POST | `/offramp/routes` | **jwt** | 200 | `AmountRequest` | `RainStubResponse` (carries the deposit address) |

Both are authenticated on purpose — the file says so explicitly. Do not document them as
public because "stub" sounds harmless.

## Catalogue — `src/catalog/agents.controller.ts`

| # | Method | Path | Auth | Success | Request | Response |
| --- | --- | --- | --- | --- | --- | --- |
| 11 | GET | `/agents` | **optional** | 200 | `?owner=me` | `AgentSummaryResponse[]` · with `?owner=me`, `OwnedAgentResponse[]` |
| 12 | GET | `/agents/:id` | public | 200 | — | `AgentListingResponse` |
| 13 | GET | `/agents/:id/versions` | jwt (owner) | 200 | — | `AgentVersionDetailResponse[]` — **the only route carrying `systemPrompt`** |
| 14 | POST | `/agents` | jwt | **201** | `CreateAgentRequest` | `CreateAgentResponse` — synchronous, awaits the on-chain receipt |
| 15 | POST | `/agents/:id/versions` | jwt (owner) | **201** | `CreateAgentRequest` | `CreateVersionResponse` |
| 16 | PATCH | `/agents/:id/active` | jwt (owner) | 200 | `SetActiveRequest` | `SetActiveResponse` |

Route 11 has three behaviours, all documented: no token → public listings; token +
`?owner=me` → owned listings including inactive; no token + `?owner=me` → **401**. Any value
of `owner` other than `me` → **400**.

## Orders — `src/orders/orders.controller.ts`

| # | Method | Path | Auth | Success | Request | Response |
| --- | --- | --- | --- | --- | --- | --- |
| 17 | GET | `/orders` | jwt (buyer) | 200 | — | `BuyerOrderSummary[]` |
| 18 | GET | `/orders/:id` | jwt (**buyer or agent owner**) | 200 | — | `OrderResponse` |
| 19 | GET | `/orders/:id/case-file` | jwt (**buyer or agent owner**) | 200 | — | `BuyerCaseFileResponse` \| `SellerCaseFileResponse` |
| 20 | POST | `/orders` | jwt | **201** | `CreateOrderRequest` | `CreateOrderResponse` |
| 21 | POST | `/orders/:id/accept` | jwt (**buyer only**) | **202** | — | `OrderAcknowledgement` |
| 22 | POST | `/orders/:id/complain` | jwt (**buyer only**) | **202** | `ComplainRequest` | `OrderAcknowledgement` |

## Sales — `src/orders/sales.controller.ts`

| # | Method | Path | Auth | Success | Request | Response |
| --- | --- | --- | --- | --- | --- | --- |
| 23 | GET | `/sales` | jwt (seller) | 200 | — | `SaleResponse[]` |

## Verdict — `src/guardian/verdict.controller.ts`

| # | Method | Path | Auth | Success | Request | Response |
| --- | --- | --- | --- | --- | --- | --- |
| 24 | GET | `/orders/:id/verdict` | jwt (**buyer or agent owner**) | 200 | — | `VerdictResponse` |

Registered on `@Controller('orders')` in a different module from routes 17–22. Same path
prefix, two controllers — a reason the inventory is taken from the router rather than by
reading one file.

## Demo — `src/demo/demo.controller.ts`

| # | Method | Path | Auth | Success | Request | Response |
| --- | --- | --- | --- | --- | --- | --- |
| 25 | POST | `/demo/seed` | public | 200 | — | `SeedResponse` |
| 26 | POST | `/demo/reset` | public | 200 | — | `ResetResponse` |

`@Public()` is on the handlers, never on the class — deliberate, per the file's own note.

## Health — `src/health/health.controller.ts`

| # | Method | Path | Auth | Success | Request | Response |
| --- | --- | --- | --- | --- | --- | --- |
| 27 | GET | `/health` | public | 200 | — | `HealthCheckResponse` (Terminus) · **503** when the database ping fails |

## Not in the contract

`/docs`, `/docs-json`, `/docs-yaml` — served by `SwaggerModule`, excluded by
[research.md](../research.md) decision 3. Recorded so their absence reads as a decision.

## The three buyer-or-seller reads

Routes 18, 19 and 24 authorise on `buyer_account_id` **or** the agent's `owner_account_id`.
`src/orders/order.repository.ts` implements this with
`(o.buyer_account_id = :accountId OR a.owner_account_id = :accountId)` on both
`findVisibleToAccount` and `caseFileQuery`, so `api-design.md` §3.4 is satisfied — but the
capture in stage 2 confirms it live on all three, because a seller who cannot read the
verdict of a dispute they lost is the failure this check exists to catch.

Routes 21 and 22 stay buyer-only. If a capture shows a seller succeeding on either, that is
an `api-wrong` row.
