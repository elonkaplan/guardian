# Frontend ↔ API reconciliation

**Date:** 2026-08-09 · **Feature:** UI-08 ·
**Contract:** [`../../api/docs/openapi.yaml`](../../api/docs/openapi.yaml) — 21 paths, 27
routes, written from the running API ·
**Divergence report:** [`../../api/docs/openapi-divergences.md`](../../api/docs/openapi-divergences.md)
— **read first**

## How to read this

The contract is generated from the running implementation, so it describes what the API
genuinely does — which makes it the right thing to match and the wrong thing to trust blindly.
A field the API named badly is in there too, described faithfully. **The divergence report is
what separates "the contract is right, fix the frontend" from "the API is the defect."**

Every row below is a place this frontend does not match the contract, or did not until UI-08.
Rows resolved `no-change` are places it diverges *on purpose* — they are here so the next
person does not re-derive the reasoning, and so that adding a field always needs an argument
beyond "the API sends it."

Rows were found by walking the boundary in **both** directions: from each frontend call site to
its schema, and from every schema property back to the frontend types. The second direction is
the one that finds fields arriving on the wire and being discarded in silence. It found four.

## Summary

**Two blockers, both fixed.** Sign-in was signing the wrong string and had been failing on
every attempt (R-01); the verdict poll was abandoning audits that were still running (R-02).
Both were confirmed live against the API before being touched, and both are one-function
changes.

| | Count |
|---|---|
| Findings | 12 |
| Blockers | 2 — both `fixed-frontend` |
| Other defects fixed | 1 (R-03) |
| `api-wrong`, escalated | 1 (R-04) — since fixed in `api/` |
| Diverging on purpose, recorded | 5 |
| Orphan endpoints named | 6 |
| Latent risk recorded, not fixed | 1 (R-12) |
| Checked and agreeing | R-11, nine categories |

## The rows

| # | Boundary | What differed | Divergence report | Resolution | Reason |
|---|---|---|---|---|---|
| **R-01** | `POST /auth/nonce` → the signed string | Contract returns `{nonce, message}` and requires a signature over **`message`**, a multi-line string embedding the address. Frontend declared only `nonce` and signed it verbatim | Row 1, `design-stale` — api-design §3.1 was updated *because* the client signs `message` | **fixed-frontend** | The contract is correct and the frontend was wrong. Confirmed live: same key, same nonce — signing `nonce` → `401 Signature verification failed`, signing `message` → `201` with a token |
| **R-02** | `GET /orders/{id}/verdict` error handling | Contract returns a bare `{error: CODE}` with **two different 404s**: `ORDER_NOT_FOUND` (terminal) and `VERDICT_NOT_FOUND` (audit still running, keep polling), plus `409 AUDIT_FAILED` (terminal). Frontend branched on HTTP status alone | Row 6, `intentional` — the bare code was kept deliberately *so that* a client can tell the two apart | **fixed-frontend** | Wrong in both directions at once: it stopped on the case that resolves by waiting and retried the case that never does. Confirmed live: both 404 codes reproduced |
| **R-03** | `GET /agents?owner=me` → `listed` | `OwnedAgentResponse` requires `listed`; frontend's `OwnedAgent` declared five of six fields and discarded it | Not a row — confirmed under *What matched* | **fixed-frontend** | `active: true, listed: false` renders as a healthy agent that no buyer can see. The contract's own note says it is "worth surfacing in the UI" |
| **R-04** | `GET /orders/{id}/case-file` → `steps`, buyer view | Contract documented a summarised trace; the API returned `steps: []` **unconditionally** for a buyer. The seller's copy of the same order carried the real trace | **Row 5, `api-wrong`** — the only defect the report found; now `FIXED` | **escalated → fixed in `api/` 2026-08-09** | See in full below. The escalation was decided *fix it*; the frontend's interim copy has been withdrawn along with the bug |
| R-05 | `POST /withdraw` → `WithdrawResponse` | Contract requires `[txHash, amountMinor, explorerUrl]` with `txHash` **non-nullable**. Frontend declares only `txHash: string \| null` | Not a row | **no-change** | Three separate answers — see below |
| R-06 | `GET /me` → `accountId` | Contract sends it; frontend does not declare it | Not a row | **ignored-with-reason** | Nothing in the app renders an account id (verified: zero matches for `accountId` in `src/`). `GET /auth/session` is the documented way to learn it |
| R-07 | `GET /orders` | Defined by the contract; **no frontend module calls it**. `MyOrdersPage` is a four-line placeholder | Not a row | **named-orphan** | Building the page is out of scope. All three demo acts run on the order detail screen. The test plan makes the placeholder an *expected* result so it is not reported as a failure |
| R-08 | `GET /orders/{id}/verdict` → `model` | Contract sends it; frontend does not declare it | Not a row | **ignored-with-reason** | Rendering the model name pushes the card back toward "an AI decided this" — the one thing the citation checklist exists to prevent |
| R-09 | `GET /agents/{id}` → `version` | Contract sends it; frontend does not declare it | Not a row | **ignored-with-reason** | Nothing renders a version number, and an order pins its own version server-side |
| R-10 | `/onramp/routes`, `/offramp/routes`, both `/agents/{id}/versions` | Defined by the contract; no page reaches them | Not a row | **named-orphan** | See *Orphan endpoints* below. One of them is an orphan **by design** |
| R-11 | Enums, money, casing, status codes, auth, seller reads, request bodies | Nothing | Not a row | **no-change** | Checked and agreeing. Recorded in *What agrees* so the next pass need not re-derive it |
| R-12 | Unrecognised `OrderState` at runtime | Contract and frontend agree on all 8 members today, so nothing can emit a ninth. But `faceFor` throws rather than degrading, and the app has no error boundary | Not a row | **record-only** | Cannot fire against the current contract. Recorded rather than fixed — see below |

