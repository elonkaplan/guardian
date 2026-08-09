# Phase 0 — Research: the reconciliation walk

**Date**: 2026-08-09 · **Contract**: `api/docs/openapi.yaml` (21 paths, 27 routes, 47 schemas)
· **Read first**: `api/docs/openapi-divergences.md`

**Method.** Both directions, in full. Frontend→contract: every one of the 17 call sites in
`ui/src/api/*.ts` matched against its path, request body, response schema, and error bodies.
Contract→frontend: every response schema's property list walked for fields no frontend type
declares — the direction that cannot be seen from the frontend's own types, because a field
that simply never arrives produces no error anywhere.

**Confidence.** These findings are **desk-verified**: read from the contract and the source,
with the API not running during the pass. The contract is transcribed from captured responses
(three exceptions, noted in the divergence report), so it is good evidence — but R-01 is a
claim about runtime behaviour and is confirmed live first, per `quickstart.md` §1.

**How each row was classified.** The divergence report has ten rows. Nine are `design-stale`
or `intentional`, meaning the contract is correct and the frontend matches it. One — row 5 —
is `api-wrong` and marked `DO NOT ADOPT`. Everything not listed in that report matched its
design and is adopted as written.

---

## R-01 — Sign-in signs the wrong string · **BLOCKER** · fix the frontend

**What differed.** `POST /auth/nonce` returns `NonceResponse`, whose required properties are
`nonce` **and `message`**. `message` is the exact bytes to sign: a multi-line string embedding
the address and the nonce. The schema is unusually emphatic:

> *"The exact string to pass to `personal_sign` — byte for byte, newlines included. Do NOT
> recompose this client-side from a template; the format is server-owned, and any drift
> surfaces only as an opaque signature-verification failure."*

`VerifyRequest` is described as *"the signature over `NonceResponse.message`."*

The frontend does not read `message`. `src/api/types.ts` declares `NonceResponse { nonce }`
only, and `src/auth/useSignIn.ts:173` signs the nonce verbatim:

```ts
signature = await signMessageAsync({ message: nonce, account: address });
```

The comment above it states the reasoning that was true when it was written — *"the message is
the nonce verbatim: `/auth/verify` carries no message field, so the backend reconstructs what
it issued."* The backend does reconstruct it. It reconstructs the **full message**, not the
bare nonce.

**Divergence report says**: row 1, `design-stale`. `api-design.md` §3.1 originally described
`{ nonce }` and was **updated** — the report's stated reason is that *"the client signs
`message`, so omitting it from the design made the flow unimplementable as written."* The
contract is correct.

**Why nothing caught it.** The same class as the `quote`/`clause` incident, one level up. The
field name the frontend reads is spelled correctly and the value has the right type — it is
simply the wrong value. No type system reaches this. The failure surfaces only as a 401 from
`/auth/verify` with an opaque message, which the sign-in screen renders as the backend's own
copy, so it looks like a rejected signature rather than a client defect.

**Blast radius.** Total. `RequireAuth` guards My Orders, Order Detail, Wallet, Sell, Create
Agent, and the seller's sale screen. Only Connect, Marketplace, and Agent Detail render
without a session. If verify 401s, there is no demo.

**Resolution — fix the frontend.** Add `message: string` to `NonceResponse`; sign
`response.message`; keep `nonce` on the type (it is required by the contract and useful in the
failure copy) but never sign it. Do not template the message client-side.

**Live confirmation required** before anything else — quickstart §1.

---

## R-02 — The verdict poll abandons a pending audit · **BLOCKER** · fix the frontend

**What differed.** `GET /orders/{id}/verdict` is the one route in the API returning
`VerdictErrorResponse` — a bare `{ error: CODE }` with no `statusCode` and no `message`. Three
codes, and the two 404s mean opposite things:

| Status | `error` | Meaning | Correct client behaviour |
| --- | --- | --- | --- |
| 404 | `ORDER_NOT_FOUND` | No such order, or not yours | Terminal. Stop. |
| 404 | `VERDICT_NOT_FOUND` | Your order, audit not finished | **Keep polling.** |
| 409 | `AUDIT_FAILED` | Audit abandoned after `attempts` tries at `failedAt` | Terminal. Stop. |

The schema description states it directly: *"do not branch on the HTTP status alone… A client
that treats every 404 as 'gone' will abandon a dispute that was still being judged."*

