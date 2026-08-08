# Phase 0 Research: UI Foundation

**Feature**: `001-ui-foundation` · **Date**: 2026-08-08

All versions below were resolved against the npm registry on 2026-08-08, not from memory.

---

## R1 — Toolchain versions

**Decision**

| Package | Version | Note |
| --- | --- | --- |
| `vite` | `^8.2.1` | engines: `^20.19.0 \|\| >=22.12.0` |
| `@vitejs/plugin-react` | `^6.0.5` | matching major for Vite 8 |
| `react` / `react-dom` | `^19.2.8` | |
| `typescript` | `~5.9.3` | **not** 7.x — see R2 |
| `react-router-dom` | `^7.18.2` | peer: react >=18 |
| `@tanstack/react-query` | `^5.101.4` | see R4 |
| Node (dev + image) | `24-alpine` | Active LTS; local dev machine is on v26.7.0, also fine |

**Rationale**: Vite 8's Node floor (`>=22.12`) rules out anything older; Node 24 is the current Active LTS and is what the container should pin so the image doesn't drift when Node 26 promotes in October. The developer's local Node 26.7.0 satisfies the same floor, so local `npm run dev` and the container agree.

**Alternatives considered**: Pinning the image to `node:26-alpine` to match the dev machine exactly — rejected because 26 is Current, not LTS, and matching the *floor* matters more than matching the laptop.

---

## R2 — TypeScript 5.9 rather than 7.0

**Decision**: `typescript@~5.9.3`.

**Rationale**: `latest` on npm is `7.0.2` — the Go-native compiler rewrite, GA very recently. This scaffold is a few hundred lines across a dozen files; the compile-speed win that justifies TS 7 is worth nothing here, while the risk of an editor-integration or `@typescript-eslint` gap costing an afternoon is real. On a time-boxed build with a demo at the end, the mature line is the cheaper bet.

**Alternatives considered**: `typescript@7.0.2` — genuinely attractive and probably fine, and this is a one-line swap in `package.json` if you'd rather be current. Recorded as a decision rather than an oversight, since "why is this on TS 5 when 7 is out" is a fair question later.

**Compiler settings**: `strict: true` plus `noUncheckedIndexedAccess`, `noUnusedLocals`, `noUnusedParameters`, `exactOptionalPropertyTypes`. Strict mode is named in the source spec; the extras cost nothing on a greenfield tree and are painful to retrofit once seven more features have landed on top.

---

## R3 — Routing: react-router-dom, declarative mode

**Decision**: `react-router-dom` v7 in declarative mode — `<BrowserRouter>` + `<Routes>` + `<Route>`, with a single layout route supplying the app shell and an `errorElement`-style catch-all for unmatched paths (FR-005).

**Rationale**: Eight static routes, three of them with one path parameter. Declarative mode is the smallest thing that satisfies FR-001 through FR-005, and the layout-route pattern gives FR-003's persistent shell for free — the header lives in the layout, screens render into an `<Outlet/>`, so navigation never remounts the header and the balance widget's poll survives page changes.

**Alternatives considered**:
- *React Router framework mode* (the former Remix stack) — adds a build integration, loaders, and an SSR story we have no use for.
- *TanStack Router* — better typed params, but it wants a route tree and codegen for a benefit we can get from three hand-written `RouteParams` types.

**Consequence worth writing down**: route paths get defined once in `src/routes/paths.ts` as functions (`orderDetail(id)`), not as string literals scattered across later features. Seven more specs will link to these; a typo in a template literal in UI-04 is otherwise invisible until someone clicks.

---

## R4 — Polling: TanStack Query behind a `usePolling` wrapper

**Decision**: Take `@tanstack/react-query` v5 now, and expose the spec's mechanism (FR-014…FR-020) as a thin `usePolling` hook wrapping `useQuery` with `refetchInterval` as a function that returns `false` once the terminal predicate matches.

**Rationale** — three things pointed the same way:

1. **It is arriving anyway, one spec later.** `wagmi@3` lists `@tanstack/react-query` as a required peer dependency, and UI-02 (Wallet connect) installs wagmi. Hand-rolling a hook now means writing it, then having its replacement land in the very next feature.
2. **The two failure modes the source spec warns about are exactly what a hand-rolled hook gets wrong.** `docs/specs/UI-01-foundation.md` calls out interval leaks on unmount and says "build it once, properly"; FR-018 additionally forbids overlapping requests. Query-key deduplication, unmount cleanup, and "don't schedule while a fetch is in flight" are all built-in behaviour, not code we maintain.
3. **The demo-visible risk is one-directional.** A leaked 1-second interval on the hero page, running for the length of a rehearsal, is the failure the source spec explicitly flags as "a needless way to look bad."

