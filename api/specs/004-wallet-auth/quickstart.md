# Quickstart: verifying Wallet Auth by hand

**Feature**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md)

Automated tests are out of scope for `api/` ([`docs/CONTEXT.md`](../../docs/CONTEXT.md)),
so **this file is the test suite.** Every acceptance scenario in the spec maps to a step
below, and the whole pass runs in one terminal against a throwaway wallet — no browser,
no UI, no funded account, and no chain access at all.

Run it end to end before calling API-04 done, and again after any change to `src/auth/`.

---

## Prerequisites

```bash
export PATH="$HOME/.foundry/bin:$PATH"   # cast — already installed, see sc/README.md
command -v cast jq curl                  # all three must resolve
```

1. **`JWT_SECRET` is set** in the repository-root `.env`. It is a new required key; the
   API will refuse to boot without it and the config report will name it. Any 32+
   character string works locally:
   ```bash
   openssl rand -hex 32
   ```
2. **Postgres is up** and the API-02 migration has run — `accounts` and
   `accounts_wallet_lower_idx` must exist. `docker compose up -d db && npm run migration:run`.
3. **The API is running**: `npm run start:dev`.

```bash
API=http://localhost:3000
psql_() { docker compose exec -T postgres psql -U postgres -d guardian -tA "$@"; }
```

> **A function, not `PSQL="docker compose …"`.** zsh does not word-split an
> unquoted variable the way bash does, so `psql_ -c "…"` looks for a command
> literally named `docker compose exec …` and reports *"command not found"*. The
> steps below call `psql_ -c "…"`.

> **If port 5432 is already taken** by a native Postgres, Compose refuses to
> start. Bring the stack up on another host port —
> `POSTGRES_HOST_PORT=5433 docker compose up -d --build api` — and keep using the
> `psql_` helper above, which goes through the container and ignores the
> published port entirely.

> **Use `printf '%s'`, never `echo`, on anything holding JSON.** zsh's `echo`
> expands `\n`, so `echo "$RESPONSE" | jq` turns a correctly escaped message into
> raw newlines and jq fails with *"Invalid string: control characters … must be
> escaped"*. The API is not at fault when that happens; the shell is. Every
> command below is written to avoid it.

---

## Step 1 — A wallet the platform has never seen

```bash
NEW=$(cast wallet new)
PK=$(echo "$NEW"  | awk '/Private key/ {print $3}')
ADDR=$(echo "$NEW" | awk '/Address/ {print $2}')
echo "$ADDR"
```

Keep `$PK` and `$ADDR` for the rest of the pass. No funding required — signing a message
costs nothing and touches no chain.

---

## Step 2 — Sign in for the first time

```bash
NONCE_RES=$(curl -sS -X POST $API/auth/nonce \
  -H 'content-type: application/json' \
  -d "{\"address\":\"$ADDR\"}")

MSG=$(printf '%s' "$NONCE_RES" | jq -r .message)
printf '%s\n' "$MSG"
```

**Expect** a two-field response, and a message that reads as English and names your
address in checksummed form:

```text
Guardian: sign in to your account.

This signature proves you own this wallet.
It is not a transaction and costs nothing.

Address: 0x45fFda76D73321D35f53396f822bA550b6AF5389
Nonce: 3f7a…
```

Sign it verbatim and exchange it:

```bash
SIG=$(cast wallet sign --private-key $PK "$MSG")

TOKEN=$(curl -sS -X POST $API/auth/verify \
  -H 'content-type: application/json' \
  -d "{\"address\":\"$ADDR\",\"signature\":\"$SIG\"}" | jq -r .token)

echo "$TOKEN"
```

**Expect** a three-part JWT. *(US1 scenarios 1–4)*

> `cast wallet sign` and viem's `recoverMessageAddress` were confirmed to interoperate on
> a multi-line message before this plan was written — [R15](./research.md). If this step
> fails, the fault is in the code, not in the tooling.

---

## Step 3 — The account exists, exactly once, correctly cased