`src/hooks/useVerdict.ts:72` branches on the status alone:

```ts
failure.kind === 'http' && (failure.status === 404 || failure.status === 403)
```

So the frontend is wrong in both directions at once: it **stops** on `VERDICT_NOT_FOUND`,
which is the case that resolves by waiting, and it **keeps retrying** `AUDIT_FAILED` (409 is
not in the fatal set), which is the case that never resolves — a poll that runs until the tab
closes, which is the exact failure `usePolling`'s fatal-error machinery exists to prevent.

The hook's own comment argues the 404 is safe because *"this hook only runs once the order
itself says a ruling exists."* That holds only if the order's state and the verdict row become
visible in the same instant. `adjudicated` is written when the ruling is made; there is a
window, however short, in which the order says a verdict exists and the verdict read 404s. On
a one-second poll during Act 2, one unlucky tick permanently kills the verdict card.

**Divergence report says**: row 6, `intentional`, with the reasoning recorded in full — the
bare code was kept deliberately *because* a client must distinguish the two 404s, and an
additive fix was considered and rejected. The contract is correct, and the report is explicit
that `error` must stay because clients read it.

**Already available.** No client plumbing is needed: `src/api/client.ts:90` already prefers
`body.code`, then `body.error`, as the `ApiError.code`. The code is on the error object today;
the hook does not consult it.

**Resolution — fix the frontend.** In `useVerdict`'s `isFatalError`, branch on `error.code`:
fatal on `ORDER_NOT_FOUND` and `AUDIT_FAILED` (and on 403, unchanged); not fatal on
`VERDICT_NOT_FOUND`. Keep the status check as the fallback for a 404 carrying no code, and
prefer treating an unknown-code 404 as fatal — that preserves today's behaviour for anything
unrecognised rather than opening a new infinite-poll path.

**Alternative considered and rejected**: capping retries by count instead of branching on the
code. Rejected — it converts a correctness question into a timeout, and an audit that takes
longer than the cap still loses its verdict card, silently.

---

## R-03 — `listed` never reaches the seller's screen · fix the frontend

**What differed.** `OwnedAgentResponse` requires six properties. `OwnedAgent` declares five.
The missing one is `listed`, and the contract explains what it costs:

> *"Whether the on-chain registration actually landed. `false` means the agent exists in the
> database but has no on-chain counterpart, so no buyer can see or purchase it… Worth
> surfacing in the UI — an agent with `active: true, listed: false` looks healthy but is
> invisible to buyers."*

`fetchOwnedAgents` casts through `unwrapList<OwnedAgent>`, so the field arrives on the wire
every time and is discarded at the type boundary without a word. A seller is shown an agent
that cannot be bought, drawn identically to one that can.

**Divergence report says**: not a row — and explicitly confirmed under *What matched*:
`?owner=me` includes unregistered agents flagged `listed: false`, as api-design §3.3 requires.
The contract is correct; the frontend is missing a field.

**Resolution — fix the frontend.** Declare `listed: boolean` on `OwnedAgent`; render an
unregistered agent as visibly distinct in `OwnedAgentList`. The distinction must survive
desaturation (a badge or a label, not a colour), because §6 of the test plan checks exactly
that on the seller screens.

**Note on the adjacent state.** `active: true, listed: false` is the dangerous combination —
the availability toggle reads as "on the market" while the agent is invisible to every buyer.
The two flags mean different things and both need saying.

---

## R-04 — Buyer case-file `steps` is always empty · **`api-wrong`** · escalate, do not absorb

**What differed.** `BuyerCaseFileResponse.steps` is a required array that the API populates
unconditionally with `[]`. `CaseFileService.getForBuyer` returns `steps: []` always;
`findCaseFileForBuyer` does not select `runs.steps`, so the trace never enters the process on
a buyer's read. The seller's case file for the same order carries the populated trace.

**Divergence report says**: row 5, **`api-wrong`**, marked **`DO NOT ADOPT`** in both the
report and the contract — the only defect the report found. `api-design.md` §1.3 and
`ui-design.md` §7.1 both say a buyer sees a summarised trace. The report declines to fix it,
and says why: the fix weakens one of three layers protecting invariant #3 (`system_prompt`
never reaches a buyer), and *"that is a judgement about the seller-IP boundary, days before a
demo. It belongs to whoever owns that boundary, not to the contract-writing pass."*

