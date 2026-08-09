# API contract — divergence report

**Generated:** 2026-08-09 · **Contract:** [`openapi.yaml`](./openapi.yaml) · **Compared against:**
[`../../docs/api-design.md`](../../docs/api-design.md) §1.2, §1.3, §3 ·
[`../../docs/database-schema.md`](../../docs/database-schema.md) §8 ·
[`../../docs/tech-stack.md`](../../docs/tech-stack.md) §5

The contract describes **what the API does**. This file records where that differs from
what it was designed to do, and what was decided about each difference.

**How to read this if you are building against the contract.** Every row below is a place
where the document and the design disagreed. All of them are now safe to adopt as written:
row 5 was the one `api-wrong` row, it has since been **fixed in the API**, and the contract
and the design now agree. Everything not listed here matched and can be adopted as written.

The comparison was performed after the contract was finished, against captured responses,
not against the source. It covered all 27 registered routes, the four enumerations, the
money fields of `GET /me`, the three buyer-or-seller reads, and every error body.

---

## The rows

| # | Endpoint / field | Design says | Code does | Verdict | Resolution |
| --- | --- | --- | --- | --- | --- |
| 1 | `POST /auth/nonce` response | `{ address }` → `{ nonce }` (api-design §3.1) | `{ nonce, message }` | `design-stale` | api-design.md §3.1 updated — the client signs `message`, so omitting it from the design made the flow unimplementable as written |
| 2 | `GET /auth/session` | absent from api-design §3.1 | registered and served; returns `{ accountId, address }` | `design-stale` | api-design.md §3.1 updated — row added |
| 3 | `GET /health` | absent from api-design §3 entirely | registered and served; Terminus shape with a database ping, 503 when down | `design-stale` | api-design.md §3 updated — new §3.6 |
| 4 | Verdict tier values | tech-stack §5 shows `z.enum(["0","25","50","75","100"])` | emits `none` · `quarter` · `half` · `three_quarter` · `full`, matching database-schema §8's `verdict_tier` | `design-stale` | tech-stack.md §5 updated — the two design documents disagreed with each other; the DDL is the one the code follows |
| 5 | `GET /orders/{id}/case-file` → `steps`, buyer view | api-design §1.3: *"Execution steps are shown to buyers… The serialiser summarises reasoning text rather than passing it through raw"* | **was** always `[]` for a buyer — the buyer's query did not select `runs.steps` at all | **`api-wrong`** | ✅ **FIXED 2026-08-09.** The buyer's copy now carries the redacted trace. See below |
| 6 | `GET /orders/{id}/verdict` error body | not specified | bare `{ "error": "CODE" }` — no `statusCode`, no `message`. Unique in the API | `intentional` | Documented. The route is polled, and the UI must tell `ORDER_NOT_FOUND` from `VERDICT_NOT_FOUND` on the same 404 — a code is the only honest way. Kept as-is; see *Decision on row 6* |
| 7 | Chain-outcome-unknown `502` body | not specified | `{ message, txHash }` — no `statusCode` | `intentional` | Documented as `ChainOutcomeUnknownResponse`. The hash is the only way to learn what happened, so it must not be flattened into a generic error |
| 8 | Request-validation `400` body | not specified | `{ message, errors }` — no `statusCode`, unlike every other 400 | `intentional` | Documented as `ValidationErrorResponse`. A malformed **body** and a malformed **UUID in the path** return different shapes from the same operation; both are documented per route |
| 9 | POST success status codes | not specified | Mixed: **201** on `/auth/nonce`, `/auth/verify`, `/agents`, `/agents/{id}/versions`, `/orders`; **200** on the three funding routes, both Rain stubs and both demo routes; **202** on `accept` and `complain` | `intentional` | Documented per operation. The 202s are load-bearing (api-design §1.2 — both return before the work is done). The 201 on `/auth/nonce` is Nest's POST default rather than a decision, but changing it would break any client already written against it |
| 10 | Unknown properties in a request body | not specified | Accepted and silently **stripped**, not rejected — verified live: an extra key returns 200, not 400 | `intentional` | Documented on each request schema as `additionalProperties: true` with an `x-unknown-properties` note. Documenting them as closed would have claimed a rejection that does not happen |

