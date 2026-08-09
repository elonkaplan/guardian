# Contract: Auth HTTP API

**Feature**: [../spec.md](../spec.md) · **Base**: `/auth` · **Both endpoints are
`@Public()`** — they are how a caller obtains the credential everything else requires.

Source of the shapes: `docs/api-design.md` §3.1, with one documented addition (see
`message` below).

---

## `POST /auth/nonce`

Issues a single-use challenge for an address. Issuing a second challenge for the same
address **invalidates the first** — at most one is ever outstanding.

Requesting a challenge is not a claim to own the address and reveals nothing: a challenge
is issued for any syntactically valid address, whether or not it has an account.

### Request

```jsonc
{
  "address": "0x45fFda76D73321D35f53396f822bA550b6AF5389"
}
```

| Field | Rule |
| --- | --- |
| `address` | Required. `^0x[a-fA-F0-9]{40}$` — the same regex `env.schema.ts` uses for the operator, guardian and funder addresses. Any casing accepted |

### Response `201 Created`

```jsonc
{
  "nonce": "3f7a…64 hex chars…",
  "message": "Guardian: sign in to your account.\n\nThis signature proves you own this wallet.\nIt is not a transaction and costs nothing.\n\nAddress: 0x45fFda76D73321D35f53396f822bA550b6AF5389\nNonce: 3f7a…"
}
```

| Field | Notes |
| --- | --- |
| `nonce` | 32 random bytes, hex. Valid for **5 minutes** or one use |
| `message` | **The exact string to sign.** Sign it verbatim — byte for byte, newlines included |

> **`message` is an addition to the shape in `docs/api-design.md` §3.1**, which lists
> `{ nonce }` alone. Composing the message client-side means two implementations of an
> unversioned format, where a changed word or a trailing newline produces
> "signature does not match" with no hint that formatting is the cause. Returning it
> makes the format server-owned. `nonce` is still present, so the documented shape is a
> subset of this one. Rationale in [R3](../research.md).

The address in `message` is the **checksummed** form, regardless of the casing submitted.

### Errors

| Status | When | Body |
| --- | --- | --- |
| `400` | `address` missing, malformed, or not 40 hex characters | Zod issue list. **No challenge is issued** (FR-002) |

---

## `POST /auth/verify`

Exchanges a signature for a session token. Creates the account if this address has never
signed in before — this is the entire registration flow (FR-007).

### Request

```jsonc
{
  "address": "0x45fFda76D73321D35f53396f822bA550b6AF5389",
  "signature": "0xcf9c1b65…130 hex chars…1c"
}
```

| Field | Rule |
| --- | --- |
| `address` | Required, same regex as above. Any casing |
| `signature` | Required. `^0x[a-fA-F0-9]+$`, non-empty. An EIP-191 `personal_sign` signature over `message` — what every browser wallet produces for `signMessage`, and what `cast wallet sign` produces |

### Response `201 Created`

```jsonc
{
  "token": "eyJhbGciOiJIUzI1NiIs…"
}
```

Present it as `Authorization: Bearer <token>` on every protected request. Valid for
**7 days**; there is no refresh and no revocation (R13).

The response carries the token and nothing else — no account id, no address, no
indication of whether this sign-in created an account or reused one. `GET /me` (API-05)
is where a client reads its own account.

### Server-side sequence

1. Validate the body. Malformed → `400`, nothing else happens.
2. Canonicalise the address with `getAddress()`.
3. **Consume** the challenge for that address — read and delete in one step. Absent or
   expired → `401`. *The challenge is now gone whatever happens next* (R4).
4. Rebuild the message from the consumed nonce and recover the signer with
   `recoverMessageAddress`.
5. Recovered address `!==` the challenge's address → `401`.
6. `findOrCreateByAddress` → the account, created now or found from before.
7. Sign `{ sub: account.id }` and return it.

Step 3 preceding steps 4–5 is the point of the whole design: a failed signature does not
give the caller a second attempt at the same challenge.

### Errors

| Status | When | Body |
| --- | --- | --- |
| `400` | Body fails validation | Zod issue list |
| `401` | **Every** verification failure — no challenge for this address, challenge expired, challenge already spent, signature malformed, or signature recovering to a different address | `{ "statusCode": 401, "message": "Signature verification failed" }` |

**One message for five distinct causes, deliberately.** A response that said "no
challenge for this address" would make `/auth/verify` an oracle for enumerating which
wallets hold accounts — and since accounts *are* wallet addresses, that is a list of who
holds funds on the platform (FR-019). The real cause is logged at `warn` with the
recovered address; it is never sent. See [errors.md](./errors.md).

---

## `GET /auth/session` — protected

The guard's own witness. Returns the account the presented token resolves to.

### Response `200 OK`

```jsonc
{
  "accountId": "8f1c…",
  "address": "0x45fFda76D73321D35f53396f822bA550b6AF5389"
}
```

**Why it exists**: without one protected route, FR-014 and FR-015 cannot be demonstrated
until API-05 ships, and the guard would go unexercised for a whole feature. It is two
lines over `@CurrentAccount()`.

**It is not `/me`.** API-05's `/me` returns available balance and the amount currently in
escrow alongside the account, and lives in the `accounts` module. This one answers a
narrower question the UI also needs on load — *is my stored token still good, and whose
is it?* — without pulling in the money model. The two do not collide.

Errors are the protected-request errors below.

---

## Protected requests

Everything outside `@Public()` routes requires:

```http
Authorization: Bearer eyJhbGciOiJIUzI1NiIs…
```

| Status | When |
| --- | --- |
| `401` `"Authentication required"` | No header, wrong scheme, or an unparseable/tampered token |
| `401` `"Session expired"` | Well-formed and correctly signed, but past `exp` |
| `401` `"Authentication required"` | Valid token whose `sub` names no existing account (FR-017) |

Distinguishing *expired* from *malformed* is safe and intended (US2 scenario 4): both
describe a token the caller already holds. The unknown-account case is folded into the
generic message rather than given its own, because "this account was deleted" is a fact
about the platform, not about the caller's token.

---

## Full flow

```text
POST /auth/nonce   { address }
        │
        └──▶ { nonce, message }
                    │
             sign `message` in the wallet  (no gas, no transaction)
                    │
POST /auth/verify  { address, signature }
        │
        ├── first time for this address ──▶ account created
        └──▶ { token }
                    │
             Authorization: Bearer <token>  on everything else
```