The frontend renders this: `CaseFileStep` exists, `ExecutionSteps.tsx` renders it, and
`CaseFilePanel` shows it on a buyer's screen. It will render an empty list, every time.

**Resolution — escalate; change copy only.** The frontend does not work around this. It does
not fetch the seller endpoint, does not synthesise steps, and does not hide the section as if
it were not part of the design. What it does is stop an empty list reading as *"the agent did
nothing"*: the buyer's trace area states that the execution trace is not available on a
buyer's copy. That is a rendering decision about a known-empty field, not an absorption of the
defect.

This row appears in the delivered reconciliation note with exactly this resolution, per FR-024
— an `api-wrong` row with "escalated, copy changed, no data workaround" is a complete row.

**Escalation**: raised against the `api/` component, pointing at divergence row 5. Whoever owns
the seller-IP boundary decides. Not decided here, and not decided by the frontend.

---

## R-05 — `WithdrawResponse` disagrees three ways · keep the frontend, record the reason

**What differed.** The contract requires `[txHash, amountMinor, explorerUrl]`, with `txHash`
typed `string` — **not nullable**. The frontend declares `{ txHash: string | null }` and reads
nothing else.

Three separate questions, three answers:

1. **`txHash` nullability.** The frontend is stricter than the contract requires, in the safe
   direction: it handles a null the contract says cannot occur, and degrades to a plain
   confirmation rather than rendering a dead link. **Keep it.** Widening a type to match a
   guarantee is not the same as trusting it, and this is the one response in the contract the
   divergence report flags as *documented from source, not captured* — no test run ever had
   settled on-chain funds, so every live call returned the 409. Trusting an uncaptured
   non-null guarantee to remove a null check would be trusting the weakest evidence in the
   document.
2. **`explorerUrl`.** A contract field the frontend does not declare. **Deliberately ignored**:
   the frontend already builds explorer links from a configured base (`ExplorerTxLink`,
   `TxHashLink`), and adopting a server-supplied URL would mean two sources of truth for where
   a hash points, one of which the frontend cannot validate before rendering it as a link.
3. **`amountMinor`.** A contract field the frontend does not declare. **Deliberately ignored**:
   the wallet re-reads `GET /me` after a withdrawal and that read is the authority on every
   figure on the screen. A second number arriving on the write's response could disagree with
   it.

**Divergence report says**: not a row. The contract is correct; the frontend's divergences here
are choices, and this is where they are recorded so the next pass does not re-litigate them.

---

## R-06 — `AccountSummaryResponse.accountId` · ignore

The contract sends `accountId` (uuid) on `GET /me`. `AccountSummary` does not declare it.
Nothing on any screen renders an account id, and `GET /auth/session` is the documented way to
learn it. **Deliberately ignored**; recorded so the contract→frontend walk is complete.

The three money figures agree exactly — `availableBalanceMinor`, `inEscrowMinor`, and
`settledFundsMinor` typed `[integer, "null"]` and required. The frontend's required-and-nullable
`Cents | null`, with `null` meaning *unknown, never zero*, matches the contract member for
member, and the divergence report confirms it against api-design §3.2.1 under *What matched*.

---

## R-07 — `GET /orders` is an orphan; My Orders is a placeholder

**What differed.** The contract defines `GET /orders` returning `BuyerOrderSummary[]` —
`id`, `agentName`, `priceMinor`, `state`, `createdAt`, `deliveredAt`, `disputedAt`. No frontend
module calls it. There is no `listOrders` in `src/api/orders.ts`, no `BuyerOrderSummary` type,
and `MyOrdersPage.tsx` is four lines:

```tsx
return <PagePlaceholder title="My Orders" filledBy="UI-04" />;
```

The route is live and behind `RequireAuth`, and the nav links to it. `ui/docs/CONTEXT.md` §4
specifies "Wallet and My Orders 5s" polling — a page that was planned and never built.

**Resolution — name it, do not build it.** Building a page is out of scope (FR-043), and My
Orders is genuinely off the demo path: all three acts run on Order Detail, reached from the
purchase flow. But it is a live route a judge can click.

Two consequences, both carried forward:

- The reconciliation note names `GET /orders` as an orphan endpoint with the reason.
- The test plan gets an explicit step: navigating to My Orders shows a titled placeholder, and
  **that is the expected result**. A tester finding an unexplained placeholder at 3am
  otherwise either reports a false failure or, worse, assumes the whole route tree is broken.

---

