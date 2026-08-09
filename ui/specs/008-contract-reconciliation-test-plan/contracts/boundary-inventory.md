# Boundary inventory

Both directions, exhaustively. This is the artifact that makes FR-019 ("no endpoint the
frontend calls is absent from the contract") and FR-020 ("every contract endpoint is reachable,
orphans named") checkable rather than asserted.

**Contract**: `api/docs/openapi.yaml` — 21 paths, 27 routes.
**Frontend**: 17 call sites across `ui/src/api/*.ts`.

Legend — **Auth**: `public` · `bearer` · `optional` (public, richer with a token).
**Status**: ✅ reached and agreeing · ⚠️ reached, disagreement found · ⭕ orphan (defined, never
called) · 🔒 orphan by design.

---

## Direction 1 — Contract → frontend

Every path the contract defines. This is the direction that finds fields arriving on the wire
and being discarded in silence, and unreachable endpoints.

| # | Method + path | Auth | Frontend call site | Status | Finding |
| --- | --- | --- | --- | --- | --- |
| 1 | `POST /demo/seed` | public | tester, not the app | ✅ | Test-plan §0 precondition |
| 2 | `POST /demo/reset` | public | tester, not the app | ✅ | Test-plan reset instructions |
| 3 | `GET /health` | public | tester, not the app | ✅ | Test-plan §1 smoke |
| 4 | `POST /auth/nonce` | public | `api/auth.ts:17` | ⚠️ | **R-01 blocker** — `message` not declared, not signed |
| 5 | `POST /auth/verify` | public | `api/auth.ts:21` | ⚠️ | **R-01** — 401s because of #4 |
| 6 | `GET /auth/session` | bearer | `api/session.ts` | ✅ | |
| 7 | `GET /me` | bearer | `api/me.ts:58` | ⚠️ | **R-06** — `accountId` sent, not declared (ignored, with reason) |
| 8 | `GET /me/ledger` | bearer | `api/wallet.ts:67` | ✅ | All six fields agree; `amountMinor` signed |
| 9 | `POST /topup` | bearer | `api/wallet.ts:78` | ✅ | `AmountRequest` matches |
| 10 | `POST /withdraw` | bearer | `api/wallet.ts:104` | ⚠️ | **R-05** — `txHash` non-null in contract; `amountMinor`, `explorerUrl` not declared |
| 11 | `POST /offramp` | bearer | `api/wallet.ts:91` | ✅ | `AmountRequest` matches |
| 12 | `POST /onramp/routes` | bearer | — | ⭕ | **R-10** — Rain stubbed, no on-ramp UI |
| 13 | `POST /offramp/routes` | bearer | — | ⭕ | The one orphan the spec permits (api-design §4) |
| 14 | `GET /agents` | optional | `api/agents.ts:65`, `:84` | ⚠️ | **R-03** — `?owner=me` sends `listed`, not declared |
| 15 | `POST /agents` | bearer | `api/agents.ts:101` | ✅ | Response deliberately discarded |
| 16 | `GET /agents/{id}` | public | `api/agents.ts:70` | ⚠️ | **R-09** — `version` sent, not declared (ignored, with reason) |
| 17 | `GET /agents/{id}/versions` | bearer | — | 🔒 | **R-10** — carries `systemPrompt`. Never called, deliberately. |
| 18 | `POST /agents/{id}/versions` | bearer | — | ⭕ | **R-10** — no version-editing UI |
| 19 | `PATCH /agents/{id}/active` | bearer | `api/agents.ts:120` | ✅ | Absolute value, not a toggle |
| 20 | `GET /orders` | bearer | — | ⭕ | **R-07** — My Orders is a placeholder |
| 21 | `POST /orders` | bearer | `api/orders.ts:47` | ✅ | No `price`, no `reviewWindowSeconds` — on both sides |
| 22 | `GET /orders/{id}` | bearer | `api/orders.ts:67` | ✅ | Eleven fields, all agreeing |
| 23 | `GET /orders/{id}/case-file` | bearer | `api/verdicts.ts:54` | ⚠️ | **R-04 `api-wrong`** — buyer `steps` always `[]` |
| 24 | `POST /orders/{id}/accept` | bearer | `api/orders.ts:86` | ✅ | 202; response discarded |
| 25 | `POST /orders/{id}/complain` | bearer | `api/orders.ts:103` | ✅ | 202; `{ reason }` |
| 26 | `GET /orders/{id}/verdict` | bearer | `api/verdicts.ts:39` | ⚠️ | **R-02 blocker** — two 404s conflated; `model` not declared |
| 27 | `GET /sales` | bearer | `api/sales.ts:30` | ✅ | Six fields; no `buyerAddress`, by design |

**Reached: 21 of 27** (counting the three tester-driven routes). **Orphans: 6**, all named —
five in R-10/R-07, one permitted by the spec.

## Direction 2 — Frontend → contract

Every call the frontend makes. This direction finds 404s-in-waiting.

**Result: all 17 production call sites resolve to a defined path.** *(FR-019, SC-004 — first half)*

**One exception, in a dev-only harness.** `src/pages/PollTestPage.tsx:50` calls
`/stub/order?after=4&key=…`, which does not exist in the contract. The route is registered only
under `import.meta.env.DEV` (`AppRoutes.tsx:95`) and the page's own header calls it a
"DEV-ONLY harness for the polling hook. Not part of the product." It never ships and no user
can reach it, so it is not a 404-in-waiting — but "zero" would have been the wrong word, and
the walk found it, so it is recorded rather than rounded away.

`/agents`, `/agents?owner=me`, `/agents/{id}`, `/agents/{id}/active`, `/auth/nonce`,
`/auth/verify`, `/auth/session`, `/me`, `/me/ledger`, `/topup`, `/withdraw`, `/offramp`,
`/orders`, `/orders/{id}`, `/orders/{id}/accept`, `/orders/{id}/complain`,
`/orders/{id}/case-file`, `/orders/{id}/verdict`, `/sales`.

Query semantics were checked, not just parameter names: `?owner=me` **includes inactive and
unregistered agents**, confirmed in the divergence report under *What matched* against
api-design §3.3. This is the check the source brief singled out — an `?owner=me` filtered to
active looks like a working feature until someone tries to switch an agent back on.

---

## Enumerations

The frontend's switches have no `default` in the failing sense, so a member the API can emit
and the frontend cannot render would blank or throw.

| Enum | Contract members | Frontend | Verdict |
| --- | --- | --- | --- |
| `OrderState` | purchased, running, delivered, failed, released, disputed, adjudicated, settled | Identical, same declaration order | ✅ |
| `LedgerKind` | onramp, purchase, offramp, adjustment | Identical | ✅ |
| `VerdictTier` | none, quarter, half, three_quarter, full | Identical | ✅ |
| `CitationSource` | capability, exclusion, criterion | Identical | ✅ |

Unknown members degrade rather than throw: `Verdict.tier` is `string` at the wire and narrowed
inside `tierDisplay`, which falls through to a labelled fallback; `Citation.source` widens to
`string` on purpose, so an unfamiliar origin is still shown as evidence rather than dropped.
*(FR-010, FR-011 — satisfied, no change)*

## Error bodies

Three shapes, and a client that assumes one is wrong.

| Shape | Where | Frontend handling |
| --- | --- | --- |
| `ErrorResponse` `{statusCode, message, error?}` | Most routes | `client.ts:88-95` reads `message`, falls back to status text |
| `ValidationErrorResponse` `{message, errors}` | Request-body 400s | Same path; `errors` in `details` |
| `ChainOutcomeUnknownResponse` `{message, txHash}` | 502 on `/topup`, `/withdraw`, `/offramp` | ⚠️ **Not a failure** — the tx may still confirm. Test-plan §5 asserts the hash is shown, not an error |
| `VerdictErrorResponse` `{error, attempts?, failedAt?}` | `/verdict` only | ⚠️ **R-02** — code parsed by `client.ts:90`, ignored by `useVerdict.ts:72` |
| `InsufficientFundsResponse` `{message, availableBalanceMinor, priceMinor}` | `POST /orders` 402 | Renders via `message`; the two figures are available in `details` |

## Fatal vs retryable

The rule the frontend depends on, confirmed live by the divergence report: **a caller who is
neither buyer nor agent owner receives 404, never 403 or 500.** Anything but 404/403 is retried
forever, so this one matters more than its size suggests.

| Route | Frontend rule | Contract | Verdict |
| --- | --- | --- | --- |
| `GET /orders/{id}` | fatal on 404, 403 | 404 for not-a-party | ✅ |
| `GET /orders/{id}/case-file` | fatal on 404, 403 | 404 for not-a-party; 404 when no case file exists | ✅ |
| `GET /orders/{id}/verdict` | fatal on 404, 403 | **404 means two opposite things**; 409 `AUDIT_FAILED` is terminal | ⚠️ **R-02** — stops on the recoverable one, retries the terminal one |

## Authentication

Checked against every `security:` block. The three routes that render without a session —
Connect, Marketplace, Agent Detail — call only `public` or `optional` endpoints, so no page
issues a call it believes is public against a guarded endpoint. *(FR-017 — satisfied)*

## Guarantees held by omission

The reason this feature forbids generating types from the contract. Each absence is a
guarantee; a generator would restore the field and delete the guarantee while everything still
compiled.

| Frontend type | Absent | Enforces |
| --- | --- | --- |
| `AgentListing`, `OwnedAgent` | `systemPrompt`, `model`, `timeoutSeconds` | Invariant #3 — seller IP never reaches the browser |
| `OrderRun` | `steps` | Same, on the unredacted order read |
| `CaseFileStep` | `prompt`, `systemPrompt`, `reasoning`, `raw` | Same, on the one route with a redaction contract |
| `CreateOrderRequest` | `price`, `reviewWindowSeconds` | FR-021 — a buyer cannot choose what they pay or how long they get |
| `Verdict` | `verdictHash`, `model`, `id` | Keeps the card evidence, not provenance |

The contract independently confirms four of these: `AgentListingResponse` genuinely carries no
prompt (it lives on `AgentVersionDetailResponse`, served only from the endpoint the frontend
never calls), and `CreateOrderRequest` genuinely requires only three fields. The guarantee now
holds on both sides of the wire, not only in the frontend's type — which is a stronger position
than this component started from, and worth not giving away.