---

## Row 5 in full — the one defect this report found, and how it was closed

**Status: fixed on 2026-08-09**, after the escalation this report opened was decided by the
owner of the seller-IP boundary. The narrative below is kept as written — it is the record of
what the defect was and what the decision had to weigh — with the outcome at the end.

**What the design says.** `api-design.md` §1.3 states that execution steps are shown to
buyers, and that the serialiser *summarises* reasoning text rather than passing it through
raw — the summarisation exists precisely because a reasoning turn can paraphrase the system
prompt. `ui-design.md` §7.1 describes the same buyer-facing trace.

**What the code did.** `CaseFileService.getForBuyer` returned `steps: []`, unconditionally.
`findCaseFileForBuyer` did not select `runs.steps`, so the raw trace never entered the
process on a buyer's read.

**Why it is `api-wrong` and not `intentional`.** The behaviour is deliberate and carries a
long written justification — it is layer 1 of a three-layer defence around seller IP. But
that justification rests on a premise that has since expired. It says, in
`case-file.service.ts`:

> *"Today it would change nothing anyway: API-08 does not exist, no `runs` row is ever
> written, and every case file in the product reports an empty trace — which is an accurate
> statement that nothing has run, not a placeholder."*

API-08 shipped. `runs` rows are written now, and the capture for this feature shows a
seller's case file carrying two populated steps for the same order whose buyer view is
empty. So the empty array is no longer an accurate statement that nothing ran — it is a
silent omission of evidence the design says the buyer is owed.

**Why it was not fixed in the contract pass.** The fix is small and the machinery already exists:
`toBuyerCaseFileSteps` is written, tested by use on the seller path, and structurally
incapable of emitting `reasoning`. Adding `r.steps` to the buyer's query and mapping through
it is a few lines. But it deliberately weakens one layer of the three protecting invariant
#3 — *`system_prompt` never reaches a buyer* — and the code says so explicitly:

> *"Making the change is a deliberate weakening of one layer of three, and it belongs in a
> diff that says so, not in this one."*

That is a judgement about the seller-IP boundary, days before a demo. It belongs to whoever
owns that boundary, not to the contract-writing pass. **This report raises it; it does not
decide it.**

**How it was decided, and what changed.** The decision came back *fix it*: two layers are
enough, because neither of the remaining two is a matter of anyone's attention — the mapper
reads four fields by name and the response type is closed, so `reasoning` has no expression
to travel in and no property to land in. The layer that was given up was the select list,
which is the only one that also covered a log line and a stack trace; `reasoning` shares its
jsonb column with the fields the summary is composed from, so keeping it meant keeping the
buyer's trace empty.

Three files changed, all in `api/src/orders/`:

- `order.repository.ts` — `r.steps` moved into the shared `caseFileQuery`, so both parties'
  reads fetch it. `system_prompt` is now the **only** column separating the two case files,
  and `runSteps` moved from `SellerCaseFileRow` onto `CaseFileRow`, typed `unknown[]` so
  nothing can reach `reasoning` by name.
- `case-file.service.ts` — `getForBuyer` returns `toBuyerCaseFileSteps(row.runSteps)`. The
  doc-comment is the diff the old one asked for: it names the layer given up and the two that
  hold.
- `dto/case-file.dto.ts` — `BuyerCaseFileResponse.steps` no longer documents itself as always
  empty. `[]` now means no run, or a run that recorded no steps.

**What a consumer should do.** Build the buyer-facing trace view. `steps` carries `label`,
`summary`, `durationMs` and `error` per step — never `reasoning`, which is what
*summarised* means here. `[]` still occurs and still means what it says: no run, or a run
with no steps.

---

## Decision on row 6 — the bare `{error: "CODE"}` body

Two readings were considered:

