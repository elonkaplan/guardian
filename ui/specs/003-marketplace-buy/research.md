# Phase 0 — Research: Marketplace & Agent Detail

**Feature**: 003-marketplace-buy · **Date**: 2026-08-08

Thirteen decisions. Package versions below were checked against the npm registry on 2026-08-08. Backend shapes were read out of `docs/api-design.md` and `api/specs/002-entities-migrations/data-model.md` — the endpoints themselves (API-06, API-07) are not built yet, which is the source of R1 and R2.

---

## R1 — The catalogue endpoints do not exist yet, and that is fine

**Decision**: Build against the documented contract now, isolate every assumption about it in `src/api/types.ts` and the two new wrappers, and treat integration with API-06/API-07 as a later reconciliation rather than a blocker.

**Rationale**: `GET /agents`, `GET /agents/:id`, and `POST /orders` are delivered by API-06 and API-07; the backend has shipped API-01 (foundation) and is mid-API-02 (entities). Waiting serialises two components that were deliberately specified to run in parallel. The shapes are not guesswork either — `api/specs/002-entities-migrations/data-model.md` §4 fixes the columns behind the listing (`name`, `description`, `capabilities text[]`, `exclusions text[]`, `price_minor bigint`, `input_schema jsonb`, `output_schema jsonb`), and `docs/api-design.md` §3.4 fixes the purchase request body.

UI-02 already set the precedent with `AccountSummary`, whose doc-comment says field names are provisional and that this file is the only thing that changes if the API lands different ones. This feature follows it exactly.

**Alternatives considered**: Mock the endpoints behind a fake adapter — rejected, it doubles the code paths and a mock that returns cheerful data is the thing you forget to remove. Block until API-06 lands — rejected; nothing about this screen's structure depends on it.

---

## R2 — camelCase in JSON, snake_case in the database

**Decision**: Type all payloads in camelCase: `priceMinor`, `inputSchema`, `outputSchema`, `acceptanceCriteria`, `agentId`. Do not attempt to accept both casings.

**Rationale**: `docs/api-design.md` §3.4 writes the purchase request body as `{ agentId, input, acceptanceCriteria }` — camelCase, in the one place the doc actually spells out a JSON body. The database columns are snake_case, but that is TypeORM's side of the fence and API-06 owns the serialiser that crosses it. Guessing consistently with the only documented example beats guessing twice.

Accepting both casings sounds like cheap insurance but is not: it doubles every type, hides the mismatch instead of surfacing it on the first integration run, and leaves dead branches nobody deletes. If API-06 lands snake_case, the fix is a rename inside `src/api/types.ts` plus two wrapper files, and it is caught the first time the marketplace is loaded against a real backend.

**Alternatives considered**: A generic `camelize()` pass over every response — rejected as a transformation layer that makes the network tab and the code disagree about what a field is called.

---

## R3 — One tolerance, deliberately: the catalogue envelope

**Decision**: `fetchAgents()` accepts either a bare array or a single-key envelope (`{ agents: [...] }` / `{ items: [...] }` / `{ data: [...] }`) and normalises to an array. This is the **only** shape tolerance in the API layer.

**Rationale**: List-vs-envelope is the single most common disagreement between a documented API and a built one, `api-design.md` does not say which this is, and the failure mode is uniquely bad: an envelope read as an array yields a *silently empty catalogue*, which the UI faithfully renders as "no agents are listed yet". That is an empty stage in a demo with no error to point at. The unwrap is four lines in one function.

Contrast with R2's blanket rejection of tolerance: a wrong *field name* produces `undefined` in a visible place — a card with a blank price. A wrong *envelope* produces a plausible, wrong, silent success. Only the second one earns a defensive branch.

**Alternatives considered**: Tolerate nothing and rely on the integration run — rejected on the silent-failure asymmetry above. Tolerate broadly across all responses — rejected as R2.

---

## R4 — No JSON Schema form library

**Decision**: Hand-roll the schema→fields mapping in `src/lib/inputSchema.ts`. Add no dependency.

**Rationale**: The obvious candidate is `@rjsf/core@6.7.1`, which needs `@rjsf/utils` plus a validator package (`@rjsf/validator-ajv8`, pulling `ajv@8.20.0`) plus a theme package — four dependencies to render what the spec's Assumptions section already restricts to *flat objects of primitive properties*. It also arrives with its own markup and theming, which fights a 465-line hand-written stylesheet built on CSS custom properties, and its generality is aimed squarely at the case this feature explicitly falls back out of.

The subset we support (R5) is roughly 120 lines of pure function. It is also the piece most worth being able to read during a rehearsal at 3am.

**Alternatives considered**: `@rjsf/core` — above. `ajv` alone for validation without the form rendering — rejected by R7; the backend is the validation authority and we only need "is anything required missing".

---

## R5 — What counts as renderable, and the fallback

