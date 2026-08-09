# Quickstart — validating this feature's own output

**This is not the manual test plan.** The test plan is the deliverable; this is how you check
the deliverables before handing them to anyone. A tester executes `docs/manual-test-plan.md`.
A developer executes this.

**This feature does not run the test plan.** Nothing below reports a test-plan step as
passing. *(FR-041)*

## Prerequisites

```bash
# From the repo root
cd api && docker compose up -d        # Postgres on 5433 — a native Postgres holds 5432
cd api && npm run start:dev           # API on its configured port
cd ui  && npm run dev                 # Vite dev server
curl -s localhost:3000/health         # expect a Terminus body with a database ping
```

A browser wallet on **Monad Testnet (chain 10143)** with MON for gas. Seed the demo data:

```bash
curl -sX POST localhost:3000/demo/seed | jq '.agents[].key'   # ledgerbot, tldr, polyglot
```

---

## §1 — Confirm the two blockers, live, before anything else

The eleven findings in [research.md](./research.md) are **desk-verified**: read from the
contract and the source with the API not running. R-01 in particular is a claim about runtime
behaviour. Confirm it first — if it does not reproduce, the finding is withdrawn and recorded
as withdrawn, not quietly dropped.

### R-01 — sign-in signs the wrong string

**Before the fix**, confirm the defect exists:

```bash
# 1. What does the API actually issue?
curl -sX POST localhost:3000/auth/nonce \
  -H 'content-type: application/json' \
  -d '{"address":"0x1111111111111111111111111111111111111111"}' | jq
```

Expect **two** fields, `nonce` and `message`, with `message` a multi-line string embedding the
address. If `message` is absent, R-01 is withdrawn — stop and record that.

Then, in the browser: open the app, click through sign-in, approve the signature in the wallet.

- **Defect present**: `/auth/verify` returns 401 and the screen shows a signature-rejection
  message despite the wallet having signed successfully. Nothing behind `RequireAuth` opens.
- **Defect absent**: you land signed in. R-01 is withdrawn; record it and move on.

**After the fix**: the same click-through lands you signed in, and a page reload keeps the
session. Both are also §1 of the test plan, so this is the one check that runs twice on
purpose.

### R-02 — the verdict poll abandons a pending audit

Confirm the shape, which is what the fix branches on:

```bash
# An order that exists but has no verdict — expect 404 {"error":"VERDICT_NOT_FOUND"}
curl -s -o /dev/null -w '%{http_code}\n' localhost:3000/orders/$ORDER_ID/verdict \
  -H "authorization: Bearer $TOKEN"
curl -s localhost:3000/orders/$ORDER_ID/verdict -H "authorization: Bearer $TOKEN" | jq

# A random uuid — expect 404 {"error":"ORDER_NOT_FOUND"}
curl -s localhost:3000/orders/00000000-0000-0000-0000-000000000000/verdict \
  -H "authorization: Bearer $TOKEN" | jq
```

Two 404s, two different codes. That is the whole finding.

**After the fix**, in the browser with the network tab open: file a complaint and watch the
verdict poll. `VERDICT_NOT_FOUND` responses keep arriving on a one-second cadence until the
ruling lands, and then the card appears. The poll must not stop on the first 404, and it must
stop on `AUDIT_FAILED`.

> The regression to watch for is the opposite one: a poll that never stops. Leave the settled
> order open for a minute and confirm the verdict request stops firing once the card is on
> screen.

---

## §2 — Confirm the other findings

| Finding | How to check |
| --- | --- |
| R-03 `listed` | Sign in as a seller with an unregistered agent. It is visibly marked as unbuyable on the seller's list — and still marked in a desaturated screenshot. |
| R-04 buyer `steps` | `curl` a buyer's case file: `steps` is `[]`. `curl` the same order's seller case file: `steps` is populated. The frontend shows the buyer copy explaining the trace is unavailable, **not** an empty list. |
| R-05 withdraw | Response carries `txHash`, `amountMinor`, `explorerUrl`. The wallet page uses its own explorer link and re-reads `GET /me` for figures. |
| R-07 My Orders | Navigate to My Orders. A titled placeholder. **Expected.** |
| R-11 enums | `jq '.components.schemas.OrderState.enum' api/docs/openapi.yaml` against `OrderState` in `src/api/types.ts` — eight members, same order. Repeat for the other three. |

Full inventory: [`contracts/boundary-inventory.md`](./contracts/boundary-inventory.md).

---

## §3 — Check the reconciliation note against its contract

Against [`contracts/reconciliation-note.md`](./contracts/reconciliation-note.md):

1. Every `api-wrong` row from the divergence report appears with a resolution. Today: **one**
   (buyer case-file `steps`), resolved as `escalated`. *(SC-003)*
2. No `api-wrong` row is resolved `fixed-frontend`.
3. All six undeclared contract fields appear, each with a reason beyond "the API sends it."
4. All six orphan endpoints appear.
5. Every row has a reason, including the `no-change` ones.

---

## §4 — Check the test plan against its own rules

Against [`contracts/test-plan-outline.md`](./contracts/test-plan-outline.md).

**Rule 1 — no subjective expected result.** *(SC-002)* This one is greppable:

```bash
grep -niE "looks? (right|correct|good|fine)|seems fine|renders properly|works correctly|is displayed correctly" \
  ui/docs/manual-test-plan.md
```

**Expect zero matches.** Any hit is a step that did not run — it was resolved optimistically at
3am instead.

**Rule 2 — a pass/fail box on every step.** Every step row carries a checkbox; count the step
rows against the checkboxes and expect them equal.

**Rule 3 — sections present.** §0 through §7, all eight.

**Rule 4 — carryovers.** All ten register entries in [data-model.md](./data-model.md) findable
in the plan. Nine map to a step; T033 is marked `answered`. *(SC-012)*

**Rule 5 — symptom notes** on at least: the sign-in 401 (R-01), the empty citation quotation
marks (`quote`/`clause`), the empty buyer trace (R-04), the My Orders placeholder (R-07), and
the 502 that is not a failure.

**Rule 6 — the stranger check on the document itself.** Hand it to someone who has not read the
source and watch them run §1 and one act. Every question they have to ask is a defect in the
plan. This is the only check here that cannot be automated, and it is the one that matters —
the plan's whole claim is that such a person can execute it.

---

## §5 — Definition of done

- [ ] R-01 and R-02 confirmed live, then fixed, then re-confirmed — or withdrawn and recorded
- [ ] `npm run build` passes and `tsc` is clean
- [ ] Sign-in works and survives a reload
- [ ] A verdict card appears after a complaint, with the poll stopping once it does
- [ ] `ui/docs/reconciliation-note.md` exists and passes §3
- [ ] `ui/docs/manual-test-plan.md` exists and passes §4, including zero grep hits
- [ ] R-04 escalated against `api/`, referencing divergence row 5
- [ ] **No test-plan step reported as passing** *(FR-041)*