```bash
psql_ -c "SELECT id, wallet_address FROM accounts;"
psql_ -c "SELECT count(*) FROM accounts;"
```

**Expect** one row whose `wallet_address` matches `$ADDR` **character for character**,
mixed case included. This is the payout destination for every refund and sale this
account will ever receive — a casing difference here is money sent nowhere.
*(US1 scenario 3, US3 scenario 3, SC-005)*

---

## Step 4 — The token identifies the account

```bash
curl -sS $API/auth/session -H "Authorization: Bearer $TOKEN"
```

**Expect** `{ "accountId": "…", "address": "0x45fF…" }`, matching the row from Step 3.

`GET /auth/session` is a deliberately thin endpoint whose only job is to be the guard's
witness: it proves `JwtAuthGuard` and `@CurrentAccount()` work before API-05 exists. It
is not `/me` — that arrives in API-05 with balance and escrow. *(US2 scenario 1)*

---

## Step 5 — Signing in again returns the same account

```bash
MSG2=$(curl -sS -X POST $API/auth/nonce -H 'content-type: application/json' \
  -d "{\"address\":\"$ADDR\"}" | jq -r .message)
SIG2=$(cast wallet sign --private-key $PK "$MSG2")
TOKEN2=$(curl -sS -X POST $API/auth/verify -H 'content-type: application/json' \
  -d "{\"address\":\"$ADDR\",\"signature\":\"$SIG2\"}" | jq -r .token)

psql_ -c "SELECT count(*) FROM accounts;"
curl -sS $API/auth/session -H "Authorization: Bearer $TOKEN2"
```

**Expect** the count still `1`, and the same `accountId` as Step 4. Also confirm the
**first** token still works — issuing a second session does not invalidate the first.
*(US3 scenarios 1 and 6, SC-002)*

---

## Step 6 — Casing does not create a second account

```bash
LOWER=$(echo "$ADDR" | tr 'A-Z' 'a-z')
MSG3=$(curl -sS -X POST $API/auth/nonce -H 'content-type: application/json' \
  -d "{\"address\":\"$LOWER\"}" | jq -r .message)

echo "$MSG3" | grep "$ADDR"      # the message must echo the CHECKSUMMED address
SIG3=$(cast wallet sign --private-key $PK "$MSG3")
TOKEN3=$(curl -sS -X POST $API/auth/verify -H 'content-type: application/json' \
  -d "{\"address\":\"$LOWER\",\"signature\":\"$SIG3\"}" | jq -r .token)

psql_ -c "SELECT count(*) FROM accounts;"
curl -sS $API/auth/session -H "Authorization: Bearer $TOKEN3"
```

**Expect** the `grep` to match, the count still `1`, and the same `accountId`.
*(US3 scenarios 2 and 4, FR-010)*

If the count is `2`, the lookup is comparing raw `wallet_address` instead of
`lower(wallet_address)` — see [R6](./research.md).

---

## Step 7 — A replayed signature is refused

Reuse the pair from Step 6 verbatim:

```bash
curl -sS -o /dev/null -w '%{http_code}\n' -X POST $API/auth/verify \
  -H 'content-type: application/json' \
  -d "{\"address\":\"$LOWER\",\"signature\":\"$SIG3\"}"
```

**Expect** `401`, body exactly `{"statusCode":401,"message":"Signature verification failed"}`.
The challenge was consumed by the first successful verify and is gone.
*(US4 scenario 1, SC-003)*

---

## Step 8 — A failed attempt burns the challenge

This is the property that makes each challenge worth one guess rather than five minutes
of them ([R4](./research.md)).

```bash
MSG4=$(curl -sS -X POST $API/auth/nonce -H 'content-type: application/json' \
  -d "{\"address\":\"$ADDR\"}" | jq -r .message)

# a deliberately wrong signature: the right key over the wrong message
BAD=$(cast wallet sign --private-key $PK "not the message")
curl -sS -X POST $API/auth/verify -H 'content-type: application/json' \
  -d "{\"address\":\"$ADDR\",\"signature\":\"$BAD\"}"

# now the CORRECT signature for that same challenge
GOOD=$(cast wallet sign --private-key $PK "$MSG4")
curl -sS -X POST $API/auth/verify -H 'content-type: application/json' \
  -d "{\"address\":\"$ADDR\",\"signature\":\"$GOOD\"}"
```

