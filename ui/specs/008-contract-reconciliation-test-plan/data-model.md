# Phase 1 — Data model

Two kinds of thing here. The **documents** this feature creates have a structure, and it is
the structure that makes them checkable rather than prose. The **frontend types** change in
three places, and those changes are stated as field-level deltas so a reviewer can see exactly
what was added and what was deliberately not.

---

## Part 1 — The documents

### Reconciliation row

One per disagreement found between the frontend and the contract. The unit of the delivered
reconciliation note.

| Field | Type | Rules |
| --- | --- | --- |
| `id` | `R-NN` | Stable. Referenced from the note, the test plan, and any escalation raised against `api/`. |
| `boundary` | text | The endpoint and the specific field or behaviour — enough to find it without searching. |
| `whatDiffered` | text | Both sides stated: what the contract says, what the frontend does. Never one side alone. |
| `classification` | enum | `contract-correct` · `api-wrong` · `design-stale` · `intentional` · `agrees` |
| `severity` | enum | `blocker` · `defect` · `record-only` |
| `resolution` | enum | `fixed-frontend` · `escalated` · `ignored-with-reason` · `named-orphan` · `no-change` |
| `reason` | text | Required on every row, not only the changed ones. `ignored-with-reason` without a reason is an empty row. |
| `evidence` | text | Where the finding came from: contract line, source file and line, divergence-report row. |
| `touches` | path list | Files changed, or empty. |

**Classification is not free.** It comes from `api/docs/openapi-divergences.md`, which is why
that file is read before the contract. A row absent from the report is `contract-correct` by
default; only the report can make a row `api-wrong`.

**Validation rules**

1. Every `api-wrong` row in the divergence report has a matching row here with a non-empty
   `resolution` — including `escalated`, which is a complete resolution. *(FR-024, SC-003)*
2. `severity: blocker` requires `resolution: fixed-frontend` or `escalated`. A blocker cannot
   be `ignored-with-reason`.
3. `classification: api-wrong` forbids `resolution: fixed-frontend`. The frontend does not
   absorb an API defect. *(FR-003)*
4. Every row whose resolution adds a field to a frontend type carries a reason beyond "the API
   sends it." *(FR-005)*

**State**: a row is `open` until it has a resolution, then `closed`. `escalated` rows close
here and stay open in the `api/` component — the two are different books.

### Test step

The unit of `docs/manual-test-plan.md`. Every row in every section is one of these.

| Field | Type | Rules |
| --- | --- | --- |
| `id` | `§N.M` | Section-scoped so a tester can report "§2.14 failed" and be understood. |
| `action` | text | One thing to do, in the second person, naming the exact control or URL. |
| `expected` | text | **Exactly one** observable result. Not two, not "and check that…". |
| `pass` | ☐ | The checkbox. Present on every step without exception. *(FR-027)* |
| `failureSymptom` | text? | What a subtle failure looks like and what it usually means. Required wherever the failure is not self-evident. *(FR-028)* |
| `carryover` | ref? | The deferred criterion this step discharges, if any. |

**Validation rules**

1. `expected` contains no subjective predicate — no "looks correct", "looks right", "seems
   fine", "renders properly", "works". *(FR-026, SC-002)* Grep-checkable, and the quickstart
   greps for it.
2. Exactly one expected result per step. A step needing two becomes two steps.
3. `expected` is observable by someone who has not read the source — a screen state, a figure,
   a URL, a network response. Never an internal state or a code path.
4. Every step has `pass`.
5. Every `carryover` in the register maps to at least one step. *(FR-040, SC-012)*

### Carryover

A criterion an earlier spec deferred to manual verification. The register exists so a deferral
is a scheduled check rather than a lost one.

| Field | Type | Rules |
| --- | --- | --- |
| `id` | text | The earlier spec's own identifier where it has one (`T029`, `T033`, `T039`, `T040`). |
| `origin` | spec ref | `UI-05` or `UI-07`. |
| `what` | text | The criterion, restated so it stands alone. |
| `whyDeferred` | text | The original reason. Preserved — a deferral without its reason reads as an oversight. |
| `dischargedBy` | step ref \| `answered` | A step in the plan, or `answered` for a carryover the reconciliation resolved outright. |

**The register** — ten carryovers, complete per FR-040:

| id | origin | What | Discharged by |
| --- | --- | --- | --- |
| T039 | UI-07 | Greyscale on the seller screens | §6 |
| T040 | UI-07 | The seller flow end to end | §3 |
| T029-live | UI-07 | Open a settled order **as the buyer** and confirm the `perspective` prop changed nothing about the verdict card. The static tier only proved the diff was small. | §3 |
| SELLER-DISPUTE | UI-07 | The seller reading a disputed sale's case file and verdict — buyer-or-owner authorisation from the seller's side | §3 |
| QS-B…QS-F | UI-05 | Quickstart parts B–F | §2 |
| GREY-VERDICT | UI-05 | Greyscale on the verdict card | §6 |
| LEGIBILITY-3M | UI-05 | Tier, refund figure, ✓/✗ readable at ~3m | §6 |
| LONG-CLAUSE | UI-05 | A citation quoting a ~300-character criterion must not break the checklist | §6 |
| STRANGER | UI-05 | A stranger reads a settled order and says what happened and why | §6 |
| T033 | UI-05 | If the API sends `sellerMinor`, delete `splitFor`'s subtraction and its guard | **`answered`** — the contract carries no `sellerMinor` (research R-11). Keep the subtraction. |