- **`api-wrong`** — the shape is inconsistent with the rest of the API and a client cannot
  render a message for these three cases.
- **`intentional`** — the route is polled, and `ORDER_NOT_FOUND` and `VERDICT_NOT_FOUND` are
  both `404` with genuinely different meanings: *this is not your order* versus *the audit
  has not finished, keep polling*. Nothing but a machine-readable code distinguishes them,
  and a client that cannot tell them apart either gives up on a pending audit or polls a
  non-existent order forever.

**Verdict: `intentional`.** The code carries information the ordinary shape cannot. The
inconsistency is documented rather than removed.

An additive fix — adding `statusCode` and `message` **alongside** the existing `error` — was
considered and rejected for this pass: it is a behaviour change outside the one class this
feature permits, and it buys nothing the `error` code does not already give a client. If it
is done later, `error` must stay, because clients are already reading it.

---

## Fixed in this branch

- **Row 5** — the buyer's case file now carries the redacted trace, so the code matches
  `api-design.md` §1.3 and `ui-design.md` §7.1. The `DO NOT ADOPT` markers in this report and
  in `openapi.yaml` are withdrawn.

Every other row was resolved by correcting a design document or by recording a reason.

## Known wrong, not fixed

None.

## Design documents updated

- `../../docs/api-design.md` — §3.1 (`POST /auth/nonce` response, `GET /auth/session` added),
  new §3.6 for `GET /health`.
- `../../docs/tech-stack.md` — §5, the verdict tier enum now matches the DDL and the API.

## Documented from source, not captured

Three responses in the contract were written from reading the code because provoking them
live was not worth the cost. A reader is entitled to know they carry less evidence than the
rest:

| Response | Why not captured |
| --- | --- |
| `POST /withdraw` **200** (`WithdrawResponse`) | No account in the test run had settled on-chain funds, so every live call returned the captured 409. Shape taken from `src/funding/dto/withdraw.dto.ts` |
| `502` on `/topup`, `/withdraw`, `/offramp` | Provoking them means taking the RPC endpoint down mid-rehearsal. Shapes taken from `src/common/chain-http.ts` |
| `AccountSummaryResponse.settledFundsMinor` = `null` | The chain read succeeded on every capture, so only the integer branch was observed. The `null` branch is specified in api-design §3.2.1 and is documented as required-and-nullable on that authority |

Everything else in the contract — 27 routes, both case-file viewer shapes, and fifteen
failure bodies — was transcribed from a response captured off the running API.

## What matched

Checked and found in agreement, so no row:

- All four enumerations against `database-schema.md` §8 — `order_state` (8), `ledger_kind`
  (4), `verdict_tier` (5) — and `CitationSource` against tech-stack §5.
- The three money figures of `GET /me` against api-design §3.2.1, including
  `settledFundsMinor` being nullable and meaning *unknown* rather than zero.
- The citation field is named **`quote`**, exactly as tech-stack §5 specifies. The
  `clause`/`quote` incident (`67dcf4d`) was the frontend's error and is already fixed; a
  contract generated blindly from either side at that moment would have gone the wrong way,
  which is why this report exists.
- The buyer-**or**-agent-owner authorisation on `GET /orders/{id}`, `/case-file` and
  `/verdict` (api-design §3.4), confirmed live from both viewpoints — and the two writes
  (`accept`, `complain`) confirmed buyer-only.
- A caller who is neither buyer nor owner receives **404**, never 403 or 500 — confirmed
  live. This is the one the consuming UI depends on: anything but 404/403 is retried
  forever.
- `GET /agents` excludes agents whose on-chain registration never completed
  (`a.onchain_agent_id IS NOT NULL`), while `?owner=me` includes them flagged `listed:
  false` — api-design §3.3's requirement, implemented.
- Both Rain routes return an explicit non-success stub body and are authenticated, per
  rain §0 and the api-design §3.2 note that a stub must never look like a success.
- Both demo routes are unauthenticated with no environment guard, per api-design §8.
