# `ui/` — Guardian frontend

React + TypeScript + Vite. Eight screens, one of which is the demo.

## Start

```bash
npm install
cp .env.example .env.local     # set VITE_API_URL
npm run dev                    # → http://localhost:5173
```

**You need a browser wallet extension** (MetaMask or similar) in whatever browser you test with. Connecting one is the entire registration flow — there is no password and no email — so without an extension the entry screen can only tell you to install one. Point it at **Monad Testnet** (chain `10143`); the app detects any other network and offers to switch, and will add the network for you if the wallet doesn't know it yet.

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
├── auth/        AuthContext (who is signed in) and useSignIn (the whole flow)
├── chain/       chain definition, wagmi config, wallet error classification
├── components/  app shell, balance widget, route guard, wallet menu, banner
├── hooks/       usePolling (shared refresh), useNow (the app's only timer),
│               useCountdown, useOrder, useAccountSummary
├── lib/         money and duration formatting, order state machine, server clock,
│               input schema, query client
├── pages/       one file per screen
├── routes/      path builders and the route table
└── config.ts    VITE_API_URL, validated at startup
```

## Two conventions worth keeping

**No `fetch` outside `src/api/`.** A screen that needs a new endpoint adds a typed wrapper in `src/api/` and inherits the base URL, the credential, the timeout, and error normalisation. Calling `fetch` directly skips all four.

**No route strings outside `src/routes/paths.ts`.** Link targets come from the path builders. A typo in an inline template literal is invisible until someone clicks it.

**The wallet signs exactly one thing: the auth nonce.** Every chain write goes through the operator, server-side. The UI never calls the escrow contract and never holds a key.

**Explorer URLs come only from `src/chain/chains.ts`.** viem's built-in `monadTestnet` points at the older `monadexplorer.com` host, which redirects — we override it to MonadVision in one place so a second hardcoded copy can't disagree.

All four are checked by grep, since there is no linter configured:

```bash
grep -rnE "\bfetch\(" src/                                          # only src/api/client.ts
grep -rnE "\"/(agents|orders|wallet|sell)|'/(agents|orders|wallet|sell)" src/ | grep -v paths.ts   # nothing
grep -rn "signMessage" src/                                         # only src/auth/useSignIn.ts
grep -rniE "sendTransaction|useWriteContract|privateKey|mnemonic"  src/   # nothing
grep -rn "monadvision\|monadexplorer" src/                          # only src/chain/chains.ts
```

## Manual verification

There is no test suite, so acceptance is by hand: `specs/001-ui-foundation/quickstart.md` is the full run, Parts A–E. Re-run Parts A (routing) and C (polling) after every later UI feature — route regressions and leaked intervals are the failures that surface on stage rather than at the desk.

## Notes for the next feature

- **`/__poll-test`** is a DEV-only harness for `usePolling` (stop-on-terminal, unmount cleanup, no overlap). It is gated on `import.meta.env.DEV` and absent from production builds. It expects a backend serving `/stub/order?after=N&key=…`; against the real API, point it at an order instead.
- **Polling continues while the tab is hidden** (`refetchIntervalInBackground: true`). React Query pauses intervals for hidden documents, and on macOS an *occluded* window counts as hidden — which would mean the order page stops updating whenever a terminal covers the browser. Act 1 depends on that page flipping on its own, so the pause is switched off. Chrome still throttles background timers, so expect roughly double the configured interval while hidden.
- `StrictMode` is on in development, which double-invokes effects on mount. That is intentional — it surfaces exactly the cleanup bugs the polling hook must not have. Expect paired requests in the Network panel during dev; production builds fire once.
- **wagmi v3 renamed the account hooks.** Use `useConnection` / `useConnectionEffect`; `useAccount` / `useAccountEffect` still work but are deprecated aliases, and every tutorial online shows the old names.
- **Identity is the stored credential, never wagmi's connection state.** A locked or slow-to-reconnect wallet must not sign the user out — see the comment at the top of `src/auth/AuthContext.tsx`. Nothing after sign-in needs the wallet.
- **Sign-in is one imperative async function**, not an effect watching the address. An effect fires a signature prompt when the user switches accounts, which is exactly what must not happen.
- **The catalogue needs a backend that has it.** `/agents` and `/agents/:id` are served by API-06, and buying calls API-07's `POST /orders`; the demo agents come from `POST /demo/seed` (API-11). Until those land, the marketplace correctly shows an error state — an empty catalogue there is a backend gap, not a frontend bug. Field names for those three payloads are provisional and live in `src/api/types.ts`; see `specs/003-marketplace-buy/contracts/internal-api.md` §8 for the diff list.
- **The order screen's countdown runs on a server-anchored clock.** `src/lib/serverClock.ts` keeps an offset taken from the `Date` header of every API response, because the countdown is computed entirely client-side and a laptop with a skewed clock would show a window that expired before delivery. **`Date` is not a CORS-safelisted response header**, so cross-origin the browser hides it unless the API sends `Access-Control-Expose-Headers: Date` — which it does not today (it sends no CORS headers at all). Until it does, the offset stays 0 and the countdown uses the device clock, which is exactly the behaviour that existed before the module. Verified working end to end against a fixture that does send the header.
- **One timer in the whole app**, `src/hooks/useNow.ts`. Both the elapsed line and the countdown read it. It reports an *instant*, never a duration, so a suspended tab is late by at most a tick rather than resuming from where it stopped. Do not add a second `setInterval`.
- **On the order screen the poll is the recovery mechanism.** Accept and complain get no retry button when a request gets no answer: the page re-reads the order every second, so a call that landed corrects the interface by itself, and a duplicate meets an order that has already moved and is refused. This is the *opposite* of the `POST /orders` rule below, and the two are easy to confuse — `src/api/orders.ts` carries a scope note saying which is which.
- **Order payload shapes are provisional and the endpoints do not exist.** `GET /orders/:id`, `POST /orders/:id/accept`, and `POST /orders/:id/complain` are unbuilt; the assumptions (embedded `run`, embedded `agentName`, ISO-8601 timestamps, `reviewWindowSeconds` as a per-order snapshot) are listed as a diff list in `specs/004-order-detail/contracts/internal-api.md` §7.
- **`POST /orders` is not idempotent.** The backend commits the order and the ledger debit in one transaction and only then answers, so a timeout tells us nothing about whether it committed. `BuyPanel` offers no retry on that branch and sends the buyer to `/orders` instead. Do not "improve" this into a retry button without an idempotency key on the API side.