---

## R-04 in full — the one `api-wrong` row, since fixed

**Status: closed on 2026-08-09.** The escalation this row raised was decided *fix it*, and the
API now sends a buyer the redacted trace. The account below is kept as written, with the
outcome at the end.

**What the API did.** `CaseFileService.getForBuyer` returned `steps: []` unconditionally;
`findCaseFileForBuyer` did not select the trace at all, so it never entered the process on a
buyer's read. Verified live: a buyer's case file for an order returned an empty array while the
seller's case file for the *same order* returned the populated trace.

**Why it is wrong.** `api-design.md` §1.3 and `ui-design.md` §7.1 both state that a buyer sees a
summarised execution trace. The summarisation machinery exists precisely because a reasoning
step can paraphrase the seller's system prompt. The behaviour was once accurate — no `runs`
rows were being written, so an empty trace was a true statement that nothing had run — but that
premise expired when API-08 shipped. It is now a silent omission of evidence the design says
the buyer is owed.

**Why this pass did not fix it.** The divergence report declined to decide it, and said why: the
fix deliberately weakens one of three layers protecting invariant #3 — *`system_prompt` never
reaches a buyer* — and that is a judgement about the seller-IP boundary belonging to whoever
owns it, not to a contract-writing pass or a frontend reconciliation. **This note raised it; it
did not decide it either.**

**Escalated to:** the `api/` component, as `api/docs/ESCALATION-buyer-case-file-steps.md`,
referencing divergence row 5.

**What the frontend did meanwhile.** Copy only. `ExecutionSteps` said, on a buyer's copy, that
the execution trace is not included in a buyer's case file and that this is not a statement
about what the agent did. It previously said *"No execution steps were recorded for this order"*
— a false claim about their order, and the worst kind, because it reads as evidence the agent
did nothing on the screen where a buyer is deciding whether they were treated fairly.

**What it did not do**, and these were the point: it did not fetch the seller's endpoint (that
would break invariant #3 from the client side), did not synthesise steps, and did not hide the
section as though the design never called for it. **No workaround was to outlive the bug.**

**How it closed.** The decision came back *fix it*: the layer given up was the buyer's select
list, and it could not have been kept anyway — `reasoning` shares a jsonb column with the fields
the summary is built from, so it was the whole trace or none of it. The two remaining layers are
structural rather than attentional: `toBuyerCaseFileSteps` reads four fields by name and never
`reasoning`, and `CaseFileStepResponse` is closed. `system_prompt` is still absent from the
buyer's query, and is now the only column separating the two case files.

The interim copy is gone, exactly as promised: `ExecutionSteps` no longer takes `perspective`,
because an empty list now means the same thing to either reader — no run, or a run that recorded
nothing. `manual-test-plan.md` §7.7 flipped with it, from *expect `[]`* to *expect a populated,
redacted list*.

---

## R-05 in full — three divergences, three answers

The contract requires `[txHash, amountMinor, explorerUrl]` and types `txHash` as a non-nullable
`string`. The frontend keeps `{ txHash: string | null }` and reads nothing else.