**No seller screen has ever rendered.** Every seller route sits behind `RequireAuth`, and
R-01 means sign-in has been failing — so T039, T040, and the seller-dispute carryover have
never been executable, not merely unexecuted. They become executable only after R-01 lands.

---

## Part 2 — Frontend type deltas

Three types change. Stated as deltas because the additions matter less than the
non-additions — six contract fields are deliberately not adopted, and that is a decision, not
an omission.

### `NonceResponse` — R-01

```diff
  export interface NonceResponse {
    nonce: string;
+   /**
+    * The exact bytes to sign, server-owned. Sign this verbatim — never the
+    * nonce, and never a client-side reconstruction: the format embeds the
+    * address and newlines, and any drift surfaces only as an opaque 401.
+    */
+   message: string;
  }
```

`nonce` stays: the contract requires it and the failure copy is clearer with it. It is simply
never the thing signed.

**Invariant this preserves**: the wallet signs exactly one thing and it authorises nothing but
a session. Changing *which string* does not change that.

### `OwnedAgent` — R-03

```diff
  export interface OwnedAgent extends AgentSummary {
    active: boolean;
+   /**
+    * Whether on-chain registration landed. `false` = exists in Postgres, no
+    * on-chain counterpart, invisible to every buyer. `active: true, listed:
+    * false` is the dangerous pair — it reads as healthy and cannot be bought.
+    */
+   listed: boolean;
  }
```

Two booleans that mean different things and both need saying on screen. `active` is the
seller's own switch; `listed` is whether the chain agreed.

**Still absent, still deliberate**: no `systemPrompt`, `model`, `timeoutSeconds`, or schemas.
The seller's own list has nowhere to put a prompt, which is FR-037 enforced by shape.

### `WithdrawResponse` — R-05

```diff
  export interface WithdrawResponse {
    txHash: string | null;
  }
```

**Unchanged**, and the delta is the reasoning. The contract types `txHash` as required and
non-null and adds `amountMinor` and `explorerUrl`. All three are declined:

- `txHash` stays nullable — the contract's non-null guarantee rests on the weakest evidence in
  the document (documented from source, never captured, because no test account had settled
  on-chain funds). Handling a null the contract says cannot happen costs one branch.
- `explorerUrl` — the frontend builds explorer links from configured chain metadata. Two
  sources of truth for where a hash points, one unvalidatable, is worse than one.
- `amountMinor` — `GET /me` is re-read after a withdrawal and is the authority on every figure
  on that screen. A second number on the write response could disagree with it.

### Types explicitly **not** changed

Recorded because "the API sends it" is the argument this project has decided to refuse.

| Type | Contract sends | Why not adopted |
| --- | --- | --- |
| `AccountSummary` | `accountId` | Nothing renders an account id. |
| `AgentListing` | `version` | Nothing renders a version. Still no `systemPrompt`/`model`/`timeoutSeconds` — those live only on the versions endpoint the frontend never calls. |
| `Verdict` | `model` | Rendering the model name pushes the card back toward "an AI decided this" — the one thing the citation checklist exists to prevent. |
| `CaseFile` / `CaseFileStep` | `steps` (always `[]` for a buyer) | Kept as typed; the API is the defect (R-04). Escalated, with copy that stops an empty list reading as "nothing ran". |
| `PurchaseRequest` | — | Contract confirms no `price`, no `reviewWindowSeconds`. Guarantee holds on both sides now, not just in the frontend type. |

---

## Part 3 — Boundary state transitions the plan must observe

The frontend renders eight order states. The test plan's §2 walks the two paths through them,
and every transition below is a step with a visible expected result — that is what makes
FR-022 ("every state the API writes is one the frontend renders") checkable by a human rather
than asserted.

```text
purchased ──▶ running ──▶ delivered ──┬──▶ released          (accepted, or swept at T-0)
                    │                 └──▶ disputed ──▶ adjudicated ──▶ settled
                    └──▶ failed
```

| Transition | Trigger | Visible result the plan asserts |
| --- | --- | --- |
| `purchased → running` | Execution starts | The order screen stops saying "not started" |
| `running → delivered` | Agent returns | Output appears beside the acceptance criteria; the countdown starts |
| `running → failed` | Agent produced nothing | The nothing-came-back face — distinct from a null output within a delivered run |
| `delivered → released` | Buyer accepts, **or** the sweeper at T-0 | **The page flips with nobody touching the keyboard** |
| `delivered → disputed` | Buyer complains | The page moves to disputed **without a refresh** |
| `disputed → adjudicated` | Guardian rules | The verdict card appears — **the transition R-02 currently breaks** |
| `adjudicated → settled` | Escrow splits | The transaction hash appears and links to a page that exists; balances move |

The plan never asserts a state name a tester cannot see. Each row above is written as its
on-screen consequence, because "the state is `adjudicated`" is not observable from a browser
and "the verdict card appeared" is.