**Expect both to be `401`.** The second failing is the point: one wrong guess ends the
challenge. *(US4 scenario 7)*

---

## Step 9 — A signature from another wallet is refused

```bash
OTHER=$(cast wallet new)
OPK=$(echo "$OTHER" | awk '/Private key/ {print $3}')

MSG5=$(curl -sS -X POST $API/auth/nonce -H 'content-type: application/json' \
  -d "{\"address\":\"$ADDR\"}" | jq -r .message)
OSIG=$(cast wallet sign --private-key $OPK "$MSG5")   # wrong wallet, right message

curl -sS -X POST $API/auth/verify -H 'content-type: application/json' \
  -d "{\"address\":\"$ADDR\",\"signature\":\"$OSIG\"}"
```

**Expect** `401` with the same generic message. In the **server log**, expect one `warn`
naming both the expected and the recovered address — that pair is what makes this
diagnosable during the demo. *(US4 scenario 3, SC-004)*

---

## Step 10 — A signature with no outstanding challenge

```bash
FRESH=$(cast wallet new)
FADDR=$(echo "$FRESH" | awk '/Address/ {print $2}')
FPK=$(echo "$FRESH"   | awk '/Private key/ {print $3}')
ANY=$(cast wallet sign --private-key $FPK "anything at all")

curl -sS -X POST $API/auth/verify -H 'content-type: application/json' \
  -d "{\"address\":\"$FADDR\",\"signature\":\"$ANY\"}"

psql_ -c "SELECT count(*) FROM accounts;"
```

**Expect** `401`, and the account count **unchanged** — no challenge is invented, and no
account is created for an unverified address. *(US4 scenario 4)*

Compare this response byte for byte with Step 7's. `$FADDR` has no account and `$ADDR`
does; the two responses must be identical, or `/auth/verify` is an oracle for enumerating
registered wallets (FR-019).

---

## Step 11 — Malformed input never reaches the store

```bash
curl -sS -X POST $API/auth/nonce -H 'content-type: application/json' -d '{"address":"not-an-address"}'
curl -sS -X POST $API/auth/nonce -H 'content-type: application/json' -d '{}'
curl -sS -X POST $API/auth/nonce -H 'content-type: application/json' -d '{"address":"0x1234"}'
```

**Expect** `400` on all three, each naming the `address` field. *(US1 scenario 5, FR-002)*

---

## Step 12 — Credential handling on protected routes

```bash
S=$API/auth/session

curl -sS -o /dev/null -w 'none:      %{http_code}\n' $S
curl -sS -o /dev/null -w 'garbage:   %{http_code}\n' $S -H "Authorization: Bearer not.a.token"
curl -sS -o /dev/null -w 'no scheme: %{http_code}\n' $S -H "Authorization: $TOKEN"
curl -sS -o /dev/null -w 'tampered:  %{http_code}\n' $S -H "Authorization: Bearer ${TOKEN%?}X"
```

**Expect** `401` on all four. The tampered case matters most: flipping the last character
breaks the HS256 signature, and the token must be refused rather than trusted.
*(US2 scenarios 2 and 3, FR-012)*

---

## Step 13 — Expiry, both kinds

Both TTLs are code constants in `src/auth/auth.constants.ts`. Verifying them means
shortening them temporarily — do this once, then restore.

```ts
// src/auth/auth.constants.ts — TEMPORARY
export const NONCE_TTL_MS = 3_000;
export const JWT_TTL = '3s';
```

With `start:dev` reloaded:

