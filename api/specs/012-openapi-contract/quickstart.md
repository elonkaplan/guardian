# Quickstart — build and verify the contract

Everything here is run by hand from `api/`. There are no automated tests in this component.

## Prerequisites

```bash
docker compose up -d           # postgres + migrate + api on :3000
curl -s localhost:3000/health  # expect status "ok"
curl -sX POST localhost:3000/demo/seed | head -c 200
```

The seed is needed from stage 2 onward: the verdict route cannot be captured without an
order that has been through an audit, and Act 3 (the crash fixture) is the fastest path to
one.

New dependencies, added once:

```bash
npm install @nestjs/swagger js-yaml
npm install -D @types/js-yaml
```

## Stage 1 — Confirm the route inventory against the router

The list in [contracts/route-inventory.md](./contracts/route-inventory.md) says 27. Confirm
it against what the app actually registers rather than trusting the file:

```bash
# Nest logs every mapped route at boot
docker compose logs api | grep -E "Mapped \{" | sed -E 's/.*Mapped \{([^,]+), ([A-Z]+)\}.*/\2 \1/' | sort -u
docker compose logs api | grep -c "Mapped {"
```

**Expected**: 27 lines, each matching a row of the inventory. Any line not in the inventory
is a route the contract would otherwise miss; any inventory row not in the log is a route
that no longer exists. Both are corrections to make before writing a word of YAML.

## Stage 2 — Capture real responses

```bash
node scripts/verify-012.mjs
```

The script (reusing `scripts/verify-011-lib.mjs`) must:

1. Sign in as **two** accounts — a buyer and the demo seller — via `signIn()`.
2. Top up the buyer, purchase the Act 3 fixture, let it fail, complain, wait for the verdict.
3. Call all 27 routes and write each response body to
   `$SCRATCH/captures/<method>_<path>.json`, alongside its status code.
4. Call routes 18, 19 and 24 **as both** buyer and seller, saving both bodies — the case
   file returns structurally different objects per viewer.
5. Provoke every failure in [contracts/error-shapes.md](./contracts/error-shapes.md)
   § *Failures the capture must provoke* and save those bodies too.
6. Print which of the 27 routes produced no capture.

**Expected**: 27 success captures, both case-file variants, ~14 failure captures, zero
missing.

**Checks worth asserting inside the script**, because they are acceptance scenarios:

- `GET /me` includes `settledFundsMinor` as a key, even when its value is `null` (SC-005).
- `GET /orders/<another buyer's order>` returns **404**, not 403 and not 500 (SC-010).
- The seller can read routes 18, 19 and 24 for an order on their own agent (US3 #3).
- The seller is refused on routes 21 and 22.
- No response from any route except 13 and the seller's case file contains `systemPrompt`.

## Stage 3 — Write `docs/openapi.yaml`

Write it from the captures in `$SCRATCH/captures/`, using
[data-model.md](./data-model.md) for the component inventory and its conventions. Then:

```bash
npx @redocly/cli lint docs/openapi.yaml    # or: npx @apidevtools/swagger-cli validate
```

**Expected**: parses as valid OpenAPI 3.1, zero errors (SC-001).

Field-by-field check against the captures:

```bash
# every top-level key of a captured body should appear in the contract
jq -r 'keys[]' "$SCRATCH/captures/GET_me.json" | while read k; do
  grep -q "$k" docs/openapi.yaml || echo "MISSING from contract: $k"
done
```

Repeat per capture. **Expected**: no output (SC-003). Run it in both directions — a field in
the contract that no capture produced is equally wrong.

## Stage 4 — Serve it, and check it inside the container

```bash
docker compose up -d --build api

curl -s -o /dev/null -w '%{http_code}\n' localhost:3000/docs        # 200, no token
curl -s -o /dev/null -w '%{http_code}\n' localhost:3000/docs-yaml   # 200, no token
docker compose exec api ls -l /app/docs/openapi.yaml                # the file is in the image
```

**Expected**: `200` for both with **no `Authorization` header** (SC-006), and the file
present at `/app/docs/openapi.yaml`.

**The container check is the one that matters.** `.dockerignore` excludes `docs/` and
`*.md`, and compose bind-mounts only `./src` — without the `!docs/openapi.yaml` negation and
the added mount, `/docs` works on the host and 404s in the container, which is where the
demo runs. Verifying only on the host would miss it entirely.

Then open `http://localhost:3000/docs` in a browser and click through a few operations.
**Expected**: every one of the 27 routes is listed and expandable.

Finally, edit one description in `docs/openapi.yaml`, reload the page, and confirm the change
appears without a rebuild (FR-015 — the bind mount, plus a container restart if the document
is parsed at boot).

## Stage 5 — Diff and resolve

Compare the finished contract against the three design sections named in
[research.md](./research.md) decision 6, starting from the six candidates in
[plan.md](./plan.md) § *Known divergence candidates*. Write
`docs/openapi-divergences.md` from
[contracts/divergence-report.template.md](./contracts/divergence-report.template.md).

```bash
test -f docs/openapi-divergences.md && echo "report exists"   # SC-007
```

**Expected**: the file exists, every row carries a verdict, and every row carries a
resolution — a fix applied, a design edit named, a reason recorded, or a `DO NOT ADOPT`
marker present in **both** the report and the contract (SC-008).

For each `api-wrong` row that was fixed, re-run the relevant part of stage 2 and confirm the
capture now matches the contract.

## Done when

| Criterion | Check |
| --- | --- |
| SC-001 | the linter reports zero errors |
| SC-002 | boot log route count == contract path/method count == 27 |
| SC-003 | field-name diff between captures and contract is empty both ways |
| SC-004 | all four enumerations present, full member lists |
| SC-005 | every `*Minor` field documented with a unit; `settledFundsMinor` nullable and required |
| SC-006 | `/docs` returns 200 anonymously **from the container** |
| SC-007 | `docs/openapi-divergences.md` exists |
| SC-008 | zero rows without a verdict and a resolution |
| SC-011 | `git diff --stat` touches no DTO or serialiser except those a divergence row required |