## R-08 — `VerdictResponse.model` · ignore, already reasoned

The contract sends `model` on a verdict. `Verdict` does not declare it, and `types.ts` already
carries the argument: rendering the model name *"would push this card back towards 'an AI
decided this' — which is the one thing the citation checklist exists to prevent."*

**Deliberately ignored.** This is the load-bearing-absence rule working as intended: the
contract sending a field is not a reason to declare one.

---

## R-09 — `AgentListingResponse.version` · ignore

The contract sends `version: integer` on `GET /agents/{id}`. `AgentListing` does not declare
it. Nothing on the detail screen shows a version number, and the order pins its own version
server-side. **Deliberately ignored.**

The rest of `AgentListingResponse` agrees exactly, including `capabilities` and `exclusions`
as required arrays and both schemas as objects. Critically, **there is no `systemPrompt`,
`model`, or `timeoutSeconds` on this response** — those live on `AgentVersionDetailResponse`,
served only from `GET /agents/{id}/versions`, which the frontend deliberately never calls. The
guarantee holds on both sides of the wire, not just in the frontend's type.

---

## R-10 — Three more orphan endpoints

The spec permits exactly one unreachable endpoint (`/offramp/routes`, api-design §4) and
requires any other to be named. There are three others:

| Path | Why unreached | Disposition |
| --- | --- | --- |
| `POST /onramp/routes` | Rain is stubbed; no on-ramp route UI | **Named orphan.** Same reason as `/offramp/routes`; the spec's exception should have covered both. Out of scope per `ui/docs/CONTEXT.md` §5. |
| `GET /agents/{id}/versions` | Returns `AgentVersionDetailResponse` — `systemPrompt`, `model`, `timeoutSeconds` | **Named orphan, deliberately.** `types.ts` states it: *"an endpoint this app deliberately never calls."* Calling it would put seller IP in the browser. This orphan is a feature. |
| `POST /agents/{id}/versions` | No version-editing UI; a seller creates v1 and stops | **Named orphan.** Out of scope (no new features). |

Plus `GET /orders` from R-07. Everything else in the contract is reached:
`/demo/seed`, `/demo/reset`, `/health`, `/docs` (§1 of the test plan), `/auth/nonce`,
`/auth/verify`, `/auth/session`, `/me`, `/me/ledger`, `/topup`, `/withdraw`, `/offramp`,
`GET /agents`, `POST /agents`, `GET /agents/{id}`, `PATCH /agents/{id}/active`,
`POST /orders`, `GET /orders/{id}`, `/case-file`, `/accept`, `/complain`, `/verdict`,
`GET /sales`.

Full both-directions map: [`contracts/boundary-inventory.md`](./contracts/boundary-inventory.md).

---

## R-11 — What agrees, checked and recorded

Recorded so the next pass does not re-derive it. Each of these was walked, not assumed.

**All four enumerations match member for member**, which the frontend's exhaustive switches
depend on:

| Enum | Contract | Frontend | |
| --- | --- | --- | --- |
| `OrderState` | 8: purchased, running, delivered, failed, released, disputed, adjudicated, settled | 8, same order | ✓ |
| `LedgerKind` | 4: onramp, purchase, offramp, adjustment | 4, same order | ✓ |
| `VerdictTier` | 5: none, quarter, half, three_quarter, full | 5, same order | ✓ |
| `CitationSource` | 3: capability, exclusion, criterion | 3 | ✓ |

The `VerdictTier` five-member list is worth a note: divergence row 4 records that `tech-stack.md`
§5 showed `["0","25","50","75","100"]` and was **updated** to match the DDL and the code. The
frontend already had the correct five. A frontend written from `tech-stack.md` would have had
five wrong strings and a blank tier badge on every card.

**Unknown members degrade rather than throw.** `Verdict.tier` is typed `string` at the wire and
narrowed inside `tierDisplay`, whose switch falls through to a helper rather than returning
`undefined` — so an unrecognised tier renders labelled, not blank. `Citation.source` widens to
`string` by design. This satisfies FR-011 without a change.

**The citation field is `quote`.** `CitationResponse` requires `source`, `quote`, `met`.
`RawCitation.quote` matches, and its doc comment names the incident. The divergence report
confirms under *What matched* that `quote` was always correct and that the `clause`/`quote`
bug — the incident that motivated this whole spec — **was the frontend's error and is already
fixed**. The source brief was written against commit `67dcf4d`, before the fix.