1. **`txHash` stays nullable.** The frontend is stricter than the contract requires, in the safe
   direction — it handles a null the contract says cannot occur and degrades to a plain
   confirmation rather than rendering a dead link. This is also the **weakest-evidenced response
   in the whole contract**: the divergence report lists it under *documented from source, not
   captured*, because no account in the test run had settled on-chain funds and every live call
   returned the 409. Removing a null check on the strength of an uncaptured guarantee would be
   trusting the one part of the document that carries the least evidence.
2. **`explorerUrl` is not adopted.** The frontend builds explorer links from configured chain
   metadata (`chain/chains.ts` → `ExplorerTxLink`). Adopting a server-supplied URL means two
   sources of truth for where a hash points, one of which the frontend cannot validate before
   rendering it as a link.
3. **`amountMinor` is not adopted.** The wallet invalidates and re-reads `GET /me` after a
   withdrawal, and that read is the authority on every figure on the screen. A second number
   arriving on the write's response is free to disagree with it.

---

## R-12 in full — a crash that cannot happen yet

`faceFor`, `stateLabel`, `stateRank`, and `isTerminalState` in `lib/orderState.ts` all end in
`assertNever`, which **throws**. `faceFor` and `stateRank` are called during render, and the
application registers no React error boundary — so an `OrderState` value the frontend does not
recognise would blank the whole app rather than produce a blank badge.

**It cannot fire today.** The contract's `OrderState` and the frontend's union are identical,
member for member and in the same order — verified in R-11. There is no value the API can emit
that reaches `assertNever`.

**Recorded rather than fixed**, deliberately. Adding an error boundary is new behaviour, which
UI-08 excludes; and the mitigation the design actually relies on — the two enum lists staying
identical, with a diff between the files as the mechanism for noticing — is in place and
verified. What makes this worth writing down is that **the enum agreement is now load-bearing
for more than correctness**: it is the only thing standing between a ninth order state and a
white screen.

**If the API adds a ninth state, this is the file to read first.** The fix is either an error
boundary or making the four functions degrade rather than throw. It is not urgent; it is
precisely as urgent as the next change to `order_state`.

---

## Fields the contract sends that no frontend type declares

Six. Each needs a reason beyond "the API sends it" — that is the standard, because several
frontend types encode guarantees **by omission** and a type that grows fields to match the wire
would delete them while everything still compiled.

| Field | On | Not adopted because |
|---|---|---|
| `accountId` | `AccountSummaryResponse` | Nothing renders an account id |
| `version` | `AgentListingResponse` | Nothing renders a version; the order pins its own server-side |
| `model` | `VerdictResponse` | Would push the verdict card toward "an AI decided this" |
| `explorerUrl` | `WithdrawResponse` | Two sources of truth for where a hash points |
| `amountMinor` | `WithdrawResponse` | `GET /me` is the authority on every figure on that screen |
| `steps` (buyer) | `BuyerCaseFileResponse` | No longer in this table. It was declared-but-always-empty under R-04; since 2026-08-09 the API populates it and the screen renders it. Keeping it typed through the empty period is what made the fix a no-op on this side |

One field travels the other way: `Verdict.unreadableCitations` exists on the frontend type and
not on the wire. It is produced by the normaliser so that a citation this app could not parse is
**counted** on screen instead of vanishing, and a dropped row would quietly shrink the evidence.
Noted here because a mechanical diff of the two shapes will flag it.

## Orphan endpoints

Six paths the contract defines that no page reaches. The spec permits one by name; the rest are
listed here because an unnamed orphan is indistinguishable from an oversight.

| Path | Why unreached |
|---|---|
| `GET /orders` | My Orders is a placeholder (R-07). The demo path is the order detail screen |
| `POST /onramp/routes` | Rain is stubbed; no on-ramp route UI. Out of scope per `CONTEXT.md` §5 |
| `POST /offramp/routes` | Same. **This is the one the spec permits by name** (api-design §4) |
| `GET /agents/{id}/versions` | **Orphan by design.** It carries `systemPrompt`, `model`, and `timeoutSeconds`. This app deliberately never calls it — the guarantee holds on the wire, not only in the type |
| `POST /agents/{id}/versions` | No version-editing UI; a seller creates v1 and stops |
| `/stub/order` (frontend → nowhere) | Not an orphan but its mirror image: a call with no contract path, in a **DEV-only** polling harness excluded from production builds. Recorded for completeness |