**Decision**: An input schema renders as individual fields when it is an object schema whose every property is a primitive — `string`, `number`, `integer`, or `boolean` — with no nested `object` or `array` values. Anything else falls back to a single raw JSON textarea with the schema shown beside it.

Per-property mapping:

| Schema | Control | Notes |
| --- | --- | --- |
| `enum` (any type) | `<select>` | Checked first — an enum beats its base type |
| `string` | `<textarea>` or `<input type="text">` | R6 decides which |
| `number` / `integer` | `<input type="number">` | `step="1"` for `integer` |
| `boolean` | `<input type="checkbox">` | Never required-checked; a false is an answer |

Labels come from `title`, falling back to the property name humanised. Help text comes from `description`. Required-ness comes from the schema's `required: string[]`.

**Rationale**: This covers all three seeded demo agents — LedgerBot's input is receipt text, a single string (`docs/product-workflow.md` §5) — and the fallback means the *unbuyable listing* failure mode cannot happen no matter what a seller submits through UI-07's raw-JSON schema textareas. Detecting the supported subset by structure rather than by a flag keeps the two paths from drifting: there is one predicate, and the renderer and the payload builder both read it.

**Alternatives considered**: Support one level of nesting — rejected as scope with no demo behind it. Always use the raw JSON textarea — rejected; the source spec asks for fields per the schema, and a buyer hand-writing JSON to buy something is exactly the friction this screen should not have.

---

## R6 — Strings default to multi-line

**Decision**: A `string` property renders as a `<textarea>` (3 rows, resizable) unless the schema constrains it to something short — it has an `enum`, a `maxLength` ≤ 80, or a `format` implying a scalar (`date`, `date-time`, `email`, `uri`, `uuid`) — in which case it is a single-line input.

**Rationale**: The realistic input to these agents is a pasted document: a receipt, an invoice, a block of messy text. Pasting 400 characters of receipt into a single-line input is the kind of small indignity that makes a demo look unfinished, and the schema rarely says "this is long" explicitly. Defaulting the *unconstrained* case to multi-line and letting explicit constraints opt back down inverts the usual default in the direction the actual data points.

**Alternatives considered**: Single-line by default with a heuristic on the property name (`/text|body|content|notes/i`) — rejected; name-sniffing is a rule nobody can predict from the outside. A `x-ui` schema extension — rejected, it would need UI-07 to teach sellers about it.

---

## R7 — Local validation is a courtesy; the backend is the authority

**Decision**: Validate exactly three things before submitting — required fields present and non-blank, acceptance criteria non-empty, and (fallback path only) the raw JSON parses. No type checking beyond what the control already enforces, no `minLength`/`pattern`/`maximum` enforcement, no schema validator.

**Rationale**: API-07 step 1 validates the input against `input_schema` server-side before money moves, and that validation is the one that counts. A second, partial implementation in the browser would drift from it and produce the worst outcome: a form that refuses something the backend would have accepted. The three checks above are the ones the spec's acceptance actually names ("caught before submitting"), and each maps to a message the buyer can act on.

`FR-023` closes the loop — whatever the backend refuses is shown on the form with every entered value preserved.

**Alternatives considered**: `ajv` in the browser against the real schema — rejected: a dependency, plus two validators to keep in sync for a form with at most a handful of fields.

---

## R8 — The balance comes from the query the shell is already polling

**Decision**: `useAccountSummary()` reads the `['me']` query key — the same one `BalanceWidget` polls at 5s — via `useQuery`, with no interval of its own. It does not call `fetchMe` a second time.

**Rationale**: `BalanceWidget` lives in `AppShell`, so on every screen with a signed-in user there is already a live `['me']` query refreshing every five seconds. TanStack Query deduplicates by key: a second `useQuery(['me'])` in the buy panel subscribes to that same cache entry and re-renders when it updates. Zero extra requests, and the affordability check tracks a top-up made in another tab without anyone reloading.

This is **better than what the spec assumed**. The spec's Assumptions say "balance re-reads happen on returning to the form, not on a timer — this screen does not poll", written before the shell's existing poll was accounted for. The screen still adds no poll; it inherits one. FR-027 ("re-enable without a full page reload") is satisfied more strongly than written, so no spec change is needed — but a reviewer comparing the two documents should know why they differ.

**Alternatives considered**: A dedicated `fetchMe` call on mount — rejected, a second source of truth for a number already on screen in the header, and it can disagree with the header for up to five seconds. Passing the balance down from `AppShell` via context — rejected; the cache already is that context.

---

## R9 — Insufficient balance blocks locally; an unreadable balance does not

**Decision**: Disable the buy action and show the shortfall when `availableBalanceMinor < priceMinor`. When the `['me']` query has errored or has not resolved, leave the action enabled and let the backend decide.