Nothing to do in code. It survives in the test plan as a named failure symptom, because the
symptom (rows of empty quotation marks) is what a tester would see if it ever regressed, and
naming it is what makes the report actionable.

**T033 is discharged: keep the subtraction.** `VerdictResponse` carries `tier`, `refundMinor`,
`reasoning`, `citations`, `txHash`, `model`, `createdAt` — and **no `sellerMinor`**. The
carryover's condition ("if the API sends `sellerMinor`") is false. `splitFor`'s
`priceMinor - refundMinor` and its reconciliation guard stay exactly as they are. Answered,
not deferred again.

**Money.** Every money field on every schema is `integer / int64` named `*Minor`, US cents.
No decimals, no strings, no unsuffixed amounts. The frontend's `Cents` and `Minor` convention
matches throughout.

**Casing.** camelCase everywhere on both sides, requests and responses. Decided once, applied
everywhere, nothing to change.

**Status codes and the fatal/retryable split.** The divergence report confirms live that a
caller who is neither buyer nor agent owner receives **404, never 403 or 500** — and flags it
as *"the one the consuming UI depends on: anything but 404/403 is retried forever."*
`useOrder`'s fatal set is `{404, 403}`, which matches. The verdict route is the exception, and
that is R-02.

**Authentication per endpoint.** Checked against every `security:` block. Public: `/health`,
`/demo/seed`, `/demo/reset`, `/auth/nonce`, `/auth/verify`, `GET /agents/{id}`. Optional
bearer: `GET /agents` (needed for `?owner=me`). Bearer-required: everything else. No page
issues a call it believes is public against a guarded endpoint — the three routes rendering
without a session (Connect, Marketplace, Agent Detail) call only public or optional-bearer
endpoints.

**Seller-authorised reads.** `GET /orders/{id}`, `/case-file`, and `/verdict` are buyer **or**
agent owner, confirmed live from both viewpoints in the divergence report; `accept` and
`complain` are buyer-only. `SellerSalePage` reads all three and offers no reply control, which
matches.

**Request bodies.** `CreateOrderRequest` requires exactly `agentId`, `input`,
`acceptanceCriteria` — no `price`, no `reviewWindowSeconds`, so FR-021's guarantee-by-omission
is enforced by the contract as well as the frontend type. `CreateAgentRequest` has
`timeoutSeconds` optional, which the frontend correctly does not send. `SetActiveRequest` is
an absolute `{ active }`, not a toggle. `ComplainRequest` is `{ reason }`. All match.

**Unknown request properties are accepted and silently stripped** (divergence row 10,
`intentional`, verified live). Nothing to change, but worth knowing: a frontend typo in a
request key is a 200 with the field missing, not a 400. Another silent-failure path, and
another argument for the walk in this document.

---

## Decisions

| Decision | Rationale | Alternatives rejected |
| --- | --- | --- |
| Fix R-01 and R-02 before writing the test plan | A plan written against a build that cannot sign in has never been sanity-checked; an unchecked plan is the 3am-ambiguity failure the spec warns about | Writing both in parallel — rejected, the plan's own steps are the first check on the fixes |
| Branch on `error.code`, not on a retry cap, for R-02 | The codes are the contract's designed mechanism, already parsed by `client.ts`, and a cap turns correctness into a timeout | Retry cap; treating all 404s as retryable (reopens the infinite-poll path) |
| R-04: copy change, no data workaround | The divergence report explicitly reserves the decision for the seller-IP owner; a client-side workaround would outlive the bug | Fetching the seller endpoint as a buyer (breaks invariant #3); hiding the section (hides the defect) |
| Keep `txHash: string \| null` despite the contract | The non-null guarantee is on the contract's weakest evidence — documented from source, never captured | Matching the contract exactly and removing the null branch |
| Do not adopt `explorerUrl`, `amountMinor`, `accountId`, `model`, `version` | Absences are load-bearing; a field needs a reason beyond "the API sends it" | Adopting them for completeness — the rule this feature exists to defend |
| Name My Orders as an expected placeholder in the test plan | A live route the nav links to; an unexplained placeholder produces a false failure report | Building the page (out of scope); omitting the step (the tester finds it anyway) |
| Reconciliation note at `ui/docs/reconciliation-note.md` | It is a standing product record, not a planning artifact; belongs beside the test plan | Inside `specs/008-…/` — would bury it from anyone not reading this feature |