**Alternatives considered**: A dependency-free `usePolling` built on `setTimeout` + `AbortController` — roughly 60 lines and completely reasonable. Rejected because it duplicates a dependency that lands in UI-02 regardless, and because those 60 lines contain the three race conditions above. If you'd rather not take the dependency in UI-01, the wrapper's *signature* is designed to be identical either way, so swapping the body is a single-file change that no calling screen notices.

**Configuration**: `retry: false` (a 1-second poll retries on its own next tick; layered retries just multiply requests), `refetchOnWindowFocus: false` (a tab returning to the foreground must not fire a burst), `refetchIntervalInBackground: true` (see below), `staleTime: 0`.

**`refetchIntervalInBackground: true` — decided during implementation, from an observed behaviour.** React Query pauses `refetchInterval` whenever `document.visibilityState === 'hidden'`, and on macOS a window that is merely *occluded by another window* counts as hidden — not just a background tab. Verification caught this: with the browser behind the terminal, a 5-second poll produced zero requests over 12 seconds. Act 1's central claim is that the order page flips to released on its own with nobody touching the keyboard; making that conditional on whether a terminal window happens to be covering the browser is a variable not worth carrying into a rehearsal. Against localhost the cost of polling while hidden is nil, and there is no burst risk because nothing queues. Chrome still clamps background timers — a 5 s interval was measured at 6 s and a 1 s interval at ~2 s while hidden — which is the spec's "may be throttled, must recover without a burst" edge case behaving exactly as required.

**Wrapper signature** (the contract later features code against):

```
usePolling<T>(key, fetcher, { intervalMs, isTerminal? })
  → { data, error, isPolling, refetch }
```

`isTerminal` omitted means "never stops" (FR-020, the Wallet and My Orders case). Provided, it is evaluated against each successful result (FR-016, including on the very first fetch).

---

## R5 — HTTP client: native `fetch`, no library

**Decision**: A hand-written client over `fetch` with `AbortSignal.timeout()`, ~80 lines in `src/api/client.ts`, exposing `get/post/patch` generic over response type.

**Rationale**: The requirements are a base URL, a bearer header, a timeout, and one error shape (FR-006…FR-012). `fetch` does all of it. Axios would add a dependency to get interceptors we'd use once.

**Error normalisation** — one discriminated union, produced for every failure path so no caller ever sees a raw throw:

| `kind` | Cause | `status` |
| --- | --- | --- |
| `http` | Backend replied with a non-2xx | the real status |
| `network` | `fetch` rejected — backend down, DNS, CORS | `0` |
| `timeout` | `AbortSignal.timeout()` fired | `0` |
| `parse` | 2xx with a body that isn't the expected JSON | the real status |

FR-010's "distinguish connectivity failure from backend rejection" is `kind !== 'http'`. The `code` field takes the backend's own error code when present and a local constant otherwise, so screens can branch on a string rather than on message text.

**Alternatives considered**: `openapi-fetch` with generated types — correct if the API published an OpenAPI document, which it does not yet. Types are hand-written in `src/api/types.ts` for now; if API-01 emits a schema, regenerating into the same module is a contained change.

---

## R6 — Reachability check tolerates a missing `/health`

**Decision**: `checkHealth()` calls `GET /health` and reports **reachable if any HTTP response comes back at all** — including 404 or 500. Only `kind: 'network'` and `kind: 'timeout'` count as unreachable.

**Rationale**: `/health` is named in the UI spec's acceptance criteria and in `docs/project-structure.md` §6's bootstrap checklist, but it does **not** appear in `docs/api-design.md` §3's endpoint tables. It is very likely to exist (it is a NestJS scaffold default and API-01's own done-when), but this feature must not fail its acceptance criteria on the API team's routing decision. Treating "the server answered" as the signal tests exactly what SC-002 cares about — that the base URL is right and the backend is up — and is immune to whether the path exists.

**Alternatives considered**: Requiring a 200 from `/health` — brittle. Falling back to `GET /me` — worse, because unauthenticated it returns 401 and the distinction gets muddy.