```bash
# challenge expiry
MSG6=$(curl -sS -X POST $API/auth/nonce -H 'content-type: application/json' \
  -d "{\"address\":\"$ADDR\"}" | jq -r .message)
SIG6=$(cast wallet sign --private-key $PK "$MSG6")
sleep 4
curl -sS -X POST $API/auth/verify -H 'content-type: application/json' \
  -d "{\"address\":\"$ADDR\",\"signature\":\"$SIG6\"}"

# token expiry — sign in fresh, then wait
MSG7=$(curl -sS -X POST $API/auth/nonce -H 'content-type: application/json' \
  -d "{\"address\":\"$ADDR\"}" | jq -r .message)
SHORT=$(curl -sS -X POST $API/auth/verify -H 'content-type: application/json' \
  -d "{\"address\":\"$ADDR\",\"signature\":\"$(cast wallet sign --private-key $PK "$MSG7")\"}" | jq -r .token)
sleep 4
curl -sS $API/auth/session -H "Authorization: Bearer $SHORT"
```

**Expect** the first `401` *Signature verification failed* and the second `401`
**"Session expired"** — distinguishable from the malformed-token message in Step 12, which
is what lets a UI re-prompt silently instead of showing an error.
*(US2 scenario 4, US4 scenario 2, FR-003, FR-013)*

**Restore `NONCE_TTL_MS = 5 * 60_000` and `JWT_TTL = '7d'` before continuing.**

---

## Step 14 — A token whose account is gone

```bash
psql_ -c "DELETE FROM accounts WHERE lower(wallet_address) = lower('$ADDR');"
curl -sS $API/auth/session -H "Authorization: Bearer $TOKEN"
```

**Expect** `401`. The token is still cryptographically valid and unexpired; it is refused
because the guard resolved `sub` against the database and found nothing.
*(US2 scenario 5, FR-017)*

Sign in again afterwards to restore the account for later steps.

---

## Step 15 — Public routes, and the fail-closed default

```bash
curl -sS -o /dev/null -w 'health: %{http_code}\n' $API/health
curl -sS -o /dev/null -w 'nonce:  %{http_code}\n' -X POST $API/auth/nonce \
  -H 'content-type: application/json' -d "{\"address\":\"$ADDR\"}"
```

**Expect** `200` and `201` with no credential. If `/health` returns `401`, the global
guard has swept up the health check and Compose's dependency graph will fail for a reason
that looks like a database problem — the exact outcome
`src/health/health.controller.ts` warns about.

Then confirm the default runs the other way. Temporarily comment out `@Public()` on
`/auth/nonce`:

```bash
curl -sS -o /dev/null -w 'unmarked: %{http_code}\n' -X POST $API/auth/nonce \
  -H 'content-type: application/json' -d "{\"address\":\"$ADDR\"}"
```

**Expect `401`.** An endpoint nobody marked is protected. That is the whole argument of
[R8](./research.md), and this is the one step that demonstrates it. Restore `@Public()`.
*(US2 scenario 6, FR-016)*

---

## Coverage

| Spec item | Steps |
| --- | --- |
| US1 — connecting a wallet is the entire registration | 2, 3, 11 |
| US2 — every later request knows who is calling | 4, 12, 13, 14, 15 |
| US3 — one wallet is always the same account | 3, 5, 6 |
| US4 — a captured signature is useless | 7, 8, 9, 10, 13 |
| SC-002 · SC-003 · SC-004 · SC-005 | 5 · 7 · 9 · 3 |
| SC-006 — protected endpoints refuse, handlers get the right account | 4, 12, 15 |

**Not covered here**: SC-001 and SC-007 are properties of the demo rehearsal, not of a
shell script — a first-time user reaching a session in one sign-and-submit step, and Acts
1 and 2 running without a retried sign-in. Verify both during the first full rehearsal
after the UI lands.

---

## Cleanup

```bash
psql_ -c "DELETE FROM accounts WHERE lower(wallet_address) = lower('$ADDR');"
```

Throwaway keys are unfunded and worthless; nothing else persists. Restarting the API
clears every outstanding challenge by design ([R1](./research.md)).
