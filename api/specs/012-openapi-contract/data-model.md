# Phase 1 Data Model: the contract's component inventory

There is no database change in this feature. The "data model" is the set of
`components/schemas` entries `docs/openapi.yaml` must define, drawn from the response
interfaces the code actually returns.

**Every shape below is a starting point read off the source, and every one is re-confirmed
against a captured response before it is written into the YAML** (FR-005/FR-006). Where a
capture disagrees with this table, the capture wins and this table is wrong.

## Conventions

| Rule | Form in OpenAPI 3.1 |
| --- | --- |
| Always present, may be null | `type: [X, "null"]` **and** listed in `required` |
| Genuinely optional | omitted from `required` — rare here |
| Money | `type: integer`, `format: int64`, `description: US cents`, name ends `Minor` |
| Timestamp | `type: string`, `format: date-time` — all are ISO-8601 strings |
| Identifier | `type: string`, `format: uuid` unless noted |
| Free-form JSON | `type: object`, `additionalProperties: true` |
| Hex | `type: string`, `pattern: '^0x[a-fA-F0-9]+$'` |

## 1. Enumerations — 4 named schemas

Each is `$ref`-ed everywhere it appears. Values are exactly the strings the API emits.

| Schema | Members | Source of truth |
| --- | --- | --- |
| `OrderState` | `purchased` · `running` · `delivered` · `failed` · `released` · `disputed` · `adjudicated` · `settled` | `src/entities/enums.ts`, matches `database-schema.md` §8 |
| `LedgerKind` | `onramp` · `purchase` · `offramp` · `adjustment` | same |
| `VerdictTier` | `none` · `quarter` · `half` · `three_quarter` · `full` | same — **five** members |
| `CitationSource` | `capability` · `exclusion` · `criterion` | `src/guardian/dto/verdict-response.dto.ts`, matches `tech-stack.md` §5 |

## 2. Response schemas

### Auth

| Schema | Fields |
| --- | --- |
| `NonceResponse` | `nonce` string · `message` string — the message the client signs |
| `VerifyResponse` | `token` string (JWT) |
| `SessionResponse` | `accountId` uuid · `address` string |

### Accounts & money

| Schema | Fields |
| --- | --- |
| `AccountSummaryResponse` | `accountId` uuid · `address` string · `availableBalanceMinor` int · `inEscrowMinor` int · **`settledFundsMinor` int-or-null, required** |
| `LedgerEntryResponse` | `id` uuid · `amountMinor` int (signed) · `kind` → `LedgerKind` · `orderId` uuid-or-null · `externalRef` string-or-null · `createdAt` date-time |
| `WithdrawResponse` | `txHash` string · `amountMinor` int · `explorerUrl` string |
| `RainStubResponse` | `stub` const `true` · `rainCallMade` const `false` · `reason` string · `wouldHaveSent` object · *(offramp only: a deposit-address field — capture confirms its name and that it is **absent**, not null, on the onramp)* |

`settledFundsMinor` is the field FR-011 exists for: always sent, `null` when the chain read
failed, and never zero-as-unknown (`api-design.md` §3.2.1).

### Catalogue

| Schema | Fields |
| --- | --- |
| `AgentSummaryResponse` | `id` · `name` · `description` · `priceMinor` |
| `OwnedAgentResponse` | `id` · `name` · `description` · `priceMinor` · `active` bool · `listed` bool |
| `AgentListingResponse` | `id` · `name` · `description` · `priceMinor` · `capabilities` string[] · `exclusions` string[] · `inputSchema` object · `outputSchema` object · `version` int |
| `AgentVersionDetailResponse` | the listing fields **plus** `systemPrompt` string · `model` string · `timeoutSeconds` int · `definitionHash` hex · `createdAt` date-time |
| `CreateAgentResponse` | `id` · `version` int · `onchainAgentId` int · `definitionHash` hex · `active` bool |
| `CreateVersionResponse` | `id` · `agentId` uuid · `version` int · `definitionHash` hex |
| `SetActiveResponse` | `id` · `active` bool |

`GET /agents` returns **one of two array shapes** depending on `?owner=me`. In the contract
this is a `oneOf` over `AgentSummaryResponse[]` and `OwnedAgentResponse[]`, described so a
consumer knows which query produces which.

`systemPrompt` appears in exactly one schema, on one owner-only route. The contract must
make that visible rather than incidental — it is invariant #3 written down.

### Orders

| Schema | Fields |
| --- | --- |
| `CreateOrderResponse` | `id` uuid |
| `OrderAcknowledgement` | `id` uuid — the 202 body of both `accept` and `complain` |
| `BuyerOrderSummary` | `id` · `agentName` · `priceMinor` · `state` → `OrderState` · `createdAt` · `deliveredAt` null · `disputedAt` null |
| `SaleResponse` | `id` · `agentName` · `priceMinor` · `state` · `createdAt` · `disputedAt` null — **no `deliveredAt`**, and that asymmetry with `BuyerOrderSummary` is real |
| `OrderRunResponse` | `input` object · `output` any-or-null |
| `OrderResponse` | `id` · `state` · `agentName` · `priceMinor` · `acceptanceCriteria` · `reviewWindowSeconds` int · `createdAt` · `deliveredAt` null · `disputedAt` null · `settledAt` null · `run` → `OrderRunResponse`-or-null |

