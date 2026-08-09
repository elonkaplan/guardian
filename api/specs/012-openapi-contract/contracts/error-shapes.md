# Error shapes — five bodies, not one

FR-012 makes failures part of the contract, because the consuming UI branches on the status:
**404 and 403 are final; everything else is retried.** An API that answers 500 for a missing
order makes the frontend retry forever, and that is the API's defect to fix.

Reading the error paths turned up **five structurally different bodies**. Every one below is
a claim to be confirmed against a captured response before it goes in the YAML; the shapes
are given here so the capture script knows which failures to provoke.

## Shape A — Nest default, string message

The majority. Produced by `NotFoundException('…')`, `ConflictException('…')`,
`BadRequestException('…')`, `UnauthorizedException('…')`, `BadGatewayException('…')`.

```json
{ "statusCode": 404, "message": "Order not found", "error": "Not Found" }
```

Where it comes from: `src/orders/orders-http.ts` (404 agent/order not found, 409 wrong
state, 409 window closed, 409 already complained, 409 not disputable) ·
`src/funding/funding.controller.ts` (409 insufficient balance / funder / pool, with the
amounts formatted into the message string) · `src/catalog/catalog-http.ts` ·
`src/common/chain-http.ts` (502 for every chain failure) · the global JWT guard (401) ·
`ParseUUIDPipe` (400, `"Validation failed (uuid is expected)"`) ·
`src/catalog/agents.controller.ts` (400 for `owner` ≠ `me`, 401 for `?owner=me` anonymous).

## Shape B — validation failure, no `statusCode`

`src/common/zod-validation.pipe.ts` throws `BadRequestException` with an **object**, and Nest
uses an object payload as the whole body — so `statusCode` and `error` are absent.

```json
{ "message": "Validation failed", "errors": { "formErrors": [], "fieldErrors": { "amountMinor": ["…"] } } }
```

The 400 from a bad body and the 400 from a bad UUID in the path are therefore **different
shapes on the same route**. Both are documented.

## Shape C — insufficient funds for a purchase (402)

`src/orders/orders-http.ts`, `InsufficientFundsForPurchaseError`:

```json
{ "message": "…", "availableBalanceMinor": 150, "priceMinor": 200 }
```

Machine-readable amounts, no `statusCode`. The only 402 in the API.

## Shape D — chain outcome unknown (502)

`src/common/chain-http.ts`, `ChainOutcomeUnknownError` — the one chain error that carries the
hash, so a client can go look:

```json
{ "message": "…", "txHash": "0x…" }
```

Every other chain error uses shape A with a 502.

## Shape E — bare error code, verdict route only

`src/guardian/verdict.controller.ts` throws `HttpException` with an object holding **only**
an error code:

```json
{ "error": "ORDER_NOT_FOUND" }
{ "error": "VERDICT_NOT_FOUND" }
{ "error": "AUDIT_FAILED", "attempts": 3, "failedAt": "2026-08-09T…Z" }
```

`ORDER_NOT_FOUND` and `VERDICT_NOT_FOUND` are both **404** and mean different things: the
order is not yours or does not exist, versus the order is real and the audit has not
finished. `AUDIT_FAILED` is **409**. No `statusCode`, no `message`.

### This is the divergence report's most interesting row

Shape E is the only place in the API where a failure carries a machine-readable code, and
also the only place a failure carries no `message`. Two defensible readings:

- **`intentional`** — the verdict route is polled by the UI, which needs to distinguish
  "not audited yet" from "not your order" on the same 404, and a code is the honest way to
  do that. Then it is documented and the reason recorded.
- **`api-wrong`** — the inconsistency is accidental and a client cannot render an error
  message for these three cases. Then the fix is additive: add `message` and `statusCode`
  alongside the existing `error`, keeping the code so nothing already reading it breaks.

**Decide it during implementation, from the UI's actual usage**, and record the verdict
either way. Do not silently normalise it — removing `error` would break a consumer that
depends on it, and this feature does not change behaviour outside `api-wrong` rows.

## Failures the capture must provoke

| Status | How | Expected shape |
| --- | --- | --- |
| 400 | `POST /orders` with `{}` | B |
| 400 | `GET /orders/not-a-uuid` | A |
| 400 | `GET /agents?owner=someone-else` | A |
| 401 | any jwt route with no `Authorization` header | A |
| 401 | `GET /agents?owner=me` with no token | A |
| 402 | `POST /orders` with a balance below the price | C |
| 404 | `GET /orders/<random uuid>` | A |
| 404 | `GET /orders/<another buyer's order>` | A — must be 404, **not** 403 or 500 |
| 404 | `GET /orders/<real id>/verdict` before the audit finishes | E (`VERDICT_NOT_FOUND`) |
| 404 | `GET /agents/<random uuid>` | A |
| 409 | `POST /orders/:id/accept` on an order in the wrong state | A |
| 409 | `POST /orders/:id/complain` twice | A |
| 409 | `POST /offramp` for more than the available balance | A |
| 503 | `GET /health` with Postgres stopped | Terminus' own shape |

502 chain failures are **not** provoked deliberately — taking the RPC down mid-rehearsal
costs more than the row is worth. Document shapes A and D for 502 from the code, and mark
those two responses in the report as *documented from source, not captured*, so a reader
knows which lines carry less evidence than the rest.