---

## R7 — Session credential storage

**Decision**: `localStorage`, key `guardian.jwt`, reached only through `src/api/session.ts` (`readToken` / `writeToken` / `clearToken`). UI-01 reads and clears; UI-02 owns writing it after signature verification.

**Rationale**: FR-011 needs to clear it and FR-008 needs to read it, so the module must exist now even though nothing writes to it yet. `localStorage` over `sessionStorage` so an accidental refresh mid-rehearsal doesn't force a re-signature — the token is a demo-scale bearer credential on a testnet, and XSS exposure isn't the threat model that decides this.

**Consequence**: the 401 handler in the client both clears the token and redirects. Redirecting from inside a non-React module means the client cannot use router navigation — it dispatches a `guardian:unauthenticated` event that the shell listens for and turns into a navigation. Avoids `window.location.href`, which would throw away the SPA.

---

## R8 — Money: integer cents, one formatter

**Decision**: Every amount crossing the API boundary is an integer of **USD cents** (`database-schema.md` §1.3 — `$2.00 → 200`), typed as `Cents = number` and formatted by a single `formatUsd(cents)` in `src/lib/money.ts`. No floating-point arithmetic on money anywhere in the UI.

**Rationale**: Token base units (USDC, 6 decimals) exist only inside the API's chain adapter. If a `10^4` conversion ever appears in frontend code, something has gone wrong upstream — worth stating now, because the header widget in this feature is the first place a money value gets rendered and it sets the pattern for UI-04, UI-05, and UI-06.

---

## R9 — Container: dev server, not a production build

**Decision**: `Dockerfile` running `vite --host 0.0.0.0 --port 5173` on `node:24-alpine`; `docker-compose.yml` per `docs/project-structure.md` §3.2 — `env_file: ../.env`, `VITE_API_URL` override, port `5173:5173`, `./src` volume-mounted.

**Rationale**: §3.2 specifies exactly this shape, including the source mount — which only makes sense for a dev server. A multi-stage nginx build would be the production answer and the wrong one here: it can't hot-reload, and there is no deployment target. The compose file's job is a clean one-command start, and the source spec is explicit that daily iteration should use `npm run dev` instead.

**`--host 0.0.0.0` is load-bearing**: Vite binds loopback by default, and a container binding loopback is unreachable from the host — the single most common way this file ships broken.

**Alternatives considered**: Multi-stage build with `vite build` + nginx — deferred; nothing needs it and it costs the hot reload.

---

## R10 — Environment variables and the bundle guardrail

**Decision**: `VITE_API_URL` is the only variable this feature reads. It is validated once at startup in `src/config.ts`, which throws a named error if the value is missing or unparseable as a URL (FR-006). `.env.example` documents it.

**Rationale**: Vite's `VITE_` prefix rule *is* the mechanism satisfying FR-026 — non-prefixed values in the shared root `.env` are structurally incapable of reaching the bundle, which is what keeps `OPERATOR_PRIVATE_KEY` out. This is inherited, not decided here, and the source spec is emphatic that it must not be worked around. Practical consequence for this feature: no `define:` entries in `vite.config.ts` and no `process.env` access in `src/` — both are ways to defeat the prefix rule by accident.

**Verification for SC-009**: after `vite build`, grep `dist/` for any non-`VITE_` key present in the root `.env`. Zero hits is the criterion.

---

## R11 — Styling

**Decision**: One `src/index.css` with CSS custom properties for colour and spacing, plus a small layout for the shell header. No framework, no CSS-in-JS, no component library.

**Rationale**: FR-029 puts styling systems out of scope, and the design budget belongs to Order Detail and the verdict card (`docs/CONTEXT.md` §1). Custom properties now mean whichever feature first needs real design can introduce a system without a find-and-replace across eight screens.

---

## Unresolved

None. The three fallbacks flagged in the spec's Assumptions are resolved above: `/health` by R6, the header's two figures by the FR-021 correction (below), and credential storage by R7.

**Spec correction made during this phase**: FR-021 originally said the header shows *available balance and settled funds*. `docs/api-design.md` §3.2 and `ui/docs/specs.md` UI-06 both establish that `GET /me` returns **available balance and in-escrow**, while settled funds live on-chain in `balances[]` and are a Wallet-page concern. The header now shows available and in-escrow — two figures from one call, which is what the "never one number" rule actually requires here.