`OrderRunResponse.output` is `null` when nothing was produced, and that null **is the
evidence of non-delivery** (invariant #7). The contract says so in a description: it is not
an error, not a placeholder, and never to be normalised away by a client.

### Case file — two shapes, one route

| Schema | Fields |
| --- | --- |
| `CaseFileStepResponse` | `label` string · `summary` string-or-null · `durationMs` int-or-null · `error` string-or-null |
| `BuyerCaseFileResponse` | `input` object · `acceptanceCriteria` · `capabilities` string[] · `exclusions` string[] · `output` any-or-null · `steps` → `CaseFileStepResponse[]` |
| `SellerCaseFileResponse` | `allOf` the buyer's, **plus** `systemPrompt` string · `rawSteps` object[] |

`GET /orders/:id/case-file` is documented as `oneOf: [BuyerCaseFileResponse,
SellerCaseFileResponse]` with the selection rule stated: the buyer of the order gets the
first, the owner of the agent gets the second. The buyer's `steps[].summary` is a summary
because a verbatim reasoning turn can paraphrase the system prompt — the contract records
that, so no consumer expects raw text there.

### Verdict

| Schema | Fields |
| --- | --- |
| `CitationResponse` | `source` → `CitationSource` · **`quote`** string · `met` bool |
| `VerdictResponse` | `tier` → `VerdictTier` · `refundMinor` int · `reasoning` string · `citations` → `CitationResponse[]` · `txHash` string-or-null · `model` string · `createdAt` date-time |

**The field is `quote`.** `tech-stack.md` §5 specifies `quote`, the API emits `quote`, and
the `clause` reading that caused `67dcf4d` was the UI's. Documented explicitly so the
incident cannot recur in the other direction.

### Demo

| Schema | Fields |
| --- | --- |
| `SeededAgentResponse` | `key` · `agentId` · `onchainAgentId` int · `name` · `priceMinor` · `version` int · `definitionHash` string · `created` bool |
| `SeededFixtureResponse` | `act` 1\|2\|3 · `agentKey` · `agentId` · `input` object · `acceptanceCriteria` · `complaint` · `expectedTier` (`none`\|`half`\|`full`) |
| `SeedResponse` | `seller` `{ accountId, walletAddress }` · `agents[]` · `fixtures[]` |
| `ResetResponse` | `cleared` `{ orders, ordersInFlight, runs, complaints, verdicts, ledgerEntriesUnlinked }` · `kept` `{ accounts, agents, ledgerEntries }` · `note` string |

`SeededFixtureResponse.expectedTier` accepts only three of `VerdictTier`'s five members. It
gets its own inline enum rather than a `$ref`, because widening it to the full enum would
document a shape the route cannot return.

Both demo routes are **unauthenticated by decision** (`api-design.md` §8) and neither
returns a system prompt. Their presence in a public contract is a consequence of that
decision, and the contract notes it rather than hiding it.

### Health

| Schema | Fields |
| --- | --- |
| `HealthCheckResponse` | Terminus' shape: `status` · `info` · `error` · `details`. **Captured, not assumed** — this one is produced by a library, so its exact keys come off the wire. |

## 3. Request schemas

All derived from the Zod schemas in `src/**/dto/*.ts`, whose constraints are already the
enforced ones, then confirmed against a real 400.

| Schema | Fields | Constraints |
| --- | --- | --- |
| `NonceRequest` | `address` | `^0x[a-fA-F0-9]{40}$` |
| `VerifyRequest` | `address` · `signature` | address as above; signature `^0x[a-fA-F0-9]+$`, min length 3 |
| `AmountRequest` | `amountMinor` | shared by `/topup`, `/offramp`, `/onramp/routes`, `/offramp/routes` — the constraint is `src/common/amount.schema.ts`; read it and transcribe the real bound |
| `CreateAgentRequest` | `name` · `description` · `capabilities[]` · `exclusions[]` · `priceMinor` · `inputSchema` · `outputSchema` · `systemPrompt` · `model` · `timeoutSeconds` | non-empty trimmed strings; `timeoutSeconds` positive int, **default 120** |
| `SetActiveRequest` | `active` bool | — |
| `CreateOrderRequest` | `agentId` uuid · `input` object · `acceptanceCriteria` | non-empty trimmed criteria |
| `ComplainRequest` | `reason` | non-empty trimmed |

`POST /agents/:id/versions` reuses `CreateAgentRequest` verbatim — same Zod schema, different
route. Documented as the same `$ref` rather than a near-duplicate.

## 4. Error schemas

Five distinct bodies, catalogued in [contracts/error-shapes.md](./contracts/error-shapes.md).
They are named schemas in the contract because FR-012 makes them part of it, and because the
consuming UI branches on status: 404 and 403 are final, everything else retries.
