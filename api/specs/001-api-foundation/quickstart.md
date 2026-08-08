# Quickstart & Validation: API Foundation

There is no test suite for this component — [`docs/CONTEXT.md`](../../docs/CONTEXT.md)
puts automated tests out of scope. **This file is the test suite.** Every scenario
below is a hand-run check; the whole script takes about ten minutes.

## Prerequisites

- Docker with Compose v2 (`docker compose version` ≥ 2.0)
- Node 22+ on the host (only needed for the host-run checks — 24 or 26 both fine)
- `guardian/.env` exists with **every** key populated — placeholders count. The chain,
  wallet, and Anthropic values are currently format-valid fakes; boot requires them to
  be present and well-formed, not real.
- Nothing already bound to port `3000`. If a **native Postgres already holds 5432**,
  prefix every `docker compose` command below with `POSTGRES_HOST_PORT=5433` — the
  published port is host convenience only, and the API reaches Postgres over the
  Compose network either way

All commands run from `guardian/api/`.

---

## Scenario A — Cold start (User Story 1, P1)

Proves FR-015, FR-016, FR-001, FR-002; measures SC-001, SC-002.

```bash
docker compose down -v          # true cold start: destroys the volume
time docker compose up --build  # one command, no manual steps after this
```

In a second terminal, once the logs settle:

```bash
curl -i http://localhost:3000/health
```

**Expected**

- HTTP `200`
- Body matches [`contracts/health.openapi.yaml`](./contracts/health.openapi.yaml):
  `{"status":"ok","info":{"database":{"status":"up"}},"error":{},"details":{"database":{"status":"up"}}}`
- Elapsed time from `up` to a healthy response **under 90 s**, excluding image pulls
- **Zero** manual steps between the two commands

Then confirm the health check is genuinely re-runnable and side-effect free (FR-003):

```bash
for i in 1 2 3 4 5; do curl -s -o /dev/null -w "%{http_code} " http://localhost:3000/health; done
```

**Expected**: `200 200 200 200 200`.

### A2 — Warm restart (SC-003)

```bash
docker compose down             # note: no -v, the volume survives
time docker compose up
curl -s http://localhost:3000/health
```

**Expected**: healthy within **30 s**; `migrate` exits `0` again without reapplying
anything (FR-014).

### A3 — Repeatability (SC-007)

Run Scenario A three times consecutively, `docker compose down -v` between each.

**Expected**: three identical successes, no manual cleanup between runs.

---

## Scenario B — Misconfiguration fails loudly (User Story 2, P2)

Proves FR-006, FR-007, FR-009; measures SC-004, SC-005, SC-008.

**B1 — Missing required key**

```bash
cp ../.env ../.env.bak
sed -i '' 's|^DATABASE_URL=.*|DATABASE_URL=|' ../.env
docker compose up api
```

**Expected**: the container exits **non-zero**; stderr names `DATABASE_URL` and the
expected form. No stack trace burying the message, no partial startup.

**B2 — Malformed value**

```bash
cp ../.env.bak ../.env
echo 'PORT=not-a-number' >> ../.env
docker compose up api
```

**Expected**: exits non-zero, names `PORT`, states that an integer was expected.

**B3 — Multiple failures reported together**

```bash
cp ../.env.bak ../.env
sed -i '' 's|^DATABASE_URL=.*|DATABASE_URL=|' ../.env
echo 'PORT=abc' >> ../.env
docker compose up api
```

**Expected**: **both** `DATABASE_URL` and `PORT` appear in one message. One restart
must surface every problem — this is the criterion that separates a real fail-fast
layer from a first-error throw.

**B3b — Every platform key is enforced, not just the core three (FR-010, SC-004)**

Walk the whole set. For each key in
[`contracts/config-schema.md`](./contracts/config-schema.md), blank it, start, confirm
it is named, restore it:

```bash
cp ../.env ../.env.bak
for k in MONAD_RPC_URL MONAD_CHAIN_ID USDC_ADDRESS ESCROW_CONTRACT_ADDRESS \
         OPERATOR_ADDRESS OPERATOR_PRIVATE_KEY GUARDIAN_ADDRESS GUARDIAN_PRIVATE_KEY \
         FUNDER_ADDRESS FUNDER_PRIVATE_KEY ANTHROPIC_API_KEY \
         RAIN_ENABLED RAIN_BASE_URL REVIEW_WINDOW_SECONDS SWEEPER_INTERVAL_MS; do
  sed -i '' "s|^$k=.*|$k=|" ../.env
  docker compose run --rm api 2>&1 | grep -q "$k" && echo "✅ $k" || echo "❌ $k NOT ENFORCED"
  cp ../.env.bak ../.env
done
```

**Expected**: ✅ for every key. Also check the shape rules reject bad input —
`OPERATOR_ADDRESS=0x123` (too short), `MONAD_CHAIN_ID=abc`, and
`REVIEW_WINDOW_SECONDS=0` must each be refused. The last one matters: a zero review
window collapses the dispute window entirely (`docs/smart-contract.md` §11.3).

**B3c — `DEPLOYER_PRIVATE_KEY` is absent from config (role separation)**

```bash
grep -rn "DEPLOYER" src/ && echo "❌ the API can see the deployer key" || echo "✅ absent"
```

**Expected**: `✅ absent`. It stays in `.env` for `sc/` only.

**B4 — No secret leakage (SC-008)**