**Rationale**: SC-003 wants zero underfunded requests reaching the backend, and FR-026 wants the shortfall named. Both need a *known* balance. The failure case is the interesting one: if a transient `GET /me` failure disabled the buy button, a backend that was perfectly willing to accept the purchase would be blocked by the UI — a self-inflicted demo stop with no way for the operator to override it. Deferring is safe because API-07 validates the balance anyway, and the worst outcome is an honest rejection message.

The two figures stay separately labelled either way (FR-025) — available balance and price, never summed or merged, consistent with the header widget and `CONTEXT.md` §3.5.

**Alternatives considered**: Block on unknown — rejected above. Never block, always let the server refuse — rejected, it fails the spec's acceptance and wastes a round trip on the most predictable error in the product.

---

## R10 — Browsing stays public; buying requires a session — **spec correction**

**Decision**: `/agents` and `/agents/:id` remain outside `RequireAuth`. The buy panel renders a sign-in invitation instead of a form when there is no session, carrying the current location so the buyer returns to the same agent afterwards.

**Rationale**: FR-030 as originally written said *both screens* require a session. That contradicts the existing router, where UI-01/UI-02 deliberately left these two routes public with a comment explaining why: `GET /agents` and `GET /agents/:id` are public in `api-design.md` §3.3, and guarding them client-side would contradict the backend and make the product feel closed for no reason. That reasoning still holds, and it is better reasoning than the requirement I wrote.

`RequireAuth` already carries `state={{ from: location }}` and `ConnectPage` already honours it, so the return-to-agent behaviour is existing machinery, not new work.

**Action taken**: `spec.md` FR-030 was rewritten before planning proceeded. It now reads: browsing is open; buying requires a session; an unauthenticated visitor sees an invitation to sign in where the buy action would be and is returned to the agent afterwards. This is the only spec correction made during planning.

---

## R11 — Failure states key on HTTP status, not on invented error codes

**Decision**: Distinguish failures using what `ApiError` already carries — `kind` for connectivity vs. refusal, `status` for 404 (unknown agent) and 401 (handled globally), and the backend's `message` for everything else. Do not build a client-side map of backend error codes.

**Rationale**: `src/api/errors.ts` already normalises every failure into `{ kind, status, code, message }` and `isConnectivityError()` already draws the line the screens actually need — "the backend refused" versus "we never got an answer". No backend error-code vocabulary exists yet (API-07 is unbuilt), so any map written now would be fiction. Rendering the backend's own `message` for a refusal is both honest and self-updating.

Two refusals get bespoke copy because they have a specific next action: **404 on the detail load** → not-found state with a route back to the catalogue (FR-012); **any refusal of the purchase** → shown inline on the form with values preserved (FR-023). A deactivated agent and a price change both land in the second bucket and read as whatever API-07 says, which is the right level of coupling for now.

**Alternatives considered**: Pre-agree an error-code enum with API-07 — worth doing eventually, and worth a line in the handoff, but inventing it unilaterally from the client side produces a vocabulary the backend never adopts.

---

## R12 — A network failure on purchase must not invite a retry

**Decision**: When `POST /orders` fails with `isConnectivityError(error) === true`, show copy that says the order may still have been created, and link to `/orders`. Do not offer a retry button on that branch.

**Rationale**: The purchase is not idempotent. API-07 inserts the order and the ledger debit in one transaction and only then returns; a client timeout at 10 seconds (`client.ts`'s default) says nothing about whether that transaction committed. A cheerful "try again" on this branch is how a buyer pays twice, and it is a money bug rather than a cosmetic one. Sending the buyer to their orders list is both truthful and self-resolving — the order is either there or it is not.

The refusal branch (`kind === 'http'`) is the opposite: the backend definitively did not create anything, so correct-and-retry is exactly right.

**Alternatives considered**: An idempotency key on the request — the real fix, but it needs API-07 to honour it and inventing the header from the client alone buys nothing. Flagged for the handoff.

---

## R13 — No new polling, and no new query defaults

**Decision**: Use plain `useQuery` for `['agents']` and `['agents', id]`, and `useMutation` for the purchase. Do not use `usePolling`. Do not override the client defaults.

**Rationale**: `usePolling` exists for screens that watch something change; a catalogue does not change while you look at it. The existing defaults in `src/lib/queryClient.ts` happen to give this feature exactly what it needs for free:

| Default | Effect here |
| --- | --- |
| `staleTime: 0` | Returning to the detail screen refetches the listing and the balance — FR-027's "without a full page reload", with no code |
| `retry: false` | A failed catalogue load shows the error state immediately instead of hanging for three silent attempts; FR-003's retry is the user's, on a button |
| `refetchOnWindowFocus: false` | Tabbing away to a wallet and back does not fire a burst |

`useMutation` supplies `isPending`, which is the in-flight flag FR-020 needs, and it does not retry by default — which for a non-idempotent purchase is the only acceptable behaviour (R12).

**Alternatives considered**: Polling the catalogue at 5s so a newly created agent appears without a reload — rejected; UI-07 creates agents on a different screen and navigating back refetches anyway.
