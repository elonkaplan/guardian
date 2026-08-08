# `ui/` — Guardian frontend

React + TypeScript + Vite. Eight screens, one of which is the demo.

## Start

```bash
npm install
cp .env.example .env.local     # set VITE_API_URL
npm run dev                    # → http://localhost:5173
```

Or, for a clean one-command start:

```bash
docker compose up --build      # → http://localhost:5173
```

**Use `npm run dev` for iteration.** Vite hot reload through a Docker volume mount is noticeably laggier, especially on macOS. The compose file exists so a fresh checkout starts in one command, not so you develop inside it.

## Scripts

| | |
| --- | --- |
| `npm run dev` | Dev server with hot reload |
| `npm run build` | Production bundle into `dist/` |
| `npm run preview` | Serve the built bundle |
| `npm run typecheck` | `tsc --noEmit` |

**`npm run typecheck` is the only automated check this component has.** There are no tests here by explicit project decision (`docs/CONTEXT.md`) — the escrow contract in `sc/` is the one component that keeps a suite. Keep the compiler clean; it is doing more work than usual.

## Configuration

`VITE_API_URL` is required. The app refuses to start without it and says so on screen.

**Only `VITE_`-prefixed variables reach the browser.** That is a Vite rule and a deliberate guardrail: it is what keeps `OPERATOR_PRIVATE_KEY` and everything else in the shared root `.env` out of the shipped JavaScript. Don't work around it — no `define:` entries in `vite.config.ts`, no `process.env` access in `src/`.

To verify the guardrail holds:

```bash
npm run build
grep -ri "PRIVATE_KEY\|MNEMONIC\|SECRET" dist/    # expect no hits
```

## Layout

```
src/
├── api/         the only way out of the app — client, errors, session, types
├── components/  app shell, balance widget, shared placeholders
├── hooks/       usePolling — the shared refresh mechanism
├── lib/         money formatting, query client
├── pages/       one file per screen
├── routes/      path builders and the route table
└── config.ts    VITE_API_URL, validated at startup
```

## Two conventions worth keeping

**No `fetch` outside `src/api/`.** A screen that needs a new endpoint adds a typed wrapper in `src/api/` and inherits the base URL, the credential, the timeout, and error normalisation. Calling `fetch` directly skips all four.

**No route strings outside `src/routes/paths.ts`.** Link targets come from the path builders. A typo in an inline template literal is invisible until someone clicks it.

Both are checked by grep, since there is no linter configured:

```bash
grep -rnE "\bfetch\(" src/                                          # only src/api/client.ts
grep -rnE "\"/(agents|orders|wallet|sell)|'/(agents|orders|wallet|sell)" src/ | grep -v paths.ts   # nothing
```

## Manual verification

There is no test suite, so acceptance is by hand: `specs/001-ui-foundation/quickstart.md` is the full run, Parts A–E. Re-run Parts A (routing) and C (polling) after every later UI feature — route regressions and leaked intervals are the failures that surface on stage rather than at the desk.

## Notes for the next feature

- **`/__poll-test`** is a DEV-only harness for `usePolling` (stop-on-terminal, unmount cleanup, no overlap). It is gated on `import.meta.env.DEV` and absent from production builds. It expects a backend serving `/stub/order?after=N&key=…`; against the real API, point it at an order instead.
- **Polling continues while the tab is hidden** (`refetchIntervalInBackground: true`). React Query pauses intervals for hidden documents, and on macOS an *occluded* window counts as hidden — which would mean the order page stops updating whenever a terminal covers the browser. Act 1 depends on that page flipping on its own, so the pause is switched off. Chrome still throttles background timers, so expect roughly double the configured interval while hidden.
- `StrictMode` is on in development, which double-invokes effects on mount. That is intentional — it surfaces exactly the cleanup bugs the polling hook must not have. Expect paired requests in the Network panel during dev; production builds fire once.
- `BalanceWidget` uses a minimal `useHasSession` stand-in that just checks for a stored token. UI-02 owns real session state and should replace it with a context.
- `src/chain/` does not exist yet. wagmi and viem arrive with UI-02.