```bash
cp ../.env.bak ../.env && rm ../.env.bak
docker compose up -d
docker compose logs | grep -iE 'password|postgres:postgres|PRIVATE_KEY|sk-ant' && echo "LEAK" || echo "clean"
```

**Expected**: `clean`. Repeat this grep against the B1–B3 failure output too — a
validation error is exactly where naive code echoes the received value.

**B5 — Typed access (FR-008)**

Grep the source for defensive reads of config:

```bash
grep -rnE "process\.env" src/ --include=*.ts
```

**Expected**: hits only in `src/config/env.schema.ts` and `src/data-source.ts`.
Anywhere else means a consumer bypassed the validated config. Also confirm `AppConfig`
has no `?:` members and no `| undefined`.

**B6 — Placeholder warning fires (R9)**

```bash
docker compose up -d && docker compose logs api | grep -i placeholder
```

**Expected**: one `WARN` line naming the keys still holding fakes — currently
`ESCROW_CONTRACT_ADDRESS`, the operator/guardian/funder address and key pairs, and
`ANTHROPIC_API_KEY`. **Key names only; no hex, no `sk-ant-` string in the output.**
Boot proceeds normally — the warning must not block.

Then confirm it goes quiet when a value is real:

```bash
# temporarily set one to a real-looking non-placeholder address
sed -i '' 's|^ESCROW_CONTRACT_ADDRESS=.*|ESCROW_CONTRACT_ADDRESS=0x534b2f3A21130d7a60830c2Df862319e593943A3|' ../.env
docker compose up -d --force-recreate api && docker compose logs api | grep -i placeholder
```

**Expected**: `ESCROW_CONTRACT_ADDRESS` no longer listed; the other keys still are.
Restore the placeholder afterwards.

---

## Scenario C — Migrations are explicit (User Story 3, P3)

Proves FR-011, FR-012, FR-013, FR-017; measures SC-006.

**C1 — Ordering**

```bash
docker compose down -v && docker compose up
docker compose ps -a
```

**Expected**: `migrate` shows `exited (0)`; `api` started **after** it. In the logs,
every migration line precedes the Nest bootstrap banner.

**C2 — A failed migration stops the API**

Temporarily break a migration (or point `migrate` at an unreachable database):

```bash
docker compose run --rm -e DATABASE_URL=postgresql://postgres:postgres@nowhere:5432/guardian migrate
```

**Expected**: non-zero exit. Then confirm that with a genuinely failing `migrate`
service, `docker compose up` never starts `api` — the failure is attributable to the
migration step, not to a confusing API error.

**C3 — The API never touches schema (FR-012, SC-006)**

```bash
docker compose exec postgres psql -U postgres -d guardian -c "\dt" > /tmp/before.txt
curl -s http://localhost:3000/health > /dev/null
docker compose restart api && sleep 10
docker compose exec postgres psql -U postgres -d guardian -c "\dt" > /tmp/after.txt
diff /tmp/before.txt /tmp/after.txt && echo "schema untouched"
```

**Expected**: `schema untouched`. Also verify by inspection that
`src/data-source.ts` sets `synchronize: false` and `migrationsRun: false` — this is
the non-negotiable invariant; if it drifts, the migrations become decoration.

**C4 — The three commands exist and work**

```bash
npm run migration:run       # idempotent — exits 0 with nothing pending
npm run migration:revert    # undoes the most recent, or reports none to revert
```

---

## Scenario D — Edge cases

**D1 — Database dies under a running API (FR-002)**

```bash
docker compose stop postgres
curl -i http://localhost:3000/health
docker compose start postgres && sleep 5
curl -i http://localhost:3000/health
```

**Expected**: `503` with `status: error` and `details.database.status: down` while
stopped; back to `200` once Postgres returns. A `200` while Postgres is stopped is a
hard failure — it makes the Compose dependency graph lie.

**D2 — Host run (FR-018)**

With a local Postgres listening on `localhost:5432`:

```bash
docker compose down
npm install && npm run migration:run && npm run start:dev
curl -s http://localhost:3000/health
```

**Expected**: healthy, with **no code change** — only `DATABASE_URL` differs between
the two modes (`localhost` from `.env` vs `postgres` from the Compose override).

**D3 — Port already in use**

```bash
# with the stack already running
npm run start:dev
```

**Expected**: a clear `EADDRINUSE` on port 3000 and a non-zero exit — not a hang.

**D4 — Strict typing is a build gate (FR-020)**

Introduce a deliberate type error, then:

```bash
npm run build
```

**Expected**: non-zero exit naming the error. Revert it.

---

## Sign-off checklist

| # | Check | Criterion |
| --- | --- | --- |
| 1 | Cold start, one command, healthy | SC-001, SC-002 |
| 2 | Warm restart < 30 s | SC-003 |
| 3 | Every required key, removed in turn, blocks boot and is named | SC-004 |
| 4 | Wrong key identified in under 30 s from startup output alone | SC-005 |
| 5 | Schema identical before and after a service run | SC-006 |
| 6 | Three consecutive cold cycles, no manual cleanup | SC-007 |
| 7 | No secret in any output | SC-008 |
| 8 | Every platform key enforced; `DEPLOYER_PRIVATE_KEY` absent from config | FR-010 |
| 9 | Placeholder WARN lists the fakes by name, blocks nothing | R9 |

Treat a failed run here the way you'd treat a red build.

---

## Before the demo

```bash
grep -n 'TODO(placeholder)' ../.env
```

Must return nothing. Every line it prints is a value that will fail on-chain or at the
LLM call with an error that looks like something else entirely.
