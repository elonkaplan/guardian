# Template — `docs/openapi-divergences.md`

Copy this structure. Fill the table with **every** difference found; if there are none, keep
the header and the closing statement and write "No differences found." in place of the table.

---

```markdown
# API contract — divergence report

**Generated:** <date> · **Contract:** [`openapi.yaml`](./openapi.yaml) · **Compared against:**
`../../docs/api-design.md` §3 · `../../docs/database-schema.md` §8 · `../../docs/tech-stack.md` §5

The contract describes **what the API does**. This file records where that differs from what
it was designed to do, and what was decided about each difference.

**How to read this if you are building against the contract:** every row below is a place
where the document and the design disagreed. Rows marked `api-wrong` **and not yet fixed**
carry `DO NOT ADOPT` — build against the design for those, not the contract. Everything not
listed here matched, and can be adopted as written.

| # | Endpoint / field | Design says | Code does | Verdict | Resolution |
| --- | --- | --- | --- | --- | --- |
| 1 | `POST /auth/nonce` response | `{ nonce }` (api-design §3.1) | `{ nonce, message }` | `design-stale` | api-design.md §3.1 updated — the client signs `message` |
| … | | | | | |

## Verdicts

- **`api-wrong`** — the implementation deviated with no reason behind it. Fixed in this
  branch, and the contract describes the fix. Where a fix was out of time, the row and the
  contract both carry `DO NOT ADOPT`.
- **`design-stale`** — the design was superseded during implementation. The design document
  has been updated; the resolution column names the edit.
- **`intentional`** — a deliberate departure. The resolution column records why.

## Fixed in this branch

<!-- One line per api-wrong row that was corrected, with what changed. Delete the section if
     there were none. -->

## Known wrong, not fixed

<!-- One line per api-wrong row left unfixed, with what a consumer should do instead.
     Delete the section if there were none — an empty section reads as an oversight. -->

## Documented from source, not captured

<!-- Responses written from reading the code because provoking them live was not worth the
     cost — the 502 chain failures. A reader is entitled to know which lines carry less
     evidence than the rest. -->

## Coverage

The comparison covered all 27 registered routes, the four enumerations, the money fields of
`GET /me`, the three buyer-or-seller reads, and the error bodies. It was performed against
the finished contract, after capture, not against the source.
```

---

## Notes for whoever fills this in

- **The empty case is a real result and still gets written** (FR-019). A missing file and a
  clean diff must not look the same to the next reader.
- **Every row is resolved before this feature is done** (FR-018, FR-020…FR-023, SC-008).
  A verdict with no resolution is an unfinished row.
- **`design-stale` means editing the design document**, not just noting it here. Otherwise
  the next reader rediscovers the same row.
- Start from the six candidates in [plan.md](../plan.md) § *Known divergence candidates*,
  then run the full diff — those were found while reading, not by comparing.
