# Contract: Failure taxonomy

**Feature**: [../spec.md](../spec.md) · **Location**: `src/auth/errors.ts`

Two audiences, and the whole design is about keeping them apart. **The log gets the
truth. The caller gets as little as is useful.**

The class hierarchy mirrors `src/chain/errors.ts`: one abstract root so a caller can
write a single `instanceof` for "something in auth went wrong", with concrete subclasses
carrying the detail that the *log* needs.

---

## The rule that shapes everything

FR-019: **a response must never reveal whether an address has an account.**

Accounts here *are* wallet addresses. An endpoint that answered differently for a
registered address than an unregistered one would let anyone enumerate which wallets hold
accounts on the platform — a list of who has money here, assembled by a script. That is a
financial privacy leak, not a cosmetic one, and it is why five distinct verification
failures collapse into one indistinguishable response.

---

## Sign-in failures — all identical from outside

| Class | Real cause | Logged at | Response |
| --- | --- | --- | --- |
| `NonceNotFoundError` | No challenge outstanding for this address — never requested, or already spent | `warn` | `401` *Signature verification failed* |
| `NonceExpiredError` | Challenge found but past its 5-minute life | `warn` | `401` *Signature verification failed* |
| `SignatureMalformedError` | `recoverMessageAddress` threw — the signature is not a decodable secp256k1 signature | `warn` | `401` *Signature verification failed* |
| `SignerMismatchError` | Recovered a valid address, but not the one claimed. Carries `expected` and `recovered` | `warn` | `401` *Signature verification failed* |

```jsonc
// every one of the four
{ "statusCode": 401, "message": "Signature verification failed" }
```

Same status, same string, same shape. A caller cannot tell "you never asked for a
challenge" from "you signed with the wrong wallet", and neither can an enumeration
script.

**`SignerMismatchError` logs both addresses.** During the demo the most likely cause of
this error is a wallet connected to a different account than the one typed into the form,
and having both values in the log turns a five-minute confusion into a five-second one.
Both are public information — they are addresses — so logging them leaks nothing that the
chain does not already publish.

**`401`, never `400`, for a malformed signature.** The caller failed to authenticate.
Using `400` for the malformed case would put the distinction back into the status line
that the message body is careful not to make.

**Not distinguished, on purpose**: "already spent" versus "never requested". Both are
`NonceNotFoundError`, because after `consume()` there is genuinely nothing left to tell
them apart — the entry is gone. The information does not exist to leak (R4).

---

## Guard failures — these *are* distinguished

| Class | Cause | Response |
| --- | --- | --- |
| `MissingCredentialError` | No `Authorization` header, or not a `Bearer` scheme | `401` *Authentication required* |
| `InvalidTokenError` | Signature check failed, or the payload is not a well-formed `{ sub }` | `401` *Authentication required* |
| `SessionExpiredError` | Correctly signed, past `exp` | `401` *Session expired* |
| `UnknownAccountError` | Valid token whose `sub` names no account (FR-017) | `401` *Authentication required* |

Telling *expired* apart from *invalid* is safe and is what US2 scenario 4 asks for: both
statements describe a token the caller already holds, so neither tells them anything they
did not supply. It is also the difference between a UI that silently prompts a re-sign
and one that shows "something went wrong".

`UnknownAccountError` deliberately shares the generic message. "The account this token
names has been deleted" is a fact about the platform's state, not about the caller's
token, and it is the one guard failure whose specific cause could be informative to
someone probing. The log records it distinctly.

---

## Validation failures

Handled by `ZodValidationPipe` before any handler or service runs — so a request with a
malformed address never reaches the nonce store, and no challenge is issued (FR-002).

| Status | Body |
| --- | --- |
| `400` | Zod's flattened issue list — field path and message |

Echoing the field and the rule is fine here. "`address` must match `^0x[a-fA-F0-9]{40}$`"
describes the *request*, and reveals nothing about the platform's state.

---

## What is never logged

- The token string, in full or in part. A logged token is a usable credential sitting in
  a file that has different access controls than the database does.
- `JWT_SECRET`, obviously — and note that a leaked secret forges tokens for every account
  at once, with no revocation available to contain it (R13).
- The signature bytes. They are not secret, but they are useless in a log and long enough
  to bury the two addresses that actually help.

Wallet addresses **are** logged. They are public by construction, and they are the only
thing that makes an auth log line diagnosable.