## What agrees

Checked and found matching, so no row. Recorded so the next pass does not re-derive it.

**All four enumerations match member for member and in declaration order** — `OrderState` (8),
`LedgerKind` (4), `VerdictTier` (5), `CitationSource` (3). Worth noting that `tech-stack.md` §5
once showed the tiers as `["0","25","50","75","100"]` and was corrected (divergence row 4): a
frontend written from that document would have had five wrong strings and a blank tier badge on
every card.

**Unknown members degrade rather than throw — in three places out of four.** `tierDisplay`
guards with `isKnownTier` before its exhaustive switch and returns the raw string as a phrase;
`entryLabel` is a record lookup with a passthrough; `sourceLabel` has an explicit `default`.
`lib/orderState.ts` is the exception — see R-12.

**The citation field is `quote`,** and always was. The `clause`/`quote` incident that motivated
this whole reconciliation was the frontend's error and was already fixed before this pass began;
the divergence report confirms `quote` matches `tech-stack.md` §5. Nothing to do in code. It
survives in the test plan as a named failure symptom, because rows of empty quotation marks is
what a regression would look like and naming it is what makes a tester's report useful.

**Money** is `integer/int64` named `*Minor` in US cents on every schema, matching the frontend's
`Cents` and `Minor` convention. No decimals, no strings, no unsuffixed amounts.
`settledFundsMinor` is required-and-nullable on both sides, with `null` meaning *unknown, never
zero*.

**Casing** is camelCase throughout, requests and responses, both sides. Decided once, applied
everywhere.

**Status codes.** A caller who is neither buyer nor agent owner receives **404, never 403 or
500** — confirmed live by the divergence report, and the one guarantee the frontend's
fatal/retryable rule depends on. `useOrder` treats `{404, 403}` as fatal, which matches.
`useCaseFile` treats every error as fatal (a one-shot read with an explicit retry button).
The verdict route was the exception, and that was R-02.

**Authentication per endpoint**, checked against all 27 `security:` blocks. Six public
(`/health`, both `/demo/*`, both `/auth/*`, `GET /agents/{id}`), one optional-bearer
(`GET /agents`, which needs a token for `?owner=me`), twenty bearer-required. **No page that
renders without a session issues a bearer-required request** — the balance widget in the shell
is gated on `isSignedIn`, as is the buy panel on the public agent-detail page.

**Seller-authorised reads.** `GET /orders/{id}`, `/case-file`, and `/verdict` are buyer **or**
agent owner; `accept` and `complain` are buyer-only. The seller's sale page reads all three and
offers no reply control, which matches.

**Request bodies.** `CreateOrderRequest` requires exactly `agentId`, `input`,
`acceptanceCriteria` — **no `price` and no `reviewWindowSeconds`**. That guarantee is now
enforced on both sides of the wire rather than only by the frontend's type, which is a stronger
position than this component started from. `SetActiveRequest` is an absolute `{active}`, not a
toggle. `ComplainRequest` is `{reason}`.

**Unknown request properties are accepted and silently stripped** (divergence row 10,
`intentional`, verified live). Nothing to change, but worth knowing: a typo in a request key
produces a 200 with the field missing, not a 400. Another silent-failure path, and another
argument for walking the boundary rather than spot-checking it.

## Carryovers discharged here

- **UI-05 T033** — *"if the API sends `sellerMinor`, delete `splitFor`'s subtraction and its
  reconciliation guard."* **The API does not send it.** `VerdictResponse` requires exactly
  `tier`, `refundMinor`, `reasoning`, `citations`, `txHash`, `model`, `createdAt`. There is no
  figure to prefer over the client's, so the subtraction and its guard stay. Answered, not
  deferred again; recorded in `lib/verdict.ts` at the function itself.

The nine remaining carryovers are manual checks and are indexed in
[`manual-test-plan.md`](./manual-test-plan.md).

## Method and confidence

The desk pass read `openapi.yaml` and every frontend boundary; **R-01 and R-02 were then
confirmed live** against a running API before either was changed, because both were claims about
runtime behaviour rather than about text. Neither was withdrawn.

Three responses in the contract were, by its own admission, documented from source rather than
captured — `WithdrawResponse` 200, the 502 bodies, and `settledFundsMinor: null`. Findings
resting on them (R-05) are treated as lower-confidence and are resolved in the conservative
direction.
